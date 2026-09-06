import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type RecipeResult } from "../lib/api";

export function RecipeDetail() {
  const { id = "" } = useParams();
  const [recipe, setRecipe] = useState<RecipeResult | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.recipe(decodeURIComponent(id))
      .then(setRecipe)
      .catch((e) => setError(e instanceof Error ? e.message : "failed to load"));
  }, [id]);

  if (error) return <p role="alert" className="p-6 text-red-600">{error}</p>;
  if (!recipe) return <p className="p-6">Loading recipe…</p>;

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">{recipe.title}</h1>
      <p className="text-sm opacity-70 mt-1">
        {[recipe.cuisine, recipe.cookTime ? `${recipe.cookTime} min` : null].filter(Boolean).join(" · ")}
        {recipe.nutrition?.calories ? ` · ${recipe.nutrition.calories} kcal` : ""}
      </p>

      <div className="mt-4 flex gap-2">
        <button
          className="px-4 py-2 rounded bg-green-600 text-white"
          onClick={() => {
            api.interact(recipe.id, "saved").then(() => setSaved(true)).catch(() => {});
          }}
        >
          {saved ? "Saved ✓" : "Save"}
        </button>
        <button
          className="px-4 py-2 rounded border"
          onClick={() => {
            api.interact(recipe.id, "cooked").catch(() => {});
            alert("Logged as cooked — this feeds future personalization.");
          }}
        >
          I cooked this
        </button>
      </div>

      <section className="mt-6">
        <h2 className="font-semibold">Ingredients</h2>
        <ul className="list-disc ml-5 mt-1 text-sm">
          {recipe.ingredients.map((ing, i) => <li key={i}>{ing}</li>)}
        </ul>
      </section>

      <section className="mt-4">
        <h2 className="font-semibold">Steps</h2>
        <ol className="list-decimal ml-5 mt-1 text-sm space-y-1">
          {(recipe.instructions ?? []).map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      </section>

      {recipe.substitutions && Object.keys(recipe.substitutions).length > 0 && (
        <section className="mt-4">
          <h2 className="font-semibold">Substitutions (budget-friendly)</h2>
          <ul className="text-sm mt-1 space-y-1">
            {Object.entries(recipe.substitutions).map(([ing, subs]) => (
              <li key={ing}><span className="font-medium">{ing}:</span> {subs.join(", ")}</li>
            ))}
          </ul>
        </section>
      )}

      {recipe.nutrition && (
        <section className="mt-4">
          <h2 className="font-semibold">Nutrition</h2>
          <p className="text-sm mt-1">
            {recipe.nutrition.calories ? `${recipe.nutrition.calories} kcal` : ""}
            {recipe.nutrition.protein !== undefined ? ` · protein ${recipe.nutrition.protein}g` : ""}
            {recipe.nutrition.carbs !== undefined ? ` · carbs ${recipe.nutrition.carbs}g` : ""}
            {recipe.nutrition.fat !== undefined ? ` · fat ${recipe.nutrition.fat}g` : ""}
          </p>
        </section>
      )}

      {recipe.storage && (
        <section className="mt-4">
          <h2 className="font-semibold">Storage</h2>
          <p className="text-sm mt-1">{recipe.storage}</p>
        </section>
      )}
    </main>
  );
}
