import { useEffect, useState } from "react";
import { api, type MealSlot } from "../lib/api";
import { useOnlineStatus } from "../lib/useOnlineStatus";
import { enqueueMutation } from "../lib/mutationQueue";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MEALS = ["breakfast", "lunch", "dinner", "snack"];

export function MealPlan() {
  const [slots, setSlots] = useState<MealSlot[]>([]);
  const [recipeId, setRecipeId] = useState("");
  const [day, setDay] = useState("monday");
  const [meal, setMeal] = useState("dinner");
  const [servings, setServings] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [nutrition, setNutrition] = useState<Record<string, { calories: number | null; protein: number | null; carbs: number | null; fat: number | null; unknown: boolean }> | null>(null);
  const { online, pending } = useOnlineStatus();

  const load = async () => {
    setLoading(true); setError(null);
    try {
      // Parallel: slots + nutrition summary are independent endpoints.
      const [slots, nutrition] = await Promise.all([
        api.mealPlans(),
        api.mealNutrition().catch(() => null),
      ]);
      setSlots(slots);
      if (nutrition) setNutrition(nutrition);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load meal plan."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const add = async (ev: React.FormEvent) => {
    ev.preventDefault(); setMsg(null); setError(null);
    try {
      await api.addMeal({ day, meal, recipeId, servings });
    } catch {
      await enqueueMutation({ operation: "meal.add", entityType: "meal", entityId: `${day}-${meal}`, payload: { day, meal, recipeId, servings } });
      setMsg("You're offline. Changes are saved locally and will sync when connection returns.");
    }
    try {
      setRecipeId("");
      await load();
    } catch {
      /* keep queued message */
    }
  };

  const remove = async (s: MealSlot) => {
    // optimistic removal
    const prev = slots;
    setSlots((prevSlots) => prevSlots.filter((x) => x.id !== s.id));
    try {
      await api.removeMeal(s.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/failed to fetch|network|offline|load failed/i.test(msg)) {
        await enqueueMutation({ operation: "meal.remove", entityType: "meal", entityId: String(s.id), payload: { id: s.id } });
        setMsg("You're offline. Changes are saved locally and will sync when connection returns.");
        return;
      }
      setSlots(prev);
      setError(e instanceof Error ? e.message : "Remove failed.");
      return;
    }
    try {
      await load();
    } catch {
      /* offline */
    }
  };

  const move = async (s: MealSlot, targetDay: string, targetMeal: string) => {
    if (targetDay === s.day && targetMeal === s.meal) return;
    setMsg(null);
    try {
      await api.updateMeal(s.id, { day: targetDay, meal: targetMeal });
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/failed to fetch|network|offline|load failed/i.test(msg)) {
        await enqueueMutation({ operation: "meal.update", entityType: "meal", entityId: String(s.id), payload: { id: s.id, day: targetDay, meal: targetMeal } });
        setMsg("You're offline. Changes are saved locally and will sync when connection returns.");
        return;
      }
      setError(e instanceof Error ? e.message : "Move failed — is that day/meal slot already occupied?");
      try {
        await load();
      } catch {
        /* ignore */
      }
    }
  };

  const duplicateDay = async (src: string) => {
    const target = DAYS[(DAYS.indexOf(src) + 1) % DAYS.length];
    const daySlots = slots.filter((s) => s.day === src);
    if (daySlots.length === 0) { setMsg(`Nothing on ${src} to copy.`); return; }
    try {
      for (const s of daySlots) {
        try {
          await api.addMeal({ day: target, meal: s.meal, recipeId: s.recipeId, servings: s.servings });
        } catch {
          await enqueueMutation({ operation: "meal.add", entityType: "meal", entityId: `${target}-${s.meal}`, payload: { day: target, meal: s.meal, recipeId: s.recipeId, servings: s.servings } });
        }
      }
      setMsg(`Copied ${daySlots.length} meal(s) from ${src} to ${target}.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Duplicate failed."); }
  };

  const clearDay = async (d: string) => {
    const prev = slots;
    setSlots((prevSlots) => prevSlots.filter((s) => s.day !== d));
    try {
      await api.clearMealDay(d);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/failed to fetch|network|offline|load failed/i.test(msg)) {
        await enqueueMutation({ operation: "meal.clearDay", entityType: "meal", entityId: d, payload: { day: d } });
        setMsg("You're offline. Changes are saved locally and will sync when connection returns.");
        return;
      }
      setSlots(prev);
      setError(e instanceof Error ? e.message : "Clear failed.");
    }
  };

  const changeServings = async (s: MealSlot, delta: number) => {
    const next = Math.min(12, Math.max(1, s.servings + delta));
    if (next === s.servings) return;
    const prev = slots;
    setSlots((prevSlots) => prevSlots.map((x) => (x.id === s.id ? { ...x, servings: next } : x)));
    try {
      await api.updateMeal(s.id, { servings: next });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/failed to fetch|network|offline|load failed/i.test(msg)) {
        await enqueueMutation({ operation: "meal.update", entityType: "meal", entityId: String(s.id), payload: { id: s.id, servings: next } });
        return;
      }
      setSlots(prev);
      try {
        await load();
      } catch {
        /* ignore */
      }
    }
  };

  const generate = async () => {
    try {
      const ids = [...new Set(slots.map((s) => s.recipeId))];
      if (ids.length === 0) { setMsg("No meals planned yet."); return; }
      const r = await api.generateGroceries({ recipeIds: ids, useInventory: true });
      setMsg(`Grocery list generated: ${r.purchased} items to buy (merged ${r.merged}, inventory subtracted).`);
    } catch (e) { setError(e instanceof Error ? e.message : "Generate failed."); }
  };

  const dayNutrition = (d: string) => {
    const n = nutrition?.[d];
    if (!n) return "";
    return ` — ${n.calories ?? "?"} kcal${n.unknown ? " (incomplete)" : ""}`;
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-2xl font-bold">Meal plan</h1>
      {!online && <p role="status" className="mt-2 rounded bg-amber-100 px-3 py-2 text-sm">You&apos;re offline. Changes are saved locally and will sync when connection returns.{pending > 0 && ` (${pending} pending)`}</p>}
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
        <label className="text-sm">Servings
          <input aria-label="servings" type="number" min={1} max={12} className="ml-1 w-16 rounded border px-2 py-1" value={servings} onChange={(e) => setServings(Number(e.target.value) || 1)} />
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
          {DAYS.map((d) => {
            const daySlots = slots.filter((s) => s.day === d);
            return (
              <section key={d} aria-label={d} className="rounded border p-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold capitalize">{d}{dayNutrition(d)}</h2>
                  <div className="flex gap-1">
                    {daySlots.length > 0 && (
                      <>
                        <button onClick={() => void duplicateDay(d)} className="rounded border px-1.5 py-0.5 text-xs" aria-label={`duplicate ${d} to next day`}>Copy →</button>
                        <button onClick={() => void clearDay(d)} className="rounded border px-1.5 py-0.5 text-xs" aria-label={`clear ${d}`}>Clear</button>
                      </>
                    )}
                  </div>
                </div>
                <ul className="mt-1 space-y-1 text-sm">
                  {daySlots.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2">
                      <span><strong>{s.meal}</strong>: {s.recipeId}</span>
                      <label className="text-xs opacity-80">Move
                        <select
                          aria-label={`move ${s.meal} on ${d}`}
                          className="ml-1 rounded border px-1 py-0.5 text-xs"
                          value={`${s.day}:${s.meal}`}
                          onChange={(e) => {
                            const [td, tm] = e.target.value.split(":");
                            void move(s, td, tm);
                          }}
                        >
                          {DAYS.map((td) =>
                            MEALS.map((tm) => (
                              <option key={`${td}:${tm}`} value={`${td}:${tm}`}>{td} {tm}</option>
                            ))
                          )}
                        </select>
                      </label>
                      <span className="flex items-center gap-1" aria-label={`servings for ${s.meal} ${d}`}>
                        <button onClick={() => void changeServings(s, -1)} className="rounded border px-1 text-xs" aria-label={`decrease servings ${s.meal} ${d}`}>−</button>
                        ×{s.servings}
                        <button onClick={() => void changeServings(s, 1)} className="rounded border px-1 text-xs" aria-label={`increase servings ${s.meal} ${d}`}>+</button>
                      </span>
                      <button onClick={() => void remove(s)} className="ml-auto rounded border px-2 py-0.5 text-xs" aria-label={`remove ${s.meal} ${d}`}>Remove</button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {nutrition?.week && (
        <p role="status" className="mt-4 text-sm">
          Week: {nutrition.week.calories ?? "?"} kcal · protein {nutrition.week.protein ?? "?"}g · carbs {nutrition.week.carbs ?? "?"}g · fat {nutrition.week.fat ?? "?"}g
          {nutrition.week.unknown ? " (some values unknown — not invented)" : ""}
        </p>
      )}
    </div>
  );
}
