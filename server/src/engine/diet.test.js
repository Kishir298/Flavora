import { describe, it, expect } from "vitest";
import { passesDietaryFilter, violatesTerm } from "./diet.js";
import { filterEligible, recommendWithEngine } from "./recommend.js";
import { DEFAULT_WEIGHTS } from "./scorer.js";

const R = (ingredients) => ({ ingredients });

describe("dietary eligibility (hard constraint, ingredient-derived)", () => {
  it("vegan rejects meat/poultry/fish/seafood", () => {
    for (const ing of ["chicken breast, sliced", "ground beef", "pork", "bacon",
      "fish sauce", "canned tuna", "shrimp, peeled", "beef broth", "chicken stock"]) {
      expect(passesDietaryFilter(R([ing, "rice"]), "vegan")).toBe(false);
    }
  });

  it("vegan rejects egg/dairy and derivatives", () => {
    for (const ing of ["eggs, beaten", "whole milk", "cheddar", "butter",
      "parmesan", "mayonnaise", "whey protein", "gelatin", "honey", "ghee"]) {
      expect(passesDietaryFilter(R([ing, "rice"]), "vegan")).toBe(false);
    }
  });

  it("vegan accepts clearly plant-based recipes", () => {
    expect(passesDietaryFilter(R(["canned chickpeas", "onion, diced", "olive oil"]), "vegan")).toBe(true);
    expect(passesDietaryFilter(R(["peanut butter", "coconut milk", "kale, chopped"]), "vegan")).toBe(true);
  });

  it("lookalikes never count as animal products", () => {
    expect(violatesTerm("peanut butter", "butter")).toBe(false);
    expect(violatesTerm("coconut milk", "milk")).toBe(false);
    expect(violatesTerm("oat milk", "milk")).toBe(false);
    expect(violatesTerm("coconut cream", "cream")).toBe(false);
    expect(violatesTerm("eggplant, diced", "egg")).toBe(false);
    expect(violatesTerm("eggplants", "egg")).toBe(false);
    // ...while the real things still match.
    expect(violatesTerm("whole milk", "milk")).toBe(true);
    expect(violatesTerm("butter", "butter")).toBe(true);
    expect(violatesTerm("cheddar", "dairy")).toBe(true);
    expect(violatesTerm("chicken breast, sliced", "chicken")).toBe(true);
  });

  it("vegetarian rejects meat/fish but allows dairy and eggs (lacto-ovo)", () => {
    for (const ing of ["chicken", "beef", "fish sauce", "shrimp", "chicken stock"]) {
      expect(passesDietaryFilter(R([ing, "rice"]), "vegetarian")).toBe(false);
    }
    expect(passesDietaryFilter(R(["eggs, beaten", "cheddar", "butter"]), "vegetarian")).toBe(true);
    expect(passesDietaryFilter(R(["paneer, cubed", "spinach"]), "vegetarian")).toBe(true);
  });

  it("non-veg/any/undefined/unknown impose no diet constraint", () => {
    const r = R(["chicken breast, sliced", "butter"]);
    for (const diet of ["non-vegetarian", "non-veg", "any", undefined, "", "carnivore"]) {
      expect(passesDietaryFilter(r, diet)).toBe(true);
    }
  });

  it("fail-closed: no ingredient evidence + active diet = ineligible", () => {
    expect(passesDietaryFilter({ ingredients: [] }, "vegan")).toBe(false);
    expect(passesDietaryFilter({}, "vegetarian")).toBe(false);
    expect(passesDietaryFilter({ ingredients: [] }, undefined)).toBe(true);
  });
});

describe("recommendation pipeline: eligibility runs before ranking", () => {
  const CHICKEN = { id: "c1", title: "Chicken", ingredients: ["chicken breast", "rice"], nutrition: { calories: 500 } };
  const LENTILS = { id: "c2", title: "Lentils", ingredients: ["lentils", "onion"], nutrition: { calories: 400 } };
  const CHEESE = { id: "c3", title: "Cheesy", ingredients: ["cheese", "pasta"], nutrition: { calories: 600 } };

  it("vegan engine results never contain animal products (filter-then-rank)", () => {
    const out = recommendWithEngine(
      [CHICKEN, CHEESE, LENTILS],
      { allergies: [], avoidFoods: [] },
      { dietaryPreference: "vegan" },
      DEFAULT_WEIGHTS,
      5
    );
    expect(out.length).toBeGreaterThan(0);
    for (const r of out) {
      expect(passesDietaryFilter(r.recipe, "vegan")).toBe(true);
    }
    expect(out.map((r) => r.recipe.id)).not.toContain("c1");
    expect(out.map((r) => r.recipe.id)).not.toContain("c3");
  });

  it("vegan + allergy combines both hard filters", () => {
    const out = recommendWithEngine(
      [CHICKEN, LENTILS, { id: "c4", title: "Peanut", ingredients: ["peanuts", "rice"], nutrition: {} }],
      { allergies: ["peanut"], avoidFoods: [] },
      { dietaryPreference: "vegan" },
      DEFAULT_WEIGHTS,
      5
    );
    expect(out.map((r) => r.recipe.id)).toEqual(["c2"]);
  });

  it("no eligible candidates → honest empty result (never fallback invalid)", () => {
    const out = recommendWithEngine(
      [CHICKEN, CHEESE],
      { allergies: [], avoidFoods: [] },
      { dietaryPreference: "vegan" },
      DEFAULT_WEIGHTS,
      5
    );
    expect(out.length).toBe(0);
    expect(out.eligibleCount).toBe(0);
  });

  it("vegetarian keeps dairy/egg but drops meat; ranking only sees survivors", () => {
    const out = recommendWithEngine(
      [CHICKEN, CHEESE, LENTILS],
      { allergies: [], avoidFoods: [] },
      { dietaryPreference: "vegetarian" },
      DEFAULT_WEIGHTS,
      5
    );
    expect(out.map((r) => r.recipe.id)).not.toContain("c1");
    expect(out.map((r) => r.recipe.id)).toEqual(expect.arrayContaining(["c2", "c3"]));
  });

  it("filterEligible is the single shared path used by ranking", () => {
    const eligible = filterEligible([CHICKEN, LENTILS], { allergies: [] }, { dietaryPreference: "vegan" });
    expect(eligible.map((r) => r.id)).toEqual(["c2"]);
  });
});
