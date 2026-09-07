/** Seed local SQLite from /data/*.json — zero network, fully offline (§5, §14). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma, ensureProfileRow } from "./db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// src/ -> server/ -> repo root -> data/
const DATA_DIR = path.resolve(here, "../../data");

interface SeedIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
}

interface SeedRecipe {
  id: string;
  title: string;
  cuisine: string;
  cook_time_minutes: number;
  difficulty: string;
  spice_level: string;
  diet_tags: string[];
  ingredients: SeedIngredient[];
  instructions: string[];
  nutrition: Record<string, number>;
  cost_tier: string;
  storage_tips: string;
}

function loadJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8")) as T;
}

async function main() {
  await ensureProfileRow();
  await prisma.userProfile.update({
    where: { id: 1 },
    data: {
      allergies: JSON.stringify(["peanut"]),
      avoidFoods: JSON.stringify(["pork"]),
      favoriteCuisines: JSON.stringify(["italian", "mexican"]),
      spicePreference: "medium",
      skillLevel: "beginner",
      nutritionGoals: JSON.stringify({ highProtein: false, maxCalories: 600 }),
      preferredCookTimeMinutes: 30,
      theme: "light",
    },
  });

  const recipes = loadJson<SeedRecipe[]>("recipes.json");
  for (const r of recipes) {
    await prisma.recipe.upsert({
      where: { id: r.id },
      create: {
        id: r.id,
        title: r.title,
        cuisine: r.cuisine ?? "",
        cookTimeMinutes: r.cook_time_minutes ?? 30,
        difficulty: r.difficulty ?? "easy",
        spiceLevel: r.spice_level ?? "mild",
        dietTags: JSON.stringify(r.diet_tags ?? []),
        ingredients: JSON.stringify(r.ingredients ?? []),
        instructions: JSON.stringify(r.instructions ?? []),
        nutrition: JSON.stringify(r.nutrition ?? {}),
        costTier: r.cost_tier ?? "low",
        storageTips: r.storage_tips ?? "",
      },
      update: {
        title: r.title,
        cuisine: r.cuisine ?? "",
        cookTimeMinutes: r.cook_time_minutes ?? 30,
        difficulty: r.difficulty ?? "easy",
        spiceLevel: r.spice_level ?? "mild",
        dietTags: JSON.stringify(r.diet_tags ?? []),
        ingredients: JSON.stringify(r.ingredients ?? []),
        instructions: JSON.stringify(r.instructions ?? []),
        nutrition: JSON.stringify(r.nutrition ?? {}),
        costTier: r.cost_tier ?? "low",
        storageTips: r.storage_tips ?? "",
      },
    });
  }

  const subs = loadJson<{ ingredient_name: string; substitute_name: string; notes: string }[]>(
    "ingredient_substitutes.json"
  );
  await prisma.ingredientSubstitute.deleteMany({});
  for (const s of subs) {
    await prisma.ingredientSubstitute.create({
      data: { ingredientName: s.ingredient_name, substituteName: s.substitute_name, notes: s.notes ?? "" },
    });
  }

  console.log(JSON.stringify({ event: "seeded", recipes: recipes.length, substitutes: subs.length }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
