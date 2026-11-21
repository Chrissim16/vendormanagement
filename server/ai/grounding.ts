/**
 * Numbers shown as facts are worked out by the app, never by the model. A piece of AI
 * writing may quote the figures it was given, and nothing else: these helpers find the
 * numbers in a text and tell which of them were not among the figures provided.
 */

/** 54,000.00 and 54,000 and 54000 are the same figure; so are 4.0 and 4. */
const normal = (token: string) =>
  token
    .replace(/[.,]+$/, "")
    .replace(/,(?=\d{3}(?:\D|$))/g, "")
    .replace(/\.0+$/, "");

/** Every number in a text, written the same way whatever its separators. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d.,]*/g) ?? []).map(normal);
}

/**
 * The numbers in `text` that do not occur in what the model was given. Single digits are
 * let through: "the 3 open milestones" counts things the reader can see, and a model
 * cannot do much harm with a number below ten.
 */
export function ungrounded(text: string, given: unknown): string[] {
  const known = new Set(numbersIn(typeof given === "string" ? given : JSON.stringify(given)));
  return [...new Set(numbersIn(text).filter((n) => !/^\d$/.test(n) && !known.has(n)))];
}
