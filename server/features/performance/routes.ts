import { Router } from "express";
import { z } from "zod";
import { overviewSorts, ticketSets } from "../../../shared/performance";
import { currentUser, requireRole } from "../../platform/auth";
import { dir, id, paging, text } from "../../platform/http";
import { ticketSorts, type TicketSort } from "./repo";
import * as service from "./service";

// Anything that is not a month that has started falls back to the current month.
const month = z.string().max(20).optional();
const overviewQuery = z.object({ month, sort: z.enum(overviewSorts).default("missed"), dir: dir.default("desc") });
const ticketsQuery = z.object({
  set: z.enum(ticketSets),
  month,
  q: text.optional(),
  sort: z.enum(ticketSorts as [string, ...string[]]).default("created"),
  dir: dir.default("desc"),
  ...paging,
});

export function performanceRoutes(ctx: service.PerformanceContext) {
  const r = Router();
  const body = (req: { body?: unknown }) => req.body ?? {};

  r.get("/performance", async (req, res) => res.json(await service.getOverview(ctx, overviewQuery.parse(req.query))));
  r.get("/performance/vendors/:id", async (req, res) => res.json(await service.getVendorPerformance(ctx, id.parse(req.params.id), z.object({ month }).parse(req.query).month)));
  r.get("/performance/vendors/:id/tickets", async (req, res) => {
    const q = ticketsQuery.parse(req.query);
    res.json(await service.listTickets(ctx, id.parse(req.params.id), { ...q, sort: q.sort as TicketSort }));
  });
  r.put("/performance/vendors/:id/targets", async (req, res) => res.json(await service.saveTargets(ctx, id.parse(req.params.id), body(req), currentUser(req))));

  // Fetching tickets changes nothing a person entered, so any member may ask for it.
  r.post("/performance/sync", async (_req, res) => res.json(await service.syncAll(ctx)));
  r.post("/performance/vendors/:id/sync", async (req, res) => res.json(await service.syncVendor(ctx, id.parse(req.params.id))));

  // Which board a vendor's tickets come from, and how they are read, is the admin's to decide (J-1).
  const admin = requireRole("admin");
  r.get("/admin/jira/boards", admin, async (_req, res) => res.json(await service.listBoards(ctx)));
  r.post("/admin/jira/test", admin, async (req, res) => res.json(await service.testLink(ctx, body(req))));
  r.put("/admin/vendors/:id/jira-link", admin, async (req, res) => res.json(await service.saveLink(ctx, id.parse(req.params.id), body(req), currentUser(req))));
  return r;
}
