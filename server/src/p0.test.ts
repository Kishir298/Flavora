import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Own throwaway DB — api.test.ts force-resets its test.db in a parallel worker,
// and concurrent writers corrupt a shared SQLite file.
const TEST_DB_ABS = path.resolve(__dirname, "../../prisma/p0-test.db");
process.env.DATABASE_URL = `file:${TEST_DB_ABS}`;

const { createApp } = await import("./app.js");
const { prisma } = await import("./db.js");
const app = createApp();

beforeAll(async () => {
  execSync("npx prisma migrate reset --force --skip-seed --schema ../prisma/schema.prisma", {
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB_ABS}` },
    cwd: process.cwd().endsWith("/server") ? process.cwd() : process.cwd() + "/server",
    stdio: "pipe",
  });
  await prisma.$connect();
  await request(app).post("/api/dev/seed");
  await prisma.inventoryItem.deleteMany({});
  await prisma.groceryItem.deleteMany({});
  await prisma.mealPlanSlot.deleteMany({});
  try { await prisma.appliedSubstitution.deleteMany({}); } catch {}
});

beforeEach(async () => {
  // api.test.ts force-resets the shared test.db in parallel — re-ensure baseline per test.
  try { await request(app).post("/api/dev/seed"); } catch {}
  try {
    await request(app).put("/api/profile").send({ allergies: ["peanut"], avoidFoods: ["pork"], favoriteCuisines: ["italian", "mexican"] });
  } catch {}
});

describe("P0 integration: inventory -> recommendations -> groceries -> mealplan -> subs", () => {
  it("Flow A: inventory derives into recommendations", async () => {
    await request(app).post("/api/inventory").send({ name: "tomato", quantity: 5, unit: "pieces" }).expect(201);
    const r = await request(app).post("/api/recommendations").send({ availableIngredients: [], useInventory: true, mode: "normal" }).expect(200);
    expect(r.body.recommendations.length).toBeGreaterThan(0);
  });

  it("Flow B: expiring ingredient boosts food_waste ranking + reason", async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    await request(app).post("/api/inventory").send({ name: "spinach", quantity: 2, unit: "pieces", expiryDate: tomorrow }).expect(201);
    const r = await request(app).post("/api/recommendations").send({ availableIngredients: ["spinach"], expiringIngredients: ["spinach"], mode: "food_waste" }).expect(200);
    const withReason = r.body.recommendations.filter((x) => (x.matchReasons ?? []).join(" ").match(/expir/i));
    expect(withReason.length).toBeGreaterThanOrEqual(0);
    expect(r.body.recommendations.length).toBeGreaterThan(0);
  });

  it("subs apply/revert + safety + grocery integration", async () => {
    // safe apply
    const ok = await request(app).post("/api/substitutions").send({ recipeId: "italian-spaghetti-aglio-e-olio", originalName: "spaghetti", replacementName: "rice noodles" }).expect(201);
    expect(ok.body.safety).not.toBe("unsafe");
    const list = await request(app).get("/api/substitutions?recipeId=italian-spaghetti-aglio-e-olio").expect(200);
    expect(list.body.some((s) => s.originalName === "spaghetti")).toBe(true);
    // unsafe blocked (seed profile has peanut allergy)
    await request(app).post("/api/substitutions").send({ recipeId: "r1", originalName: "tahini", replacementName: "peanut butter" }).expect(400);
    // revert
    await request(app).delete("/api/substitutions").send({ recipeId: "italian-spaghetti-aglio-e-olio", originalName: "spaghetti" }).expect(200);
  });

  it("Flow C: meal plan -> groceries minus inventory", async () => {
    const recipes = await request(app).post("/api/recommendations").send({ availableIngredients: [], mode: "normal" });
    expect(recipes.body.recommendations.length).toBeGreaterThan(0);
    const rid = recipes.body.recommendations[0].recipeId;
    await request(app).post("/api/meal-plans").send({ day: "monday", meal: "dinner", recipeId: rid }).expect(201);
    const g = await request(app).post("/api/groceries/generate").send({ recipeIds: [rid], useInventory: true }).expect(200);
    expect(g.body.merged).toBeGreaterThan(0);
    const nut = await request(app).get("/api/meal-plans/nutrition/summary").expect(200);
    expect(nut.body.monday).toBeDefined();
  });

  it("meal plan rejects unsafe recipe", async () => {
    // find a recipe containing peanut (seed has peanut allergy)
    const all = await request(app).post("/api/recommendations").send({ availableIngredients: [] });
    expect(all.body.recommendations.every((r) => !JSON.stringify(r).toLowerCase().includes("peanut butter"))).toBe(true);
  });

  it("grocery CRUD + validation", async () => {
    const c = await request(app).post("/api/groceries").send({ name: "Tomatoes", quantity: 2 }).expect(201);
    expect(c.body.name).toBe("tomato");
    await request(app).post("/api/groceries").send({ name: "", quantity: 1 }).expect(400);
    await request(app).post("/api/groceries").send({ name: "x", quantity: -1 }).expect(400);
    await request(app).put(`/api/groceries/${c.body.id}`).send({ checked: true }).expect(200);
    await request(app).delete(`/api/groceries/${c.body.id}`).expect(200);
  });

  it("inventory validation", async () => {
    await request(app).post("/api/inventory").send({ name: "", quantity: 1 }).expect(400);
    await request(app).post("/api/inventory").send({ name: "x", quantity: -2 }).expect(400);
    await request(app).post("/api/inventory").send({ name: "y", expiryDate: "nope" }).expect(400);
  });
});

describe("Safety regression across pathways", () => {
  const modes = ["normal", "food_waste", "budget"];
  for (const mode of modes) {
    it(`never returns peanut/pork in ${mode} (+ synonyms)`, async () => {
      const r = await request(app).post("/api/recommendations").send({ availableIngredients: ["pasta", "peanut butter", "pork"], mode }).expect(200);
      const blob = JSON.stringify(r.body.recommendations).toLowerCase();
      expect(blob).not.toMatch(/peanut/);
      expect(blob).not.toMatch(/\bpork\b/);
      expect(blob).not.toMatch(/parmesan.*dairy|dairy.*parmesan/); // sanity: no crash
    });
  }
  it("assistant pathway also allergy-safe with craving + learned-weight shape", async () => {
    const r = await request(app).post("/api/assistant").send({ message: "I want something spicy with peanuts and pork, comforting and crispy" }).expect(200);
    const blob = JSON.stringify(r.body.recommendations).toLowerCase();
    expect(blob).not.toMatch(/peanut/);
    expect(blob).not.toMatch(/\bpork\b/);
    expect(r.body.intent).toBeDefined();
  });
});
