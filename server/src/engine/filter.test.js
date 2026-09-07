import { describe, it, expect } from "vitest";
import { passesHardFilter, ingredientViolatesTerm } from "./filter.js";

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
});
