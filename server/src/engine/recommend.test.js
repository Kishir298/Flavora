import { describe, it, expect } from "vitest";
import { recommendWithEngine, buildReasons } from "./recommend.js";

const CANDIDATES = [
  { id: "ok:1", title: "Tomato Pasta", cuisine: "italian", cookTimeMinutes: 20, difficulty: "easy", spiceLevel: "mild", costTier: "low", ingredients: [{ name: "pasta", quantity: 1, unit: "lb" }, { name: "tomato", quantity: 2, unit: null }, { name: "basil", quantity: 1, unit: "cup" }], nutrition: { calories: 500 } },
  { id: "bad:1", title: "Peanut Noodles", cuisine: "chinese", cookTimeMinutes: 15, ingredients: ["noodles", "peanut butter"] },
  { id: "bad:2", title: "Parmesan Risotto", cuisine: "italian", cookTimeMinutes: 30, ingredients: ["rice", "parmesan", "butter"] },
  { id: "ok:2", title: "Lentil Soup", cuisine: "indian", cookTimeMinutes: 35, difficulty: "easy", spiceLevel: "medium", costTier: "low", ingredients: ["lentils", "tomato", "onion"] },
];

const PROFILE = { allergies: ["peanuts", "dairy"], avoid_foods: [], favoriteCuisines: ["italian"], spicePreference: "mild", skillLevel: "beginner", preferredCookTimeMinutes: 30 };

describe("engine/recommend.js — orchestrator", () => {
  it("hard-filtered recipes never appear in output", () => {
    const out = recommendWithEngine(CANDIDATES, PROFILE, { availableIngredients: [], timeLimit: 30 });
    const ids = out.map((o) => o.recipe.id);
    expect(ids).not.toContain("bad:1");
    expect(ids).not.toContain("bad:2");
    expect(ids).toContain("ok:1");
  });

  it("returns top 5 sorted desc with reasons", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `ok:${i}`, title: `Dish ${i}`, cuisine: "italian", cookTimeMinutes: 20, ingredients: ["pasta"],
    }));
    const out = recommendWithEngine(many, PROFILE, { availableIngredients: ["pasta"], timeLimit: 20 });
    expect(out).toHaveLength(5);
    for (let i = 1; i < out.length; i++) expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score);
    for (const o of out) expect(o.matchReasons.length).toBeGreaterThan(0);
  });

  it("food_waste mode favors ingredient overlap over time fit", () => {
    const cands = [
      { id: "overlap", title: "Overlap", cuisine: "x", cookTimeMinutes: 90, ingredients: ["rice", "beans", "corn"] },
      { id: "fast", title: "Fast", cuisine: "x", cookTimeMinutes: 20, ingredients: ["quinoa", "kale", "tahini"] },
    ];
    const req = { availableIngredients: ["rice", "beans", "corn"], timeLimit: 20 };
    const normal = recommendWithEngine(cands, { allergies: [], preferredCookTimeMinutes: 20 }, req);
    const fw = recommendWithEngine(cands, { allergies: [], preferredCookTimeMinutes: 20 }, { ...req, mode: "food_waste" });
    // food_waste must rank the full-overlap recipe first even with a bad time fit.
    expect(fw[0].recipe.id).toBe("overlap");
    expect(normal[0].score).toBeGreaterThan(0);
  });

  it("budget mode favors low cost_tier", () => {
    const cands = [
      { id: "cheap", title: "Cheap", cuisine: "x", cookTimeMinutes: 20, costTier: "low", ingredients: ["rice"] },
      { id: "pricey", title: "Pricey", cuisine: "x", cookTimeMinutes: 20, costTier: "high", ingredients: ["rice"] },
    ];
    const req = { availableIngredients: ["rice"], timeLimit: 20, mode: "budget" };
    const out = recommendWithEngine(cands, { allergies: [], preferredCookTimeMinutes: 20 }, req);
    expect(out[0].recipe.id).toBe("cheap");
    expect(out[0].matchReasons.join(" ")).toMatch(/budget-friendly/);
  });

  it("buildReasons mentions ingredients + time limit + skill", () => {
    const reasons = buildReasons(
      { title: "Pasta", cuisine: "italian", ingredients: ["pasta", "tomato", "basil", "garlic"] },
      { ingredient_overlap: 0.5, cuisine_match: 1, time_fit: 1, nutrition_fit: 0.5, skill_fit: 1, spice_fit: 0.5, budget_fit: 0.5 },
      { availableIngredients: ["pasta", "tomato"], timeLimit: 20 }
    );
    expect(reasons.join(" ")).toMatch(/uses 2 of your 2/);
    expect(reasons.join(" ")).toMatch(/20-minute/);
    expect(reasons.join(" ")).toMatch(/skill level/);
  });
});
