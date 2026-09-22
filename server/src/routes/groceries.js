import { Router } from "express";
import { isSafetyProfileCorrupt, corruptProfileResponse } from "../profileSafety.js";
import { prisma, ensureProfileRow } from "../db.js";
import { getRecipeById } from "../recipesDb.js";
import { passesHardFilter } from "../engine/filter.js";
import { parseIngredient, ingredientKey, categorizeIngredient, mergeIngredientAmounts, subtractInventory, validateAmount } from "../engine/ingredients.js";

export const groceriesRouter = Router();

function isNotFound(e) {
  return e?.code === "P2025";
}
function isConflict(e) {
  return e?.code === "P2002";
}
function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}
function invalidId(res) {
  return res.status(400).json({ error: "VALIDATION_ERROR", message: "invalid id (must be a positive integer)" });
}
const VALID_GROCERY_CATEGORIES = new Set([
  "produce", "protein", "dairy", "grains", "pantry", "spices", "frozen", "other",
]);

function shape(r) {
  let recipeIds = [];
  try { recipeIds = JSON.parse(r.recipeIds ?? "[]"); } catch { recipeIds = []; }
  return {
    id: r.id, name: r.name, quantity: r.quantity, unit: r.unit, note: r.note,
    category: r.category, checked: r.checked, removed: r.removed,
    source: r.source, recipeIds, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

groceriesRouter.get("/", async (req, res, next) => {
  try {
    const includeRemoved = req.query.includeRemoved === "1";
    const rows = await prisma.groceryItem.findMany({
      where: includeRemoved ? { userId: "local" } : { userId: "local", removed: false },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    res.json(rows.map(shape));
  } catch (e) { next(e); }
});

groceriesRouter.post("/", async (req, res, next) => {
  try {
    const { name, quantity, unit, note, category } = req.body ?? {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: "VALIDATION_ERROR", message: "name is required" });
    const err = validateAmount(quantity, unit);
    if (err) return res.status(400).json({ error: "VALIDATION_ERROR", message: err });
    if (category !== undefined && category !== null && category !== "") {
      const cat = String(category).toLowerCase();
      if (!VALID_GROCERY_CATEGORIES.has(cat)) return res.status(400).json({ error: "VALIDATION_ERROR", message: "invalid category" });
    }
    const { name: base, note: parsedNote } = parseIngredient(name);
    const finalNote = (note ?? parsedNote ?? "").toString().slice(0, 200);
    const row = await prisma.groceryItem.upsert({
      where: { userId_name_note: { userId: "local", name: ingredientKey(base), note: finalNote } },
      create: {
        userId: "local", name: ingredientKey(base),
        quantity: quantity != null ? Number(quantity) : null,
        unit: unit != null ? String(unit).slice(0, 24) : null,
        note: finalNote, category: category ?? categorizeIngredient(base),
        source: "manual", recipeIds: "[]",
      },
      update: {
        quantity: quantity != null ? Number(quantity) : undefined,
        removed: false,
      },
    });
    res.status(201).json(shape(row));
  } catch (e) { next(e); }
});

groceriesRouter.put("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) return invalidId(res);
    const { name, quantity, unit, note, category, checked } = req.body ?? {};
    const data = {};
    if (name != null) data.name = ingredientKey(name);
    if (quantity !== undefined) {
      const err = validateAmount(quantity, unit);
      if (err) return res.status(400).json({ error: "VALIDATION_ERROR", message: err });
      data.quantity = quantity != null ? Number(quantity) : null;
    }
    if (unit !== undefined) data.unit = unit != null ? String(unit).slice(0, 24) : null;
    if (note !== undefined) data.note = String(note).slice(0, 200);
    if (category !== undefined) {
      const cat = String(category).toLowerCase().slice(0, 24);
      if (!VALID_GROCERY_CATEGORIES.has(cat)) {
        return res.status(400).json({ error: "VALIDATION_ERROR", message: "invalid category" });
      }
      data.category = cat;
    }
    if (checked !== undefined) data.checked = Boolean(checked);
    const row = await prisma.groceryItem.update({ where: { id }, data });
    res.json(shape(row));
  } catch (e) {
    if (isNotFound(e)) return res.status(404).json({ error: "NOT_FOUND", message: "grocery item not found" });
    if (isConflict(e)) return res.status(409).json({ error: "CONFLICT", message: "a grocery item with that name+note already exists" });
    next(e);
  }
});

groceriesRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) return invalidId(res);
    const restore = req.query.restore === "1";
    if (restore) {
      const row = await prisma.groceryItem.update({ where: { id }, data: { removed: false } });
      return res.json(shape(row));
    }
    const row = await prisma.groceryItem.update({ where: { id }, data: { removed: true } });
    res.json(shape(row));
  } catch (e) {
    if (isNotFound(e)) return res.status(404).json({ error: "NOT_FOUND", message: "grocery item not found" });
    next(e);
  }
});

