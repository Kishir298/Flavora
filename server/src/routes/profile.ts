import { Router } from "express";
import { prisma, ensureProfileRow } from "../db.js";
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

export function rowToProfile(row: ProfileRow): UserProfileInput & { theme: string } {
  return {
    allergies: JSON.parse(row.allergies),
    avoidFoods: JSON.parse(row.avoidFoods),
    favoriteCuisines: JSON.parse(row.favoriteCuisines),
    spicePreference: row.spicePreference as UserProfileInput["spicePreference"],
    skillLevel: row.skillLevel as UserProfileInput["skillLevel"],
    nutritionGoals: JSON.parse(row.nutritionGoals),
    preferredCookTimeMinutes: row.preferredCookTimeMinutes,
    theme: row.theme,
  };
}

profileRouter.get("/", async (_req, res, next) => {
  try {
    await ensureProfileRow();
    const row = await prisma.userProfile.findUniqueOrThrow({ where: { id: 1 } });
    res.json(rowToProfile(row));
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
    const data: Record<string, unknown> = {};
    if (b.allergies !== undefined) data.allergies = JSON.stringify(b.allergies);
    if (b.avoidFoods !== undefined) data.avoidFoods = JSON.stringify(b.avoidFoods);
    if (b.favoriteCuisines !== undefined) data.favoriteCuisines = JSON.stringify(b.favoriteCuisines);
    else if (b.cuisines !== undefined) data.favoriteCuisines = JSON.stringify(b.cuisines);
    if (b.spicePreference !== undefined) data.spicePreference = b.spicePreference;
    else if (b.spice !== undefined) data.spicePreference = b.spice;
    if (b.skillLevel !== undefined) data.skillLevel = b.skillLevel;
    else if (b.skill !== undefined) data.skillLevel = b.skill;
    if (b.nutritionGoals !== undefined) data.nutritionGoals = JSON.stringify(b.nutritionGoals);
    if (b.preferredCookTimeMinutes !== undefined)
      data.preferredCookTimeMinutes = Number(b.preferredCookTimeMinutes);
    else if (b.maxCookTime !== undefined) data.preferredCookTimeMinutes = Number(b.maxCookTime);
    if (b.theme !== undefined) data.theme = b.theme;
    const row = await prisma.userProfile.update({ where: { id: 1 }, data: data as never });
    res.json(rowToProfile(row));
  } catch (e) {
    next(e);
  }
});
