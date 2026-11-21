import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { agreementSchema, checkAgreement, kinds, type AgreementInput, type Kind } from "../../../shared/agreements";
import { isDay, type Day } from "../../../shared/dates";
import { parseAmount } from "../../../shared/money";
import type { User } from "../../../shared/types";
import { cleanName, vendorSchema, type VendorInput } from "../../../shared/vendors";
import { AppError } from "../../platform/errors";
import type { Db } from "../../platform/ports/types";
import { createAgreement, findSameAgreement } from "../agreements/service";
import { createVendor, findVendorByName, listPeople } from "../vendors/service";

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

/** Which column a field's problem belongs to, and how to say what is allowed there. */
const columnOf: Record<string, string> = {
  name: "Name",
  type: "Type",
  status: "Status",
  ownerUserId: "Owner email",
  legalName: "Legal name",
  website: "Website",
  country: "Country",
  description: "Description",
  title: "Title",
  reference: "Reference",
  currency: "Currency",
  signedOn: "Signed on",
  startDate: "Start date",
  endDate: "End date",
  endReason: "Status",
  pricing: "Pricing",
  budgetMinor: "Budget",
  annualValueMinor: "Annual value",
  noticePeriodDays: "Notice period days",
  renewalTermMonths: "Renewal term months",
  notes: "Notes",
  parentMsaId: "Parent MSA title",
  kind: "Kind",
};
const allowed: Record<string, string> = {
  type: "software, consultancy or advisory",
  currency: "EUR or GBP",
  pricing: "fixed or time_and_materials",
  noticePeriodDays: "a number of days from 0 to 730",
  renewalTermMonths: "a number of months from 1 to 120",
};

