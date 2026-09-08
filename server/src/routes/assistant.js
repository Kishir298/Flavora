/**
 * POST /api/assistant — natural-language → structured intent → deterministic engine.
 * Groq (optional) only parses intent / phrasing; never bypasses allergy filtering.
 */
import { Router } from "express";
import { prisma, ensureProfileRow } from "../db.js";
import { listRecipes } from "../recipesDb.js";
import { recommendWithEngine } from "../engine/recommend.js";
import { resolveWeights } from "../engine/weights.js";
import { maybeTriggerRetrain } from "../engine/retrainTrigger.js";
import { logEvent, getReqId } from "../logger.js";
import { parseUserIntent, buildAssistantReply } from "../ai/assistantService.js";
import { normalizeIntent } from "../ai/intentSchema.js";
import { OUTCOME_ACTIONS } from "./recommendations.js";

export const assistantRouter = Router();

function ingredientDisplay(ing) {
  if (typeof ing === "string") return ing;
  const qty = ing.quantity ?? "";
  const unit = ing.unit ?? "";
  return `${qty} ${unit} ${ing.name}`.trim();
}

function loadProfile(row) {
  const favs = JSON.parse(row.favoriteCuisines);
  const goals = JSON.parse(row.nutritionGoals);
  return {
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
}

/**
 * Body: { message: string, intent?: partial RecommendationIntent }
 * Response: { intent, source, notice?, reply, recommendations: [...] }
 */
assistantRouter.post("/", async (req, res, next) => {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message && !req.body?.intent) {
      return res.status(400).json({ error: "message (or intent) required" });
    }

    await ensureProfileRow();
    const userId = req.body?.userId ?? "local";
    const provided = req.body?.intent ? normalizeIntent(req.body.intent) : undefined;
    const parsed = await parseUserIntent(message || JSON.stringify(provided ?? {}), {
      provided: message ? undefined : provided,
    });

    // If both message and structured overrides exist, merge: message wins as base, body.intent overlays.
    let intent = parsed.intent;
    if (message && provided && Object.keys(provided).length) {
      intent = normalizeIntent({ ...parsed.intent, ...provided });
    }

    const mode = intent.mode ?? "normal";
    if (!["normal", "food_waste", "budget"].includes(mode)) {
      return res.status(400).json({ error: "mode must be normal|food_waste|budget" });
    }

    const row = await prisma.userProfile.findUniqueOrThrow({ where: { id: 1 } });
    let profile = loadProfile(row);

    // Soft preference overlays from intent (never allergies).
    if (intent.preferences?.spice) {
      profile = { ...profile, spicePreference: intent.preferences.spice, spice_preference: intent.preferences.spice, spice: intent.preferences.spice };
    }
    if (intent.preferences?.skill) {
      profile = { ...profile, skillLevel: intent.preferences.skill, skill_level: intent.preferences.skill, skill: intent.preferences.skill };
    }
    if (intent.preferences?.highProtein || intent.preferences?.lowCarb) {
      const goals = {
        ...profile.nutritionGoals,
        ...(intent.preferences.highProtein ? { highProtein: true } : {}),
        ...(intent.preferences.lowCarb ? { lowCarb: true } : {}),
      };
      profile = { ...profile, nutritionGoals: goals, nutrition_goals: goals };
    }

    const cuisineFilter = intent.cuisine || undefined;
    const candidates = await listRecipes({ cuisine: cuisineFilter, limit: 200 });
    const scoringProfile = cuisineFilter
      ? { ...profile, cuisines: [cuisineFilter], favoriteCuisines: [cuisineFilter], favorite_cuisines: [cuisineFilter] }
      : profile;

    const outcomeCount = await prisma.interaction.count({
      where: { action: { in: OUTCOME_ACTIONS } },
    });
    const weightRows = await prisma.recommendationWeights.findMany({ where: { userId } });
    const weights = resolveWeights({ outcomeCount, rows: weightRows });

    const request = {
      availableIngredients: intent.availableIngredients ?? [],
      timeLimit: intent.timeLimit ?? profile.preferredCookTimeMinutes,
      mode,
      craving: intent.craving ?? undefined,
    };

    const t0 = Date.now();
    const results = recommendWithEngine(candidates, scoringProfile, request, weights, 5);
    const ms = Date.now() - t0;

    logEvent("assistant", {
      reqId: getReqId(req),
      source: parsed.source,
      ms,
      returned: results.length,
      intent,
    });

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

    const recommendations = results.map((r) => ({
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
    }));

    const reply = buildAssistantReply(message, intent, recommendations, parsed.notice);

    res.json({
      intent,
      source: parsed.source,
      notice: parsed.notice ?? null,
      reply,
      recommendations,
    });
  } catch (e) {
    next(e);
  }
});
