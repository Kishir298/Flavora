import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Home } from "./Home";

describe("Home assistant (guide contract)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/api/assistant")) {
          return {
            ok: true,
            json: async () => ({
              intent: { availableIngredients: ["chicken", "rice"], mode: "food_waste", timeLimit: 20 },
              source: "heuristic",
              notice: "No GROQ_API_KEY configured — using local intent parsing.",
              reply: "Prioritising recipes that use what you already have. Tomato Pasta — Uses 2 ingredients.",
              recommendations: [
                {
                  recipeId: "mock:1",
                  title: "Tomato Pasta",
                  score: 0.82,
                  matchReasons: ["Uses 2 of your 2 available ingredients"],
                  cuisine: "italian",
                  cookTime: 25,
                  costTier: "low",
                  ingredients: ["pasta", "tomato"],
                },
              ],
            }),
          };
        }
        if (u.includes("/api/recommendations")) {
          return {
            ok: true,
            json: async () => ({
              recommendations: [
                {
                  recipeId: "mock:1",
                  title: "Tomato Pasta",
                  score: 0.82,
                  matchReasons: ["Uses 2 of your 2 available ingredients", "Fits your 30-minute cooking preference"],
                  cuisine: "italian",
                  cookTime: 25,
                  costTier: "low",
                  ingredients: ["pasta", "tomato"],
                },
              ],
            }),
          };
        }
        void init;
        return { ok: true, json: async () => ({}) };
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
    expect(screen.getByText(/Uses 2 of your 2 available ingredients/i)).toBeInTheDocument();
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    const recCall = [...calls].reverse().find(([u]) => String(u).includes("/api/recommendations"));
    expect(String(recCall?.[1]?.body)).toContain("budget");
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
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    const recCall = [...calls].reverse().find(([u]) => String(u).includes("/api/recommendations"));
    expect(String(recCall?.[1]?.body)).toContain("food_waste");
    vi.unstubAllGlobals();
  });

  it("natural-language ask hits /api/assistant", async () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText(/Ask in plain language/i), {
      target: { value: "I have chicken and rice, 20 minutes" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ask Flavora/i }));
    await waitFor(() => expect(screen.getByText("Tomato Pasta")).toBeInTheDocument());
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    expect(calls.some(([u]) => String(u).includes("/api/assistant"))).toBe(true);
    vi.unstubAllGlobals();
  });
});
