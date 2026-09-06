import { test, expect } from "@playwright/test";

/**
 * Critical path (§13): profile -> recommend -> open -> save.
 * Runs against mock data (USE_MOCK_RECIPES=true), no Spoonacular quota.
 */
test("profile → recommend → open → save", async ({ page }) => {
  await page.goto("/onboarding");
  await page.getByLabel(/Allergies/i).fill("peanut");
  await page.getByLabel(/Foods to avoid/i).fill("pork");
  await page.getByRole("button", { name: /Save profile/i }).click();
  await expect(page).toHaveURL("/");

  await page.getByLabel(/What do you have/i).fill("pasta, tomato");
  await page.getByRole("button", { name: /Suggest/i }).click();
  const first = page.getByLabel(/Open /).first();
  await expect(first).toBeVisible({ timeout: 10_000 });
  await first.click();

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /Save/i }).click();
  await expect(page.getByRole("button", { name: /Saved/i })).toBeVisible();

  await page.goto("/saved");
  await expect(page.getByLabel(/Open /).first()).toBeVisible();
});
