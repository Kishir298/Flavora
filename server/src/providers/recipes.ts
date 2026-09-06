import type { Recipe } from "../recommender/types.js";
import { MOCK_RECIPES } from "./mockData.js";
import { config } from "../config.js";

export interface SearchParams {
  ingredients?: string[];
  maxTime?: number;
  craving?: string;
  cuisine?: string;
  number?: number;
}

/**
 * RecipeProvider — mock-first so dev/tests never burn the ~150 pts/day quota.
 * - mock: local fixtures (default, USE_MOCK_RECIPES=true)
 * - themealdb: free, no key (UI wiring; no allergy/nutrition tags)
 * - spoonacular: live (only when key present + flag off)
 */

export async function searchRecipes(params: SearchParams = {}): Promise<Recipe[]> {
  if (config.useMockRecipes) {
    return filterMock(params);
  }
  try {
    if (config.spoonacularKey) return await searchSpoonacular(params);
    return await searchTheMealDB(params);
  } catch (err) {
    console.warn("[flavora] live provider failed, falling back to mock:", (err as Error).message);
    return filterMock(params);
  }
}

export async function getRecipeById(id: string): Promise<Recipe | null> {
  const mock = MOCK_RECIPES.find((r) => r.id === id);
  if (mock) return mock;
  if (config.useMockRecipes) return null;
  if (id.startsWith("themealdb:")) return fetchMealDBById(id.split(":")[1]);
  if (/^\d+$/.test(id) || id.startsWith("spoonacular:")) {
    const sid = id.replace("spoonacular:", "");
    return fetchSpoonacularById(sid);
  }
  return null;
}

function filterMock(params: SearchParams): Recipe[] {
  let out = [...MOCK_RECIPES];
  if (params.cuisine) {
    out = out.filter((r) => r.cuisine?.toLowerCase() === params.cuisine!.toLowerCase());
  }
  if (params.maxTime !== undefined) {
    // Don't hard-exclude here — scorer handles timeFit. Only pre-trim absurd outliers (>2x).
    out = out.filter((r) => (r.cookTime ?? 30) <= params.maxTime! * 2);
  }
  if (params.craving) {
    const q = params.craving.toLowerCase();
    const scored = out.map((r) => ({
      r,
      hit: r.title.toLowerCase().includes(q) || r.ingredients.some((i) => i.toLowerCase().includes(q)),
    }));
    // Keep all (filtering is Layer 1's job), but bubble craving hits up.
    scored.sort((a, b) => Number(b.hit) - Number(a.hit));
    out = scored.map((s) => s.r);
  }
  return out.slice(0, params.number ?? 20);
}

// --- TheMealDB (free test key "1", no signup; no diet/nutrition data) ---
interface MealDBMeal {
  idMeal: string;
  strMeal: string;
  strArea?: string;
  strInstructions?: string;
  strMealThumb?: string;
  [k: string]: unknown;
}

function mealToRecipe(m: MealDBMeal): Recipe {
  const ingredients: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const ing = (m[`strIngredient${i}`] as string) ?? "";
    const measure = (m[`strMeasure${i}`] as string) ?? "";
    if (ing?.trim()) ingredients.push(`${measure} ${ing}`.trim());
  }
  return {
    id: `themealdb:${m.idMeal}`,
    source: "themealdb",
    title: m.strMeal,
    cuisine: (m.strArea ?? "").toLowerCase(),
    cookTime: 30,
    ingredients,
    instructions: (m.strInstructions ?? "").split(/\r?\n/).filter(Boolean).slice(0, 12),
    image: m.strMealThumb ?? "",
  };
}

export async function searchTheMealDB(params: SearchParams = {}): Promise<Recipe[]> {
  const q = params.craving?.trim() || "chicken";
  const res = await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`TheMealDB ${res.status}`);
  const data = (await res.json()) as { meals: MealDBMeal[] | null };
  return (data.meals ?? []).slice(0, params.number ?? 10).map(mealToRecipe);
}

async function fetchMealDBById(id: string): Promise<Recipe | null> {
  const res = await fetch(`https://www.themealdb.com/api/json/v1/1/lookup.php?i=${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { meals: MealDBMeal[] | null };
  const meal = data.meals?.[0];
  return meal ? mealToRecipe(meal) : null;
}

// --- Spoonacular (live; anonymous query params only — no profile identifiers) ---
interface SpoonResult {
  id: number;
  title: string;
  readyInMinutes?: number;
  image?: string;
  cuisines?: string[];
  extendedIngredients?: { original?: string; name?: string }[];
  analyzedInstructions?: { steps?: { step?: string }[] }[];
  nutrition?: { nutrients?: { name?: string; amount?: number }[] };
}

function spoonToRecipe(s: SpoonResult): Recipe {
  const nut = Object.fromEntries(
    (s.nutrition?.nutrients ?? []).map((n) => [(n.name ?? "").toLowerCase(), n.amount ?? 0])
  );
  return {
    id: `spoonacular:${s.id}`,
    source: "spoonacular",
    title: s.title,
    cuisine: (s.cuisines?.[0] ?? "").toLowerCase(),
    cookTime: s.readyInMinutes ?? 30,
    ingredients: (s.extendedIngredients ?? []).map((i) => i.original ?? i.name ?? "").filter(Boolean),
    instructions: (s.analyzedInstructions?.[0]?.steps ?? []).map((st) => st.step ?? "").filter(Boolean),
    nutrition: {
      calories: nut["calories"],
      protein: nut["protein"],
      carbs: nut["carbohydrates"],
      fat: nut["fat"],
    },
    image: s.image ?? "",
  };
}

export async function searchSpoonacular(params: SearchParams = {}): Promise<Recipe[]> {
  const u = new URL("https://api.spoonacular.com/recipes/complexSearch");
  u.searchParams.set("apiKey", config.spoonacularKey);
  u.searchParams.set("number", String(params.number ?? 10));
  u.searchParams.set("addRecipeInformation", "true");
  u.searchParams.set("addRecipeNutrition", "true");
  if (params.craving) u.searchParams.set("query", params.craving);
  if (params.cuisine) u.searchParams.set("cuisine", params.cuisine);
  if (params.maxTime) u.searchParams.set("maxReadyTime", String(params.maxTime));
  if (params.ingredients?.length) u.searchParams.set("includeIngredients", params.ingredients.join(","));
  const res = await fetch(u);
  if (!res.ok) throw new Error(`Spoonacular ${res.status}`);
  const data = (await res.json()) as { results: SpoonResult[] };
  return (data.results ?? []).map(spoonToRecipe);
}

async function fetchSpoonacularById(id: string): Promise<Recipe | null> {
  const u = new URL(`https://api.spoonacular.com/recipes/${id}/information`);
  u.searchParams.set("apiKey", config.spoonacularKey);
  u.searchParams.set("includeNutrition", "true");
  const res = await fetch(u);
  if (!res.ok) return null;
  return spoonToRecipe((await res.json()) as SpoonResult);
}
