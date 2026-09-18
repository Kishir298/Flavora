import { Router } from "express";
import { prisma } from "../db.js";
import { getRecipeById } from "../recipesDb.js";
import { passesHardFilter } from "../engine/filter.js";
import { aggregateNutrition } from "../engine/nutrition.js";

export const mealPlansRouter = Router();
const VALID_DAYS = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
const VALID_MEALS = new Set(["breakfast", "lunch", "dinner", "snack"]);

function isNotFound(e) {
  return e?.code === "P2025";
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
  return {
    allergies: JSON.parse(row.allergies),
    avoid_foods: JSON.parse(row.avoidFoods),
    avoidFoods: JSON.parse(row.avoidFoods),
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
    const d = String(day ?? "").toLowerCase();
    const m = String(meal ?? "").toLowerCase();
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
      if (!DATE_RE.test(ds) || Number.isNaN(new Date(ds).getTime())) return res.status(400).json({ error: "VALIDATION_ERROR", message: "date must be YYYY-MM-DD" });
    }
    const subs = await prisma.appliedSubstitution.findMany({ where: { userId: "local", recipeId: String(recipeId) } });
    const row = await prisma.mealPlanSlot.upsert({
      where: { userId_day_meal: { userId: "local", day: d, meal: m } },
      create: {
        userId: "local", day: d, date: date ? String(date).slice(0, 10) : "",
        meal: m, recipeId: String(recipeId), servings: sv,
        appliedSubs: JSON.stringify(subs.map((s) => ({ originalName: s.originalName, replacementName: s.replacementName }))),
      },
      update: {
        date: date ? String(date).slice(0, 10) : "",
        recipeId: String(recipeId), servings: sv,
        appliedSubs: JSON.stringify(subs.map((s) => ({ originalName: s.originalName, replacementName: s.replacementName }))),
      },
    });
    res.status(201).json(shape(row));
  } catch (e) { next(e); }
});

mealPlansRouter.put("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { servings, meal, day, date, recipeId } = req.body ?? {};
    const data = {};
    if (servings !== undefined) {
      const sv = Number(servings);
      if (!Number.isInteger(sv) || sv < 1 || sv > 12) return res.status(400).json({ error: "VALIDATION_ERROR", message: "servings must be 1..12" });
      data.servings = sv;
    }
    if (meal !== undefined) {
      if (!VALID_MEALS.has(String(meal).toLowerCase())) return res.status(400).json({ error: "VALIDATION_ERROR", message: "invalid meal" });
      data.meal = String(meal).toLowerCase();
    }
    if (day !== undefined) {
      if (!VALID_DAYS.has(String(day).toLowerCase())) return res.status(400).json({ error: "VALIDATION_ERROR", message: "invalid day" });
      data.day = String(day).toLowerCase();
    }
    if (date !== undefined) {
      if (date === "" || date === null) data.date = "";
      else {
        const ds = String(date).slice(0, 10);
        if (!DATE_RE.test(ds) || Number.isNaN(new Date(ds).getTime())) return res.status(400).json({ error: "VALIDATION_ERROR", message: "date must be YYYY-MM-DD" });
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
    next(e);
  }
});

mealPlansRouter.delete("/:id", async (req, res, next) => {
  try {
    await prisma.mealPlanSlot.delete({ where: { id: Number(req.params.id) } });
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
    const items = [];
    for (const s of slots) {
      const recipe = await getRecipeById(s.recipeId);
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
