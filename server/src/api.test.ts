import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

// Use throwaway test DB — never the real dev.db. Must be set BEFORE prisma import
// (static imports hoist, so we resolve absolute path + use dynamic imports below).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_ABS = path.resolve(__dirname, "../../prisma/test.db");
process.env.DATABASE_URL = `file:${TEST_DB_ABS}`;
process.env.USE_MOCK_RECIPES = "true";

const { createApp } = await import("./app.js");
const { prisma } = await import("./db.js");

const app = createApp();

beforeAll(async () => {
  execSync("npx prisma db push --schema ../prisma/schema.prisma --skip-generate --force-reset", {
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB_ABS}` },
    cwd: process.cwd().endsWith("/server") ? process.cwd() : process.cwd() + "/server",
    stdio: "pipe",
  });
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("profile CRUD", () => {
  it("GET creates default + PUT updates allergies", async () => {
    const get = await request(app).get("/api/profile");
    expect(get.status).toBe(200);
    const put = await request(app).put("/api/profile").send({
      allergies: ["peanut", "milk"],
      avoidFoods: ["pork"],
      cuisines: ["italian"],
      spice: "medium",
      maxCookTime: 30,
    });
    expect(put.status).toBe(200);
    expect(put.body.allergies).toContain("peanut");
  });
});

describe("recipes + interactions", () => {
  it("GET recipe logs viewed + POST saved appears in /api/saved", async () => {
    const detail = await request(app).get("/api/recipes/mock:1");
    expect(detail.status).toBe(200);
    expect(detail.body.substitutions).toBeDefined();
    const save = await request(app)
      .post("/api/interactions")
      .send({ recipeId: "mock:1", action: "saved" });
    expect(save.status).toBe(201);
    const saved = await request(app).get("/api/saved");
    expect(saved.status).toBe(200);
    expect(saved.body.map((r: { id: string }) => r.id)).toContain("mock:1");
  });

  it("rejects invalid interaction action", async () => {
    const res = await request(app).post("/api/interactions").send({ recipeId: "x", action: "eat" });
    expect(res.status).toBe(400);
  });

  it("accepts guide actions incl. legacy rated alias", async () => {
    for (const action of ["shown", "rated_positive", "rated_negative", "skipped"]) {
      const res = await request(app).post("/api/interactions").send({ recipeId: "mock:2", action });
      expect(res.status).toBe(201);
    }
    const legacy = await request(app).post("/api/interactions").send({ recipeId: "mock:2", action: "rated" });
    expect(legacy.status).toBe(201);
    expect(legacy.body.action).toBe("rated_positive");
  });
});

describe("recommendations endpoint (guide contract)", () => {
  it("returns recipeId/title/score/matchReasons, allergy-safe, max 5", async () => {
    await request(app).put("/api/profile").send({
      allergies: ["peanut", "dairy"],
      avoidFoods: ["pork"],
      cuisines: ["italian"],
      spice: "medium",
      maxCookTime: 30,
    });
    const res = await request(app).post("/api/recommendations").send({
      availableIngredients: ["pasta", "tomato"],
      timeLimit: 30,
      mode: "normal",
    });
    expect(res.status).toBe(200);
    const recs = res.body.recommendations as { recipeId: string; title: string; score: number; matchReasons: string[] }[];
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.length).toBeLessThanOrEqual(5);
    for (const r of recs) {
      expect(r.recipeId).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(typeof r.score).toBe("number");
      expect(r.matchReasons.length).toBeGreaterThan(0);
    }
    // Dairy synonym filter: milk/parmesan/feta recipes must not appear.
    expect(recs.map((r) => r.recipeId)).not.toContain("mock:4");
    expect(recs.map((r) => r.recipeId)).not.toContain("mock:10");
    for (const r of res.body.recommendations as { ingredients: string[] }[]) {
      const blob = (r.ingredients ?? []).join(" ").toLowerCase();
      expect(blob).not.toContain("peanut");
      expect(blob).not.toContain("pork");
    }
  });

  it("logs shown rows for returned recipes", async () => {
    await request(app).post("/api/recommendations").send({
      availableIngredients: ["rice"],
      timeLimit: 30,
    });
    const shown = await prisma.interaction.count({ where: { action: "shown" } });
    expect(shown).toBeGreaterThan(0);
  });

  it("budget mode returns scored recommendations", async () => {
    const res = await request(app).post("/api/recommendations").send({
      availableIngredients: ["pasta"],
      timeLimit: 30,
      mode: "budget",
    });
    expect(res.status).toBe(200);
    expect(res.body.recommendations.length).toBeGreaterThan(0);
  });
});

describe("debug explain endpoint", () => {
  it("returns features + weights + score for a cached recipe", async () => {
    await request(app).get("/api/recipes/mock:1");
    const res = await request(app).get("/api/debug/explain").query({ recipeId: "mock:1" });
    expect(res.status).toBe(200);
    for (const k of ["ingredient_overlap", "cuisine_match", "time_fit", "nutrition_fit", "spice_fit", "budget_fit"]) {
      expect(typeof res.body.features[k]).toBe("number");
      expect(typeof res.body.weights[k]).toBe("number");
    }
    expect(typeof res.body.score).toBe("number");
  });

  it("400s without recipeId", async () => {
    const res = await request(app).get("/api/debug/explain");
    expect(res.status).toBe(400);
  });
});
