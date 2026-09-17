import type { MealRecord, GoalsRecord, WaterRecord } from "../store/userDataStore.js";

/**
 * Deterministic statistics engine. Every number is derived from stored
 * raw records — nothing is estimated, nothing comes from an LLM.
 * Sparse data yields {status:"insufficient"} instead of fake zeros.
 */

export interface DayBucket {
  date: string; // YYYY-MM-DD
  meals: number;
  calories: number | null;
  protein_g: number | null;
}

export interface StatsResult {
  status: "ok" | "insufficient";
  reason?: string;
  range: "daily" | "weekly" | "monthly";
  totalMeals: number;
  activeDays: number;
  mealsPerDay: number[];
  byType: Record<string, number>;
  variety: { uniqueFoods: number; uniqueMeals: number };
  repeats: { name: string; count: number }[];
  nutrition: { calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; daysWithData: number };
  goalProgress: { label: string; target: number | null; actual: number; met: boolean | null }[];
  buckets: DayBucket[];
  waterMl: number | null;
  timing: { byHour: number[]; morning: number; afternoon: number; evening: number; night: number };
  averages: { mealsPerDay: number | null; caloriesPerDay: number | null };
  cuisineVariety: { cuisines: string[]; count: number };
  waste: { expiring: number; expired: number } | null;
}

const DAY = 86400000;

// All day bucketing is UTC so results are deterministic regardless of
// server timezone. Meal timestamps are ISO UTC; UI labels show the date key.
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const MIN_MEALS: Record<string, number> = { daily: 1, weekly: 3, monthly: 8 };

const KNOWN_CUISINES = ["italian", "mexican", "chinese", "indian", "japanese", "thai", "french", "spanish", "greek", "american", "mediterranean", "korean", "vietnamese", "turkish", "lebanese", "moroccan", "ethiopian", "brazilian", "cajun"];

export interface WasteInput {
  expiring: number;
  expired: number;
}

