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

/** "Matches your profile" badge from the same feature set (§4.6): strong
 * cuisine/nutrition/skill/spice signal, not just a high blended score. */
function profileBadge(r: Recommendation): string | undefined {
  const reasons = r.matchReasons.join(" ").toLowerCase();
  if (/matches your .* preference|fits your nutrition goal|matches your skill level/.test(reasons)) {
    return "matches your profile";
  }
  return undefined;
}

export function Explorer() {
  const [cuisine, setCuisine] = useState("italian");
  const [results, setResults] = useState<Recommendation[]>([]);
  const [error, setError] = useState("");

  async function browse(c: string) {
    setCuisine(c);
    setError("");
    try {
      const res = await api.recommendations({ availableIngredients: [], timeLimit: 120, cuisine: c });
      setResults(res.recommendations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "browse failed");
    }
  }

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">Cuisine Explorer</h1>
      <p className="mt-1 text-sm opacity-70">Ten world cuisines — always filtered to your allergies.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {REGIONS.map((r) => (
          <button
            key={r}
            onClick={() => void browse(r)}
            className={`px-3 py-1 rounded border text-sm capitalize ${cuisine === r ? "bg-green-600 text-white" : ""}`}
          >
            {r}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 grid gap-3">
        {results.map((r) => (
          <div key={r.recipeId}>
            <RecipeCard recipe={toCard(r)} badge={profileBadge(r)} />
            {r.matchReasons.length > 0 && (
              <p className="mt-1 ml-1 text-xs opacity-70">{r.matchReasons.join(" · ")}</p>
            )}
          </div>
        ))}
        {results.length === 0 && <p className="text-sm opacity-60">Pick a region to browse.</p>}
      </div>
    </main>
  );
}
