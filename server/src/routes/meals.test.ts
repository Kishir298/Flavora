import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let app: Express;
// Isolate from the real data/user-data.json.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flavora-api-"));
process.env.FLAVORA_USER_DATA_FILE = path.join(dir, "user-data.json");

beforeAll(async () => {
  const { createApp } = await import("../app.js");
  app = createApp();
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const meal = (over: Record<string, unknown> = {}) => ({
  name: "Lentil soup",
  mealType: "dinner",
  loggedAt: "2026-09-12T19:00:00.000Z",
  foods: [{ name: "lentils" }],
  nutrition: { calories: 400 },
  ...over,
});

describe("meals/goals/water API — local JSON persistence", () => {
  it("CRUD meals with validation", async () => {
    const created = await request(app).post("/api/meals").send(meal());
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect(id).toBeTruthy();

    const list = await request(app).get("/api/meals");
    expect(list.body.some((m: { id: string }) => m.id === id)).toBe(true);

    const bad = await request(app).post("/api/meals").send({ name: "" });
    expect(bad.status).toBe(400);

    const upd = await request(app).put(`/api/meals/${id}`).send({ name: "Lentil soup+" });
    expect(upd.status).toBe(200);
    expect(upd.body.name).toBe("Lentil soup+");

    expect((await request(app).put("/api/meals/nope").send({ name: "x" })).status).toBe(404);
    expect((await request(app).delete(`/api/meals/${id}`)).status).toBe(200);
    expect((await request(app).delete(`/api/meals/${id}`)).status).toBe(404);
  });

  it("goals round-trip with validation", async () => {
    const put = await request(app).put("/api/goals").send({ mealsPerDay: 3, waterMlPerDay: 2000 });
    expect(put.status).toBe(200);
    const got = await request(app).get("/api/goals");
    expect(got.body.mealsPerDay).toBe(3);
    expect((await request(app).put("/api/goals").send({ mealsPerDay: -1 })).status).toBe(400);
  });

  it("water logging validates", async () => {
    expect((await request(app).post("/api/water").send({ ml: 300 })).status).toBe(201);
    expect((await request(app).post("/api/water").send({ ml: 0 })).status).toBe(400);
  });

  describe("idempotency key binding", () => {
    const idempotencyKey = "test-idempotency-key-123";

    it("returns cached response for identical request with same key", async () => {
      const m = meal({ name: "Idempotent meal" });
      const res1 = await request(app).post("/api/meals").set("Idempotency-Key", idempotencyKey).send(m);
      expect(res1.status).toBe(201);
      const id = res1.body.id;

      // Same key, same method, same path, same payload -> returns cached response
      const res2 = await request(app).post("/api/meals").set("Idempotency-Key", idempotencyKey).send(m);
      expect(res2.status).toBe(200); // cached response returns 200
      expect(res2.body.id).toBe(id); // Same ID returned
    });

    it("rejects reuse with different payload (409 conflict)", async () => {
      const key = "test-idempotency-key-diff-payload";
      const m1 = meal({ name: "Meal A" });
      const res1 = await request(app).post("/api/meals").set("Idempotency-Key", key).send(m1);
      expect(res1.status).toBe(201);

      // Same key, different payload -> 409 conflict
      const m2 = meal({ name: "Meal B" });
      const res2 = await request(app).post("/api/meals").set("Idempotency-Key", key).send(m2);
      expect(res2.status).toBe(409);
      expect(res2.body.error).toBe("IDEMPOTENCY_CONFLICT");
    });

    it("rejects reuse with different method (409 conflict)", async () => {
      const key = "test-idempotency-key-diff-method";
      const m = meal({ name: "Meal for PUT" });
      const createRes = await request(app).post("/api/meals").set("Idempotency-Key", key).send(m);
      expect(createRes.status).toBe(201);
      const id = createRes.body.id;

      // Same key, different method (PUT vs POST) -> 409 conflict
      const res2 = await request(app).put(`/api/meals/${id}`).set("Idempotency-Key", key).send({ name: "Updated" });
      expect(res2.status).toBe(409);
      expect(res2.body.error).toBe("IDEMPOTENCY_CONFLICT");
    });

    it("rejects reuse with different path (409 conflict)", async () => {
      const key = "test-idempotency-key-diff-path";
      const m = meal({ name: "Meal for path test" });
      const createRes = await request(app).post("/api/meals").set("Idempotency-Key", key).send(m);
      expect(createRes.status).toBe(201);
      const id = createRes.body.id;

      // Same key, different path -> 409 conflict
      const res2 = await request(app).delete(`/api/meals/${id}`).set("Idempotency-Key", key).send();
      expect(res2.status).toBe(409);
      expect(res2.body.error).toBe("IDEMPOTENCY_CONFLICT");
    });

    it("works for water endpoint with same key", async () => {
      const key = "test-idempotency-water";
      const res1 = await request(app).post("/api/water").set("Idempotency-Key", key).send({ ml: 250 });
      expect(res1.status).toBe(201);
      const id = res1.body.id;

      const res2 = await request(app).post("/api/water").set("Idempotency-Key", key).send({ ml: 250 });
      expect(res2.status).toBe(200); // cached response returns 200
      expect(res2.body.id).toBe(id);
    });

    it("rejects different payload for water endpoint", async () => {
      const key = "test-idempotency-water-diff";
      const res1 = await request(app).post("/api/water").set("Idempotency-Key", key).send({ ml: 250 });
      expect(res1.status).toBe(201);

      const res2 = await request(app).post("/api/water").set("Idempotency-Key", key).send({ ml: 500 });
      expect(res2.status).toBe(409);
      expect(res2.body.error).toBe("IDEMPOTENCY_CONFLICT");
    });
  });
});
