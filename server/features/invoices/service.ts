import { z } from "zod";
import { addMonths, type Day } from "../../../shared/dates";
import { addMoney, noMoney, ratesUsed, toEur, type Money, type Rate } from "../../../shared/money";
import { invoiceSchema, summariseSpend, type Invoice, type Spend } from "../../../shared/sow";
import type { Page, User } from "../../../shared/types";
import { diff } from "../../../shared/users";
import { audit } from "../../platform/audit";
import { AppError, notFound } from "../../platform/errors";
import { failFields, isUniqueViolation, toCsv } from "../../platform/http";
import type { Db, Queryable } from "../../platform/ports/types";
import { getRates } from "../settings/service";
import * as repo from "./repo";

type Row = NonNullable<Awaited<ReturnType<typeof repo.getInvoice>>>;
const toInvoice = ({ invoice: i, vendorName, agreementTitle, agreementKind, milestoneTitle }: Row): Invoice => ({
  id: i.id,
  vendorId: i.vendorId,
  vendorName,
  agreementId: i.agreementId,
  agreementTitle,
  agreementKind,
  milestoneId: i.milestoneId,
  milestoneTitle,
  invoiceNumber: i.invoiceNumber,
  invoiceDate: i.invoiceDate,
  amountMinor: i.amountMinor,
  currency: i.currency,
  description: i.description,
  createdBy: i.createdBy,
});

/** The invoice list (M-6) with each amount also in euros, and the total of everything that matches, per currency and together in euros. */
export async function listInvoices(db: Db, filter: repo.InvoiceFilter): Promise<Page<Invoice & { eurMinor: number }> & { sums: Money; rates: Rate[] }> {
  const [{ items, total, sums }, rates] = await Promise.all([repo.listInvoices(db, filter), getRates(db)]);
  const out = noMoney();
  for (const s of sums) addMoney(out, s.currency, Number(s.n), rates);
  return {
    items: items.map((r) => ({ ...toInvoice(r), eurMinor: toEur(r.invoice.amountMinor, r.invoice.currency, rates) })),
    total,
    sums: out,
    rates: ratesUsed(out.amounts, rates),
  };
}

const DUPLICATE = "This vendor already has an invoice with this number.";

/** Adds or changes an invoice (M-4). The currency always follows the agreement it is booked against. */
export async function saveInvoice(db: Db, id: string | null, input: unknown, by: User, today: Day, action: "create" | "import" = "create"): Promise<Invoice> {
  try {
    return await db.transaction(async (tx) => {
      const found = id ? (await repo.getInvoice(tx, id))?.invoice : undefined;
      if (id && !found) throw notFound("That invoice");
      const target = z.object({ agreementId: z.string().uuid().optional() }).safeParse(input ?? {});
      const agreementId = (target.success ? target.data.agreementId : undefined) ?? found?.agreementId;
      const agreement = agreementId ? await repo.lockAgreement(tx, agreementId) : undefined;
      // Read again now that the agreement is locked, and merge the change onto what is stored now.
      const existing = found ? (await repo.getInvoice(tx, found.id))?.invoice : undefined;
      if (found && !existing) throw notFound("That invoice");
      // A change may send only the fields that change.
      const v = invoiceSchema.parse(existing ? { ...existing, ...(input as object) } : input);
      if (!agreement) failFields({ agreementId: "Choose the SOW or subscription this invoice is for." });
      if (agreement.kind !== "sow" && agreement.kind !== "subscription") failFields({ agreementId: "An invoice is booked against a SOW or a subscription." });
      // An amount keeps its currency: an invoice never moves to an agreement in another one.
      if (existing && existing.currency !== agreement.currency)
        failFields({ agreementId: `This invoice is in ${existing.currency}. It cannot move to an agreement in ${agreement.currency}.` });
      if (v.invoiceDate > today) failFields({ invoiceDate: "The invoice date cannot be in the future." });
      if (v.milestoneId) {
        const m = await repo.getMilestone(tx, v.milestoneId);
        if (!m || m.sowId !== agreement.id) failFields({ milestoneId: "Choose a milestone of this SOW." });
        if (m.status === "cancelled" && v.milestoneId !== existing?.milestoneId) failFields({ milestoneId: "That milestone was cancelled." });
      }
      if (await repo.findNumber(tx, agreement.vendorId, v.invoiceNumber, existing?.id)) failFields({ invoiceNumber: DUPLICATE });
      const row = { ...v, vendorId: agreement.vendorId, currency: agreement.currency };
      const summary = `${agreement.vendorName} · ${v.invoiceNumber}`;
      let savedId: string;
      if (existing) {
        const changes = diff(existing as unknown as Record<string, unknown>, row);
        if (Object.keys(changes).length) {
          await repo.updateInvoice(tx, existing.id, row, by.email);
          await audit(tx, { userEmail: by.email, action: "update", entityType: "invoice", entityId: existing.id, summary, changes });
        }
        savedId = existing.id;
      } else {
        savedId = (await repo.insertInvoice(tx, row, by.email)).id;
        await audit(tx, {
          userEmail: by.email,
          action,
          entityType: "invoice",
          entityId: savedId,
          summary,
          changes: { amountMinor: { from: null, to: v.amountMinor }, agreement: { from: null, to: agreement.title } },
        });
      }
      return toInvoice((await repo.getInvoice(tx, savedId))!);
    });
  } catch (e) {
    // Two people keying the same invoice at the same moment: the database's own rule catches the second.
    if (isUniqueViolation(e)) failFields({ invoiceNumber: DUPLICATE });
    throw e;
  }
}

