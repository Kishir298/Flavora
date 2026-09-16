import { useEffect, useState } from "react";
import { api } from "../lib/api";

export type AiSource = "local" | "groq" | "heuristic" | "provided" | null;

interface Health {
  resolvedProvider?: string;
  localModel?: {
    name: string;
    version: string | null;
    serviceReachable: boolean;
    loaded: boolean;
  };
}

/**
 * AI provider status line (§38). Always names the actual provider that
 * processed the request — never a bare "AI Powered".
 * - AI: FlavoraLM v0.1            (our local model handled it)
 * - AI: Heuristic (…)             (deterministic parser, not an LLM)
 * - AI: Groq                      (remote fallback, only if configured)
 */
export function AiStatus({ source }: { source?: AiSource }) {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((h) => {
        if (!cancelled) setHealth(h.ai ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const lm = health?.localModel;
  let label: string;
  if (source === "local" || (!source && health?.resolvedProvider === "local" && lm?.loaded)) {
    label = `AI: FlavoraLM${lm?.version ? ` v${lm.version}` : ""}`;
  } else if (source === "groq" || (!source && health?.resolvedProvider === "groq")) {
    label = "AI: Groq (remote fallback)";
  } else if (source === "provided") {
    label = "AI: none (structured request)";
  } else {
    label = lm && !lm.serviceReachable ? "AI: Heuristic (FlavoraLM unavailable)" : "AI: Heuristic";
  }

  return (
    <p className="text-xs opacity-70" role="status" aria-live="polite" data-testid="ai-status">
      {label}
    </p>
  );
}
