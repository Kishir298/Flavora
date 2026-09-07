import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __flavoraPrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__flavoraPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__flavoraPrisma = prisma;
}

export const DEFAULT_GUIDE_WEIGHTS = {
  ingredient_overlap: 0.3,
  time_fit: 0.2,
  cuisine_match: 0.15,
  nutrition_fit: 0.15,
  spice_fit: 0.1,
  budget_fit: 0.1,
};

export async function ensureProfileRow() {
  const existing = await prisma.userProfile.findUnique({ where: { id: 1 } });
  if (!existing) {
    await prisma.userProfile.create({ data: { id: 1 } });
  }
  // Seed guide step-1 weights for single-user "local" so scorer never
  // sees a missing-weights case.
  for (const [featureName, weightValue] of Object.entries(DEFAULT_GUIDE_WEIGHTS)) {
    await prisma.recommendationWeights.upsert({
      where: { userId_featureName: { userId: "local", featureName } },
      create: { userId: "local", featureName, weightValue },
      update: {},
    });
  }
}
