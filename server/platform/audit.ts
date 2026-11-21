import { auditLog } from "../../db/schema";
import type { Tx } from "./ports/types";

export interface AuditInput {
  userEmail: string;
  action: "create" | "update" | "delete" | "import" | "revert";
  entityType: string;
  entityId: string;
  /** A human label for the record, shown in the audit log (for example the vendor's name). */
  summary?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
}

/**
 * Writes an audit entry. Takes a transaction, not the database, so the entry can only be
 * written together with the change it describes.
 */
export async function audit(tx: Tx, entry: AuditInput) {
  await tx.insert(auditLog).values({
    userEmail: entry.userEmail,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary ?? null,
    changes: entry.changes && Object.keys(entry.changes).length ? entry.changes : null,
  });
}
