import { describe, it, expect } from "vitest";
import { filterSafeRecipes, ingredientViolatesTerm, recipeViolatesProfile } from "./filter.js";
import { recommend, scoreRecipe } from "./scorer.js";
import type { Recipe, UserProfileInput } from "./types.js";

const baseProfile: UserProfileInput = {
  allergies: ["peanut", "milk"],
  avoidFoods: ["pork"],
  cuisines: ["italian"],
  spice: "medium",
  skill: "beginner",
  nutritionGoals: { maxCalories: 600 },
  maxCookTime: 30,
};

const recipes: Recipe[] = [
  {
    id: "mock:1",
    source: "mock",
    title: "Peanut Noodles",
    cuisine: "chinese",
    cookTime: 20,
    ingredients: ["noodles", "peanut butter", "soy sauce"],
  },
  {
    id: "mock:2",
    source: "mock",
    title: "Tomato Pasta",
    cuisine: "italian",
    cookTime: 25,
    spice: "mild",
    ingredients: ["pasta", "tomato", "basil", "olive oil"],
    nutrition: { calories: 500, protein: 15, carbs: 70, fat: 12 },
  },
  {
    id: "mock:3",
    source: "mock",
    title: "Creamy Pork Pasta",
    cuisine: "italian",
    cookTime: 25,
    ingredients: ["pasta", "pork sausage", "milk", "cheese"],
  },
  {
    id: "mock:4",
    source: "mock",
    title: "Veggie Stir Fry",
    cuisine: "chinese",
    cookTime: 15,
    spice: "medium",
    ingredients: ["rice", "broccoli", "soy sauce"],
    nutrition: { calories: 400, protein: 10, carbs: 60, fat: 8 },
  },
];

describe("Layer 1 — allergy filter (must never leak)", () => {
  it("excludes direct allergen mention", () => {
    expect(recipeViolatesProfile(recipes[0], baseProfile)).toBe(true);
  });

  it("excludes derivative: 'peanut butter' triggers 'peanut'", () => {
    expect(ingredientViolatesTerm("2 tbsp peanut oil", "peanut")).toBe(true);
    expect(ingredientViolatesTerm("Peanut Butter", "peanut")).toBe(true);
  });

  it("is case-insensitive and catches MILK / Milk", () => {
    expect(recipeViolatesProfile(recipes[2], baseProfile)).toBe(true);
  });

  it("excludes avoidFoods (pork) even without allergy", () => {
    const p: UserProfileInput = { ...baseProfile, allergies: [], avoidFoods: ["pork"] };
    expect(recipeViolatesProfile(recipes[2], p)).toBe(true);
  });

  it("keeps safe recipes and drops all violators", () => {
    const safe = filterSafeRecipes(recipes, baseProfile);
    expect(safe.map((r) => r.id).sort()).toEqual(["mock:2", "mock:4"]);
  });

  it("empty allergies/avoid keeps everything (no false positives)", () => {
    const p: UserProfileInput = { ...baseProfile, allergies: [], avoidFoods: [] };
    expect(filterSafeRecipes(recipes, p)).toHaveLength(4);
  });

  it("adversarial: 'milk' hidden in 'coconut milk' still excluded", () => {
    const r: Recipe = { id: "x", source: "mock", title: "Curry", ingredients: ["Coconut Milk", "rice"] };
    expect(recipeViolatesProfile(r, baseProfile)).toBe(true);
  });
});

describe("Layer 2 — scoring", () => {
  it("prefers cuisine match + time fit among safe recipes", () => {
    const out = recommend(recipes, baseProfile, { maxTime: 30 }, 5);
    expect(out.every((s) => ["mock:2", "mock:4"].includes(s.recipe.id))).toBe(true);
    // Italian preference should rank pasta first
    expect(out[0].recipe.id).toBe("mock:2");
  });

  it("ingredient overlap boosts ranking", () => {
    const withRice = recommend(recipes, baseProfile, { ingredients: ["rice", "broccoli"] }, 5);
    expect(withRice[0].recipe.id).toBe("mock:4");
  });

  it("over-time recipes score lower on timeFit but stay if safe", () => {
    const s = scoreRecipe(recipes[1], baseProfile, { maxTime: 10 });
    expect(s.breakdown.timeFit).toBeLessThan(1);
    expect(s.score).toBeGreaterThan(0);
  });

  it("craving token overlap nudges score", () => {
    const a = scoreRecipe(recipes[1], baseProfile, { craving: "tomato pasta" });
    const b = scoreRecipe(recipes[3], baseProfile, { craving: "tomato pasta" });
    expect(a.score).toBeGreaterThan(b.score);
  });
});
