#!/usr/bin/env node
/**
 * Flavora one-command setup + launch — pure Node.js (cross-platform: macOS/Linux/Windows).
 *
 *   npm run start   → full setup (deps, DB, seed, FlavoraLM) then launch services
 *   npm run setup   → setup only (no services started)
 *
 * What `npm run start` does:
 *   1. Verifies Node.js 20+ and Python 3.11+.
 *   2. Installs npm dependencies (root + workspaces).
 *   3. Creates .flavoralm-venv/ (local virtualenv) and installs training/requirements.txt.
 *   4. Syncs the Prisma/SQLite schema (non-destructive) and seeds recipes (idempotent upserts).
 *   5. Verifies FlavoraLM model artifacts (models/flavora-lm/v0.1/).
 *   6. Starts the FlavoraLM inference service (127.0.0.1:5000) and waits for /health.
 *   7. Starts Express (localhost:4000) and Vite (localhost:5173).
 *   8. Opens the browser where supported and prints service URLs.
 *
 * Safety rules:
 * - never overwrites an existing .env (only creates it from .env.example when missing)
 * - never deletes the database; schema sync via `prisma db push` is non-destructive
 * - never installs software silently; Python packages go only into .flavoralm-venv/
 * - never downloads third-party model weights; FlavoraLM artifacts are trained locally
 * - everything binds to localhost/127.0.0.1; no secrets are printed
 */
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = platform() === "win32";
const API_PORT = Number(process.env.PORT || 4000);
const WEB_PORT = 5173;
let LM_PORT = Number(process.env.FLAVORA_LM_PORT || 5000);
const LM_HOST = "127.0.0.1";
const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const lmUrl = () => `http://127.0.0.1:${LM_PORT}`;
const VENV_DIR = path.join(ROOT, ".flavoralm-venv");
const ARTIFACTS_DIR = path.join(ROOT, "models", "flavora-lm", "v0.1");
const REQUIRED_ARTIFACTS = ["config.json", "tokenizer.json", "model.pt"];

const ok = (s) => console.log(`\x1b[32m\u2713\x1b[0m ${s}`);
const info = (s) => console.log(`  ${s}`);
const warn = (s) => console.log(`\x1b[33m!\x1b[0m ${s}`);
const fail = (s) => console.log(`\x1b[31m\u2717\x1b[0m ${s}`);

function banner() {
  console.log(`
========================================
              FLAVORA
       Local AI Food Companion
========================================
`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run a command inheriting stdio; resolves { code }. */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || ROOT,
      stdio: opts.stdio || "inherit",
      shell: IS_WIN, // npm is a .cmd shim on Windows
      env: process.env,
    });
    child.on("error", () => resolve({ code: 1 }));
    child.on("close", (code) => resolve({ code: code ?? 1 }));
  });
}

/** Buffered command execution returning stdout (for version checks). */
function execText(cmd, args, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, shell: IS_WIN }, (err, stdout) => {
      resolve({ ok: !err, out: String(stdout || "") });
    });
  });
}

/** TCP probe: is something listening on host:port? */
function tcpReachable(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: timeoutMs });
    const finish = (v) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(v);
    };
    socket.on("connect", () => finish(true));
    socket.on("timeout", () => finish(false));
    socket.on("error", () => finish(false));
  });
}

async function waitForTcp(host, port, timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 <= timeoutMs) {
    if (await tcpReachable(host, port, 1500)) return true;
    process.stdout.write(".");
    await sleep(500);
  }
  return false;
}

