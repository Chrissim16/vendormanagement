import { asc, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { agreements, currencies, rateCardLines, rfps, settings } from "../../../db/schema";
import { isoCurrency } from "../../../shared/iso-currencies";
import {
  currencyAddSchema,
  currencyRateSchema,
  EUR,
  rateText,
  ratesOf,
  STARTING_RATE_NOTE,
  type Currency,
  type ListedCurrency,
  type Rates,
} from "../../../shared/money";
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from "../../../shared/sow";
import type { User } from "../../../shared/types";
import { diff } from "../../../shared/users";
import { audit } from "../../platform/audit";
import { AppError, notFound } from "../../platform/errors";
import { failFields } from "../../platform/http";
import type { Db, Queryable, Tx } from "../../platform/ports/types";

/** The admin's settings, or the defaults when none have been saved yet. */
export async function getSettings(db: Queryable): Promise<Settings> {
  const row = (await db.select().from(settings))[0];
  return row ? { noticeDays: row.noticeDays, sowEndDays: row.sowEndDays, budgetWarningPct: row.budgetWarningPct } : DEFAULT_SETTINGS;
}

export async function saveSettings(db: Db, input: unknown, by: User): Promise<Settings> {
  const next = settingsSchema.parse(input);
  return db.transaction(async (tx) => {
    const current = await getSettings(tx);
    const changes = diff(current, next);
    if (!Object.keys(changes).length) return current;
    const values = { ...next, updatedAt: new Date(), updatedBy: by.email };
    await tx
      .insert(settings)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: settings.id, set: values });
    await audit(tx, { userEmail: by.email, action: "update", entityType: "settings", entityId: "settings", summary: "Settings", changes });
    return next;
  });
}

// ---------- Currencies and their rates (M-8)

const LIST = { entityType: "currencies", entityId: "list" } as const;
const count = (table: typeof agreements | typeof rateCardLines | typeof rfps) =>
  sql<number>`(select count(*)::int from ${table} where ${table.currency} = ${currencies.code})`;

/** Every currency on the list, the euro first, then A to Z, with what uses each. */
export async function listCurrencies(db: Queryable): Promise<ListedCurrency[]> {
  const rows = await db
    .select({
      code: currencies.code,
      name: currencies.name,
      unitsPerEurE4: currencies.unitsPerEurE4,
      rateSetAt: currencies.rateSetAt,
      rateSetBy: currencies.rateSetBy,
      agreements: count(agreements),
      rateCardLines: count(rateCardLines),
      rfps: count(rfps),
    })
    .from(currencies)
    .orderBy(sql`${currencies.code} <> 'EUR'`, asc(currencies.code));
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    unitsPerEurE4: r.unitsPerEurE4,
    starting: r.code !== EUR && !r.rateSetAt,
    rateSetAt: r.rateSetAt?.toISOString() ?? null,
    rateSetBy: r.rateSetBy,
    uses: { agreements: Number(r.agreements), rateCardLines: Number(r.rateCardLines), rfps: Number(r.rfps) },
  }));
}

/** An amount in euros inside a query, with each currency's rate from the list, so amounts in different currencies sort fairly together. */
export const inEuros = (amount: SQL | AnyColumn, currency: AnyColumn) =>
  sql`${amount} * 10000.0 / (select ${currencies.unitsPerEurE4} from ${currencies} where ${currencies.code} = ${currency})`;

/** Every listed currency's rate, for working out euro totals. */
export async function getRates(db: Queryable): Promise<Rates> {
  const rows = await db.select({ code: currencies.code, unitsPerEurE4: currencies.unitsPerEurE4, rateSetAt: currencies.rateSetAt }).from(currencies);
  return ratesOf(rows.map((r) => ({ code: r.code, unitsPerEurE4: r.unitsPerEurE4, starting: r.code !== EUR && !r.rateSetAt })));
}

/**
 * Refuses a currency that is not on the list, naming the field, before a record is saved
 * with it. The database refuses it too; this says so in words.
 */
export async function requireListed(db: Queryable, code: Currency, field = "currency"): Promise<void> {
  const row = (await db.select({ code: currencies.code }).from(currencies).where(eq(currencies.code, code)))[0];
  if (!row) failFields({ [field]: `${code} is not on the app's list of currencies. An admin can add it in Settings.` });
}

async function lockCurrency(tx: Tx, code: string) {
  await tx.execute(sql`select 1 from currencies where code = ${code} for update`);
  const row = (await tx.select().from(currencies).where(eq(currencies.code, code)))[0];
  if (!row) throw notFound(`The currency ${code}`);
  return row;
}

