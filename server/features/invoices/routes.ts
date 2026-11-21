import { Router } from "express";
import { z } from "zod";
import type { Day } from "../../../shared/dates";
import { currentUser } from "../../platform/auth";
import { day, dir, id, paging, text } from "../../platform/http";
import type { Db } from "../../platform/ports/types";
import { invoiceSorts } from "./repo";
import * as service from "./service";

const filters = {
  q: text.optional(),
  vendorId: id.optional(),
  agreementId: id.optional(),
  from: day.optional(),
  to: day.optional(),
  sort: z.enum(invoiceSorts as [string, ...string[]]).default("invoiceDate"),
  dir: dir.default("desc"),
};
const listQuery = z.object({ ...filters, ...paging });
const exportQuery = z.object(filters);
const spendQuery = z.object({ from: day.optional(), to: day.optional() });

export function invoiceRoutes(db: Db, today: () => Day) {
  const r = Router();
  type Sort = (typeof invoiceSorts)[number];
  r.get("/invoices", async (req, res) => {
    const q = listQuery.parse(req.query);
    res.json(await service.listInvoices(db, { ...q, sort: q.sort as Sort }));
  });
  r.get("/invoices/export.csv", async (req, res) => {
    const q = exportQuery.parse(req.query);
    res
      .set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="invoices-${today()}.csv"` })
      .send(await service.exportCsv(db, { ...q, sort: q.sort as Sort }));
  });
  r.post("/invoices", async (req, res) => res.status(201).json(await service.saveInvoice(db, null, req.body, currentUser(req), today())));
  r.patch("/invoices/:id", async (req, res) => res.json(await service.saveInvoice(db, id.parse(req.params.id), req.body ?? {}, currentUser(req), today())));
  r.delete("/invoices/:id", async (req, res) => {
    await service.removeInvoice(db, id.parse(req.params.id), currentUser(req));
    res.json({ ok: true });
  });
  r.get("/spend/export.csv", async (req, res) => {
    const q = spendQuery.parse(req.query);
    const period = service.defaultPeriod(today());
    const from = q.from ?? period.from;
    const to = q.to ?? period.to;
    // Build the file first, so a refused period is answered as an error and not as a download.
    const csv = await service.exportSpendCsv(db, from, to);
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="spend-${from}-to-${to}.csv"` }).send(csv);
  });
  r.get("/spend", async (req, res) => {
    const q = spendQuery.parse(req.query);
    const period = service.defaultPeriod(today());
    res.json(await service.getSpend(db, q.from ?? period.from, q.to ?? period.to));
  });
  return r;
}
