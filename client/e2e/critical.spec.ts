import { test, expect } from "@playwright/test";

/**
 * Critical path: profile -> recommend -> open -> save.
 * Runs against the local recipe database (seeded from /data).
 */
test("profile → recommend → open → save", async ({ page }) => {
  await page.goto("/onboarding");
  await page.getByLabel(/Allergies/i).fill("peanut");
  await page.getByLabel(/Foods to avoid/i).fill("pork");
  await page.getByRole("button", { name: /Save profile/i }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/assistant");

  await page.getByLabel(/What do you have/i).fill("pasta, tomato");
  await page.getByRole("button", { name: /Suggest/i }).click();
  const first = page.getByLabel(/Open /).first();
  await expect(first).toBeVisible({ timeout: 10_000 });
  await first.click();

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /^Save$/i }).click();
  await expect(page.getByRole("button", { name: /Saved/i })).toBeVisible();

  await page.goto("/saved");
  await expect(page.getByLabel(/Open /).first()).toBeVisible();
});

test("food waste mode → recipe", async ({ page }) => {
  await page.goto("/assistant");
  await page.getByLabel(/What do you have/i).fill("chickpeas, tomato, rice, onion");
  await page.getByText("Use what I have").click();
  await page.getByRole("button", { name: /Suggest/i }).click();
  const first = page.getByLabel(/Open /).first();
  await expect(first).toBeVisible({ timeout: 10_000 });
  await first.click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/Ingredients/i).first()).toBeVisible();
});

test("explorer → cuisine → recipe", async ({ page }) => {
  await page.goto("/explorer");
  await page.getByRole("button", { name: /^italian$/i }).click();
  const first = page.getByLabel(/Open /).first();
  await expect(first).toBeVisible({ timeout: 10_000 });
  await first.click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("inventory → recommendation using inventory", async ({ page }) => {
  await page.goto("/inventory");
  await page.getByLabel(/ingredient name/i).fill("tomato");
  await page.getByRole("button", { name: /^Add$/i }).click();
  await expect(page.getByText(/tomato/i).first()).toBeVisible({ timeout: 10_000 });
});

test("grocery list → check → persists", async ({ page }) => {
  await page.goto("/groceries");
  await page.getByLabel(/grocery item name/i).fill("e2e-tomato-check");
  await page.getByRole("button", { name: /^Add$/i }).click();
  const box = page.getByLabel(/check e2e-tomato-check/i);
  await expect(box).toBeVisible({ timeout: 10_000 });
  await box.check();
  await page.reload();
  await expect(page.getByText(/e2e-tomato-check/i).first()).toBeVisible({ timeout: 10_000 });
});

test("meal plan → add → groceries", async ({ page }) => {
  await page.goto("/assistant");
  await page.getByLabel(/What do you have/i).fill("pasta, tomato");
  await page.getByRole("button", { name: /Suggest/i }).click();
  const first = page.getByLabel(/Open /).first();
  await expect(first).toBeVisible({ timeout: 10_000 });
  const href = await first.getAttribute("href");
  const recipeId = decodeURIComponent(href?.split("/recipe/")[1] ?? "");
  await page.goto("/meal-plan");
  await page.getByLabel(/recipe id/i).fill(recipeId);
  await page.getByRole("button", { name: /^Add$/i }).click();
  await expect(page.getByText(recipeId).first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /Generate groceries/i }).click();
  await expect(page.getByText(/Grocery list generated/i)).toBeVisible({ timeout: 10_000 });
});

test("natural-language craving → recommendations", async ({ page }) => {
  await page.goto("/assistant");
  await page.getByPlaceholder(/chicken, rice/i).fill("I want something warm and comforting, creamy but not too spicy");
  await page.getByRole("button", { name: /Ask Flavora/i }).click();
  await expect(page.getByLabel(/Open /).first()).toBeVisible({ timeout: 10_000 });
});
