import { Router } from "express";
import { prisma } from "../db.js";

export const interactionsRouter = Router();

const ALLOWED = new Set(["viewed", "saved", "cooked", "rated", "skipped"]);

interactionsRouter.post("/", async (req, res, next) => {
  try {
    const { recipeId, action, rating } = req.body as {
      recipeId?: string;
      action?: string;
      rating?: number;
    };
    if (!recipeId || !action || !ALLOWED.has(action)) {
      return res.status(400).json({ error: "recipeId + valid action required (viewed|saved|cooked|rated|skipped)" });
    }
    const row = await prisma.interaction.create({
      data: { recipeId, action, rating: rating ?? null },
    });
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

// Saved = latest 'saved' per recipe, minus any later 'skipped'.
// Simple + honest for MVP; learning layer consumes raw interactions separately.
interactionsRouter.get("/saved", async (_req, res, next) => {
  try {
    const all = await prisma.interaction.findMany({ orderBy: { createdAt: "desc" } });
    const latestByRecipe = new Map<string, (typeof all)[number]>();
    for (const i of all) {
      if (!latestByRecipe.has(i.recipeId)) latestByRecipe.set(i.recipeId, i);
    }
    const savedIds = [...latestByRecipe.entries()]
      .filter(([, i]) => i.action === "saved" || i.action === "cooked")
      .map(([id]) => id);
    const cached = await prisma.recipeCache.findMany({ where: { id: { in: savedIds } } });
    res.json(
      cached.map((c) => ({
        id: c.id,
        source: c.source,
        title: c.title,
        cuisine: c.cuisine,
        cookTime: c.cookTime,
        nutrition: JSON.parse(c.nutrition),
        ingredients: JSON.parse(c.ingredients),
        instructions: JSON.parse(c.instructions),
        image: c.image,
      }))
    );
  } catch (e) {
    next(e);
  }
});
