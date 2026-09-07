import { Router } from "express";
import { prisma, ensureProfileRow } from "../db.js";
import { MOCK_RECIPES } from "../providers/mockData.js";
import { config } from "../config.js";

export const devRouter = Router();

function guard(_req: unknown, res: { status: (n: number) => { json: (o: unknown) => void } }, next: () => void) {
  if (!config.isDev && process.env.NODE_ENV === "production") {
    res.status(403).json({ error: "dev routes disabled in production" });
    return;
  }
  next();
}

devRouter.use((req, res, next) => guard(req, res, next));

// Seed: demo profile + sample recipes, zero network (§14).
devRouter.post("/seed", async (_req, res, next) => {
  try {
    await ensureProfileRow();
    await prisma.userProfile.update({
      where: { id: 1 },
      data: {
        allergies: JSON.stringify(["peanut"]),
        avoidFoods: JSON.stringify(["pork"]),
        cuisines: JSON.stringify(["italian", "mexican"]),
        spice: "medium",
        skill: "beginner",
        nutritionGoals: JSON.stringify({ highProtein: false, maxCalories: 600 }),
        maxCookTime: 30,
        theme: "light",
      },
    });
    for (const r of MOCK_RECIPES) {
      await prisma.recipeCache.upsert({
        where: { id: r.id },
        create: {
          id: r.id,
          source: r.source,
          title: r.title,
          cuisine: r.cuisine ?? "",
          cookTime: r.cookTime ?? 30,
          nutrition: JSON.stringify(r.nutrition ?? {}),
          ingredients: JSON.stringify(r.ingredients),
          instructions: JSON.stringify(r.instructions ?? []),
          image: r.image ?? "",
          pricePerServing: r.pricePerServing ?? null,
        },
        update: {},
      });
    }
    res.json({ seeded: true, recipes: MOCK_RECIPES.length });
  } catch (e) {
    next(e);
  }
});

devRouter.post("/reset", async (_req, res, next) => {
  try {
    await prisma.interaction.deleteMany({});
    await prisma.recipeCache.deleteMany({});
    await prisma.recommendationWeights.deleteMany({});
    await ensureProfileRow(); // reseeds default weights for "local"
    await prisma.userProfile.update({
      where: { id: 1 },
      data: {
        allergies: "[]",
        avoidFoods: "[]",
        cuisines: "[]",
        spice: "medium",
        skill: "beginner",
        nutritionGoals: "{}",
        maxCookTime: 30,
        theme: "light",
      },
    });
    res.json({ reset: true });
  } catch (e) {
    next(e);
  }
});
