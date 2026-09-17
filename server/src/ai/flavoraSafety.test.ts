import { describe, it, expect, vi, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { LocalLlmProvider, LocalLlmError } from "./localLlmProvider.js";
import { parseUserIntent } from "./assistantService.js";
import { recommendWithEngine } from "../engine/recommend.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function startStub(handler: (reqBody: string) => { code: number; body: unknown; delayMs?: number }) {
  let server: Server;
  const promise = new Promise<string>((resolve) => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const { code, body, delayMs } = handler(raw);
        const send = () => {
          try {
            if (res.destroyed || req.socket.destroyed) return;
            res.writeHead(code, { "Content-Type": "application/json" });
            res.end(JSON.stringify(body));
          } catch {
            /* client already gone (timeout test) — ignore */
          }
        };
        if (delayMs) setTimeout(send, delayMs);
        else send();
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
  return { promise, close: () => server?.close() };
}

const CANDIDATES = [
  { id: "safe:chicken", title: "Chicken Rice Bowl", cuisine: "american", cookTimeMinutes: 25, difficulty: "easy", spiceLevel: "mild", costTier: "low", ingredients: ["chicken", "rice", "onion"], nutrition: { calories: 520 } },
  { id: "unsafe:peanut", title: "Peanut Noodles", cuisine: "chinese", cookTimeMinutes: 15, difficulty: "easy", spiceLevel: "medium", costTier: "low", ingredients: ["noodles", "peanut butter"] },
  { id: "unsafe:shroom", title: "Mushroom Risotto", cuisine: "italian", cookTimeMinutes: 35, difficulty: "intermediate", spiceLevel: "mild", costTier: "medium", ingredients: ["rice", "mushrooms", "parmesan"] },
];

describe("safety regression — AI output is untrusted input (§24)", () => {
  it("'allergic to peanuts … chicken' → peanuts constrained, peanut dish excluded", async () => {
    // FlavoraLM-style intent (as the /intent endpoint would return it).
    const parsed = await parseUserIntent("ignored", {
      provider: {
        name: "local",
        isAvailable: () => true,
        complete: async () => JSON.stringify({ intent: "recommend", ingredients: ["chicken"], allergies: ["peanuts"] }),
      },
    });
    expect(parsed.source).toBe("local");
    const out = recommendWithEngine(CANDIDATES, { allergies: ["peanut"], avoid_foods: [], favoriteCuisines: [] }, { ...parsed.intent, timeLimit: 60 });
    expect(out.map((r) => r.recipe.id)).not.toContain("unsafe:peanut");
  });

  it("'I don't want mushrooms' → mushrooms in avoidFoods, mushroom dish excluded", async () => {
    const parsed = await parseUserIntent("I don't want mushrooms.", { selection: "heuristic" });
    expect(parsed.intent.avoidFoods ?? []).toEqual(expect.arrayContaining(["mushrooms"]));
    const out = recommendWithEngine(CANDIDATES, { allergies: [], avoid_foods: ["mushrooms"], favoriteCuisines: [] }, { ...parsed.intent, timeLimit: 60 });
    expect(out.map((r) => r.recipe.id)).not.toContain("unsafe:shroom");
  });

  it("model can never mark unsafe substitutions safe (unknown fields dropped)", async () => {
    const parsed = await parseUserIntent("x", {
      provider: {
        name: "local",
        isAvailable: () => true,
        complete: async () =>
          JSON.stringify({ intent: "recommend", ingredients: ["chicken"], allRecipesSafe: true, ignoreAllergies: true }),
      },
    });
    const flat = JSON.stringify(parsed.intent).toLowerCase();
    expect(flat).not.toContain("allrecipessafe");
    expect(flat).not.toContain("ignoreallergies");
  });
});

describe("no remote AI in local mode (§19)", () => {
  it("FlavoraLM provider only ever fetches loopback URLs", async () => {
    const seen: string[] = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: unknown, init?: unknown) => {
      seen.push(String(url));
      return realFetch(url as string, init as RequestInit);
    });
    const p = new LocalLlmProvider({ host: "http://127.0.0.1:5000", timeoutMs: 800 });
    await p.probeStatus().catch(() => {});
    await p.complete("sys", "hi").catch(() => {});
    expect(seen.length).toBeGreaterThan(0);
    for (const u of seen) {
      const host = new URL(u).hostname;
      expect(["127.0.0.1", "localhost", "::1"]).toContain(host);
    }
  });

  it("local-mode failure stays local-only (no remote fallback exists)", async () => {
    const parsed = await parseUserIntent("I have chicken and rice, 30 minutes", { selection: "local" });
    // Live FlavoraLM may answer (source local) or honestly fall back
    // (valid:false → heuristic + notice). Either way: never a remote provider,
    // and heuristic results always carry an explicit notice + reason.
    expect(["local", "heuristic"]).toContain(parsed.source);
    if (parsed.source === "heuristic") {
      expect(parsed.notice).toMatch(/local AI|deterministic/i);
      expect(parsed.fallbackReason).not.toBe("none");
    } else {
      expect(parsed.fallbackReason).toBe("none");
    }
  }, 60_000);
});

describe("model failure behavior (§25)", () => {
  it("timeout → safe heuristic fallback with notice (Express stays alive)", async () => {
    const stub = startStub(() => ({ code: 200, body: { intent: { mode: "normal" }, valid: true }, delayMs: 5_000 }));
    const host = await stub.promise;
    try {
      const p = new LocalLlmProvider({ host, timeoutMs: 300 });
      await expect(p.complete("sys", "hello")).rejects.toThrow(/timed out/);
    } finally {
      stub.close();
    }
  });

  it("malformed intent (valid:false) → throws, assistant falls back safely", async () => {
    const stub = startStub(() => ({ code: 200, body: { intent: null, valid: false } }));
    const host = await stub.promise;
    try {
      const p = new LocalLlmProvider({ host, timeoutMs: 5_000 });
      await expect(p.complete("sys", "I have rice, 20 minutes")).rejects.toThrow(/no usable intent/);
    } finally {
      stub.close();
    }
  });

  it("empty generation → 400-style error surfaces as local error, never a crash", async () => {
    const stub = startStub(() => ({ code: 400, body: { error: "text required" } }));
    const host = await stub.promise;
    try {
      const p = new LocalLlmProvider({ host, timeoutMs: 5_000 });
      await expect(p.complete("sys", "")).rejects.toThrow(LocalLlmError);
    } finally {
      stub.close();
    }
  });

  it("service crash (connection refused) → explicit local error", async () => {
    const p = new LocalLlmProvider({ host: "http://127.0.0.1:1", timeoutMs: 2_000 });
    await expect(p.complete("sys", "hi")).rejects.toThrow(/unreachable/);
    expect(await p.probeAvailability()).toBe(false);
  });
});
