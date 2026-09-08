import { describe, it, expect } from "vitest";
import { normalizeIntent, extractJsonObject } from "./intentSchema.js";
import { parseIntentHeuristic } from "./heuristicParser.js";
import { parseUserIntent, buildAssistantReply } from "./assistantService.js";
import type { AIProvider } from "./types.js";

describe("ai/intentSchema", () => {
  it("normalizes supported fields and drops junk", () => {
    const intent = normalizeIntent({
      availableIngredients: [" Chicken ", "RICE", ""],
      timeLimit: 20,
      cuisine: "Indian",
      mode: "food_waste",
      craving: "spicy",
      preferences: { spice: "hot", skill: "beginner", highProtein: true },
      evil: "ignore me",
    });
    expect(intent.availableIngredients).toEqual(["chicken", "rice"]);
    expect(intent.timeLimit).toBe(20);
    expect(intent.cuisine).toBe("indian");
    expect(intent.mode).toBe("food_waste");
    expect(intent.preferences?.spice).toBe("hot");
    expect((intent as { evil?: string }).evil).toBeUndefined();
  });

  it("rejects invalid mode/time/cuisine", () => {
    const intent = normalizeIntent({ mode: "keto", timeLimit: 999, cuisine: "martian" });
    expect(intent.mode).toBeUndefined();
    expect(intent.timeLimit).toBeUndefined();
    expect(intent.cuisine).toBeNull();
  });

  it("extracts JSON from markdown fences and recovers from preamble", () => {
    expect(extractJsonObject('```json\n{"mode":"budget"}\n```')).toEqual({ mode: "budget" });
    expect(extractJsonObject('Sure!\n{"mode":"normal","timeLimit":15}')).toEqual({
      mode: "normal",
      timeLimit: 15,
    });
  });

  it("throws on empty / malformed AI text", () => {
    expect(() => extractJsonObject("")).toThrow();
    expect(() => extractJsonObject("not json at all")).toThrow();
  });
});

describe("ai/heuristicParser", () => {
  it("parses ingredients, time, cuisine, budget, and skill cues", () => {
    const intent = parseIntentHeuristic(
      "I have chicken, rice and onions. I only have 20 minutes. Give me something cheap and easy — Indian food."
    );
    expect(intent.availableIngredients?.length).toBeGreaterThanOrEqual(2);
    expect(intent.timeLimit).toBe(20);
    expect(intent.mode).toBe("budget");
    expect(intent.cuisine).toBe("indian");
    expect(intent.preferences?.skill).toBe("beginner");
  });

  it("uses food_waste when listing what you have", () => {
    const intent = parseIntentHeuristic("What can I make with what I already have?");
    expect(intent.mode).toBe("food_waste");
  });

  it("handles vague surprise requests", () => {
    const intent = parseIntentHeuristic("I don't know what I want, surprise me");
    expect(intent.craving).toMatch(/surprise/i);
  });
});

describe("ai/parseUserIntent", () => {
  it("falls back to heuristic when provider unavailable", async () => {
    const provider: AIProvider = {
      name: "none",
      isAvailable: () => false,
      complete: async () => {
        throw new Error("nope");
      },
    };
    const parsed = await parseUserIntent("I have pasta and tomato, 30 minutes", { provider });
    expect(parsed.source).toBe("heuristic");
    expect(parsed.intent.availableIngredients?.length).toBeGreaterThan(0);
    expect(parsed.notice).toBeTruthy();
  });

  it("uses Groq provider output when available", async () => {
    const provider: AIProvider = {
      name: "groq",
      isAvailable: () => true,
      complete: async () => JSON.stringify({ availableIngredients: ["eggs"], mode: "normal", timeLimit: 15 }),
    };
    const parsed = await parseUserIntent("something with eggs", { provider });
    expect(parsed.source).toBe("groq");
    expect(parsed.intent.availableIngredients).toEqual(["eggs"]);
    expect(parsed.intent.timeLimit).toBe(15);
  });

  it("recovers with heuristic when Groq returns garbage", async () => {
    const provider: AIProvider = {
      name: "groq",
      isAvailable: () => true,
      complete: async () => "definitely not json",
    };
    const parsed = await parseUserIntent("I have rice, 20 minutes", { provider });
    expect(parsed.source).toBe("heuristic");
    expect(parsed.notice).toMatch(/unavailable/i);
  });
});

describe("ai/buildAssistantReply", () => {
  it("never invents recipes — only explains engine results", () => {
    const reply = buildAssistantReply(
      "make something",
      { mode: "food_waste" },
      [{ title: "Tomato Pasta", matchReasons: ["Uses 2 of your 2 available ingredients"] }]
    );
    expect(reply).toMatch(/Tomato Pasta/);
    expect(reply).toMatch(/food-waste|what you already have/i);
  });

  it("explains empty results without suggesting allergy bypass", () => {
    const reply = buildAssistantReply("x", { mode: "normal" }, []);
    expect(reply.toLowerCase()).toMatch(/allergy/);
    expect(reply.toLowerCase()).not.toMatch(/ignore your allerg/);
  });
});
