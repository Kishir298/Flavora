import { useEffect, useState } from "react";
import { api } from "../lib/api";

export type AiSource = "local" | "heuristic" | "provided" | null;

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
 * AI provider status line. Always names the actual provider that
 * processed the request — never a bare "AI Powered".
 * - AI: FlavoraLM v0.1            (our local model handled it)
 * - AI: Heuristic (…)             (deterministic parser, not an LLM)
 * Flavora is local-only: there is no remote fallback.
 */
export function AiStatus({ source, fallbackReason }: { source?: AiSource; fallbackReason?: string | null }) {
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
  } else if (source === "provided") {
    label = "AI: none (structured request)";
  } else if (fallbackReason === "local-timeout") {
    label = "AI: Heuristic (FlavoraLM timed out)";
  } else if (fallbackReason === "local-invalid") {
    label = "AI: Heuristic (FlavoraLM answer invalid)";
  } else if (fallbackReason === "local-unloaded") {
    label = "AI: Heuristic (FlavoraLM starting)";
  } else {
    label = lm && !lm.serviceReachable ? "AI: Heuristic (FlavoraLM unavailable)" : "AI: Heuristic";
  }

  return (
    <p className="text-xs opacity-70" role="status" aria-live="polite" data-testid="ai-status">
      {label}
    </p>
  );
}
