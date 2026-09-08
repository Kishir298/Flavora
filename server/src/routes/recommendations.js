/**
 * POST /api/recommendations — canonical AI-agent contract (§7.4).
 * Single-user local: userId defaults to "local".
 * Candidates come from the local `recipes` table (§5) — no external fetch.
 */
import { Router } from "express";
import { prisma, ensureProfileRow } from "../db.js";
import { listRecipes } from "../recipesDb.js";
import { recommendWithEngine } from "../engine/recommend.js";
import { resolveWeights } from "../engine/weights.js";
import { maybeTriggerRetrain } from "../engine/retrainTrigger.js";
import { logEvent, getReqId } from "../logger.js";

export const recommendationsRouter = Router();

/** Outcomes carrying explicit signal (cold-start gate + retraining labels). */
export const OUTCOME_ACTIONS = ["saved", "cooked", "rated_positive", "rated_negative", "rated", "skipped"];

function ingredientDisplay(ing) {
  if (typeof ing === "string") return ing;
  const qty = ing.quantity ?? "";
  const unit = ing.unit ?? "";
  return `${qty} ${unit} ${ing.name}`.trim();
}

/**
 * POST /api/recommendations
 * Body: { userId?, availableIngredients?, timeLimit?, mode?: "normal"|"food_waste"|"budget", cuisine? }
 */
recommendationsRouter.post("/", async (req, res, next) => {
  try {
    await ensureProfileRow();
    const userId = req.body?.userId ?? "local";
    const availableIngredients = req.body?.availableIngredients ?? [];
    const timeLimit = req.body?.timeLimit;
    const mode = req.body?.mode ?? "normal";
    const craving = typeof req.body?.craving === "string" ? req.body.craving.trim().slice(0, 120) : undefined;
    if (!["normal", "food_waste", "budget"].includes(mode)) {
      return res.status(400).json({ error: "mode must be normal|food_waste|budget" });
    }
    // Superset for the Cuisine Explorer: when `cuisine` is given, candidates
    // are limited to it and it counts as a favorite for cuisine_match.
    const cuisineFilter = req.body?.cuisine;

    const row = await prisma.userProfile.findUniqueOrThrow({ where: { id: 1 } });
    const favs = JSON.parse(row.favoriteCuisines);
    const goals = JSON.parse(row.nutritionGoals);
    const profile = {
      allergies: JSON.parse(row.allergies),
      avoid_foods: JSON.parse(row.avoidFoods),
      avoidFoods: JSON.parse(row.avoidFoods),
      favoriteCuisines: favs,
      favorite_cuisines: favs,
      cuisines: favs,
      spicePreference: row.spicePreference,
      spice_preference: row.spicePreference,
      spice: row.spicePreference,
      skillLevel: row.skillLevel,
      skill_level: row.skillLevel,
      skill: row.skillLevel,
      nutritionGoals: goals,
      nutrition_goals: goals,
      preferredCookTimeMinutes: row.preferredCookTimeMinutes,
      maxCookTime: row.preferredCookTimeMinutes,
    };

    const candidates = await listRecipes({ cuisine: cuisineFilter, limit: 200 });
    const scoringProfile = cuisineFilter
      ? { ...profile, cuisines: [cuisineFilter], favoriteCuisines: [cuisineFilter], favorite_cuisines: [cuisineFilter] }
      : profile;

    const outcomeCount = await prisma.interaction.count({
      where: { action: { in: OUTCOME_ACTIONS } },
    });
    const weightRows = await prisma.recommendationWeights.findMany({ where: { userId } });
    const weights = resolveWeights({ outcomeCount, rows: weightRows });

    const t0 = Date.now();
    const results = recommendWithEngine(
      candidates,
      scoringProfile,
      {
        availableIngredients,
        timeLimit: timeLimit ?? profile.preferredCookTimeMinutes,
        mode,
        craving: craving || undefined,
      },
      weights,
      5
    );
    const ms = Date.now() - t0;

    logEvent("recommend", {
      reqId: getReqId(req),
      route: "recommendations",
      candidates: candidates.length,
      returned: results.length,
      ms,
      query: { userId, availableIngredients, timeLimit, mode },
      scores: results.map((r) => ({ id: r.recipe.id, score: Number(r.score.toFixed(3)) })),
    });

    // Log "shown" for each returned recipe (excluded from training labels).
    if (results.length > 0) {
      await prisma.interaction.createMany({
        data: results.map((r) => ({
          recipeId: r.recipe.id,
          action: "shown",
          features: JSON.stringify(r.features),
        })),
      });
      void maybeTriggerRetrain(prisma.interaction, userId);
    }

    // Superset of the contract: the 4 contract fields plus display
    // fields the client needs (avoids extra detail round-trips).
    res.json({
      recommendations: results.map((r) => ({
        recipeId: r.recipe.id,
        title: r.recipe.title,
        score: Number(r.score.toFixed(3)),
        matchReasons: r.matchReasons,
        cuisine: r.recipe.cuisine ?? "",
        cookTime: r.recipe.cookTimeMinutes ?? 30,
        difficulty: r.recipe.difficulty ?? "easy",
        spiceLevel: r.recipe.spiceLevel ?? "mild",
        costTier: r.recipe.costTier ?? "low",
        ingredients: (r.recipe.ingredients ?? []).map(ingredientDisplay),
        nutrition: r.recipe.nutrition ?? {},
      })),
    });
  } catch (e) {
    next(e);
  }
});
