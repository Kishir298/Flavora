import { useEffect, useState } from "react";
import { api, type MealLog } from "../lib/api";
import { enqueueMealLog } from "../lib/mealQueue";

const TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

export function Meals() {
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [name, setName] = useState("");
  const [mealType, setMealType] = useState<string>("dinner");
  const [foods, setFoods] = useState("");
  const [calories, setCalories] = useState("");
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState<MealLog | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const reload = () => api.mealLog.list().then(setMeals).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => { void reload(); }, []);

  const parseFoods = () => foods.split(",").map((s) => s.trim()).filter(Boolean).map((n) => ({ name: n }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setMsg("");
    const body = {
      name: editing?.name ?? name,
      mealType: (editing?.mealType ?? mealType) as MealLog["mealType"],
      loggedAt: editing?.loggedAt ?? new Date().toISOString(),
      foods: editing ? editing.foods : parseFoods(),
      nutrition: calories ? { calories: Number(calories) } : editing?.nutrition ?? null,
      notes: editing?.notes ?? notes,
    };
    try {
      if (editing) {
        try { await api.mealLog.update(editing.id, body); }
        catch { await enqueueMealLog("update", { ...body, id: editing.id }); setMsg("Saved locally — will sync when online."); }
        setEditing(null);
      } else {
        try { await api.mealLog.add({ ...body, name, mealType: mealType as MealLog["mealType"], tags: [] }); }
        catch { await enqueueMealLog("add", { ...body, name, mealType }); setMsg("Saved locally — will sync when online."); }
        setName(""); setFoods(""); setCalories(""); setNotes("");
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function remove(id: string) {
    try { await api.mealLog.remove(id); }
    catch { await enqueueMealLog("remove", { id }); setMsg("Delete queued — will sync when online."); }
    await reload();
  }

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Meals</h1>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {msg && <p role="status" className="text-sm">{msg}</p>}
      <form onSubmit={submit} className="rounded border border-neutral-200 dark:border-neutral-800 p-4 space-y-2 bg-white dark:bg-neutral-900">
        <h2 className="font-semibold">{editing ? "Edit meal" : "Log a meal"}</h2>
        {!editing && (
          <>
            <label className="block text-sm">Meal name
              <input aria-label="meal name" className="mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-neutral-900" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Lentil soup" />
            </label>
            <label className="block text-sm">Meal type
              <select aria-label="meal type" className="mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-neutral-900" value={mealType} onChange={(e) => setMealType(e.target.value)}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block text-sm">Foods (comma separated)
              <input aria-label="foods" className="mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-neutral-900" value={foods} onChange={(e) => setFoods(e.target.value)} placeholder="lentils, carrots, onion" />
            </label>
            <label className="block text-sm">Calories (optional)
              <input aria-label="calories" type="number" min={0} className="mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-neutral-900" value={calories} onChange={(e) => setCalories(e.target.value)} placeholder="400" />
            </label>
            <label className="block text-sm">Notes
              <input aria-label="notes" className="mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-neutral-900" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
            </label>
          </>
        )}
        <div className="flex gap-2">
          <button type="submit" className="rounded bg-green-700 px-4 py-2 text-white">{editing ? "Save changes" : "Log meal"}</button>
          {editing && <button type="button" onClick={() => setEditing(null)} className="rounded border px-4 py-2">Cancel</button>}
        </div>
      </form>
      <section aria-label="Meal history">
        <h2 className="font-semibold text-lg">History</h2>
        {meals.length === 0 ? (
          <p className="text-sm opacity-80">No meals logged yet. Log your first meal above — your data stays on this laptop.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {meals.map((m) => (
              <li key={m.id} className="py-2 flex items-center gap-2 text-sm">
                <div className="flex-1">
                  <span className="font-medium">{m.name}</span> · {m.mealType} · {new Date(m.loggedAt).toLocaleString()}
                  {m.foods?.length ? <span className="opacity-70"> · {m.foods.map((f) => f.name).join(", ")}</span> : null}
                </div>
                <button aria-label={`Edit ${m.name}`} onClick={() => { setEditing(m); }} className="rounded border px-2 py-1">Edit</button>
                <button aria-label={`Delete ${m.name}`} onClick={() => void remove(m.id)} className="rounded border px-2 py-1">Delete</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
