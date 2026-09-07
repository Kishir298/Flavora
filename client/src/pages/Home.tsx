import { useState } from "react";
import { api, type Recommendation, type RecipeResult } from "../lib/api";
import { RecipeCard } from "../components/RecipeCard";

function toCard(r: Recommendation): RecipeResult {
  return {
    id: r.recipeId,
    title: r.title,
    cuisine: r.cuisine,
    cookTime: r.cookTime,
    ingredients: r.ingredients ?? [],
    nutrition: r.nutrition,
    image: r.image,
    score: r.score,
    pricePerServing: r.pricePerServing,
  };
}

/** Home / AI Food Assistant: conversational guidance → 3–5 handpicked suggestions with reasons. */
export function Home() {
  const [ingredients, setIngredients] = useState("pasta, tomato");
  const [maxTime, setMaxTime] = useState(30);
  const [craving, setCraving] = useState("");
  const [mode, setMode] = useState<"normal" | "budget">("normal");
  const [results, setResults] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function ask(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError("");
    try {
      // Craving is folded into available-ingredients matching server-side via
      // candidate search; the guide contract itself takes ingredients + time + mode.
      const have = ingredients.split(",").map((s) => s.trim()).filter(Boolean);
      const res = await api.recommendations({
        availableIngredients: craving ? [...have, craving] : have,
        timeLimit: Number(maxTime),
        mode,
      });
      setResults(res.recommendations);
      // "shown" rows are logged server-side; no extra view pings needed.
    } catch (err) {
      setError(err instanceof Error ? err.message : "recommendation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">What should you cook?</h1>
      <p className="mt-1 text-sm opacity-70">
        Tell Flavora what you have — it handpicks practical meals that use it up, so good food doesn't go to waste.
      </p>
      <form onSubmit={ask} className="mt-4 space-y-3" aria-label="assistant-form">
        <div>
          <label htmlFor="have" className="block text-sm font-medium">What do you have? (leftovers welcome)</label>
          <input id="have" className="mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700" value={ingredients} onChange={(e) => setIngredients(e.target.value)} placeholder="rice, broccoli, soy sauce" />
        </div>
        <div className="flex gap-4 flex-wrap">
          <div>
            <label htmlFor="time" className="block text-sm font-medium">Minutes available</label>
            <input id="time" type="number" min={5} max={180} value={maxTime} onChange={(e) => setMaxTime(Number(e.target.value))} className="mt-1 w-28 rounded border px-2 py-2 bg-white dark:bg-neutral-900" />
          </div>
          <div className="flex-1 min-w-40">
            <label htmlFor="craving" className="block text-sm font-medium">Mood / craving</label>
            <input id="craving" value={craving} onChange={(e) => setCraving(e.target.value)} placeholder="spicy noodles, comfort food…" className="mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700" />
          </div>
          <fieldset>
            <legend className="text-sm font-medium">Mode</legend>
            <div className="mt-1 flex gap-2">
              {(["normal", "budget"] as const).map((m) => (
                <label key={m} className="text-sm flex items-center gap-1 border rounded px-2 py-1 cursor-pointer">
                  <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                  {m === "budget" ? "Budget-friendly" : "Normal"}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <button type="submit" disabled={loading} className="px-4 py-2 rounded bg-green-600 text-white disabled:opacity-50">
          {loading ? "Thinking…" : "Suggest 3–5 recipes"}
        </button>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      <section aria-label="results" className="mt-6 grid gap-3">
        {results.map((r) => (
          <div key={r.recipeId}>
            <RecipeCard recipe={toCard(r)} />
            <ul className="mt-1 ml-1 text-xs opacity-70 list-disc list-inside" aria-label={`why ${r.title}`}>
              {r.matchReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        ))}
        {!loading && results.length === 0 && (
          <p className="text-sm opacity-60">No suggestions yet — tell Flavora what you have.</p>
        )}
      </section>
    </main>
  );
}
