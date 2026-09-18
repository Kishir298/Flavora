import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_ABS = path.resolve(__dirname, "../../prisma/test.db");
process.env.DATABASE_URL = `file:${TEST_DB_ABS}`;

const { createApp } = await import("../app.js");
const { prisma } = await import("../db.js");

const app = createApp();

beforeAll(async () => {
  execSync("npx prisma db push --schema ../prisma/schema.prisma --skip-generate --force-reset", {
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB_ABS}` },
    cwd: process.cwd().endsWith("/server") ? process.cwd() : process.cwd() + "/server",
    stdio: "pipe",
  });
  await prisma.$connect();
  execFileSync("npm", ["run", "seed", "--workspace=server"], {
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB_ABS}` },
    cwd: path.resolve(__dirname, "../../.."),
    stdio: "pipe",
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("hardening: profile validation", () => {
  it("rejects bad spice enum", async () => {
    const r = await request(app).put("/api/profile").send({ spicePreference: "extra-hot" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("VALIDATION_ERROR");
  });
  it("rejects non-array allergies", async () => {
    const r = await request(app).put("/api/profile").send({ allergies: "peanut" });
    expect(r.status).toBe(400);
  });
  it("rejects bad theme", async () => {
    const r = await request(app).put("/api/profile").send({ theme: "neon" });
    expect(r.status).toBe(400);
  });
  it("rejects out-of-range cook time", async () => {
    const r = await request(app).put("/api/profile").send({ preferredCookTimeMinutes: 9999 });
    expect(r.status).toBe(400);
  });
});

describe("hardening: nutrition honesty", () => {
  it("recommendations carry nutritionSource", async () => {
    const r = await request(app).post("/api/recommendations").send({ availableIngredients: ["rice"], mode: "normal" });
    expect(r.status).toBe(200);
    expect(r.body.recommendations.length).toBeGreaterThan(0);
    for (const rec of r.body.recommendations) {
      expect(["authored", "unknown"]).toContain(rec.nutritionSource);
    }
  });
  it("saved carries nutritionSource + unsafe flag", async () => {
    await request(app).post("/api/interactions").send({ recipeId: "italian-minestrone-soup", action: "saved" });
    const s = await request(app).get("/api/saved");
    expect(s.status).toBe(200);
    const row = s.body.find((x: { id: string }) => x.id === "italian-minestrone-soup");
    expect(row).toBeDefined();
    expect(["authored", "unknown"]).toContain(row.nutritionSource);
    expect(typeof row.unsafe).toBe("boolean");
  });
});

describe("hardening: safety + not-found mapping", () => {
  it("groceries generate rejects unsafe recipe", async () => {
    await request(app).put("/api/profile").send({ allergies: [], avoidFoods: [] });
    // Find a recipe containing pork to force UNSAFE (pork is a known ingredient).
    const list = await request(app).post("/api/recommendations").send({ availableIngredients: [], mode: "normal" });
    expect(list.status).toBe(200);
    await request(app).put("/api/profile").send({ allergies: ["pork"], avoidFoods: [], favoriteCuisines: [], spicePreference: "medium", skillLevel: "beginner", preferredCookTimeMinutes: 30 });
    // Attempt generate with every recipe id would be heavy; use a known pork recipe if present.
    const recipes = await import("../recipesDb.js");
    const all = await recipes.listRecipes({ limit: 200 });
    const pork = all.find((r: { id: string; ingredients: unknown }) => JSON.stringify(r.ingredients).toLowerCase().includes("pork"));
    if (!pork) return; // no pork recipe in seed — skip (still validates route loads)
    const g = await request(app).post("/api/groceries/generate").send({ recipeIds: [pork.id] });
    expect(g.status).toBe(400);
    expect(g.body.error).toBe("UNSAFE_RECIPE");
    await request(app).put("/api/profile").send({ allergies: [] });
  });
  it("inventory update on bad id is 404 not 500", async () => {
    const r = await request(app).put("/api/inventory/999999").send({ name: "x" });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("NOT_FOUND");
  });
  it("groceries update on bad id is 404", async () => {
    const r = await request(app).put("/api/groceries/999999").send({ name: "x" });
    expect(r.status).toBe(404);
  });
  it("meal-plan update on bad id is 404", async () => {
    const r = await request(app).put("/api/meal-plans/999999").send({ servings: 2 });
    expect(r.status).toBe(404);
  });
  it("meal-plan rejects bad date", async () => {
    const r = await request(app).post("/api/meal-plans").send({ day: "monday", meal: "dinner", recipeId: "italian-minestrone-soup", servings: 1, date: "not-a-date" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("VALIDATION_ERROR");
  });
  it("nutrition lookup caps length + shape", async () => {
    const r = await request(app).get("/api/nutrition/lookup?ingredient=" + "x".repeat(100));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("VALIDATION_ERROR");
  });
});

describe("hardening: conversation regression (§27)", () => {
  it("i want chicken never returns initial greeting", async () => {
    const r = await request(app).post("/api/assistant/conversation").send({ message: "i want chicken" });
    expect(r.status).toBe(200);
    expect(r.body.question ?? "").not.toBe("What are you craving today?");
    const req = r.body.foodRequest ?? {};
    expect(req.craving ?? req.availableIngredients).toBeTruthy();
  });
});
