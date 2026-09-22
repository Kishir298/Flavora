import { defineConfig, devices } from "@playwright/test";

/**
 * Offline E2E config — runs against a PRODUCTION build (vite preview).
 * The service worker + app-shell precache only exist in a real build, so a
 * reload while offline requires this mode (dev server cannot serve offline).
 */
export default defineConfig({
  testDir: "./e2e",
  // Offline suite only: bare invocation must not re-run the whole app
  // against :4173 (long 120-300s specs would time out at 45s).
  testMatch: "**/offline.spec.ts",
  timeout: 120_000,
  workers: 1,
  retries: 1,
  use: {
    baseURL: "http://localhost:4173",
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
      command: "npm run preview --workspace=client -- --port 4173",
      port: 4173,
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
