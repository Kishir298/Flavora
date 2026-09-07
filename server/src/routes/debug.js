/**
 * Debugging hook (§7.10, dev-only):
 * GET /api/debug/explain?userId=&recipeId=
 * Returns the full feature vector, the weights used, and the resulting score.
 */
import { Router } from "express";
import { prisma, ensureProfileRow } from "../db.js";
import { getRecipeById } from "../recipesDb.js";
import { computeFeatures } from "../engine/features.js";
import { scoreWithFeatures, weightsForMode } from "../engine/scorer.js";
import { resolveWeights } from "../engine/weights.js";

export const debugRouter = Router();

debugRouter.get("/explain", async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ error: "debug endpoints disabled in production" });
    }
    const userId = req.query.userId ?? "local";
    const recipeId = req.query.recipeId;
    const mode = typeof req.query.mode === "string" ? req.query.mode : "normal";
    if (!recipeId) return res.status(400).json({ error: "recipeId query param required" });

    await ensureProfileRow();
    const row = await prisma.userProfile.findUniqueOrThrow({ where: { id: 1 } });
    const favs = JSON.parse(row.favoriteCuisines);
    const goals = JSON.parse(row.nutritionGoals);
    const profile = {
      allergies: JSON.parse(row.allergies),
      avoidFoods: JSON.parse(row.avoidFoods),
      favoriteCuisines: favs,
      cuisines: favs,
      spicePreference: row.spicePreference,
      spice: row.spicePreference,
      skillLevel: row.skillLevel,
      skill: row.skillLevel,
      nutritionGoals: goals,
      preferredCookTimeMinutes: row.preferredCookTimeMinutes,
      maxCookTime: row.preferredCookTimeMinutes,
    };

    const recipe = await getRecipeById(String(recipeId));
    if (!recipe) return res.status(404).json({ error: "recipe not found" });

    const request = { availableIngredients: [], timeLimit: profile.preferredCookTimeMinutes, mode };
    const features = computeFeatures(recipe, profile, request);
    const outcomeCount = await prisma.interaction.count({
      where: { action: { in: ["saved", "cooked", "rated_positive", "rated_negative", "rated", "skipped"] } },
    });
    const weightRows = await prisma.recommendationWeights.findMany({ where: { userId: String(userId) } });
    const base = resolveWeights({ outcomeCount, rows: weightRows });
    const weights = weightsForMode(base, mode);
    const score = scoreWithFeatures(features, weights);

    res.json({ recipeId: recipe.id ?? recipeId, features, weights, score, outcomeCount, mode });
  } catch (e) {
    next(e);
  }
});
