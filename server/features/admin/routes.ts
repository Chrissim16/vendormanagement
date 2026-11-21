import { Router } from "express";
import { z } from "zod";
import { updateUserSchema } from "../../../shared/types";
import { currentUser, requireRole } from "../../platform/auth";
import type { Ports } from "../../platform/ports/types";
import { userSorts } from "./repo";
import * as service from "./service";

const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) };
const bool = z.enum(["true", "false"]).transform((v) => v === "true");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const usersQuery = z.object({
  q: z.string().trim().max(200).optional(),
  role: z.enum(["admin", "member"]).optional(),
  active: bool.optional(),
  sort: z.enum(userSorts as [string, ...string[]]).default("email"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  ...paging,
});
const auditQuery = z.object({ user: z.string().trim().max(200).optional(), entityType: z.string().max(60).optional(), from: day.optional(), to: day.optional(), ...paging });
const historyQuery = z.object({ entityType: z.string().min(1).max(60), entityId: z.string().min(1).max(100) });

export function adminRoutes(ports: Ports) {
  const db = ports.database.db;
  const r = Router();

  r.get("/me", (req, res) => res.json(currentUser(req)));

  // History of one record: readable by every member.
  r.get("/audit/history", async (req, res) => {
    const q = historyQuery.parse(req.query);
    res.json(await service.listAudit(db, { ...q, page: 1, pageSize: 200 }));
  });

  const admin = Router();
  admin.use(requireRole("admin"));
  admin.get("/users", async (req, res) => {
    const q = usersQuery.parse(req.query);
    res.json(await service.listUsers(db, { ...q, sort: q.sort as (typeof userSorts)[number] }));
  });
  admin.patch("/users/:id", async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    res.json(await service.changeUser(db, id, updateUserSchema.parse(req.body), currentUser(req)));
  });
  admin.get("/audit", async (req, res) => res.json(await service.listAudit(db, auditQuery.parse(req.query))));
  admin.get("/system-check", async (req, res) => res.json(await service.systemCheck(ports, req, currentUser(req))));
  r.use("/admin", admin);
  return r;
}
