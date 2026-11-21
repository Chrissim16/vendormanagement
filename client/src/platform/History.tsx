import { useQuery } from "@tanstack/react-query";
import type { AuditEntry, Page } from "../../../shared/types";
import { api, messageOf } from "../lib/api";
import { formatDay, isDay } from "../../../shared/dates";
import { formatDateTime } from "../lib/format";

const verbs: Record<string, string> = { create: "Added", update: "Changed", delete: "Removed", import: "Imported", revert: "Reverted" };
const names: Record<string, string> = {
  active: "access",
  displayName: "name",
  legalName: "legal name",
  ownerUserId: "owner",
  scoringEnabled: "scored",
  ndaRequired: "NDA required",
  dpaRequired: "data processing agreement required",
  signedOn: "signed on",
  startDate: "start date",
  endDate: "end date",
  endReason: "reason it ended",
  parentMsaId: "MSA it sits under",
  budgetMinor: "budget",
  annualValueMinor: "annual value",
  noticePeriodDays: "notice period in days",
  autoRenews: "renews automatically",
  renewalTermMonths: "renewal term in months",
  isPrimary: "primary",
  jobTitle: "job title",
};
/** A field name as people would say it: "signedOn" becomes "signed on". Names that already contain spaces are kept. */
const fieldName = (key: string) =>
  key
    .split(" ")
    .map((part) => names[part] ?? part)
    .join(" ");
const money = new Set(["budgetMinor", "annualValueMinor"]);
/** Fields whose values are the app's own codes, such as in_negotiation. */
const codes = new Set(["status", "kind", "type", "pricing", "endReason", "role"]);
const hidden = new Set(["ownerUserId", "parentMsaId"]);

function show(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "nothing";
  if (v === true) return "yes";
  if (v === false) return "no";
  if (money.has(key) && typeof v === "number") return (v / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 });
  if (isDay(v)) return formatDay(v);
  return codes.has(key) ? String(v).replace(/_/g, " ") : String(v);
}

/** What changed, in words: "status from draft to active, signed on set to 1 Nov 2026". */
export function describeChanges(e: AuditEntry): string {
  return Object.entries(e.changes ?? {})
    .map(([k, c]) => {
      const last = k.split(" ").pop()!;
      // Internal ids mean nothing to a reader; say that it changed, not to what.
      if (hidden.has(last)) return `${fieldName(k)} changed`;
      return c.from === null || c.from === undefined || c.from === ""
        ? `${fieldName(k)} set to ${show(last, c.to)}`
        : `${fieldName(k)} from ${show(last, c.from)} to ${show(last, c.to)}`;
    })
    .join(", ");
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
