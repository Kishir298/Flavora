import { useState } from "react";
import { api, type Recommendation, type RecipeResult, type RecommendMode } from "../lib/api";
import { RecipeCard } from "../components/RecipeCard";

function toCard(r: Recommendation): RecipeResult {
  return {
    id: r.recipeId,
    title: r.title,
    cuisine: r.cuisine,
    cookTime: r.cookTime,
    difficulty: r.difficulty,
    costTier: r.costTier,
    ingredients: r.ingredients ?? [],
    nutrition: r.nutrition,
    score: r.score,
  };
}

function costLabel(tier?: string): string {
  if (!tier) return "";
  return `${tier} cost tier`;
}

const MODES: { value: RecommendMode; label: string; hint: string }[] = [
  { value: "normal", label: "Normal", hint: "Balanced ranking" },
  { value: "food_waste", label: "Use what I have", hint: "Prioritise ingredient overlap" },
  { value: "budget", label: "Budget-friendly", hint: "Prioritise low cost tier (not live prices)" },
];

/** Home / AI Food Assistant: structured form + optional natural-language ask. */
export function Home() {
  const [ingredients, setIngredients] = useState("pasta, tomato");
  const [maxTime, setMaxTime] = useState(30);
  const [craving, setCraving] = useState("");
  const [mode, setMode] = useState<RecommendMode>("normal");
  const [nl, setNl] = useState("");
  const [results, setResults] = useState<Recommendation[]>([]);
  const [reply, setReply] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [asked, setAsked] = useState(false);

  function rememberHave(have: string[]) {
    try {
      sessionStorage.setItem("flavora:lastHave", JSON.stringify(have));
    } catch {
      /* private mode */
    }
  }

  async function askStructured(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError("");
    setReply("");
    setNotice("");
    setAsked(true);
    try {
      const have = ingredients.split(",").map((s) => s.trim()).filter(Boolean);
      rememberHave(have);
      const res = await api.recommendations({
        availableIngredients: have,
        timeLimit: Number(maxTime),
        mode,
        craving: craving.trim() || undefined,
      });
      setResults(res.recommendations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "recommendation failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function askNatural(e?: React.FormEvent) {
    e?.preventDefault();
    if (!nl.trim()) return;
    setLoading(true);
    setError("");
    setAsked(true);
    try {
      const res = await api.assistant({ message: nl.trim() });
      setResults(res.recommendations);
      setReply(res.reply);
      setNotice(res.notice ?? "");
      if (res.intent.availableIngredients?.length) {
        rememberHave(res.intent.availableIngredients);
        setIngredients(res.intent.availableIngredients.join(", "));
      }
      if (res.intent.timeLimit) setMaxTime(res.intent.timeLimit);
      if (res.intent.mode) setMode(res.intent.mode);
      if (res.intent.craving) setCraving(res.intent.craving);
    } catch (err) {
      setError(err instanceof Error ? err.message : "assistant failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">What should you cook?</h1>
      <p className="mt-1 text-sm opacity-70">
        Tell Flavora what you have — it handpicks practical meals from your local recipe library.
        Allergy filtering always runs first.
      </p>

      <form onSubmit={askNatural} className="mt-4 space-y-2 rounded-lg border border-neutral-200 dark:border-neutral-700 p-3" aria-label="natural-language-form">
        <label htmlFor="nl" className="block text-sm font-medium">Ask in plain language</label>
        <textarea
          id="nl"
          rows={2}
          value={nl}
          onChange={(e) => setNl(e.target.value)}
          placeholder='e.g. "I have chicken, rice and onions — something easy in 20 minutes"'
          className="mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700"
        />
        <button type="submit" disabled={loading || !nl.trim()} className="px-4 py-2 rounded bg-green-700 text-white disabled:opacity-50">
          {loading ? "Thinking…" : "Ask Flavora"}
        </button>
        <p className="text-xs opacity-60">
          Optional AI parses intent on the server; ranking stays local and allergy-safe. Works without an API key via local parsing.
        </p>
      </form>

      <form onSubmit={askStructured} className="mt-6 space-y-3" aria-label="assistant-form">
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
            <div className="mt-1 flex gap-2 flex-wrap">
              {MODES.map((m) => (
                <label key={m.value} className="text-sm flex items-center gap-1 border rounded px-2 py-1 cursor-pointer" title={m.hint}>
                  <input type="radio" name="mode" checked={mode === m.value} onChange={() => setMode(m.value)} />
                  {m.label}
                </label>
              ))}
            </div>
            {mode === "budget" && (
              <p className="mt-1 text-xs opacity-60">Uses recipe cost tiers (low / medium / high), not live supermarket prices.</p>
            )}
          </fieldset>
        </div>
        <button type="submit" disabled={loading} className="px-4 py-2 rounded bg-green-600 text-white disabled:opacity-50">
          {loading ? "Thinking…" : "Suggest 3–5 recipes"}
        </button>
      </form>

      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      {notice && <p className="mt-3 text-sm text-amber-800 dark:text-amber-200" role="status">{notice}</p>}
      {reply && <p className="mt-3 text-sm opacity-90" role="status">{reply}</p>}

      <section aria-label="results" className="mt-6 grid gap-3" aria-live="polite">
        {results.map((r) => (
          <div key={r.recipeId}>
            <RecipeCard recipe={toCard(r)} />
            <p className="mt-1 ml-1 text-xs opacity-70">
              {[costLabel(r.costTier), ...(r.matchReasons ?? [])].filter(Boolean).join(" · ")}
            </p>
          </div>
        ))}
        {asked && !loading && results.length === 0 && !error && (
          <div className="text-sm opacity-80 space-y-1" role="status">
            <p>No strong matches in your local library for that request.</p>
            <ul className="list-disc ml-5">
              <li>Try listing more ingredients you have</li>
              <li>Increase your time limit</li>
              <li>Try another cuisine in Explorer</li>
              <li>Allergy and avoid-food filters stay on — we never suggest ignoring them</li>
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
