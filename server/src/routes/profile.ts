import { Router } from "express";
import { prisma, ensureProfileRow } from "../db.js";
import { isSafetyProfileCorrupt } from "../profileSafety.js";
import type { UserProfileInput } from "../types.js";

export const profileRouter = Router();

type ProfileRow = {
  allergies: string;
  avoidFoods: string;
  favoriteCuisines: string;
  spicePreference: string;
  skillLevel: string;
  nutritionGoals: string;
  preferredCookTimeMinutes: number;
  theme: string;
};

function safeParseArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function safeParseObject(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
export function rowToProfile(row: ProfileRow): UserProfileInput & { theme: string } {
  return {
    allergies: safeParseArray(row.allergies),
    avoidFoods: safeParseArray(row.avoidFoods),
    favoriteCuisines: safeParseArray(row.favoriteCuisines),
    spicePreference: row.spicePreference as UserProfileInput["spicePreference"],
    skillLevel: row.skillLevel as UserProfileInput["skillLevel"],
    nutritionGoals: safeParseObject(row.nutritionGoals) as UserProfileInput["nutritionGoals"],
    preferredCookTimeMinutes: row.preferredCookTimeMinutes,
    theme: row.theme,
  };
}

profileRouter.get("/", async (_req, res, next) => {
  try {
    await ensureProfileRow();
    const row = await prisma.userProfile.findUniqueOrThrow({ where: { id: 1 } });
    const profile = rowToProfile(row);
    // Display path stays 200 (UI needs something), but flag corruption so the
    // client can warn and safety paths (which now 500) are understood.
    if (isSafetyProfileCorrupt(row)) {
      res.json({ ...profile, profileCorrupt: true, profileWarning: "profile safety data corrupt — reset profile" });
      return;
    }
    res.json(profile);
  } catch (e) {
    next(e);
  }
});

profileRouter.put("/", async (req, res, next) => {
  try {
    await ensureProfileRow();
    const b = req.body as Partial<
      UserProfileInput & {
        theme: string;
        // legacy aliases (pre-local-DB client)
        cuisines: string[];
        spice: string;
        skill: string;
        maxCookTime: number;
      }
    >;
    const bad = (msg: string) => res.status(400).json({ error: "VALIDATION_ERROR", message: msg });
    const asStringArray = (v: unknown, field: string, max = 50): string[] | null => {
      if (!Array.isArray(v)) return null;
      if (v.length > max) return null;
      const out: string[] = [];
      for (const item of v) {
        if (typeof item !== "string") return null;
        const s = item.trim().slice(0, 60);
        if (!s) continue;
        if (s.length < 1 || s.length > 60) return null;
        out.push(s);
      }
      void field;
      return out;
    };
    const data: Record<string, unknown> = {};
    if (b.allergies !== undefined) {
      const arr = asStringArray(b.allergies, "allergies");
      if (!arr) return bad("allergies must be an array of strings (max 50)");
      data.allergies = JSON.stringify(arr);
    }
    if (b.avoidFoods !== undefined) {
      const arr = asStringArray(b.avoidFoods, "avoidFoods");
      if (!arr) return bad("avoidFoods must be an array of strings (max 50)");
      data.avoidFoods = JSON.stringify(arr);
    }
    const favRaw = b.favoriteCuisines !== undefined ? b.favoriteCuisines : b.cuisines;
    if (favRaw !== undefined) {
      const arr = asStringArray(favRaw, "favoriteCuisines");
      if (!arr) return bad("favoriteCuisines must be an array of strings (max 50)");
      data.favoriteCuisines = JSON.stringify(arr);
    }
    const spiceRaw = b.spicePreference !== undefined ? b.spicePreference : b.spice;
    if (spiceRaw !== undefined) {
      if (!["mild", "medium", "hot"].includes(String(spiceRaw))) return bad("spicePreference must be mild|medium|hot");
      data.spicePreference = String(spiceRaw);
    }
    const skillRaw = b.skillLevel !== undefined ? b.skillLevel : b.skill;
    if (skillRaw !== undefined) {
      if (!["beginner", "intermediate", "advanced"].includes(String(skillRaw))) return bad("skillLevel must be beginner|intermediate|advanced");
      data.skillLevel = String(skillRaw);
    }
    if (b.nutritionGoals !== undefined) {
      if (typeof b.nutritionGoals !== "object" || b.nutritionGoals === null || Array.isArray(b.nutritionGoals))
        return bad("nutritionGoals must be an object");
      const g = b.nutritionGoals as Record<string, unknown>;
      if (g.highProtein !== undefined && typeof g.highProtein !== "boolean") return bad("nutritionGoals.highProtein must be boolean");
      if (g.lowCarb !== undefined && typeof g.lowCarb !== "boolean") return bad("nutritionGoals.lowCarb must be boolean");
      if (g.maxCalories !== undefined) {
        const n = Number(g.maxCalories);
        if (!Number.isFinite(n) || n < 50 || n > 10000) return bad("nutritionGoals.maxCalories must be 50..10000");
      }
      data.nutritionGoals = JSON.stringify(b.nutritionGoals);
    }
    const cookRaw = b.preferredCookTimeMinutes !== undefined ? b.preferredCookTimeMinutes : b.maxCookTime;
    if (cookRaw !== undefined) {
      const n = Number(cookRaw);
      if (!Number.isFinite(n) || n < 5 || n > 300) return bad("preferredCookTimeMinutes must be 5..300");
      data.preferredCookTimeMinutes = n;
    }
    if (b.theme !== undefined) {
      if (!["light", "dark"].includes(String(b.theme))) return bad("theme must be light|dark");
      data.theme = String(b.theme);
    }
    const row = await prisma.userProfile.update({ where: { id: 1 }, data: data as never });
    res.json(rowToProfile(row));
  } catch (e) {
    next(e);
  }
});
