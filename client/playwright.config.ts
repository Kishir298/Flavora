import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Offline spec requires the production build (vite preview, service worker);
  // run it with: npx playwright test --config=playwright.offline.config.ts
  testIgnore: "**/offline.spec.ts",
  // Live FlavoraLM inference is ~10s+/turn and serves one request at a time:
  // serial workers + generous timeout. Parallel workers caused contention
  // failures (fast specs are unaffected).
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run dev --workspace=flavora-server -- --port 4000",
      port: 4000,
      reuseExistingServer: true,
      env: { ...process.env } as Record<string, string>,
    },
    {
      command: "npm run dev --workspace=flavora-client",
      port: 5173,
      reuseExistingServer: true,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
