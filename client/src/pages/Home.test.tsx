import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Home } from "./Home";

describe("Home assistant (guide contract)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (String(url).includes("/api/profile")) {
          return { ok: true, json: async () => ({ theme: "light" }) };
        }
        return {
          ok: true,
          json: async () => ({
            recommendations: [
              {
                recipeId: "mock:1",
                title: "Tomato Pasta",
                score: 0.82,
                matchReasons: ["uses 2 of your 2 ingredients", "fits your 30-minute limit"],
                cuisine: "italian",
                cookTime: 25,
                ingredients: ["pasta", "tomato"],
              },
            ],
          }),
        };
      }) as unknown as typeof fetch
    );
  });

  it("shows match reasons and a budget-mode toggle", async () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    expect(screen.getByText("Budget-friendly")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Budget-friendly"));
    fireEvent.click(screen.getByRole("button", { name: /Suggest/i }));
    await waitFor(() => expect(screen.getByText("Tomato Pasta")).toBeInTheDocument());
    expect(screen.getByText("uses 2 of your 2 ingredients")).toBeInTheDocument();
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1) as [string, RequestInit];
    expect(String(init.body)).toContain("budget");
    vi.unstubAllGlobals();
  });

  it("offers a food-waste mode that sends mode: food_waste", async () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("Use what I have"));
    fireEvent.click(screen.getByRole("button", { name: /Suggest/i }));
    await waitFor(() => expect(screen.getByText("Tomato Pasta")).toBeInTheDocument());
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1) as [string, RequestInit];
    expect(String(init.body)).toContain("food_waste");
    vi.unstubAllGlobals();
  });
});
