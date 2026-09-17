import { useEffect, useState } from "react";
import { api, type MealLog } from "../lib/api";
import { enqueueMealLog } from "../lib/mealQueue";

const TYPES = ["breakfast", "lunch", "dinner", "snack", "other"] as const;

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const blank = () => ({
  name: "", mealType: "dinner", loggedAt: toLocalInput(new Date().toISOString()),
  foods: "", servings: "", calories: "", protein: "", carbs: "", fat: "", tags: "", notes: "",
});

export function Meals() {
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [form, setForm] = useState(blank());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [waterMl, setWaterMl] = useState("");
  const [waterToday, setWaterToday] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const reload = async () => {
    try {
      const [m, w] = await Promise.all([api.mealLog.list(), api.water()]);
      setMeals(m);
      const today = new Date().toISOString().slice(0, 10);
      setWaterToday(w.filter((r) => r.loggedAt.slice(0, 10) === today).reduce((a, r) => a + r.ml, 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => { void reload(); }, []);

  const set = (k: keyof ReturnType<typeof blank>, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setMsg("");
    if (!form.name.trim()) { setError("Meal name is required."); return; }
    const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
    const body = {
      name: form.name.trim(),
      mealType: form.mealType as MealLog["mealType"],
      loggedAt: form.loggedAt ? new Date(form.loggedAt).toISOString() : new Date().toISOString(),
      foods: form.foods.split(",").map((s) => s.trim()).filter(Boolean).map((n) => ({ name: n })),
      servings: num(form.servings),
      nutrition: { calories: num(form.calories), protein_g: num(form.protein), carbs_g: num(form.carbs), fat_g: num(form.fat) },
      tags: form.tags.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
      notes: form.notes,
    };
    try {
      if (editingId) {
        try { await api.mealLog.update(editingId, body); }
        catch { await enqueueMealLog("update", { ...body, id: editingId }); setMsg("Saved locally — will sync when online."); }
        setEditingId(null);
      } else {
        try { await api.mealLog.add(body); }
        catch { await enqueueMealLog("add", body); setMsg("Saved locally — will sync when online."); }
      }
      setForm(blank());
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function startEdit(m: MealLog) {
    setEditingId(m.id);
    setForm({
      name: m.name, mealType: m.mealType, loggedAt: toLocalInput(m.loggedAt),
      foods: (m.foods ?? []).map((f) => f.name).join(", "),
      servings: m.servings != null ? String(m.servings) : "",
      calories: m.nutrition?.calories != null ? String(m.nutrition.calories) : "",
      protein: m.nutrition?.protein_g != null ? String(m.nutrition.protein_g) : "",
      carbs: m.nutrition?.carbs_g != null ? String(m.nutrition.carbs_g) : "",
      fat: m.nutrition?.fat_g != null ? String(m.nutrition.fat_g) : "",
      tags: (m.tags ?? []).join(", "), notes: m.notes ?? "",
    });
    window.scrollTo({ top: 0 });
  }

  async function remove(id: string) {
    try { await api.mealLog.remove(id); }
    catch { await enqueueMealLog("remove", { id }); setMsg("Delete queued — will sync when online."); }
    await reload();
  }

  async function logWater(e: React.FormEvent) {
    e.preventDefault();
    const ml = Number(waterMl);
    if (!Number.isFinite(ml) || ml <= 0) { setError("Enter water in ml."); return; }
    try { await api.addWater(ml); setWaterMl(""); await reload(); }
    catch { setError("Could not log water."); }
  }

  const q = query.trim().toLowerCase();
  const visible = meals.filter((m) =>
    (typeFilter === "all" || m.mealType === typeFilter) &&
    (!q || m.name.toLowerCase().includes(q) ||
      (m.foods ?? []).some((f) => f.name.toLowerCase().includes(q)) ||
      (m.tags ?? []).some((t) => t.toLowerCase().includes(q)))
  );

  const input = "mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-neutral-900";
  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Meals</h1>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {msg && <p role="status" className="text-sm">{msg}</p>}
      <form onSubmit={submit} className="rounded border border-neutral-200 dark:border-neutral-800 p-4 space-y-2 bg-white dark:bg-neutral-900">
        <h2 className="font-semibold">{editingId ? "Edit meal" : "Log a meal"}</h2>
        <label className="block text-sm">Meal name
          <input aria-label="meal name" className={input} value={form.name} onChange={(e) => set("name", e.target.value)} required placeholder="Lentil soup" />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-sm">Meal type
            <select aria-label="meal type" className={input} value={form.mealType} onChange={(e) => set("mealType", e.target.value)}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="block text-sm">Date & time
            <input aria-label="date and time" type="datetime-local" className={input} value={form.loggedAt} onChange={(e) => set("loggedAt", e.target.value)} />
          </label>
        </div>
        <label className="block text-sm">Foods (comma separated)
          <input aria-label="foods" className={input} value={form.foods} onChange={(e) => set("foods", e.target.value)} placeholder="lentils, carrots, onion" />
        </label>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block text-sm">Servings
            <input aria-label="servings" type="number" min={0} step="any" className={input} value={form.servings} onChange={(e) => set("servings", e.target.value)} />
          </label>
          <label className="block text-sm">Calories
            <input aria-label="calories" type="number" min={0} step="any" className={input} value={form.calories} onChange={(e) => set("calories", e.target.value)} />
          </label>
          <label className="block text-sm">Protein (g)
            <input aria-label="protein grams" type="number" min={0} step="any" className={input} value={form.protein} onChange={(e) => set("protein", e.target.value)} />
          </label>
          <label className="block text-sm">Carbs (g)
            <input aria-label="carbs grams" type="number" min={0} step="any" className={input} value={form.carbs} onChange={(e) => set("carbs", e.target.value)} />
          </label>
          <label className="block text-sm">Fat (g)
            <input aria-label="fat grams" type="number" min={0} step="any" className={input} value={form.fat} onChange={(e) => set("fat", e.target.value)} />
          </label>
          <label className="block text-sm">Tags (comma separated)
            <input aria-label="tags" className={input} value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder="vegetarian, homemade" />
          </label>
        </div>
        <label className="block text-sm">Notes
          <input aria-label="notes" className={input} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="optional" />
        </label>
        <div className="flex gap-2">
          <button type="submit" className="rounded bg-green-700 px-4 py-2 text-white">{editingId ? "Save changes" : "Log meal"}</button>
          {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(blank()); }} className="rounded border px-4 py-2">Cancel</button>}
        </div>
      </form>
      <form onSubmit={logWater} className="rounded border border-neutral-200 dark:border-neutral-800 p-4 bg-white dark:bg-neutral-900" aria-label="water log">
        <h2 className="font-semibold">Water{waterToday != null && waterToday > 0 ? ` — ${waterToday} ml today` : ""}</h2>
        <div className="flex gap-2 mt-2">
          <input aria-label="water ml" type="number" min={1} className={input} value={waterMl} onChange={(e) => setWaterMl(e.target.value)} placeholder="250" />
          <button type="submit" className="rounded bg-green-700 px-4 py-2 text-white whitespace-nowrap">Log water</button>
        </div>
      </form>
      <section aria-label="Meal history">
        <h2 className="font-semibold text-lg">History</h2>
        <div className="flex gap-2 mt-2 flex-wrap">
          <input aria-label="search meals" className="flex-1 min-w-40 rounded border px-3 py-2 bg-white dark:bg-neutral-900" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, food, tag…" />
          <select aria-label="filter by type" className="rounded border px-3 py-2 bg-white dark:bg-neutral-900" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">all types</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {meals.length === 0 ? (
          <p className="text-sm opacity-80 mt-2">No meals logged yet. Log your first meal above — your data stays on this laptop.</p>
        ) : visible.length === 0 ? (
          <p className="text-sm opacity-80 mt-2" role="status">No meals match your search.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {visible.map((m) => (
              <li key={m.id} className="py-2 flex items-center gap-2 text-sm">
                <div className="flex-1">
                  <span className="font-medium">{m.name}</span> · {m.mealType} · {new Date(m.loggedAt).toLocaleString()}
                  {m.foods?.length ? <span className="opacity-70"> · {m.foods.map((f) => f.name).join(", ")}</span> : null}
                  {m.nutrition?.calories != null ? <span className="opacity-70"> · {m.nutrition.calories} kcal</span> : null}
                  {m.tags?.length ? <span className="opacity-70"> · {m.tags.join(", ")}</span> : null}
                </div>
                <button aria-label={`Edit ${m.name}`} onClick={() => startEdit(m)} className="rounded border px-2 py-1">Edit</button>
                <button aria-label={`Delete ${m.name}`} onClick={() => void remove(m.id)} className="rounded border px-2 py-1">Delete</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
