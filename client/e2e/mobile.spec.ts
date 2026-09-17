import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

/** Responsive: core pages usable at mobile width — no horizontal scroll, nav wraps. */
test("mobile: dashboard, meals, insights render without horizontal scroll", async ({ page }) => {
  for (const route of ["/", "/meals", "/insights", "/assistant"]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${route} overflows horizontally`).toBeLessThanOrEqual(1);
  }
  const nav = page.getByRole("navigation", { name: "main" });
  for (const label of ["Dashboard", "Meals", "Insights", "Assistant", "Settings"]) {
    await expect(nav.getByRole("link", { name: label })).toBeVisible();
  }
});
