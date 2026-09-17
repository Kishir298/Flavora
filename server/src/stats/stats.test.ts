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

  it("timing buckets, averages and cuisine variety", () => {
    const s = computeStats(WEEK_MEALS, {}, [], "weekly", NOW);
    expect(s.timing.byHour).toHaveLength(24);
    expect(s.timing.morning).toBe(3); // 08:00 x3
    expect(s.timing.evening).toBe(1); // 19:00 x1
    expect(s.timing.afternoon).toBe(1); // 13:00
    expect(s.averages.mealsPerDay).toBe(1.3); // 5 meals / 4 active days
    expect(s.averages.caloriesPerDay).toBe(390); // 1560 / 4 days with data
  });

  it("cuisine variety matches tags against known cuisines", () => {
    const s = computeStats(
      [meal({ id: "c1", name: "Pasta", loggedAt: "2026-09-16T19:00:00Z", foods: [{ name: "pasta" }], tags: ["italian"] }),
       meal({ id: "c2", name: "Tacos", loggedAt: "2026-09-16T13:00:00Z", foods: [{ name: "beans" }], tags: ["mexican"] }),
       meal({ id: "c3", name: "Soup", loggedAt: "2026-09-15T19:00:00Z", foods: [{ name: "lentils" }] })],
      {}, [], "weekly", NOW);
    expect(s.cuisineVariety).toEqual({ cuisines: ["italian", "mexican"], count: 2 });
  });

  it("waste input passes through, defaults to null", () => {
    const s = computeStats(WEEK_MEALS, {}, [], "weekly", NOW, { expiring: 2, expired: 1 });
    expect(s.waste).toEqual({ expiring: 2, expired: 1 });
    const s2 = computeStats(WEEK_MEALS, {}, [], "weekly", NOW);
    expect(s2.waste).toBeNull();
  });

  it("30-day trend insight compares windows deterministically", () => {
    // 8+ meals in last 30d, 8+ in prior 30d → month-over-month insight.
    const many: MealRecord[] = [];
    for (let i = 0; i < 10; i++) many.push(meal({ id: `n${i}`, name: `Meal${i}`, loggedAt: `2026-09-${String(15 - (i % 5)).padStart(2, "0")}T12:00:00Z`, foods: [{ name: `food${i}` }] }));
    for (let i = 0; i < 8; i++) many.push(meal({ id: `o${i}`, name: `Old${i}`, loggedAt: `2026-08-${String(15 - (i % 5)).padStart(2, "0")}T12:00:00Z`, foods: [{ name: `old${i}` }] }));
    const list = buildInsights(many, {}, [], NOW);
    expect(list.some((x) => x.id === "month-over-month")).toBe(true);
    expect(list.some((x) => x.id === "timing")).toBe(true);
  });

  it("waste insight appears only with waste data", () => {
    const withWaste = buildInsights(WEEK_MEALS, {}, [], NOW, { expiring: 1, expired: 0 });
    expect(withWaste.some((x) => x.id === "waste")).toBe(true);
    const without = buildInsights(WEEK_MEALS, {}, [], NOW, null);
    expect(without.some((x) => x.id === "waste")).toBe(false);
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
