import { Router } from "express";
import { z } from "zod";
import { scorecardStatuses } from "../../../shared/scorecards";
import { currentUser, requireRole } from "../../platform/auth";
import { formatDay, todayIn } from "../../../shared/dates";
import { AppError } from "../../platform/errors";
import { dir, id, paging, text } from "../../platform/http";
import { scorecardPdf } from "./pdf";
import * as proposals from "./proposals";
import { cardSorts, type CardSort } from "./repo";
import * as service from "./service";

const listQuery = z.object({
  vendorId: id.optional(),
  status: z.enum(scorecardStatuses).optional(),
  q: text.optional(),
  sort: z.enum(cardSorts as [string, ...string[]]).default("quarter"),
  dir: dir.default("desc"),
  ...paging,
});
const month = z.object({ month: z.string().max(20).optional() });

export function scorecardRoutes(ctx: service.ScorecardContext, timeZone: string) {
  const r = Router();
  const admin = requireRole("admin");
  const body = (req: { body?: unknown }) => req.body ?? {};

  // Criteria (P-7): everyone sees them, an admin changes them.
  r.get("/scorecard-criteria", async (_req, res) => res.json(await service.listCriteria(ctx)));
  r.post("/admin/scorecard-criteria", admin, async (req, res) => res.status(201).json(await service.saveCriterion(ctx, null, body(req), currentUser(req))));
  r.put("/admin/scorecard-criteria/:id", admin, async (req, res) => res.json(await service.saveCriterion(ctx, id.parse(req.params.id), body(req), currentUser(req))));

  // Monthly proposals (P-1). Asking for one changes no score, so any member may.
  r.get("/performance/vendors/:id/proposal", async (req, res) => res.json(await proposals.proposalState(ctx, id.parse(req.params.id), month.parse(req.query).month)));
  r.post("/performance/vendors/:id/proposal", async (req, res) =>
    res.status(201).json(await proposals.generateProposal(ctx, id.parse(req.params.id), month.parse(body(req)).month, currentUser(req).email)),
  );
  r.post("/proposals/:id/review", async (req, res) => res.json(await proposals.reviewProposal(ctx, id.parse(req.params.id), body(req), currentUser(req))));

  // Scorecards (P-2 to P-6).
  r.get("/scorecards", async (req, res) => {
    const q = listQuery.parse(req.query);
    res.json(await service.listScorecards(ctx, { ...q, sort: q.sort as CardSort }));
  });
  r.post("/scorecards", async (req, res) => res.status(201).json(await service.startScorecard(ctx, body(req), currentUser(req))));
  r.get("/scorecards/:id", async (req, res) => res.json(await service.getScorecard(ctx, id.parse(req.params.id))));
  r.put("/scorecards/:id", async (req, res) => res.json(await service.saveScorecard(ctx, id.parse(req.params.id), body(req), currentUser(req))));
  r.post("/scorecards/:id/finalise", async (req, res) => res.json(await service.finaliseScorecard(ctx, id.parse(req.params.id), currentUser(req))));
  r.post("/scorecards/:id/reopen", admin, async (req, res) => res.json(await service.reopenScorecard(ctx, id.parse(req.params.id), currentUser(req))));
  r.delete("/scorecards/:id", async (req, res) => {
    await service.removeScorecard(ctx, id.parse(req.params.id), currentUser(req));
    res.json({ ok: true });
  });
  r.get("/scorecards/:id/pdf", async (req, res) => {
    const card = await service.getScorecard(ctx, id.parse(req.params.id));
    if (card.status !== "final" || !card.finalisedAt) throw new AppError(409, "not_final", "Only a final scorecard can be exported for the vendor. Finalise it first.");
    const file = await scorecardPdf(card, formatDay(todayIn(timeZone, new Date(card.finalisedAt))));
    const name = `${card.vendorName} scorecard ${card.quarter}`.replace(/[^A-Za-z0-9 ._-]/g, "").replace(/\s+/g, " ");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.pdf"`);
    res.send(file);
  });
  return r;
}
