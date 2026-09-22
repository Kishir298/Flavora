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
import { isSafetyProfileCorrupt, corruptProfileResponse } from "../profileSafety.js";

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
 * Body: { userId?, availableIngredients?, timeLimit?, mode?: "normal"|"food_waste"|"budget", cuisine?, useInventory? }
 */
recommendationsRouter.post("/", async (req, res, next) => {
  try {
    await ensureProfileRow();
    const userId = req.body?.userId ?? "local";
    let availableIngredients = req.body?.availableIngredients ?? [];
    let expiringIngredients = req.body?.expiringIngredients ?? undefined;
    const timeLimit = req.body?.timeLimit;
    const mode = req.body?.mode ?? "normal";
    const craving = typeof req.body?.craving === "string" ? req.body.craving.trim().slice(0, 120) : undefined;
    if (!["normal", "food_waste", "budget"].includes(mode)) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "mode must be normal|food_waste|budget" });
    }
    // Superset for the Cuisine Explorer: when `cuisine` is given, candidates
    // are limited to it and it counts as a favorite for cuisine_match.
    const cuisineFilter = req.body?.cuisine;

    const safeParse = (raw, fb) => { try { return JSON.parse(raw); } catch { return fb; } };
    const row = await prisma.userProfile.findUniqueOrThrow({ where: { id: 1 } });
    // Fail-closed: corrupt allergy data must never silently become [].
    if (isSafetyProfileCorrupt(row)) return corruptProfileResponse(res);
    const favs = safeParse(row.favoriteCuisines, []);
    const goals = safeParse(row.nutritionGoals, {});
    const profile = {
      allergies: safeParse(row.allergies, []),
      avoid_foods: safeParse(row.avoidFoods, []),
      avoidFoods: safeParse(row.avoidFoods, []),
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

    // Inventory integration (Flow A/B): derive have + expiring from stock when requested
    // or when caller sent nothing but stock exists and mode is food_waste.
    if (req.body?.useInventory || (expiringIngredients === undefined && (availableIngredients.length === 0))) {
      try {
        const inv = await prisma.inventoryItem.findMany({ where: { userId: "local" } });
        if (inv.length > 0) {
          if (req.body?.useInventory || availableIngredients.length === 0) {
            const names = inv.map((i) => String(i.name).toLowerCase().trim()).filter(Boolean);
            if (availableIngredients.length === 0) availableIngredients = names;
          }
          if (expiringIngredients === undefined) {
            const { expiryStatus } = await import("../engine/expiry.js");
            expiringIngredients = inv
              .filter((i) => { const s = expiryStatus(i.expiryDate); return s === "expiring_soon" || s === "expired"; })
              .map((i) => String(i.name).toLowerCase().trim()).filter(Boolean);
          }
        }
      } catch { /* inventory optional — never block recommendations */ }
    }

    const outcomeCount = await prisma.interaction.count({
      where: { action: { in: OUTCOME_ACTIONS } },
    });
    const weightRows = await prisma.recommendationWeights.findMany({ where: { userId } });
    const weights = resolveWeights({ outcomeCount, rows: weightRows });

    const t0 = Date.now();
    // Dietary preference is a HARD eligibility filter (same engine path as
    // the conversation flow); conversational calorieTarget folds into the
    // existing soft maxCalories goal. Validate lightly — the engine treats
    // unknown diet strings as "any" rather than inventing restrictions.
    const dietaryPreference =
      typeof req.body?.dietaryPreference === "string" ? req.body.dietaryPreference.trim().slice(0, 32) : undefined;
    const mealType =
      typeof req.body?.mealType === "string" ? req.body.mealType.trim().slice(0, 32) : undefined;
    const calorieTarget =
      Number.isFinite(Number(req.body?.calorieTarget)) ? Number(req.body.calorieTarget) : undefined;
    const results = recommendWithEngine(
      candidates,
      scoringProfile,
      {
        availableIngredients,
        timeLimit: timeLimit ?? profile.preferredCookTimeMinutes,
        mode,
        craving: craving || undefined,
        cravingSignals: req.body?.cravingSignals ?? undefined,
        expiringIngredients,
        nutritionGoals: profile.nutritionGoals,
        dietaryPreference,
        mealType,
        ...(calorieTarget !== undefined
          ? {
              nutritionGoals: {
                ...(profile.nutritionGoals ?? {}),
                maxCalories: calorieTarget,
              },
            }
          : {}),
      },
      weights,
      5
    );
    const ms = Date.now() - t0;

    logEvent("recommend", {
      reqId: getReqId(req),
      route: "recommendations",
      candidates: candidates.length,
      eligible: results.eligibleCount ?? results.length,
      returned: results.length,
      ms,
      // Redacted: never log raw ingredients/PII (was availableIngredients verbatim).
      query: { userId, ingredientCount: Array.isArray(availableIngredients) ? availableIngredients.length : 0, timeLimit, mode },
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
        nutritionSource:
          typeof r.recipe.nutrition?.calories === "number" &&
          Number.isFinite(r.recipe.nutrition.calories) &&
          r.recipe.nutrition.calories >= 0
            ? "authored"
            : "unknown",
      })),
    });
  } catch (e) {
    next(e);
  }
});