export async function removeInvoice(db: Db, id: string, by: User): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await repo.getInvoice(tx, id);
    if (!row) throw notFound("That invoice");
    await repo.deleteInvoice(tx, id);
    await audit(tx, {
      userEmail: by.email,
      action: "delete",
      entityType: "invoice",
      entityId: id,
      summary: `${row.vendorName} · ${row.invoice.invoiceNumber}`,
      changes: { amountMinor: { from: row.invoice.amountMinor, to: null }, agreement: { from: row.agreementTitle, to: null } },
    });
  });
}

const EXPORT_LIMIT = 10000;

export async function exportCsv(db: Db, filter: Omit<repo.InvoiceFilter, "page" | "pageSize">): Promise<string> {
  const [{ items, total }, rates] = await Promise.all([repo.listInvoices(db, { ...filter, page: 1, pageSize: EXPORT_LIMIT }), getRates(db)]);
  if (total > EXPORT_LIMIT) throw new AppError(400, "too_many", `There are ${total} invoices to export, more than fits in one file. Narrow the period first.`);
  return toCsv(
    ["Vendor", "Agreement", "Milestone", "Invoice number", "Invoice date", "Amount", "Currency", "Amount in euros (converted)", "Description"],
    items.map((r) => [
      r.vendorName,
      r.agreementTitle,
      r.milestoneTitle,
      r.invoice.invoiceNumber,
      r.invoice.invoiceDate,
      (r.invoice.amountMinor / 100).toFixed(2),
      r.invoice.currency,
      (toEur(r.invoice.amountMinor, r.invoice.currency, rates) / 100).toFixed(2),
      r.invoice.description,
    ]),
  );
}

/** The spend overview as a file: one row per vendor, month and currency (M-6). */
export async function exportSpendCsv(db: Queryable, from: Day, to: Day): Promise<string> {
  if (to < from) failFields({ to: "The end of the period is before its start." });
  const [rows, rates] = await Promise.all([repo.spendRows(db, from, to), getRates(db)]);
  rows.sort((a, b) => a.vendorName.localeCompare(b.vendorName) || a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency));
  return toCsv(
    ["Vendor", "Month", "Currency", "Invoiced", "Invoiced in euros (converted)"],
    rows.map((r) => [r.vendorName, r.month, r.currency, (Number(r.amountMinor) / 100).toFixed(2), (toEur(Number(r.amountMinor), r.currency, rates) / 100).toFixed(2)]),
  );
}

/** The last twelve months up to today, starting on the first of a month. */
export function defaultPeriod(today: Day): { from: Day; to: Day } {
  return { from: `${addMonths(`${today.slice(0, 7)}-01`, -11)}`, to: today };
}

/** Spend per vendor and per month for a period (M-6). */
export async function getSpend(db: Queryable, from: Day, to: Day): Promise<Spend> {
  if (to < from) failFields({ to: "The end of the period is before its start." });
  const [rows, rates] = await Promise.all([repo.spendRows(db, from, to), getRates(db)]);
  return summariseSpend(
    rows.map((r) => ({ ...r, amountMinor: Number(r.amountMinor) })),
    from,
    to,
    rates,
  );
}
