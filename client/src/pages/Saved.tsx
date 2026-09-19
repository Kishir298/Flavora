import { useEffect, useState } from "react";
import { api, type RecipeResult } from "../lib/api";
import { enqueueMutation, isNetworkError } from "../lib/mutationQueue";
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isNetworkError(msg)) {
        await enqueueMutation({
          operation: "interact",
          entityType: "recipe",
          entityId: id,
          payload: { recipeId: id, action: "unsaved" },
        });
        setItems((prev) => prev.filter((r) => r.id !== id));
        setMsg("Saved locally — will sync when back online.");
        return;
      }
      setMsg("Could not unsave — try again.");
    }
  }

  return (
<div className="p-6 max-w-2xl mx-auto">
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
            {r.unsafe && (
              <p role="alert" className="text-sm text-amber-800 bg-amber-100 rounded px-2 py-1">
                Heads up: this saved recipe now conflicts with your current allergies/avoid foods. Check ingredients before cooking.
              </p>
            )}
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
    </div>
  );
}
