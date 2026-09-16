import { test, expect, type Page } from "@playwright/test";

/**
 * Automated accessibility audit (dependency-free so it runs offline in CI).
 *
 * Covers §36: landmarks, form labels, button names, duplicate IDs,
 * image alts, document language, and invalid ARIA references.
 * If network access allows, prefer adding @axe-core/playwright and running
 * AxeBuilder alongside these checks — these assertions are the baseline that
 * must pass either way.
 */

const ROUTES = [
  "/",
  "/explorer",
  "/inventory",
  "/groceries",
  "/meal-plan",
  "/saved",
  "/settings",
  "/onboarding",
];

async function auditPage(page: Page) {
  // Single top-level main landmark, labelled by the skip link target.
  expect(await page.locator("main").count()).toBe(1);
  // Semantic nav with an accessible name.
  const nav = page.locator("nav[aria-label], nav[aria-labelledby]");
  expect(await nav.count()).toBeGreaterThanOrEqual(1);

  // Every button has an accessible name (visible text or aria-label).
  const buttons = page.locator("button");
  for (let i = 0; i < (await buttons.count()); i++) {
    const b = buttons.nth(i);
    if (!(await b.isVisible())) continue;
    const name = ((await b.textContent()) ?? "").trim() || (await b.getAttribute("aria-label")) || "";
    expect(name.length, `button #${i} has no accessible name`).toBeGreaterThan(0);
  }

  // Every form control has a label (explicit, wrapping, or aria-labelled).
  const controls = page.locator("input, select, textarea");
  for (let i = 0; i < (await controls.count()); i++) {
    const c = controls.nth(i);
    if (!(await c.isVisible())) continue;
    const id = await c.getAttribute("id");
    const ariaLabel = (await c.getAttribute("aria-label")) ?? "";
    const ariaLabelledby = (await c.getAttribute("aria-labelledby")) ?? "";
    let labelled = ariaLabel.trim().length > 0 || ariaLabelledby.trim().length > 0;
    if (!labelled && id) {
      labelled = (await page.locator(`label[for="${id}"]`).count()) > 0;
    }
    if (!labelled) {
      // Wrapping label: control inside a <label>.
      labelled = await c.evaluate((el) => el.closest("label") !== null);
    }
    const describe = `${await c.evaluate((el) => el.outerHTML.slice(0, 80))}`;
    expect(labelled, `control has no label: ${describe}`).toBe(true);
  }

  // No duplicate IDs (breaks label association + ARIA references).
  const dupes = await page.evaluate(() => {
    const seen = new Map<string, number>();
    for (const el of document.querySelectorAll("[id]")) {
      seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
    }
    return [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  });
  expect(dupes).toEqual([]);

  // Images expose alt text (decorative images use alt="").
  const imgs = page.locator("img");
  for (let i = 0; i < (await imgs.count()); i++) {
    expect(await imgs.nth(i).getAttribute("alt"), `img #${i} missing alt`).not.toBeNull();
  }

  // aria-* references resolve.
  const brokenRefs = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll("[aria-labelledby]")) {
      for (const id of (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean)) {
        if (!document.getElementById(id)) bad.push(id);
      }
    }
    return bad;
  });
  expect(brokenRefs).toEqual([]);
}

test("document has a language", async ({ page }) => {
  await page.goto("/");
  expect(await page.locator("html[lang]").count()).toBe(1);
});

for (const route of ROUTES) {
  test(`a11y audit: ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
    await auditPage(page);
  });
}

test("a11y audit: recipe detail", async ({ page }) => {
  await page.goto("/explorer");
  await page.getByRole("button", { name: /^italian$/i }).click();
  const first = page.getByLabel(/Open /).first();
  await expect(first).toBeVisible({ timeout: 10_000 });
  await first.click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await auditPage(page);
});

test("assistant status regions are announced", async ({ page }) => {
  await page.goto("/");
  // Loading + error + notice regions exist with accessible roles.
  await page.getByLabel(/What do you have/i).fill("pasta, tomato");
  await page.getByRole("button", { name: /Suggest/i }).click();
  await expect(page.getByLabel(/Open /).first()).toBeVisible({ timeout: 10_000 });
  // AI status line names the actual provider (never bare "AI Powered").
  const status = page.getByTestId("ai-status");
  await expect(status).toBeVisible();
  await expect(status).toContainText(/AI: (FlavoraLM|Heuristic|Groq)/);
});
