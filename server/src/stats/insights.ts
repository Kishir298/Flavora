import type { MealRecord } from "../store/userDataStore.js";
import { computeStats } from "./statistics.js";
import type { GoalsRecord, WaterRecord } from "../store/userDataStore.js";

/**
 * Deterministic healthy-habit insights. Observable patterns only —
 * never medical claims, diagnoses, body-weight judgments, or
 * restrictive-eating encouragement. Neutral language enforced by tests.
 */

export interface Insight {
  id: string;
  text: string;
  kind: "consistency" | "variety" | "vegetables" | "goals" | "repeats" | "hydration" | "planning";
}

export function buildInsights(meals: MealRecord[], goals: GoalsRecord, water: WaterRecord[], now = new Date()): Insight[] {
  const out: Insight[] = [];
  const week = computeStats(meals, goals, water, "weekly", now);
  if (week.status === "insufficient") {
    return [{ id: "getting-started", kind: "consistency", text: week.reason ?? "Not enough data yet." }];
  }

  out.push({
    id: "logged-days",
    kind: "consistency",
    text: `You logged meals on ${week.activeDays} of the last 7 days.`,
  });

  // Compare with the previous 7-day window (deterministic, same function).
  const prevNow = new Date(now.getTime() - 7 * 86400000);
  const prev = computeStats(meals, goals, water, "weekly", prevNow);
  if (prev.status === "ok") {
    const diff = week.totalMeals - prev.totalMeals;
    if (diff !== 0) {
      out.push({
        id: "week-over-week",
        kind: "consistency",
        text: diff > 0
          ? `You logged ${diff} more meal(s) this week than last week.`
          : `You logged ${-diff} fewer meal(s) this week than last week.`,
      });
    }
    const vegNow = week.goalProgress.find((g) => g.label === "Vegetable meals")?.actual ?? 0;
    const vegPrev = prev.goalProgress.find((g) => g.label === "Vegetable meals")?.actual ?? 0;
    if (vegNow !== vegPrev) {
      out.push({
        id: "veg-trend",
        kind: "vegetables",
        text: vegNow > vegPrev
          ? "Vegetable-containing meals were more frequent this week."
          : "Vegetable-containing meals were less frequent this week.",
      });
    }
  }

  if (week.variety.uniqueMeals > 0) {
    out.push({
      id: "variety",
      kind: "variety",
      text: `Your week included ${week.variety.uniqueMeals} different meal(s) across ${week.variety.uniqueFoods} different food(s).`,
    });
  }

  const top = week.repeats[0];
  if (top && top.count >= 3) {
    out.push({
      id: "repeats",
      kind: "repeats",
      text: `You have repeated "${top.name}" ${top.count} times this week.`,
    });
  }

  for (const g of week.goalProgress) {
    if (g.target == null || g.met == null) continue;
    out.push({
      id: `goal-${g.label}`,
      kind: "goals",
      text: g.met
        ? `${g.label} goal met (${g.actual} of ${g.target}).`
        : `${g.label} goal in progress (${g.actual} of ${g.target}).`,
    });
  }

  if (week.waterMl != null && week.waterMl > 0) {
    out.push({ id: "hydration", kind: "hydration", text: `You logged ${week.waterMl} ml of water this week.` });
  }

  return out;
}
