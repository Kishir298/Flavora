/** Seed local SQLite with demo profile + mock recipes. Zero network, zero API quota. */
import { prisma, ensureProfileRow } from "./db.js";
import { MOCK_RECIPES } from "./providers/mockData.js";

async function main() {
  await ensureProfileRow();
  await prisma.userProfile.update({
    where: { id: 1 },
    data: {
      allergies: JSON.stringify(["peanut"]),
      avoidFoods: JSON.stringify(["pork"]),
      cuisines: JSON.stringify(["italian", "mexican"]),
      spice: "medium",
      skill: "beginner",
      nutritionGoals: JSON.stringify({ highProtein: false, maxCalories: 600 }),
      maxCookTime: 30,
      theme: "light",
    },
  });
  for (const r of MOCK_RECIPES) {
    await prisma.recipeCache.upsert({
      where: { id: r.id },
      create: {
        id: r.id,
        source: r.source,
        title: r.title,
        cuisine: r.cuisine ?? "",
        cookTime: r.cookTime ?? 30,
        nutrition: JSON.stringify(r.nutrition ?? {}),
        ingredients: JSON.stringify(r.ingredients),
          instructions: JSON.stringify(r.instructions ?? []),
          image: r.image ?? "",
          pricePerServing: r.pricePerServing ?? null,
        },
        update: {},
    });
  }
  console.log(JSON.stringify({ event: "seeded", recipes: MOCK_RECIPES.length }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
