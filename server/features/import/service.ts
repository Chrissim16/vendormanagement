import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { ZodError } from "zod";
import { agreements, invoices, milestones, rateCardLines } from "../../../db/schema";
import { agreementSchema, checkAgreement, kinds, type AgreementInput, type Kind } from "../../../shared/agreements";
import { isDay, type Day } from "../../../shared/dates";
import { parseAmount, typedCurrency } from "../../../shared/money";
import type { User } from "../../../shared/types";
import { cleanName, cleanVat, contactSchema, vendorSchema, type VendorInput } from "../../../shared/vendors";
import { rateLineSchema } from "../../../shared/sow";
import { AppError } from "../../platform/errors";
import type { Db } from "../../platform/ports/types";
import { unpacksWithin } from "../../platform/zip";
import { createAgreement, findSameAgreement } from "../agreements/service";
import { listCurrencies } from "../settings/service";
import { saveInvoice } from "../invoices/service";
import { saveRateLine } from "../sow/service";
import { contactsOf, createVendor, findVendorByName, findVendorByVat, listPeople, saveContact } from "../vendors/service";

const vendorColumns = [
  "Name",
  "Type",
  "Status",
  "Owner email",
  "Legal name",
  "Website",
  "Street",
  "Second street line",
  "Postal code",
  "City",
  "Country",
  "VAT or tax number",
  "NDA required",
  "DPA required",
  "Scored",
  "Description",
] as const;
/** Columns added after the first template (V-5): a workbook made from the older template is still accepted without them. */
const laterVendorColumns = ["Street", "Second street line", "Postal code", "City", "VAT or tax number"];
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

/** M13: contacts (A-8), day rates and past invoices (M-9). */
const contactColumns = ["Vendor name", "Name", "Email", "Phone", "Roles", "Primary"] as const;
const rateColumns = ["Vendor name", "Role", "Day rate", "Currency", "Valid from"] as const;
const invoiceColumns = ["Vendor name", "Agreement title", "Invoice number", "Invoice date", "Amount", "Milestone title", "Description"] as const;

/** The sheets in the order they are saved, so each can name what the ones before it add. */
export const SHEETS = ["Vendors", "Contacts", "Agreements", "Day rates", "Invoices"] as const;
export type SheetName = (typeof SHEETS)[number];
const columnsOfSheet: Record<SheetName, readonly string[]> = {
  Vendors: vendorColumns,
  Contacts: contactColumns,
  Agreements: agreementColumns,
  "Day rates": rateColumns,
  Invoices: invoiceColumns,
};
/** Where a field's problem goes on each of the later sheets. */
const columnsBySheet: Partial<Record<SheetName, Record<string, string>>> = {
  Contacts: { name: "Name", email: "Email", phone: "Phone", roles: "Roles", isPrimary: "Primary" },
  "Day rates": { role: "Role", dayRateMinor: "Day rate", currency: "Currency", validFrom: "Valid from" },
  Invoices: {
    agreementId: "Agreement title",
    milestoneId: "Milestone title",
    invoiceNumber: "Invoice number",
    invoiceDate: "Invoice date",
    amountMinor: "Amount",
    description: "Description",
  },
};

/** Which column a field's problem belongs to, and how to say what is allowed there. */
const columnOf: Record<string, string> = {
  name: "Name",
  type: "Type",
  status: "Status",
  ownerUserId: "Owner email",
  legalName: "Legal name",
  website: "Website",
  addressLine1: "Street",
  addressLine2: "Second street line",
  postalCode: "Postal code",
  city: "City",
  country: "Country",
  vatNumber: "VAT or tax number",
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
  pricing: "fixed or time_and_materials",
  noticePeriodDays: "a number of days from 0 to 730",
  renewalTermMonths: "a number of months from 1 to 120",
};

/** A currency cell: empty means euros; anything else must be a currency on the app's list (M-8). */
function currencyCell(text: string, listed: string[], problems: string[]): string | undefined {
  const code = text.trim().toUpperCase();
  if (!code) return undefined;
  if (listed.includes(code)) return code;
  problems.push(`Currency: ${code} is not on the app's list of currencies. Use ${listed.join(", ")}, or ask an admin to add it in Settings.`);
  return undefined;
}

