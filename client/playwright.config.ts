import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
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
