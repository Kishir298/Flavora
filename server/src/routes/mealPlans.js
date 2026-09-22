import { Router } from "express";
import { prisma } from "../db.js";
import { isSafetyProfileCorrupt, corruptProfileResponse } from "../profileSafety.js";
import { getRecipeById } from "../recipesDb.js";
import { passesHardFilter } from "../engine/filter.js";
import { aggregateNutrition } from "../engine/nutrition.js";

export const mealPlansRouter = Router();
const VALID_DAYS = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
const VALID_MEALS = new Set(["breakfast", "lunch", "dinner", "snack"]);

function isNotFound(e) {
  return e?.code === "P2025";
}
function isConflict(e) {
  return e?.code === "P2002";
}
function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}
function invalidId(res) {
  return res.status(400).json({ error: "VALIDATION_ERROR", message: "invalid id (must be a positive integer)" });
}
/** Strict YYYY-MM-DD: rejects rollover dates like 2024-02-30. */
function isValidCalendarDate(ds) {
  if (!DATE_RE.test(ds)) return false;
  const [y, m, d] = ds.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function safeArr(raw) {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function shape(r) {
  let appliedSubs = [];
  try { appliedSubs = JSON.parse(r.appliedSubs ?? "[]"); } catch { appliedSubs = []; }
  return {
    id: r.id, day: r.day, date: r.date, meal: r.meal, recipeId: r.recipeId,
    servings: r.servings, appliedSubs,
  };
}

async function loadProfile() {
  const row = await prisma.userProfile.findUniqueOrThrow({ where: { id: 1 } });
  const { assertSafetyProfileValid } = await import("../profileSafety.js");
  assertSafetyProfileValid(row);
  return {
    allergies: safeArr(row.allergies),
    avoid_foods: safeArr(row.avoidFoods),
    avoidFoods: safeArr(row.avoidFoods),
  };
}

mealPlansRouter.get("/", async (_req, res, next) => {
  try {
    const rows = await prisma.mealPlanSlot.findMany({ where: { userId: "local" }, orderBy: { id: "asc" } });
    res.json(rows.map(shape));
  } catch (e) { next(e); }
});

mealPlansRouter.post("/", async (req, res, next) => {
  try {
    const { day, date, meal, recipeId, servings } = req.body ?? {};
    const d = String(day ?? "").trim().toLowerCase();
    const m = String(meal ?? "").trim().toLowerCase();
    if (!VALID_DAYS.has(d)) return res.status(400).json({ error: "VALIDATION_ERROR", message: "day must be monday..sunday" });
    if (!VALID_MEALS.has(m)) return res.status(400).json({ error: "VALIDATION_ERROR", message: "meal must be breakfast|lunch|dinner|snack" });
    if (!recipeId) return res.status(400).json({ error: "VALIDATION_ERROR", message: "recipeId required" });
    const recipe = await getRecipeById(String(recipeId));
    if (!recipe) return res.status(400).json({ error: "VALIDATION_ERROR", message: "unknown recipeId" });
    const profile = await loadProfile();
    if (!passesHardFilter(recipe, profile)) {
      return res.status(400).json({ error: "UNSAFE_RECIPE", message: "recipe conflicts with allergies/avoid foods" });
    }
    const sv = servings != null ? Number(servings) : 1;
    if (!Number.isInteger(sv) || sv < 1 || sv > 12) return res.status(400).json({ error: "VALIDATION_ERROR", message: "servings must be 1..12" });
    if (date !== undefined && date !== "" && date !== null) {
      const ds = String(date).slice(0, 10);
      if (!isValidCalendarDate(ds)) return res.status(400).json({ error: "VALIDATION_ERROR", message: "date must be a real YYYY-MM-DD" });
    }
    const subs = await prisma.appliedSubstitution.findMany({ where: { userId: "local", recipeId: String(recipeId) } });
    // Fail-closed: never silently overwrite an occupied slot via POST (data loss).
    const existing = await prisma.mealPlanSlot.findUnique({ where: { userId_day_meal: { userId: "local", day: d, meal: m } } });
    if (existing) return res.status(409).json({ error: "CONFLICT", message: "a meal plan slot already occupies that day+meal (use PUT to move)" });
    const row = await prisma.mealPlanSlot.create({
      data: {
        userId: "local", day: d, date: date ? String(date).slice(0, 10) : "",
        meal: m, recipeId: String(recipeId), servings: sv,
        appliedSubs: JSON.stringify(subs.map((s) => ({ originalName: s.originalName, replacementName: s.replacementName }))),
      },
    });
    res.status(201).json(shape(row));
  } catch (e) {
    if (isConflict(e)) return res.status(409).json({ error: "CONFLICT", message: "a meal plan slot already occupies that day+meal" });
    next(e);
  }
});

mealPlansRouter.put("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) return invalidId(res);
    const { servings, meal, day, date, recipeId } = req.body ?? {};
    const data = {};
    if (servings !== undefined) {
      const sv = Number(servings);
      if (!Number.isInteger(sv) || sv < 1 || sv > 12) return res.status(400).json({ error: "VALIDATION_ERROR", message: "servings must be 1..12" });
      data.servings = sv;
    }
    if (meal !== undefined) {
      if (!VALID_MEALS.has(String(meal).trim().toLowerCase())) return res.status(400).json({ error: "VALIDATION_ERROR", message: "invalid meal" });
      data.meal = String(meal).trim().toLowerCase();
    }
    if (day !== undefined) {
      if (!VALID_DAYS.has(String(day).trim().toLowerCase())) return res.status(400).json({ error: "VALIDATION_ERROR", message: "invalid day" });
      data.day = String(day).trim().toLowerCase();
    }
    if (date !== undefined) {
      if (date === "" || date === null) data.date = "";
      else {
        const ds = String(date).slice(0, 10);
        if (!isValidCalendarDate(ds)) return res.status(400).json({ error: "VALIDATION_ERROR", message: "date must be a real YYYY-MM-DD" });
        data.date = ds;
      }
    }
    if (recipeId !== undefined) {
      const recipe = await getRecipeById(String(recipeId));
      if (!recipe) return res.status(400).json({ error: "VALIDATION_ERROR", message: "unknown recipeId" });
      const profile = await loadProfile();
      if (!passesHardFilter(recipe, profile)) return res.status(400).json({ error: "UNSAFE_RECIPE", message: "recipe conflicts with allergies/avoid foods" });
      data.recipeId = String(recipeId);
    }
    const row = await prisma.mealPlanSlot.update({ where: { id }, data });
    res.json(shape(row));
  } catch (e) {
    if (isNotFound(e)) return res.status(404).json({ error: "NOT_FOUND", message: "meal plan slot not found" });
    if (isConflict(e)) return res.status(409).json({ error: "CONFLICT", message: "a meal plan slot already occupies that day+meal" });
    next(e);
  }
});

mealPlansRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) return invalidId(res);
    await prisma.mealPlanSlot.delete({ where: { id } });
    res.json({ removed: true });
  } catch (e) {
    if (isNotFound(e)) return res.status(404).json({ error: "NOT_FOUND", message: "meal plan slot not found" });
    next(e);
  }
});

mealPlansRouter.post("/clear-day", async (req, res, next) => {
  try {
    const { day } = req.body ?? {};
    if (!VALID_DAYS.has(String(day ?? "").toLowerCase())) return res.status(400).json({ error: "VALIDATION_ERROR", message: "invalid day" });
    await prisma.mealPlanSlot.deleteMany({ where: { userId: "local", day: String(day).toLowerCase() } });
    res.json({ cleared: true });
  } catch (e) { next(e); }
});

/** GET /api/meal-plans/nutrition — aggregate by day (servings-aware, unknown-safe) */
mealPlansRouter.get("/nutrition/summary", async (_req, res, next) => {
  try {
    const slots = await prisma.mealPlanSlot.findMany({ where: { userId: "local" } });
    const recipes = await Promise.all(slots.map((s) => getRecipeById(s.recipeId)));
    const items = [];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const recipe = recipes[i];
      if (!recipe) continue;
      items.push({ day: s.day, nutrition: recipe.nutrition ?? {}, servings: s.servings ?? 1 });
    }
    const byDay = {};
    for (const it of items) {
      if (!byDay[it.day]) byDay[it.day] = [];
      byDay[it.day].push(it);
    }
    const out = {};
    for (const [day, list] of Object.entries(byDay)) out[day] = aggregateNutrition(list);
    out.week = aggregateNutrition(items);
    res.json(out);
  } catch (e) { next(e); }
});
