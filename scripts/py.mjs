#!/usr/bin/env node
/**
 * Run the local FlavoraLM virtualenv Python with forwarded args (cross-platform).
 * Usage: node scripts/py.mjs -m training.train --config training/configs/flavora_lm_small.json
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const venvPy =
  platform() === "win32"
    ? path.join(ROOT, ".flavoralm-venv", "Scripts", "python.exe")
    : path.join(ROOT, ".flavoralm-venv", "bin", "python");

if (!fs.existsSync(venvPy)) {
  console.error("Missing .flavoralm-venv — run `npm run setup` first (it creates the local Python environment).");
  process.exit(1);
}

const child = spawn(venvPy, process.argv.slice(2), { cwd: ROOT, stdio: "inherit" });
child.on("error", (e) => {
  console.error(String(e));
  process.exit(1);
});
child.on("close", (code) => process.exit(code ?? 1));