const rateWords = (code: string, e4: number, starting: boolean) => `${rateText({ code, unitsPerEurE4: e4 })}${starting ? ` (${STARTING_RATE_NOTE})` : ""}`;

/** Admin: adds a currency from the standard list, with its rate. Only a currency with cents can be added, since every amount is kept in cents. */
export async function addCurrency(db: Db, input: unknown, by: User): Promise<ListedCurrency[]> {
  const { code, unitsPerEurE4 } = currencyAddSchema.parse(input ?? {});
  const iso = isoCurrency(code);
  if (!iso) failFields({ code: `${code} is not a standard currency code. Use the three letters banks use, for example CHF for Swiss francs.` });
  if (iso.decimals !== 2)
    failFields({
      code:
        iso.decimals === 0
          ? `${iso.name} (${code}) has no cents. The app keeps every amount in cents, so it can only take currencies with two decimals.`
          : `${iso.name} (${code}) has ${iso.decimals} decimals. The app keeps every amount in cents, so it can only take currencies with two decimals.`,
    });
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table currencies in share row exclusive mode`);
    const existing = (await tx.select().from(currencies).where(eq(currencies.code, code)))[0];
    if (existing) failFields({ code: `${existing.name} (${code}) is already on the list.` });
    const now = new Date();
    await tx.insert(currencies).values({ code, name: iso.name, unitsPerEurE4, rateSetAt: now, rateSetBy: by.email, createdBy: by.email, updatedBy: by.email, updatedAt: now });
    await audit(tx, { userEmail: by.email, action: "create", ...LIST, summary: `${iso.name} (${code})`, changes: { [`currency ${code}`]: { from: null, to: rateWords(code, unitsPerEurE4, false) } } });
    return listCurrencies(tx);
  });
}

/** Admin: sets a currency's rate. Converted totals change; no stored amount does. The euro is always 1. */
export async function setCurrencyRate(db: Db, code: string, input: unknown, by: User): Promise<ListedCurrency[]> {
  const { unitsPerEurE4 } = currencyRateSchema.parse(input ?? {});
  if (code === EUR) throw new AppError(409, "euro_fixed", "The euro is the main currency: its rate is always 1.");
  return db.transaction(async (tx) => {
    const row = await lockCurrency(tx, code);
    // Saving the starting rate unchanged still counts: the admin has checked it.
    if (row.unitsPerEurE4 === unitsPerEurE4 && row.rateSetAt) return listCurrencies(tx);
    const now = new Date();
    await tx.update(currencies).set({ unitsPerEurE4, rateSetAt: now, rateSetBy: by.email, updatedAt: now, updatedBy: by.email }).where(eq(currencies.code, code));
    await audit(tx, {
      userEmail: by.email,
      action: "update",
      ...LIST,
      summary: `${row.name} (${code})`,
      changes: { [`rate ${code}`]: { from: rateWords(code, row.unitsPerEurE4, !row.rateSetAt), to: rateWords(code, unitsPerEurE4, false) } },
    });
    return listCurrencies(tx);
  });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Admin: takes a currency off the list, as long as nothing uses it. The euro stays. */
export async function removeCurrency(db: Db, code: string, by: User): Promise<ListedCurrency[]> {
  if (code === EUR) throw new AppError(409, "euro_fixed", "The euro is the main currency and cannot be removed.");
  return db.transaction(async (tx) => {
    const row = await lockCurrency(tx, code);
    const uses = (await listCurrencies(tx)).find((c) => c.code === code)!.uses;
    const named = [
      uses.agreements && plural(uses.agreements, "agreement", "agreements"),
      uses.rateCardLines && plural(uses.rateCardLines, "rate card line", "rate card lines"),
      uses.rfps && plural(uses.rfps, "RFP", "RFPs"),
    ].filter(Boolean);
    if (named.length)
      throw new AppError(409, "currency_in_use", `${row.name} (${code}) is still used by ${named.join(" and ")}. It can be removed once nothing is in ${code} any more.`);
    await tx.delete(currencies).where(eq(currencies.code, code));
    await audit(tx, {
      userEmail: by.email,
      action: "delete",
      ...LIST,
      summary: `${row.name} (${code})`,
      changes: { [`currency ${code}`]: { from: rateWords(code, row.unitsPerEurE4, !row.rateSetAt), to: "removed" } },
    });
    return listCurrencies(tx);
  });
}
