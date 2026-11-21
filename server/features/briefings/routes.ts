import { Router } from "express";
import { currentUser } from "../../platform/auth";
import { id } from "../../platform/http";
import type { OverviewContext } from "../dashboard/service";
import { briefingPdf } from "./pdf";
import * as service from "./service";

/** Vendor briefings (B-1). Any member may prepare, edit, export and remove one. */
export function briefingRoutes(ctx: OverviewContext) {
  const r = Router();
  const body = (req: { body?: unknown }) => req.body ?? {};
  r.get("/vendors/:id/briefings", async (req, res) => res.json(await service.listBriefings(ctx, id.parse(req.params.id))));
  r.post("/vendors/:id/briefings", async (req, res) => res.status(201).json(await service.createBriefing(ctx, id.parse(req.params.id), currentUser(req))));
  r.get("/briefings/:id", async (req, res) => res.json(await service.getBriefing(ctx, id.parse(req.params.id))));
  r.put("/briefings/:id", async (req, res) => res.json(await service.saveBriefing(ctx, id.parse(req.params.id), body(req), currentUser(req))));
  r.post("/briefings/:id/suggestion", async (req, res) => res.status(201).json(await service.suggestAgain(ctx, id.parse(req.params.id), currentUser(req))));
  r.post("/briefings/:id/suggestion/review", async (req, res) => res.json(await service.reviewBriefing(ctx, id.parse(req.params.id), body(req), currentUser(req))));
  r.delete("/briefings/:id", async (req, res) => {
    await service.removeBriefing(ctx, id.parse(req.params.id), currentUser(req));
    res.json({ ok: true });
  });
  r.get("/briefings/:id/pdf", async (req, res) => {
    const b = await service.getBriefing(ctx, id.parse(req.params.id));
    const name = `${b.vendorName} briefing ${b.asAt}`.replace(/[^A-Za-z0-9 ._-]/g, "").replace(/\s+/g, " ");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.pdf"`);
    res.send(await briefingPdf(b));
  });
  return r;
}
