import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let app: Express;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flavora-assistant-"));
process.env.FLAVORA_USER_DATA_FILE = path.join(dir, "user-data.json");

beforeAll(async () => {
  const { createApp } = await import("../app.js");
  app = createApp();
  const { UserDataStore } = await import("../store/userDataStore.js");
  const s = new UserDataStore(process.env.FLAVORA_USER_DATA_FILE);
  const today = new Date().toISOString();
  s.addMeal({ name: "Toast", mealType: "breakfast", loggedAt: today, foods: [{ name: "bread" }] });
  s.addMeal({ name: "Soup", mealType: "lunch", loggedAt: today, foods: [{ name: "lentils" }] });
  s.addMeal({ name: "Rice", mealType: "dinner", loggedAt: today, foods: [{ name: "rice" }] });
});
afterAll(() => {
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
