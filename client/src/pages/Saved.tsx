import { useEffect, useState } from "react";
import { api, type RecipeResult } from "../lib/api";
import { RecipeCard } from "../components/RecipeCard";

export function Saved() {
  const [items, setItems] = useState<RecipeResult[]>([]);
  useEffect(() => {
    api.saved().then(setItems).catch(() => setItems([]));
  }, []);
  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">Saved</h1>
      <div className="mt-4 grid gap-3">
        {items.map((r) => <RecipeCard key={r.id} recipe={r} />)}
        {items.length === 0 && <p className="text-sm opacity-60">Nothing saved yet.</p>}
      </div>
    </main>
  );
}
