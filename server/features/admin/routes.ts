import { Router } from "express";
import { z } from "zod";
import { updateUserSchema } from "../../../shared/types";
import { currentUser, requireRole } from "../../platform/auth";
import { bool, day, paging, text } from "../../platform/http";
import type { Ports } from "../../platform/ports/types";
import { userSorts } from "./repo";
import * as handover from "./handover";
import * as service from "./service";

const usersQuery = z.object({
  q: text.optional(),
  role: z.enum(["admin", "member"]).optional(),
  active: bool.optional(),
  sort: z.enum(userSorts as [string, ...string[]]).default("name"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  ...paging,
});
const auditQuery = z.object({ user: text.optional(), entityType: text.optional(), from: day.optional(), to: day.optional(), ...paging });
const historyQuery = z.object({ entityType: text.min(1), entityId: text.min(1) });

export function adminRoutes(ports: Ports, timeZone: string) {
  const db = ports.database.db;
  const r = Router();

  r.get("/me", (req, res) => res.json(currentUser(req)));

  // History of one record: readable by every member.
  r.get("/audit/history", async (req, res) => {
    const q = historyQuery.parse(req.query);
    res.json(await service.listAudit(db, { ...q, timeZone, page: 1, pageSize: 200 }));
  });

  const admin = Router();
  admin.use(requireRole("admin"));
  admin.get("/users", async (req, res) => {
    const q = usersQuery.parse(req.query);
    res.json(await service.listUsers(db, { ...q, sort: q.sort as (typeof userSorts)[number] }));
  });
  admin.get("/users/:id", async (req, res) => res.json(await service.getUser(db, z.string().uuid().parse(req.params.id))));
  admin.patch("/users/:id", async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    res.json(await service.changeUser(db, id, updateUserSchema.parse(req.body), currentUser(req)));
  });
  // F-6: what a person owns, and switching them off with each record handed over.
  admin.get("/users/:id/owned", async (req, res) => res.json(await handover.listOwned(db, z.string().uuid().parse(req.params.id))));
  admin.post("/users/:id/switch-off", async (req, res) => res.json(await handover.switchOff(db, z.string().uuid().parse(req.params.id), req.body, currentUser(req))));
  admin.get("/audit", async (req, res) => res.json(await service.listAudit(db, { ...auditQuery.parse(req.query), timeZone })));
  // A POST, because running it writes test files and calls the AI model.
  admin.post("/system-check", async (req, res) => res.json(await service.systemCheck(ports, req, currentUser(req))));
  r.use("/admin", admin);
  return r;
}
