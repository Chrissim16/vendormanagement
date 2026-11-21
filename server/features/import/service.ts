import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { agreementSchema, checkAgreement, kinds, type AgreementInput, type Kind } from "../../../shared/agreements";
import { isDay, type Day } from "../../../shared/dates";
import { parseAmount } from "../../../shared/money";
import type { User } from "../../../shared/types";
import { cleanName, vendorSchema, type VendorInput } from "../../../shared/vendors";
import { AppError } from "../../platform/errors";
import type { Db, Queryable } from "../../platform/ports/types";
import * as agreementRepo from "../agreements/repo";
import { createAgreement } from "../agreements/service";
import * as vendorRepo from "../vendors/repo";
import { createVendor } from "../vendors/service";

const vendorColumns = ["Name", "Type", "Status", "Owner email", "Legal name", "Website", "Country", "NDA required", "DPA required", "Scored", "Description"] as const;
const agreementColumns = [
  "Vendor name",
  "Kind",
  "Title",
  "Reference",
  "Status",
  "Owner email",
  "Currency",
  "Signed on",
  "Start date",
  "End date",
  "Parent MSA title",
  "Pricing",
  "Budget",
  "Annual value",
  "Notice period days",
  "Auto renews",
  "Renewal term months",
  "Notes",
] as const;

export interface ImportRow {
  sheet: "Vendors" | "Agreements";
  row: number;
  label: string;
  /** add: will be created. exists: already there, left alone. invalid: has problems, skipped. */
  outcome: "add" | "exists" | "invalid";
  problems: string[];
}
export interface ImportResult {
  rows: ImportRow[];
  counts: { add: number; exists: number; invalid: number };
  applied: boolean;
}

/** The empty workbook people fill in (A-8). */
export async function template(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = (name: string, columns: readonly string[], example: (string | number)[], notes: string[]) => {
    const ws = wb.addWorksheet(name);
    ws.addRow([...columns]).font = { bold: true };
    ws.addRow(example).font = { italic: true, color: { argb: "FF6A7285" } };
    ws.columns.forEach((c) => (c.width = 22));
    const help = wb.addWorksheet(`${name} help`);
    help.getColumn(1).width = 110;
    notes.forEach((n) => help.addRow([n]));
  };
  sheet(
    "Vendors",
    vendorColumns,
    ["Example Vendor (delete this row)", "software", "active", "", "Example Vendor B.V.", "https://example.test", "NL", "yes", "yes", "yes", ""],
    [
      "One row per vendor. Name and Type are required.",
      "Type: software, consultancy or advisory.",
      "Status: prospect, active, on_hold or offboarded. Empty means active.",
      "Owner email: a colleague who has opened the app. Empty means you.",
      "NDA required, DPA required, Scored: yes or no. Empty means yes.",
      "A vendor whose name is already in the app is left as it is.",
    ],
  );
  sheet(
    "Agreements",
    agreementColumns,
    [
      "Example Vendor (delete this row)",
      "SOW",
      "SOW 01 Example project",
      "",
      "active",
      "",
      "EUR",
      "2026-01-15",
      "2026-02-01",
      "2026-12-31",
      "",
      "fixed",
      "120000",
      "",
      "",
      "",
      "",
      "",
    ],
    [
      "One row per agreement. Vendor name, Kind and Title are required.",
      "Vendor name must match a vendor in the app or on the Vendors sheet.",
      "Kind: MSA, SOW, Subscription, NDA or DPA.",
      "Status: draft, in_negotiation, out_for_signature, active or ended. Empty means draft.",
      "Dates: as an Excel date, or typed as 2026-12-31 or 31-12-2026.",
      "SOW: needs Start date, End date, Pricing (fixed or time_and_materials) and Budget. Parent MSA title is optional.",
      "Subscription: needs End date (the renewal date) and Annual value. Notice period days defaults to 90.",
      "NDA and DPA: need Signed on. End date is the valid-until date and may be empty.",
      "MSA: has no end date.",
      "An agreement with the same vendor, kind and title as one already in the app is left as it is.",
    ],
  );
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const str = (v: unknown): string => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (o.richText)
      return o.richText
        .map((t) => t.text)
        .join("")
        .trim();
    return str(o.text ?? o.result ?? "");
  }
  return String(v).trim();
};

