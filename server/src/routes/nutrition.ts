import { Router } from "express";
import { lookupIngredientNutrition } from "../nutrition/lookup.js";

export const nutritionRouter = Router();

/** GET /api/nutrition/lookup?ingredient=chicken — optional enrichment, offline-safe. */
nutritionRouter.get("/lookup", async (req, res, next) => {
  try {
    const ingredient = typeof req.query.ingredient === "string" ? req.query.ingredient : "";
    if (!ingredient.trim()) return res.status(400).json({ error: "ingredient required" });
    const result = await lookupIngredientNutrition(ingredient);
    res.json({ ingredient: ingredient.trim(), ...result });
  } catch (e) {
    next(e);
  }
});
