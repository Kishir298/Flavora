import express from "express";
import cors from "cors";
import { requestIdMiddleware, requestLogger } from "./logger.js";
import { profileRouter } from "./routes/profile.js";
import { recipesRouter } from "./routes/recipes.js";
import { recommendationsRouter } from "./routes/recommendations.js";
import { interactionsRouterNew as interactionsRouter } from "./routes/interactions.js";
import { devRouter } from "./routes/dev.js";
import { debugRouter } from "./routes/debug.js";

import { prisma } from "./db.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "256kb" }));
  app.use(requestIdMiddleware);
  app.use(requestLogger);

  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "flavora" }));
  app.use("/api/profile", profileRouter);
  app.use("/api/recommendations", recommendationsRouter);
  app.use("/api/recipes", recipesRouter);
  app.use("/api/interactions", interactionsRouter);
  app.get("/api/saved", async (_req, res, next) => {
    try {
      const all = await prisma.interaction.findMany({ orderBy: { createdAt: "desc" } });
      const latest = new Map<string, (typeof all)[number]>();
      for (const i of all) if (!latest.has(i.recipeId)) latest.set(i.recipeId, i);
      const ids = [...latest.entries()]
        .filter(([, i]) => ["saved", "cooked", "rated_positive", "rated"].includes(i.action))
        .map(([id]) => id);
      if (ids.length === 0) return res.json([]);
      const rows = await prisma.recipe.findMany({ where: { id: { in: ids } } });
      res.json(
        rows.map((c) => ({
          id: c.id,
          title: c.title,
          cuisine: c.cuisine,
          cookTime: c.cookTimeMinutes,
          difficulty: c.difficulty,
          nutrition: JSON.parse(c.nutrition),
          ingredients: JSON.parse(c.ingredients),
          instructions: JSON.parse(c.instructions),
          costTier: c.costTier,
          storage: c.storageTips,
        }))
      );
    } catch (e) {
      next(e);
    }
  });
  app.use("/api/dev", devRouter);
  app.use("/api/debug", debugRouter);

  // Central error handler (keeps error shape stable for frontend).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(JSON.stringify({ ts: new Date().toISOString(), event: "unhandled_error", error: String(err) }));
    res.status(500).json({ error: "internal error" });
  });
  return app;
}
