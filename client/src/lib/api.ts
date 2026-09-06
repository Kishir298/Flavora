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
  substitutions?: Record<string, string[]>;
  storage?: string;
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
  recommend: (body: { ingredients: string[]; maxTime?: number; craving?: string; cuisine?: string }) =>
    req<{ results: RecipeResult[] }>("/api/recommend", { method: "POST", body: JSON.stringify(body) }),
  recipe: (id: string) => req<RecipeResult>(`/api/recipes/${encodeURIComponent(id)}`),
  interact: (recipeId: string, action: string, rating?: number) =>
    req("/api/interactions", { method: "POST", body: JSON.stringify({ recipeId, action, rating }) }),
  saved: () => req<RecipeResult[]>("/api/saved"),
  seed: () => req("/api/dev/seed", { method: "POST" }),
  reset: () => req("/api/dev/reset", { method: "POST" }),
};
