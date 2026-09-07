/**
 * Guide step 11 — debugging hook (literal .js route path).
 * Dev-only: GET /api/debug/explain?userId=&recipeId=
 * Returns the full feature vector, weights used, and resulting score so
 * "why did it suggest this" is answerable without digging through logs.
 */
import { Router } from "express";
import { prisma, ensureProfileRow } from "../db.js";
import { getRecipeById } from "../providers/recipes.js";
import { computeFeatures } from "../engine/features.js";
import { scoreWithFeatures } from "../engine/scorer.js";
import { resolveWeights } from "../engine/weights.js";

export const debugRouter = Router();

debugRouter.get("/explain", async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ error: "debug endpoints disabled in production" });
    }
    const userId = req.query.userId ?? "local";
    const recipeId = req.query.recipeId;
    if (!recipeId) return res.status(400).json({ error: "recipeId query param required" });

    await ensureProfileRow();
    const row = await prisma.userProfile.findUniqueOrThrow({ where: { id: 1 } });
    const profile = {
      cuisines: JSON.parse(row.cuisines),
      favoriteCuisines: JSON.parse(row.cuisines),
      spice: row.spice,
      nutritionGoals: JSON.parse(row.nutritionGoals),
      nutrition_goals: JSON.parse(row.nutritionGoals),
      maxCookTime: row.maxCookTime,
    };

    const cached = await prisma.recipeCache.findUnique({ where: { id: String(recipeId) } });
    let recipe = null;
    if (cached) {
      recipe = {
        id: cached.id,
        title: cached.title,
        cuisine: cached.cuisine,
        cookTime: cached.cookTime,
        ingredients: JSON.parse(cached.ingredients),
        nutrition: JSON.parse(cached.nutrition),
        pricePerServing: cached.pricePerServing,
      };
    } else {
      recipe = await getRecipeById(String(recipeId));
    }
    if (!recipe) return res.status(404).json({ error: "recipe not found" });

    const request = { availableIngredients: [], timeLimit: profile.maxCookTime, mode: "normal" };
    const features = computeFeatures(recipe, profile, request);
    const outcomeCount = await prisma.interaction.count({
      where: { action: { in: ["saved", "cooked", "rated_positive", "rated_negative", "rated", "skipped"] } },
    });
    const weightRows = await prisma.recommendationWeights.findMany({ where: { userId: String(userId) } });
    const weights = resolveWeights({ outcomeCount, rows: weightRows });
    const score = scoreWithFeatures(features, weights);

    res.json({ recipeId: recipe.id ?? recipeId, features, weights, score, outcomeCount });
  } catch (e) {
    next(e);
  }
});
