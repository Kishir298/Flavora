import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Local JSON user-data store — the authoritative home of the NEW
 * food-tracking domain (meals, goals, water, favorites). Existing
 * Prisma/SQLite tables keep owning recipes, inventory, groceries,
 * meal plans, interactions and substitutions.
 *
 * Atomic writes: tmp file → fsync → rename. A crash can leave a
 * stale tmp file behind, never a half-written user-data.json.
 */

export const STORE_VERSION = 1;
export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack", "other"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export interface MealFood {
  name: string;
  quantity?: number | null;
  unit?: string | null;
}

export interface MealNutrition {
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
}

export interface MealRecord {
  id: string;
  name: string;
  mealType: MealType;
  loggedAt: string; // ISO timestamp
  foods: MealFood[];
  servings?: number | null;
  nutrition?: MealNutrition | null;
  tags?: string[];
  notes?: string;
}

export interface GoalsRecord {
  maxCalories?: number | null;
  protein_g?: number | null;
  mealsPerDay?: number | null;
  vegMealsPerWeek?: number | null;
  waterMlPerDay?: number | null;
  cookTimesPerWeek?: number | null;
  updatedAt?: string | null;
}

export interface WaterRecord {
  id: string;
  loggedAt: string;
  ml: number;
}

export interface UserData {
  version: number;
  profile: Record<string, unknown>;
  goals: GoalsRecord;
  meals: MealRecord[];
  nutritionLogs: unknown[];
  waterLogs: WaterRecord[];
  favorites: string[];
  feedback: unknown[];
  mealPlans: unknown[];
  groceryLists: unknown[];
  inventory: unknown[];
  activity: { type: string; at: string; detail?: unknown }[];
}

export function defaultUserData(): UserData {
  return {
    version: STORE_VERSION,
    profile: {},
    goals: {},
    meals: [],
    nutritionLogs: [],
    waterLogs: [],
    favorites: [],
    feedback: [],
    mealPlans: [],
    groceryLists: [],
    inventory: [],
    activity: [],
  };
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !s) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

function cleanStr(v: unknown, max: number): string {
  return String(v ?? "").slice(0, max);
}

export function validateMealInput(b: unknown): Omit<MealRecord, "id"> {
  const body = (b ?? {}) as Record<string, unknown>;
  const name = cleanStr(body.name, 120).trim();
  if (!name) throw new ValidationError("name is required");
  const mealType = String(body.mealType ?? "").toLowerCase();
  if (!(MEAL_TYPES as readonly string[]).includes(mealType)) {
    throw new ValidationError("mealType must be breakfast|lunch|dinner|snack|other");
  }
  const loggedAt = body.loggedAt ?? new Date().toISOString();
  if (!isIsoDate(loggedAt)) throw new ValidationError("loggedAt must be an ISO timestamp");
  const rawFoods = Array.isArray(body.foods) ? body.foods : [];
  const foods: MealFood[] = rawFoods.slice(0, 50).map((f) => {
    const o = (f ?? {}) as Record<string, unknown>;
    const fname = cleanStr(o.name, 120).trim();
    if (!fname) throw new ValidationError("foods[].name is required");
    const q = o.quantity == null ? null : Number(o.quantity);
    if (q != null && (!Number.isFinite(q) || q < 0 || q > 100000)) {
      throw new ValidationError("foods[].quantity out of range");
    }
    return { name: fname, quantity: q, unit: o.unit == null ? null : cleanStr(o.unit, 24) };
  });
  let servings: number | null = null;
  if (body.servings != null) {
    servings = Number(body.servings);
    if (!Number.isFinite(servings) || servings <= 0 || servings > 100) {
      throw new ValidationError("servings out of range");
    }
  }
  let nutrition: MealNutrition | null = null;
  if (body.nutrition != null) {
    const n = body.nutrition as Record<string, unknown>;
    const pick = (k: string): number | null => {
      if (n[k] == null) return null;
      const v = Number(n[k]);
      if (!Number.isFinite(v) || v < 0 || v > 1000000) throw new ValidationError(`nutrition.${k} out of range`);
      return v;
    };
    nutrition = { calories: pick("calories"), protein_g: pick("protein_g"), carbs_g: pick("carbs_g"), fat_g: pick("fat_g") };
  }
  const tags = Array.isArray(body.tags) ? body.tags.map((t) => cleanStr(t, 40).toLowerCase()).filter(Boolean).slice(0, 20) : [];
  return {
    name,
    mealType: mealType as MealType,
    loggedAt: new Date(loggedAt).toISOString(),
    foods,
    servings,
    nutrition,
    tags,
    notes: body.notes == null ? "" : cleanStr(body.notes, 2000),
  };
}

