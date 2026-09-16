/** Structured craving signals — controlled vocabulary (engine/craving.js). */
export interface CravingSignals {
  textures?: string[];
  flavors?: string[];
  moods?: string[];
  temperature?: string[];
  satiety?: string[];
  mealStyle?: string[];
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
}

export interface ParsedAssistantRequest {
  intent: RecommendationIntent;
  /** How intent was produced: local LLM, remote Groq, deterministic heuristics, or provided intent. */
  source: "local" | "groq" | "heuristic" | "provided";
  /** Short user-facing note when AI was unavailable or fell back. */
  notice?: string;
}

export interface AIProvider {
  readonly name: string;
  isAvailable(): boolean;
  /** Return raw JSON-ish text for intent extraction, or throw. */
  complete(systemPrompt: string, userMessage: string): Promise<string>;
}
