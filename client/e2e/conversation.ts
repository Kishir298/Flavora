import { expect, type Page } from "@playwright/test";

/**
 * Shared conversational helper: send the first message, then answer up to 5
 * follow-up questions until recommendations appear. Each turn can take ~10s+
 * with live FlavoraLM inference, so callers must raise the test timeout
 * (e.g. `test.setTimeout(120_000)`).
 */
export async function chatUntilResults(page: Page, firstMessage: string): Promise<void> {
  await page.getByLabel(/Tell Flavora what you want/i).fill(firstMessage);
  await page.getByRole("button", { name: /Ask Flavora/i }).click();
  const answers = [
    "Around 600 calories",
    "Non-veg",
    "Chicken, rice and onions",
    "Dinner",
    "Anything is fine",
  ];
  for (let i = 0; i < 6; i++) {
    try {
      await page.getByLabel(/Open /).first().waitFor({ timeout: 20_000 });
      return;
    } catch {
      await page.getByLabel(/Tell Flavora what you want/i).fill(answers[Math.min(i, answers.length - 1)]);
      await page.getByRole("button", { name: /Ask Flavora/i }).click();
    }
  }
  await expect(page.getByLabel(/Open /).first()).toBeVisible({ timeout: 20_000 });
}
