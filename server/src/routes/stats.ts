import { Router } from "express";
import { getStore } from "../store/userDataStore.js";
import { computeStats } from "../stats/statistics.js";
import { buildInsights } from "../stats/insights.js";
import { prisma } from "../db.js";
import { expiryStatus } from "../engine/expiry.js";

export const statsRouter = Router();

const RANGES = new Set(["daily", "weekly", "monthly"]);

async function wasteSummary(): Promise<{ expiring: number; expired: number }> {
  try {
    const rows = await prisma.inventoryItem.findMany({ select: { expiryDate: true } });
    let expiring = 0, expired = 0;
    for (const r of rows) {
      const s = expiryStatus(r.expiryDate);
      if (s === "expiring_soon") expiring++;
      else if (s === "expired") expired++;
    }
    return { expiring, expired };
  } catch {
    return { expiring: 0, expired: 0 };
  }
}

statsRouter.get("/statistics", async (req, res, next) => {
  try {
    const range = String(req.query.range ?? "weekly").toLowerCase();
    if (!RANGES.has(range)) return res.status(400).json({ error: "VALIDATION_ERROR", message: "range must be daily|weekly|monthly" });
    const store = getStore();
    // Statistics are derived from stored raw records — never trusted from the client.
    res.json(computeStats(store.listMeals(), store.getGoals(), store.read().waterLogs, range as "daily" | "weekly" | "monthly", new Date(), await wasteSummary()));
  } catch (e) {
    next(e);
  }
});

statsRouter.get("/insights", async (_req, res, next) => {
  try {
    const store = getStore();
    res.json(buildInsights(store.listMeals(), store.getGoals(), store.read().waterLogs, new Date(), await wasteSummary()));
  } catch (e) {
    next(e);
  }
});
