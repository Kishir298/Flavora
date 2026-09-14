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

export interface SubstituteDetail {
  name: string;
  notes: string;
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
  substitutionDetails?: Record<string, SubstituteDetail[]>;
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

export interface AssistantIntent {
  availableIngredients?: string[];
  timeLimit?: number;
  cuisine?: string | null;
  mode?: RecommendMode;
  craving?: string | null;
  cravingSignals?: Record<string, string[]>;
}

export interface AssistantResponse {
  intent: AssistantIntent;
  source: "local" | "groq" | "heuristic" | "provided";
  notice?: string | null;
  reply: string;
  recommendations: Recommendation[];
}

export interface InventoryItem {
  id: number; name: string; quantity?: number | null; unit?: string | null;
  category: string; purchaseDate?: string | null; expiryDate?: string | null;
  notes?: string; status?: "fresh" | "expiring_soon" | "expired" | "unknown";
}

export interface GroceryItem {
  id: number; name: string; quantity?: number | null; unit?: string | null;
  note: string; category: string; checked: boolean; removed: boolean;
  source: string; recipeIds: string[];
}

export interface MealSlot {
  id: number; day: string; date: string; meal: string; recipeId: string;
  servings: number; appliedSubs: { originalName: string; replacementName: string }[];
}

export interface AppliedSub {
  id?: number; recipeId: string; originalName: string; replacementName: string;
  quantity?: number | null; unit?: string | null; safety?: "safe" | "unsafe" | "unknown";
}

const BASE = import.meta.env.VITE_API_URL ?? "";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = `${init?.method ?? "GET"} ${path} -> ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () =>
    req<{
      ok: boolean;
      ai?: {
        groqConfigured: boolean;
        providerSelection?: string;
        resolvedProvider?: string;
        localLlm?: { enabled: boolean; host: string; model: string; available: boolean };
      };
    }>("/api/health"),
  getProfile: () => req<Profile>("/api/profile"),
  saveProfile: (p: Partial<Profile>) =>
    req<Profile>("/api/profile", { method: "PUT", body: JSON.stringify(p) }),
  /** Canonical contract recommendations (matchReasons + mode). */
  recommendations: (body: {
    availableIngredients: string[];
    timeLimit?: number;
    mode?: RecommendMode;
    cuisine?: string;
    craving?: string;
    cravingSignals?: Record<string, string[]>;
    expiringIngredients?: string[];
    useInventory?: boolean;
  }) =>
    req<{ recommendations: Recommendation[] }>("/api/recommendations", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** Natural-language assistant → intent → same deterministic engine. */
  assistant: (body: { message: string; intent?: Partial<AssistantIntent> }) =>
    req<AssistantResponse>("/api/assistant", { method: "POST", body: JSON.stringify(body) }),
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
  // Substitutions (§5)
  listSubs: (recipeId: string) => req<AppliedSub[]>(`/api/substitutions?recipeId=${encodeURIComponent(recipeId)}`),
  applySub: (b: { recipeId: string; originalName: string; replacementName: string; quantity?: number | null; unit?: string | null }) =>
    req<AppliedSub>("/api/substitutions", { method: "POST", body: JSON.stringify(b) }),
  revertSub: (b: { recipeId: string; originalName: string }) =>
    req("/api/substitutions", { method: "DELETE", body: JSON.stringify(b) }),
  // Inventory (§9-10)
  inventory: () => req<InventoryItem[]>("/api/inventory"),
  expiring: () => req<InventoryItem[]>("/api/inventory/expiring"),
  addInventory: (b: Partial<InventoryItem> & { name: string }) =>
    req<InventoryItem>("/api/inventory", { method: "POST", body: JSON.stringify(b) }),
  updateInventory: (id: number, b: Partial<InventoryItem>) =>
    req<InventoryItem>(`/api/inventory/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  consumeInventory: (id: number, amount?: number) =>
    req<InventoryItem>(`/api/inventory/${id}/consume`, { method: "PATCH", body: JSON.stringify({ amount }) }),
  removeInventory: (id: number) => req(`/api/inventory/${id}`, { method: "DELETE" }),
  // Groceries (§8)
  groceries: () => req<GroceryItem[]>("/api/groceries"),
  addGrocery: (b: Partial<GroceryItem> & { name: string }) =>
    req<GroceryItem>("/api/groceries", { method: "POST", body: JSON.stringify(b) }),
  updateGrocery: (id: number, b: Partial<GroceryItem>) =>
    req<GroceryItem>(`/api/groceries/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  removeGrocery: (id: number, restore = false) =>
    req<GroceryItem>(`/api/groceries/${id}${restore ? "?restore=1" : ""}`, { method: "DELETE" }),
  clearGroceryCompleted: () => req("/api/groceries/clear-completed", { method: "POST" }),
  generateGroceries: (b: { recipeIds: string[]; useInventory?: boolean }) =>
    req<{ items: GroceryItem[]; merged: number; purchased: number }>("/api/groceries/generate", { method: "POST", body: JSON.stringify(b) }),
  // Meal plans (§11)
  mealPlans: () => req<MealSlot[]>("/api/meal-plans"),
  addMeal: (b: { day: string; meal: string; recipeId: string; servings?: number; date?: string }) =>
    req<MealSlot>("/api/meal-plans", { method: "POST", body: JSON.stringify(b) }),
  updateMeal: (id: number, b: Partial<MealSlot>) =>
    req<MealSlot>(`/api/meal-plans/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  removeMeal: (id: number) => req(`/api/meal-plans/${id}`, { method: "DELETE" }),
  clearMealDay: (day: string) => req("/api/meal-plans/clear-day", { method: "POST", body: JSON.stringify({ day }) }),
  mealNutrition: () => req<Record<string, { calories: number | null; protein: number | null; carbs: number | null; fat: number | null; unknown: boolean }>>("/api/meal-plans/nutrition/summary"),
};