export function computeStats(
  meals: MealRecord[],
  goals: GoalsRecord,
  water: WaterRecord[],
  range: "daily" | "weekly" | "monthly",
  now = new Date(),
  waste: WasteInput | null = null
): StatsResult {
  const days = range === "daily" ? 1 : range === "weekly" ? 7 : 30;
  const from = startOfDay(now).getTime() - (days - 1) * DAY;
  const inRange = meals.filter((m) => {
    const t = new Date(m.loggedAt).getTime();
    return Number.isFinite(t) && t >= from && t <= now.getTime() + DAY;
  });

  const buckets: DayBucket[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from + i * DAY);
    const key = dayKey(d);
    const dayMeals = inRange.filter((m) => dayKey(new Date(m.loggedAt)) === key);
    const cals = dayMeals.map((m) => m.nutrition?.calories).filter((v): v is number => typeof v === "number");
    const prot = dayMeals.map((m) => m.nutrition?.protein_g).filter((v): v is number => typeof v === "number");
    buckets.push({
      date: key,
      meals: dayMeals.length,
      calories: cals.length ? cals.reduce((a, b) => a + b, 0) : null,
      protein_g: prot.length ? prot.reduce((a, b) => a + b, 0) : null,
    });
  }

  if (inRange.length < (MIN_MEALS[range] ?? 1)) {
    return {
      status: "insufficient", range, buckets,
      reason: `Only ${inRange.length} meal(s) logged in this ${range} window — log more meals to see statistics.`,
      totalMeals: inRange.length, activeDays: 0, mealsPerDay: buckets.map((b) => b.meals),
      byType: {}, variety: { uniqueFoods: 0, uniqueMeals: 0 }, repeats: [],
      nutrition: { calories: null, protein_g: null, carbs_g: null, fat_g: null, daysWithData: 0 },
      goalProgress: [], waterMl: null,
      timing: { byHour: new Array(24).fill(0), morning: 0, afternoon: 0, evening: 0, night: 0 },
      averages: { mealsPerDay: null, caloriesPerDay: null },
      cuisineVariety: { cuisines: [], count: 0 },
      waste,
    };
  }

  const activeDays = buckets.filter((b) => b.meals > 0).length;
  const byType: Record<string, number> = {};
  for (const m of inRange) byType[m.mealType] = (byType[m.mealType] ?? 0) + 1;

  const foodCounts = new Map<string, number>();
  for (const m of inRange) for (const f of m.foods) foodCounts.set(f.name.toLowerCase(), (foodCounts.get(f.name.toLowerCase()) ?? 0) + 1);
  const mealCounts = new Map<string, number>();
  for (const m of inRange) mealCounts.set(m.name.toLowerCase(), (mealCounts.get(m.name.toLowerCase()) ?? 0) + 1);
  const repeats = [...mealCounts.entries()]
    .filter(([, c]) => c > 1)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const sum = (pick: (m: MealRecord) => number | null | undefined): { total: number | null; days: number } => {
    let total = 0, n = 0, days = 0;
    for (const b of buckets) {
      const dayMeals = inRange.filter((m) => dayKey(new Date(m.loggedAt)) === b.date);
      const vals = dayMeals.map(pick).filter((v): v is number => typeof v === "number");
      if (vals.length) { total += vals.reduce((a, x) => a + x, 0); n += vals.length; days++; }
    }
    return { total: n ? total : null, days };
  };
  const cal = sum((m) => m.nutrition?.calories);
  const pro = sum((m) => m.nutrition?.protein_g);
  const car = sum((m) => m.nutrition?.carbs_g);
  const fat = sum((m) => m.nutrition?.fat_g);

  const goalProgress: StatsResult["goalProgress"] = [];
  const pushGoal = (label: string, target: number | null | undefined, actual: number) => {
    goalProgress.push({ label, target: target ?? null, actual, met: target == null ? null : actual >= target });
  };
  if (goals.mealsPerDay != null) pushGoal("Daily meals", goals.mealsPerDay * days, inRange.length);
  if (goals.vegMealsPerWeek != null && range !== "daily") {
    const veg = inRange.filter((m) => (m.tags ?? []).includes("vegetarian") || (m.tags ?? []).includes("vegan")).length;
    const target = Math.round(goals.vegMealsPerWeek * (days / 7));
    goalProgress.push({ label: "Vegetable meals", target, actual: veg, met: veg >= target });
  }
  if (goals.cookTimesPerWeek != null && range !== "daily") {
    const cooked = inRange.filter((m) => (m.tags ?? []).includes("homemade") || (m.tags ?? []).includes("cooked")).length;
    const target = Math.round(goals.cookTimesPerWeek * (days / 7));
    goalProgress.push({ label: "Home-cooked meals", target, actual: cooked, met: cooked >= target });
  }

  const waterInRange = water.filter((w) => {
    const t = new Date(w.loggedAt).getTime();
    return Number.isFinite(t) && t >= from;
  });
  const waterMl = waterInRange.length ? waterInRange.reduce((a, w) => a + w.ml, 0) : null;
  if (goals.waterMlPerDay != null) {
    pushGoal("Hydration (ml)", goals.waterMlPerDay * days, waterMl ?? 0);
  }

  // Meal timing (UTC hour of loggedAt — deterministic across timezones).
  const byHour = new Array(24).fill(0) as number[];
  for (const m of inRange) {
    const t = new Date(m.loggedAt).getTime();
    if (Number.isFinite(t)) byHour[new Date(t).getUTCHours()]++;
  }
  const span = (a: number, b: number) => byHour.slice(a, b).reduce((x, y) => x + y, 0);
  const timing = { byHour, morning: span(5, 11), afternoon: span(11, 17), evening: span(17, 23), night: span(23, 24) + span(0, 5) };

  const averages = {
    mealsPerDay: activeDays ? Math.round((inRange.length / activeDays) * 10) / 10 : null,
    caloriesPerDay: cal.days ? Math.round((cal.total as number) / cal.days) : null,
  };

  // Cuisine variety from tags/food tokens matching a known cuisine vocabulary.
  const tokens = new Set<string>();
  for (const m of inRange) {
    for (const t of m.tags ?? []) tokens.add(t.toLowerCase());
    for (const f of m.foods) for (const w of f.name.toLowerCase().split(/[^a-z]+/)) if (w) tokens.add(w);
  }
  const cuisines = KNOWN_CUISINES.filter((c) => tokens.has(c)).sort();

  return {
    status: "ok", range,
    totalMeals: inRange.length, activeDays,
    mealsPerDay: buckets.map((b) => b.meals),
    byType,
    variety: { uniqueFoods: foodCounts.size, uniqueMeals: mealCounts.size },
    repeats,
    nutrition: { calories: cal.total, protein_g: pro.total, carbs_g: car.total, fat_g: fat.total, daysWithData: cal.days },
    goalProgress, buckets, waterMl,
    timing, averages,
    cuisineVariety: { cuisines, count: cuisines.length },
    waste,
  };
}
