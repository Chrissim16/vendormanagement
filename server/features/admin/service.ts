import type { Request } from "express";
import { sql } from "drizzle-orm";
import type { AuditEntry, Page, SystemCheckItem, UpdateUser, User } from "../../../shared/types";
import { diff, refuseUserChange } from "../../../shared/users";
import { audit } from "../../platform/audit";
import { toUser } from "../../platform/auth";
import { AppError, notFound } from "../../platform/errors";
import { aiContract, databaseContract, identityContract, jiraContract, runCases, storageContract } from "../../platform/ports/contract";
import type { Db, Ports } from "../../platform/ports/types";
import * as repo from "./repo";

export async function listUsers(db: Db, filter: repo.UserFilter): Promise<Page<User>> {
  const { items, total } = await repo.listUsers(db, filter);
  return { items: items.map(toUser), total };
}

export async function getUser(db: Db, id: string): Promise<User> {
  const row = await repo.getUser(db, id);
  if (!row) throw notFound("That person");
  return toUser(row);
}

export async function changeUser(db: Db, id: string, change: UpdateUser, by: User): Promise<User> {
  return db.transaction(async (tx) => {
    // Serialise role changes so two admins cannot demote each other at the same moment.
    await tx.execute(sql`select pg_advisory_xact_lock(4201)`);
    const current = await repo.getUser(tx, id);
    if (!current) throw notFound("That person");
    const refusal = refuseUserChange(current, change, await repo.countOtherActiveAdmins(tx, id));
    if (refusal) throw new AppError(409, "last_admin", refusal);
    const changes = diff({ role: current.role, active: current.active }, change);
    if (!Object.keys(changes).length) return toUser(current);
    const updated = await repo.updateUser(tx, id, change, by.email);
    await audit(tx, { userEmail: by.email, action: "update", entityType: "user", entityId: id, summary: current.email, changes });
    return toUser(updated);
  });
}

type AuditRow = Awaited<ReturnType<typeof repo.listAudit>>["items"][number];
const toEntry = (r: AuditRow): AuditEntry => ({ ...r, at: r.at.toISOString(), changes: r.changes ?? null });

export async function listAudit(db: Db, filter: repo.AuditFilter): Promise<Page<AuditEntry> & { entityTypes: string[] }> {
  const [{ items, total }, entityTypes] = await Promise.all([repo.listAudit(db, filter), repo.auditEntityTypes(db)]);
  return { items: items.map(toEntry), total, entityTypes };
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms / 1000} seconds.`)), ms)));
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** Tests every connection and explains each failure in plain language. */
export async function systemCheck(ports: Ports, req: Request, user: User): Promise<SystemCheckItem[]> {
  const item = async (
    key: SystemCheckItem["key"],
    label: string,
    port: { kind: SystemCheckItem["kind"] },
    check: () => Promise<{ ok: boolean; detail: string; fix?: string }>,
    cases: Parameters<typeof runCases>[0],
  ): Promise<SystemCheckItem> => {
    try {
      const result = await withTimeout(check(), 15_000, label);
      const ran = result.ok ? await withTimeout(runCases(cases), 60_000, label) : [];
      const failed = ran.filter((c) => !c.ok);
      return {
        key,
        label,
        kind: port.kind,
        ok: result.ok && !failed.length,
        detail: failed.length ? `Connected, but ${failed.length} of ${ran.length} checks failed.` : result.detail,
        fix: failed.length ? "Send the failed checks below to whoever supports the app." : result.fix,
        cases: ran,
      };
    } catch (e) {
      return {
        key,
        label,
        kind: port.kind,
        ok: false,
        detail: (e as Error).message,
        fix: "Try again. If it keeps failing, the service may be unreachable from the app.",
        cases: [],
      };
    }
  };
  return Promise.all([
    item("identity", "Sign-in", ports.identity, () => ports.identity.check(req), identityContract(ports.identity, req, user.email)),
    item("database", "Database", ports.database, () => ports.database.check(), databaseContract(ports.database)),
    item("storage", "File storage", ports.storage, () => ports.storage.check(), storageContract(ports.storage)),
    item("jira", "Jira", ports.jira, () => ports.jira.check(), jiraContract(ports.jira)),
    item("ai", "AI model", ports.ai, () => ports.ai.check(), aiContract(ports.ai)),
  ]);
}
