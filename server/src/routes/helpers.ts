/** Shared route helpers — profile loading, expiry status, ingredient parsing. */
import { prisma, ensureProfileRow } from "../db.js";

/** Load the single-user profile in the dual snake/camel shape the engine accepts. */
export async function loadEngineProfile(_userId = "local") {
  await ensureProfileRow();
  const row = await prisma.userProfile.findUniqueOrThrow({ where: { id: 1 } });
  const favs = JSON.parse(row.favoriteCuisines);
  const goals = JSON.parse(row.nutritionGoals);
  return {
    allergies: JSON.parse(row.allergies),
    avoid_foods: JSON.parse(row.avoidFoods),
    avoidFoods: JSON.parse(row.avoidFoods),
    favoriteCuisines: favs,
    favorite_cuisines: favs,
    cuisines: favs,
    spicePreference: row.spicePreference,
    spice_preference: row.spicePreference,
    spice: row.spicePreference,
    skillLevel: row.skillLevel,
    skill_level: row.skillLevel,
    skill: row.skillLevel,
    nutritionGoals: goals,
    nutrition_goals: goals,
    preferredCookTimeMinutes: row.preferredCookTimeMinutes,
    maxCookTime: row.preferredCookTimeMinutes,
  };
}

/** Expiry status derived from a user-entered date. Estimates, not science. */
export type ExpiryStatus = "fresh" | "expiring_soon" | "expired" | "unknown";

export function expiryStatus(expiryDate: Date | string | null | undefined): ExpiryStatus {
  if (!expiryDate) return "unknown";
  const d = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
  if (Number.isNaN(d.getTime())) return "unknown";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return "expired";
  if (diffDays <= 2) return "expiring_soon";
  return "fresh";
}

/** "Expires in 4 days" / "Expires today" / "Expired 1 day ago" — estimate language. */
export function expiryLabel(expiryDate: Date | string | null | undefined): string {
  if (!expiryDate) return "No expiry recorded";
  const d = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
  if (Number.isNaN(d.getTime())) return "No expiry recorded";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return `Expired ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? "" : "s"} ago`;
  if (diffDays === 0) return "Expires today";
  return `Expires in ${diffDays} day${diffDays === 1 ? "" : "s"}`;
}

/** Names of on-hand inventory items that are expiring soon or already expired. */
export async function expiringIngredientNames(): Promise<string[]> {
  const rows = await prisma.inventoryItem.findMany({});
  return rows
    .filter((r) => {
      const s = expiryStatus(r.expiryDate);
      return s === "expiring_soon" || s === "expired";
    })
    .map((r) => r.name.toLowerCase().trim())
    .filter(Boolean);
}

/** Parse a seed ingredient into display parts without destroying prep notes. */
export function parseIngredientName(raw: string): { name: string; note: string } {
  const s = String(raw ?? "").trim();
  const comma = s.indexOf(",");
  if (comma > 0) {
    return { name: s.slice(0, comma).trim(), note: s.slice(comma + 1).trim() };
  }
  return { name: s, note: "" };
}
