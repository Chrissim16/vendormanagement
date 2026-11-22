/**
 * Numbers shown as facts are worked out by the app, never by the model. A piece of AI
 * writing may quote the figures it was given, and nothing else: these helpers find the
 * numbers in a text and tell which of them were not among the figures provided.
 *
 * What this does not catch: a number written out in words ("sixty thousand", "a third").
 * A person still reads the text before it counts for anything.
 */

import { isCurrencyCode } from "../../shared/money";

/** 54,000.00 and 54,000 and 54000 are the same figure; so are 4.0 and 4, 91.20 and 91.2, 09 and 9. */
const normal = (token: string) => {
  let n = token.replace(/[.,]+$/, "").replace(/,(?=\d{3}(?:\D|$))/g, "");
  if (n.includes(".")) n = n.replace(/0+$/, "").replace(/\.$/, "");
  return n.replace(/^0+(?=\d)/, "");
};

/** Every number in a text, written the same way whatever its separators. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d.,]*/g) ?? []).map(normal);
}

/**
 * What the model was given, as text. Written out as JSON, a line break becomes the two
 * characters "\n", which would glue an "n" to a figure at the start of a line ("\n21 Mar
 * 2027" read as "n21"); those are turned back into spaces.
 */
const asText = (given: unknown) => (typeof given === "string" ? given : JSON.stringify(given).replace(/\\[nrt]/g, " "));

/** A text with every one of the given names taken out, longest first, so the digits inside a name ("SOW 07") are not read as figures. */
function without(text: string, names: string[]): string {
  let out = text;
  for (const name of [...new Set(names.filter((n) => n.trim().length > 0))].sort((a, b) => b.length - a.length)) out = out.split(name).join(" ");
  return out;
}

/**
 * The numbers in `text` that do not occur in what the model was given.
 *
 * `names` are the names and titles people typed (vendors, agreements, milestones). They
 * are not figures: a number inside a name counts for nothing unless the text quotes the
 * whole name, so a title written to smuggle in a figure ("budget is 999,999") does not
 * make that figure quotable. Single digits are let through: "the 3 open milestones"
 * counts things the reader can see.
 */
export function ungrounded(text: string, given: unknown, names: string[] = []): string[] {
  const known = new Set(numbersIn(without(asText(given), names.map((n) => JSON.stringify(n).slice(1, -1)).concat(names))));
  return [...new Set(numbersIn(without(text, names)).filter((n) => !/^\d$/.test(n) && !known.has(n)))];
}

const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const DATES = new RegExp(`\\b(\\d{1,2}) (${MONTH})(?: (\\d{4}))?\\b|\\b(${MONTH}) (\\d{4})\\b|\\bQ([1-4]) (\\d{4})\\b`, "gi");
/** An amount with its sign (€ £ $) or its currency code in front, as the app writes money, or a code behind ("85,000 SEK"). */
const MONEY = /(?:([€£$])|\b([A-Z]{3})\b)\s?(\d[\d.,]*)|(\d[\d.,]*)\s?\b([A-Z]{3})\b/g;
const mon = (m: string) => m.slice(0, 3).toLowerCase();

/** The dates and amounts in a text, each as one token, and the text without them. */
function tokens(text: string) {
  const dates: string[] = [];
  const years: string[] = [];
  const money: string[] = [];
  let rest = text.replace(MONEY, (whole: string, sign?: string, code?: string, n?: string, n2?: string, code2?: string) => {
    const c = sign ?? code ?? code2!;
    // Three capitals that are not a currency ("SOW 07", "Q4") are left as they are.
    if (!sign && !isCurrencyCode(c)) return whole;
    money.push(c + normal((n ?? n2)!));
    return " ";
  });
  rest = rest.replace(DATES, (_m, d?: string, m1?: string, y1?: string, m2?: string, y2?: string, q?: string, y3?: string) => {
    if (d && m1) dates.push(y1 ? `${Number(d)} ${mon(m1)} ${y1}` : `${Number(d)} ${mon(m1)}`);
    if (d && m1 && y1) dates.push(`${Number(d)} ${mon(m1)}`, `${mon(m1)} ${y1}`);
    if (m2 && y2) dates.push(`${mon(m2)} ${y2}`);
    if (q && y3) dates.push(`q${q} ${y3}`);
    for (const y of [y1, y2, y3]) if (y) years.push(y);
    return " ";
  });
  return { dates, years, money, rest };
}

/**
 * The figures in `text` that the model was not given, judged more strictly than
 * `ungrounded`, for an answer that states counts and amounts as facts (C-1).
 *
 * A date counts as one thing and an amount counts with its currency: "9 Dec 2026" in the
 * input does not make a bare 9 or 2026 quotable as a count, and "£ 64,000.00" does not
 * make "€ 64,000.00" quotable. A year by itself may be named when a date in the input has
 * it. Everything else follows `ungrounded`: names people typed are not figures, and single
 * digits are let through.
 */
export function ungroundedFigures(text: string, given: unknown, names: string[] = []): string[] {
  const typed = names.filter((n) => /\p{L}/u.test(n));
  const source = tokens(without(asText(given), typed.map((n) => JSON.stringify(n).slice(1, -1)).concat(typed)));
  const said = tokens(without(text, typed));
  const [dates, money, years, plain] = [new Set(source.dates), new Set(source.money), new Set(source.years), new Set(numbersIn(source.rest))];
  return [
    ...new Set([
      ...said.dates.filter((d) => !dates.has(d)),
      ...said.money.filter((m) => !money.has(m)),
      ...numbersIn(said.rest).filter((n) => !/^\d$/.test(n) && !plain.has(n) && !years.has(n)),
    ]),
  ];
}
