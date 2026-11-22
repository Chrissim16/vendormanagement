import { z } from "zod";
import { ISO_CODES } from "./iso-currencies";

/**
 * A currency is its three-letter ISO 4217 code. Which codes may be used is the admin's
 * currency list (M-8), kept in the database; the euro is always on it and is the main
 * currency: every total across currencies is in euros.
 */
export type Currency = string;
export const EUR = "EUR";

/** A currency code as a form or the import sends it: three letters, read in capitals. Whether it is on the list is checked by the server. */
export const currencyCode = z
  .string("Choose a currency.")
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Choose a currency.");

/** The currencies a new app starts with, and their rough starting rates (1 EUR = so many), until an admin sets the real ones. */
export const STARTING_CURRENCIES: readonly { code: string; name: string; unitsPerEurE4: number }[] = [
  { code: "EUR", name: "Euro", unitsPerEurE4: 1_0000 },
  { code: "GBP", name: "Pound sterling", unitsPerEurE4: 8550 },
  { code: "USD", name: "US dollar", unitsPerEurE4: 1_0800 },
  { code: "SEK", name: "Swedish krona", unitsPerEurE4: 11_5000 },
  { code: "NOK", name: "Norwegian krone", unitsPerEurE4: 11_7000 },
  { code: "DKK", name: "Danish krone", unitsPerEurE4: 7_4600 },
];

/** The three currencies shown with a sign. Every other one is shown with its code, so Swedish, Norwegian and Danish kronor cannot be mixed up. */
const SIGNS: Record<string, string> = { EUR: "€", GBP: "£", USD: "$" };
export const currencySign = (currency: Currency) => SIGNS[currency] ?? currency;

/**
 * Reads an amount as people type it and returns whole cents, or null when it is not an
 * amount. Accepts 12500, 12,500.00, 12.500,00 and 12 500,5, with or without a currency
 * sign or code in front or behind (€ 12,500, 12,500 SEK). A single separator followed by
 * exactly three digits is read as a thousands separator (1.234 is one thousand two
 * hundred and thirty-four).
 */
