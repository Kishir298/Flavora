import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "retrain.py");
const FEATURES = ["ingredient_overlap", "time_fit", "cuisine_match", "nutrition_fit", "skill_fit", "spice_fit", "budget_fit"];

const SETUP_SQL = `
CREATE TABLE interactions (id INTEGER PRIMARY KEY, user_id TEXT DEFAULT 'local', recipe_id TEXT, action TEXT, rating INTEGER, features TEXT DEFAULT '{}', timestamp TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE recommendation_weights (user_id TEXT DEFAULT 'local', feature_name TEXT, weight_value REAL, updated_at TEXT, PRIMARY KEY (user_id, feature_name));
`;

function makeDb(rows) {
  // rows: [{recipeId, action, features|null}]
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flavora-retrain-"));
  const db = path.join(dir, "t.db");
  const setup = path.join(dir, "setup.sql");
  const lines = [SETUP_SQL];
  for (const r of rows) {
    const feat = r.features ? `'${JSON.stringify(r.features).replace(/'/g, "''")}'` : "'{}'";
    lines.push(`INSERT INTO interactions (recipe_id, action, features) VALUES ('${r.recipeId}','${r.action}',${feat});`);
  }
  fs.writeFileSync(setup, lines.join("\n"));
  execFileSync("python3", ["-c", `import sqlite3;db=sqlite3.connect(${JSON.stringify(db)});db.executescript(open(${JSON.stringify(setup)}).read());db.commit()`]);
  return db;
}

function run(db, extra = []) {
  try {
    const out = execFileSync("python3", [SCRIPT, "--db", db, ...extra], { encoding: "utf8" });
    return { code: 0, json: JSON.parse(out) };
  } catch (e) {
    return { code: e.status ?? 1, json: JSON.parse(String(e.stdout || "{}")) };
  }
}

const vec = (v) => Object.fromEntries(FEATURES.map((k) => [k, v]));

describe("engine/retrain.py", () => {
  it("refuses below the minimum data threshold without touching weights", () => {
    const db = makeDb([
      { recipeId: "r1", action: "shown", features: vec(0.5) },
      { recipeId: "r1", action: "saved", features: null },
    ]);
    const r = run(db);
    expect(r.code).toBe(2);
    expect(r.json.status).toBe("refused");
    expect(r.json.positive).toBe(1);
  });

  it("produces a valid normalized weight set on synthetic data (or reports missing sklearn)", () => {
    const rows = [];
    for (let i = 0; i < 16; i++) {
      rows.push({ recipeId: `pos${i}`, action: "shown", features: { ...vec(0.2), ingredient_overlap: 0.9 } });
      rows.push({ recipeId: `pos${i}`, action: "saved", features: null });
    }
    for (let i = 0; i < 6; i++) {
      rows.push({ recipeId: `neg${i}`, action: "shown", features: { ...vec(0.8), ingredient_overlap: 0.1 } });
      rows.push({ recipeId: `neg${i}`, action: "skipped", features: null });
    }
    const db = makeDb(rows);
    const r = run(db, ["--dry-run"]);
    if (r.json.status === "error") {
      // No sklearn in this environment — the threshold gate passing is the assertion.
      expect(r.json.reason).toMatch(/scikit-learn/);
      return;
    }
    expect(r.code).toBe(0);
    expect(r.json.status).toBe("ok");
    const names = Object.keys(r.json.weights).sort();
    expect(names).toEqual([...FEATURES].sort());
    const sum = Object.values(r.json.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });
});
