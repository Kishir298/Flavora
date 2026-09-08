import { useState } from "react";
import { api, type Recommendation, type RecipeResult } from "../lib/api";
import { RecipeCard } from "../components/RecipeCard";

/** Mission cuisines (§4.6): explore diverse dishes, still allergy-safe. */
const REGIONS = [
  "italian",
  "indian",
  "chinese",
  "japanese",
  "mexican",
  "french",
  "american",
  "mediterranean",
  "middle eastern",
  "african",
];

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

function profileBadge(r: Recommendation): string | undefined {
  const reasons = r.matchReasons.join(" ").toLowerCase();
  if (/matches your|fits your|nutritional goals|skill level|spice preference/.test(reasons)) {
    return "matches your profile";
  }
  return undefined;
}

export function Explorer() {
  const [cuisine, setCuisine] = useState("");
  const [results, setResults] = useState<Recommendation[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [browsed, setBrowsed] = useState(false);

  async function browse(c: string) {
    setCuisine(c);
    setError("");
    setLoading(true);
    setBrowsed(true);
    try {
      const res = await api.recommendations({ availableIngredients: [], timeLimit: 120, cuisine: c });
      setResults(res.recommendations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "browse failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">Cuisine Explorer</h1>
      <p className="mt-1 text-sm opacity-70">
        Ten world cuisines — ranked by your profile, always filtered to your allergies.
      </p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="cuisines">
        {REGIONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => void browse(r)}
            aria-pressed={cuisine === r}
            className={`px-3 py-1 rounded border text-sm capitalize ${cuisine === r ? "bg-green-600 text-white" : ""}`}
          >
            {r}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
      {loading && <p className="mt-3 text-sm opacity-70">Loading…</p>}
      <div className="mt-4 grid gap-3" aria-live="polite">
        {results.map((r) => (
          <div key={r.recipeId}>
            <RecipeCard recipe={toCard(r)} badge={profileBadge(r)} />
            {r.matchReasons.length > 0 && (
              <p className="mt-1 ml-1 text-xs opacity-70">{r.matchReasons.join(" · ")}</p>
            )}
          </div>
        ))}
        {!browsed && <p className="text-sm opacity-60">Pick a region to browse.</p>}
        {browsed && !loading && results.length === 0 && !error && (
          <div className="text-sm opacity-80 space-y-1" role="status">
            <p>No safe matches for {cuisine || "this cuisine"} with your current profile.</p>
            <p>Try another cuisine — we never suggest ignoring allergies or avoid foods.</p>
          </div>
        )}
      </div>
    </main>
  );
}
