import { Router, Request, Response } from "express";
import { getStore, ValidationError, type IdempotencyScope } from "../store/userDataStore.js";
import { createHash } from "node:crypto";

export const mealsRouter = Router();

function getIdempotencyKey(req: Request): string | undefined {
  return req.header("Idempotency-Key") ?? req.body?.idempotencyKey;
}

function computeScope(req: Request): IdempotencyScope {
  const method = req.method;
  const path = req.path;
  const payloadHash = createHash("sha256").update(JSON.stringify(req.body ?? {})).digest("hex").slice(0, 16);
  return { method, path, payloadHash };
}

function withIdempotency(req: Request, res: Response, fn: () => unknown): unknown {
  const key = getIdempotencyKey(req);
  if (!key) return fn();
  const store = getStore();
  const scope = computeScope(req);
  let cached: unknown;
  try {
    cached = store.checkIdempotencyKey(key, scope);
  } catch (e) {
    if (e instanceof ValidationError) return res.status(409).json({ error: "IDEMPOTENCY_CONFLICT", message: e.message });
    throw e;
  }
  if (cached !== null) {
    return res.json(cached);
  }
  const result = fn();
  store.storeIdempotencyKey(key, result, scope);
  return result;
}

mealsRouter.get("/", (_req, res, next) => {
  try {
    res.json(getStore().listMeals());
  } catch (e) {
    next(e);
  }
});

mealsRouter.post("/", (req, res, next) => {
  try {
    withIdempotency(req, res, () => {
      const result = getStore().addMeal(req.body);
      res.status(201).json(result);
      return result;
    });
  } catch (e) {
    if (e instanceof ValidationError) return res.status(400).json({ error: "VALIDATION_ERROR", message: e.message });
    next(e);
  }
});

mealsRouter.put("/:id", (req, res, next) => {
  try {
    withIdempotency(req, res, () => {
      const updated = getStore().updateMeal(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: "NOT_FOUND" });
      res.json(updated);
      return updated;
    });
  } catch (e) {
    if (e instanceof ValidationError) return res.status(400).json({ error: "VALIDATION_ERROR", message: e.message });
    next(e);
  }
});

mealsRouter.delete("/:id", (req, res, next) => {
  try {
    withIdempotency(req, res, () => {
      const ok = getStore().removeMeal(req.params.id);
      if (!ok) return res.status(404).json({ error: "NOT_FOUND" });
      const result = { ok: true };
      res.json(result);
      return result;
    });
  } catch (e) {
    next(e);
  }
});

export const goalsRouter = Router();

goalsRouter.get("/", (_req, res, next) => {
  try {
    res.json(getStore().getGoals());
  } catch (e) {
    next(e);
  }
});

goalsRouter.put("/", (req, res, next) => {
  try {
    withIdempotency(req, res, () => {
      const result = getStore().saveGoals(req.body);
      res.json(result);
      return result;
    });
  } catch (e) {
    if (e instanceof ValidationError) return res.status(400).json({ error: "VALIDATION_ERROR", message: e.message });
    next(e);
  }
});

export const waterRouter = Router();

waterRouter.get("/", (_req, res, next) => {
  try {
    res.json(getStore().read().waterLogs);
  } catch (e) {
    next(e);
  }
});

waterRouter.post("/", (req, res, next) => {
  try {
    withIdempotency(req, res, () => {
      const { ml, loggedAt } = (req.body ?? {}) as { ml?: unknown; loggedAt?: unknown };
      const result = getStore().addWater(ml, loggedAt);
      res.status(201).json(result);
      return result;
    });
  } catch (e) {
    if (e instanceof ValidationError) return res.status(400).json({ error: "VALIDATION_ERROR", message: e.message });
    next(e);
  }
});