/** HTTP GET JSON with timeout (for /health polling). */
async function httpGetJson(url, timeoutMs = 5_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHealth(url, timeoutMs, predicate) {
  const t0 = Date.now();
  while (Date.now() - t0 <= timeoutMs) {
    const body = await httpGetJson(url);
    if (body && (!predicate || predicate(body))) return body;
    process.stdout.write(".");
    await sleep(1000);
  }
  return null;
}

/** HTTP POST JSON with timeout (for /intent inference verification). */
async function httpPostJson(url, body, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function depsInstalled() {
  // npm workspaces hoist packages to the root — check both nested and hoisted paths.
  const exists = (p) => fs.promises.access(p).then(() => true, () => false);
  const [serverPkgs, clientPkgs, rootPkgs] = await Promise.all([
    Promise.all([
      exists(path.join(ROOT, "server", "node_modules", "express")),
      exists(path.join(ROOT, "node_modules", "express")),
    ]).then(([a, b]) => a || b),
    Promise.all([
      exists(path.join(ROOT, "client", "node_modules", "vite")),
      exists(path.join(ROOT, "node_modules", "vite")),
    ]).then(([a, b]) => a || b),
    exists(path.join(ROOT, "node_modules", "prisma")),
  ]);
  return serverPkgs && clientPkgs && rootPkgs;
}

/** Create .env from the example when missing; never modify an existing one. */
function ensureEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (fs.existsSync(envPath)) {
    ok(".env found (existing configuration preserved)");
    return;
  }
  const examplePath = path.join(ROOT, ".env.example");
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    ok(".env created from .env.example");
  } else {
    warn(".env.example missing — continuing without .env (defaults apply)");
  }
}

function venvPython() {
  return IS_WIN
    ? path.join(VENV_DIR, "Scripts", "python.exe")
    : path.join(VENV_DIR, "bin", "python");
}

/** Find a usable system Python 3.11+ (only used to CREATE the venv). */
async function findSystemPython() {
  const candidates = IS_WIN
    ? ["py", "python", "python3"]
    : ["python3.11", "python3.12", "python3.13", "python3"];
  for (const c of candidates) {
    const args = c === "py" ? ["-3.11", "--version"] : ["--version"];
    const r = await execText(c, args, 10_000);
    if (r.ok) {
      const m = r.out.match(/Python (\d+)\.(\d+)/);
      if (m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 11))) {
        return { cmd: c, baseArgs: c === "py" ? ["-3.11"] : [] };
      }
    }
  }
  return null;
}

async function ensurePythonEnv() {
  console.log("\nPython environment");
  const venvPy = venvPython();
  if (fs.existsSync(venvPy)) {
    const check = await execText(venvPy, ["-c", "import torch, numpy; print(torch.__version__, numpy.__version__)"], 30_000);
    if (check.ok) {
      ok(`Python environment (.flavoralm-venv, torch+numpy ${check.out.trim()})`);
      return true;
    }
    info("Virtualenv exists but torch/numpy is missing — installing requirements…");
  } else {
    const sys = await findSystemPython();
    if (!sys) {
      fail("No Python 3.11+ found. Install Python 3.11+ (https://www.python.org/downloads) and run again.");
      return false;
    }
    info(`Creating local virtualenv (.flavoralm-venv) with ${sys.cmd}…`);
    const r = await run(sys.cmd, [...sys.baseArgs, "-m", "venv", VENV_DIR]);
    if (r.code !== 0 || !fs.existsSync(venvPy)) {
      fail("Could not create .flavoralm-venv. Create it manually: python3.11 -m venv .flavoralm-venv");
      return false;
    }
  }
  const req = path.join(ROOT, "training", "requirements.txt");
  info("Installing Python requirements into .flavoralm-venv (torch CPU — one time, ~200 MB)…");
  const r = await run(venvPy, ["-m", "pip", "install", "-r", req]);
  if (r.code !== 0) {
    fail("pip install failed. Run `.flavoralm-venv/bin/pip install -r training/requirements.txt` manually.");
    return false;
  }
  ok("Python environment ready");
  return true;
}

function checkArtifacts() {
  console.log("\nFlavoraLM");
  const missing = REQUIRED_ARTIFACTS.filter((f) => !fs.existsSync(path.join(ARTIFACTS_DIR, f)));
  if (missing.length > 0) {
    fail(`Model artifacts missing: ${missing.join(", ")}`);
    info(`Expected in ${ARTIFACTS_DIR}`);
    console.log(`
FlavoraLM model artifacts are missing.

Run:

npm run train:tokenizer
npm run train:llm

Then run:

npm run start
`);
    info("(Training runs locally from the synthetic corpus — no downloads, no pretrained weights.)");
    return null;
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, "config.json"), "utf-8"));
    const tok = JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, "tokenizer.json"), "utf-8"));
    ok(`Model artifacts (${cfg.model_name ?? "FlavoraLM"} v${cfg.version ?? "?"})`);
    ok(`Tokenizer (v${tok.version ?? "?"}, ${Object.keys(tok.vocab ?? {}).length} tokens)`);
    return cfg;
  } catch {
    warn("Artifacts present but unreadable — continuing; the service will report the error.");
    return {};
  }
}

