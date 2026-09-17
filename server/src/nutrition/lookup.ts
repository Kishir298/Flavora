/**
 * Optional online nutrition enrichment (offline-first).
 *
 * Priority: authored recipe data → local JSON cache → USDA FoodData Central
 * (CC0, needs USDA_FDC_API_KEY) → Open Food Facts (no key, ODbL) → unknown.
 * Core flows NEVER require internet: offline/no-key/no-match returns
 * { source: "unknown" } and the UI renders "unavailable".
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NutritionValues, SourcedNutrition } from "./sources.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE =
  process.env.FLAVORA_NUTRITION_CACHE?.trim() ||
  path.resolve(here, "..", "..", "..", "data", "nutrition-cache.json");

type Cache = Record<string, { values: NutritionValues; source: string; at: string }>;

function loadCache(): Cache {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as Cache;
  } catch {
    return {};
  }
}

function saveCache(cache: Cache): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {
    /* cache is best-effort; offline/read-only FS must not break lookup */
  }
}

function pickNutrients(nutrients: { nutrientName?: string; value?: number }[]): NutritionValues {
  const find = (...names: string[]): number | null => {
    for (const n of nutrients) {
      const name = String(n.nutrientName ?? "").toLowerCase();
      if (names.some((w) => name.includes(w)) && typeof n.value === "number" && Number.isFinite(n.value)) {
        return n.value;
      }
    }
    return null;
  };
  return {
    calories: find("energy"),
    protein_g: find("protein"),
    carbs_g: find("carbohydrate"),
    fat_g: find("total lipid", "fat"),
  };
}

async function fetchJson(url: string, timeoutMs: number, init?: RequestInit): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** USDA FDC search → first Foundation/SR Legacy hit (CC0). Requires server-side key. */
async function lookupUsda(ingredient: string, timeoutMs: number): Promise<SourcedNutrition | null> {
  const key = process.env.USDA_FDC_API_KEY?.trim();
  if (!key) return null;
  const data = (await fetchJson(
    `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}`,
    timeoutMs,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: ingredient, pageSize: 5, dataType: ["Foundation", "SR Legacy"] }),
    }
  )) as { foods?: { foodNutrients?: { nutrientName?: string; value?: number }[] }[] } | null;
  const nutrients = data?.foods?.[0]?.foodNutrients;
  if (!nutrients?.length) return null;
  const values = pickNutrients(nutrients);
  if (Object.values(values).every((v) => v == null)) return null;
  return { values, source: "usda" };
}

/** Open Food Facts search (no key, ODbL attribution required in docs/UI). */
async function lookupOpenFoodFacts(ingredient: string, timeoutMs: number): Promise<SourcedNutrition | null> {
  const data = (await fetchJson(
    `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(ingredient)}&search_simple=1&action=process&json=1&page_size=1`,
    timeoutMs
  )) as { products?: { nutriments?: Record<string, number> }[] } | null;
  const n = data?.products?.[0]?.nutriments;
  if (!n) return null;
  const num = (k: string): number | null => (typeof n[k] === "number" && Number.isFinite(n[k]) ? n[k] : null);
  const values: NutritionValues = {
    calories: num("energy-kcal_100g") ?? (n["energy_100g"] != null ? Number((Number(n["energy_100g"]) / 4.184).toFixed(1)) : null),
    protein_g: num("proteins_100g"),
    carbs_g: num("carbohydrates_100g"),
    fat_g: num("fat_100g"),
  };
  if (Object.values(values).every((v) => v == null)) return null;
  return { values, source: "openfoodfacts" };
}

export async function lookupIngredientNutrition(
  ingredient: string,
  opts?: { timeoutMs?: number; online?: boolean }
): Promise<SourcedNutrition> {
  const key = String(ingredient ?? "").toLowerCase().trim();
  if (!key) return { values: {}, source: "unknown" };
  const cache = loadCache();
  const hit = cache[key];
  if (hit && hit.values && Object.values(hit.values).some((v) => v != null)) {
    return { values: hit.values, source: "cache" };
  }
  if (opts?.online === false) return { values: {}, source: "unknown" };
  const timeoutMs = opts?.timeoutMs ?? 6_000;
  const remote = (await lookupUsda(key, timeoutMs)) ?? (await lookupOpenFoodFacts(key, timeoutMs));
  if (!remote) return { values: {}, source: "unknown" };
  saveCache({ ...cache, [key]: { values: remote.values, source: remote.source, at: new Date().toISOString() } });
  return remote;
}
