import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => path.resolve(here, "src", p);

export default defineConfig({
  resolve: {
    // Literal .js engine/route files import TS siblings with NodeNext-style
    // ".js" suffixes (tsx + tsc handle this natively; vite needs the map).
    alias: [
      { find: /^..\/db\.js$/, replacement: src("db.ts") },
      { find: /^..\/app\.js$/, replacement: src("app.ts") },
      { find: /^..\/logger\.js$/, replacement: src("logger.ts") },
      { find: /^..\/providers\/recipes\.js$/, replacement: src("providers/recipes.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.js"],
    testTimeout: 10000,
  },
});
