import { describe, it, expect } from "vitest";
import { computeFeatures, FEATURE_NAMES, SKILL_FIT_TABLE } from "./features.js";
import { DEFAULT_WEIGHTS, FOOD_WASTE_WEIGHTS, BUDGET_WEIGHTS, weightsForMode, scoreWithFeatures, scoreRecipe } from "./scorer.js";
import { resolveWeights, normalizeWeights, COLD_START_MIN_OUTCOMES } from "./weights.js";

describe("engine/features.js — normalized feature vector", () => {
  it("exposes the 7 §7.2 features", () => {
    expect([...FEATURE_NAMES].sort()).toEqual(
      ["ingredient_overlap", "time_fit", "cuisine_match", "nutrition_fit", "skill_fit", "spice_fit", "budget_fit"].sort()
    );
  });

  it("computes expected values for a known triple (seed shape)", () => {
    const f = computeFeatures(
      {
        ingredients: [
          { name: "pasta", quantity: 1, unit: "lb" },
          { name: "tomato", quantity: 2, unit: null },
          { name: "basil", quantity: 1, unit: "cup" },
          { name: "garlic", quantity: 2, unit: null },
        ],
        cuisine: "italian",
        cookTimeMinutes: 20,
        difficulty: "easy",
        spiceLevel: "mild",
        costTier: "low",
      },
      { favoriteCuisines: ["italian"], spicePreference: "mild", skillLevel: "beginner", preferredCookTimeMinutes: 30 },
      { availableIngredients: ["pasta", "tomato"], timeLimit: 20 }
    );
    expect(f.ingredient_overlap).toBeCloseTo(0.5, 5); // 2 of 4
    expect(f.cuisine_match).toBe(1);
    expect(f.time_fit).toBe(1);
    expect(f.spice_fit).toBe(1);
    expect(f.skill_fit).toBe(1); // beginner × easy
    expect(f.budget_fit).toBe(1); // low cost tier
  });

  it("time_fit follows 1-|cook-limit|/limit clipped", () => {
    const base = { ingredients: ["x"], cuisine: "", cookTimeMinutes: 30 };
    const prof = { favoriteCuisines: [], preferredCookTimeMinutes: 20 };
    expect(computeFeatures(base, prof, { timeLimit: 20 }).time_fit).toBeCloseTo(0.5, 5); // 1-10/20
    expect(computeFeatures({ ...base, cookTimeMinutes: 60 }, prof, { timeLimit: 20 }).time_fit).toBe(0);
  });

  it("skill_fit follows the §7.2 lookup table", () => {
    for (const [skill, row] of Object.entries(SKILL_FIT_TABLE)) {
      for (const [difficulty, expected] of Object.entries(row)) {
        const f = computeFeatures(
          { ingredients: ["x"], difficulty },
          { skillLevel: skill },
          {}
        );
        expect(f.skill_fit).toBe(expected);
      }
    }
    // Unknown skill/difficulty stays neutral.
    expect(computeFeatures({ ingredients: ["x"] }, {}, {}).skill_fit).toBe(0.5);
  });

  it("spice_fit is 1 / 0.5 / 0", () => {
    const r = (spiceLevel) => computeFeatures({ ingredients: ["x"], spiceLevel }, { spicePreference: "medium" }, {}).spice_fit;
    expect(r("medium")).toBe(1);
    expect(r("mild")).toBe(0.5);
    expect(r("hot")).toBe(0.5);
    const opp = computeFeatures({ ingredients: ["x"], spiceLevel: "mild" }, { spicePreference: "hot" }, {}).spice_fit;
    expect(opp).toBe(0);
  });

  it("budget_fit derives from cost_tier, neutral when unknown", () => {
    expect(computeFeatures({ ingredients: ["x"] }, {}, {}).budget_fit).toBe(0.5);
    expect(computeFeatures({ ingredients: ["x"], costTier: "low" }, {}, {}).budget_fit).toBe(1);
    expect(computeFeatures({ ingredients: ["x"], costTier: "medium" }, {}, {}).budget_fit).toBe(0.5);
    expect(computeFeatures({ ingredients: ["x"], costTier: "high" }, {}, {}).budget_fit).toBe(0);
  });

  it("all features stay in [0,1]", () => {
    const f = computeFeatures(
      { ingredients: [], cuisine: "x", cookTimeMinutes: 999, nutrition: { calories: 9999 } },
      { favoriteCuisines: ["y"], spicePreference: "mild", nutritionGoals: { maxCalories: 100 } },
      { availableIngredients: ["zzz"], timeLimit: 5 }
    );
    for (const v of Object.values(f)) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
  });
});

describe("engine/scorer.js — fixed weights ranking", () => {
  it("defaults sum to 1", () => {
    expect(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it("mode tables sum to 1 with the boosted feature on top", () => {
    for (const w of [FOOD_WASTE_WEIGHTS, BUDGET_WEIGHTS]) {
      expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
    }
    expect(FOOD_WASTE_WEIGHTS.ingredient_overlap).toBe(0.5);
    expect(BUDGET_WEIGHTS.budget_fit).toBe(0.3);
  });

  it("weightsForMode reproduces the §7.2 tables from defaults", () => {
    const fw = weightsForMode(DEFAULT_WEIGHTS, "food_waste");
    for (const [k, v] of Object.entries(FOOD_WASTE_WEIGHTS)) expect(fw[k]).toBeCloseTo(v, 2);
    const b = weightsForMode(DEFAULT_WEIGHTS, "budget");
    for (const [k, v] of Object.entries(BUDGET_WEIGHTS)) expect(b[k]).toBeCloseTo(v, 2);
    expect(weightsForMode(DEFAULT_WEIGHTS, "normal")).toEqual(DEFAULT_WEIGHTS);
  });

  it("fixed weights + fixed features → expected order", () => {
    const w = { ingredient_overlap: 1, time_fit: 0, cuisine_match: 0, nutrition_fit: 0, skill_fit: 0, spice_fit: 0, budget_fit: 0 };
    const a = scoreWithFeatures({ ingredient_overlap: 1, cuisine_match: 0, time_fit: 0, nutrition_fit: 0, skill_fit: 0, spice_fit: 0, budget_fit: 0 }, w);
    const b = scoreWithFeatures({ ingredient_overlap: 0, cuisine_match: 1, time_fit: 1, nutrition_fit: 1, skill_fit: 1, spice_fit: 1, budget_fit: 1 }, w);
    expect(a).toBeGreaterThan(b);
  });

  it("scoreRecipe returns features + score consistently", () => {
    const { features, score } = scoreRecipe({ ingredients: ["pasta"] }, {}, {});
    expect(score).toBeCloseTo(scoreWithFeatures(features), 9);
  });
});

describe("engine/weights.js — cold start gate", () => {
  it(`uses defaults below ${COLD_START_MIN_OUTCOMES} outcomes`, () => {
    expect(resolveWeights({ outcomeCount: 0, rows: [] })).toEqual(DEFAULT_WEIGHTS);
    expect(
      resolveWeights({ outcomeCount: 19, rows: [{ featureName: "ingredient_overlap", weightValue: 0.9 }] })
    ).toEqual(DEFAULT_WEIGHTS);
  });

  it("uses learned rows once past threshold", () => {
    const w = resolveWeights({ outcomeCount: 20, rows: [{ featureName: "time_fit", weightValue: 0.5 }] });
    expect(w.time_fit).toBe(0.5);
  });

  it("normalizeWeights sums to 1", () => {
    const n = normalizeWeights({ a: 3, b: 1 });
    expect(n.a + n.b).toBeCloseTo(1, 9);
  });
});
