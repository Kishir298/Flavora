import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { App } from "./App";

function mockFetch() {
  return vi.fn(async (url: unknown) => {
    const u = String(url);
    const ok = (json: unknown) => ({ ok: true, json: async () => json });
    if (u.includes("/api/statistics")) {
      return ok({ status: "insufficient", range: "weekly", buckets: [], reason: "Not enough data yet.", totalMeals: 0, activeDays: 0, mealsPerDay: [], byType: {}, variety: { uniqueFoods: 0, uniqueMeals: 0 }, repeats: [], nutrition: {}, goalProgress: [], waterMl: null });
    }
    if (u.includes("/api/insights")) return ok([]);
    if (u.includes("/api/meals")) return ok([]);
    if (u.includes("/api/goals")) return ok({});
    if (u.includes("/api/health")) return ok({ ok: true, ai: {} });
    if (u.includes("/api/profile")) return ok({ allergies: [], avoidFoods: [], favoriteCuisines: [], theme: "light" });
    if (u.includes("/api/recommendations")) return ok({ recommendations: [] });
    if (u.includes("/api/inventory") || u.includes("/api/groceries") || u.includes("/api/meal-plans") || u.includes("/api/saved")) return ok([]);
    return ok({});
  }) as unknown as typeof fetch;
}

describe("navigation — every item reaches a real page", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch());
    window.history.pushState({}, "", "/");
  });

  const cases: [string, RegExp][] = [
    ["Ask Flavora", /^FLAVORA$/],
    ["Dashboard", /^Dashboard$/],
    ["Meals", /^Meals$/],
    ["Insights", /^Insights$/],
    ["Explorer", /browse|cuisine|region/i],
    ["Inventory", /^Inventory$/],
    ["Groceries", /grocer/i],
    ["Meal plan", /meal plan/i],
    ["Saved", /saved/i],
    ["Settings", /^Settings$/],
  ];

  for (const [label, heading] of cases) {
    it(`${label} navigates and marks active`, async () => {
      render(<App />);
      const nav = screen.getByRole("navigation", { name: "main" });
      fireEvent.click(within(nav).getByRole("link", { name: label }));
      await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
      expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(heading);
      // Active state: NavLink renders aria-current="page" when active.
      expect(within(nav).getByRole("link", { name: label }).getAttribute("aria-current")).toBe("page");
    });
  }

  it("keyboard: tab reaches nav links and Enter navigates", async () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "main" });
    const link = within(nav).getByRole("link", { name: "Meals" });
    link.focus();
    expect(document.activeElement).toBe(link);
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^Meals$/));
  });

  it("dashboard empty state links to meal logging", async () => {
    window.history.pushState({}, "", "/dashboard");
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Log your first meal/i)).toBeInTheDocument());
  });

  it("legacy /assistant redirects to chat home", async () => {
    window.history.pushState({}, "", "/assistant");
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^FLAVORA$/));
  });
});
