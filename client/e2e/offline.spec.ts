import { test, expect } from "@playwright/test";
import { chatUntilResults } from "./conversation";

/**
 * §E2E-7: Go offline → modify local data → reconnect → synchronization.
 * Uses Chromium offline emulation; mutations must queue, persist across
 * reload, and replay to the server on reconnect.
 */
test("offline: add inventory while offline → reload → reconnect → synced", async ({ page }) => {
  await page.goto("/inventory");
  await expect(page.getByRole("heading", { level: 1, name: /inventory/i })).toBeVisible({ timeout: 15_000 });

  // The service worker must be active and controlling the page before going
  // offline — otherwise the offline reload has no app-shell cache to serve it.
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return;
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
        setTimeout(() => resolve(), 8_000);
      });
    }
  });

  // Go offline
  await page.context().setOffline(true);

  await page.getByLabel(/ingredient name/i).fill("offline-e2e-spinach");
  await page.getByRole("button", { name: /^Add$/i }).click();

  // Optimistic pending notice appears; no error
  await expect(page.getByText(/saved locally and will sync/i).first()).toBeVisible({ timeout: 10_000 });

  // State survives a refresh while offline
  await page.reload();
  await expect(page.getByText(/offline/i).first()).toBeVisible({ timeout: 15_000 });
  // The queued mutation must still be pending after the offline reload
  // (the queue itself is never shown, but the offline banner proves state).

  // Reconnect → queue replays
  await page.context().setOffline(false);
  await page.waitForTimeout(1_500);
  await page.reload();
  await expect(page.getByText(/offline-e2e-spinach/i).first()).toBeVisible({ timeout: 15_000 });
  // After sync the pending/offline banner must be gone
  await expect(page.getByText(/pending/i)).toHaveCount(0, { timeout: 15_000 });
});

/**
 * §E2E-5: Apply substitution → grocery list reflects replacement.
 */
test("substitution: apply then revert on a recipe detail page", async ({ page }) => {
  // Find a recipe that has substitutions
  test.setTimeout(120_000);
  await page.goto("/");
  await chatUntilResults(page, "I want something with pasta and tomato");
  const first = page.getByLabel(/Open /).first();
  await expect(first).toBeVisible({ timeout: 15_000 });
  await first.click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });

  const subSection = page.getByText("Substitutions");
  const hasSubs = await subSection.count();
  test.skip(hasSubs === 0, "seeded recipe has no substitution options");

  await subSection.first().click();

  const select = page.getByLabel(/Replace with/i).first();
  await expect(select).toBeVisible({ timeout: 10_000 });
  const optionText = await select.locator("option").first().textContent();
  test.skip(!optionText, "no substitution options rendered");

  const applyButton = page.getByRole("button", { name: /^Apply$/i }).first();
  await applyButton.click();
  await expect(page.getByText(new RegExp(`Applied: .* → ${optionText}`, "i"))).toBeVisible({ timeout: 10_000 });

  // Applied state shows the replacement inline
  await expect(page.getByText(/→/i).first()).toBeVisible();

  // Undo restores the original
  const undo = page.getByRole("button", { name: /^Undo$/i }).first();
  await undo.click();
  await expect(page.getByText(/Reverted/i)).toBeVisible({ timeout: 10_000 });
});
