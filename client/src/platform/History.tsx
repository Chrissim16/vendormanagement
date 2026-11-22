import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "./ui";
import type { AuditEntry, Page } from "../../../shared/types";
import { api, messageOf } from "../lib/api";
import { formatDay, isDay } from "../../../shared/dates";
import { formatRate } from "../../../shared/sow";
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
  dueDate: "due date",
  deliveredOn: "delivered on",
  amountMinor: "amount",
  requestedOn: "requested on",
  budgetChangeMinor: "budget change",
  newEndDate: "new end date",
  fromDate: "from",
  toDate: "until",
  invoiceDate: "invoice date",
  invoiceNumber: "invoice number",
  milestoneId: "milestone",
  agreementId: "agreement",
  gbpToEurE4: "pound to euro rate",
  noticeDays: "days of warning before a notice deadline",
  sowEndDays: "days of warning before a SOW ends",
  budgetWarningPct: "budget warning percentage",
  jobTitle: "job title",
  addressLine1: "street",
  addressLine2: "second street line",
  postalCode: "postal code",
  vatNumber: "VAT or tax number",
};
/** A field name as people would say it: "signedOn" becomes "signed on". Names that already contain spaces are kept. */
const fieldName = (key: string) =>
  key
    .split(" ")
    .map((part) => names[part] ?? (isDay(part) ? formatDay(part) : part))
    .join(" ");
const money = new Set(["budgetMinor", "annualValueMinor", "amountMinor", "budgetChangeMinor"]);
/** Fields whose values are the app's own codes, such as in_negotiation. */
const codes = new Set(["status", "kind", "type", "pricing", "endReason", "role"]);
const hidden = new Set(["ownerUserId", "parentMsaId", "milestoneId", "agreementId", "vendorId"]);

function show(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "nothing";
  if (v === true) return "yes";
  if (v === false) return "no";
  if (key === "gbpToEurE4" && typeof v === "number") return formatRate(v);
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
      const blank = c.from === null || c.from === undefined || c.from === "";
      // A line of a list (a milestone, a consultant, a rate) that came or went reads as that, not as a field change.
      if (blank && typeof c.to === "string" && (c.to === "attached" || c.to.startsWith("added"))) return `${fieldName(k)} ${c.to}`;
      if (blank && k.startsWith("rate for ")) return `${fieldName(k)} added at ${show(last, c.to)}`;
      if (c.to === "removed") return blank || c.from === "listed" || c.from === "attached" ? `${fieldName(k)} removed` : `${fieldName(k)} removed (was ${show(last, c.from)})`;
      return blank ? `${fieldName(k)} set to ${show(last, c.to)}` : `${fieldName(k)} from ${show(last, c.from)} to ${show(last, c.to)}`;
    })
    .join(", ");
}

/**
 * The history of one record, newest first. Shown on every record's page: on its own tab
 * where the page has tabs, otherwise with `limit` so a long history does not push the page
 * down; then the newest entries show, with "Show all" for the rest (F-3).
 */
export function History({ entityType, entityId, limit }: { entityType: string; entityId: string; limit?: number }) {
  const q = useQuery({ queryKey: ["history", entityType, entityId], queryFn: () => api<Page<AuditEntry>>("/audit/history", { query: { entityType, entityId } }) });
  const [all, setAll] = useState(false);
  const items = q.data?.items ?? [];
  const shown = limit && !all ? items.slice(0, limit) : items;
  const hidden = items.length - shown.length;
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">History</h3>
      {q.isError && <p className="text-ink-2">{messageOf(q.error)}</p>}
      {q.data?.items.length === 0 && <p className="text-ink-2">No changes recorded yet.</p>}
      <ol className="flex flex-col" aria-label="History">
        {shown.map((e) => (
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
      {hidden > 0 && (
        <div>
          <Button className="h-8 px-3.5 text-[12.5px]" onClick={() => setAll(true)}>
            {q.data && q.data.total > items.length ? `Show the newest ${items.length}` : `Show all ${items.length}`}
          </Button>
        </div>
      )}
      {limit && all && items.length > limit && (
        <div>
          <Button className="h-8 px-3.5 text-[12.5px]" onClick={() => setAll(false)}>
            Show the newest {limit}
          </Button>
        </div>
      )}
      {q.data && q.data.total > items.length && (
        <p className="text-[13px] text-ink-2">
          These are the newest {items.length} of {q.data.total} changes. An admin can see every one on the Audit log page.
        </p>
      )}
    </div>
  );
}
