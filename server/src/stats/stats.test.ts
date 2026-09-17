import { describe, it, expect } from "vitest";
import { computeStats } from "./statistics.js";
import { buildInsights } from "./insights.js";
import type { MealRecord } from "../store/userDataStore.js";

const NOW = new Date("2026-09-17T12:00:00.000Z");

function meal(over: Partial<MealRecord> & { name: string }): MealRecord {
  return {
    id: over.name,
    mealType: "dinner",
    loggedAt: "2026-09-16T19:00:00.000Z",
    foods: [{ name: "rice" }],
    servings: 1,
    nutrition: null,
    tags: [],
    notes: "",
    ...over,
  } as MealRecord;
}

const WEEK_MEALS: MealRecord[] = [
  meal({ id: "1", name: "Oatmeal", mealType: "breakfast", loggedAt: "2026-09-16T08:00:00Z", foods: [{ name: "oats" }], nutrition: { calories: 300, protein_g: 10 }, tags: ["vegetarian"] }),
  meal({ id: "2", name: "Salad", mealType: "lunch", loggedAt: "2026-09-16T13:00:00Z", foods: [{ name: "lettuce" }, { name: "tomato" }], nutrition: { calories: 250 }, tags: ["vegetarian", "homemade"] }),
  meal({ id: "3", name: "Oatmeal", mealType: "breakfast", loggedAt: "2026-09-15T08:00:00Z", foods: [{ name: "oats" }], nutrition: { calories: 300 } }),
  meal({ id: "4", name: "Oatmeal", mealType: "breakfast", loggedAt: "2026-09-14T08:00:00Z", foods: [{ name: "oats" }], nutrition: { calories: 310 } }),
  meal({ id: "5", name: "Soup", mealType: "dinner", loggedAt: "2026-09-13T19:00:00Z", foods: [{ name: "lentils" }], nutrition: { calories: 400 } }),
];

describe("statistics engine — deterministic from fixtures", () => {
  it("weekly totals, active days, types, variety, repeats, nutrition", () => {
    const s = computeStats(WEEK_MEALS, {}, [], "weekly", NOW);
    expect(s.status).toBe("ok");
    expect(s.totalMeals).toBe(5);
    expect(s.activeDays).toBe(4);
    expect(s.byType).toEqual({ breakfast: 3, lunch: 1, dinner: 1 });
    expect(s.variety).toEqual({ uniqueFoods: 4, uniqueMeals: 3 });
    expect(s.repeats[0]).toEqual({ name: "oatmeal", count: 3 });
    expect(s.nutrition.calories).toBe(1560);
    expect(s.nutrition.daysWithData).toBe(4);
  });

  it("goal progress computed from stored data", () => {
    const s = computeStats(WEEK_MEALS, { mealsPerDay: 1, vegMealsPerWeek: 7 }, [], "weekly", NOW);
    const daily = s.goalProgress.find((g) => g.label === "Daily meals");
    expect(daily?.actual).toBe(5);
    const veg = s.goalProgress.find((g) => g.label === "Vegetable meals");
    expect(veg?.actual).toBe(2);
    expect(veg?.met).toBe(false);
  });

  it("insufficient data returns honest state, not zeros", () => {
    const s = computeStats([], {}, [], "weekly", NOW);
    expect(s.status).toBe("insufficient");
    expect(s.reason).toMatch(/Not enough data|log more/i);
    const d = computeStats(WEEK_MEALS.slice(0, 1), {}, [], "monthly", NOW);
    expect(d.status).toBe("insufficient");
  });

  it("daily window works", () => {
    const s = computeStats(WEEK_MEALS, {}, [], "daily", NOW);
    // "today" 2026-09-17 has no meals; yesterday's do not count.
    expect(s.status).toBe("insufficient");
    const s2 = computeStats(WEEK_MEALS, {}, [], "daily", new Date("2026-09-16T20:00:00Z"));
    expect(s2.status).toBe("ok");
    expect(s2.totalMeals).toBe(2);
  });
});

describe("insights — neutral habit language", () => {
  it("emits deterministic observations from fixtures", () => {
    const list = buildInsights(WEEK_MEALS, { mealsPerDay: 1 }, [], NOW);
    const texts = list.map((i) => i.text);
    expect(texts).toContain("You logged meals on 4 of the last 7 days.");
    expect(texts.some((t) => t.includes("different meal(s)"))).toBe(true);
    expect(texts.some((t) => t.includes('repeated "oatmeal" 3 times'))).toBe(true);
  });

  it("empty store yields getting-started guidance", () => {
    const list = buildInsights([], {}, [], NOW);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("getting-started");
  });

  it("bans medical / shaming / restrictive language", () => {
    const banned = [/you are eating badly/i, /need to eat less/i, /diagnos/i, /obes/i, /restrict/i, /badly/i, /should weigh/i, /dieting/i];
    // Exhaustive sweep over several fixture shapes.
    const shapes: MealRecord[][] = [WEEK_MEALS, [], WEEK_MEALS.slice(0, 4)];
    for (const m of shapes) {
      for (const i of buildInsights(m, { mealsPerDay: 3, maxCalories: 2000 }, [], NOW)) {
        for (const re of banned) expect(i.text).not.toMatch(re);
      }
    }
  });
});
