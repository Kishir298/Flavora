import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from server/, root/, and CWD — whichever exists (local-first dev).
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: path.resolve(here, "../../.env") });
dotenv.config({ path: path.resolve(here, "../.env") });

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  useMockRecipes: (process.env.USE_MOCK_RECIPES ?? "true").toLowerCase() !== "false",
  spoonacularKey: process.env.SPOONACULAR_API_KEY ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  isDev: (process.env.NODE_ENV ?? "development") !== "production",
};

if (!config.useMockRecipes && !config.spoonacularKey && config.nodeEnv !== "test") {
  // Don't crash — fall back warning so local dev without key still works.
  console.warn("[flavora] USE_MOCK_RECIPES=false but SPOONACULAR_API_KEY is empty; live calls will fail.");
}
