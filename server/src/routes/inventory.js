import { Router } from "express";
import { prisma } from "../db.js";
import { categorizeIngredient, validateAmount, ingredientKey } from "../engine/ingredients.js";
import { expiryStatus } from "../engine/expiry.js";

export const inventoryRouter = Router();
const VALID_CATEGORIES = new Set(["produce", "protein", "dairy", "grains", "pantry", "spices", "frozen", "other"]);

function daysRemaining(expiryDate, now = new Date()) {
  if (!expiryDate) return null;
  const d = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((day.getTime() - today.getTime()) / 86400000);
}

function shape(r) {
  return {
    id: r.id, name: r.name, quantity: r.quantity, unit: r.unit,
    category: r.category, purchaseDate: r.purchaseDate, expiryDate: r.expiryDate,
    notes: r.notes, status: expiryStatus(r.expiryDate), daysRemaining: daysRemaining(r.expiryDate),
  };
}

inventoryRouter.get("/", async (_req, res, next) => {
  try {
    const rows = await prisma.inventoryItem.findMany({ orderBy: { name: "asc" } });
    res.json(rows.map(shape));
  } catch (e) { next(e); }
});

inventoryRouter.get("/expiring", async (_req, res, next) => {
  try {
    const rows = await prisma.inventoryItem.findMany({});
    res.json(rows.map(shape).filter((r) => r.status === "expiring_soon" || r.status === "expired"));
  } catch (e) { next(e); }
});

inventoryRouter.post("/", async (req, res, next) => {
  try {
    const { name, quantity, unit, category, purchaseDate, expiryDate, notes } = req.body ?? {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: "VALIDATION_ERROR", message: "name is required" });
    const err = validateAmount(quantity, unit);
    if (err) return res.status(400).json({ error: "VALIDATION_ERROR", message: err });
    const cat = category ? String(category).toLowerCase() : categorizeIngredient(name);
    if (!VALID_CATEGORIES.has(cat)) return res.status(400).json({ error: "VALIDATION_ERROR", message: "invalid category" });
    let exp = null;
    if (expiryDate) { exp = new Date(expiryDate); if (Number.isNaN(exp.getTime())) return res.status(400).json({ error: "VALIDATION_ERROR", message: "invalid expiryDate" }); }
    let pur = null;
    if (purchaseDate) { pur = new Date(purchaseDate); if (Number.isNaN(pur.getTime())) return res.status(400).json({ error: "VALIDATION_ERROR", message: "invalid purchaseDate" }); }
    const row = await prisma.inventoryItem.upsert({
      where: { userId_name: { userId: "local", name: String(name).toLowerCase().trim() } },
      create: {
        userId: "local", name: String(name).toLowerCase().trim(),
        quantity: quantity != null ? Number(quantity) : null,
        unit: unit != null ? String(unit).slice(0, 24) : null,
        category: cat, purchaseDate: pur, expiryDate: exp, notes: notes ? String(notes).slice(0, 500) : "",
      },
      update: {
        quantity: quantity != null ? Number(quantity) : undefined,
        unit: unit != null ? String(unit).slice(0, 24) : undefined,
        category: cat,
        purchaseDate: pur, expiryDate: exp,
        notes: notes != null ? String(notes).slice(0, 500) : undefined,
      },
    });
    res.status(201).json(shape(row));
  } catch (e) { next(e); }
});

inventoryRouter.patch("/:id/consume", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { amount } = req.body ?? {};
    const row = await prisma.inventoryItem.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "NOT_FOUND", message: "inventory item not found" });
    const dec = amount != null ? Number(amount) : (row.quantity ?? 0);
    if (!Number.isFinite(dec) || dec < 0) return res.status(400).json({ error: "VALIDATION_ERROR", message: "amount must be zero or greater" });
    const nextQty = Math.max(0, (row.quantity ?? 0) - dec);
    const updated = await prisma.inventoryItem.update({ where: { id }, data: { quantity: nextQty } });
    res.json(shape(updated));
  } catch (e) { next(e); }
});

inventoryRouter.put("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, quantity, unit, category, expiryDate, notes } = req.body ?? {};
    const data = {};
    if (name != null) data.name = String(name).toLowerCase().trim();
    if (quantity !== undefined) {
      const err = validateAmount(quantity, unit);
      if (err) return res.status(400).json({ error: "VALIDATION_ERROR", message: err });
      data.quantity = quantity != null ? Number(quantity) : null;
    }
    if (unit !== undefined) data.unit = unit != null ? String(unit).slice(0, 24) : null;
    if (category != null) {
      if (!VALID_CATEGORIES.has(String(category).toLowerCase())) return res.status(400).json({ error: "VALIDATION_ERROR", message: "invalid category" });
      data.category = String(category).toLowerCase();
    }
    if (expiryDate !== undefined) {
      if (!expiryDate) data.expiryDate = null;
      else { const d = new Date(expiryDate); if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "VALIDATION_ERROR", message: "invalid expiryDate" }); data.expiryDate = d; }
    }
    if (notes !== undefined) data.notes = String(notes).slice(0, 500);
    const updated = await prisma.inventoryItem.update({ where: { id }, data });
    res.json(shape(updated));
  } catch (e) { next(e); }
});

inventoryRouter.delete("/:id", async (req, res, next) => {
  try {
    await prisma.inventoryItem.delete({ where: { id: Number(req.params.id) } });
    res.json({ removed: true });
  } catch (e) { next(e); }
});
