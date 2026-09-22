/**
 * Guide step 5 — POST /api/interactions (literal .js route path, canonical).
 * Single-user local app. Triggers retraining every 20 interactions (step 8).
 */
import { Router } from "express";
import { prisma } from "../db.js";
import { maybeTriggerRetrain } from "../engine/retrainTrigger.js";

export const interactionsRouterNew = Router();

export const ALLOWED_ACTIONS = new Set([
  "shown",
  "viewed",
  "saved",
  "unsaved",
  "cooked",
  "rated_positive",
  "rated_negative",
  "skipped",
  "rated", // legacy alias → treated as rated_positive
]);

interactionsRouterNew.post("/", async (req, res, next) => {
  try {
    const { recipeId, action, rating } = req.body ?? {};
    if (!recipeId || !action || !ALLOWED_ACTIONS.has(action)) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message:
          "recipeId + valid action required (shown|viewed|saved|unsaved|cooked|rated_positive|rated_negative|skipped)",
      });
    }
    if (typeof recipeId !== "string" || recipeId.length === 0 || recipeId.length > 120) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "recipeId must be a non-empty string (max 120)" });
    }
    if (rating !== undefined && rating !== null) {
      const n = Number(rating);
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        return res.status(400).json({ error: "VALIDATION_ERROR", message: "rating must be an integer 1..5" });
      }
    }
    // Orphan interactions create dead training rows — verify the recipe exists.
    const { getRecipeById } = await import("../recipesDb.js");
    const exists = await getRecipeById(String(recipeId));
    if (!exists) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: `unknown recipeId: ${recipeId}` });
    }
    const storedAction = action === "rated" ? "rated_positive" : action;
    const row = await prisma.interaction.create({
      data: {
        userId: "local",
        recipeId: String(recipeId),
        action: storedAction,
        rating: rating == null ? null : Number(rating),
      },
    });
    void maybeTriggerRetrain(prisma.interaction, "local");
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});
