import { test, expect } from "@playwright/test";
import { chatUntilResults } from "./conversation";
import { apiUrl } from "./apiBase";

/**
 * §21: complete user journey — goals → 3 meals → dashboard → statistics →
 * meal plan → groceries → assistant facts → reload persistence.
 */
test("complete journey: goals, meals, dashboard, plan, groceries, reload", async ({ page, request }) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  const nav = page.getByRole("navigation", { name: "main" });

  // Start clean: remove leftovers from interrupted runs.
  const pre = await (await request.get(apiUrl("/api/meals"))).json();
  for (const m of pre.filter((x: { name: string }) => x.name.startsWith("J "))) {
    await request.delete(apiUrl(`/api/meals/${m.id}`));
  }

  // Goals first (Settings).
  await page.goto("/settings");
  await page.getByLabel("meals per day goal").fill("3");
  await page.getByRole("button", { name: /save goals/i }).click();
  await expect(page.getByText(/goals saved/i)).toBeVisible({ timeout: 10_000 });

  // Breakfast, lunch, dinner via the Meals UI.
  await nav.getByRole("link", { name: "Meals" }).click();
  const logged: string[] = [];
  for (const [type, name] of [["breakfast", `J Oats ${stamp}`], ["lunch", `J Salad ${stamp}`], ["dinner", `J Soup ${stamp}`]] as const) {
    await page.getByLabel("meal name").fill(name);
    await page.getByLabel("meal type").selectOption(type);
    await page.getByLabel("foods").fill("oats, milk");
    await page.getByLabel("calories").fill("300");
    await page.getByRole("button", { name: /^log meal$/i }).click();
    await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 });
    logged.push(name);
  }

  // Dashboard reflects the logged meals.
  await nav.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByText(/3 meal\(s\) across/i)).toBeVisible({ timeout: 10_000 });

  // Statistics show calculated values.
  await nav.getByRole("link", { name: "Insights" }).click();
  await expect(page.getByText(/meal activity/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/average:/i)).toBeVisible({ timeout: 10_000 });

  // Meal plan → groceries chain (existing critical-path APIs via UI).
  await nav.getByRole("link", { name: "Ask Flavora" }).click();
  await chatUntilResults(page, "I want something with oats and milk");
  const first = page.getByLabel(/open /i).first();
  await expect(first).toBeVisible({ timeout: 15_000 });
  const href = await first.getAttribute("href");
  const recipeId = decodeURIComponent(href?.split("/recipe/")[1] ?? "");
  await nav.getByRole("link", { name: "Meal plan" }).click();
  await page.getByLabel(/recipe id/i).fill(recipeId);
  await page.getByRole("button", { name: /^add$/i }).click();
  await expect(page.getByText(recipeId).first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /generate groceries/i }).click();
  await expect(page.getByText(/grocery list generated/i)).toBeVisible({ timeout: 15_000 });
  await nav.getByRole("link", { name: "Groceries" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/grocer/i);

  // Assistant answers from stored facts.
  const res = await request.post(apiUrl("/api/assistant"), {
    data: { message: "How many meals did I log?", context: "week-summary" },
  });
  expect(res.ok()).toBe(true);
  expect((await res.json()).facts.totalMeals).toBeGreaterThanOrEqual(3);

  // Reload: everything persists.
  await page.reload();
  await nav.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByText(/3 meal\(s\) across/i)).toBeVisible({ timeout: 10_000 });
  await nav.getByRole("link", { name: "Meals" }).click();
  for (const name of logged) await expect(page.getByText(name)).toBeVisible();

  // Cleanup test data.
  const list = await (await request.get(apiUrl("/api/meals"))).json();
  for (const m of list.filter((x: { name: string }) => x.name.includes(String(stamp)))) {
    await request.delete(apiUrl(`/api/meals/${m.id}`));
  }
});
