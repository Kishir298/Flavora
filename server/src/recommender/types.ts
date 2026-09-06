export interface NutritionFacts {
  calories?: number;
  protein?: number; // g
  carbs?: number; // g
  fat?: number; // g
}

export interface Recipe {
  id: string;
  source: "spoonacular" | "themealdb" | "mock";
  title: string;
  cuisine?: string;
  cookTime?: number; // minutes
  spice?: "mild" | "medium" | "hot";
  ingredients: string[];
  instructions?: string[];
  nutrition?: NutritionFacts;
  image?: string;
}

export interface UserProfileInput {
  allergies: string[]; // absolute exclusions, e.g. ["peanut", "milk"]
  avoidFoods: string[]; // absolute exclusions, e.g. ["cilantro", "pork"]
  cuisines: string[]; // preferences, e.g. ["italian", "mexican"]
  spice: "mild" | "medium" | "hot";
  skill: "beginner" | "intermediate" | "advanced";
  nutritionGoals?: {
    highProtein?: boolean;
    lowCarb?: boolean;
    maxCalories?: number;
  };
  maxCookTime?: number; // minutes
}

export interface RecommendQuery {
  ingredients?: string[]; // what user has
  maxTime?: number;
  craving?: string; // free text e.g. "spicy noodles"
}

export interface ScoreBreakdown {
  ingredientOverlap: number;
  timeFit: number;
  cuisine: number;
  spice: number;
  nutrition: number;
  craving: number;
  total: number;
}

export interface ScoredRecipe {
  recipe: Recipe;
  score: number;
  breakdown: ScoreBreakdown;
}
