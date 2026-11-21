import { Router } from "express";
import { z } from "zod";
import type { Day } from "../../../shared/dates";
import { vendorStatuses, vendorTypes } from "../../../shared/vendors";
import { currentUser } from "../../platform/auth";
import { dir, id, paging, text } from "../../platform/http";
import type { Db } from "../../platform/ports/types";
import { vendorSorts } from "./repo";
import * as service from "./service";

const listQuery = z.object({
  q: text.optional(),
  type: z.enum(vendorTypes).optional(),
  status: z.enum([...vendorStatuses, "all"]).optional(),
  owner: id.optional(),
  sort: z.enum(vendorSorts as [string, ...string[]]).default("name"),
  dir,
  ...paging,
});

export function vendorRoutes(db: Db, today: () => Day) {
  const r = Router();
  r.get("/people", async (_req, res) => res.json(await service.listPeople(db)));
  r.get("/vendors", async (req, res) => {
    const q = listQuery.parse(req.query);
    res.json(await service.listVendors(db, { ...q, sort: q.sort as (typeof vendorSorts)[number] }, today()));
  });
  r.post("/vendors", async (req, res) => res.status(201).json(await service.createVendor(db, req.body, currentUser(req), today())));
  r.get("/vendors/:id", async (req, res) => res.json(await service.getVendor(db, id.parse(req.params.id), today())));
  r.patch("/vendors/:id", async (req, res) => res.json(await service.updateVendor(db, id.parse(req.params.id), req.body, currentUser(req), today())));
  r.post("/vendors/:id/contacts", async (req, res) => res.status(201).json(await service.saveContact(db, { vendorId: id.parse(req.params.id) }, req.body ?? {}, currentUser(req))));
  r.patch("/contacts/:id", async (req, res) => res.json(await service.saveContact(db, { contactId: id.parse(req.params.id) }, req.body ?? {}, currentUser(req))));
  r.delete("/contacts/:id", async (req, res) => res.json(await service.saveContact(db, { contactId: id.parse(req.params.id) }, null, currentUser(req))));
  return r;
}
