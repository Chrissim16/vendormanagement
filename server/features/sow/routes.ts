import { Router } from "express";
import type { Day } from "../../../shared/dates";
import { currentUser } from "../../platform/auth";
import { id } from "../../platform/http";
import type { Db } from "../../platform/ports/types";
import * as service from "./service";

export function sowRoutes(db: Db, today: () => Day) {
  const r = Router();
  const body = (req: { body?: unknown }) => req.body ?? {};

  r.get("/agreements/:id/delivery", async (req, res) => res.json(await service.getDelivery(db, id.parse(req.params.id), today())));

  r.post("/agreements/:id/milestones", async (req, res) =>
    res.status(201).json(await service.saveMilestone(db, { sowId: id.parse(req.params.id) }, body(req), currentUser(req), today())),
  );
  r.patch("/milestones/:id", async (req, res) => res.json(await service.saveMilestone(db, { milestoneId: id.parse(req.params.id) }, body(req), currentUser(req), today())));

  r.post("/agreements/:id/change-requests", async (req, res) =>
    res.status(201).json(await service.saveChange(db, { sowId: id.parse(req.params.id) }, body(req), currentUser(req), today())),
  );
  r.patch("/change-requests/:id", async (req, res) => res.json(await service.saveChange(db, { changeId: id.parse(req.params.id) }, body(req), currentUser(req), today())));
  r.post("/change-requests/:id/approve", async (req, res) => res.json(await service.decideChange(db, id.parse(req.params.id), "approved", currentUser(req), today())));
  r.post("/change-requests/:id/reject", async (req, res) => res.json(await service.decideChange(db, id.parse(req.params.id), "rejected", currentUser(req), today())));

  r.post("/agreements/:id/consultants", async (req, res) =>
    res.status(201).json(await service.saveConsultant(db, { sowId: id.parse(req.params.id) }, body(req), currentUser(req), today())),
  );
  r.patch("/consultants/:id", async (req, res) => res.json(await service.saveConsultant(db, { consultantId: id.parse(req.params.id) }, body(req), currentUser(req), today())));
  r.delete("/consultants/:id", async (req, res) => res.json(await service.saveConsultant(db, { consultantId: id.parse(req.params.id) }, null, currentUser(req), today())));

  r.get("/vendors/:id/rate-card", async (req, res) => res.json(await service.getRateCard(db, id.parse(req.params.id), today())));
  r.post("/vendors/:id/rate-card", async (req, res) =>
    res.status(201).json(await service.saveRateLine(db, { vendorId: id.parse(req.params.id) }, body(req), currentUser(req), today())),
  );
  r.delete("/rate-card/:id", async (req, res) => res.json(await service.saveRateLine(db, { lineId: id.parse(req.params.id) }, null, currentUser(req), today())));
  return r;
}
