import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type RecipeResult } from "../lib/api";

function nutritionLine(n?: RecipeResult["nutrition"]): string {
  if (!n) return "";
  const parts: string[] = [];
  if (n.calories !== undefined) parts.push(`${n.calories} kcal`);
  const protein = n.protein_g ?? n.protein;
  const carbs = n.carbs_g ?? n.carbs;
  const fat = n.fat_g ?? n.fat;
  if (protein !== undefined) parts.push(`protein ${protein}g`);
  if (carbs !== undefined) parts.push(`carbs ${carbs}g`);
  if (fat !== undefined) parts.push(`fat ${fat}g`);
  return parts.join(" · ");
}

export function RecipeDetail() {
  const { id = "" } = useParams();
  const [recipe, setRecipe] = useState<RecipeResult | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let have: string[] | undefined;
    try {
      have = JSON.parse(sessionStorage.getItem("flavora:lastHave") ?? "[]");
      if (!Array.isArray(have) || have.length === 0) have = undefined;
    } catch {
      have = undefined;
    }
    api.recipe(decodeURIComponent(id), have)
      .then(setRecipe)
      .catch((e) => setError(e instanceof Error ? e.message : "failed to load"));
  }, [id]);

  if (error) return <p role="alert" className="p-6 text-red-600">{error}</p>;
  if (!recipe) return <p className="p-6">Loading recipe…</p>;

  const box = "rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3";
  const ownedCount = recipe.ingredientDetails?.filter((i) => i.usedOwned).length ?? 0;
  const shownIngredients: { display: string; usedOwned?: boolean }[] =
    recipe.ingredientDetails ?? recipe.ingredients.map((name) => ({ display: name }));

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">{recipe.title}</h1>
      <p className="text-sm opacity-70 mt-1">
        {[recipe.cuisine, recipe.cookTime ? `${recipe.cookTime} min` : null, recipe.difficulty, recipe.costTier ? `${recipe.costTier} cost` : null].filter(Boolean).join(" · ")}
        {nutritionLine(recipe.nutrition) ? ` · ${nutritionLine(recipe.nutrition).split(" · ")[0]}` : ""}
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

      <div className="mt-6 grid gap-3">
        <details className={box} open>
          <summary className="font-semibold cursor-pointer">Ingredients</summary>
          <p className="mt-1 text-xs opacity-70" role="note">
            Allergy filtering is best-effort — recipe data can be incomplete or worded
            unusually. Please check this full list yourself before cooking.
          </p>
          {ownedCount > 0 && (
            <p className="mt-1 text-xs text-green-700 dark:text-green-400">
              Uses {ownedCount} ingredient{ownedCount === 1 ? "" : "s"} you listed as on hand (✓).
            </p>
          )}
          <ul className="list-disc ml-5 mt-1 text-sm">
            {shownIngredients.map((ing, i) => (
              <li key={i}>
                {ing.display}
                {ing.usedOwned ? " ✓" : ""}
              </li>
            ))}
          </ul>
        </details>

        <details className={box} open>
          <summary className="font-semibold cursor-pointer">Steps</summary>
          <ol className="list-decimal ml-5 mt-1 text-sm space-y-1">
            {(recipe.instructions ?? []).map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </details>

        <details className={box}>
          <summary className="font-semibold cursor-pointer">Prep Tips</summary>
          <ul className="list-disc ml-5 mt-1 text-sm space-y-1">
            <li>Difficulty: {recipe.difficulty ?? "easy"}{recipe.cookTime ? ` · about ${recipe.cookTime} minutes` : ""}.</li>
            {recipe.spiceLevel && <li>Spice level: {recipe.spiceLevel}.</li>}
            {recipe.dietTags && recipe.dietTags.length > 0 && <li>Suitable for: {recipe.dietTags.join(", ")}.</li>}
            <li>Read through all steps once before you start cooking.</li>
          </ul>
        </details>

        {recipe.substitutions && Object.keys(recipe.substitutions).length > 0 && (
          <details className={box}>
            <summary className="font-semibold cursor-pointer">Substitutions</summary>
            <ul className="text-sm mt-1 space-y-1">
              {Object.entries(recipe.substitutions).map(([ing, subs]) => (
                <li key={ing}><span className="font-medium">{ing}:</span> {subs.join(", ")}</li>
              ))}
            </ul>
          </details>
        )}

        {recipe.nutrition && (
          <details className={box}>
            <summary className="font-semibold cursor-pointer">Nutrition</summary>
            <p className="text-sm mt-1">{nutritionLine(recipe.nutrition) || "No nutrition data."}</p>
            <p className="text-xs opacity-60 mt-1">Authored estimates per serving, not lab-verified.</p>
          </details>
        )}

        {(recipe.storage ?? recipe.storageTips) && (
          <details className={box}>
            <summary className="font-semibold cursor-pointer">Storage</summary>
            <p className="text-sm mt-1">{recipe.storage ?? recipe.storageTips}</p>
          </details>
        )}
      </div>
    </main>
  );
}
