import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { authoredNutrition, mergeNutrition } from "./sources.js";
import { lookupIngredientNutrition } from "./lookup.js";

describe("nutrition/sources", () => {
  it("tags authored nutrition honestly", () => {
    const out = authoredNutrition({ calories: 520, protein_g: 30 });
    expect(out.source).toBe("authored");
    expect(out.values.calories).toBe(520);
  });

  it("marks missing nutrition as unknown (never invented)", () => {
    expect(authoredNutrition({}).source).toBe("unknown");
    expect(authoredNutrition(null).source).toBe("unknown");
    expect(authoredNutrition({ calories: -5 }).source).toBe("unknown");
  });

  it("authored always wins over enrichment", () => {
    const merged = mergeNutrition(
      { values: { calories: 500 }, source: "authored" },
      { values: { calories: 999 }, source: "usda" }
    );
    expect(merged.values.calories).toBe(500);
    expect(merged.source).toBe("authored");
  });
});

describe("nutrition/lookup (offline-first)", () => {
  it("returns unknown offline without crashing (online:false)", async () => {
    const out = await lookupIngredientNutrition("chicken", { online: false });
    expect(out.source).toBe("unknown");
  });

  it("rejects blank input", async () => {
    const out = await lookupIngredientNutrition("   ", { online: false });
    expect(out.source).toBe("unknown");
  });
});

describe("nutrition/seed completeness", () => {
  it("every seeded recipe carries authored calories (never fabricated at runtime)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = JSON.parse(readFileSync(resolve(here, "../../../data/recipes.json"), "utf-8")) as unknown[];
    expect(raw.length).toBeGreaterThanOrEqual(80);
    const missing = (raw as Record<string, unknown>[]).filter((r) => {
      const n = r.nutrition as Record<string, unknown> | undefined;
      return typeof n?.calories !== "number" || (n.calories as number) < 0;
    });
    expect(missing.map((r) => r.id)).toEqual([]);
  });
});
