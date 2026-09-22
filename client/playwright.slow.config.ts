import { defineConfig, devices } from "@playwright/test";

/**
 * Slow-spec evaluation config — the long browser specs (FlavoraLM chain,
 * full user journey, food log), run via `npm run eval:slow` from the repo
 * root. Same dev servers as the default config; adds a persisted JSON
 * report (`playwright-eval-results/slow.json`, gitignored) alongside the
 * human-readable list output. Serial workers: FlavoraLM serves one request
 * at a time and chat loops are timing-sensitive.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/flavoralm.spec.ts", "**/journey.spec.ts", "**/foodlog.spec.ts"],
  workers: 1,
  timeout: 120_000,
  reporter: [["list"], ["json", { outputFile: "../playwright-eval-results/slow.json" }]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run dev --workspace=server -- --port 4000",
      port: 4000,
      reuseExistingServer: !process.env.CI,
      env: { ...process.env } as Record<string, string>,
    },
    {
      command: "npm run dev --workspace=client",
      port: 5173,
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
