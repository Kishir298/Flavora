/**
 * FlavoraLM end-to-end verification (deterministic, exit code reflects result).
 *
 * Performs REAL inference against OUR model — FlavoraLM served by
 * training/flavora_lm/service.py. Verifies, in order:
 *   [1/8] Model service reachable (real HTTP to /health)
 *   [2/8] Model loaded (service reports loaded=true)
 *   [3/8] Model identity (name is FlavoraLM*, version reported)
 *   [4/8] Tokenizer identity (version + vocab reported)
 *   [5/8] Real generation request round-trips (actual generated tokens)
 *   [6/8] Real Flavora request → structured intent (source must be "local")
 *   [7/8] Deterministic engine consumes that intent and returns recommendations
 *   [8/8] Allergy + avoid-food hard filter still runs AFTER AI extraction
 *
 * Usage:
 *   npm run verify:local-ai          (from repo root)
 *   npx tsx scripts/verifyLocalLlm.ts   (from server/)
 *
 * Requires the FlavoraLM service running (started automatically by `npm run start`):
 *   .flavoralm-venv/bin/python -m training.flavora_lm.service
 */
import { LocalLlmProvider } from "../src/ai/localLlmProvider.js";
import { parseUserIntent } from "../src/ai/assistantService.js";
import { recommendWithEngine } from "../src/engine/recommend.js";
import { config } from "../src/config.js";

type Step = { n: number; total: number; label: string; pad: number };

function report(step: Step, pass: boolean, detail = "") {
  const num = `[${step.n}/${step.total}]`.padEnd(6);
  const label = step.label.padEnd(step.pad);
  console.log(`${num} ${label} ${pass ? "PASS" : "FAIL"}${detail ? `  (${detail})` : ""}`);
  if (!pass) process.exit(1);
}

async function main() {
  const total = 8;
  const pad = 26;
  const llm = new LocalLlmProvider({
    host: config.localLlmHost,
    model: config.localLlmModel,
    timeoutMs: config.localLlmTimeoutMs,
  });

  console.log("\n========================================");
  console.log("       FLAVORALM VERIFICATION");
  console.log("========================================\n");

  // [1/8] Service reachable — actual HTTP, no assumptions.
  const t0 = Date.now();
  const status = await llm.probeStatus();
  if (!status.runtimeReachable) {
    console.error("\nStart the FlavoraLM service and try again:");
    console.error("  .flavoralm-venv/bin/python -m training.flavora_lm.service");
    console.error("  (or simply run `npm run start` from the repo root)\n");
  }
  report({ n: 1, total, label: "Model service", pad }, status.runtimeReachable,
    `${llm.hostUrl}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // [2/8] Model loaded.
  if (!status.modelInstalled) {
    console.error("\nThe service is up but no FlavoraLM model is loaded.");
    console.error("Retrain or check models/flavora-lm/v0.1/ artifacts.\n");
  }
  report({ n: 2, total, label: "Model loaded", pad }, status.modelInstalled,
    status.modelInstalled ? "" : "service reports no FlavoraLM weights loaded");

  // [3/8] Model identity — must be OUR model, never a third-party name.
  const identityOk =
    typeof status.model === "string" &&
    /^flavoraLM/i.test(status.model) &&
    typeof status.version === "string" &&
    status.version.length > 0;
  report({ n: 3, total, label: "Model identity", pad }, identityOk,
    `${status.model ?? "?"} v${status.version ?? "?"}`);

  // [4/8] Tokenizer identity.
  const tokOk =
    typeof status.tokenizerVersion === "string" && status.tokenizerVersion.length > 0;
  report({ n: 4, total, label: "Tokenizer", pad }, tokOk,
    `v${status.tokenizerVersion ?? "?"}`);

  // [5/8] Actual generation — must return real generated tokens.
  const w0 = Date.now();
  let genText = "";
  try {
    genText = await llm.generate("chicken and rice", { maxNewTokens: 24, temperature: 0.7 });
  } catch {
    genText = "";
  }
  report({ n: 5, total, label: "Generation", pad }, genText.length > 0,
    `${genText.length} chars, ${((Date.now() - w0) / 1000).toFixed(1)}s`);

  // [6/8] Real Flavora natural-language request → validated structured intent.
  // The reported provider must actually be `local` — FlavoraLM handled it.
  const message = "I have chicken and rice, I want something warm and comforting in 30 minutes";
  const t1 = Date.now();
  const parsed = await parseUserIntent(message, { selection: "local" });
  const intentOk =
    parsed.source === "local" &&
    (parsed.intent.availableIngredients?.length ?? 0) > 0 &&
    typeof parsed.intent.timeLimit === "number";
  report({ n: 6, total, label: "Intent extraction", pad }, intentOk,
    `source=${parsed.source}, ${Date.now() - t1}ms, intent=${JSON.stringify(parsed.intent)}`);

  // [7/8] Deterministic engine consumes the AI intent.
  const candidates = [
    { id: "v:chicken-rice", title: "Chicken Rice Bowl", cuisine: "american", cookTimeMinutes: 25, difficulty: "easy", spiceLevel: "mild", costTier: "low", ingredients: ["chicken", "rice", "onion"], nutrition: { calories: 520 } },
    { id: "v:pasta", title: "Tomato Pasta", cuisine: "italian", cookTimeMinutes: 20, difficulty: "easy", spiceLevel: "mild", costTier: "low", ingredients: ["pasta", "tomato"], nutrition: { calories: 480 } },
  ];
  const profile = { allergies: [], avoid_foods: [], favoriteCuisines: [] };
  const recs = recommendWithEngine(candidates, profile, { ...parsed.intent, timeLimit: parsed.intent.timeLimit ?? 30 });
  const engineOk = recs.length > 0 && recs.some((r) => r.recipe.id === "v:chicken-rice");
  report({ n: 7, total, label: "Recommendation engine", pad }, engineOk,
    `${recs.length} recs, top=${recs[0]?.recipe?.id ?? "none"}`);

  // [8/8] Safety: allergy + avoid-food hard filter runs AFTER AI extraction.
  const safetyCandidates = [
    ...candidates,
    { id: "v:peanut-noodles", title: "Peanut Noodles", cuisine: "chinese", cookTimeMinutes: 15, difficulty: "easy", spiceLevel: "medium", costTier: "low", ingredients: ["noodles", "peanut butter"] },
    { id: "v:mushroom-risotto", title: "Mushroom Risotto", cuisine: "italian", cookTimeMinutes: 35, difficulty: "intermediate", spiceLevel: "mild", costTier: "medium", ingredients: ["rice", "mushrooms", "parmesan"] },
  ];
  const allergyProfile = { allergies: ["peanut"], avoid_foods: ["mushrooms"], favoriteCuisines: [] };
  const filtered = recommendWithEngine(safetyCandidates, allergyProfile, { ...parsed.intent, timeLimit: 30 });
  const blob = JSON.stringify(filtered).toLowerCase();
  const safetyOk =
    !blob.includes("peanut") &&
    !blob.includes("mushroom") &&
    !filtered.some((r) => r.recipe.id === "v:peanut-noodles" || r.recipe.id === "v:mushroom-risotto");
  report({ n: 8, total, label: "Safety filtering", pad }, safetyOk,
    `${filtered.length} recs, unsafe excluded`);

  console.log(`\nModel:    ${status.model}`);
  console.log(`Version:  ${status.version}`);
  console.log(`Provider: local`);
  console.log(`Device:   ${(status.device ?? "cpu").toUpperCase()}\n`);
  console.log("FLAVORALM IS WORKING\n");
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
