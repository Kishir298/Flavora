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

export async function ensureProfileRow() {
  const existing = await prisma.userProfile.findUnique({ where: { id: 1 } });
  if (!existing) {
    await prisma.userProfile.create({ data: { id: 1 } });
  }
}
