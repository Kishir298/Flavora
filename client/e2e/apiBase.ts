/**
 * Shared E2E API base URL.
 *
 * Defaults to the local Express server (Playwright webServer on :4000).
 * Override with API_URL (or VITE_API_URL) when the API runs elsewhere,
 * e.g. CI with PORT=4000 or a custom host.
 */
export const API_BASE =
  process.env.API_URL ?? process.env.VITE_API_URL ?? "http://localhost:4000";

export const apiUrl = (path: string): string =>
  `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
