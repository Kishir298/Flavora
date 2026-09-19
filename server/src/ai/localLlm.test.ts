import { describe, it, expect } from "vitest";
import { LocalLlmProvider, isLocalHost, LocalLlmError } from "./localLlmProvider.js";
import { createAIProvider } from "./provider.js";
import { parseUserIntent } from "./assistantService.js";
import { normalizeIntent } from "./intentSchema.js";
import { passesHardFilter } from "../engine/filter.js";
import { recommendWithEngine } from "../engine/recommend.js";
import type { AIProvider } from "./types.js";

describe("ai/localLlmProvider — local-only enforcement", () => {
  it("accepts loopback/localhost hosts", () => {
    expect(isLocalHost("http://127.0.0.1:5000")).toBe(true);
    expect(isLocalHost("http://127.0.0.2:5000")).toBe(true);
    expect(isLocalHost("http://localhost:5000")).toBe(true);
    expect(isLocalHost("http://app.localhost:5000")).toBe(true);
    expect(isLocalHost("http://[::1]:5000")).toBe(true);
  });

  it("refuses 0.0.0.0 and *.local (not loopback)", () => {
    expect(isLocalHost("http://0.0.0.0:5000")).toBe(false);
    expect(isLocalHost("http://box.local:5000")).toBe(false);
    expect(isLocalHost("http://printer.local:5000")).toBe(false);
    expect(() => new LocalLlmProvider({ host: "http://0.0.0.0:5000" })).toThrow(LocalLlmError);
    expect(() => new LocalLlmProvider({ host: "http://box.local:5000" })).toThrow(LocalLlmError);
  });

  it("refuses remote hosts — local mode can never contact a remote service", () => {
    expect(isLocalHost("https://api.example.com")).toBe(false);
    expect(isLocalHost("http://192.168.1.10:5000")).toBe(false);
    expect(isLocalHost("not a url")).toBe(false);
    expect(() => new LocalLlmProvider({ host: "https://api.example.com" })).toThrow(LocalLlmError);
  });

  it("reports unreachable service via probeAvailability (closed port, deterministic)", async () => {
    // Use a closed high port so the test is deterministic whether or not
    // FlavoraLM runs on :5000 in this environment.
    const p = new LocalLlmProvider({ host: "http://127.0.0.1:59999", timeoutMs: 1000 });
    const ok = await p.probeAvailability();
    expect(ok).toBe(false);
    expect(p.isAvailable()).toBe(false);
  });

  it("probeStatus reports unreachable fields honestly (never fabricated)", async () => {
    const p = new LocalLlmProvider({ host: "http://127.0.0.1:59999", timeoutMs: 1000 });
    const status = await p.probeStatus();
    expect(status).toEqual({ runtimeReachable: false, modelInstalled: false, usable: false, detail: "unreachable" });
  });

  it("probeStatus against live FlavoraLM (if running) reports measured identity", async () => {
    const p = new LocalLlmProvider({ host: "http://127.0.0.1:5000", timeoutMs: 3000 });
    const status = await p.probeStatus();
    // Either the service is down (unreachable) or up with measured identity.
    // Never assert a fixed outcome — assert shape honesty.
    expect(["ok", "unloaded", "unreachable"]).toContain(status.detail);
    if (status.usable) {
      expect(status.runtimeReachable).toBe(true);
      expect(status.modelInstalled).toBe(true);
      expect(status.model).toMatch(/^flavoraLM/i);
    }
  });

  it("complete() on unreachable service throws a clear local error", async () => {
    const p = new LocalLlmProvider({ host: "http://127.0.0.1:59999", timeoutMs: 1000 });
    await expect(p.complete("sys", "hi")).rejects.toThrow(LocalLlmError);
    await expect(p.complete("sys", "hi")).rejects.toThrow(/unreachable|HTTP|timed out/i);
  });

  it("never contacts remote hosts even when asked (local mode is loopback-only)", async () => {
    // Constructor refusal is the enforcement point — no instance can target remote.
    expect(() => new LocalLlmProvider({ host: "http://10.0.0.5:5000" })).toThrow(LocalLlmError);
    expect(() => new LocalLlmProvider({ host: "https://inference.example.com" })).toThrow(LocalLlmError);
  });
});

describe("ai/provider selection modes", () => {
  it("local resolves to local (no remote fallback exists)", () => {
    const { provider, resolvedMode } = createAIProvider({ selection: "local", localHost: "http://127.0.0.1:5000" });
    expect(resolvedMode).toBe("local");
    expect(provider.name).toBe("local");
  });

  it("heuristic mode yields an unavailable provider (deterministic parsing only)", () => {
    const { provider, resolvedMode } = createAIProvider({ selection: "heuristic" });
    expect(resolvedMode).toBe("heuristic");
    expect(provider.isAvailable()).toBe(false);
  });

  it("local-only: no remote provider is ever constructed (no api key concept)", () => {
    const { provider, resolvedMode } = createAIProvider({ selection: "local" });
    expect(resolvedMode).toBe("local");
    expect(provider.name === "groq").toBe(false);
  });
});

