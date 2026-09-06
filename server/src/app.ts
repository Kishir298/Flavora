import express from "express";
import cors from "cors";
import { requestIdMiddleware, requestLogger } from "./logger.js";
import { profileRouter } from "./routes/profile.js";
import { recommendRouter } from "./routes/recommend.js";
import { recipesRouter } from "./routes/recipes.js";
import { interactionsRouter } from "./routes/interactions.js";
import { devRouter } from "./routes/dev.js";

import { prisma } from "./db.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "256kb" }));
  app.use(requestIdMiddleware);
  app.use(requestLogger);

  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "flavora" }));
  app.use("/api/profile", profileRouter);
  app.use("/api/recommend", recommendRouter);
  app.use("/api/recipes", recipesRouter);
  app.use("/api/interactions", interactionsRouter);
  app.get("/api/saved", async (_req, res, next) => {
    try {
      const all = await prisma.interaction.findMany({ orderBy: { createdAt: "desc" } });
      const latest = new Map<string, (typeof all)[number]>();
      for (const i of all) if (!latest.has(i.recipeId)) latest.set(i.recipeId, i);
      const ids = [...latest.entries()]
        .filter(([, i]) => i.action === "saved" || i.action === "cooked")
        .map(([id]) => id);
      if (ids.length === 0) return res.json([]);
      const cached = await prisma.recipeCache.findMany({ where: { id: { in: ids } } });
      res.json(
        cached.map((c) => ({
          id: c.id,
          source: c.source,
          title: c.title,
          cuisine: c.cuisine,
          cookTime: c.cookTime,
          nutrition: JSON.parse(c.nutrition),
          ingredients: JSON.parse(c.ingredients),
          instructions: JSON.parse(c.instructions),
          image: c.image,
        }))
      );
    } catch (e) {
      next(e);
    }
  });
  app.use("/api/dev", devRouter);

  // Central error handler (keeps error shape stable for frontend).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(JSON.stringify({ ts: new Date().toISOString(), event: "unhandled_error", error: String(err) }));
    res.status(500).json({ error: "internal error" });
  });
  return app;
}
