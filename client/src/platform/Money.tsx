import { Link } from "react-router-dom";
import { convertedNote, EUR, formatMoney, isMixed, moneyLine, parseAmount, typedCurrency, type Money, type Rate } from "../../../shared/money";
import { useCurrencies } from "../lib/data";
import { useMe } from "./session";

/** A text with each amount kept on one line: the space between a sign or code and its number becomes a non-breaking one, so "SEK" never ends a line with "85,000.00" on the next. */
export const wholeAmounts = (text: string) => text.replace(/([€£$]|\b[A-Z]{3}) (?=-?\d)/g, "$1\u00a0");

/**
 * Under a euro total that was converted: the rates used. A starting rate says so, and an
 * admin gets a link to set the real one (M-8).
 */
export function ConvertedNote({ rates, className = "" }: { rates: Rate[]; className?: string }) {
  const me = useMe();
  if (!rates.length) return null;
  const starting = rates.some((r) => r.starting);
  return (
    <p className={`num text-[12.5px] text-ink-2 ${className}`}>
      {convertedNote(rates)}
      {starting && me.role === "admin" && (
        <>
          {" "}
          <Link to="/admin/settings#currencies" className="font-medium text-accent-ink underline-offset-2 hover:underline">
            Set the rates
          </Link>
        </>
      )}
    </p>
  );
}

/**
 * A total across currencies as one figure (M-8): euros first, marked as converted when
 * anything else is in it, with a line naming the amount in each currency beneath.
 */
export function ConvertedTotal({ label, money, rates, size = "tile" }: { label: string; money: Money; rates: Rate[]; size?: "tile" | "fact" }) {
  const mixed = isMixed(money.amounts);
  // The parts of one item of a description list (dt, then its dd), for a <div> directly inside a <dl>.
  return (
    <>
      <dt className="text-[13.5px] font-medium text-ink-2">
        {label}
        {mixed && <span className="font-normal"> · converted to euros</span>}
      </dt>
      <dd className={`num mt-2 font-semibold leading-tight tracking-[-0.03em] ${size === "tile" ? "text-[30px]" : "text-[22px]"}`}>{formatMoney(money.eurMinor, EUR)}</dd>
      {mixed && <dd className="num mt-1.5 text-[13.5px]">{wholeAmounts(moneyLine(money.amounts))}</dd>}
      {mixed && (
        <dd>
          <ConvertedNote rates={rates} className="mt-1" />
        </dd>
      )}
    </>
  );
}

/** "€ 27,600.00 ($ 30,000.00)": an amount in euros, with what it was in its own currencies in brackets when that was not only euros. */
export function EurWithOriginal({ money }: { money: Money }) {
  return (
    <span className="num">
      <span className="font-medium">{wholeAmounts(formatMoney(money.eurMinor, EUR))}</span>
      {isMixed(money.amounts) && <span className="text-ink-2"> ({wholeAmounts(moneyLine(money.amounts))})</span>}
    </span>
  );
}

/**
 * The options of a currency box: the currencies on the admin's list (M-8), euro first. The
 * value already chosen stays offered while the list loads.
 */
export function CurrencyOptions({ value }: { value: string }) {
  const list = useCurrencies();
  const items = list.data ?? [];
  return (
    <>
      {!items.some((c) => c.code === value) && <option value={value}>{value}</option>}
      {items.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code} · {c.name}
        </option>
      ))}
    </>
  );
}

/** An amount as the screens show it: as `formatMoney` writes it, kept on one line. */
export const shownMoney = (minor: number, currency: string) => wholeAmounts(formatMoney(minor, currency));

/** What is wrong with a typed amount, or "": an amount written in another currency says so; anything else gets the form's own `fallback`. */
export function amountProblem(text: string, currency: string, fallback: string): string {
  if (parseAmount(text, currency) != null) return "";
  const typed = typedCurrency(text);
  return typed && typed !== currency
    ? `This is written in ${typed}, but the amount is in ${currency}. Write it in ${currency}, or choose ${typed} as the currency where that can be chosen.`
    : fallback;
}
