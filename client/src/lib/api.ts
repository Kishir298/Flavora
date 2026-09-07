export interface Profile {
  allergies: string[];
  avoidFoods: string[];
  cuisines: string[];
  spice: "mild" | "medium" | "hot";
  skill: string;
  nutritionGoals: { highProtein?: boolean; lowCarb?: boolean; maxCalories?: number };
  maxCookTime: number;
  theme: string;
}

export interface RecipeResult {
  id: string;
  title: string;
  cuisine?: string;
  cookTime?: number;
  ingredients: string[];
  instructions?: string[];
  nutrition?: { calories?: number; protein?: number; carbs?: number; fat?: number };
  image?: string;
  score?: number;
  pricePerServing?: number | null;
  substitutions?: Record<string, string[]>;
  storage?: string;
}

/** Guide step-5 contract (canonical AI-agent API). */
export interface Recommendation {
  recipeId: string;
  title: string;
  score: number;
  matchReasons: string[];
  cuisine?: string;
  cookTime?: number;
  ingredients?: string[];
  nutrition?: RecipeResult["nutrition"];
  image?: string;
  pricePerServing?: number | null;
}

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
  /** Canonical guide-contract recommendations (matchReasons + mode). */
  recommendations: (body: { availableIngredients: string[]; timeLimit?: number; mode?: "normal" | "budget"; cuisine?: string }) =>
    req<{ recommendations: Recommendation[] }>("/api/recommendations", { method: "POST", body: JSON.stringify(body) }),
  explain: (recipeId: string) =>
    req<{ recipeId: string; features: Record<string, number>; weights: Record<string, number>; score: number }>(
      `/api/debug/explain?recipeId=${encodeURIComponent(recipeId)}`
    ),
  recipe: (id: string) => req<RecipeResult>(`/api/recipes/${encodeURIComponent(id)}`),
  interact: (recipeId: string, action: string, rating?: number) =>
    req("/api/interactions", { method: "POST", body: JSON.stringify({ recipeId, action, rating }) }),
  saved: () => req<RecipeResult[]>("/api/saved"),
  seed: () => req("/api/dev/seed", { method: "POST" }),
  reset: () => req("/api/dev/reset", { method: "POST" }),
};