export function validateGoalsInput(b: unknown): GoalsRecord {
  const body = (b ?? {}) as Record<string, unknown>;
  const pick = (k: string, max: number): number | null => {
    if (body[k] == null) return null;
    const v = Number(body[k]);
    if (!Number.isFinite(v) || v < 0 || v > max) throw new ValidationError(`goals.${k} out of range`);
    return v;
  };
  return {
    maxCalories: pick("maxCalories", 20000),
    protein_g: pick("protein_g", 2000),
    mealsPerDay: pick("mealsPerDay", 12),
    vegMealsPerWeek: pick("vegMealsPerWeek", 100),
    waterMlPerDay: pick("waterMlPerDay", 10000),
    cookTimesPerWeek: pick("cookTimesPerWeek", 100),
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeLoaded(raw: unknown): UserData {
  const base = defaultUserData();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  return {
    version: typeof o.version === "number" ? o.version : STORE_VERSION,
    profile: o.profile && typeof o.profile === "object" ? (o.profile as Record<string, unknown>) : {},
    goals: o.goals && typeof o.goals === "object" ? (o.goals as GoalsRecord) : {},
    meals: Array.isArray(o.meals) ? (o.meals as MealRecord[]) : [],
    nutritionLogs: Array.isArray(o.nutritionLogs) ? o.nutritionLogs : [],
    waterLogs: Array.isArray(o.waterLogs) ? (o.waterLogs as WaterRecord[]) : [],
    favorites: Array.isArray(o.favorites) ? (o.favorites as string[]) : [],
    feedback: Array.isArray(o.feedback) ? o.feedback : [],
    mealPlans: Array.isArray(o.mealPlans) ? o.mealPlans : [],
    groceryLists: Array.isArray(o.groceryLists) ? o.groceryLists : [],
    inventory: Array.isArray(o.inventory) ? o.inventory : [],
    activity: Array.isArray(o.activity) ? (o.activity as UserData["activity"]) : [],
  };
}

export class UserDataStore {
  private file: string;
  private data: UserData | null = null;

  constructor(filePath?: string) {
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    this.file = filePath ?? path.join(root, "data", "user-data.json");
  }

  get filePath(): string {
    return this.file;
  }

  init(): UserData {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) {
      this.data = defaultUserData();
      this.flush();
      return this.data;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf-8"));
      this.data = sanitizeLoaded(raw);
    } catch {
      // Corrupt file: back it up once, start clean — never crash the server.
      try {
        fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}.bak`);
      } catch {
        /* best effort */
      }
      this.data = defaultUserData();
      this.flush();
    }
    return this.data;
  }

  private ensure(): UserData {
    if (!this.data) return this.init();
    return this.data;
  }

  private flush(): void {
    const d = this.ensure();
    const tmp = `${this.file}.tmp-${process.pid}`;
    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeFileSync(fd, JSON.stringify(d, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
  }

  read(): UserData {
    return this.ensure();
  }

  reset(): UserData {
    this.data = defaultUserData();
    this.flush();
    return this.data;
  }

  // ---- meals ----
  listMeals(): MealRecord[] {
    return [...this.ensure().meals].sort((a, b) => (a.loggedAt < b.loggedAt ? 1 : -1));
  }

  addMeal(input: unknown): MealRecord {
    const clean = validateMealInput(input);
    const rec: MealRecord = { ...clean, id: randomUUID() };
    this.ensure().meals.push(rec);
    this.logActivity("meal.add", { id: rec.id });
    this.flush();
    return rec;
  }

  updateMeal(id: string, input: unknown): MealRecord | null {
    const d = this.ensure();
    const idx = d.meals.findIndex((m) => m.id === id);
    if (idx < 0) return null;
    const prev = d.meals[idx];
    const merged = { ...prev, ...(input as Record<string, unknown>), id: prev.id };
    const clean = validateMealInput(merged);
    d.meals[idx] = { ...clean, id: prev.id };
    this.logActivity("meal.update", { id });
    this.flush();
    return d.meals[idx];
  }

  removeMeal(id: string): boolean {
    const d = this.ensure();
    const idx = d.meals.findIndex((m) => m.id === id);
    if (idx < 0) return false;
    d.meals.splice(idx, 1);
    this.logActivity("meal.remove", { id });
    this.flush();
    return true;
  }

  // ---- goals ----
  getGoals(): GoalsRecord {
    return { ...this.ensure().goals };
  }

  saveGoals(input: unknown): GoalsRecord {
    const clean = validateGoalsInput(input);
    // Merge: null means "leave / clear to null" only for provided keys.
    const body = (input ?? {}) as Record<string, unknown>;
    const prev = this.ensure().goals;
    const next: GoalsRecord = { ...prev };
    for (const k of ["maxCalories", "protein_g", "mealsPerDay", "vegMealsPerWeek", "waterMlPerDay", "cookTimesPerWeek"] as const) {
      if (k in body) next[k] = clean[k];
    }
    next.updatedAt = new Date().toISOString();
    this.ensure().goals = next;
    this.logActivity("goals.update", {});
    this.flush();
    return { ...next };
  }

  // ---- water ----
  addWater(ml: unknown, loggedAt?: unknown): WaterRecord {
    const v = Number(ml);
    if (!Number.isFinite(v) || v <= 0 || v > 10000) throw new ValidationError("ml out of range");
    const at = loggedAt ?? new Date().toISOString();
    if (!isIsoDate(at)) throw new ValidationError("loggedAt must be an ISO timestamp");
    const rec: WaterRecord = { id: randomUUID(), loggedAt: new Date(at).toISOString(), ml: v };
    this.ensure().waterLogs.push(rec);
    this.flush();
    return rec;
  }

  private logActivity(type: string, detail: unknown): void {
    const d = this.ensure();
    d.activity.push({ type, at: new Date().toISOString(), detail });
    if (d.activity.length > 500) d.activity = d.activity.slice(-500);
  }
}

let shared: UserDataStore | null = null;
let sharedKey = "";
/** App singleton (default data/user-data.json). Tests construct their own with tmp paths. */
export function getStore(): UserDataStore {
  const override = process.env.FLAVORA_USER_DATA_FILE ?? "";
  if (!shared || sharedKey !== override) {
    shared = new UserDataStore(override || undefined);
    sharedKey = override;
  }
  shared.init();
  return shared;
}
