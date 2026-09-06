import { useState } from "react";
import { api, type RecipeResult } from "../lib/api";
import { RecipeCard } from "../components/RecipeCard";

const REGIONS = ["italian", "mexican", "chinese", "indian", "thai"];

/** Phase 3 stub: browse by region (wired to recommender via cuisine filter). */
export function Explorer() {
  const [cuisine, setCuisine] = useState("italian");
  const [results, setResults] = useState<RecipeResult[]>([]);

  async function browse(c: string) {
    setCuisine(c);
    const res = await api.recommend({ ingredients: [], craving: c, cuisine: c });
    setResults(res.results);
  }

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">Cuisine Explorer</h1>
      <div className="mt-3 flex flex-wrap gap-2">
        {REGIONS.map((r) => (
          <button
            key={r}
            onClick={() => void browse(r)}
            className={`px-3 py-1 rounded border text-sm ${cuisine === r ? "bg-green-600 text-white" : ""}`}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-3">
        {results.map((r) => <RecipeCard key={r.id} recipe={r} />)}
        {results.length === 0 && <p className="text-sm opacity-60">Pick a region to browse.</p>}
      </div>
    </main>
  );
}