function toDay(v: unknown, problems: string[], column: string): Day | null {
  const s = str(v);
  if (!s) return null;
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  const day = dmy ? `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}` : s;
  if (isDay(day)) return day;
  problems.push(`${column}: "${s}" is not a date. Use 2026-12-31 or 31-12-2026.`);
  return null;
}
function toMinor(v: unknown, problems: string[], column: string): number | null {
  if (v == null || str(v) === "") return null;
  const minor = typeof v === "number" ? (v >= 0 ? Math.round(v * 100) : null) : parseAmount(str(v));
  if (minor == null) problems.push(`${column}: "${str(v)}" is not an amount.`);
  return minor;
}
function toBool(v: unknown, problems: string[], column: string): boolean | undefined {
  const s = str(v).toLowerCase();
  if (!s) return undefined;
  if (["yes", "y", "true", "1"].includes(s)) return true;
  if (["no", "n", "false", "0"].includes(s)) return false;
  problems.push(`${column}: write yes or no.`);
  return undefined;
}
function toInt(v: unknown, problems: string[], column: string): number | null {
  const s = str(v);
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  problems.push(`${column}: "${s}" is not a whole number.`);
  return null;
}
const key = (v: unknown) =>
  str(v)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

async function read(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new AppError(400, "not_a_workbook", "That file could not be read as an Excel workbook. Use the template.");
  }
  const sheet = (name: string, columns: readonly string[]) => {
    const ws = wb.getWorksheet(name);
    if (!ws) throw new AppError(400, "sheet_missing", `The workbook has no sheet called "${name}". Use the template.`);
    // The row comes back with gaps for empty cells; Array.from fills them so every position is a string.
    const header = Array.from(ws.getRow(1).values as unknown[], str);
    const index = Object.fromEntries(columns.map((c) => [c, header.findIndex((h) => h.toLowerCase() === c.toLowerCase())])) as Record<string, number>;
    const missing = columns.filter((c) => index[c]! < 0);
    if (missing.length)
      throw new AppError(400, "columns_missing", `The "${name}" sheet is missing the column${missing.length > 1 ? "s" : ""} ${missing.join(", ")}. Use the template.`);
    const rows: { row: number; get: (c: string) => unknown }[] = [];
    ws.eachRow((r, n) => {
      const values = r.values as unknown[];
      if (n === 1 || !values.some((v) => str(v))) return;
      if (rows.length >= 2000) throw new AppError(400, "too_many_rows", `The "${name}" sheet has more than 2,000 rows.`);
      rows.push({ row: n, get: (c) => values[index[c]!] });
    });
    return rows;
  };
  return { vendors: sheet("Vendors", vendorColumns), agreements: sheet("Agreements", agreementColumns) };
}

const issues = (e: { issues: { path: PropertyKey[]; message: string }[] }) => e.issues.map((i) => i.message);

/**
 * Reads the workbook and works out what each row would do. With `apply`, the valid new
 * rows are created, all or nothing. Rows already in the app are left alone, so importing
 * the same file twice adds nothing the second time.
 */
