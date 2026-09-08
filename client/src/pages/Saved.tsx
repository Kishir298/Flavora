import { useEffect, useState } from "react";
import { api, type RecipeResult } from "../lib/api";
import { RecipeCard } from "../components/RecipeCard";

export function Saved() {
  const [items, setItems] = useState<RecipeResult[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    try {
      setItems(await api.saved());
      setError("");
    } catch {
      setItems([]);
      setError("Could not load saved recipes.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function unsave(id: string) {
    try {
      await api.interact(id, "unsaved");
      setMsg("Removed from Saved.");
      await load();
    } catch {
      setMsg("Could not unsave — try again.");
    }
  }

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">Saved</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
      {msg && (
        <p role="status" className="mt-2 text-sm text-green-700 dark:text-green-400">
          {msg}
        </p>
      )}
      <div className="mt-4 grid gap-3">
        {items.map((r) => (
          <div key={r.id} className="flex flex-col gap-1">
            <RecipeCard recipe={r} />
            <button
              type="button"
              className="self-start text-sm underline opacity-80"
              onClick={() => void unsave(r.id)}
            >
              Remove from Saved
            </button>
          </div>
        ))}
        {items.length === 0 && !error && (
          <div className="text-sm opacity-70 space-y-1" role="status">
            <p>Nothing saved yet.</p>
            <p>Open a recipe from the Assistant or Explorer and tap Save — it will show up here after refresh.</p>
          </div>
        )}
      </div>
    </main>
  );
}
