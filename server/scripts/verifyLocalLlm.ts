/**
 * Local LLM end-to-end validation script (run against a real Ollama runtime).
 * Usage: AI_PROVIDER=local npx tsx scripts/verifyLocalLlm.ts
 *
 * Sends a small warm-up request first so the model is loaded and the prompt
 * prefix is cached — mirrors steady-state usage, not cold-start behaviour.
 */
import { LocalLlmProvider } from "../src/ai/localLlmProvider.js";
import { parseUserIntent } from "../src/ai/assistantService.js";

async function main() {
  const llm = new LocalLlmProvider();
  const ok = await llm.probeAvailability();
  if (!ok) {
    console.error("Local LLM not reachable or model missing. Start it with:");
    console.error("  ollama serve            # in another terminal");
    console.error("  ollama pull qwen2.5:3b  # one-time model download");
    process.exit(2);
  }
  console.log(`Runtime up at ${llm.hostUrl} with model ${llm.modelName}`);

  // Warm-up: load the model into memory and cache the prompt prefix.
  const w0 = Date.now();
  await llm.complete(llm.intentSystemPrompt(), "warm up: {\"mode\":\"normal\"}");
  console.log(`warm-up done in ${((Date.now() - w0) / 1000).toFixed(1)}s`);

  const t0 = Date.now();
  const r = await parseUserIntent(
    "I have chicken and rice, I want something warm and comforting in 30 minutes"
  );
  console.log("source:", r.source, "| notice:", r.notice ?? "-", "| ms:", Date.now() - t0);
  console.log("intent:", JSON.stringify(r.intent));

  const t1 = Date.now();
  const r2 = await parseUserIntent("something cheap and quick with pasta");
  console.log("source2:", r2.source, "| ms:", Date.now() - t1, "| intent2:", JSON.stringify(r2.intent));

  if (r.source !== "local" || r2.source !== "local") {
    console.error("FAIL: expected source=local with AI_PROVIDER=local and a running runtime");
    process.exit(1);
  }
  console.log("OK: local LLM produced validated structured intent");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
