import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icon-192.png", "icon-512.png", "icon-maskable-512.png"],
      manifest: {
        name: "Flavora",
        short_name: "Flavora",
        description: "AI-assisted food companion — local-first",
        theme_color: "#16a34a",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      devOptions: {
        // Serve the service worker in dev so offline behavior is testable (E2E §7).
        enabled: true,
        type: "module",
      },
      workbox: {
        // Offline: app shell precache + previously viewed recipe payloads.
        // navigateFallback ensures deep-link reloads (e.g. /meal-plan) work offline.
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/recipes"),
            handler: "StaleWhileRevalidate",
            method: "GET",
            options: {
              cacheName: "flavora-recipes",
              expiration: { maxEntries: 50, maxAgeSeconds: 7 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Mutable lists (inventory/groceries/meal-plans/meals) go stale fast:
            // 5-minute cap so offline queueing never visually un-does an
            // optimistic update with a day-old list. Recipes stay long-lived above.
            urlPattern: ({ url }) =>
              ["/api/inventory", "/api/groceries", "/api/meal-plans", "/api/meals", "/api/goals", "/api/water"].some((p) =>
                url.pathname.startsWith(p)
              ),
            handler: "NetworkFirst",
            method: "GET",
            options: {
              cacheName: "flavora-mutable",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 100, maxAgeSeconds: 5 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkFirst",
            method: "GET",
            options: {
              cacheName: "flavora-api",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 100, maxAgeSeconds: 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
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
});
