import { and, asc, desc, eq, gte, ilike, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { auditLog, users } from "../../../db/schema";
import type { Queryable } from "../../platform/ports/types";

const userSort = { email: users.email, displayName: users.displayName, role: users.role, active: users.active, createdAt: users.createdAt };
export type UserSort = keyof typeof userSort;
export const userSorts = Object.keys(userSort) as UserSort[];

export interface UserFilter {
  q?: string;
  role?: "admin" | "member";
  active?: boolean;
  sort: UserSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

export async function listUsers(db: Queryable, f: UserFilter) {
  const where: SQL[] = [];
  if (f.q) where.push(or(ilike(users.email, `%${f.q}%`), ilike(users.displayName, `%${f.q}%`))!);
  if (f.role) where.push(eq(users.role, f.role));
  if (f.active !== undefined) where.push(eq(users.active, f.active));
  const cond = where.length ? and(...where) : undefined;
  const col = userSort[f.sort];
  const [items, total] = await Promise.all([
    db
      .select()
      .from(users)
      .where(cond)
      .orderBy(f.dir === "asc" ? asc(col) : desc(col), asc(users.email))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(cond),
  ]);
  return { items, total: total[0]?.n ?? 0 };
}

export const getUser = async (db: Queryable, id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];

export const countOtherActiveAdmins = async (db: Queryable, id: string) =>
  (
    await db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.active, true), ne(users.id, id)))
  )[0]?.n ?? 0;

export async function updateUser(db: Queryable, id: string, patch: { role?: "admin" | "member"; active?: boolean }, by: string) {
  const rows = await db
    .update(users)
    .set({ ...patch, updatedAt: new Date(), updatedBy: by })
    .where(eq(users.id, id))
    .returning();
  return rows[0]!;
}

export interface AuditFilter {
  user?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export async function listAudit(db: Queryable, f: AuditFilter) {
  const where: SQL[] = [];
  if (f.user) where.push(ilike(auditLog.userEmail, `%${f.user}%`));
  if (f.entityType) where.push(eq(auditLog.entityType, f.entityType));
  if (f.entityId) where.push(eq(auditLog.entityId, f.entityId));
  if (f.from) where.push(gte(auditLog.at, new Date(`${f.from}T00:00:00Z`)));
  if (f.to) where.push(lt(auditLog.at, new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86_400_000)));
  const cond = where.length ? and(...where) : undefined;
  const [items, total] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(cond)
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(cond),
  ]);
  return { items, total: total[0]?.n ?? 0 };
}

export const auditEntityTypes = async (db: Queryable) => (await db.selectDistinct({ t: auditLog.entityType }).from(auditLog).orderBy(asc(auditLog.entityType))).map((r) => r.t);
