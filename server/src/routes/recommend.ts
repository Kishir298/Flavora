import { Router } from "express";
import { prisma, ensureProfileRow } from "../db.js";
import { recommend } from "../recommender/scorer.js";
import { searchRecipes } from "../providers/recipes.js";
import { logEvent, getReqId } from "../logger.js";

export const recommendRouter = Router();

/**
 * POST /api/recommend { ingredients, maxTime, craving, cuisine }
 * Layer 1+2 pipeline. Logs inputs + scoring outputs for traceability (§14).
 */
recommendRouter.post("/", async (req, res, next) => {
  try {
    await ensureProfileRow();
    const row = await prisma.userProfile.findUniqueOrThrow({ where: { id: 1 } });
    const profile = {
      allergies: JSON.parse(row.allergies) as string[],
      avoidFoods: JSON.parse(row.avoidFoods) as string[],
      cuisines: JSON.parse(row.cuisines) as string[],
      spice: row.spice as "mild" | "medium" | "hot",
      skill: row.skill as "beginner" | "intermediate" | "advanced",
      nutritionGoals: JSON.parse(row.nutritionGoals) as Record<string, unknown>,
      maxCookTime: row.maxCookTime,
    };
    const { ingredients = [], maxTime, craving, cuisine } = req.body as {
      ingredients?: string[];
      maxTime?: number;
      craving?: string;
      cuisine?: string;
    };

    const candidates = await searchRecipes({
      ingredients,
      maxTime: maxTime ?? profile.maxCookTime,
      craving,
      cuisine,
      number: 20,
    });

    const t0 = Date.now();
    const results = recommend(
      candidates,
      profile,
      { ingredients, maxTime: maxTime ?? profile.maxCookTime, craving },
      5
    );
    const ms = Date.now() - t0;

    logEvent("recommend", {
      reqId: getReqId(req),
      candidates: candidates.length,
      returned: results.length,
      ms,
      query: { ingredients, maxTime, craving, cuisine },
      scores: results.map((r) => ({ id: r.recipe.id, score: Number(r.score.toFixed(3)), breakdown: r.breakdown })),
    });

    // Cache candidate metadata (IDs + scoring-relevant fields only — not full
    // Spoonacular payloads long-term, per 1h cache term in §5).
    for (const s of results) {
      await prisma.recipeCache.upsert({
        where: { id: s.recipe.id },
        create: {
          id: s.recipe.id,
          source: s.recipe.source,
          title: s.recipe.title,
          cuisine: s.recipe.cuisine ?? "",
          cookTime: s.recipe.cookTime ?? 30,
          nutrition: JSON.stringify(s.recipe.nutrition ?? {}),
          ingredients: JSON.stringify(s.recipe.ingredients),
          instructions: JSON.stringify(s.recipe.instructions ?? []),
          image: s.recipe.image ?? "",
        },
        update: {
          title: s.recipe.title,
          cuisine: s.recipe.cuisine ?? "",
          cookTime: s.recipe.cookTime ?? 30,
          nutrition: JSON.stringify(s.recipe.nutrition ?? {}),
          ingredients: JSON.stringify(s.recipe.ingredients),
          instructions: JSON.stringify(s.recipe.instructions ?? []),
          image: s.recipe.image ?? "",
        },
      });
    }

    res.json({
      results: results.map((s) => ({
        ...s.recipe,
        score: s.score,
        breakdown: s.breakdown,
      })),
    });
  } catch (e) {
    next(e);
  }
});
