/**
 * Guide step 5 — POST /api/recommendations (literal .js route path).
 * Canonical AI-agent contract. Single-user local: userId defaults to "local".
 */
import { Router } from "express";
import { prisma, ensureProfileRow } from "../db.js";
import { searchRecipes } from "../providers/recipes.js";
import { recommendWithEngine } from "../engine/recommend.js";
import { resolveWeights } from "../engine/weights.js";
import { maybeTriggerRetrain } from "../engine/retrainTrigger.js";
import { logEvent, getReqId } from "../logger.js";

export const recommendationsRouter = Router();

/** Outcomes carrying explicit signal (cold-start gate + retraining labels). */
export const OUTCOME_ACTIONS = ["saved", "cooked", "rated_positive", "rated_negative", "rated", "skipped"];

/**
 * POST /api/recommendations
 * Body: { userId?, availableIngredients?, timeLimit?, mode?: "normal"|"budget" }
 */
recommendationsRouter.post("/", async (req, res, next) => {
  try {
    await ensureProfileRow();
    const userId = req.body?.userId ?? "local";
    const availableIngredients = req.body?.availableIngredients ?? [];
    const timeLimit = req.body?.timeLimit;
    const mode = req.body?.mode ?? "normal";
    // Superset for the Cuisine Explorer: when `cuisine` is given, candidates
    // are limited to it and it counts as a favorite for cuisine_match.
    const cuisineFilter = req.body?.cuisine;

    const row = await prisma.userProfile.findUniqueOrThrow({ where: { id: 1 } });
    const profile = {
      allergies: JSON.parse(row.allergies),
      avoid_foods: JSON.parse(row.avoidFoods),
      avoidFoods: JSON.parse(row.avoidFoods),
      cuisines: JSON.parse(row.cuisines),
      favoriteCuisines: JSON.parse(row.cuisines),
      spice: row.spice,
      skill: row.skill,
      nutritionGoals: JSON.parse(row.nutritionGoals),
      nutrition_goals: JSON.parse(row.nutritionGoals),
      maxCookTime: row.maxCookTime,
    };

    const candidates = await searchRecipes({
      ingredients: availableIngredients,
      maxTime: timeLimit ?? profile.maxCookTime,
      cuisine: cuisineFilter,
      number: 20,
    });
    const scoringProfile = cuisineFilter
      ? { ...profile, cuisines: [cuisineFilter], favoriteCuisines: [cuisineFilter] }
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
      { availableIngredients, timeLimit: timeLimit ?? profile.maxCookTime, mode },
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

    // Cache IDs/metadata only (not full payloads long-term, per §5 1h term).
    for (const r of results) {
      await prisma.recipeCache.upsert({
        where: { id: r.recipe.id },
        create: {
          id: r.recipe.id,
          source: r.recipe.source,
          title: r.recipe.title,
          cuisine: r.recipe.cuisine ?? "",
          cookTime: r.recipe.cookTime ?? 30,
          nutrition: JSON.stringify(r.recipe.nutrition ?? {}),
          ingredients: JSON.stringify(r.recipe.ingredients),
          instructions: JSON.stringify(r.recipe.instructions ?? []),
          image: r.recipe.image ?? "",
          pricePerServing: r.recipe.pricePerServing ?? null,
        },
        update: {
          title: r.recipe.title,
          pricePerServing: r.recipe.pricePerServing ?? null,
        },
      });
    }

    // Guide step 4.5: log "shown" for each returned recipe (excluded from training labels).
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

    // Superset of the guide contract: the 4 guide fields plus display
    // fields the client needs (avoids 5 extra detail round-trips).
    res.json({
      recommendations: results.map((r) => ({
        recipeId: r.recipe.id,
        title: r.recipe.title,
        score: Number(r.score.toFixed(3)),
        matchReasons: r.matchReasons,
        cuisine: r.recipe.cuisine ?? "",
        cookTime: r.recipe.cookTime ?? 30,
        ingredients: r.recipe.ingredients,
        nutrition: r.recipe.nutrition ?? {},
        image: r.recipe.image ?? "",
        pricePerServing: r.recipe.pricePerServing ?? null,
      })),
    });
  } catch (e) {
    next(e);
  }
});
