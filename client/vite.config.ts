import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Flavora",
        short_name: "Flavora",
        description: "AI-assisted food companion — local-first",
        theme_color: "#16a34a",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      devOptions: {
        // Serve the service worker in dev so offline behavior is testable (E2E §7).
        enabled: true,
        type: "module",
      },
      workbox: {
        // Offline: app shell + previously viewed recipe payloads.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/recipes"),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "flavora-recipes", expiration: { maxEntries: 50 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkFirst",
            options: { cacheName: "flavora-api", networkTimeoutSeconds: 3 },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
  preview: {
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
