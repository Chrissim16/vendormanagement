import { useQuery } from "@tanstack/react-query";
import type { AuditEntry, Page } from "../../../shared/types";
import { api, messageOf } from "../lib/api";
import { formatDateTime } from "../lib/format";

const verbs: Record<string, string> = { create: "Added", update: "Changed", delete: "Removed", import: "Imported", revert: "Reverted" };
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "nothing" : v === true ? "yes" : v === false ? "no" : String(v));
const names: Record<string, string> = { active: "access", displayName: "name" };

export function describeChanges(e: AuditEntry): string {
  const parts = Object.entries(e.changes ?? {}).map(([k, c]) =>
    c.from === null ? `${names[k] ?? k} set to ${show(c.to)}` : `${names[k] ?? k} from ${show(c.from)} to ${show(c.to)}`,
  );
  return parts.join(", ");
}

/** The history of one record, newest first. Shown on every record's page. */
export function History({ entityType, entityId }: { entityType: string; entityId: string }) {
  const q = useQuery({ queryKey: ["history", entityType, entityId], queryFn: () => api<Page<AuditEntry>>("/audit/history", { query: { entityType, entityId } }) });
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">History</h3>
      {q.isError && <p className="text-ink-2">{messageOf(q.error)}</p>}
      {q.data?.items.length === 0 && <p className="text-ink-2">No changes recorded yet.</p>}
      <ol className="flex flex-col">
        {q.data?.items.map((e) => (
          <li key={e.id} className="border-b border-line py-3 last:border-0">
            <p>
              <span className="font-semibold">{verbs[e.action] ?? e.action}</span>
              {describeChanges(e) && <span>: {describeChanges(e)}</span>}
            </p>
            <p className="text-[13px] text-ink-2">
              {e.userEmail} · <span className="num">{formatDateTime(e.at)}</span>
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
