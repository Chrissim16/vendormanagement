import { Router } from "express";
import { z } from "zod";
import { updateUserSchema } from "../../../shared/types";
import { currentUser, requireRole } from "../../platform/auth";
import type { Ports } from "../../platform/ports/types";
import { userSorts } from "./repo";
import * as service from "./service";

const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) };
const bool = z.enum(["true", "false"]).transform((v) => v === "true");
/** Free text from a search box: trimmed, bounded, and without control characters the database rejects. */
const text = z
  .string()
  .trim()
  .max(200)
  .refine((v) => ![...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127), "That contains characters that cannot be searched for.");
/** A real calendar day, written YYYY-MM-DD. */
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-21.")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "That date does not exist.");

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
  admin.get("/audit", async (req, res) => res.json(await service.listAudit(db, { ...auditQuery.parse(req.query), timeZone })));
  // A POST, because running it writes test files and calls the AI model.
  admin.post("/system-check", async (req, res) => res.json(await service.systemCheck(ports, req, currentUser(req))));
  r.use("/admin", admin);
  return r;
}
