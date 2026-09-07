export interface Profile {
  allergies: string[];
  avoidFoods: string[];
  favoriteCuisines: string[];
  spicePreference: "mild" | "medium" | "hot";
  skillLevel: string;
  nutritionGoals: { highProtein?: boolean; lowCarb?: boolean; maxCalories?: number };
  preferredCookTimeMinutes: number;
  theme: string;
}

export interface IngredientDetail {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  display: string;
  usedOwned?: boolean;
}

export interface RecipeResult {
  id: string;
  title: string;
  cuisine?: string;
  cookTime?: number;
  difficulty?: string;
  spiceLevel?: string;
  dietTags?: string[];
  costTier?: string;
  ingredients: string[];
  ingredientDetails?: IngredientDetail[];
  instructions?: string[];
  nutrition?: { calories?: number; protein?: number; protein_g?: number; carbs?: number; carbs_g?: number; fat?: number; fat_g?: number };
  score?: number;
  substitutions?: Record<string, string[]>;
  storage?: string;
  storageTips?: string;
}

/** §7.4 contract (canonical AI-agent API). */
export interface Recommendation {
  recipeId: string;
  title: string;
  score: number;
  matchReasons: string[];
  cuisine?: string;
  cookTime?: number;
  difficulty?: string;
  spiceLevel?: string;
  costTier?: string;
  ingredients?: string[];
  nutrition?: RecipeResult["nutrition"];
}

export type RecommendMode = "normal" | "food_waste" | "budget";

const BASE = import.meta.env.VITE_API_URL ?? "";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => req<{ ok: boolean }>("/api/health"),
  getProfile: () => req<Profile>("/api/profile"),
  saveProfile: (p: Partial<Profile>) =>
    req<Profile>("/api/profile", { method: "PUT", body: JSON.stringify(p) }),
  /** Canonical contract recommendations (matchReasons + mode). */
  recommendations: (body: { availableIngredients: string[]; timeLimit?: number; mode?: RecommendMode; cuisine?: string }) =>
    req<{ recommendations: Recommendation[] }>("/api/recommendations", { method: "POST", body: JSON.stringify(body) }),
  explain: (recipeId: string, mode?: RecommendMode) =>
    req<{ recipeId: string; features: Record<string, number>; weights: Record<string, number>; score: number }>(
      `/api/debug/explain?recipeId=${encodeURIComponent(recipeId)}${mode ? `&mode=${mode}` : ""}`
    ),
  recipe: (id: string, have?: string[]) =>
    req<RecipeResult>(`/api/recipes/${encodeURIComponent(id)}${have?.length ? `?have=${encodeURIComponent(have.join(","))}` : ""}`),
  interact: (recipeId: string, action: string, rating?: number) =>
    req("/api/interactions", { method: "POST", body: JSON.stringify({ recipeId, action, rating }) }),
  saved: () => req<RecipeResult[]>("/api/saved"),
  seed: () => req("/api/dev/seed", { method: "POST" }),
  reset: () => req("/api/dev/reset", { method: "POST" }),
};