export function parseAmount(input: string): number | null {
  const s = input
    .replace(/[\s€£$]/g, "")
    .replace(/^(?:[A-Za-z]{3}|US)(?=\d)/, "")
    .replace(/(?<=\d)[A-Za-z]{3}$/, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let whole = s;
  let frac = "";
  const split = (i: number) => {
    whole = s.slice(0, i);
    frac = s.slice(i + 1);
  };
  if (lastDot >= 0 && lastComma >= 0) split(Math.max(lastDot, lastComma));
  else {
    const i = Math.max(lastDot, lastComma);
    const sep = i >= 0 ? s[i]! : "";
    const count = sep ? s.split(sep).length - 1 : 0;
    // One separator not followed by exactly three digits is a decimal point.
    if (count === 1 && s.length - i - 1 !== 3) split(i);
  }
  const groups = whole.split(/[.,]/);
  if (groups.some((g, n) => g === "" || (n > 0 && g.length !== 3)) || (groups.length > 1 && groups[0]!.length > 3)) return null;
  // 0.500 or 0,123 cannot be thousands, and with three decimals is not money either: refuse rather than guess.
  if (groups.length > 1 && /^0+$/.test(groups[0]!)) return null;
  if (frac.length > 2 || /[.,]/.test(frac)) return null;
  const cents = Number(groups.join("")) * 100 + Number((frac + "00").slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** € 12,500.00, £ 12,500.00, $ 12,500.00, SEK 12,500.00 */
export function formatMoney(minor: number, currency: Currency): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${currencySign(currency)} ${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** An amount for an input box: 12500.00 */
export const amountForInput = (minor: number | null | undefined) => (minor == null ? "" : (minor / 100).toFixed(2));

// ---------- Rates

/** The most of one currency a euro may buy, as typed: 99,999.9999. */
export const MAX_UNITS_PER_EUR_E4 = 999_999_999;

/** Reads a rate as typed ("11.49" or "11,49": so many of the currency for one euro) into ten-thousandths, or null. At most four decimals. */
export function parseRate(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (!/^\d{1,5}(\.\d{1,4})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const e4 = Number(whole) * 10000 + Number((frac + "0000").slice(0, 4));
  return e4 > 0 ? e4 : null;
}
/** 11.49, 0.855, 1.0835: at least two decimals, at most four. */
export const formatRate = (e4: number) => (e4 / 10000).toFixed(4).replace(/0{1,2}$/, "");

/** The rate of one currency, as a conversion uses it. */
export interface Rate {
  code: Currency;
  /** How many of this currency one euro buys, times 10,000: 1 EUR = 11.49 SEK is 114900. */
  unitsPerEurE4: number;
  /** True until an admin has saved a rate: the app's rough starting rate is in use. */
  starting: boolean;
}
/** Every listed currency's rate, by code. */
export type Rates = Record<Currency, Rate>;

export const ratesOf = (list: Rate[]): Rates => Object.fromEntries(list.map((r) => [r.code, { code: r.code, unitsPerEurE4: r.unitsPerEurE4, starting: r.starting }]));

/** An amount in euro cents: euros unchanged, any other currency divided by its rate and rounded to the cent (half away from zero). */
export function toEur(minor: number, currency: Currency, rates: Rates): number {
  if (currency === EUR) return minor;
  const rate = rates[currency];
  if (!rate) throw new Error(`No rate for ${currency}`);
  const units = BigInt(rate.unitsPerEurE4);
  const abs = BigInt(Math.abs(minor)) * 10000n;
  const cents = Number((2n * abs + units) / (2n * units));
  return minor < 0 ? -cents : cents;
}

// ---------- Totals across currencies

/** A total across currencies: what was added up in each currency, and those together in euros. */
export interface Money {
  /** By currency code; only currencies that occur. */
  amounts: Record<Currency, number>;
  /** Each currency converted once, on its own sum, then added up. */
  eurMinor: number;
}

export const noMoney = (): Money => ({ amounts: {}, eurMinor: 0 });

/** Adds an amount to a total and works the euro total out again from the sums, so rounding never piles up amount by amount. */
export function addMoney(m: Money, currency: Currency, minor: number, rates: Rates): Money {
  m.amounts[currency] = (m.amounts[currency] ?? 0) + minor;
  m.eurMinor = Object.entries(m.amounts).reduce((sum, [c, n]) => sum + toEur(n, c, rates), 0);
  return m;
}

/** The currencies of a total, euros first, then A to Z, leaving out those with nothing. */
export const currenciesIn = (amounts: Record<Currency, number>): Currency[] =>
  Object.keys(amounts)
    .filter((c) => amounts[c])
    .sort((a, b) => Number(b === EUR) - Number(a === EUR) || a.localeCompare(b));

/** True when a total holds anything other than euros, so its euro total is a converted one. */
export const isMixed = (amounts: Record<Currency, number>) => currenciesIn(amounts).some((c) => c !== EUR);

/** "€ 120,000.00 · $ 30,000.00 · SEK 85,000.00": each currency of a total in its own money. */
export const moneyLine = (amounts: Record<Currency, number>) =>
  currenciesIn(amounts)
    .map((c) => formatMoney(amounts[c]!, c))
    .join(" · ");

/** The rates a total was converted with: those of its currencies other than euros, A to Z. */
export const ratesUsed = (amounts: Record<Currency, number>, rates: Rates): Rate[] =>
  currenciesIn(amounts)
    .filter((c) => c !== EUR)
    .map((c) => rates[c]!)
    .filter(Boolean);

export const STARTING_RATE_NOTE = "starting rate, not yet set by an admin";

/** "1 EUR = 11.49 SEK" */
export const rateText = (r: Pick<Rate, "code" | "unitsPerEurE4">) => `1 EUR = ${formatRate(r.unitsPerEurE4)} ${r.code}`;

/** "Converted at 1 EUR = 0.855 GBP and 1 EUR = 11.49 SEK (starting rate, not yet set by an admin)." or "" when nothing was converted. */
export function convertedNote(rates: Rate[]): string {
  if (!rates.length) return "";
  const parts = rates.map((r) => `${rateText(r)}${r.starting ? ` (${STARTING_RATE_NOTE})` : ""}`);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Converted at ${list}.`;
}

/** "€ 27,600.00 ($ 30,000.00)": an amount in euros, with what it was in its own currency when that was not euros. */
export function eurWithOriginal(m: Money): string {
  const cs = currenciesIn(m.amounts);
  const eur = formatMoney(m.eurMinor, EUR);
  if (!cs.length || (cs.length === 1 && cs[0] === EUR)) return eur;
  return `${eur} (${moneyLine(m.amounts)})`;
}

/** True when a three-letter word is a standard currency code, for telling an amount from other capitals ("SOW 07"). */
export const isCurrencyCode = (word: string) => ISO_CODES.has(word);

// ---------- The admin's currency list (M-8)

/** A currency on the list, as Settings shows it. */
export interface ListedCurrency extends Rate {
  name: string;
  /** When and by whom the rate was last saved; null while the starting rate is in use. */
  rateSetAt: string | null;
  rateSetBy: string | null;
  /** What still uses it; a currency in use cannot be removed. Invoices follow their agreement. */
  uses: { agreements: number; rateCardLines: number; rfps: number };
}

const unitsPerEurE4 = z
  .number("Enter a rate, for example 11.49.")
  .int("Enter a rate with at most four decimals.")
  .min(1, "Enter a rate above zero.")
  .max(MAX_UNITS_PER_EUR_E4, "Use at most 99,999.9999.");
export const currencyAddSchema = z.object({ code: currencyCode, unitsPerEurE4 });
export const currencyRateSchema = z.object({ unitsPerEurE4 });

/**
 * A total in words, for a PDF or the AI: "€ 98,000.00" when it is all euros, otherwise
 * "€ 125,600.00 in euros, converted (€ 98,000.00 · $ 30,000.00). Converted at 1 EUR = 1.08 USD."
 */
export function totalInWords(m: Money, rates: Rate[]): string {
  if (!isMixed(m.amounts)) return formatMoney(m.eurMinor, EUR);
  return `${formatMoney(m.eurMinor, EUR)} in euros, converted (${moneyLine(m.amounts)}). ${convertedNote(rates)}`;
}
