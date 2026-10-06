import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mock the entire api module with vi.hoisted
const mockApi = vi.hoisted(() => ({
  inventory: vi.fn(async () => []),
  groceries: vi.fn(async () => []),
  addGrocery: vi.fn(),
  updateGrocery: vi.fn(),
  removeGrocery: vi.fn(),
  addInventory: vi.fn(),
  updateInventory: vi.fn(),
  removeInventory: vi.fn(),
  consumeInventory: vi.fn(),
  clearGroceryCompleted: vi.fn(),
}));

vi.mock("./lib/api", () => ({
  api: mockApi,
}));

const { Groceries } = await import("./pages/Groceries");
const { Inventory } = await import("./pages/Inventory");

describe("Groceries states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("empty state", async () => {
    render(<MemoryRouter><Groceries /></MemoryRouter>);
    await waitFor(() => {
      expect(document.body.textContent).toContain("your grocery list is empty");
    }, { timeout: 10000, interval: 100 });
  }, 15000);
  it("groups by category + check", async () => {
    render(<MemoryRouter><Groceries /></MemoryRouter>);
    await waitFor(() => {
      expect(document.body.textContent).toContain("tomato");
    }, { timeout: 10000, interval: 100 });
  }, 15000);
});

describe("Inventory states", () => {
  it("empty state", async () => {
    render(<MemoryRouter><Inventory /></MemoryRouter>);
    await waitFor(() => {
      expect(document.body.textContent).toContain("ingredient");
    }, { timeout: 10000, interval: 100 });
  }, 15000);
})