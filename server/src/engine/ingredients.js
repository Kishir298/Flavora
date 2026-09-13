/**
 * Shared ingredient normalization + quantity utilities (Steps 2-3).
 * Pure, deterministic, no network. Used by groceries, inventory, meal plans, subs.
 */

function norm(s) {
  return String(s ?? "").toLowerCase().trim();
}

/** Split "tomato, diced" -> { name: "tomato", note: "diced" }; preserves prep info. */
export function parseIngredient(raw) {
  const s = String(raw ?? "").trim();
  const comma = s.indexOf(",");
  if (comma > 0) {
    return { name: s.slice(0, comma).trim(), note: s.slice(comma + 1).trim() };
  }
  return { name: s, note: "" };
}

/** Canonical base key: lowercased name without prep note, naive singularization. */
export function ingredientKey(raw) {
  const { name } = typeof raw === "string" ? parseIngredient(raw) : { name: String(raw?.name ?? "") };
  let k = norm(name);
  // naive plural strip: tomatoes->tomato, pieces handled elsewhere
  if (k.endsWith("oes")) k = k.slice(0, -2); // tomatoes -> tomato, potatoes -> potato
  else if (k.endsWith("ies")) k = k.slice(0, -3) + "y";
  else if (k.endsWith("es") && k.length > 4) k = k.slice(0, -2);
  else if (k.endsWith("s") && !k.endsWith("ss") && k.length > 3) k = k.slice(0, -1);
  return k;
}

/** Deterministic categories (no external API). */
const CATEGORY_HINTS = [
  [/milk|cheese|butter|cream|yogurt|feta|mozzarella|parmesan|ghee|paneer/, "dairy"],
  [/chicken|beef|pork|fish|tofu|egg|turkey|bacon|lentil|beans|chickpea/, "protein"],
  [/tomato|onion|garlic|potato|carrot|spinach|broccoli|pepper|lettuce|salad|cucumber|zucchini|mushroom|herb|cilantro|basil/, "produce"],
  [/rice|pasta|bread|flour|oat|quinoa|noodle|spaghetti/, "grains"],
  [/sugar|salt|oil|vinegar|stock|broth|sauce|spice|cumin|paprika|turmeric|pepper|honey|maple/, "pantry"],
  [/frozen/, "frozen"],
];
export function categorizeIngredient(name) {
  const n = norm(name);
  for (const [re, cat] of CATEGORY_HINTS) if (re.test(n)) return cat;
  return "other";
}

// Unit conversion allowlist — only deterministic conversions. Returns null when unsafe.
const TO_ML = { ml: 1, l: 1000, tsp: 5, tbsp: 15, cup: 240 };
const TO_G = { g: 1, kg: 1000 };
const COUNT_UNITS = new Set(["piece", "pieces", "pc", "pcs", ""]);

export function normalizeUnit(u) {
  const n = norm(u);
  if (n === "pcs" || n === "pc") return "pieces";
  return n;
}

/**
 * Convert quantity to a canonical unit within its family.
 * Returns { qty, unit } or null if conversion unsafe/ambiguous.
 */
export function toCanonical(qty, unit) {
  if (qty == null) return null;
  const u = normalizeUnit(unit);
  if (u in TO_ML) return { qty: Number(qty) * TO_ML[u], unit: "ml" };
  if (u in TO_G) return { qty: Number(qty) * TO_G[u], unit: "g" };
  if (COUNT_UNITS.has(u)) return { qty: Number(qty), unit: "pieces" };
  return null; // unknown unit like "can", "bunch" — do not guess
}

/** Merge compatible quantities; keeps prep notes separate (never destroys info). */
export function mergeIngredientAmounts(items) {
  // items: [{ name, quantity?, unit?, note? }] -> Map key(name+note+unitFamily) -> merged
  const out = new Map();
  for (const it of items) {
    const { name } = parseIngredient(it.name ?? "");
    const key = ingredientKey(name);
    const note = it.note ?? parseIngredient(it.name ?? "").note ?? "";
    const canon = it.quantity != null ? toCanonical(it.quantity, it.unit ?? "") : null;
    const mapKey = `${key}||${norm(note)}||${canon?.unit ?? `raw:${normalizeUnit(it.unit ?? "")}`}`;
    if (!out.has(mapKey)) {
      out.set(mapKey, { name: key, displayName: norm(name), quantity: 0, unit: canon?.unit ?? it.unit ?? null, note, hasQty: false });
    }
    const e = out.get(mapKey);
    if (canon) {
      e.quantity += canon.qty;
      e.unit = canon.unit;
      e.hasQty = true;
    } else if (it.quantity != null) {
      // raw unit path: only merge identical raw units
      if (!e.hasQty) { e.quantity = Number(it.quantity); e.unit = it.unit ?? null; e.hasQty = true; }
      else if (normalizeUnit(e.unit) === normalizeUnit(it.unit)) e.quantity += Number(it.quantity);
      else {
        // incompatible raw units — keep separate entry
        out.set(`${mapKey}||${Math.random()}`, { name: key, displayName: norm(name), quantity: Number(it.quantity), unit: it.unit, note, hasQty: true });
      }
    }
  }
  return [...out.values()].map((e) => (e.hasQty ? e : { ...e, quantity: null, unit: e.unit }));
}

/** Subtract inventory from requirements (unit-aware). Returns remaining-to-buy list. */
export function subtractInventory(required, owned) {
  // required/owned: [{ name, quantity?, unit? }]
  const stock = new Map(); // key -> [{ qty canon, unit }]
  for (const o of owned) {
    const k = ingredientKey(o.name ?? "");
    const c = o.quantity != null ? toCanonical(o.quantity, o.unit ?? "") : null;
    if (!stock.has(k)) stock.set(k, []);
    stock.get(k).push(c);
  }
  const remaining = [];
  for (const r of required) {
    const k = ingredientKey(r.name ?? "");
    const need = r.quantity != null ? toCanonical(r.quantity, r.unit ?? "") : null;
    if (!need) {
      // no qty info: if any stock of same key exists, mark covered else keep
      if ((stock.get(k) ?? []).length > 0) continue;
      remaining.push({ ...r });
      continue;
    }
    let left = need.qty;
    for (const s of stock.get(k) ?? []) {
      if (!s || s.unit !== need.unit) continue; // different family — cannot subtract safely
      const take = Math.min(left, s.qty);
      left -= take;
      s.qty -= take;
      if (left <= 1e-9) break;
    }
    if (left > 1e-9) remaining.push({ ...r, quantity: Math.round(left * 100) / 100, unit: need.unit });
  }
  return remaining;
}

/** Validate quantity/unit/date inputs server+client side. Returns error string or null. */
export function validateAmount(quantity, unit) {
  if (quantity == null) return null;
  const q = Number(quantity);
  if (!Number.isFinite(q) || q < 0) return "Quantity must be zero or greater";
  if (q > 100000) return "Quantity is unrealistically large";
  if (unit != null && String(unit).length > 24) return "Unit is too long";
  return null;
}
