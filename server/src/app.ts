import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { requestIdMiddleware, requestLogger } from "./logger.js";
import { profileRouter } from "./routes/profile.js";
import { recipesRouter } from "./routes/recipes.js";
import { recommendationsRouter } from "./routes/recommendations.js";
import { interactionsRouterNew as interactionsRouter } from "./routes/interactions.js";
import { assistantRouter } from "./routes/assistant.js";
import { devRouter } from "./routes/dev.js";
import { debugRouter } from "./routes/debug.js";
import { substitutionsRouter } from "./routes/substitutions.js";
import { inventoryRouter } from "./routes/inventory.js";
import { mealsRouter, goalsRouter, waterRouter } from "./routes/meals.js";
import { statsRouter } from "./routes/stats.js";
import { groceriesRouter } from "./routes/groceries.js";
import { mealPlansRouter } from "./routes/mealPlans.js";
import { nutritionRouter } from "./routes/nutrition.js";
import { config } from "./config.js";
import { createAIProvider } from "./ai/provider.js";
import type { LocalLlmStatus } from "./ai/localLlmProvider.js";

import { prisma } from "./db.js";

export function createApp() {
  const app = express();
  // Localhost-only single-user app: helmet + rate-limit are defense-in-depth
  // in case the port is ever forwarded. CORS is allowlisted to local Vite
  // origins only (dev :5173, preview :4173). CSP stays off for Vite dev HMR;
  // enable a strict CSP when serving a production build behind a proxy.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 1000,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );
  // Stricter limiter for expensive AI/recommendation routes (FlavoraLM is
  // single-threaded, ~10s+/request). Prevents CPU/LLM queue DoS.
  const aiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use("/api/assistant", aiLimiter);
  app.use("/api/recommendations", aiLimiter);
  app.use("/api/groceries/generate", aiLimiter);
  app.use(
    cors({
      origin: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
      ],
    })
  );
  app.use(express.json({ limit: "256kb" }));
  app.use(requestIdMiddleware);
  app.use(requestLogger);

  app.get("/api/health", async (_req, res) => {
    let dbOk = true;
    let dbError: string | undefined;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbOk = false;
      // Redacted: never leak SQLite path / driver message to clients.
      dbError = "database unavailable";
    }
    const { provider, resolvedMode } = createAIProvider();
    const probed = provider as { probeStatus?: () => Promise<LocalLlmStatus> };
    const localStatus =
      resolvedMode === "local" && typeof probed.probeStatus === "function"
        ? await probed.probeStatus()
        : null;
    res.json({
      ok: dbOk,
      service: "flavora",
      version: 1,
      db: { ok: dbOk, error: dbError },
      ai: {
        providerSelection: config.aiProvider,
        configuredProvider: config.aiProvider,
        resolvedProvider: resolvedMode,
        remoteConfigured: false,
        localLlm: {
          enabled: config.localLlmEnabled,
          host: config.localLlmHost,
          model: config.localLlmModel,
          runtimeReachable: localStatus?.runtimeReachable ?? false,
          modelInstalled: localStatus?.modelInstalled ?? false,
          available: localStatus?.usable ?? false,
        },
        localModel: {
          name: localStatus?.model ?? config.localLlmModel,
          version: localStatus?.version ?? null,
          serviceReachable: localStatus?.runtimeReachable ?? false,
          loaded: localStatus?.usable ?? false,
          device: localStatus?.device ?? null,
          tokenizerVersion: localStatus?.tokenizerVersion ?? null,
          parameterCount: localStatus?.parameterCount ?? null,
        },
      },
    });
  });
  app.use("/api/profile", profileRouter);
  app.use("/api/recommendations", recommendationsRouter);
  app.use("/api/assistant", assistantRouter);
  app.use("/api/recipes", recipesRouter);
  app.use("/api/interactions", interactionsRouter);
  app.get("/api/saved", async (req, res, next) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 100) || 100));
      const all = await prisma.interaction.findMany({
        orderBy: { createdAt: "desc" },
        take: limit * 4, // over-fetch then collapse to latest-per-recipe
      });
      const latest = new Map<string, (typeof all)[number]>();
      for (const i of all) if (!latest.has(i.recipeId)) latest.set(i.recipeId, i);
      const ids = [...latest.entries()]
        .filter(([, i]) => ["saved", "cooked", "rated_positive", "rated"].includes(i.action))
        .map(([id]) => id)
        .slice(0, limit);
      if (ids.length === 0) return res.json([]);
      const rows = await prisma.recipe.findMany({ where: { id: { in: ids } } });
      // Current profile for honest safety flags: a saved recipe that now
      // conflicts with allergies/avoid foods is still returned (user data is
      // never silently dropped) but marked unsafe so the UI can warn.
      let profile: { allergies: string[]; avoid_foods: string[]; avoidFoods: string[] } = {
        allergies: [],
        avoid_foods: [],
        avoidFoods: [],
      };
      try {
        const prow = await prisma.userProfile.findUnique({ where: { id: 1 } });
        if (prow) {
          const { isSafetyProfileCorrupt } = await import("./profileSafety.js");
          // Fail-closed for safety flags: corrupt profile must not silently
          // mark everything safe. Return 500 instead of unsafe=false list.
          if (isSafetyProfileCorrupt(prow)) {
            const { corruptProfileResponse } = await import("./profileSafety.js");
            return corruptProfileResponse(res);
          }
          const safeParse = (raw: string, fb: string[]) => {
            try {
              const v = JSON.parse(raw);
              return Array.isArray(v) ? v : fb;
            } catch {
              return fb;
            }
          };
          profile = {
            allergies: safeParse(prow.allergies, []),
            avoid_foods: safeParse(prow.avoidFoods, []),
            avoidFoods: safeParse(prow.avoidFoods, []),
          };
        }
      } catch {
        /* profile optional for saved display */
      }
      const { passesHardFilter } = await import("./engine/filter.js");
      res.json(
        rows.map((c) => {
          let nutrition: Record<string, unknown> = {};
          try {
            nutrition = JSON.parse(c.nutrition);
          } catch {
            nutrition = {};
          }
          const cal = (nutrition as { calories?: unknown }).calories;
          return {
            id: c.id,
            title: c.title,
            cuisine: c.cuisine,
            cookTime: c.cookTimeMinutes,
            difficulty: c.difficulty,
            nutrition,
            nutritionSource:
              typeof cal === "number" && Number.isFinite(cal) && (cal as number) >= 0
                ? "authored"
                : "unknown",
            ingredients: JSON.parse(c.ingredients),
            instructions: JSON.parse(c.instructions),
            costTier: c.costTier,
            storage: c.storageTips,
            unsafe: !passesHardFilter(
              { ingredients: JSON.parse(c.ingredients) },
              profile
            ),
          };
        })
      );
    } catch (e) {
      next(e);
    }
  });
  app.use("/api/dev", devRouter);
  app.use("/api/debug", debugRouter);
  app.use("/api/substitutions", substitutionsRouter);
  app.use("/api/inventory", inventoryRouter);
  app.use("/api/meals", mealsRouter);
  app.use("/api/goals", goalsRouter);
  app.use("/api/water", waterRouter);
  app.use("/api", statsRouter);
  app.use("/api/groceries", groceriesRouter);
  app.use("/api/meal-plans", mealPlansRouter);
  app.use("/api/nutrition", nutritionRouter);

  // Central error handler (keeps error shape stable for frontend).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // Malformed JSON bodies should be 400, not 500.
    if (err instanceof SyntaxError && "body" in (err as unknown as Record<string, unknown>)) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "malformed JSON body" });
      return;
    }
    // Fail-closed safety: corrupt allergy data maps to CORRUPT_PROFILE, never silent [].
    if ((err as { code?: string })?.code === "CORRUPT_PROFILE" || (err as Error)?.name === "CorruptProfileError") {
      res.status(500).json({ error: "CORRUPT_PROFILE", message: "profile safety data corrupt — reset profile before continuing" });
      return;
    }
    const reqId = (req as unknown as Record<string, unknown>).requestId ?? "-";
    console.error(JSON.stringify({ ts: new Date().toISOString(), event: "unhandled_error", reqId, error: String(err && (err as Error).stack ? (err as Error).stack : err) }));
    res.status(500).json({ error: "internal error" });
  });
  return app;
}