describe("ai/parseUserIntent — local mode fallback behaviour", () => {
  const unavailableLocal: AIProvider = {
    name: "local",
    isAvailable: () => false,
    complete: async () => {
      throw new Error("unreachable");
    },
  };

  it("local provider unavailable → deterministic heuristic, never groq", async () => {
    const parsed = await parseUserIntent("I have pasta and tomato, 30 minutes", { provider: unavailableLocal });
    expect(parsed.source).toBe("heuristic");
    expect(parsed.intent.availableIngredients?.length).toBeGreaterThan(0);
    expect(parsed.notice).toBeTruthy();
  });

  it("local provider that returns malformed output falls back to heuristics", async () => {
    const brokenLocal: AIProvider = {
      name: "local",
      isAvailable: () => true,
      complete: async () => "<<<not json at all>>>",
    };
    const parsed = await parseUserIntent("I have rice, 20 minutes", { provider: brokenLocal });
    expect(parsed.source).toBe("heuristic");
    expect(parsed.intent.timeLimit).toBe(20);
  });

  it("local provider with valid structured output is used and marked source=local", async () => {
    const workingLocal: AIProvider = {
      name: "local",
      isAvailable: () => true,
      complete: async () => JSON.stringify({ availableIngredients: ["eggs"], timeLimit: 15, mode: "normal" }),
    };
    const parsed = await parseUserIntent("something with eggs", { provider: workingLocal });
    expect(parsed.source).toBe("local");
    expect(parsed.intent.availableIngredients).toEqual(["eggs"]);
  });

  it("local success keeps heuristic-caught exclusions (additive safety union)", async () => {
    // FlavoraLM is narrow: valid JSON that misses "avoid pork".
    const narrowLocal: AIProvider = {
      name: "local",
      isAvailable: () => true,
      complete: async () => JSON.stringify({ availableIngredients: ["rice"], mode: "normal" }),
    };
    const parsed = await parseUserIntent("I avoid pork and want chicken and rice", { provider: narrowLocal });
    expect(parsed.source).toBe("local");
    expect(parsed.intent.avoidFoods).toContain("pork");
  });

  it("groq-named injected provider is rejected — local-only, no remote calls", async () => {
    const groq: AIProvider = {
      name: "groq",
      isAvailable: () => true,
      complete: async () => JSON.stringify({ mode: "budget" }),
    };
    const parsed = await parseUserIntent("cheap dinner", { provider: groq });
    expect(parsed.source).toBe("heuristic");
    expect(parsed.fallbackReason).toBe("heuristic-mode");
  });
});

describe("AI safety contract — malicious/incorrect AI output cannot bypass the deterministic filter", () => {
  const PROFILE = { allergies: ["peanut"], avoid_foods: ["pork"], favoriteCuisines: [] };

  const CANDIDATES = [
    { id: "safe:1", title: "Tomato Pasta", cuisine: "italian", cookTimeMinutes: 20, difficulty: "easy", spiceLevel: "mild", costTier: "low", ingredients: ["pasta", "tomato", "basil"], nutrition: { calories: 500 } },
    { id: "unsafe:1", title: "Peanut Noodles", cuisine: "chinese", cookTimeMinutes: 15, difficulty: "easy", spiceLevel: "medium", costTier: "low", ingredients: ["noodles", "peanut butter"] },
    { id: "unsafe:2", title: "Pork Chops", cuisine: "american", cookTimeMinutes: 25, difficulty: "easy", spiceLevel: "mild", costTier: "low", ingredients: ["pork chop", "salt"] },
  ];

  it("malicious local output cannot bypass the deterministic filter", async () => {
    const malicious: AIProvider = {
      name: "local",
      isAvailable: () => true,
      complete: async () =>
        JSON.stringify({
          availableIngredients: ["peanut butter", "pork"],
          mode: "normal",
          // Malicious extra fields attempt to override safety:
          ignoreAllergies: true,
          forceRecipes: ["unsafe:1", "unsafe:2"],
          allRecipesSafe: true,
        }),
    };
    const parsed = await parseUserIntent("give me peanut noodles and pork", { provider: malicious });

    // 1. Intent normalization drops unknown/injection fields.
    const intentJson = JSON.stringify(parsed.intent).toLowerCase();
    expect(intentJson).not.toContain("forceRecipes");
    expect(intentJson).not.toContain("ignoreallergies");

    // 2. The engine re-filters regardless of what the AI claimed.
    const out = recommendWithEngine(CANDIDATES, PROFILE, { ...parsed.intent, timeLimit: 60 });
    const ids = out.map((o) => o.recipe.id);
    expect(ids).not.toContain("unsafe:1");
    expect(ids).not.toContain("unsafe:2");
  });

  it("normalizeIntent rejects malformed craving values and non-numeric times from AI", () => {
    const intent = normalizeIntent({
      timeLimit: "twenty",
      cravingSignals: { flavors: ["explodium"], textures: "crispy" },
      availableIngredients: "not an array",
      mode: { evil: "override" },
    });
    expect(intent.timeLimit).toBeUndefined();
    expect(intent.cravingSignals).toBeUndefined();
    expect(intent.availableIngredients).toBeUndefined();
    expect(intent.mode).toBeUndefined();
  });

  it("hard filter runs after AI extraction for every crafted intent shape", () => {
    // Even if AI marks unsafe recipes as availableIngredients, the filter wins.
    const crafted = normalizeIntent({ availableIngredients: ["peanut butter", "pork"] });
    const out = recommendWithEngine(CANDIDATES, PROFILE, { ...crafted, timeLimit: 60 });
    const blob = JSON.stringify(out).toLowerCase();
    expect(blob).not.toMatch(/peanut/);
    expect(blob).not.toMatch(/\bpork\b/);
    expect(passesHardFilter(CANDIDATES[1], PROFILE)).toBe(false);
    expect(passesHardFilter(CANDIDATES[2], PROFILE)).toBe(false);
  });
});