const EXAMPLE = "(delete this row)";
const MAX_ROWS = 2000;
/** An Excel file is a ZIP; refuse one that would unpack to more than this, before unpacking it. */
const MAX_UNPACKED_BYTES = 60 * 1024 * 1024;

export interface ImportRow {
  sheet: SheetName;
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
  return Buffer.from(await templateBook(true).xlsx.writeBuffer());
}

/** The template's workbook; without the example rows for the file of rows to fix. */
function templateBook(examples: boolean): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const sheet = (name: SheetName, columns: readonly string[], example: (string | number)[], notes: string[]) => {
    const ws = wb.addWorksheet(name);
    ws.addRow([...columns]).font = { bold: true };
    if (examples) ws.addRow(example).font = { italic: true, color: { argb: "FF6A7285" } };
    ws.columns.forEach((c) => (c.width = 22));
    const help = wb.addWorksheet(`${name} help`);
    help.getColumn(1).width = 110;
    notes.forEach((n) => help.addRow([n]));
  };
  sheet(
    "Vendors",
    vendorColumns,
    [
      `Example Vendor ${EXAMPLE}`,
      "software",
      "active",
      "",
      "Example Vendor B.V.",
      "https://example.test",
      "Examplestraat 1",
      "",
      "1000 AA",
      "Amsterdam",
      "NL",
      "NL000000000B00",
      "yes",
      "yes",
      "yes",
      "",
    ],
    [
      "One row per vendor. Name and Type are required. Delete the grey example row.",
      "Type: software, consultancy or advisory.",
      "Status: prospect, active, on_hold or offboarded. Empty means active.",
      "Owner email: a colleague who has opened the app. Empty means you.",
      "NDA required, DPA required, Scored: yes or no. Empty means yes.",
      "Street, Second street line, Postal code, City, Country and VAT or tax number may be empty. Country is a two-letter code such as NL.",
      "A VAT or tax number may be held by one vendor only.",
      "A vendor whose name is already in the app is left as it is.",
    ],
  );
  sheet(
    "Contacts",
    contactColumns,
    [`Example Vendor ${EXAMPLE}`, "Sam Example", "sam@example.test", "+31 20 000 0000", "Account Manager; Billing / Finance", "yes"],
    [
      "One row per contact. Vendor name and Name are required. Delete the grey example row.",
      "Vendor name must match a vendor in the app or on the Vendors sheet.",
      "Roles: as many as apply, separated by semicolons, such as Account Manager; Helpdesk. A role that is not on the app's list is added to it, as when typing it on a contact.",
      "Primary: yes for the vendor's main contact, at most one per vendor. Empty means no. A vendor that already has a main contact keeps it.",
      "A contact already in the app is left as it is: the same vendor and email, or the same vendor and name when there is no email.",
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
      "Currency: the three-letter code of a currency on the app's list (an admin keeps it under Settings), such as EUR, GBP, USD, SEK, NOK or DKK. Empty means EUR.",
      "Amounts: a number with at most two decimals, such as 12500 or 12500.50, in the row's currency.",
      "SOW: needs Start date, End date, Pricing (fixed or time_and_materials) and Budget. Parent MSA title is optional.",
      "Subscription: needs End date (the renewal date), Annual value and Auto renews (yes or no). Notice period days defaults to 90.",
      "NDA and DPA: need Signed on once active. End date is the valid-until date and may be empty.",
      "MSA: has no end date.",
      "An agreement with the same vendor, kind and title as one already in the app is left as it is.",
    ],
  );
  sheet(
    "Day rates",
    rateColumns,
    [`Example Vendor ${EXAMPLE}`, "Lead architect", "1250", "EUR", "2026-01-01"],
    [
      "One row per day rate. Every column is required except Currency. Delete the grey example row.",
      "Vendor name must match a vendor in the app or on the Vendors sheet.",
      "Day rate: an amount above zero with at most two decimals, in the row's currency. Currency: a code on the app's list; empty means EUR.",
      "Valid from: the first day the rate applies, as an Excel date or typed as 2026-12-31 or 31-12-2026.",
      "A rate already in the app for the same vendor, role and valid-from date is left as it is.",
    ],
  );
  sheet(
    "Invoices",
    invoiceColumns,
    [`Example Vendor ${EXAMPLE}`, "SOW 01 Example project", "INV-0001", "2026-03-31", "12500", "", ""],
    [
      "One row per invoice. Vendor name, Agreement title, Invoice number, Invoice date and Amount are required. Delete the grey example row.",
      "Agreement title: a SOW or subscription of that vendor, in the app or on the Agreements sheet.",
      "The invoice is in the agreement's currency. Write the amount without a currency, or with the agreement's own.",
      "Milestone title: optional, a milestone of that SOW already in the app.",
      "The same rules apply as when typing an invoice in: the date may not be in the future, and an invoice number may be used once per vendor.",
      "An invoice already in the app with the same vendor and invoice number is left as it is.",
    ],
  );
  return wb;
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
    /** An amount in the row's currency: "SEK 285,000" in a euro row is refused, never read as euros. */
    amount(raw: unknown, column: string, currency = "EUR"): number | null {
      if (failed(raw, column)) return null;
      const v = unwrap(raw);
      if (v == null || str(v) === "") return null;
      let minor: number | null;
      if (typeof v === "number") {
        // A number cell is exact; anything finer than a cent is a mistake, not something to round away.
        const cents = Math.round(v * 100);
        minor = v >= 0 && Math.abs(v * 100 - cents) < 1e-6 && Number.isSafeInteger(cents) ? cents : null;
      } else {
        const typed = typedCurrency(str(v));
        if (typed && typed !== currency) {
          problems.push(`${column}: "${str(v)}" is in ${typed}, but the agreement is in ${currency}. Put ${typed} in the Currency column, or write the amount without a currency.`);
          return null;
        }
        minor = parseAmount(str(v), currency);
      }
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

export { unpacksWithin };

/** Opens an uploaded workbook, refusing one that is too large or that unpacks into far more than it seems. For other features too. */
export async function loadWorkbook(buffer: Buffer, hint: { tooLarge: string; unreadable: string }): Promise<ExcelJS.Workbook> {
  if (buffer.length > 10 * 1024 * 1024 || unpackedSize(buffer) > MAX_UNPACKED_BYTES || !unpacksWithin(buffer, MAX_UNPACKED_BYTES))
    throw new AppError(413, "workbook_too_large", hint.tooLarge);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new AppError(400, "not_a_workbook", hint.unreadable);
  }
  return wb;
}

