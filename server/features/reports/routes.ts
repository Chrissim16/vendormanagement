import { Router } from "express";
import { z } from "zod";
import { formatDay } from "../../../shared/dates";
import { currentUser } from "../../platform/auth";
import { getDashboard, type OverviewContext } from "../dashboard/service";
import { reportPdf } from "./pdf";
import * as service from "./service";

const month = z.object({ month: z.string().max(20).optional() });

/** The dashboard (D-1) and the monthly management report (D-2). Any member may use both. */
export function overviewRoutes(ctx: OverviewContext) {
  const r = Router();
  const body = (req: { body?: unknown }) => req.body ?? {};
  const asked = (req: { query: unknown }) => month.parse(req.query).month;

  r.get("/dashboard", async (_req, res) => res.json(await getDashboard(ctx)));

  r.get("/report", async (req, res) => res.json(await service.getReport(ctx, asked(req))));
  r.put("/report", async (req, res) => res.json(await service.saveReport(ctx, asked(req), body(req), currentUser(req))));
  r.post("/report/suggestion", async (req, res) => res.status(201).json(await service.suggestSummary(ctx, asked(req), currentUser(req))));
  r.post("/report/suggestion/review", async (req, res) => res.json(await service.reviewSummary(ctx, asked(req), body(req), currentUser(req))));
  r.get("/report/pdf", async (req, res) => {
    const report = await service.getReport(ctx, asked(req));
    const file = await reportPdf(report, formatDay(ctx.today()));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="vendor-report-${report.data.month}.pdf"`);
    res.send(file);
  });
  return r;
}
