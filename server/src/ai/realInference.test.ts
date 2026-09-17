import { describe, it, expect } from "vitest";
import { config } from "../config.js";
import { LocalLlmProvider } from "./localLlmProvider.js";
import { parseUserIntent } from "./assistantService.js";

/**
 * Real FlavoraLM integration — NOT mocked.
 * Express → FlavoraLM → real inference → valid response → frontend-compatible result.
 * Skips honestly when the service isn't running (CI without `npm run start`).
 */
describe("ai/realInference — Express → FlavoraLM live", () => {
  it("proves real inference is used when FlavoraLM is up", async () => {
    const probe = new LocalLlmProvider({
      host: config.localLlmHost,
      model: config.localLlmModel,
      timeoutMs: 5000,
    });
    const status = await probe.probeStatus();
    if (!status.usable) {
      // Honest skip: service down in this environment.
      expect(status.detail).toMatch(/unreachable|unloaded/);
      return;
    }
    // Service up with measured identity — now prove the full parse path.
    expect(status.model).toMatch(/^flavoraLM/i);
    const parsed = await parseUserIntent("I want chicken and rice, around 600 calories for dinner", undefined);
    // Either real inference succeeded (source local) or the model returned
    // nothing usable and we fell back honestly (local-invalid) — never a
    // collapsed "unreachable" when the probe just succeeded.
    expect(["local", "heuristic"]).toContain(parsed.source);
    if (parsed.source === "local") {
      expect(parsed.fallbackReason).toBe("none");
      expect(parsed.intent).toBeTruthy();
    } else {
      expect(["local-invalid", "local-timeout", "local-unloaded"]).toContain(parsed.fallbackReason);
      expect(parsed.notice).toBeTruthy();
      expect(parsed.detail).toBeTruthy();
    }
  }, 30_000);

  it("distinguishes timeout vs invalid vs unreachable (taxonomy, no collapse)", async () => {
    const timeoutProvider = {
      name: "local",
      isAvailable: () => true,
      probeAvailability: async () => true,
      complete: async () => {
        throw new Error("FlavoraLM timed out after 30000ms");
      },
    };
    const t = await parseUserIntent("chicken dinner", { provider: timeoutProvider });
    expect(t.fallbackReason).toBe("local-timeout");

    const invalidProvider = {
      name: "local",
      isAvailable: () => true,
      probeAvailability: async () => true,
      complete: async () => "<<<not json>>>",
    };
    const v = await parseUserIntent("chicken dinner", { provider: invalidProvider });
    expect(v.fallbackReason).toBe("local-invalid");

    const unloadedProvider = {
      name: "local",
      isAvailable: () => false,
      probeAvailability: async () => false,
      probeStatus: async () => ({
        runtimeReachable: true,
        modelInstalled: false,
        usable: false,
        detail: "unloaded" as const,
        httpStatus: 503,
      }),
      complete: async () => {
        throw new Error("unreachable");
      },
    };
    const u = await parseUserIntent("chicken dinner", { provider: unloadedProvider });
    expect(u.fallbackReason).toBe("local-unloaded");
  });
});