const EXAMPLE = "(delete this row)";
const MAX_ROWS = 2000;
/** An Excel file is a ZIP; refuse one that would unpack to more than this, before unpacking it. */
const MAX_UNPACKED_BYTES = 60 * 1024 * 1024;

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
    [`Example Vendor ${EXAMPLE}`, "software", "active", "", "Example Vendor B.V.", "https://example.test", "NL", "yes", "yes", "yes", ""],
    [
      "One row per vendor. Name and Type are required. Delete the grey example row.",
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
    [`Example Vendor ${EXAMPLE}`, "SOW", "SOW 01 Example project", "", "active", "", "EUR", "2026-01-15", "2026-02-01", "2026-12-31", "", "fixed", "120000", "", "", "", "", ""],
    [
      "One row per agreement. Vendor name, Kind and Title are required. Delete the grey example row.",
      "Vendor name must match a vendor in the app or on the Vendors sheet.",
      "Kind: MSA, SOW, Subscription, NDA or DPA.",
      "Status: draft, in_negotiation, out_for_signature, active or ended. Empty means draft.",
      "Dates: as an Excel date, or typed as 2026-12-31 or 31-12-2026.",
      "Amounts: a number with at most two decimals, such as 12500 or 12500.50.",
      "SOW: needs Start date, End date, Pricing (fixed or time_and_materials) and Budget. Parent MSA title is optional.",
      "Subscription: needs End date (the renewal date), Annual value and Auto renews (yes or no). Notice period days defaults to 90.",
      "NDA and DPA: need Signed on once active. End date is the valid-until date and may be empty.",
      "MSA: has no end date.",
      "An agreement with the same vendor, kind and title as one already in the app is left as it is.",
    ],
  );
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Marks a cell whose formula failed (#N/A, #REF! and so on), so it is reported instead of read as empty. */
class CellError {
  constructor(public code: string) {}
}

/** The plain value of a cell: formulas give their result, rich text its text. */
function unwrap(v: unknown): unknown {
  if (v == null || v instanceof Date || typeof v !== "object") return v;
  const o = v as { error?: unknown; formula?: unknown; sharedFormula?: unknown; result?: unknown; text?: unknown; richText?: { text: string }[] };
  if (o.error) return new CellError(String(o.error));
  if (o.richText) return o.richText.map((t) => t.text).join("");
  if ("formula" in o || "sharedFormula" in o) return o.result === undefined ? new CellError("a formula without a result") : unwrap(o.result);
  return o.text ?? "";
}
const str = (raw: unknown): string => {
  const v = unwrap(raw);
  if (v == null || v instanceof CellError) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
};

/** Readers for one row. Each reports its own problem, naming the column. */
function readers(problems: string[]) {
  const failed = (raw: unknown, column: string) => {
    const v = unwrap(raw);
    if (v instanceof CellError) problems.push(`${column}: the cell shows an error (${v.code}). Type the value in.`);
    return v instanceof CellError;
  };
  return {
    text(raw: unknown, column: string): string {
      return failed(raw, column) ? "" : str(raw);
    },
    day(raw: unknown, column: string): Day | null {
      if (failed(raw, column)) return null;
      const s = str(raw);
      if (!s) return null;
      const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
      const day = dmy ? `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}` : s;
      if (isDay(day)) return day;
      problems.push(`${column}: "${s}" is not a date. Use 2026-12-31 or 31-12-2026.`);
      return null;
    },
    amount(raw: unknown, column: string): number | null {
      if (failed(raw, column)) return null;
      const v = unwrap(raw);
      if (v == null || str(v) === "") return null;
      let minor: number | null;
      if (typeof v === "number") {
        // A number cell is exact; anything finer than a cent is a mistake, not something to round away.
        const cents = Math.round(v * 100);
        minor = v >= 0 && Math.abs(v * 100 - cents) < 1e-6 && Number.isSafeInteger(cents) ? cents : null;
      } else minor = parseAmount(str(v));
      if (minor == null) problems.push(`${column}: "${str(v)}" is not an amount with at most two decimals.`);
      return minor;
    },
    yesNo(raw: unknown, column: string): boolean | undefined {
      if (failed(raw, column)) return undefined;
      const s = str(raw).toLowerCase();
      if (!s) return undefined;
      if (["yes", "y", "true", "1"].includes(s)) return true;
      if (["no", "n", "false", "0"].includes(s)) return false;
      problems.push(`${column}: write yes or no.`);
      return undefined;
    },
    whole(raw: unknown, column: string): number | null {
      if (failed(raw, column)) return null;
      const s = str(raw);
      if (!s) return null;
      if (/^\d+$/.test(s)) return Number(s);
      problems.push(`${column}: "${s}" is not a whole number.`);
      return null;
    },
  };
}
const key = (text: string) => text.toLowerCase().replace(/[\s-]+/g, "_");

/** Validation problems in plain words, each naming its column. */
function plain(error: { issues: { path: PropertyKey[]; message: string; code?: string }[] }, statuses: string): string[] {
  return error.issues.map((i) => {
    const field = String(i.path[0] ?? "");
    const column = columnOf[field] ?? field;
    if (field === "status") return `Status: use one of ${statuses}.`;
    if (i.code === "invalid_value" || i.code === "invalid_type") return allowed[field] ? `${column}: use ${allowed[field]}.` : `${column}: that value is not allowed here.`;
    if (i.code === "too_big" && !allowed[field]) return `${column}: that is too long.`;
    if (allowed[field] && (i.code === "too_big" || i.code === "too_small")) return `${column}: use ${allowed[field]}.`;
    return `${column}: ${i.message}`;
  });
}
const fieldProblems = (errors: Record<string, string>) => Object.entries(errors).map(([field, message]) => `${columnOf[field] ?? field}: ${message}`);

/** Adds up the unpacked sizes a ZIP declares for its files, without unpacking anything. */
function unpackedSize(zip: Buffer): number {
  let total = 0;
  for (let i = zip.indexOf("PK\x01\x02", 0, "latin1"); i >= 0 && i + 28 <= zip.length; i = zip.indexOf("PK\x01\x02", i + 4, "latin1")) total += zip.readUInt32LE(i + 24);
  return total;
}

async function read(buffer: Buffer) {
  if (buffer.length > 10 * 1024 * 1024 || unpackedSize(buffer) > MAX_UNPACKED_BYTES)
    throw new AppError(413, "workbook_too_large", "That workbook is too large to import. Keep it to the template's two sheets.");
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
    if (ws.actualRowCount > MAX_ROWS + 1) throw new AppError(400, "too_many_rows", `The "${name}" sheet has more than 2,000 rows.`);
    const rows: { row: number; get: (c: string) => unknown }[] = [];
    ws.eachRow((r, n) => {
      const values = r.values as unknown[];
      if (n === 1 || !Array.from(values, str).some(Boolean)) return;
      rows.push({ row: n, get: (c) => values[index[c]!] });
    });
    return rows;
  };
  return { vendors: sheet("Vendors", vendorColumns), agreements: sheet("Agreements", agreementColumns) };
}

const VENDOR_STATUSES = "prospect, active, on_hold or offboarded";
const AGREEMENT_STATUSES = "draft, in_negotiation, out_for_signature, active or ended";
const EXAMPLE_ROW = "This is the template's example row. Delete it.";
const OFFBOARDED = "This vendor is offboarded and cannot receive new agreements.";

/**
 * Reads the workbook and works out what each row would do. With `apply`, the valid new
 * rows are created, all or nothing. Rows already in the app are left alone, so importing
 * the same file twice adds nothing the second time. Preview and apply run the same
 * analysis; apply only adds the writing.
 */
