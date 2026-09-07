import { describe, it, expect } from "vitest";
import { recommendWithEngine, buildReasons } from "./recommend.js";

const CANDIDATES = [
  { id: "ok:1", title: "Tomato Pasta", cuisine: "italian", cookTime: 20, spice: "mild", ingredients: ["pasta", "tomato", "basil"], nutrition: { calories: 500 } },
  { id: "bad:1", title: "Peanut Noodles", cuisine: "chinese", cookTime: 15, ingredients: ["noodles", "peanut butter"] },
  { id: "bad:2", title: "Parmesan Risotto", cuisine: "italian", cookTime: 30, ingredients: ["rice", "parmesan", "butter"] },
  { id: "ok:2", title: "Lentil Soup", cuisine: "indian", cookTime: 35, spice: "medium", ingredients: ["lentils", "tomato", "onion"] },
];

const PROFILE = { allergies: ["peanuts", "dairy"], avoid_foods: [], cuisines: ["italian"], spice: "mild", maxCookTime: 30 };

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
      id: `ok:${i}`, title: `Dish ${i}`, cuisine: "italian", cookTime: 20, ingredients: ["pasta"],
    }));
    const out = recommendWithEngine(many, PROFILE, { availableIngredients: ["pasta"], timeLimit: 20 });
    expect(out).toHaveLength(5);
    for (let i = 1; i < out.length; i++) expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score);
    for (const o of out) expect(o.matchReasons.length).toBeGreaterThan(0);
  });

  it("buildReasons mentions ingredients + time limit", () => {
    const reasons = buildReasons(
      { title: "Pasta", cuisine: "italian", ingredients: ["pasta", "tomato", "basil", "garlic"] },
      { ingredient_overlap: 0.5, cuisine_match: 1, time_fit: 1, nutrition_fit: 0.5, spice_fit: 0.5, budget_fit: 0.5 },
      { availableIngredients: ["pasta", "tomato"], timeLimit: 20 }
    );
    expect(reasons.join(" ")).toMatch(/uses 2 of your 2/);
    expect(reasons.join(" ")).toMatch(/20-minute/);
  });
});
