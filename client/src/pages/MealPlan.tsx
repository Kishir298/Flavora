import { useEffect, useState } from "react";
import { api, type MealSlot } from "../lib/api";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MEALS = ["breakfast", "lunch", "dinner", "snack"];

export function MealPlan() {
  const [slots, setSlots] = useState<MealSlot[]>([]);
  const [recipeId, setRecipeId] = useState("");
  const [day, setDay] = useState("monday");
  const [meal, setMeal] = useState("dinner");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [nutrition, setNutrition] = useState<Record<string, { calories: number | null; unknown: boolean }> | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      setSlots(await api.mealPlans());
      try { setNutrition(await api.mealNutrition()); } catch { /* optional */ }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load meal plan."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const add = async (ev: React.FormEvent) => {
    ev.preventDefault(); setMsg(null);
    try {
      await api.addMeal({ day, meal, recipeId });
      setRecipeId("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Add failed."); }
  };

  const generate = async () => {
    try {
      const ids = [...new Set(slots.map((s) => s.recipeId))];
      if (ids.length === 0) { setMsg("No meals planned yet."); return; }
      const r = await api.generateGroceries({ recipeIds: ids, useInventory: true });
      setMsg(`Grocery list generated: ${r.purchased} items to buy (merged ${r.merged}, inventory subtracted).`);
    } catch (e) { setError(e instanceof Error ? e.message : "Generate failed."); }
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-2xl font-bold">Meal plan</h1>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {msg && <p role="status" className="mt-2 text-sm text-green-700">{msg}</p>}
      <form onSubmit={add} className="mt-4 flex flex-wrap gap-2" aria-label="add meal">
        <label className="text-sm">Day
          <select aria-label="day" className="ml-1 rounded border px-2 py-1" value={day} onChange={(e) => setDay(e.target.value)}>
            {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="text-sm">Meal
          <select aria-label="meal" className="ml-1 rounded border px-2 py-1" value={meal} onChange={(e) => setMeal(e.target.value)}>
            {MEALS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="text-sm">Recipe ID
          <input aria-label="recipe id" className="ml-1 rounded border px-2 py-1" value={recipeId} onChange={(e) => setRecipeId(e.target.value)} required placeholder="italian-..." />
        </label>
        <button className="rounded bg-green-700 px-3 py-1 text-white">Add</button>
        <button type="button" onClick={generate} className="rounded border px-3 py-1">Generate groceries</button>
      </form>
      {loading ? <p role="status" className="mt-4">Loading meal plan…</p>
      : slots.length === 0 ? <p role="status" className="mt-4">No meals planned yet.</p>
      : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {DAYS.map((d) => (
            <section key={d} aria-label={d} className="rounded border p-3">
              <h2 className="font-semibold capitalize">{d}{nutrition?.[d] && ` — ${nutrition[d].calories ?? "?"} kcal${nutrition[d].unknown ? " (incomplete)" : ""}`}</h2>
              <ul className="mt-1 space-y-1 text-sm">
                {slots.filter((s) => s.day === d).map((s) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <span><strong>{s.meal}</strong>: {s.recipeId} ×{s.servings}</span>
                    <button onClick={() => api.removeMeal(s.id).then(load)} className="ml-auto rounded border px-2 py-0.5 text-xs" aria-label={`remove ${s.meal} ${d}`}>Remove</button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {nutrition?.week && <p role="status" className="mt-4 text-sm">Week: {nutrition.week.calories ?? "?"} kcal{nutrition.week.unknown ? " (some nutrition unknown — values not invented)" : ""}</p>}
    </main>
  );
}
