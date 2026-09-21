import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Home } from "./Home";

describe("Home conversational flow", () => {
  beforeEach(() => {
    localStorage.clear();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/api/assistant/conversation")) {
          calls += 1;
          if (calls === 1) {
            return {
              ok: true,
              json: async () => ({
                sessionId: "s1",
                question: "About how many calories are you aiming for?",
                done: false,
                foodRequest: { craving: "chicken" },
                intent: {},
                source: "heuristic",
                fallbackReason: "local-unreachable",
                notice: null,
                reply: "",
                recommendations: [],
              }),
            };
          }
          return {
            ok: true,
            json: async () => ({
              sessionId: "s1",
              question: null,
              done: true,
              foodRequest: { craving: "chicken", calorieTarget: 600, mealType: "dinner" },
              intent: { availableIngredients: ["chicken", "rice"] },
              source: "heuristic",
              fallbackReason: "local-unreachable",
              notice: null,
              reply: "Here are allergy-safe picks from your local library.",
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
        if (u.includes("/api/meals") && init?.method === "POST") {
          return { ok: true, json: async () => ({ id: "m1" }) };
        }
        void init;
        return { ok: true, json: async () => ({}) };
      }) as unknown as typeof fetch
    );
  });

  it("asks only missing info, then shows recommendations", async () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    expect(screen.getByText("What are you craving today?")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Tell Flavora what you want/i), {
      target: { value: "I want something with chicken" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ask Flavora/i }));
    await waitFor(() =>
      expect(screen.getByText("About how many calories are you aiming for?")).toBeInTheDocument()
    );

    fireEvent.change(screen.getByLabelText(/Tell Flavora what you want/i), {
      target: { value: "Around 600 calories for dinner" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ask Flavora/i }));
    await waitFor(() => expect(screen.getByText("Tomato Pasta")).toBeInTheDocument());
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    expect(calls.some(([u]) => String(u).includes("/api/assistant/conversation"))).toBe(true);
    vi.unstubAllGlobals();
  });

  it("logs a recommendation as eaten (never auto-logged)", async () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText(/Tell Flavora what you want/i), {
      target: { value: "I want something with chicken" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ask Flavora/i }));
    await waitFor(() =>
      expect(screen.getByText("About how many calories are you aiming for?")).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText(/Tell Flavora what you want/i), {
      target: { value: "Around 600 calories for dinner" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ask Flavora/i }));
    await waitFor(() => expect(screen.getByText("Tomato Pasta")).toBeInTheDocument());
    // Nothing logged implicitly: no POST /api/meals happened yet.
    let calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    expect(calls.some(([u, init]) => String(u).includes("/api/meals") && init?.method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Log Tomato Pasta as eaten/i }));
    await waitFor(() => expect(screen.getByText(/Logged "Tomato Pasta"/)).toBeInTheDocument());
    calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    expect(calls.some(([u, init]) => String(u).includes("/api/meals") && init?.method === "POST")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("offers quick actions", () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    for (const label of ["Make a meal", "Eat healthier", "Use my pantry", "Plan meals"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("submits the exact typed message and shows user bubble + follow-up (no loop)", async () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    // Submit via Enter key.
    fireEvent.change(screen.getByLabelText(/Tell Flavora what you want/i), {
      target: { value: "i want chicken" },
    });
    fireEvent.submit(screen.getByRole("form", { name: /ask-flavora-form/i }));
    // User message is rendered verbatim…
    await waitFor(() => expect(screen.getByText("i want chicken")).toBeInTheDocument());
    // …the exact string reached the API…
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    const bodies = calls
      .filter(([u]) => String(u).includes("/api/assistant/conversation"))
      .map(([, init]) => JSON.parse(String(init?.body ?? "{}")) as { message?: string });
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies[0].message).toBe("i want chicken");
    // …and the assistant moved past the initial prompt.
    await waitFor(() =>
      expect(screen.getByText("About how many calories are you aiming for?")).toBeInTheDocument()
    );
    vi.unstubAllGlobals();
  });

  it("new chat resets the session", async () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText(/Tell Flavora what you want/i), {
      target: { value: "I want something with chicken" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ask Flavora/i }));
    await waitFor(() =>
      expect(screen.getByText("About how many calories are you aiming for?")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: /Start a new conversation/i }));
    expect(screen.queryByText("About how many calories are you aiming for?")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("retry does not duplicate the user bubble", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes("/api/assistant/conversation")) {
          calls += 1;
          if (calls === 1) throw new Error("load failed");
          return {
            ok: true,
            json: async () => ({
              sessionId: "s1",
              question: "About how many calories are you aiming for?",
              done: false,
              foodRequest: { craving: "chicken" },
              intent: {},
              source: "heuristic",
              fallbackReason: "local-unreachable",
              notice: null,
              reply: "",
              recommendations: [],
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      }) as unknown as typeof fetch
    );
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText(/Tell Flavora what you want/i), {
      target: { value: "i want chicken" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ask Flavora/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument());
    expect(screen.getAllByText("i want chicken")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
    await waitFor(() =>
      expect(screen.getByText("About how many calories are you aiming for?")).toBeInTheDocument()
    );
    // Still a single user bubble after retry (no duplicate push).
    expect(screen.getAllByText("i want chicken")).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("rapid double submit sends exactly one request (single-flight)", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes("/api/assistant/conversation")) {
          calls += 1;
          // Slow response so the second submit lands while loading=true.
          await new Promise((r) => setTimeout(r, 50));
          return {
            ok: true,
            json: async () => ({
              sessionId: "s9",
              question: "About how many calories are you aiming for?",
              done: false,
              foodRequest: { craving: "beef" },
              intent: {},
              source: "heuristic",
              fallbackReason: "local-unreachable",
              notice: null,
              reply: "",
              recommendations: [],
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      }) as unknown as typeof fetch
    );
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText(/Tell Flavora what you want/i), {
      target: { value: "i want beef" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ask Flavora/i }));
    fireEvent.click(screen.getByRole("button", { name: /Ask Flavora/i }));
    await waitFor(() =>
      expect(screen.getByText("About how many calories are you aiming for?")).toBeInTheDocument()
    );
    expect(calls).toBe(1);
    expect(screen.getAllByText("i want beef")).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("server reset flag announces a fresh start instead of silent continuation", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes("/api/assistant/conversation")) {
          calls += 1;
          if (calls === 1) {
            return {
              ok: true,
              json: async () => ({
                sessionId: "s1",
                question: "About how many calories are you aiming for?",
                done: false,
                reset: false,
                foodRequest: { craving: "chicken" },
                intent: {},
                source: "heuristic",
                fallbackReason: "local-unreachable",
                notice: null,
                reply: "",
                recommendations: [],
              }),
            };
          }
          // Stale session id -> server starts fresh with reset:true.
          return {
            ok: true,
            json: async () => ({
              sessionId: "s2",
              question: "What are you craving today?",
              done: false,
              reset: true,
              foodRequest: {},
              intent: {},
              source: "heuristic",
              fallbackReason: "heuristic-mode",
              notice: null,
              reply: "",
              recommendations: [],
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      }) as unknown as typeof fetch
    );
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText(/Tell Flavora what you want/i), {
      target: { value: "i want chicken" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ask Flavora/i }));
    await waitFor(() =>
      expect(screen.getByText("About how many calories are you aiming for?")).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText(/Tell Flavora what you want/i), {
      target: { value: "600" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ask Flavora/i }));
    await waitFor(() =>
      expect(screen.getByText(/Starting fresh — my earlier context expired or completed\./)).toBeInTheDocument()
    );
    vi.unstubAllGlobals();
  });
});
