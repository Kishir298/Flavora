import { describe, it, expect } from "vitest";
import { computeFeatures } from "./features.js";
import { DEFAULT_WEIGHTS, scoreWithFeatures, scoreRecipe } from "./scorer.js";
import { resolveWeights, normalizeWeights, COLD_START_MIN_OUTCOMES } from "./weights.js";

describe("engine/features.js — normalized feature vector", () => {
  it("computes expected values for a known triple", () => {
    const f = computeFeatures(
      { ingredients: ["pasta", "tomato", "basil", "garlic"], cuisine: "italian", cookTime: 20, spice: "mild" },
      { cuisines: ["italian"], spice: "mild", maxCookTime: 30 },
      { availableIngredients: ["pasta", "tomato"], timeLimit: 20 }
    );
    expect(f.ingredient_overlap).toBeCloseTo(0.5, 5); // 2 of 4
    expect(f.cuisine_match).toBe(1);
    expect(f.time_fit).toBe(1);
    expect(f.spice_fit).toBe(1);
  });

  it("time_fit follows 1-|cook-limit|/limit clipped", () => {
    const base = { ingredients: ["x"], cuisine: "", cookTime: 30 };
    const prof = { cuisines: [], maxCookTime: 20 };
    expect(computeFeatures(base, prof, { timeLimit: 20 }).time_fit).toBeCloseTo(0.5, 5); // 1-10/20
    expect(computeFeatures({ ...base, cookTime: 60 }, prof, { timeLimit: 20 }).time_fit).toBe(0);
  });

  it("spice_fit is 1 / 0.5 / 0", () => {
    const r = (spice) => computeFeatures({ ingredients: ["x"], spice }, { spice: "medium" }, {}).spice_fit;
    expect(r("medium")).toBe(1);
    expect(r("mild")).toBe(0.5);
    expect(r("hot")).toBe(0.5);
    const opp = computeFeatures({ ingredients: ["x"], spice: "mild" }, { spice: "hot" }, {}).spice_fit;
    expect(opp).toBe(0);
  });

  it("budget_fit is inverse price, neutral when unknown", () => {
    expect(computeFeatures({ ingredients: ["x"] }, {}, {}).budget_fit).toBe(0.5);
    expect(computeFeatures({ ingredients: ["x"], pricePerServing: 0 }, {}, {}).budget_fit).toBe(1);
    expect(computeFeatures({ ingredients: ["x"], pricePerServing: 5 }, {}, {}).budget_fit).toBe(0);
  });

  it("all features stay in [0,1]", () => {
    const f = computeFeatures(
      { ingredients: [], cuisine: "x", cookTime: 999, nutrition: { calories: 9999 } },
      { cuisines: ["y"], spice: "mild", nutritionGoals: { maxCalories: 100 } },
      { availableIngredients: ["zzz"], timeLimit: 5 }
    );
    for (const v of Object.values(f)) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
  });
});

describe("engine/scorer.js — fixed weights ranking", () => {
  it("defaults sum to 1", () => {
    expect(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it("fixed weights + fixed features → expected order", () => {
    const w = { ingredient_overlap: 1, cuisine_match: 0, time_fit: 0, nutrition_fit: 0, spice_fit: 0, budget_fit: 0 };
    const a = scoreWithFeatures({ ingredient_overlap: 1, cuisine_match: 0, time_fit: 0, nutrition_fit: 0, spice_fit: 0, budget_fit: 0 }, w);
    const b = scoreWithFeatures({ ingredient_overlap: 0, cuisine_match: 1, time_fit: 1, nutrition_fit: 1, spice_fit: 1, budget_fit: 1 }, w);
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
