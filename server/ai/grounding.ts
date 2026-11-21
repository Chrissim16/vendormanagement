/**
 * Numbers shown as facts are worked out by the app, never by the model. A piece of AI
 * writing may quote the figures it was given, and nothing else: these helpers find the
 * numbers in a text and tell which of them were not among the figures provided.
 *
 * What this does not catch: a number written out in words ("sixty thousand", "a third").
 * A person still reads the text before it counts for anything.
 */

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
  const known = new Set(numbersIn(without(typeof given === "string" ? given : JSON.stringify(given), names.map((n) => JSON.stringify(n).slice(1, -1)).concat(names))));
  return [...new Set(numbersIn(without(text, names)).filter((n) => !/^\d$/.test(n) && !known.has(n)))];
}
