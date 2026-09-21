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
      { find: /^..\/store\/(.*)\.js$/, replacement: src("store/$1.ts") },
      { find: /^..\/stats\/(.*)\.js$/, replacement: src("stats/$1.ts") },
      { find: /^..\/routes\/(.*)\.js$/, replacement: src("routes/$1.ts") },
      { find: /^..\/app\.js$/, replacement: src("app.ts") },
      { find: /^..\/logger\.js$/, replacement: src("logger.ts") },
      { find: /^..\/recipesDb\.js$/, replacement: src("recipesDb.ts") },
      { find: /^..\/config\.js$/, replacement: src("config.ts") },
      { find: /^..\/ai\/(.*)\.js$/, replacement: path.resolve(here, "src/ai/$1.ts") },
      { find: /^\.\/engine\/filter\.js$/, replacement: src("engine/filter.js") },
      { find: /^\.\.\/recipesDb\.js$/, replacement: src("recipesDb.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.js"],
    // Live FlavoraLM inference is ~10s+/request on CPU and the model serves
    // one request at a time: run test FILES serially and allow slow
    // integration tests room. Parallel workers caused CPU contention
    // timeouts (fast unit tests still finish in ms).
    // Vitest 4 removed test.poolOptions — seriality is now maxWorkers: 1.
    pool: "forks",
    maxWorkers: 1,
    testTimeout: 90000,
    hookTimeout: 90000,
  },
});
