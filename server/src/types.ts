// Shared TS types. Scoring logic lives in src/engine/*.js (literal .js
// guide paths); do not add logic here. All recipe data is local (§5).
export interface SeedIngredient {
  name: string;
  quantity?: number | null;
  unit?: string | null;
}

export interface NutritionFacts {
  calories?: number;
  protein?: number; // g (legacy key)
  protein_g?: number; // g (seed-file key)
  carbs?: number; // g (legacy key)
  carbs_g?: number; // g (seed-file key)
  fat?: number; // g (legacy key)
  fat_g?: number; // g (seed-file key)
}

export interface Recipe {
  id: string;
  title: string;
  cuisine?: string;
  cookTimeMinutes?: number; // minutes
  difficulty?: "easy" | "medium" | "hard";
  spiceLevel?: "mild" | "medium" | "hot";
  dietTags?: string[];
  ingredients: (string | SeedIngredient)[];
  instructions?: string[];
  nutrition?: NutritionFacts;
  costTier?: "low" | "medium" | "high";
  storageTips?: string;
}

export interface UserProfileInput {
  allergies: string[]; // absolute exclusions, e.g. ["peanut", "milk"]
  avoidFoods: string[]; // absolute exclusions, e.g. ["cilantro", "pork"]
  favoriteCuisines: string[]; // preferences, e.g. ["italian", "mexican"]
  spicePreference: "mild" | "medium" | "hot";
  skillLevel: "beginner" | "intermediate" | "advanced";
  nutritionGoals?: {
    highProtein?: boolean;
    lowCarb?: boolean;
    maxCalories?: number;
  };
  preferredCookTimeMinutes?: number; // minutes
}

export interface RecommendQuery {
  ingredients?: string[]; // what user has
  maxTime?: number;
  craving?: string; // free text e.g. "spicy noodles"
}
