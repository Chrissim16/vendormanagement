import path from "node:path";
import { existsSync } from "node:fs";
import cookieParser from "cookie-parser";
import express, { type RequestHandler } from "express";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { users } from "../db/schema";
import { adminRoutes } from "./features/admin/routes";
import { authenticate } from "./platform/auth";
import type { Config } from "./platform/config";
import { AppError, errorHandler } from "./platform/errors";
import type { Ports } from "./platform/ports/types";

/** Express 4 does not catch rejected promises from handlers; this makes every route do so. */
function catchAsync(router: express.Router) {
  for (const layer of (router as unknown as { stack: { route?: { stack: { handle: RequestHandler }[] }; handle: unknown; name: string }[] }).stack) {
    if (layer.route) {
      for (const l of layer.route.stack) {
        const fn = l.handle;
        l.handle = (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
      }
    } else if (layer.name === "router") catchAsync(layer.handle as express.Router);
  }
  return router;
}

export function createApp(config: Config, ports: Ports) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  const api = express.Router();

  // Local only: lets you look at the app as another person to try out roles.
  if (ports.identity.kind === "stand-in") {
    api.get("/dev/users", async (_req, res) => {
      const rows = await ports.database.db.select({ email: users.email, role: users.role, active: users.active }).from(users).orderBy(asc(users.email));
      res.json(rows);
    });
    api.post("/dev/switch", (req, res) => {
      const { email } = z.object({ email: z.email() }).parse(req.body);
      res.cookie("dev_user", email.toLowerCase(), { httpOnly: true, sameSite: "lax" }).json({ ok: true });
    });
  }

  api.get("/config", (_req, res) => res.json({ standInSignIn: ports.identity.kind === "stand-in" }));
  api.use(authenticate(ports.database.db, ports.identity, config.bootstrapAdminEmail));
  api.use(adminRoutes(ports));
  api.use((_req, _res, next) => next(new AppError(404, "not_found", "That address does not exist.")));

  app.use("/api", catchAsync(api));
  app.use("/api", errorHandler);

  const clientDir = path.resolve(config.clientDir);
  if (existsSync(path.join(clientDir, "index.html"))) {
    app.use(express.static(clientDir, { index: false, maxAge: "1h" }));
    app.get("*", (_req, res) => res.sendFile(path.join(clientDir, "index.html")));
  }
  return app;
}