async function openBrowser(url) {
  try {
    if (IS_WIN) spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    else if (platform() === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* best effort */
  }
}

async function setup() {
  banner();
  console.log("Checking environment...");

  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) {
    fail(`Node.js ${major} is too old. Flavora requires Node.js 20+.`);
    process.exit(1);
  }
  ok(`Node.js v${process.versions.node}`);

  const sys = await findSystemPython();
  if (!sys) {
    fail("No Python 3.11+ found. Install Python 3.11+ and run again.");
    process.exit(1);
  }
  const ver = await execText(sys.cmd, [...sys.baseArgs, "--version"], 10_000);
  ok(`Python ${ver.out.trim()}`);

  if (!(await depsInstalled())) {
    info("Installing npm dependencies (first run — this can take a minute)…");
    const r = await run("npm", ["install", "--no-audit", "--no-fund"]);
    if (r.code !== 0) {
      fail("npm install failed. Run `npm install` manually to see the full error.");
      process.exit(1);
    }
    ok("npm dependencies installed");
  } else {
    ok("npm dependencies");
  }

  ensureEnvFile();

  if (!(await ensurePythonEnv())) process.exit(1);

  info("Syncing database schema (non-destructive)…");
  const dbPush = await run("npx", ["prisma", "db", "push", "--schema", "prisma/schema.prisma", "--skip-generate"], { stdio: "pipe" });
  if (dbPush.code !== 0) {
    fail("prisma db push failed. Run `npx prisma db push --schema prisma/schema.prisma` to see the error.");
    process.exit(1);
  }
  ok("SQLite database ready");

  info("Seeding recipe data (idempotent upserts — never deletes)…");
  const seed = await run("npm", ["run", "db:seed"], { stdio: "pipe" });
  if (seed.code !== 0) {
    fail("Database seed failed. Run `npm run db:seed` to see the error.");
    process.exit(1);
  }
  ok("Recipe data seeded");

  const cfg = checkArtifacts();
  if (!cfg) process.exit(1);
}

