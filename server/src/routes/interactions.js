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
        error:
          "recipeId + valid action required (shown|viewed|saved|unsaved|cooked|rated_positive|rated_negative|skipped)",
      });
    }
    const storedAction = action === "rated" ? "rated_positive" : action;
    const row = await prisma.interaction.create({
      data: { recipeId, action: storedAction, rating: rating ?? null },
    });
    void maybeTriggerRetrain(prisma.interaction, "local");
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});
