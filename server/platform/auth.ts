import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { users } from "../../db/schema";
import type { Role, User } from "../../shared/types";
import { audit } from "./audit";
import { AppError, forbidden } from "./errors";
import type { Db, Identity, IdentityPort } from "./ports/types";

declare module "express-serve-static-core" {
  interface Request {
    user?: User;
  }
}

type Row = typeof users.$inferSelect;
export const toUser = (r: Row): User => ({
  id: r.id,
  email: r.email,
  displayName: r.displayName,
  role: r.role,
  active: r.active,
  createdAt: r.createdAt.toISOString(),
});

/** Finds the person's record, creating it on their first visit. */
export async function ensureUser(db: Db, identity: Identity, bootstrapAdminEmail: string): Promise<User> {
  const existing = await db.select().from(users).where(eq(users.email, identity.email));
  if (existing[0]) return toUser(existing[0]);
  const role: Role = identity.email === bootstrapAdminEmail ? "admin" : "member";
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values({ email: identity.email, displayName: identity.name, role, createdBy: identity.email, updatedBy: identity.email })
      .onConflictDoNothing()
      .returning();
    const row = inserted[0];
    if (!row) {
      // Two first requests arrived together and the other one created the record.
      const again = await tx.select().from(users).where(eq(users.email, identity.email));
      return toUser(again[0]!);
    }
    await audit(tx, { userEmail: identity.email, action: "create", entityType: "user", entityId: row.id, summary: row.email, changes: { role: { from: null, to: role } } });
    return toUser(row);
  });
}

export function authenticate(db: Db, identity: IdentityPort, bootstrapAdminEmail: string): RequestHandler {
  return async (req, _res, next) => {
    try {
      const who = identity.resolve(req);
      if (!who) throw new AppError(401, "not_signed_in", "We could not tell who you are. Open the app through Databricks.");
      const user = await ensureUser(db, who, bootstrapAdminEmail);
      if (!user.active) throw new AppError(403, "no_access", "Your access has been switched off. Ask an admin to switch it back on.");
      req.user = user;
      next();
    } catch (e) {
      next(e);
    }
  };
}

export const requireRole =
  (role: Role): RequestHandler =>
  (req, _res, next) =>
    next(req.user?.role === role ? undefined : forbidden());

export function currentUser(req: { user?: User }): User {
  if (!req.user) throw new AppError(401, "not_signed_in", "We could not tell who you are.");
  return req.user;
}
