export const currencies = ["EUR", "GBP"] as const;
export type Currency = (typeof currencies)[number];
const symbols: Record<Currency, string> = { EUR: "€", GBP: "£" };

/**
 * Reads an amount as people type it and returns whole cents, or null when it is not an
 * amount. Accepts 12500, 12,500.00, 12.500,00 and 12 500,5. A single separator followed
 * by exactly three digits is read as a thousands separator (1.234 is one thousand two
 * hundred and thirty-four).
 */
export function parseAmount(input: string): number | null {
  const s = input.replace(/[\s€£]/g, "").replace(/^(EUR|GBP)/i, "");
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

/** € 12,500.00 */
export function formatMoney(minor: number, currency: Currency): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${symbols[currency]} ${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** An amount for an input box: 12500.00 */
export const amountForInput = (minor: number | null | undefined) => (minor == null ? "" : (minor / 100).toFixed(2));
