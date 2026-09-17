import { Router } from "express";
import { getStore } from "../store/userDataStore.js";
import { computeStats } from "../stats/statistics.js";
import { buildInsights } from "../stats/insights.js";

export const statsRouter = Router();

const RANGES = new Set(["daily", "weekly", "monthly"]);

statsRouter.get("/statistics", (req, res, next) => {
  try {
    const range = String(req.query.range ?? "weekly").toLowerCase();
    if (!RANGES.has(range)) return res.status(400).json({ error: "VALIDATION_ERROR", message: "range must be daily|weekly|monthly" });
    const store = getStore();
    // Statistics are derived from stored raw records — never trusted from the client.
    res.json(computeStats(store.listMeals(), store.getGoals(), store.read().waterLogs, range as "daily" | "weekly" | "monthly"));
  } catch (e) {
    next(e);
  }
});

statsRouter.get("/insights", (_req, res, next) => {
  try {
    const store = getStore();
    res.json(buildInsights(store.listMeals(), store.getGoals(), store.read().waterLogs));
  } catch (e) {
    next(e);
  }
});
