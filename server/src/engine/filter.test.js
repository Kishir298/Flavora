import { describe, it, expect } from "vitest";
import { passesHardFilter, ingredientViolatesTerm, expandTerm } from "./filter.js";

// Guide step-2 cases (must never fail silently) + legacy regression cases.
describe("engine/filter.js — Layer 1 hard filter", () => {
  it('allergy "peanuts" excludes "peanut butter"', () => {
    expect(
      passesHardFilter(
        { ingredients: ["noodles", "peanut butter", "soy sauce"] },
        { allergies: ["peanuts"], avoid_foods: [] }
      )
    ).toBe(false);
    expect(ingredientViolatesTerm("2 tbsp peanut oil", "peanuts")).toBe(true);
  });

  it('allergy "dairy" excludes "parmesan"', () => {
    expect(
      passesHardFilter(
        { ingredients: ["pasta", "mushroom", "milk", "parmesan"] },
        { allergies: ["dairy"], avoid_foods: [] }
      )
    ).toBe(false);
    expect(ingredientViolatesTerm("spaghetti with parmesan", "dairy")).toBe(true);
  });

  it('allergy "shellfish" excludes "shrimp paste"', () => {
    expect(
      passesHardFilter(
        { ingredients: ["rice", "shrimp paste", "chili"] },
        { allergies: ["shellfish"], avoid_foods: [] }
      )
    ).toBe(false);
  });

  it("clean recipe passes", () => {
    expect(
      passesHardFilter(
        { ingredients: ["pasta", "tomato", "basil"] },
        { allergies: ["peanut"], avoid_foods: ["pork"] }
      )
    ).toBe(true);
  });

  it("supports camelCase avoidFoods (legacy profile shape)", () => {
    expect(
      passesHardFilter(
        { ingredients: ["rice", "pork sausage"] },
        { allergies: [], avoidFoods: ["pork"] }
      )
    ).toBe(false);
  });

  it("empty restrictions pass everything", () => {
    expect(
      passesHardFilter({ ingredients: ["peanut butter"] }, { allergies: [], avoid_foods: [] })
    ).toBe(true);
  });

  it('allergy "sesame" excludes tahini/sesame oil', () => {
    expect(
      passesHardFilter(
        { ingredients: ["chickpeas", "tahini", "lemon"] },
        { allergies: ["sesame"], avoid_foods: [] }
      )
    ).toBe(false);
    expect(ingredientViolatesTerm("1 tsp sesame oil", "sesame")).toBe(true);
  });

  it('short terms use word boundaries ("oil" must not match "boil")', () => {
    expect(ingredientViolatesTerm("boiled potatoes", "oil")).toBe(false);
    expect(ingredientViolatesTerm("olive oil", "oil")).toBe(true);
  });

  it('allergy "milk" excludes all dairy products (transitive synonyms)', () => {
    expect(
      passesHardFilter(
        { ingredients: ["pasta", "cheddar cheese", "yogurt", "butter"] },
        { allergies: ["milk"], avoid_foods: [] }
      )
    ).toBe(false);
    expect(ingredientViolatesTerm("cheddar cheese", "milk")).toBe(true);
    expect(ingredientViolatesTerm("greek yogurt", "milk")).toBe(true);
    expect(ingredientViolatesTerm("salted butter", "milk")).toBe(true);
  });

  it('allergy "dairy" excludes milk (bidirectional)', () => {
    expect(
      passesHardFilter(
        { ingredients: ["cereal", "milk"] },
        { allergies: ["dairy"], avoid_foods: [] }
      )
    ).toBe(false);
    expect(ingredientViolatesTerm("whole milk", "dairy")).toBe(true);
  });

  it('expandTerm computes transitive closure', () => {
    const milkExpansion = expandTerm("milk");
    expect(milkExpansion).toContain("dairy");
    expect(milkExpansion).toContain("cheese");
    expect(milkExpansion).toContain("butter");
    expect(milkExpansion).toContain("yogurt");
    expect(milkExpansion).toContain("cream");
    expect(milkExpansion).toContain("parmesan");
    expect(milkExpansion).toContain("cheddar");
    expect(milkExpansion).toContain("mozzarella");
    expect(milkExpansion).toContain("feta");
    expect(milkExpansion).toContain("ricotta");
    expect(milkExpansion).toContain("whey");
    expect(milkExpansion).toContain("ghee");
    expect(milkExpansion).toContain("casein");
    expect(milkExpansion).toContain("paneer");
  });
});
