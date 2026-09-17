import { test, expect } from "@playwright/test";

/**
 * §20: every navbar destination renders its page. No mocked navigation —
 * real clicks against the running app, plus back/forward and deep links.
 */
test("navbar: every destination works", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "main" });
  const cases: [string, RegExp][] = [
    ["Ask Flavora", /^FLAVORA$/],
    ["Dashboard", /^Dashboard$/],
    ["Meals", /^Meals$/],
    ["Insights", /^Insights$/],
    ["Explorer", /explorer|cuisine|browse/i],
    ["Inventory", /^Inventory$/],
    ["Groceries", /grocer/i],
    ["Meal plan", /meal plan/i],
    ["Saved", /saved/i],
    ["Settings", /^Settings$/],
    ["Profile", /welcome to flavora|profile|allergies/i],
  ];
  for (const [label, heading] of cases) {
    await nav.getByRole("link", { name: label }).click();
    await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(heading, { timeout: 10_000 });
    await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
  }
  // Back/forward + deep link.
  await page.goBack();
  await expect(page).toHaveURL(/onboarding|settings|saved/);
  await page.goto("/insights");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Insights");
  await page.goto("/meals");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Meals");
});