export async function importWorkbook(db: Db, buffer: Buffer, by: User, today: Day, apply: boolean): Promise<ImportResult> {
  const book = await read(buffer);
  return db.transaction(async (tx) => {
    // One import at a time, so two cannot both decide the same row is new.
    await tx.execute(sql`select pg_advisory_xact_lock(4202)`);
    const people = new Map((await listPeople(tx as unknown as Db)).map((u) => [u.email, u.id]));
    const rows: ImportRow[] = [];

    // ---- Vendors
    const count = new Map<string, number>();
    for (const r of book.vendors) {
      const k = cleanName(str(r.get("Name"))).toLowerCase();
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    /** Vendors this file will add, by lower-case name. Each gets an id of its own up front, so preview and apply see the same thing. */
    const newVendors = new Map<string, { id: string; input: VendorInput }>();
    for (const r of book.vendors) {
      const problems: string[] = [];
      const cell = readers(problems);
      const name = cleanName(cell.text(r.get("Name"), "Name"));
      const k = name.toLowerCase();
      const row: ImportRow = { sheet: "Vendors", row: r.row, label: name || "(no name)", outcome: "invalid", problems };
      rows.push(row);
      if (name.includes(EXAMPLE)) {
        problems.push(EXAMPLE_ROW);
        continue;
      }
      const ownerEmail = cell.text(r.get("Owner email"), "Owner email").toLowerCase();
      if (ownerEmail && !people.has(ownerEmail)) problems.push(`Owner email: ${ownerEmail} has not opened the app, or no longer has access.`);
      const parsed = vendorSchema.safeParse({
        name,
        type: key(cell.text(r.get("Type"), "Type")),
        status: key(cell.text(r.get("Status"), "Status")) || undefined,
        ownerUserId: people.get(ownerEmail) ?? by.id,
        legalName: cell.text(r.get("Legal name"), "Legal name"),
        website: cell.text(r.get("Website"), "Website"),
        country: cell.text(r.get("Country"), "Country"),
        ndaRequired: cell.yesNo(r.get("NDA required"), "NDA required"),
        dpaRequired: cell.yesNo(r.get("DPA required"), "DPA required"),
        scoringEnabled: cell.yesNo(r.get("Scored"), "Scored"),
        description: cell.text(r.get("Description"), "Description"),
      });
      if (!parsed.success) problems.push(...plain(parsed.error, VENDOR_STATUSES));
      if (name && count.get(k)! > 1) problems.push("This vendor appears more than once in the file.");
      if (problems.length) continue;
      if (await findVendorByName(tx, name)) row.outcome = "exists";
      else {
        row.outcome = "add";
        newVendors.set(k, { id: randomUUID(), input: parsed.data! });
      }
    }
    if (apply) for (const v of newVendors.values()) v.id = (await createVendor(tx as unknown as Db, v.input, by, today, "import")).id;

    // ---- Agreements, first pass: read and check each row on its own
    const seen = new Map<string, number>();
    const dupKey = (r: (typeof book.agreements)[number]) => `${cleanName(str(r.get("Vendor name"))).toLowerCase()}|${key(str(r.get("Kind")))}|${str(r.get("Title")).toLowerCase()}`;
    for (const r of book.agreements) seen.set(dupKey(r), (seen.get(dupKey(r)) ?? 0) + 1);

    const pending: { input: AgreementInput; parentTitle: string; row: ImportRow }[] = [];
    for (const r of book.agreements) {
      const problems: string[] = [];
      const cell = readers(problems);
      const vendorName = cleanName(cell.text(r.get("Vendor name"), "Vendor name"));
      const title = cell.text(r.get("Title"), "Title");
      const kind = key(cell.text(r.get("Kind"), "Kind")) as Kind;
      const row: ImportRow = { sheet: "Agreements", row: r.row, label: `${vendorName || "(no vendor)"} · ${title || "(no title)"}`, outcome: "invalid", problems };
      rows.push(row);
      if (vendorName.includes(EXAMPLE)) {
        problems.push(EXAMPLE_ROW);
        continue;
      }
      const k = vendorName.toLowerCase();
      const existingVendor = vendorName ? await findVendorByName(tx, vendorName) : undefined;
      const fromFile = newVendors.get(k);
      if (!vendorName) problems.push("Vendor name: this is required.");
      else if (!existingVendor && !fromFile) problems.push(`Vendor name: "${vendorName}" is not in the app and not a valid row on the Vendors sheet.`);
      else if ((existingVendor?.status ?? fromFile!.input.status) === "offboarded") problems.push(`Vendor name: ${OFFBOARDED}`);
      const kindOk = kinds.includes(kind);
      if (!kindOk) problems.push("Kind: use MSA, SOW, Subscription, NDA or DPA.");
      const ownerEmail = cell.text(r.get("Owner email"), "Owner email").toLowerCase();
      if (ownerEmail && !people.has(ownerEmail)) problems.push(`Owner email: ${ownerEmail} has not opened the app, or no longer has access.`);
      const parentTitle = cell.text(r.get("Parent MSA title"), "Parent MSA title");
      if (parentTitle && kindOk && kind !== "sow") problems.push("Parent MSA title: only a SOW can sit under an MSA.");
      const autoRenews = cell.yesNo(r.get("Auto renews"), "Auto renews");
      if (kind === "subscription" && autoRenews === undefined && !problems.some((p) => p.startsWith("Auto renews")))
        problems.push("Auto renews: write yes or no for a subscription.");
      const draft = {
        vendorId: existingVendor?.id ?? fromFile?.id ?? randomUUID(),
        kind,
        title,
        reference: cell.text(r.get("Reference"), "Reference"),
        status: key(cell.text(r.get("Status"), "Status")) || undefined,
        ownerUserId: people.get(ownerEmail) ?? by.id,
        currency: cell.text(r.get("Currency"), "Currency").toUpperCase() || undefined,
        signedOn: cell.day(r.get("Signed on"), "Signed on"),
        startDate: cell.day(r.get("Start date"), "Start date"),
        endDate: cell.day(r.get("End date"), "End date"),
        pricing: key(cell.text(r.get("Pricing"), "Pricing")) || null,
        budgetMinor: cell.amount(r.get("Budget"), "Budget"),
        annualValueMinor: cell.amount(r.get("Annual value"), "Annual value"),
        noticePeriodDays: cell.whole(r.get("Notice period days"), "Notice period days"),
        autoRenews: autoRenews ?? null,
        renewalTermMonths: cell.whole(r.get("Renewal term months"), "Renewal term months"),
        notes: cell.text(r.get("Notes"), "Notes"),
      };
      let input: AgreementInput | undefined;
      if (kindOk) {
        const parsed = agreementSchema.safeParse(draft);
        if (!parsed.success) problems.push(...plain(parsed.error, AGREEMENT_STATUSES));
        else {
          const checked = checkAgreement(parsed.data);
          // A problem already reported for a column (a bad date, say) is not repeated as "missing".
          problems.push(...fieldProblems(checked.errors).filter((p) => !problems.some((q) => q.startsWith(p.split(":")[0]!))));
          input = checked.value;
        }
      }
      if (title && seen.get(dupKey(r))! > 1) problems.push("This agreement appears more than once in the file.");
      if (problems.length || !input) continue;
      if (existingVendor && (await findSameAgreement(tx, existingVendor.id, kind, title))) row.outcome = "exists";
      else {
        row.outcome = "add";
        pending.push({ input, parentTitle, row });
      }
    }

    // ---- Second pass: parent MSAs, once every row is known, so a SOW may come before its MSA in the file
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    const parents = new Map<(typeof pending)[number], { inFile?: (typeof pending)[number]; existingId?: string }>();
    for (const p of pending) {
      if (!p.parentTitle) continue;
      const inFile = pending.find((o) => o.input.kind === "msa" && o.input.vendorId === p.input.vendorId && same(o.input.title, p.parentTitle));
      const existing = inFile ? undefined : await findSameAgreement(tx, p.input.vendorId, "msa", p.parentTitle);
      if (!inFile && !existing) {
        p.row.outcome = "invalid";
        p.row.problems.push(`Parent MSA title: no MSA called "${p.parentTitle}" for this vendor.`);
      } else parents.set(p, { inFile, existingId: existing?.id });
    }

    if (apply) {
      const created = new Map<(typeof pending)[number], string>();
      const todo = pending.filter((p) => p.row.outcome === "add").sort((a, b) => Number(b.input.kind === "msa") - Number(a.input.kind === "msa"));
      for (const p of todo) {
        const parent = parents.get(p);
        const parentMsaId = parent?.existingId ?? (parent?.inFile ? created.get(parent.inFile) : undefined) ?? null;
        created.set(p, (await createAgreement(tx as unknown as Db, { ...p.input, parentMsaId }, by, today, "import")).id);
      }
    }

    rows.sort((a, b) => (a.sheet === b.sheet ? a.row - b.row : a.sheet === "Vendors" ? -1 : 1));
    const counts = { add: 0, exists: 0, invalid: 0 };
    for (const r of rows) counts[r.outcome]++;
    return { rows, counts, applied: apply };
  });
}
