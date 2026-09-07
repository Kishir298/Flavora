import { Link } from "react-router-dom";
import type { RecipeResult } from "../lib/api";

export function RecipeCard({ recipe, badge }: { recipe: RecipeResult; badge?: string }) {
  return (
    <Link
      to={`/recipe/${encodeURIComponent(recipe.id)}`}
      className="block rounded-lg border border-neutral-200 dark:border-neutral-700 p-4 hover:shadow-md transition-shadow bg-white dark:bg-neutral-900"
      aria-label={`Open ${recipe.title}`}
    >
      <h3 className="font-semibold text-lg">{recipe.title}</h3>
      {badge && (
        <p className="mt-1 inline-block text-xs rounded-full bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-2 py-0.5">
          {badge}
        </p>
      )}
      <p className="text-sm opacity-70 mt-1">
        {[recipe.cuisine, recipe.cookTime ? `${recipe.cookTime} min` : null, recipe.difficulty, recipe.costTier ? `${recipe.costTier} cost` : null].filter(Boolean).join(" · ") || "Recipe"}
        {recipe.score !== undefined ? ` · score ${recipe.score.toFixed(2)}` : ""}
      </p>
      <p className="text-sm mt-2 opacity-80 line-clamp-2">{recipe.ingredients.slice(0, 5).join(", ")}</p>
    </Link>
  );
}
