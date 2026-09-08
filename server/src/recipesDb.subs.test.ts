import { describe, it, expect } from "vitest";
import { substituteConflicts, flattenSubstitutions } from "../recipesDb.js";

describe("allergy-safe substitutions", () => {
  it("flags dairy substitutes when milk is an allergy", () => {
    expect(substituteConflicts("any unsweetened plant-based milk (oat, soy, almond)", { allergies: ["milk"] })).toBe(
      true
    );
  });

  it("allows plant oil when dairy is avoided", () => {
    expect(
      substituteConflicts("margarine or neutral vegetable oil (3/4 the amount)", { allergies: ["dairy"] })
    ).toBe(false);
  });

  it("flags peanut butter substitute when peanut allergy present", () => {
    // tahini → peanut butter in dataset — must not be offered to peanut-allergic users
    expect(substituteConflicts("smooth peanut butter or sunflower seed butter, thinned with water", { allergies: ["peanut"] })).toBe(
      true
    );
  });

  it("flattenSubstitutions maps detail objects to name lists", () => {
    expect(
      flattenSubstitutions({
        butter: [{ name: "oil", notes: "works" }],
      })
    ).toEqual({ butter: ["oil"] });
  });
});
