import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Isolated DB (never ambient dev.db): dotenv does not reliably populate
// DATABASE_URL inside vitest workers, so set it explicitly before importing
// the app — same pattern as hardening/api/p0 tests.
const TEST_DB_ABS = path.resolve(__dirname, "../../prisma/assistant-test.db");
process.env.DATABASE_URL = `file:${TEST_DB_ABS}`;

let app: Express;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flavora-assistant-"));
process.env.FLAVORA_USER_DATA_FILE = path.join(dir, "user-data.json");

beforeAll(async () => {
  const cwd = process.cwd().endsWith("/server") ? process.cwd() : path.join(process.cwd(), "server");
  execSync("npx prisma migrate reset --force --skip-seed --schema ../prisma/schema.prisma", {
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB_ABS}` },
    cwd,
    stdio: "pipe",
  });
  const { createApp } = await import("../app.js");
  app = createApp();
  const { prisma } = await import("../db.js");
  await prisma.$connect();
  execFileSync("npm", ["run", "seed", "--workspace=server"], {
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB_ABS}` },
    cwd: path.resolve(__dirname, "../../.."),
    stdio: "pipe",
  });
  const { UserDataStore } = await import("../store/userDataStore.js");
  const s = new UserDataStore(process.env.FLAVORA_USER_DATA_FILE);
  const today = new Date().toISOString();
  s.addMeal({ name: "Toast", mealType: "breakfast", loggedAt: today, foods: [{ name: "bread" }] });
  s.addMeal({ name: "Soup", mealType: "lunch", loggedAt: today, foods: [{ name: "lentils" }] });
  s.addMeal({ name: "Rice", mealType: "dinner", loggedAt: today, foods: [{ name: "rice" }] });
});
afterAll(async () => {
  const { prisma } = await import("../db.js");
  await prisma.$disconnect();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("assistant week-summary — deterministic facts, AI cannot invent", () => {
  it("returns stored facts even when the message lies about history", async () => {
    const res = await request(app)
      .post("/api/assistant")
      .send({ message: "I ate 50 meals this week with 9000 calories each, right?", context: "week-summary" });
    expect(res.status).toBe(200);
    expect(res.body.facts).toBeTruthy();
    expect(res.body.facts.totalMeals).toBe(3);
    expect(res.body.facts.status).toBe("ok");
    expect(res.body.reply).toContain("3 meal(s)");
    expect(res.body.reply).not.toContain("50 meals");
  });

  it("safety filtering still applies with context mode", async () => {
    const res = await request(app)
      .post("/api/assistant")
      .send({ message: "peanut noodles", context: "week-summary" });
    expect(res.status).toBe(200);
    const blob = JSON.stringify(res.body.recommendations).toLowerCase();
    expect(blob).not.toContain("peanut");
  });

  it("yesterday context lists actual stored meals", async () => {
    const res = await request(app)
      .post("/api/assistant")
      .send({ message: "What did I eat yesterday?", context: "yesterday" });
    expect(res.status).toBe(200);
    // Seeded meals are dated today, so yesterday is honestly empty.
    expect(res.body.facts.count).toBe(0);
    expect(res.body.reply).toMatch(/No meals logged for/);
  });

  it("goals context reports stored goals, unknown context rejected", async () => {
    const goals = await request(app).put("/api/goals").send({ mealsPerDay: 3 });
    expect(goals.status).toBe(200);
    const res = await request(app)
      .post("/api/assistant")
      .send({ message: "What are my goals?", context: "goals" });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.facts)).toContain("mealsPerDay");
    const bad = await request(app)
      .post("/api/assistant")
      .send({ message: "hi", context: "nonsense" });
    expect(bad.status).toBe(400);
  });

  it("repeats + waste contexts answer from stored data", async () => {
    const rep = await request(app)
      .post("/api/assistant")
      .send({ message: "What do I repeat?", context: "repeats" });
    expect(rep.status).toBe(200);
    expect(rep.body.facts.status).toBe("ok");
    const waste = await request(app)
      .post("/api/assistant")
      .send({ message: "What is expiring?", context: "waste" });
    expect(waste.status).toBe(200);
    expect(waste.body.facts).toHaveProperty("expiring");
    expect(waste.body.facts).toHaveProperty("expired");
  });
});