/** The text of a cell as a person sees it: a formula gives its result, rich text its text. */
export const cellText = (raw: unknown): string => str(raw);

export type SheetRow = { row: number; get: (c: string) => unknown };
export type Book = Record<SheetName, SheetRow[]>;

async function read(buffer: Buffer): Promise<Book> {
  const wb = await loadWorkbook(buffer, {
    tooLarge: "That workbook is too large to import. Keep it to the template's sheets.",
    unreadable: "That file could not be read as an Excel workbook. Use the template.",
  });
  if (!SHEETS.some((n) => wb.getWorksheet(n)))
    throw new AppError(400, "sheet_missing", `The workbook has none of the template's sheets (${SHEETS.join(", ")}). Use the template.`);
  // Q123: any sheet may be left out or left empty.
  const sheet = (name: SheetName, later: string[] = []): SheetRow[] => {
    const ws = wb.getWorksheet(name);
    if (!ws) return [];
    const columns = columnsOfSheet[name];
    // The row comes back with gaps for empty cells; Array.from fills them so every position is a string.
    const header = Array.from(ws.getRow(1).values as unknown[], str);
    const index = Object.fromEntries(columns.map((c) => [c, header.findIndex((h) => h.toLowerCase() === c.toLowerCase())])) as Record<string, number>;
    const missing = columns.filter((c) => index[c]! < 0 && !later.includes(c));
    if (missing.length)
      throw new AppError(400, "columns_missing", `The "${name}" sheet is missing the column${missing.length > 1 ? "s" : ""} ${missing.join(", ")}. Use the template.`);
    if (ws.actualRowCount > MAX_ROWS + 1) throw new AppError(400, "too_many_rows", `The "${name}" sheet has more than 2,000 rows.`);
    const rows: SheetRow[] = [];
    ws.eachRow((r, n) => {
      const values = r.values as unknown[];
      if (n === 1 || !Array.from(values, str).some(Boolean)) return;
      rows.push({ row: n, get: (c) => (index[c]! < 0 ? undefined : values[index[c]!]) });
    });
    return rows;
  };
  return {
    Vendors: sheet("Vendors", laterVendorColumns),
    Contacts: sheet("Contacts"),
    Agreements: sheet("Agreements"),
    "Day rates": sheet("Day rates"),
    Invoices: sheet("Invoices"),
  };
}

