import { Router } from "express";
import { prisma, ensureProfileRow } from "../db.js";
import { substitutionSafety, validateSubstitutionInput } from "../engine/substitutionSafety.js";

export const substitutionsRouter = Router();

async function loadProfile() {
  await ensureProfileRow();
  const row = await prisma.userProfile.findUniqueOrThrow({ where: { id: 1 } });
  return {
    allergies: JSON.parse(row.allergies),
    avoid_foods: JSON.parse(row.avoidFoods),
    avoidFoods: JSON.parse(row.avoidFoods),
  };
}

/** GET /api/substitutions?recipeId= — list applied subs for a recipe */
substitutionsRouter.get("/", async (req, res, next) => {
  try {
    const recipeId = String(req.query.recipeId ?? "");
    if (!recipeId) return res.status(400).json({ error: "VALIDATION_ERROR", message: "recipeId is required" });
    const rows = await prisma.appliedSubstitution.findMany({ where: { userId: "local", recipeId } });
    const profile = await loadProfile();
    res.json(rows.map((r) => ({
      id: r.id,
      recipeId: r.recipeId,
      originalName: r.originalName,
      replacementName: r.replacementName,
      quantity: r.quantity,
      unit: r.unit,
      safety: substitutionSafety(r.replacementName, profile),
    })));
  } catch (e) { next(e); }
});

/** POST /api/substitutions — apply (upsert). Body { recipeId, originalName, replacementName, quantity?, unit? } */
substitutionsRouter.post("/", async (req, res, next) => {
  try {
    const { recipeId, originalName, replacementName, quantity, unit } = req.body ?? {};
    const err = validateSubstitutionInput({ recipeId, originalName, replacementName });
    if (err) return res.status(400).json({ error: "VALIDATION_ERROR", message: err });
    if (quantity != null && (Number.isNaN(Number(quantity)) || Number(quantity) < 0)) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Quantity must be zero or greater" });
    }
    const profile = await loadProfile();
    const safety = substitutionSafety(replacementName, profile);
    if (safety === "unsafe") {
      return res.status(400).json({ error: "UNSAFE_SUBSTITUTION", message: `Replacement conflicts with allergies/avoid foods`, safety });
    }
    const row = await prisma.appliedSubstitution.upsert({
      where: { userId_recipeId_originalName: { userId: "local", recipeId, originalName: String(originalName) } },
      create: {
        userId: "local", recipeId: String(recipeId),
        originalName: String(originalName), replacementName: String(replacementName),
        quantity: quantity != null ? Number(quantity) : null,
        unit: unit != null ? String(unit).slice(0, 24) : null,
      },
      update: {
        replacementName: String(replacementName),
        quantity: quantity != null ? Number(quantity) : null,
        unit: unit != null ? String(unit).slice(0, 24) : null,
      },
    });
    res.status(201).json({ ...row, safety });
  } catch (e) { next(e); }
});

/** DELETE /api/substitutions — revert. Body { recipeId, originalName } restores original */
substitutionsRouter.delete("/", async (req, res, next) => {
  try {
    const { recipeId, originalName } = req.body ?? {};
    if (!recipeId || !originalName) return res.status(400).json({ error: "VALIDATION_ERROR", message: "recipeId and originalName required" });
    await prisma.appliedSubstitution.deleteMany({ where: { userId: "local", recipeId: String(recipeId), originalName: String(originalName) } });
    res.json({ reverted: true, recipeId, originalName });
  } catch (e) { next(e); }
});
