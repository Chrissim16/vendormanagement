import path from "node:path";
import { existsSync } from "node:fs";
import cookieParser from "cookie-parser";
import express, { type RequestHandler } from "express";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { users } from "../db/schema";
import { todayIn } from "../shared/dates";
import { adminRoutes } from "./features/admin/routes";
import { agreementRoutes } from "./features/agreements/routes";
import { importRoutes } from "./features/import/routes";
import { invoiceRoutes } from "./features/invoices/routes";
import { performanceRoutes } from "./features/performance/routes";
import type { PerformanceContext } from "./features/performance/service";
import { scorecardRoutes } from "./features/scorecards/routes";
import type { ScorecardContext } from "./features/scorecards/service";
import { getSettings, saveSettings } from "./features/settings/service";
import { sowRoutes } from "./features/sow/routes";
import { vendorRoutes } from "./features/vendors/routes";
import { listWarnings } from "./features/warnings/service";
import { authenticate, currentUser, requireRole } from "./platform/auth";
import { clock, type Config } from "./platform/config";
import { AppError, errorHandler } from "./platform/errors";
import { aiModes, type Ports } from "./platform/ports/types";

type Layer = { route?: { stack: Layer[] }; handle: RequestHandler & { stack?: Layer[] }; name: string };

/**
 * Express 4 does not catch rejected promises. This wraps every handler and middleware in
 * the router, and in routers nested in it, so a rejection becomes a normal error reply
 * instead of stopping the process. Error handlers (four arguments) are left as they are.
 * Call it after all routes are added.
 */
function catchAsync(router: express.Router) {
  const wrap = (layer: Layer) => {
    const fn = layer.handle;
    if (fn.stack) return catchAsync(fn as unknown as express.Router);
    if (fn.length >= 4) return;
    layer.handle = ((req, res, next) => {
      try {
        Promise.resolve(fn(req, res, next)).catch(next);
      } catch (e) {
        next(e);
      }
    }) as Layer["handle"];
  };
  for (const layer of (router as unknown as { stack: Layer[] }).stack) {
    if (layer.route) layer.route.stack.forEach(wrap);
    else wrap(layer);
  }
  return router;
}

/** What the performance feature needs, from the app's configuration and connections. */
export const performanceContext = (config: Config, ports: Ports): PerformanceContext => ({
  db: ports.database.db,
  jira: ports.jira,
  timeZone: config.timeZone,
  now: clock(config),
  today: () => config.today ?? todayIn(config.timeZone),
  syncEveryMinutes: config.jiraSyncMinutes,
});

/** What the scorecards feature needs: the performance figures, the AI and the clock. */
export const scorecardContext = (config: Config, ports: Ports): ScorecardContext => {
  const perf = performanceContext(config, ports);
  return { db: ports.database.db, ai: ports.ai, perf, today: perf.today, now: perf.now };
};

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

  // Local only: switch the stand-in AI to unavailable or to nonsense, to see what the pages do then (AI-2).
  const simulate = ports.ai.kind === "stand-in" ? ports.ai.simulate : undefined;
  if (simulate && ports.identity.kind === "stand-in") {
    api.post("/dev/ai", (req, res) => {
      const { mode } = z.object({ mode: z.enum(aiModes) }).parse(req.body);
      simulate(mode);
      res.json({ mode });
    });
  }

  // "Today" is the date in the team's time zone. Tests may pin it with TODAY.
  const today = () => config.today ?? todayIn(config.timeZone);
  api.get("/config", (_req, res) => res.json({ standInSignIn: ports.identity.kind === "stand-in", timeZone: config.timeZone, today: today() }));
  api.use(authenticate(ports.database.db, ports.identity, config.bootstrapAdminEmail));
  api.use(adminRoutes(ports, config.timeZone));
  const db = ports.database.db;
  api.use(vendorRoutes(db, today));
  api.use(agreementRoutes(db, ports.storage, today));
  api.get("/warnings", async (_req, res) => res.json(await listWarnings(db, today())));
  api.use(sowRoutes(db, today));
  api.use(invoiceRoutes(db, today));
  api.use(performanceRoutes(performanceContext(config, ports)));
  api.use(scorecardRoutes(scorecardContext(config, ports), config.timeZone));
  api.get("/settings", async (_req, res) => res.json(await getSettings(db)));
  api.put("/admin/settings", requireRole("admin"), async (req, res) => res.json(await saveSettings(db, req.body, currentUser(req))));
  api.use("/admin/import", importRoutes(db, today));
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
