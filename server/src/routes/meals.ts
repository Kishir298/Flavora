import { Router } from "express";
import { getStore, ValidationError } from "../store/userDataStore.js";

export const mealsRouter = Router();

mealsRouter.get("/", (_req, res, next) => {
  try {
    res.json(getStore().listMeals());
  } catch (e) {
    next(e);
  }
});

mealsRouter.post("/", (req, res, next) => {
  try {
    res.status(201).json(getStore().addMeal(req.body));
  } catch (e) {
    if (e instanceof ValidationError) return res.status(400).json({ error: "VALIDATION_ERROR", message: e.message });
    next(e);
  }
});

mealsRouter.put("/:id", (req, res, next) => {
  try {
    const updated = getStore().updateMeal(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "NOT_FOUND" });
    res.json(updated);
  } catch (e) {
    if (e instanceof ValidationError) return res.status(400).json({ error: "VALIDATION_ERROR", message: e.message });
    next(e);
  }
});

mealsRouter.delete("/:id", (req, res, next) => {
  try {
    const ok = getStore().removeMeal(req.params.id);
    if (!ok) return res.status(404).json({ error: "NOT_FOUND" });
    res.json({ ok: true });
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
    res.json(getStore().saveGoals(req.body));
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
    const { ml, loggedAt } = (req.body ?? {}) as { ml?: unknown; loggedAt?: unknown };
    res.status(201).json(getStore().addWater(ml, loggedAt));
  } catch (e) {
    if (e instanceof ValidationError) return res.status(400).json({ error: "VALIDATION_ERROR", message: e.message });
    next(e);
  }
});
