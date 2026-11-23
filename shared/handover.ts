import { z } from "zod";

/** The kinds of record a person can own (F-6). */
export const ownedKinds = ["vendor", "agreement", "rfp"] as const;
export type OwnedKind = (typeof ownedKinds)[number];
export const ownedKindLabels: Record<OwnedKind, { one: string; many: string }> = {
  vendor: { one: "vendor", many: "vendors" },
  agreement: { one: "agreement", many: "agreements" },
  rfp: { one: "RFP", many: "RFPs" },
};

export interface OwnedRecord {
  type: OwnedKind;
  id: string;
  /** What people call it: the vendor's name, "Vendor · Agreement", the RFP's title. */
  label: string;
  /** A short second line: the status or stage. */
  detail: string;
}

/** Everything one person owns, vendors first, then agreements, then RFPs, each A to Z. */
export interface Owned {
  records: OwnedRecord[];
  /** Why this person cannot be switched off at all (the last admin), whatever is handed over. */
  refusal: string | null;
}

/** "3 vendors, 1 agreement and 2 RFPs"; empty when nothing is owned. */
export function ownedSummary(records: Pick<OwnedRecord, "type">[]): string {
  const parts = ownedKinds
    .map((k) => [k, records.filter((r) => r.type === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${n === 1 ? ownedKindLabels[k].one : ownedKindLabels[k].many}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "");
}

/** Switching a person off, with a new owner for each record in their name (F-6). */
export const switchOffSchema = z.object({
  records: z
    .array(z.object({ type: z.enum(ownedKinds), id: z.string().uuid(), ownerUserId: z.string().uuid("Choose who takes it over.") }))
    .max(5000)
    .default([]),
});
export type SwitchOff = z.infer<typeof switchOffSchema>;
