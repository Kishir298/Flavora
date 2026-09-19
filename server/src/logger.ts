import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

const REQ_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export function sanitizeReqId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return REQ_ID_RE.test(t) ? t : null;
}
export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction) {
  (req as unknown as { reqId: string }).reqId =
    sanitizeReqId(req.headers["x-request-id"]) ?? randomUUID();
  next();
}

export function getReqId(req: Request): string {
  return (req as unknown as { reqId?: string }).reqId ?? "-";
}

/** Structured JSON log line — greppable, no scattered console.log. */
export function logEvent(event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...fields });
  console.log(line);
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const reqId = getReqId(req);
  res.on("finish", () => {
    logEvent("http_request", {
      reqId,
      method: req.method,
      route: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
    });
  });
  next();
}
