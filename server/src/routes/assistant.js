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
import { getStore } from "../store/userDataStore.js";
import { computeStats } from "../stats/statistics.js";
import { buildInsights } from "../stats/insights.js";
import { normalizeIntent } from "../ai/intentSchema.js";
import { OUTCOME_ACTIONS } from "./recommendations.js";

export const assistantRouter = Router();

function summarizeFacts(context, facts, todayKey) {
  if (!facts) return "I don't have enough logged data to answer that.";
  if (context === "week-summary") {
    if (facts.status === "insufficient") return "Not enough data yet — log more meals to see your week.";
    return `This week: ${facts.totalMeals} meal(s) across ${facts.activeDays} day(s). ${(facts.insights ?? []).join(" ")}`;
  }
  if (context === "yesterday") {
    if (!facts.meals.length) return `No meals logged for ${facts.date}.`;
    return `Yesterday (${facts.date}) you logged ${facts.count} meal(s): ${facts.meals.map((m) => `${m.name} (${m.mealType})`).join(", ")}.`;
  }
  if (context === "repeats") {
    if (facts.status === "insufficient" || !facts.repeats.length) return "I don't have enough logged data to answer that.";
    return `Most repeated: ${facts.repeats.map((r) => `${r.name} (${r.count}×)`).join(", ")}.`;
  }
  if (context === "goals") {
    const items = (facts.goalProgress ?? []).filter((g) => g.target != null);
    if (!items.length) return "No measurable goals set yet — add some in Settings.";
    return items.map((g) => `${g.label}: ${g.actual} of ${g.target}`).join(". ") + ".";
  }
  if (context === "waste") {
    if (facts.unavailable) return "I don't have enough logged data to answer that.";
    if (!facts.expiring.length && !facts.expired.length) return "Nothing in your inventory is expiring soon.";
    return `Expiring soon: ${facts.expiring.join(", ") || "none"}. Expired: ${facts.expired.join(", ") || "none"}.`;
  }
  void todayKey;
  return "I don't have enough logged data to answer that.";
}

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

    // Additive safety constraints from natural language ("allergic to peanuts",
    // "no mushrooms"): union intent-stated exclusions with the stored profile.
    // The AI can only ADD exclusions — it can never remove profile allergies
    // or approve unsafe recipes. The deterministic hard filter runs after this.
    const unionStrings = (...lists) => [...new Set(lists.flat().map((s) => String(s ?? "").toLowerCase().trim()).filter(Boolean))];
    if (intent.allergies?.length || intent.avoidFoods?.length) {
      const allergies = unionStrings(profile.allergies, intent.allergies ?? []);
      const avoidFoods = unionStrings(profile.avoidFoods, intent.avoidFoods ?? []);
      profile = {
        ...profile,
        allergies,
        avoidFoods,
        avoid_foods: avoidFoods,
      };
    }

    // Soft preference overlays from intent (never allergies).
    if (intent.preferences?.spice) {
      profile = { ...profile, spicePreference: intent.preferences.spice, spice_preference: intent.preferences.spice, spice: intent.preferences.spice };
    }
    if (intent.preferences?.spice === undefined && intent.cravingSignals?.flavors?.includes("spicy")) {
      profile = { ...profile, spicePreference: "hot", spice_preference: "hot", spice: "hot" };
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
      cravingSignals: intent.cravingSignals ?? undefined,
      expiringIngredients: intent.expiringIngredients ?? undefined,
      nutritionGoals: profile.nutritionGoals,
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

    // Optional deterministic data contexts ("How have I been eating?").
    // Facts are computed by the stats engine and attached verbatim — an LLM
    // may verbalize `facts` but must never recompute or override them.
    // Supported: week-summary | yesterday | repeats | goals | waste.
    let facts = null;
    let fullReply = reply;
    const context = req.body?.context;
    if (typeof context === "string" && context) {
      const store = getStore();
      const meals = store.listMeals();
      const goals = store.getGoals();
      const water = store.read().waterLogs;
      const week = computeStats(meals, goals, water, "weekly");
      const insights = buildInsights(meals, goals, water);
      const dayKeyOf = (d) => d.toISOString().slice(0, 10);
      const todayKey = dayKeyOf(new Date());
      const yesterdayKey = dayKeyOf(new Date(Date.now() - 86400000));
      if (context === "week-summary") {
        facts = {
          totalMeals: week.totalMeals,
          activeDays: week.activeDays,
          byType: week.byType,
          variety: week.variety,
          nutrition: week.nutrition,
          goalProgress: week.goalProgress,
          status: week.status,
          insights: insights.map((i) => i.text),
        };
      } else if (context === "yesterday") {
        const ate = meals.filter((m) => dayKeyOf(new Date(m.loggedAt)) === yesterdayKey);
        facts = { date: yesterdayKey, count: ate.length, meals: ate.map((m) => ({ name: m.name, mealType: m.mealType })) };
      } else if (context === "repeats") {
        facts = { repeats: week.repeats, status: week.status };
      } else if (context === "goals") {
        facts = { goals, goalProgress: week.goalProgress, status: week.status };
      } else if (context === "waste") {
        try {
          const rows = await prisma.inventoryItem.findMany({ select: { name: true, expiryDate: true } });
          const { expiryStatus } = await import("../engine/expiry.js");
          const expiring = rows.filter((r) => expiryStatus(r.expiryDate) === "expiring_soon").map((r) => r.name);
          const expired = rows.filter((r) => expiryStatus(r.expiryDate) === "expired").map((r) => r.name);
          facts = { expiring, expired };
        } catch {
          facts = { expiring: [], expired: [], unavailable: true };
        }
      } else {
        return res.status(400).json({ error: "VALIDATION_ERROR", message: "unknown context" });
      }
      fullReply = `${summarizeFacts(context, facts, todayKey)} ${reply}`;
    }

    res.json({
      intent,
      source: parsed.source,
      notice: parsed.notice ?? null,
      reply: fullReply,
      recommendations,
      ...(facts ? { facts } : {}),
    });
  } catch (e) {
    next(e);
  }
});