export async function importWorkbook(db: Db, buffer: Buffer, by: User, today: Day, apply: boolean): Promise<ImportResult> {
  const book = await read(buffer);
  return db.transaction(async (tx) => {
    // One import at a time, so two cannot both decide the same row is new.
    await tx.execute(sql`select pg_advisory_xact_lock(4202)`);
    const people = new Map((await vendorRepo.listActiveUsers(tx)).map((u) => [u.email, u.id]));
    const owner = (v: unknown, problems: string[]) => {
      const email = str(v).toLowerCase();
      if (!email) return by.id;
      const id = people.get(email);
      if (!id) problems.push(`Owner email: ${email} has not opened the app, or no longer has access.`);
      return id ?? by.id;
    };
    const rows: ImportRow[] = [];
    const newVendors = new Map<string, VendorInput>();
    const seenVendors = new Set<string>();

    for (const r of book.vendors) {
      const problems: string[] = [];
      const name = cleanName(str(r.get("Name")));
      const parsed = vendorSchema.safeParse({
        name,
        type: key(r.get("Type")),
        status: key(r.get("Status")) || undefined,
        ownerUserId: owner(r.get("Owner email"), problems),
        legalName: str(r.get("Legal name")),
        website: str(r.get("Website")),
        country: str(r.get("Country")),
        ndaRequired: toBool(r.get("NDA required"), problems, "NDA required"),
        dpaRequired: toBool(r.get("DPA required"), problems, "DPA required"),
        scoringEnabled: toBool(r.get("Scored"), problems, "Scored"),
        description: str(r.get("Description")),
      });
      if (!parsed.success) problems.push(...issues(parsed.error));
      const k = name.toLowerCase();
      if (name && seenVendors.has(k)) problems.push("This vendor appears more than once in the file.");
      seenVendors.add(k);
      const exists = name ? await vendorRepo.findByName(tx, name) : undefined;
      const outcome = problems.length ? "invalid" : exists ? "exists" : "add";
      if (outcome === "add" && parsed.success) newVendors.set(k, parsed.data);
      rows.push({ sheet: "Vendors", row: r.row, label: name || "(no name)", outcome, problems });
    }

    const vendorIds = new Map<string, string>();
    if (apply) for (const [k, v] of newVendors) vendorIds.set(k, (await createVendor(tx as unknown as Db, v, by, today, "import")).id);

    const pending: { input: AgreementInput; parentTitle: string; row: ImportRow }[] = [];
    const seenAgreements = new Set<string>();
    for (const r of book.agreements) {
      const problems: string[] = [];
      const vendorName = cleanName(str(r.get("Vendor name")));
      const title = str(r.get("Title"));
      const kind = key(r.get("Kind")) as Kind;
      const label = `${vendorName || "(no vendor)"} · ${title || "(no title)"}`;
      const k = vendorName.toLowerCase();
      const existingVendor = vendorName ? await vendorRepo.findByName(tx, vendorName) : undefined;
      const vendorId = existingVendor?.id ?? vendorIds.get(k);
      if (!vendorName) problems.push("Vendor name is required.");
      else if (!existingVendor && !newVendors.has(k)) problems.push(`Vendor "${vendorName}" is not in the app and not a valid row on the Vendors sheet.`);
      if (!kinds.includes(kind)) problems.push("Kind: use MSA, SOW, Subscription, NDA or DPA.");
      const parentTitle = str(r.get("Parent MSA title"));
      const draft = {
        vendorId: vendorId ?? "00000000-0000-4000-8000-000000000000",
        kind,
        title,
        reference: str(r.get("Reference")),
        status: key(r.get("Status")) || undefined,
        ownerUserId: owner(r.get("Owner email"), problems),
        currency: str(r.get("Currency")).toUpperCase() || undefined,
        signedOn: toDay(r.get("Signed on"), problems, "Signed on"),
        startDate: toDay(r.get("Start date"), problems, "Start date"),
        endDate: toDay(r.get("End date"), problems, "End date"),
        pricing: key(r.get("Pricing")) || null,
        budgetMinor: toMinor(r.get("Budget"), problems, "Budget"),
        annualValueMinor: toMinor(r.get("Annual value"), problems, "Annual value"),
        noticePeriodDays: toInt(r.get("Notice period days"), problems, "Notice period days"),
        autoRenews: toBool(r.get("Auto renews"), problems, "Auto renews") ?? null,
        renewalTermMonths: toInt(r.get("Renewal term months"), problems, "Renewal term months"),
        notes: str(r.get("Notes")),
      };
      const parsed = kinds.includes(kind) ? agreementSchema.safeParse(draft) : null;
      let input: AgreementInput | undefined;
      if (parsed && !parsed.success) problems.push(...issues(parsed.error));
      if (parsed?.success) {
        const checked = checkAgreement(parsed.data);
        problems.push(...Object.values(checked.errors));
        input = checked.value;
      }
      const dup = `${k}|${kind}|${title.toLowerCase()}`;
      if (title && seenAgreements.has(dup)) problems.push("This agreement appears more than once in the file.");
      seenAgreements.add(dup);
      const exists = existingVendor && title && kinds.includes(kind) ? await agreementRepo.findSame(tx, existingVendor.id, kind, title) : undefined;
      const row: ImportRow = { sheet: "Agreements", row: r.row, label, outcome: problems.length ? "invalid" : exists ? "exists" : "add", problems };
      rows.push(row);
      if (row.outcome === "add" && input) pending.push({ input, parentTitle, row });
    }

    // Parent MSAs are looked up after every row is known, so a SOW may come before its MSA in the file.
    const parentOf = async (p: (typeof pending)[number], q: Queryable) => {
      if (!p.parentTitle || p.input.kind !== "sow") return null;
      const inFile = pending.some(
        (o) => o.input.kind === "msa" && o.input.vendorId === p.input.vendorId && o.input.title.toLowerCase() === p.parentTitle.toLowerCase() && o.row.outcome === "add",
      );
      const found = apply || !inFile ? await agreementRepo.findSame(q, p.input.vendorId, "msa", p.parentTitle) : undefined;
      if (!found && !inFile) {
        p.row.outcome = "invalid";
        p.row.problems.push(`Parent MSA title: no MSA called "${p.parentTitle}" for this vendor.`);
      }
      return found?.id ?? null;
    };
    for (const p of pending) if (!apply) await parentOf(p, tx);
    if (apply) {
      const order = [...pending].sort((a, b) => Number(b.input.kind === "msa") - Number(a.input.kind === "msa"));
      for (const p of order) {
        const parentMsaId = await parentOf(p, tx);
        if (p.row.outcome === "add") await createAgreement(tx as unknown as Db, { ...p.input, parentMsaId }, by, today, "import");
      }
    }

    const counts = { add: 0, exists: 0, invalid: 0 };
    for (const r of rows) counts[r.outcome]++;
    return { rows, counts, applied: apply };
  });
}