async function launch() {
  console.log("\nStarting services...\n");
  const children = [];

  const spawnTracked = (cmd, args, tag) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: "pipe", shell: IS_WIN, env: process.env });
    const prefix = `\x1b[2m[${tag}]\x1b[0m `;
    child.stdout.on("data", (d) => process.stdout.write(`${prefix}${d}`));
    child.stderr.on("data", (d) => process.stderr.write(`${prefix}${d}`));
    children.push(child);
    return child;
  };

  // 1. FlavoraLM inference service (our model, local only).
  // NOTE: macOS AirPlay Receiver also uses port 5000 — so an open TCP port
  // means nothing until /health identifies itself as FlavoraLM.
  // Design: the app keeps running when FlavoraLM is down (heuristic fallback
  // with an honest notice) — but the status below must NEVER claim FlavoraLM
  // is running when it is not.
  let lmReady = false;
  let lmSummary = "";
  const existing = await httpGetJson(`${lmUrl()}/health`, 3_000);
  if (existing?.loaded === true && /^flavoraLM/i.test(String(existing.model ?? ""))) {
    ok(`FlavoraLM already running at ${lmUrl()} (${existing.model} v${existing.version})`);
    lmReady = true;
    lmSummary = `${existing.model} v${existing.version}, ${existing.parameterCount} params, ${existing.device}`;
  } else {
    if (await tcpReachable(LM_HOST, LM_PORT, 1500)) {
      warn(`Port ${LM_PORT} is occupied by something that is not FlavoraLM (macOS AirPlay uses :5000).`);
      // Auto-fallback: try the next free loopback ports so one command still
      // works. The chosen port is exported to children (Express included).
      let fallback = 0;
      for (let p = LM_PORT + 1; p <= LM_PORT + 10; p++) {
        if (!(await tcpReachable(LM_HOST, p, 500))) {
          fallback = p;
          break;
        }
      }
      if (fallback) {
        LM_PORT = fallback;
        process.env.FLAVORA_LM_PORT = String(fallback);
        process.env.FLAVORA_LM_HOST = `http://127.0.0.1:${fallback}`;
        ok(`Using FlavoraLM port ${fallback} instead (Express notified via FLAVORA_LM_HOST).`);
      } else {
        warn("No free fallback port nearby — set FLAVORA_LM_PORT to a free port, or disable AirPlay Receiver, then re-run.");
      }
    }
    info("Starting FlavoraLM inference service…");
    spawnTracked(venvPython(), ["-m", "training.flavora_lm.service", "--host", LM_HOST, "--port", String(LM_PORT)], "flavoralm");
    process.stdout.write("  Waiting for FlavoraLM /health ");
    const health = await waitForHealth(`${lmUrl()}/health`, 90_000, (b) => b.loaded === true);
    console.log("");
    if (!health) {
      fail(`FlavoraLM did not become ready at ${lmUrl()}. See [flavoralm] logs above.`);
      fail("App continues with heuristic intent parsing (AI unavailable notice shown in UI).");
      fail("Fix with `npm run train:llm:dev` if artifacts are stale, then re-run.");
    } else {
      ok(`FlavoraLM loaded (${health.model} v${health.version}, ${health.parameterCount} params, ${health.device})`);
      lmReady = true;
      lmSummary = `${health.model} v${health.version}, ${health.parameterCount} params, ${health.device}`;
    }
  }
  // Inference readiness (not just /health): prove POST /intent runs the
  // model before claiming FlavoraLM is serving requests.
  // /health=true but valid:false means the runtime is up yet the model could
  // not extract intent — honest warn, not a verified pass.
  if (lmReady) {
    process.stdout.write("  Verifying FlavoraLM inference (POST /intent) ");
    const inference = await httpPostJson(`${lmUrl()}/intent`, { text: "I want chicken and rice" }, 60_000);
    console.log("");
    if (inference && inference.valid === true) {
      ok(`FlavoraLM inference verified (valid:true, model extracted intent)`);
    } else if (inference && inference.valid === false) {
      warn("FlavoraLM /health is up but POST /intent returned valid:false — model answered but extracted nothing usable. UI will show honest fallback notices (local-invalid) until inference improves.");
      warn("Tip: run `npm run verify:local-ai` for the full 8-step check, or `npm run train:llm:dev` to improve the checkpoint.");
    } else {
      warn("FlavoraLM /health is up but POST /intent did not answer — UI will show honest fallback notices until inference works.");
    }
  }

  // 2 + 3. Express API + Vite website.
  spawnTracked("npm", ["run", "dev:server"], "api");
  spawnTracked("npm", ["run", "dev:client"], "web");

  process.stdout.write("  Waiting for services ");
  const apiUp = await waitForTcp("localhost", API_PORT, 60_000);
  const webUp = await waitForTcp("localhost", WEB_PORT, 60_000);
  console.log("");
  const lmLine = lmReady
    ? `\x1b[32m✓\x1b[0m FlavoraLM   ${lmUrl()} (${lmSummary})`
    : `\x1b[31m✗\x1b[0m FlavoraLM   ${lmUrl()}  NOT running — heuristic fallback (AI unavailable notice in UI)`;

  console.log(`
${lmLine}
\x1b[32m✓\x1b[0m API         ${API_URL}${apiUp ? "" : "  (still starting — see logs below)"}
\x1b[32m✓\x1b[0m Website     ${WEB_URL}${webUp ? "" : "  (still starting — see logs below)"}
`);

  if (webUp && process.env.FLAVORA_NO_OPEN !== "1") {
    console.log("Opening Flavora...");
    await openBrowser(WEB_URL);
  }

  const cleanup = () => {
    for (const c of children) {
      try { c.kill(); } catch { /* */ }
    }
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  // Keep the process alive while services run.
  await new Promise(() => {});
}

const setupOnly = process.env.FLAVORA_SETUP_ONLY === "1" || process.argv.slice(2).includes("--setup-only");

setup()
  .then(() => (setupOnly ? undefined : launch()))
  .catch((e) => {
    fail(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
