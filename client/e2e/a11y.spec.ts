import { test, expect, type Page } from "@playwright/test";
import { chatUntilResults } from "./conversation";

/**
 * Automated accessibility audit.
 *
 * Baseline (always runs, dependency-free so it works offline in CI):
 * §36 landmarks, form labels, button names, duplicate IDs, image alts,
 * document language, invalid ARIA references.
 *
 * Enhancement: when `@axe-core/playwright` is installed (it is a client
 * devDependency; `npm install` fetches it when the registry is reachable),
 * every audited route additionally runs axe with zero critical/serious
 * violations allowed. The import is dynamic + guarded so offline
 * environments without the package still run the baseline.
 */

const ROUTES = [
  "/",
  "/dashboard",
  "/meals",
  "/insights",
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
  // Main is a focus target for skip-link / route-change focus management.
  expect(await page.locator("main#main[tabindex='-1']").count()).toBe(1);
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

  // Every visible link has an accessible name (recipe cards render as
  // `Open <title>` links; generic "click here" links would fail here).
  const links = page.locator("a[href]");
  for (let i = 0; i < (await links.count()); i++) {
    const a = links.nth(i);
    if (!(await a.isVisible())) continue;
    const name = ((await a.textContent()) ?? "").trim() || (await a.getAttribute("aria-label")) || "";
    expect(name.length, `link #${i} has no accessible name`).toBeGreaterThan(0);
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

  // axe-core automated check (guarded: skipped when the package is absent,
  // e.g. offline CI that could not `npm install` it — baseline above still runs).
  // Gate: WCAG 2.0/2.1 A + AA only. AAA `color-contrast-enhanced` (7:1) is
  // intentionally excluded — muted secondary text targets AA (4.5:1), the
  // legal/standard bar; AAA would force body-text-strength color everywhere.
  try {
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    expect(
      blocking.map((v) => `${v.id}: ${v.description}`),
      `axe critical/serious violations`,
    ).toEqual([]);
  } catch (e) {
    if (e instanceof Error && /cannot find module|failed to resolve/i.test(e.message)) {
      test.info().annotations.push({ type: "axe", description: "skipped: @axe-core/playwright not installed" });
    } else {
      throw e;
    }
  }
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
  test.setTimeout(120_000);
  await page.goto("/");
  // Chat log (role=log) + loading + error regions exist with accessible roles.
  await chatUntilResults(page, "I want something with chicken");
  // AI status line names the actual provider (never bare "AI Powered").
  const status = page.getByTestId("ai-status");
  await expect(status).toBeVisible();
  await expect(status).toContainText(/AI: (FlavoraLM|Heuristic)/);
});

test("route-specific accessible contracts", async ({ page }) => {
  // Assistant: named live log, labelled input, named submit, AI status.
  await page.goto("/");
  const log = page.getByRole("log", { name: /flavora conversation/i });
  await expect(log).toBeVisible({ timeout: 10_000 });
  await expect(log).toHaveAttribute("aria-live", "polite");
  await expect(page.getByLabel(/tell flavora what you want/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /ask flavora/i })).toBeVisible();
  await expect(page.getByTestId("ai-status")).toBeVisible();

  // Dashboard + Insights: every chart exposes a text alternative.
  for (const route of ["/dashboard", "/insights"]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
    const charts = page.locator("[role='img']");
    for (let i = 0; i < (await charts.count()); i++) {
      const label = ((await charts.nth(i).getAttribute("aria-label")) ?? "").trim();
      expect(label.length, `chart #${i} on ${route} has no text alternative`).toBeGreaterThan(0);
    }
  }

  // Explorer: recipe cards are named links.
  await page.goto("/explorer");
  await page.getByRole("button", { name: /^italian$/i }).click();
  const first = page.getByLabel(/Open /).first();
  await expect(first).toBeVisible({ timeout: 10_000 });
  expect(((await first.textContent()) ?? "").trim().length).toBeGreaterThan(0);

  // Pantry / groceries / meal plan / settings: key forms are labelled.
  await page.goto("/inventory");
  await expect(page.getByLabel(/ingredient name/i).first()).toBeVisible({ timeout: 10_000 });
  await page.goto("/groceries");
  await expect(page.getByLabel(/grocery item name/i).first()).toBeVisible({ timeout: 10_000 });
  await page.goto("/meal-plan");
  await expect(page.getByLabel(/^day$/i).first()).toBeVisible({ timeout: 10_000 });
  await page.goto("/settings");
  await expect(page.getByLabel(/meals per day goal/i).first()).toBeVisible({ timeout: 10_000 });
});

test("form validation errors are announced", async ({ page }) => {
  // Meals: submitting without a name surfaces a role=alert error (no backend needed).
  await page.goto("/meals");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/meals/i);
  await page.getByLabel("meal name").fill("");
  await page.getByRole("button", { name: /^log meal$/i }).click();
  const alert = page.getByRole("alert").first();
  await expect(alert).toBeVisible({ timeout: 10_000 });
  expect(((await alert.textContent()) ?? "").trim().length).toBeGreaterThan(0);
});
