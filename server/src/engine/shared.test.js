import { describe, it, expect } from "vitest";
import { parseIngredient, ingredientKey, categorizeIngredient, toCanonical, mergeIngredientAmounts, subtractInventory, validateAmount } from "./ingredients.js";
import { aggregateNutrition, aggregateByGroup } from "./nutrition.js";
import { substitutionSafety, validateSubstitutionInput } from "./substitutionSafety.js";
import { expiryStatus, EXPIRY_THRESHOLD_DAYS } from "./expiry.js";

describe("ingredients utils", () => {
  it("parses prep notes without destroying info", () => {
    expect(parseIngredient("tomato, diced")).toEqual({ name: "tomato", note: "diced" });
    expect(parseIngredient("rice")).toEqual({ name: "rice", note: "" });
  });
  it("normalizes plurals: tomato/Tomatoes/diced", () => {
    expect(ingredientKey("Tomatoes")).toBe("tomato");
    expect(ingredientKey("tomato, diced")).toBe("tomato");
  });
  it("categorizes deterministically", () => {
    expect(categorizeIngredient("whole milk")).toBe("dairy");
    expect(categorizeIngredient("chicken thighs")).toBe("protein");
    expect(categorizeIngredient("mystery xyz")).toBe("other");
  });
  it("converts only allowlisted units", () => {
    expect(toCanonical(1, "kg")).toEqual({ qty: 1000, unit: "g" });
    expect(toCanonical(2, "cup")).toEqual({ qty: 480, unit: "ml" });
    expect(toCanonical(3, "pieces")).toEqual({ qty: 3, unit: "pieces" });
    expect(toCanonical(1, "bunch")).toBeNull();
  });
  it("merges compatible quantities", () => {
    const merged = mergeIngredientAmounts([
      { name: "tomatoes", quantity: 2, unit: "pieces", note: "" },
      { name: "tomato", quantity: 3, unit: "pieces", note: "" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(5);
  });
  it("subtracts inventory unit-aware", () => {
    const remaining = subtractInventory(
      [{ name: "tomato", quantity: 5, unit: "pieces" }],
      [{ name: "tomatoes", quantity: 2, unit: "pieces" }]
    );
    expect(remaining[0].quantity).toBe(3);
    // incompatible family stays
    const r2 = subtractInventory(
      [{ name: "milk", quantity: 500, unit: "ml" }],
      [{ name: "milk", quantity: 1, unit: "pieces" }]
    );
    expect(r2).toHaveLength(1);
  });
  it("validates amounts", () => {
    expect(validateAmount(-1, "g")).toMatch(/greater/);
    expect(validateAmount(2, "g")).toBeNull();
  });
});

describe("nutrition aggregation", () => {
  it("aggregates meal with servings", () => {
    const r = aggregateNutrition([
      { nutrition: { calories: 400, protein_g: 20, carbs_g: 40, fat_g: 10 }, servings: 2 },
    ]);
    expect(r.calories).toBe(800);
    expect(r.unknown).toBe(false);
  });
  it("marks unknown when incomplete, never invents", () => {
    const r = aggregateNutrition([{ nutrition: { calories: 100 } }]);
    expect(r.unknown).toBe(true);
    expect(r.calories).toBe(100);
  });
  it("empty -> unknown", () => {
    expect(aggregateNutrition([]).unknown).toBe(true);
  });
  it("groups by day", () => {
    const g = aggregateByGroup(
      [
        { day: "mon", nutrition: { calories: 100, protein_g: 10, carbs_g: 10, fat_g: 5 } },
        { day: "tue", nutrition: { calories: 200, protein_g: 20, carbs_g: 20, fat_g: 10 } },
      ],
      (x) => x.day
    );
    expect(g.mon.calories).toBe(100);
    expect(g.tue.calories).toBe(200);
  });
});

describe("substitution safety tri-state", () => {
  it("unsafe on allergy synonym", () => {
    expect(substitutionSafety("peanut butter", { allergies: ["peanut"] })).toBe("unsafe");
  });
  it("unknown with no restrictions", () => {
    expect(substitutionSafety("oat milk", {})).toBe("unknown");
  });
  it("safe when checked and clean", () => {
    expect(substitutionSafety("sunflower seed butter", { allergies: ["peanut"] })).toBe("safe");
  });
  it("validates input", () => {
    expect(validateSubstitutionInput({ recipeId: "", originalName: "a", replacementName: "b" })).toMatch(/recipeId/);
    expect(validateSubstitutionInput({ recipeId: "r", originalName: "a", replacementName: "a" })).toMatch(/differ/);
    expect(validateSubstitutionInput({ recipeId: "r", originalName: "a", replacementName: "b" })).toBeNull();
  });
});

describe("expiry", () => {
  it("threshold is configured", () => {
    expect(EXPIRY_THRESHOLD_DAYS).toBe(2);
  });
  it("computes statuses", () => {
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    expect(expiryStatus(yesterday, today)).toBe("expired");
    expect(expiryStatus(null)).toBe("unknown");
    expect(expiryStatus("not-a-date")).toBe("unknown");
  });
});
