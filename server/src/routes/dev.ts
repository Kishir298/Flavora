import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma, ensureProfileRow } from "../db.js";
import { config } from "../config.js";

export const devRouter = Router();

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(here, "../../data");

function guard(_req: unknown, res: { status: (n: number) => { json: (o: unknown) => void } }, next: () => void) {
  if (!config.isDev && process.env.NODE_ENV === "production") {
    res.status(403).json({ error: "dev routes disabled in production" });
    return;
  }
  next();
}

devRouter.use((req, res, next) => guard(req, res, next));

// Seed: demo profile + full local recipe set from /data, zero network (§14).
devRouter.post("/seed", async (_req, res, next) => {
  try {
    await ensureProfileRow();
    await prisma.userProfile.update({
      where: { id: 1 },
      data: {
        allergies: JSON.stringify(["peanut"]),
        avoidFoods: JSON.stringify(["pork"]),
        favoriteCuisines: JSON.stringify(["italian", "mexican"]),
        spicePreference: "medium",
        skillLevel: "beginner",
        nutritionGoals: JSON.stringify({ highProtein: false, maxCalories: 600 }),
        preferredCookTimeMinutes: 30,
        theme: "light",
      },
    });
    const recipes = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "recipes.json"), "utf8")) as {
      id: string;
      title: string;
      cuisine: string;
      cook_time_minutes: number;
      difficulty: string;
      spice_level: string;
      diet_tags: string[];
      ingredients: unknown[];
      instructions: string[];
      nutrition: Record<string, number>;
      cost_tier: string;
      storage_tips: string;
    }[];
    for (const r of recipes) {
      await prisma.recipe.upsert({
        where: { id: r.id },
        create: {
          id: r.id,
          title: r.title,
          cuisine: r.cuisine ?? "",
          cookTimeMinutes: r.cook_time_minutes ?? 30,
          difficulty: r.difficulty ?? "easy",
          spiceLevel: r.spice_level ?? "mild",
          dietTags: JSON.stringify(r.diet_tags ?? []),
          ingredients: JSON.stringify(r.ingredients ?? []),
          instructions: JSON.stringify(r.instructions ?? []),
          nutrition: JSON.stringify(r.nutrition ?? {}),
          costTier: r.cost_tier ?? "low",
          storageTips: r.storage_tips ?? "",
        },
        update: {},
      });
    }
    const subs = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "ingredient_substitutes.json"), "utf8")) as {
      ingredient_name: string;
      substitute_name: string;
      notes: string;
    }[];
    await prisma.ingredientSubstitute.deleteMany({});
    for (const s of subs) {
      await prisma.ingredientSubstitute.create({
        data: { ingredientName: s.ingredient_name, substituteName: s.substitute_name, notes: s.notes ?? "" },
      });
    }
    res.json({ seeded: true, recipes: recipes.length, substitutes: subs.length });
  } catch (e) {
    next(e);
  }
});

// Reset personalised data only (§4.7): wipes user_profile + interactions,
// leaves recipes + ingredient_substitutes intact (not personal).
devRouter.post("/reset", async (_req, res, next) => {
  try {
    await prisma.interaction.deleteMany({});
    await prisma.recommendationWeights.deleteMany({});
    await ensureProfileRow(); // reseeds default weights for "local"
    await prisma.userProfile.update({
      where: { id: 1 },
      data: {
        allergies: "[]",
        avoidFoods: "[]",
        favoriteCuisines: "[]",
        spicePreference: "medium",
        skillLevel: "beginner",
        nutritionGoals: "{}",
        preferredCookTimeMinutes: 30,
        theme: "light",
      },
    });
    res.json({ reset: true });
  } catch (e) {
    next(e);
  }
});
