import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Groceries } from "./pages/Groceries";
import { Inventory } from "./pages/Inventory";

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => ({
    ok: true,
    json: async () => {
      for (const [k, v] of Object.entries(routes)) if (url.includes(k)) return v;
      return [];
    },
  }));
}

describe("Groceries states", () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
  it("empty state", async () => {
    vi.stubGlobal("fetch", mockFetch({ "/api/groceries": [] }));
    render(<MemoryRouter><Groceries /></MemoryRouter>);
    expect(await screen.findByText(/grocery list is empty/i)).toBeDefined();
  });
  it("groups by category + check", async () => {
    vi.stubGlobal("fetch", mockFetch({
      "/api/groceries": [{ id: 1, name: "tomato", quantity: 2, unit: "pieces", note: "", category: "produce", checked: false, removed: false, source: "manual", recipeIds: [] }],
    }));
    render(<MemoryRouter><Groceries /></MemoryRouter>);
    expect(await screen.findByText(/produce/i)).toBeDefined();
  });
});

describe("Inventory states", () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
  it("empty state", async () => {
    vi.stubGlobal("fetch", mockFetch({ "/api/inventory": [] }));
    render(<MemoryRouter><Inventory /></MemoryRouter>);
    expect(await screen.findByText(/haven't added any ingredients/i)).toBeDefined();
  });
});
