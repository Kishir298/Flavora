/**
 * Nutrition aggregation (Step 11). Pure functions. Never invents values.
 * Missing data -> { unknown: true } at that level, values stay null.
 */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function getNut(nut = {}) {
  return {
    calories: num(nut.calories),
    protein: num(nut.protein_g ?? nut.protein),
    carbs: num(nut.carbs_g ?? nut.carbs),
    fat: num(nut.fat_g ?? nut.fat),
  };
}

/**
 * Aggregate a list of { nutrition, servings? }.
 * servings multiplies only when both nutrition and servings known; else counts once with incomplete flag.
 */
export function aggregateNutrition(items = []) {
  let calories = 0, protein = 0, carbs = 0, fat = 0;
  let complete = true;
  let count = 0;
  for (const it of items) {
    const n = getNut(it.nutrition ?? {});
    const servings = it.servings != null ? Number(it.servings) : 1;
    const mult = Number.isFinite(servings) && servings > 0 ? servings : 1;
    if (n.calories == null || n.protein == null || n.carbs == null || n.fat == null) complete = false;
    calories += (n.calories ?? 0) * mult;
    protein += (n.protein ?? 0) * mult;
    carbs += (n.carbs ?? 0) * mult;
    fat += (n.fat ?? 0) * mult;
    count++;
  }
  if (count === 0) return { calories: null, protein: null, carbs: null, fat: null, unknown: true, complete: false };
  const round1 = (x) => Math.round(x * 10) / 10;
  return {
    calories: Math.round(calories),
    protein: round1(protein),
    carbs: round1(carbs),
    fat: round1(fat),
    unknown: !complete,
    complete,
  };
}

/** Group items by key then aggregate each group (day/week/plan). */
export function aggregateByGroup(items, keyFn) {
  const groups = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  return Object.fromEntries([...groups.entries()].map(([k, v]) => [k, aggregateNutrition(v)]));
}