const VENDOR_STATUSES = "prospect, active, on_hold or offboarded";
const AGREEMENT_STATUSES = "draft, in_negotiation, out_for_signature, active or ended";
const EXAMPLE_ROW = "This is the template's example row. Delete it.";
const OFFBOARDED = "This vendor is offboarded and cannot receive new agreements.";

/** A person's name for matching: capitals and repeated spaces do not count. */
const personKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
/** A date cell as a day for matching, however it was written; the text itself when it is not a date. */
function dayKey(raw: unknown): string {
  const problems: string[] = [];
  return readers(problems).day(raw, "") ?? str(raw);
}

/** Thrown at the end of a preview to undo everything it saved, carrying what it found. */
class Preview extends Error {
  constructor(public result: ImportResult) {
    super("preview");
  }
}

/**
 * Saves one row through the app's own save for that record, in a savepoint: a refusal
 * becomes the row's problems, in the words the form would use, and undoes only that row.
 */
async function attempt(row: ImportRow, save: () => Promise<unknown>) {
  const columns = columnsBySheet[row.sheet] ?? columnOf;
  try {
    await save();
    row.outcome = "add";
  } catch (e) {
    row.outcome = "invalid";
    if (e instanceof AppError && e.status < 500)
      row.problems.push(...(e.fields && Object.keys(e.fields).length ? Object.entries(e.fields).map(([f, m]) => `${columns[f] ?? f}: ${m}`) : [e.message]));
    else if (e instanceof ZodError) row.problems.push(...plain(e, "").map((p) => p.replace(/^(\w+):/, (m, f: string) => `${columns[f] ?? f}:`)));
    else throw e;
  }
}

/** How many times each key appears, so a row that is in the file twice is a problem for every copy. */
function counted<T>(rows: T[], keyOf: (r: T) => string) {
  const n = new Map<string, number>();
  for (const r of rows) n.set(keyOf(r), (n.get(keyOf(r)) ?? 0) + 1);
  return (r: T) => (n.get(keyOf(r)) ?? 0) > 1;
}

/**
 * Reads the workbook and works out what each row would do, in the order of the sheets.
 * Every good row is saved through the app's own save for that record, so the rules are the
 * form's; rows already in the app are left alone, so importing the same file twice adds
 * nothing the second time. A preview does exactly the same and then undoes it all, so the
 * preview and the import always agree.
 */
export async function importWorkbook(db: Db, buffer: Buffer, by: User, today: Day, apply: boolean): Promise<ImportResult> {
  return analyse(db, await read(buffer), by, today, apply);
}

async function analyse(db: Db, book: Book, by: User, today: Day, apply: boolean): Promise<ImportResult> {
  try {
    return await analyseIn(db, book, by, today, apply);
  } catch (e) {
    if (e instanceof Preview) return e.result;
    throw e;
  }
}

