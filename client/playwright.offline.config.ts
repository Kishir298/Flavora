import { defineConfig, devices } from "@playwright/test";

/**
 * Offline E2E config — runs against a PRODUCTION build (vite preview).
 * The service worker + app-shell precache only exist in a real build, so a
 * reload while offline requires this mode (dev server cannot serve offline).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  use: {
    baseURL: "http://localhost:4173",
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
      command: "npm run preview --workspace=flavora-client -- --port 4173",
      port: 4173,
      reuseExistingServer: true,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
