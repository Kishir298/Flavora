import { Router } from "express";
import { prisma, ensureProfileRow } from "../db.js";
import type { UserProfileInput } from "../recommender/types.js";

export const profileRouter = Router();

function rowToProfile(row: {
  allergies: string;
  avoidFoods: string;
  cuisines: string;
  spice: string;
  skill: string;
  nutritionGoals: string;
  maxCookTime: number;
  theme: string;
}): UserProfileInput & { theme: string } {
  return {
    allergies: JSON.parse(row.allergies),
    avoidFoods: JSON.parse(row.avoidFoods),
    cuisines: JSON.parse(row.cuisines),
    spice: row.spice as UserProfileInput["spice"],
    skill: row.skill as UserProfileInput["skill"],
    nutritionGoals: JSON.parse(row.nutritionGoals),
    maxCookTime: row.maxCookTime,
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
    const b = req.body as Partial<UserProfileInput & { theme: string }>;
    const data: Record<string, unknown> = {};
    if (b.allergies !== undefined) data.allergies = JSON.stringify(b.allergies);
    if (b.avoidFoods !== undefined) data.avoidFoods = JSON.stringify(b.avoidFoods);
    if (b.cuisines !== undefined) data.cuisines = JSON.stringify(b.cuisines);
    if (b.spice !== undefined) data.spice = b.spice;
    if (b.skill !== undefined) data.skill = b.skill;
    if (b.nutritionGoals !== undefined) data.nutritionGoals = JSON.stringify(b.nutritionGoals);
    if (b.maxCookTime !== undefined) data.maxCookTime = Number(b.maxCookTime);
    if (b.theme !== undefined) data.theme = b.theme;
    const row = await prisma.userProfile.update({ where: { id: 1 }, data: data as never });
    res.json(rowToProfile(row));
  } catch (e) {
    next(e);
  }
});
