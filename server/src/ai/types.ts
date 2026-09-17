/** Structured craving signals — controlled vocabulary (engine/craving.js). */
export interface CravingSignals {
  textures?: string[];
  flavors?: string[];
  moods?: string[];
  temperature?: string[];
  satiety?: string[];
  mealStyle?: string[];
}

/**
 * FoodRequest — the single authoritative conversational output (§15).
 * FlavoraLM / heuristic extract it; the deterministic engine consumes it.
 * Every field optional; the conversation machine asks only for genuinely
 * useful missing slots and never re-asks what is known.
 */
export type DietaryPreference = "vegetarian" | "non-vegetarian" | "vegan" | "any";
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface FoodRequest {
  craving?: string;
  mealType?: MealType;
  calorieTarget?: number;
  dietaryPreference?: DietaryPreference;
  availableIngredients?: string[];
  allergies?: string[];
  avoidFoods?: string[];
  cuisine?: string | null;
  spiceLevel?: "mild" | "medium" | "hot";
  servings?: number;
  maxCookingTime?: number;
  skillLevel?: "beginner" | "intermediate" | "advanced";
}

/** Structured intent extracted from natural language — never invents recipes. */
export type RecommendMode = "normal" | "food_waste" | "budget";

export interface RecommendationIntent {
  availableIngredients?: string[];
  timeLimit?: number;
  cuisine?: string | null;
  mode?: RecommendMode;
  craving?: string | null;
  cravingSignals?: CravingSignals;
  /** Ingredients known to be expiring (Food Waste Mode boost). */
  expiringIngredients?: string[];
  /**
   * Safety constraints stated in natural language ("allergic to peanuts",
   * "no mushrooms"). Additive only: the route unions these with the stored
   * profile before the deterministic hard filter runs. The AI can add
   * exclusions but never remove them.
   */
  allergies?: string[];
  avoidFoods?: string[];
  preferences?: {
    spice?: "mild" | "medium" | "hot";
    skill?: "beginner" | "intermediate" | "advanced";
    highProtein?: boolean;
    lowCarb?: boolean;
  };
  /** Conversational slots (§15) — same data as FoodRequest, engine-mapped. */
  foodRequest?: FoodRequest;
  /** Top-level conversational aliases (FlavoraLM may emit these flat). */
  mealType?: MealType;
  calorieTarget?: number;
  dietaryPreference?: DietaryPreference;
  spiceLevel?: "mild" | "medium" | "hot";
  skillLevel?: "beginner" | "intermediate" | "advanced";
  servings?: number;
  maxCookingTime?: number;
}

export type FallbackReason =
  | "none"
  | "heuristic-mode"
  | "local-unreachable"
  | "local-timeout"
  | "local-invalid"
  | "local-unloaded";

export interface ParsedAssistantRequest {
  intent: RecommendationIntent;
  /** How intent was produced: local FlavoraLM, deterministic heuristics, or provided intent. */
  source: "local" | "heuristic" | "provided";
  /** Short user-facing note when AI was unavailable or fell back. */
  notice?: string;
  /** Machine-readable fallback classification (never collapsed to a bare "unavailable"). */
  fallbackReason?: FallbackReason;
  /** Technical cause for server logs / debugging (never shown verbatim in UI). */
  detail?: string;
}

export interface AIProvider {
  readonly name: string;
  isAvailable(): boolean;
  /** Return raw JSON-ish text for intent extraction, or throw. */
  complete(systemPrompt: string, userMessage: string): Promise<string>;
}
