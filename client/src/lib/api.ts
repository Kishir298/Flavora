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
  nutritionSource?: "authored" | "usda" | "openfoodfacts" | "cache" | "unknown";
  unsafe?: boolean;
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
  nutritionSource?: RecipeResult["nutritionSource"];
}

export type RecommendMode = "normal" | "food_waste" | "budget";

export interface AssistantIntent {
  availableIngredients?: string[];
  timeLimit?: number;
  cuisine?: string | null;
  mode?: RecommendMode;
  craving?: string | null;
  cravingSignals?: Record<string, string[]>;
  expiringIngredients?: string[];
  allergies?: string[];
  avoidFoods?: string[];
  dietaryPreference?: string;
  mealType?: string;
  calorieTarget?: number;
  spiceLevel?: string;
  skillLevel?: string;
  servings?: number;
  maxCookingTime?: number;
  foodRequest?: Record<string, unknown>;
}

export interface AssistantResponse {
  intent: AssistantIntent;
  source: "local" | "heuristic" | "provided";
  notice?: string | null;
  fallbackReason?: "none" | "heuristic-mode" | "local-unreachable" | "local-timeout" | "local-invalid" | "local-unloaded";
  reply: string;
  recommendations: Recommendation[];
}

export interface InventoryItem {
  id: number; name: string; quantity?: number | null; unit?: string | null;
  category: string; purchaseDate?: string | null; expiryDate?: string | null;
  notes?: string; status?: "fresh" | "expiring_soon" | "expired" | "unknown";
  daysRemaining?: number | null;
}

export interface GroceryItem {
  id: number; name: string; quantity?: number | null; unit?: string | null;
  note: string; category: string; checked: boolean; removed: boolean;
  source: string; recipeIds: string[];
}

export interface MealLog {
  id: string; name: string; mealType: "breakfast" | "lunch" | "dinner" | "snack" | "other";
  loggedAt: string; foods: { name: string; quantity?: number | null; unit?: string | null }[];
  servings?: number | null;
  nutrition?: { calories?: number | null; protein_g?: number | null; carbs_g?: number | null; fat_g?: number | null } | null;
  tags?: string[]; notes?: string;
}

export interface Goals {
  maxCalories?: number | null; protein_g?: number | null; mealsPerDay?: number | null;
  vegMealsPerWeek?: number | null; waterMlPerDay?: number | null; cookTimesPerWeek?: number | null;
  updatedAt?: string | null;
}

export interface StatsBucket { date: string; meals: number; calories: number | null; protein_g: number | null }
export interface StatsResult {
  status: "ok" | "insufficient"; reason?: string; range: string;
  totalMeals: number; activeDays: number; mealsPerDay: number[];
  byType: Record<string, number>; variety: { uniqueFoods: number; uniqueMeals: number };
  repeats: { name: string; count: number }[];
  nutrition: { calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; daysWithData: number };
  goalProgress: { label: string; target: number | null; actual: number; met: boolean | null }[];
  buckets: StatsBucket[]; waterMl: number | null;
  timing: { byHour: number[]; morning: number; afternoon: number; evening: number; night: number };
  averages: { mealsPerDay: number | null; caloriesPerDay: number | null };
  cuisineVariety: { cuisines: string[]; count: number };
  waste: { expiring: number; expired: number } | null;
}

export interface Insight { id: string; text: string; kind: string }

export interface MealSlot {
  id: number; day: string; date: string; meal: string; recipeId: string;
  servings: number; appliedSubs: { originalName: string; replacementName: string }[];
}

export interface AppliedSub {
  id?: number; recipeId: string; originalName: string; replacementName: string;
  quantity?: number | null; unit?: string | null; safety?: "safe" | "unsafe" | "unknown";
}

const RAW_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const BASE = RAW_BASE.replace(/\/$/, "");

async function req<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = 30_000, ...fetchInit } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...fetchInit,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw e instanceof Error ? e : new Error(String(e));
  }
  clearTimeout(timer);
  if (!res.ok) {
    let detail = `${fetchInit?.method ?? "GET"} ${path} -> ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  // 204 No Content / empty body (DELETEs) — don't crash on res.json().
  if (res.status === 204) return null as T;
  // Prefer text() when available (handles empty bodies); fall back to json()
  // for test mocks that only stub json().
  const anyRes = res as Response & { text?: () => Promise<string>; json?: () => Promise<unknown> };
  if (typeof anyRes.text === "function") {
    try {
      const text = await anyRes.text();
      if (!text) return null as T;
      return JSON.parse(text) as T;
    } catch {
      // Empty/unparseable body on success → null (DELETE-style).
      return null as T;
    }
  }
  if (typeof anyRes.json === "function") {
    try {
      return (await anyRes.json()) as T;
    } catch {
      return null as T;
    }
  }
  return null as T;
}

export const api = {
  health: () =>
    req<{
      ok: boolean;
      ai?: {
        providerSelection?: string;
        configuredProvider?: string;
        resolvedProvider?: string;
        remoteConfigured?: boolean;
        localLlm?: { enabled: boolean; host: string; model: string; available: boolean };
        localModel?: {
          name: string;
          version: string | null;
          serviceReachable: boolean;
          loaded: boolean;
          device: string | null;
          tokenizerVersion: string | null;
          parameterCount: number | null;
        };
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
  assistant: (body: { message: string; intent?: Partial<AssistantIntent>; context?: "week-summary" | "yesterday" | "repeats" | "goals" | "waste" }) =>
    req<AssistantResponse & { facts?: Record<string, unknown> }>("/api/assistant", { method: "POST", body: JSON.stringify(body) }),
  /** Conversational requirement gathering → structured FoodRequest → engine. */
  conversation: (body: { sessionId?: string; message: string }) =>
    req<{
      sessionId: string; question: string | null; done: boolean;
      foodRequest: Record<string, unknown>;
      intent: AssistantIntent; source: AssistantResponse["source"];
      fallbackReason: NonNullable<AssistantResponse["fallbackReason"]>;
      notice: string | null; reply: string; recommendations: Recommendation[];
    }>("/api/assistant/conversation", { method: "POST", body: JSON.stringify(body), timeoutMs: 90_000 }),
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
  groceries: (includeRemoved = false) =>
    req<GroceryItem[]>(`/api/groceries${includeRemoved ? "?includeRemoved=1" : ""}`),
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
  // Meal log / goals / statistics (local JSON store, deterministic engines)
  mealLog: {
    list: () => req<MealLog[]>("/api/meals"),
    add: (b: Omit<MealLog, "id">) => req<MealLog>("/api/meals", { method: "POST", body: JSON.stringify(b) }),
    update: (id: string, b: Partial<MealLog>) => req<MealLog>(`/api/meals/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(b) }),
    remove: (id: string) => req(`/api/meals/${encodeURIComponent(id)}`, { method: "DELETE" }),
  },
  getGoals: () => req<Goals>("/api/goals"),
  saveGoals: (b: Partial<Goals>) => req<Goals>("/api/goals", { method: "PUT", body: JSON.stringify(b) }),
  water: () => req<{ id: string; loggedAt: string; ml: number }[]>("/api/water"),
  addWater: (ml: number) => req<{ id: string; loggedAt: string; ml: number }>("/api/water", { method: "POST", body: JSON.stringify({ ml }) }),
  statistics: (range: "daily" | "weekly" | "monthly" = "weekly") => req<StatsResult>(`/api/statistics?range=${range}`),
  insights: () => req<Insight[]>("/api/insights"),
};
