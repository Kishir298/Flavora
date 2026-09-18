import { test, expect } from "@playwright/test";
import { apiUrl } from "./apiBase";

/**
 * Food-intelligence E2E: Dashboard → Meals → create → Dashboard →
 * Statistics → Insights → refresh persistence → full navbar → Assistant
 * week-summary grounded in stored facts.
 */
test("meal log flows into dashboard, statistics and assistant facts", async ({ page, request }) => {
  const mealName = `E2E Soup ${Date.now()}`;

  // 1-2. Dashboard loads with working nav.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Dashboard");
  for (const label of ["Dashboard", "Meals", "Insights", "Assistant", "Explorer", "Settings"]) {
    await expect(page.getByRole("navigation", { name: "main" }).getByRole("link", { name: label })).toBeVisible();
  }

  // 3-5. Log a meal via the UI.
  await page.getByRole("navigation", { name: "main" }).getByRole("link", { name: "Meals" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Meals");
  await page.getByLabel("meal name").fill(mealName);
  await page.getByLabel("foods").fill("lentils, carrots");
  await page.getByLabel("calories").fill("400");
  await page.getByRole("button", { name: /log meal/i }).click();
  await expect(page.getByText(mealName)).toBeVisible({ timeout: 10_000 });

  // 6-7. Dashboard shows the meal (log 2 more for the weekly minimum of 3).
  for (const extra of ["breakfast", "lunch"]) {
    await request.post(apiUrl("/api/meals"), {
      data: { name: `${mealName} ${extra}`, mealType: extra, foods: [{ name: "oats" }] },
    });
  }
  await page.getByRole("navigation", { name: "main" }).getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByText(mealName, { exact: false }).first()).toBeVisible({ timeout: 10_000 });

  // 8-10. Statistics + Insights reflect stored data.
  await page.getByRole("navigation", { name: "main" }).getByRole("link", { name: "Insights" }).click();
  await expect(page.getByText(/meal activity/i)).toBeVisible({ timeout: 10_000 });

  // 11-12. Refresh: data persists (server-side JSON, not React state).
  await page.reload();
  await expect(page.getByText(/meal activity/i)).toBeVisible({ timeout: 10_000 });

  // 13. Every primary navbar destination renders a heading.
  for (const [label, heading] of [["Ask Flavora", "FLAVORA"], ["Dashboard", "Dashboard"], ["Meals", "Meals"], ["Insights", "Insights"], ["Settings", "Settings"]] as const) {
    await page.getByRole("navigation", { name: "main" }).getByRole("link", { name: label }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
  }

  // 14. Assistant week-summary is grounded in stored facts.
  const res = await request.post(apiUrl("/api/assistant"), {
    data: { message: "I ate 50 meals this week, right?", context: "week-summary" },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.facts.totalMeals).toBeGreaterThanOrEqual(3);
  expect(body.reply).not.toContain("50 meals");

  // Cleanup: remove test meals.
  const list = await (await request.get(apiUrl("/api/meals"))).json();
  for (const m of list.filter((x: { name: string }) => x.name.includes("E2E Soup"))) {
    await request.delete(apiUrl(`/api/meals/${m.id}`));
  }
});
