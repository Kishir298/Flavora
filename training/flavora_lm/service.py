"""Local FlavoraLM inference service — the only process that touches model weights.

Endpoints:
    GET  /health    → model identity, loaded state, device (measured, not fabricated)
    GET  /metadata  → training_meta.json sidecar (reproducibility record)
    GET  /metrics   → metrics.json sidecar (latest training loss/perplexity)
    POST /generate  → actual token generation with generation controls
    POST /intent    → natural language → validated structured intent (torch path)
    POST /intent-numpy → same contract via the NumPy v0.2 core (sidecar, A/B)
    GET  /debug-numpy → dev-only raw model internals (FLAVORA_DEBUG=1 required)

Binds to 127.0.0.1 by default (never 0.0.0.0). Standard library only —
no web framework dependency.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from training.flavora_lm.intent import extract_intent  # noqa: E402
from training.flavora_lm.model import FlavoraLM  # noqa: E402
from training.flavora_lm.numpy_infer import (  # noqa: E402
    CONFIDENCE_THRESHOLD,
    decode_intent,
    self_test,
)
from training.flavora_lm.numpy_model import (  # noqa: E402
    MODEL_NAME as NUMPY_MODEL_NAME,
    MODEL_VERSION as NUMPY_MODEL_VERSION,
    FlavoraNeuralCore,
)
from training.flavora_lm.tokenizer import BPETokenizer  # noqa: E402

STATE: dict = {"model": None, "tokenizer": None, "device": "cpu", "loaded": False, "error": None, "artifacts": None,
               "numpy": None, "numpy_tokenizer": None, "numpy_loaded": False, "numpy_error": None,
               "numpy_dir": None, "numpy_selftest": None}


def load_model(artifacts_dir: str) -> None:
    d = Path(artifacts_dir)
    STATE["artifacts"] = str(d)
    STATE["device"] = "cpu"
    STATE["model"] = FlavoraLM.load_pretrained(d, map_location="cpu")
    STATE["tokenizer"] = BPETokenizer.load(d / "tokenizer.json")
    STATE["loaded"] = True


def load_numpy(numpy_dir: str | None) -> None:
    """Sidecar load of the NumPy v0.2 core. Optional — never breaks the torch path."""
    if not numpy_dir:
        return
    d = Path(numpy_dir)
    STATE["numpy_dir"] = str(d)
    try:
        core = FlavoraNeuralCore.load_npz(d / "model.npz")
        tok = BPETokenizer.load(d / "tokenizer.json")
        STATE["numpy"] = core
        STATE["numpy_tokenizer"] = tok
        STATE["numpy_loaded"] = True
        STATE["numpy_selftest"] = self_test(core, tok)
    except Exception as e:  # honest failure state, surfaced in /health
        STATE["numpy_error"] = str(e)
        STATE["numpy_loaded"] = False


def health_payload() -> dict:
    model: FlavoraLM | None = STATE["model"]
    tok: BPETokenizer | None = STATE["tokenizer"]
    ncore: FlavoraNeuralCore | None = STATE["numpy"]
    ntok: BPETokenizer | None = STATE["numpy_tokenizer"]
    st = STATE["numpy_selftest"] or {}
    return {
        "status": "ok" if STATE["loaded"] else "error",
        "model": model.cfg.model_name if model else None,
        "version": model.cfg.version if model else None,
        "parameterCount": model.num_parameters() if model else None,
        "contextLength": model.cfg.context_length if model else None,
        "tokenizerVersion": tok.version if tok else None,
        "tokenizerVocab": tok.vocab_size if tok else None,
        "loaded": bool(STATE["loaded"]),
        "device": STATE["device"],
        "artifacts": STATE["artifacts"],
        "error": STATE["error"],
        # NumPy v0.2 sidecar: distinguishes "server exists" from "neural
        # inference operational" (checkpoint valid + self-test shapes finite).
        "engine": "torch+NumPy" if STATE["numpy_loaded"] else "torch",
        "numpy": {
            "model": NUMPY_MODEL_NAME if ncore else None,
            "version": NUMPY_MODEL_VERSION if ncore else None,
            "parameterCount": ncore.param_count() if ncore else None,
            "tokenizerVersion": ntok.version if ntok else None,
            "tokenizerVocab": ntok.vocab_size if ntok else None,
            "loaded": bool(STATE["numpy_loaded"]),
            "checkpointValid": bool(STATE["numpy_loaded"]),
            "inferenceOperational": bool(st.get("ok", False)),
            "selfTest": st,
            "confidenceThreshold": CONFIDENCE_THRESHOLD,
            "dir": STATE["numpy_dir"],
            "error": STATE["numpy_error"],
        },
    }


def _artifact_payload(which: str) -> dict:
    """Serve training metadata / metrics sidecars (read from disk, never fabricated)."""
    name = "training_meta.json" if which == "metadata" else "metrics.json"
    try:
        raw = (Path(str(STATE["artifacts"])) / name).read_text(encoding="utf-8")
        return {"status": "ok", "file": name, "data": json.loads(raw)}
    except OSError as e:
        return {"status": "error", "file": name, "error": str(e)}


class Handler(BaseHTTPRequestHandler):
    server_version = "FlavoraLM/0.1"

    def log_message(self, fmt, *args):  # quieter logs; errors still visible
        sys.stderr.write("[flavoralm] %s\n" % (fmt % args))

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(200 if STATE["loaded"] else 503, health_payload())
            return
        if self.path in ("/metadata", "/metrics"):
            if not STATE["loaded"]:
                self._json(503, {"error": "model not loaded", "detail": STATE["error"]})
                return
            self._json(200, _artifact_payload(self.path.strip("/")))
            return
        if self.path.startswith("/debug-numpy"):
            # Development-only raw internals (tokens/ids/shapes/logits/probs).
            if os.environ.get("FLAVORA_DEBUG") != "1":
                self._json(403, {"error": "dev-only endpoint (set FLAVORA_DEBUG=1)"})
                return
            if not STATE["numpy_loaded"]:
                self._json(503, {"error": "numpy core not loaded", "detail": STATE["numpy_error"]})
                return
            from urllib.parse import parse_qs, urlparse
            text = parse_qs(urlparse(self.path).query).get("text", [""])[0][:500]
            self._json(200, self._debug_numpy(text))
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path == "/intent-numpy":
            self._handle_intent_numpy()
            return
        if not STATE["loaded"]:
            self._json(503, {"error": "model not loaded", "detail": STATE["error"]})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"error": "invalid JSON body"})
            return

        if self.path == "/generate":
            self._handle_generate(payload)
        elif self.path == "/intent":
            self._handle_intent(payload)
        else:
            self._json(404, {"error": "not found"})

    # --------------- handlers ---------------

    def _handle_generate(self, payload: dict) -> None:
        prompt = str(payload.get("prompt", ""))[:2000]
        if not prompt.strip():
            self._json(400, {"error": "prompt required"})
            return
        model: FlavoraLM = STATE["model"]
        tok: BPETokenizer = STATE["tokenizer"]
        t0 = time.time()
        ids = tok.encode(prompt, add_special=True)
        if not ids:
            self._json(400, {"error": "prompt encoded to nothing"})
            return
        idx = torch.tensor([ids], dtype=torch.long)
        max_new = min(int(payload.get("maxNewTokens", 48)), 200)
        out = model.generate(
            idx,
            max_new_tokens=max_new,
            temperature=float(payload.get("temperature", 0.7)),
            top_k=payload.get("topK", 40),
            top_p=payload.get("topP", 0.9),
            repetition_penalty=float(payload.get("repetitionPenalty", 1.15)),
            eos_id=tok.eos_id,
        )
        gen = out[0, len(ids):].tolist()
        if tok.eos_id in gen:
            gen = gen[: gen.index(tok.eos_id)]
        self._json(200, {
            "text": tok.decode(gen, skip_special=True),
            "tokens": len(gen),
            "ms": int((time.time() - t0) * 1000),
        })

    def _handle_intent(self, payload: dict) -> None:
        text = str(payload.get("text", ""))[:1000]
        if not text.strip():
            self._json(400, {"error": "text required"})
            return
        model: FlavoraLM = STATE["model"]
        tok: BPETokenizer = STATE["tokenizer"]
        t0 = time.time()
        intent = extract_intent(model, tok, text)
        self._json(200, {
            "intent": intent,  # null when nothing usable survived validation
            "valid": intent is not None,
            "ms": int((time.time() - t0) * 1000),
        })

    def _handle_intent_numpy(self) -> None:
        """Sidecar: NumPy v0.2 core -> decoded intent. Same honesty contract:
        low-confidence/invalid -> valid:false so Node falls back (never fake)."""
        if not STATE["numpy_loaded"]:
            self._json(503, {"error": "numpy core not loaded", "detail": STATE["numpy_error"]})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"error": "invalid JSON body"})
            return
        text = str(payload.get("text", ""))[:1000]
        if not text.strip():
            self._json(400, {"error": "text required"})
            return
        core: FlavoraNeuralCore = STATE["numpy"]
        tok: BPETokenizer = STATE["numpy_tokenizer"]
        t0 = time.time()
        ids = np.array([tok.encode(text, add_special=False) or [tok.unk_id]], dtype=np.int64)
        intent, conf, _ = decode_intent(core, ids, tok.pad_id)
        self._json(200, {
            "intent": intent,  # null on low confidence — honest fallback signal
            "valid": intent is not None,
            "confidence": round(conf, 4),
            "engine": "numpy",
            "ms": int((time.time() - t0) * 1000),
        })

    @staticmethod
    def _debug_numpy(text: str) -> dict:
        """Raw internals for proving the network executes (dev only)."""
        core: FlavoraNeuralCore = STATE["numpy"]
        tok: BPETokenizer = STATE["numpy_tokenizer"]
        t0 = time.time()
        tokens = tok.encode(text, add_special=False) or [tok.unk_id]
        ids = np.array([tokens], dtype=np.int64)
        probs = core.forward(ids, tok.pad_id)
        pred = {n: core.config.heads[n][int(np.argmax(p[0]))] for n, p in probs.items()}
        conf = float(np.mean([float(np.max(p[0])) for p in probs.values()]))
        return {
            "input": text,
            "tokenIds": tokens,
            "numTokens": len(tokens),
            "embeddingShape": list(core.embeddings.shape),
            "hiddenShape": [core.config.hidden, core.config.hidden],
            "probabilities": {n: [round(float(x), 4) for x in p[0]] for n, p in probs.items()},
            "prediction": pred,
            "confidence": round(conf, 4),
            "paramCount": core.param_count(),
            "ms": int((time.time() - t0) * 1000),
        }


def verify_loopback_identity(host: str, port: int, attempts: int = 5) -> tuple[bool, str]:
    """Post-bind self-check: fetch our own /health over real HTTP.

    Catches the macOS case where AirPlay Receiver (AirTunes) owns port 5000:
    binding 127.0.0.1:5000 can still succeed while AirTunes answers every
    request (HTTP 403), so a TCP bind alone proves nothing. Without this
    check the service reports 'listening' while unreachable.
    """
    last_err = "no response"
    for _ in range(attempts):
        try:
            with urllib.request.urlopen(f"http://{host}:{port}/health", timeout=3) as res:
                body = json.loads(res.read().decode("utf-8"))
                if body.get("loaded") is True and str(body.get("model", "")).lower().startswith("flavoralm"):
                    return True, ""
                last_err = f"unexpected /health body: model={body.get('model')!r} loaded={body.get('loaded')!r}"
        except Exception as e:  # noqa: BLE001
            last_err = str(e)
        time.sleep(0.3)
    return False, last_err


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--artifacts", default=str(Path(__file__).resolve().parents[2] / "models" / "flavora-lm" / "v0.1"))
    ap.add_argument("--numpy-dir", default=str(Path(__file__).resolve().parents[2] / "models" / "flavora-lm" / "dev-numpy"))
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=5000)
    args = ap.parse_args()

    try:
        load_model(args.artifacts)
        h = health_payload()
        print(
            f"[flavoralm] {h['model']} v{h['version']} loaded "
            f"({h['parameterCount']:,} params, tokenizer v{h['tokenizerVersion']}, device {h['device']})",
            flush=True,
        )
    except Exception as e:  # model load failure is fatal but explicit
        STATE["error"] = str(e)
        print(f"[flavoralm] FATAL: failed to load model: {e}", file=sys.stderr, flush=True)
        return 1
    # NumPy v0.2 sidecar is optional: absence never breaks the torch path.
    load_numpy(args.numpy_dir if Path(args.numpy_dir, "model.npz").exists() else None)
    nh = health_payload()["numpy"]
    if nh["loaded"]:
        st = nh["selfTest"] or {}
        print(
            f"[flavoralm] {nh['model']} v{nh['version']} sidecar "
            f"({nh['parameterCount']:,} params, tokenizer v{nh['tokenizerVersion']}, "
            f"self-test {'PASS' if st.get('ok') else 'FAIL'})",
            flush=True,
        )
    else:
        print(f"[flavoralm] numpy sidecar absent ({nh['error'] or args.numpy_dir} missing?) — torch path only",
              flush=True)

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    # Serve in a background thread so the post-bind identity self-check below
    # can actually reach /health (connections are only served once
    # serve_forever() is running).
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    # Post-bind identity self-check: prove this process can actually serve
    # /health on the chosen port (guards against AirPlay port squatters).
    ok, detail = verify_loopback_identity(args.host, args.port)
    if not ok:
        server.shutdown()
        server.server_close()
        print(
            f"[flavoralm] FATAL: bound {args.host}:{args.port} but /health is not served by this process: {detail}\n"
            f"[flavoralm] Another service (macOS AirPlay Receiver uses :5000) is intercepting traffic.\n"
            f"[flavoralm] Fix: set FLAVORA_LM_PORT (e.g. 5001), or disable AirPlay Receiver, then re-run.",
            file=sys.stderr,
            flush=True,
        )
        return 1
    print(f"[flavoralm] listening on http://{args.host}:{args.port} (identity verified)", flush=True)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