function analyseIn(db: Db, book: Book, by: User, today: Day, apply: boolean): Promise<ImportResult> {
  return db.transaction(async (tx) => {
    // One import at a time, so two cannot both decide the same row is new.
    await tx.execute(sql`select pg_advisory_xact_lock(4202)`);
    const people = new Map((await listPeople(tx as unknown as Db)).map((u) => [u.email, u.id]));
    const listed = (await listCurrencies(tx)).map((c) => c.code);
    const rows: ImportRow[] = [];

    // ---- Vendors
    const count = new Map<string, number>();
    for (const r of book.Vendors) {
      const k = cleanName(str(r.get("Name"))).toLowerCase();
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    const vatCount = new Map<string, number>();
    for (const r of book.Vendors) {
      const vat = cleanVat(str(r.get("VAT or tax number")).trim());
      if (vat) vatCount.set(vat, (vatCount.get(vat) ?? 0) + 1);
    }
    /** Vendors this file will add, by lower-case name. Each gets an id of its own up front, so preview and apply see the same thing. */
    const newVendors = new Map<string, { id: string; input: VendorInput; row: ImportRow }>();
    for (const r of book.Vendors) {
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
        addressLine1: cell.text(r.get("Street"), "Street"),
        addressLine2: cell.text(r.get("Second street line"), "Second street line"),
        postalCode: cell.text(r.get("Postal code"), "Postal code"),
        city: cell.text(r.get("City"), "City"),
        country: cell.text(r.get("Country"), "Country"),
        vatNumber: cell.text(r.get("VAT or tax number"), "VAT or tax number"),
        ndaRequired: cell.yesNo(r.get("NDA required"), "NDA required"),
        dpaRequired: cell.yesNo(r.get("DPA required"), "DPA required"),
        scoringEnabled: cell.yesNo(r.get("Scored"), "Scored"),
        description: cell.text(r.get("Description"), "Description"),
      });
      if (!parsed.success) problems.push(...plain(parsed.error, VENDOR_STATUSES));
      if (name && count.get(k)! > 1) problems.push("This vendor appears more than once in the file.");
      const vat = parsed.success ? parsed.data.vatNumber : null;
      if (vat) {
        if ((vatCount.get(vat) ?? 0) > 1) problems.push("VAT or tax number: it appears on more than one row of the file.");
        const holder = await findVendorByVat(tx, vat);
        // A vendor already in the app that holds its own number is left alone below, as any existing vendor is.
        if (holder && holder.name.toLowerCase() !== k) problems.push(`VAT or tax number: ${holder.name} already has this number.`);
      }
      if (problems.length) continue;
      if (await findVendorByName(tx, name)) row.outcome = "exists";
      else {
        row.outcome = "add";
        newVendors.set(k, { id: randomUUID(), input: parsed.data!, row });
      }
    }
    for (const [k, v] of newVendors) {
      // A refusal the checks above did not foresee becomes the row's problem, and later sheets see the vendor as missing.
      await attempt(v.row, async () => (v.id = (await createVendor(tx as unknown as Db, v.input, by, today, "import")).id));
      if (v.row.outcome !== "add") newVendors.delete(k);
    }
    /** A vendor named on a later sheet: in the app (including those just added), or a reason it is not. */
    const vendorFor = async (name: string, problems: string[]) => {
      if (!name) {
        problems.push("Vendor name: this is required.");
        return undefined;
      }
      const found = await findVendorByName(tx, name);
      if (!found) problems.push(`Vendor name: "${name}" is not in the app and not a valid row on the Vendors sheet.`);
      return found;
    };

    // ---- Contacts (A-8): matched by vendor and email, or vendor and name without an email
    const contactKey = (r: SheetRow) => {
      const email = str(r.get("Email")).toLowerCase();
      return `${cleanName(str(r.get("Vendor name"))).toLowerCase()}|${email ? `@${email}` : personKey(str(r.get("Name")))}`;
    };
    const twiceContact = counted(book.Contacts, contactKey);
    const primaries = counted(
      book.Contacts.filter((r) => ["yes", "y", "true", "1"].includes(str(r.get("Primary")).toLowerCase())),
      (r) => cleanName(str(r.get("Vendor name"))).toLowerCase(),
    );
    for (const r of book.Contacts) {
      const problems: string[] = [];
      const cell = readers(problems);
      const vendorName = cleanName(cell.text(r.get("Vendor name"), "Vendor name"));
      const name = cell.text(r.get("Name"), "Name");
      const row: ImportRow = { sheet: "Contacts", row: r.row, label: `${vendorName || "(no vendor)"} · ${name || "(no name)"}`, outcome: "invalid", problems };
      rows.push(row);
      if (vendorName.includes(EXAMPLE)) {
        problems.push(EXAMPLE_ROW);
        continue;
      }
      const vendor = await vendorFor(vendorName, problems);
      const roles = cell
        .text(r.get("Roles"), "Roles")
        .split(";")
        .map((x) => x.trim())
        .filter(Boolean);
      const isPrimary = cell.yesNo(r.get("Primary"), "Primary") ?? false;
      const parsed = contactSchema.safeParse({ name, email: cell.text(r.get("Email"), "Email"), phone: cell.text(r.get("Phone"), "Phone"), roles, isPrimary });
      if (!parsed.success) problems.push(...plain(parsed.error, "").map((p) => p.replace(/^(\w+):/, (m, f: string) => `${columnsBySheet.Contacts![f] ?? f}:`)));
      if (name && twiceContact(r)) problems.push("This contact appears more than once in the file.");
      if (isPrimary && primaries(r)) problems.push("Primary: more than one contact of this vendor is marked as the main one.");
      if (problems.length || !vendor || !parsed.success) continue;
      const c = parsed.data;
      const existing = await contactsOf(tx, vendor.id);
      const same = existing.find((x) => (c.email ? x.email?.toLowerCase() === c.email.toLowerCase() : personKey(x.name) === personKey(c.name)));
      if (same) {
        row.outcome = "exists";
        continue;
      }
      const main = c.isPrimary && existing.find((x) => x.isPrimary);
      // The import never changes what is there, so it cannot take the main contact from someone.
      if (main) {
        problems.push(`Primary: ${main.name} is already the main contact. Leave Primary empty, or change the main contact in the app.`);
        continue;
      }
      await attempt(row, () => saveContact(tx as unknown as Db, { vendorId: vendor.id }, c, by, "import"));
    }

    // ---- Agreements, first pass: read and check each row on its own
    const seen = new Map<string, number>();
    const dupKey = (r: (typeof book.Agreements)[number]) => `${cleanName(str(r.get("Vendor name"))).toLowerCase()}|${key(str(r.get("Kind")))}|${str(r.get("Title")).toLowerCase()}`;
    for (const r of book.Agreements) seen.set(dupKey(r), (seen.get(dupKey(r)) ?? 0) + 1);

    const pending: { input: AgreementInput; parentTitle: string; row: ImportRow }[] = [];
    for (const r of book.Agreements) {
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
      const currency = currencyCell(cell.text(r.get("Currency"), "Currency"), listed, problems);
      const draft = {
        vendorId: existingVendor?.id ?? fromFile?.id ?? randomUUID(),
        kind,
        title,
        reference: cell.text(r.get("Reference"), "Reference"),
        status: key(cell.text(r.get("Status"), "Status")) || undefined,
        ownerUserId: people.get(ownerEmail) ?? by.id,
        currency,
        signedOn: cell.day(r.get("Signed on"), "Signed on"),
        startDate: cell.day(r.get("Start date"), "Start date"),
        endDate: cell.day(r.get("End date"), "End date"),
        pricing: key(cell.text(r.get("Pricing"), "Pricing")) || null,
        budgetMinor: cell.amount(r.get("Budget"), "Budget", currency),
        annualValueMinor: cell.amount(r.get("Annual value"), "Annual value", currency),
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

    {
      const created = new Map<(typeof pending)[number], string>();
      const todo = pending.filter((p) => p.row.outcome === "add").sort((a, b) => Number(b.input.kind === "msa") - Number(a.input.kind === "msa"));
      for (const p of todo) {
        const parent = parents.get(p);
        if (parent?.inFile && !created.has(parent.inFile)) {
          p.row.outcome = "invalid";
          p.row.problems.push(`Parent MSA title: the row for "${p.parentTitle}" has a problem, so this SOW cannot sit under it yet.`);
          continue;
        }
        const parentMsaId = parent?.existingId ?? (parent?.inFile ? created.get(parent.inFile) : undefined) ?? null;
        await attempt(p.row, async () => created.set(p, (await createAgreement(tx as unknown as Db, { ...p.input, parentMsaId }, by, today, "import")).id));
      }
    }

    // ---- Day rates (M-9): matched by vendor, role and valid-from
    const rateKey = (r: SheetRow) => `${cleanName(str(r.get("Vendor name"))).toLowerCase()}|${str(r.get("Role")).toLowerCase()}|${dayKey(r.get("Valid from"))}`;
    const twiceRate = counted(book["Day rates"], rateKey);
    for (const r of book["Day rates"]) {
      const problems: string[] = [];
      const cell = readers(problems);
      const vendorName = cleanName(cell.text(r.get("Vendor name"), "Vendor name"));
      const role = cell.text(r.get("Role"), "Role");
      const row: ImportRow = { sheet: "Day rates", row: r.row, label: `${vendorName || "(no vendor)"} · ${role || "(no role)"}`, outcome: "invalid", problems };
      rows.push(row);
      if (vendorName.includes(EXAMPLE)) {
        problems.push(EXAMPLE_ROW);
        continue;
      }
      const vendor = await vendorFor(vendorName, problems);
      const currency = currencyCell(cell.text(r.get("Currency"), "Currency"), listed, problems) ?? "EUR";
      const validFrom = cell.day(r.get("Valid from"), "Valid from");
      const dayRateMinor = cell.amount(r.get("Day rate"), "Day rate", currency);
      if (!validFrom && !problems.some((p) => p.startsWith("Valid from"))) problems.push("Valid from: this is required.");
      if (dayRateMinor == null && !problems.some((p) => p.startsWith("Day rate"))) problems.push("Day rate: this is required.");
      const parsed = rateLineSchema.safeParse({ role, dayRateMinor, currency, validFrom });
      if (!parsed.success)
        for (const p of plain(parsed.error, "").map((x) => x.replace(/^(\w+):/, (m, f: string) => `${columnsBySheet["Day rates"]![f] ?? f}:`)))
          // A value already refused as unreadable is not refused again as missing.
          if (!problems.some((q) => q.split(":")[0] === p.split(":")[0])) problems.push(p);
      if (role && twiceRate(r)) problems.push("This day rate appears more than once in the file.");
      if (problems.length || !vendor || !parsed.success) continue;
      const v = parsed.data;
      const there = await tx
        .select({ id: rateCardLines.id })
        .from(rateCardLines)
        .where(and(eq(rateCardLines.vendorId, vendor.id), sql`lower(${rateCardLines.role}) = lower(${v.role})`, eq(rateCardLines.validFrom, v.validFrom)));
      if (there.length) row.outcome = "exists";
      else await attempt(row, () => saveRateLine(tx as unknown as Db, { vendorId: vendor.id }, v, by, today, "import"));
    }

    // ---- Invoices (M-9): matched by vendor and invoice number; checked by the invoice form's own rules
    const invoiceKey = (r: SheetRow) => `${cleanName(str(r.get("Vendor name"))).toLowerCase()}|${str(r.get("Invoice number")).toLowerCase().replace(/\s+/g, " ")}`;
    const twiceInvoice = counted(book.Invoices, invoiceKey);
    for (const r of book.Invoices) {
      const problems: string[] = [];
      const cell = readers(problems);
      const vendorName = cleanName(cell.text(r.get("Vendor name"), "Vendor name"));
      const number = cell.text(r.get("Invoice number"), "Invoice number").replace(/\s+/g, " ");
      const row: ImportRow = { sheet: "Invoices", row: r.row, label: `${vendorName || "(no vendor)"} · ${number || "(no number)"}`, outcome: "invalid", problems };
      rows.push(row);
      if (vendorName.includes(EXAMPLE)) {
        problems.push(EXAMPLE_ROW);
        continue;
      }
      const vendor = await vendorFor(vendorName, problems);
      const title = cell.text(r.get("Agreement title"), "Agreement title");
      let agreement: { id: string; kind: Kind; currency: string } | undefined;
      if (!title) problems.push("Agreement title: name the SOW or subscription this invoice is for.");
      else if (vendor) {
        const found = await tx
          .select({ id: agreements.id, kind: agreements.kind, currency: agreements.currency })
          .from(agreements)
          .where(and(eq(agreements.vendorId, vendor.id), sql`lower(${agreements.title}) = lower(${title})`, inArray(agreements.kind, ["sow", "subscription"])));
        if (found.length === 1) agreement = found[0];
        else if (found.length > 1) problems.push(`Agreement title: ${vendorName} has more than one SOW or subscription called "${title}". Rename one in the app first.`);
        else problems.push(`Agreement title: ${vendorName} has no SOW or subscription called "${title}", in the app or on the Agreements sheet.`);
      }
      const milestoneTitle = cell.text(r.get("Milestone title"), "Milestone title");
      let milestoneId: string | null = null;
      if (milestoneTitle && agreement) {
        if (agreement.kind !== "sow") problems.push("Milestone title: only a SOW has milestones. Leave it empty for a subscription.");
        else {
          const m = await tx
            .select({ id: milestones.id })
            .from(milestones)
            .where(and(eq(milestones.sowId, agreement.id), sql`lower(${milestones.title}) = lower(${milestoneTitle})`));
          if (m.length === 1) milestoneId = m[0]!.id;
          else problems.push(m.length ? `Milestone title: the SOW has more than one milestone called "${milestoneTitle}".` : `Milestone title: the SOW has no milestone called "${milestoneTitle}".`);
        }
      }
      const invoiceDate = cell.day(r.get("Invoice date"), "Invoice date");
      if (!invoiceDate && !problems.some((p) => p.startsWith("Invoice date"))) problems.push("Invoice date: this is required.");
      // Q: the currency is always the agreement's; an amount written in another one is refused, never converted.
      // Without its agreement the currency is unknown, so the amount is checked once the agreement is found.
      const amountMinor = agreement ? cell.amount(r.get("Amount"), "Amount", agreement.currency) : null;
      if (agreement && amountMinor == null && !problems.some((p) => p.startsWith("Amount"))) problems.push("Amount: this is required.");
      if (!number) problems.push("Invoice number: this is required.");
      else if (twiceInvoice(r)) problems.push("This invoice appears more than once in the file.");
      if (problems.length || !vendor || !agreement) continue;
      const there = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.vendorId, vendor.id), sql`lower(${invoices.invoiceNumber}) = lower(${number})`));
      if (there.length) {
        row.outcome = "exists";
        continue;
      }
      const description = cell.text(r.get("Description"), "Description");
      await attempt(row, () =>
        saveInvoice(tx as unknown as Db, null, { agreementId: agreement.id, milestoneId, invoiceNumber: number, invoiceDate, amountMinor, description }, by, today, "import"),
      );
    }

    rows.sort((a, b) => SHEETS.indexOf(a.sheet) - SHEETS.indexOf(b.sheet) || a.row - b.row);
    const counts = { add: 0, exists: 0, invalid: 0 };
    for (const r of rows) counts[r.outcome]++;
    const result = { rows, counts, applied: apply };
    if (!apply) throw new Preview(result);
    return result;
  });
}

