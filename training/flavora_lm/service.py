"""Local FlavoraLM inference service — the only process that touches model weights.

Endpoints:
    GET  /health    → model identity, loaded state, device (measured, not fabricated)
    GET  /metadata  → training_meta.json sidecar (reproducibility record)
    GET  /metrics   → metrics.json sidecar (latest training loss/perplexity)
    POST /generate  → actual token generation with generation controls
    POST /intent    → natural language → validated structured intent

Binds to 127.0.0.1 by default (never 0.0.0.0). Standard library only —
no web framework dependency.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from training.flavora_lm.intent import extract_intent  # noqa: E402
from training.flavora_lm.model import FlavoraLM  # noqa: E402
from training.flavora_lm.tokenizer import BPETokenizer  # noqa: E402

STATE: dict = {"model": None, "tokenizer": None, "device": "cpu", "loaded": False, "error": None, "artifacts": None}


def load_model(artifacts_dir: str) -> None:
    d = Path(artifacts_dir)
    STATE["artifacts"] = str(d)
    STATE["device"] = "cpu"
    STATE["model"] = FlavoraLM.load_pretrained(d, map_location="cpu")
    STATE["tokenizer"] = BPETokenizer.load(d / "tokenizer.json")
    STATE["loaded"] = True


def health_payload() -> dict:
    model: FlavoraLM | None = STATE["model"]
    tok: BPETokenizer | None = STATE["tokenizer"]
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
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--artifacts", default=str(Path(__file__).resolve().parents[2] / "models" / "flavora-lm" / "v0.1"))
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

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[flavoralm] listening on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
