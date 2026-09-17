import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { Meals } from "./pages/Meals";

const statsOk = {
  status: "ok", range: "weekly", totalMeals: 5, activeDays: 4,
  mealsPerDay: [0, 0, 1, 1, 1, 2, 0],
  buckets: ["2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"].map((date, i) => ({ date, meals: [0, 0, 1, 1, 1, 2, 0][i], calories: null, protein_g: null })),
  byType: { dinner: 5 }, variety: { uniqueFoods: 4, uniqueMeals: 3 },
  repeats: [{ name: "oatmeal", count: 3 }],
  nutrition: { calories: 1560, protein_g: 20, carbs_g: null, fat_g: null, daysWithData: 4 },
  goalProgress: [{ label: "Daily meals", target: 7, actual: 5, met: false }],
  waterMl: null,
};

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    for (const [k, v] of Object.entries(routes)) {
      if (u.includes(k)) {
        if (init?.method === "POST" || init?.method === "PUT") return { ok: true, json: async () => ({ ...(v as object), ...(JSON.parse(String(init.body ?? "{}")) as object), id: "m1" }) };
        if (init?.method === "DELETE") return { ok: true, json: async () => ({ ok: true }) };
        return { ok: true, json: async () => v };
      }
    }
    return { ok: true, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

describe("dashboard — renders stored values, not placeholders", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch({
      "/api/statistics": statsOk,
      "/api/insights": [{ id: "a", text: "You logged meals on 4 of the last 7 days.", kind: "consistency" }],
      "/api/meals": [{ id: "m1", name: "Oatmeal", mealType: "breakfast", loggedAt: "2026-09-16T08:00:00Z", foods: [{ name: "oats" }], nutrition: { calories: 300 } }],
      "/api/goals": { mealsPerDay: 1 },
    }));
  });

  it("shows real totals, recent meal, goal ring and insight", async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/5 meal\(s\) across 4 day\(s\)/)).toBeInTheDocument());
    expect(screen.getByText("Oatmeal")).toBeInTheDocument();
    expect(screen.getByText("Daily meals")).toBeInTheDocument();
    expect(screen.getByText("You logged meals on 4 of the last 7 days.")).toBeInTheDocument();
  });
});

describe("meals page — log and list", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch({ "/api/meals": [] }));
  });

  it("logs a meal and shows it in history", async () => {
    const meals: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/meals") && init?.method === "POST") {
        const rec = { ...(JSON.parse(String(init.body ?? "{}")) as object), id: "m1" };
        meals.push(rec);
        return { ok: true, json: async () => rec };
      }
      if (u.includes("/api/meals")) return { ok: true, json: async () => meals };
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch);
    render(<MemoryRouter><Meals /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/No meals logged yet/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("meal name"), { target: { value: "Soup" } });
    fireEvent.change(screen.getByLabelText(/foods/i), { target: { value: "lentils" } });
    fireEvent.click(screen.getByRole("button", { name: /log meal/i }));
    await waitFor(() => expect(screen.queryByText(/No meals logged yet/)).not.toBeInTheDocument());
  });
});