/** A cell's value as it was typed, for the file of rows to fix: a failed formula comes back empty. */
function original(raw: unknown): ExcelJS.CellValue {
  const v = unwrap(raw);
  if (v == null || v instanceof CellError) return null;
  return v instanceof Date || typeof v === "number" || typeof v === "boolean" ? v : String(v);
}

/**
 * The rows with a problem, in the template's shape with the reason in a last column, to fix
 * and upload again (A-8). Worked out with the same analysis as the preview.
 */
export async function problemRows(db: Db, buffer: Buffer, by: User, today: Day): Promise<Buffer> {
  const book = await read(buffer);
  const result = await analyse(db, book, by, today, false);
  const wb = templateBook(false);
  for (const name of SHEETS) {
    const ws = wb.getWorksheet(name)!;
    const columns = columnsOfSheet[name];
    const header = ws.getRow(1);
    header.getCell(columns.length + 1).value = "Problem";
    header.getCell(columns.length + 1).font = { bold: true, color: { argb: "FFB42318" } };
    ws.getColumn(columns.length + 1).width = 80;
    const bad = new Map(result.rows.filter((r) => r.sheet === name && r.outcome === "invalid").map((r) => [r.row, r.problems.join(" ")]));
    for (const r of book[name]) {
      if (!bad.has(r.row)) continue;
      const added = ws.addRow([...columns.map((c) => original(r.get(c))), bad.get(r.row)!]);
      columns.forEach((c, i) => {
        if (/date|signed on|valid from/i.test(c) && added.getCell(i + 1).value instanceof Date) added.getCell(i + 1).numFmt = "yyyy-mm-dd";
      });
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
