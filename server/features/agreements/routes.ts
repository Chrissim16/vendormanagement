import { Router } from "express";
import { z } from "zod";
import { agreementStatuses, kinds } from "../../../shared/agreements";
import type { Day } from "../../../shared/dates";
import { currentUser } from "../../platform/auth";
import { AppError } from "../../platform/errors";
import { day, dir, id, paging, text, upload } from "../../platform/http";
import type { Db, StoragePort } from "../../platform/ports/types";
import { agreementSorts } from "./repo";
import * as service from "./service";

const filters = {
  q: text.optional(),
  kind: z.enum(kinds).optional(),
  vendorId: id.optional(),
  status: z.enum(agreementStatuses).optional(),
  owner: id.optional(),
  endsFrom: day.optional(),
  endsTo: day.optional(),
  sort: z.enum(agreementSorts as [string, ...string[]]).default("title"),
  dir,
};
const listQuery = z.object({ ...filters, ...paging });
const exportQuery = z.object(filters);
const renewalsQuery = z.object({ window: z.coerce.number().int().min(1, "Choose at least 1 day.").max(365, "Choose at most 365 days.").optional(), owner: id.optional() });

export function agreementRoutes(db: Db, storage: StoragePort, today: () => Day) {
  const r = Router();
  type Sort = (typeof agreementSorts)[number];

  r.get("/agreements", async (req, res) => {
    const q = listQuery.parse(req.query);
    res.json(await service.listAgreements(db, { ...q, sort: q.sort as Sort }, today()));
  });
  r.get("/agreements/export.csv", async (req, res) => {
    const q = exportQuery.parse(req.query);
    const csv = await service.exportCsv(db, { ...q, sort: q.sort as Sort }, today());
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="agreements-${today()}.csv"` }).send(csv);
  });
  r.get("/renewals", async (req, res) => {
    const q = renewalsQuery.parse(req.query);
    res.json(await service.listRenewals(db, q.window, q.owner, today()));
  });
  r.post("/agreements", async (req, res) => res.status(201).json(await service.createAgreement(db, req.body, currentUser(req), today())));
  r.get("/agreements/:id", async (req, res) => res.json(await service.getAgreement(db, id.parse(req.params.id), today())));
  r.patch("/agreements/:id", async (req, res) => res.json(await service.updateAgreement(db, id.parse(req.params.id), req.body, currentUser(req), today())));
  r.post("/agreements/:id/decisions", async (req, res) => res.status(201).json(await service.recordDecision(db, id.parse(req.params.id), req.body, currentUser(req), today())));

  r.post("/agreements/:id/documents", upload.single("file"), async (req, res) => {
    if (!req.file) throw new AppError(400, "file_missing", "Choose a file to attach.");
    // Browsers send the name as Latin-1 bytes; read it back as the UTF-8 it was.
    const name = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    res.status(201).json(await service.addDocument(db, storage, id.parse(req.params.id), { name, data: req.file.buffer }, currentUser(req)));
  });
  r.get("/documents/:id/download", async (req, res) => {
    const { doc, data } = await service.readDocument(db, storage, id.parse(req.params.id));
    const ascii = doc.fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
    // RFC 5987 allows fewer characters than encodeURIComponent leaves alone.
    const encoded = encodeURIComponent(doc.fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    res
      .set({
        "Content-Type": doc.contentType,
        "Content-Length": String(data.length),
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      })
      .send(data);
  });
  r.delete("/documents/:id", async (req, res) => {
    await service.removeDocument(db, storage, id.parse(req.params.id), currentUser(req));
    res.json({ ok: true });
  });
  return r;
}
