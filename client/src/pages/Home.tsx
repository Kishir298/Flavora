import { useState } from "react";
import { api, type RecipeResult } from "../lib/api";
import { RecipeCard } from "../components/RecipeCard";

/** Home / AI Assistant: form/chat-lite input → 3–5 allergy-safe suggestions. */
export function Home() {
  const [ingredients, setIngredients] = useState("pasta, tomato");
  const [maxTime, setMaxTime] = useState(30);
  const [craving, setCraving] = useState("");
  const [results, setResults] = useState<RecipeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function ask(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api.recommend({
        ingredients: ingredients.split(",").map((s) => s.trim()).filter(Boolean),
        maxTime: Number(maxTime),
        craving: craving || undefined,
      });
      setResults(res.results);
      // Log views for learning layer (fire-and-forget).
      for (const r of res.results) {
        api.interact(r.id, "viewed").catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "recommendation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">What should you cook?</h1>
      <form onSubmit={ask} className="mt-4 space-y-3" aria-label="assistant-form">
        <div>
          <label htmlFor="have" className="block text-sm font-medium">What do you have?</label>
          <input id="have" className="mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700" value={ingredients} onChange={(e) => setIngredients(e.target.value)} placeholder="rice, broccoli, soy sauce" />
        </div>
        <div className="flex gap-4">
          <div>
            <label htmlFor="time" className="block text-sm font-medium">Minutes available</label>
            <input id="time" type="number" min={5} max={180} value={maxTime} onChange={(e) => setMaxTime(Number(e.target.value))} className="mt-1 w-28 rounded border px-2 py-2 bg-white dark:bg-neutral-900" />
          </div>
          <div className="flex-1">
            <label htmlFor="craving" className="block text-sm font-medium">Mood / craving</label>
            <input id="craving" value={craving} onChange={(e) => setCraving(e.target.value)} placeholder="spicy noodles, comfort food…" className="mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700" />
          </div>
        </div>
        <button type="submit" disabled={loading} className="px-4 py-2 rounded bg-green-600 text-white disabled:opacity-50">
          {loading ? "Thinking…" : "Suggest 3–5 recipes"}
        </button>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      <section aria-label="results" className="mt-6 grid gap-3">
        {results.map((r) => (
          <RecipeCard key={r.id} recipe={r} />
        ))}
        {!loading && results.length === 0 && (
          <p className="text-sm opacity-60">No suggestions yet — tell Flavora what you have.</p>
        )}
      </section>
    </main>
  );
}
