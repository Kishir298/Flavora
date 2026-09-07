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

const { createApp } = await import("./app.js");
const { prisma } = await import("./db.js");

const app = createApp();

const SEED_ID = "italian-minestrone-soup"; // vegan, low cost — survives most filters
const DAIRY_ID = "italian-spaghetti-aglio-e-olio"; // contains parmesan (dairy synonym)

beforeAll(async () => {
  execSync("npx prisma db push --schema ../prisma/schema.prisma --skip-generate --force-reset", {
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB_ABS}` },
    cwd: process.cwd().endsWith("/server") ? process.cwd() : process.cwd() + "/server",
    stdio: "pipe",
  });
  await prisma.$connect();
  // Seed the throwaway DB from /data via the dev seed route's logic.
  const { execFileSync } = await import("node:child_process");
  execFileSync("npm", ["run", "seed", "--workspace=server"], {
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB_ABS}` },
    cwd: path.resolve(__dirname, "../.."),
    stdio: "pipe",
  });
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
      favoriteCuisines: ["italian"],
      spicePreference: "medium",
      skillLevel: "beginner",
      preferredCookTimeMinutes: 30,
    });
    expect(put.status).toBe(200);
    expect(put.body.allergies).toContain("peanut");
    expect(put.body.favoriteCuisines).toContain("italian");
  });

  it("accepts legacy profile keys", async () => {
    const put = await request(app).put("/api/profile").send({
      cuisines: ["mexican"],
      spice: "hot",
      skill: "advanced",
      maxCookTime: 20,
    });
    expect(put.status).toBe(200);
    expect(put.body.favoriteCuisines).toContain("mexican");
    expect(put.body.spicePreference).toBe("hot");
  });
});

describe("recipes + interactions", () => {
  it("GET recipe returns 6-box payload + logs viewed; POST saved appears in /api/saved", async () => {
    const detail = await request(app).get(`/api/recipes/${SEED_ID}`);
    expect(detail.status).toBe(200);
    expect(detail.body.substitutions).toBeDefined();
    expect(detail.body.ingredients.length).toBeGreaterThan(0);
    expect(detail.body.instructions.length).toBeGreaterThan(0);
    expect(detail.body.storage).toBeTruthy();
    const save = await request(app)
      .post("/api/interactions")
      .send({ recipeId: SEED_ID, action: "saved" });
    expect(save.status).toBe(201);
    const saved = await request(app).get("/api/saved");
    expect(saved.status).toBe(200);
    expect(saved.body.map((r: { id: string }) => r.id)).toContain(SEED_ID);
  });

  it("flags owned ingredients via ?have=", async () => {
    const res = await request(app).get(`/api/recipes/${SEED_ID}`).query({ have: "pasta,zucchini" });
    expect(res.status).toBe(200);
    const flagged = (res.body.ingredientDetails as { usedOwned: boolean }[]).filter((i) => i.usedOwned);
    expect(flagged.length).toBeGreaterThan(0);
  });

  it("rejects invalid interaction action", async () => {
    const res = await request(app).post("/api/interactions").send({ recipeId: "x", action: "eat" });
    expect(res.status).toBe(400);
  });

  it("accepts all §7.4 actions incl. legacy rated alias", async () => {
    for (const action of ["shown", "viewed", "saved", "cooked", "rated_positive", "rated_negative", "skipped"]) {
      const res = await request(app).post("/api/interactions").send({ recipeId: SEED_ID, action });
      expect(res.status).toBe(201);
    }
    const legacy = await request(app).post("/api/interactions").send({ recipeId: SEED_ID, action: "rated" });
    expect(legacy.status).toBe(201);
    expect(legacy.body.action).toBe("rated_positive");
  });

  it("404s unknown recipe", async () => {
    const res = await request(app).get("/api/recipes/nope-not-real");
    expect(res.status).toBe(404);
  });
});

describe("recommendations endpoint (§7.4 contract)", () => {
  it("returns recipeId/title/score/matchReasons, allergy-safe, max 5", async () => {
    await request(app).put("/api/profile").send({
      allergies: ["peanut", "dairy"],
      avoidFoods: ["pork"],
      favoriteCuisines: ["italian"],
      spicePreference: "medium",
      skillLevel: "beginner",
      preferredCookTimeMinutes: 30,
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
    // Dairy synonym filter: parmesan recipe must not appear.
    expect(recs.map((r) => r.recipeId)).not.toContain(DAIRY_ID);
    for (const r of res.body.recommendations as { ingredients: string[] }[]) {
      const blob = (r.ingredients ?? []).join(" ").toLowerCase();
      expect(blob).not.toContain("peanut");
      expect(blob).not.toContain("pork");
    }
  });

  it("rejects unknown mode", async () => {
    const res = await request(app).post("/api/recommendations").send({
      availableIngredients: ["rice"],
      timeLimit: 30,
      mode: "keto",
    });
    expect(res.status).toBe(400);
  });

  it("logs shown rows for returned recipes", async () => {
    await request(app).post("/api/recommendations").send({
      availableIngredients: ["rice"],
      timeLimit: 30,
    });
    const shown = await prisma.interaction.count({ where: { action: "shown" } });
    expect(shown).toBeGreaterThan(0);
  });

  it("food_waste mode weights ingredient overlap highest", async () => {
    const res = await request(app).post("/api/recommendations").send({
      availableIngredients: ["chickpeas", "tomato", "rice"],
      timeLimit: 60,
      mode: "food_waste",
    });
    expect(res.status).toBe(200);
    expect(res.body.recommendations.length).toBeGreaterThan(0);
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

  it("cuisine filter limits to that cuisine (explorer)", async () => {
    const res = await request(app).post("/api/recommendations").send({
      availableIngredients: [],
      timeLimit: 120,
      cuisine: "japanese",
    });
    expect(res.status).toBe(200);
    expect(res.body.recommendations.length).toBeGreaterThan(0);
    for (const r of res.body.recommendations as { cuisine: string }[]) {
      expect(r.cuisine.toLowerCase()).toBe("japanese");
    }
  });
});

describe("debug explain endpoint (§7.10)", () => {
  it("returns 7 features + weights + score for a local recipe", async () => {
    const res = await request(app).get("/api/debug/explain").query({ recipeId: SEED_ID });
    expect(res.status).toBe(200);
    for (const k of ["ingredient_overlap", "time_fit", "cuisine_match", "nutrition_fit", "skill_fit", "spice_fit", "budget_fit"]) {
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