groceriesRouter.post("/clear-completed", async (_req, res, next) => {
  try {
    await prisma.groceryItem.updateMany({ where: { userId: "local", checked: true, removed: false }, data: { removed: true } });
    res.json({ cleared: true });
  } catch (e) { next(e); }
});

/**
 * POST /api/groceries/generate { recipeIds: string[], useInventory?: boolean }
 * Merges ingredients, applies applied-substitutions, subtracts inventory.
 */
groceriesRouter.post("/generate", async (req, res, next) => {
  try {
    const { recipeIds, useInventory = true } = req.body ?? {};
    if (!Array.isArray(recipeIds) || recipeIds.length === 0) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "recipeIds must be a non-empty array" });
    }
    if (recipeIds.length > 50) return res.status(400).json({ error: "VALIDATION_ERROR", message: "too many recipes" });
    if (!recipeIds.every((r) => typeof r === "string" && r.length > 0 && r.length <= 120)) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "recipeIds must be non-empty strings (max 120)" });
    }
    await ensureProfileRow();
    const prow = await prisma.userProfile.findUniqueOrThrow({ where: { id: 1 } });
    if (isSafetyProfileCorrupt(prow)) return corruptProfileResponse(res);
    const safeParse = (raw, fb) => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : fb; } catch { return fb; } };
    const profile = {
      allergies: safeParse(prow.allergies, []),
      avoid_foods: safeParse(prow.avoidFoods, []),
      avoidFoods: safeParse(prow.avoidFoods, []),
    };
    const subs = await prisma.appliedSubstitution.findMany({ where: { userId: "local", recipeId: { in: recipeIds } } });
    const subMap = new Map(subs.map((s) => [`${s.recipeId}||${ingredientKey(s.originalName)}`, s.replacementName]));
    // Batch recipe fetch (was sequential N+1).
    const recipes = await Promise.all(recipeIds.map((rid) => getRecipeById(String(rid))));
    const needed = [];
    for (let i = 0; i < recipeIds.length; i++) {
      const rid = recipeIds[i];
      const recipe = recipes[i];
      if (!recipe) return res.status(400).json({ error: "VALIDATION_ERROR", message: `unknown recipeId: ${rid}` });
      if (!passesHardFilter(recipe, profile)) {
        return res.status(400).json({ error: "UNSAFE_RECIPE", message: `recipe conflicts with allergies/avoid foods: ${rid}` });
      }
      for (const ing of recipe.ingredients) {
        const raw = typeof ing === "string" ? { name: ing, quantity: null, unit: null } : ing;
        const key = ingredientKey(raw.name);
        const replacement = subMap.get(`${rid}||${key}`);
        const { name: base, note } = parseIngredient(raw.name);
        needed.push({
          name: replacement ? ingredientKey(replacement) : key,
          quantity: raw.quantity ?? null,
          unit: raw.unit ?? null,
          note,
          recipeId: rid,
        });
      }
    }
    const merged = mergeIngredientAmounts(needed);
    let toBuy = merged;
    if (useInventory) {
      const inv = await prisma.inventoryItem.findMany({ where: { userId: "local" } });
      const byKey = new Map(merged.map((m) => [ingredientKey(m.name), m]));
      toBuy = subtractInventory(
        merged.map((m) => ({ name: m.name, quantity: m.hasQty ? m.quantity : null, unit: m.unit })),
        inv.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit }))
      ).map((r) => {
        const orig = byKey.get(ingredientKey(r.name));
        return { ...orig, quantity: r.quantity, unit: r.unit };
      });
    }
    const created = [];
    const pending = toBuy.filter((item) => !(item.quantity != null && Number(item.quantity) <= 0));
    // Atomic: partial failure previously left a half-built list.
    const rows = await prisma.$transaction(
      pending.map((item) =>
        prisma.groceryItem.upsert({
          where: { userId_name_note: { userId: "local", name: item.name, note: item.note ?? "" } },
          create: {
            userId: "local", name: item.name,
            quantity: item.hasQty ? Number(item.quantity) : (item.quantity ?? null),
            unit: item.unit, note: item.note ?? "", category: categorizeIngredient(item.name),
            source: "recipe", recipeIds: JSON.stringify(recipeIds),
          },
          update: { removed: false, source: "recipe", recipeIds: JSON.stringify(recipeIds) },
        })
      )
    );
    for (const row of rows) created.push(shape(row));
    res.json({ items: created, merged: merged.length, purchased: created.length });
  } catch (e) { next(e); }
});
