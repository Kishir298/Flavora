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

describe("recommend endpoint (allergy-safe)", () => {
  it("never returns allergen-violating recipes", async () => {
    await request(app).put("/api/profile").send({
      allergies: ["peanut", "milk"],
      avoidFoods: ["pork"],
      cuisines: [],
      spice: "medium",
      maxCookTime: 30,
    });
    const res = await request(app).post("/api/recommend").send({
      ingredients: ["pasta", "rice"],
      maxTime: 30,
      craving: "pasta",
    });
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.results.length).toBeLessThanOrEqual(5);
    for (const r of res.body.results as { ingredients: string[] }[]) {
      const blob = r.ingredients.join(" ").toLowerCase();
      expect(blob).not.toContain("peanut");
      expect(blob).not.toContain("milk");
      expect(blob).not.toContain("pork");
    }
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
});
