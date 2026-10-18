import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import { requireAuth, TokenService } from "./auth.js";
import type { DB } from "./db.js";
import { errorHandler, HttpError } from "./errors.js";
import { authRoutes } from "./routes/auth.js";
import { taskRoutes } from "./routes/tasks.js";

export interface AppOptions {
  db: DB;
  jwtSecret: string;
  /** Built frontend to serve in production (web/dist). */
  staticDir?: string;
  authRateLimit?: { windowMs: number; max: number };
}

export function createApp({ db, jwtSecret, staticDir, authRateLimit }: AppOptions) {
  const app = express();
  const tokens = new TokenService(jwtSecret);

  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use(express.json({ limit: "100kb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.get("/api/health", (_req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ status: "ok" });
  });
  app.use("/api/auth", authRoutes(db, tokens, authRateLimit));
  app.use("/api/tasks", requireAuth(tokens), taskRoutes(db));
  app.use("/api", () => {
    throw new HttpError(404, "not_found", "No such endpoint");
  });

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir, { maxAge: "1h", index: false }));
    // SPA fallback: every non-API route renders the React app.
    app.get("/{*splat}", (_req, res) => res.sendFile(path.join(staticDir, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
