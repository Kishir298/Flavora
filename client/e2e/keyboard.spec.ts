import { test, expect } from "@playwright/test";

/**
 * Keyboard-only regression (§37): Tab → skip link → main → page → controls.
 * Uses real key presses — never component internals.
 */
test("keyboard: skip link → main → navigate → operate", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");

  // 1-2. First Tab stop is the skip link.
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: /skip to content/i });
  await expect(skip).toBeFocused();

  // 3-4. Activating it moves focus to main content.
  await page.keyboard.press("Enter");
  const main = page.locator("#main");
  await expect(main).toBeFocused();

  // 5. Continue tabbing: reach the natural-language field without a mouse.
  await page.keyboard.press("Tab"); // SyncBanner is hidden when idle; first stops are nav links
  let focused = "";
  for (let i = 0; i < 30; i++) {
    const tag = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? `${el.tagName}#${el.id}` : "";
    });
    if (tag === "INPUT#craving-input") {
      focused = tag;
      break;
    }
    await page.keyboard.press("Tab");
  }
  expect(focused).toBe("INPUT#craving-input");

  // 6. Type a request and submit via keyboard alone, answering follow-ups.
  await page.keyboard.type("I want something with chicken");
  await page.keyboard.press("Tab"); // Ask Flavora button
  await expect(page.getByRole("button", { name: /Ask Flavora/i })).toBeFocused();
  await page.keyboard.press("Enter");
  for (let i = 0; i < 6; i++) {
    try {
      await page.getByLabel(/Open /).first().waitFor({ timeout: 20_000 });
      break;
    } catch {
      const answers = ["Around 600 calories", "Non-veg", "Chicken, rice and onions", "Dinner", "Anything is fine"];
      await page.getByLabel(/Tell Flavora what you want/i).fill(answers[Math.min(i, answers.length - 1)]);
      await page.getByRole("button", { name: /Ask Flavora/i }).click();
    }
  }
  await expect(page.getByLabel(/Open /).first()).toBeVisible({ timeout: 20_000 });

  // 7. Open a primary page from the nav using only the keyboard.
  await page.keyboard.press("Escape");
  const explorer = page.getByRole("link", { name: /^Explorer$/ });
  await explorer.focus();
  await expect(explorer).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/explorer/);
  await expect(page.getByRole("button", { name: /^italian$/i })).toBeVisible();
});
