import { eq } from "drizzle-orm";
import { aiSuggestions } from "../../../db/schema";
import { kindLabels, type AgreementDetail } from "../../../shared/agreements";
import { formatDay, type Day } from "../../../shared/dates";
import { formatMoney, parseAmount, type ListedCurrency } from "../../../shared/money";
import {
  MAX_READING_CHARS,
  readingFields,
  readingLabels,
  readingReviewSchema,
  targetOf,
  unlistedIn,
  verifyReading,
  type ContractReading,
  type DocumentReading,
  type Proposal,
  type ReadingField,
} from "../../../shared/reading";
import { suggestionStatusLabels, type SuggestionStatus } from "../../../shared/scorecards";
import type { User } from "../../../shared/types";
import { ask, recordSuggestion, replaced, reviewSuggestion } from "../../ai";
import { contractFields } from "../../ai/prompts/contract-fields";
import { audit } from "../../platform/audit";
import { ZodError } from "zod";
import { AppError, notFound } from "../../platform/errors";
import type { AiPort, Db, Queryable } from "../../platform/ports/types";
import { PART_BREAK, partName } from "../../platform/text";
import { changeAgreement, documentText, getAgreement, lockDocument, setReading } from "../agreements/service";
import { listCurrencies } from "../settings/service";

/**
 * Contract reading (E-1): the AI proposes values for an agreement's fields from a document
 * attached to it. The proposal is an AI suggestion about the document; the agreement
 * changes only when a person ticks values and confirms, through the same rules as the
 * edit form, and in one transaction with the record of what they did with the proposal.
 */
export interface ReadingContext {
  db: Db;
  ai: AiPort;
  today: () => Day;
  now: () => Date;
}

const SUBJECT = "document";
const words = (s: SuggestionStatus) => suggestionStatusLabels[s].toLowerCase();
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
/** The part of a document's text that is read: its first stretch, with a blank line where a page or sheet ends. */
const readText = (text: string) => text.slice(0, MAX_READING_CHARS).split(PART_BREAK).join("\n\n");

async function document(db: Queryable, id: string) {
  const doc = await documentText(db, id);
  if (!doc?.agreementId) throw notFound("That document");
  return { ...doc, agreementId: doc.agreementId };
}
/** A document's current reading: the suggestion it points to. Which one is current is written down, never worked out from times. */
const current = async (db: Queryable, doc: { readingSuggestionId: string | null }) =>
  doc.readingSuggestionId ? (await db.select().from(aiSuggestions).where(eq(aiSuggestions.id, doc.readingSuggestionId)))[0] : undefined;

/** The page or sheet a passage stands on. */
function whereIs(doc: { fileName: string; text: string | null }, passage: string): string | null {
  const parts = (doc.text ?? "").split(PART_BREAK);
  const i = parts.findIndex((p) => squash(p).includes(squash(passage)));
  return i < 0 ? null : partName(doc.fileName, i, parts.length, parts[i]!);
}

/** What the agreement holds for a field, and what a read value would be, both as stored and as shown. */
function sides(field: ReadingField, a: AgreementDetail, r: ContractReading, listed: ListedCurrency[]) {
  const currencyWords = (code: string) => {
    const c = listed.find((x) => x.code === code);
    return c ? `${c.name} (${code})` : code;
  };
  const day = (d: string | null) => (d ? formatDay(d) : "Not filled in");
  // An amount is shown in the currency the document names, and otherwise in the agreement's.
  const currency = r.currency?.value ?? a.currency;
  switch (field) {
    case "kind":
      return { current: kindLabels[a.kind], proposed: kindLabels[r.kind!.value], stored: a.kind, value: r.kind!.value as unknown };
    case "title":
      return { current: a.title, proposed: squash(r.title!.value), stored: a.title, value: squash(r.title!.value) as unknown };
    case "signedOn":
    case "startDate":
    case "endDate":
      return { current: day(a[field]), proposed: formatDay(r[field]!.value), stored: a[field], value: r[field]!.value as unknown };
    case "noticePeriodDays":
      return {
        current: a.noticePeriodDays == null ? "Not filled in" : `${a.noticePeriodDays} days`,
        proposed: `${r.noticePeriodDays!.value} days`,
        stored: a.noticePeriodDays,
        value: r.noticePeriodDays!.value as unknown,
      };
    case "amount": {
      const now = a.kind === "sow" ? a.budgetMinor : a.kind === "subscription" ? a.annualValueMinor : null;
      const cents = parseAmount(r.amount!.value);
      // An amount is the number and its currency together: the same number in another currency is another amount.
      const stored = now == null ? null : `${now} ${a.currency}`;
      return {
        current: now == null ? "Not filled in" : formatMoney(now, a.currency),
        proposed: cents == null ? r.amount!.value : formatMoney(cents, currency),
        stored,
        value: `${cents} ${currency}` as unknown,
      };
    }
    case "currency":
      return { current: currencyWords(a.currency), proposed: currencyWords(r.currency!.value), stored: a.currency, value: r.currency!.value as unknown };
  }
}

function build(
  doc: { id: string; fileName: string; text: string | null },
  row: typeof aiSuggestions.$inferSelect,
  a: AgreementDetail,
  listed: ListedCurrency[],
): DocumentReading & { values: Map<ReadingField, Record<string, unknown>> } {
  const answered = row.output as ContractReading;
  // The model's answer is kept as it was given; what is shown and can be used is only what the document bears out.
  const { reading: r, unverified } = verifyReading(readText(doc.text ?? ""), answered, listed);
  const unlisted = !r.amount && answered.amount && unverified.includes("amount") ? unlistedIn(answered.amount.passage, listed) : [];
  const proposals: Proposal[] = [];
  /** What using a field writes to the agreement, by the agreement's own field names. */
  const values = new Map<ReadingField, Record<string, unknown>>();
  const holdsAmount = (a.kind === "sow" ? a.budgetMinor : a.kind === "subscription" ? a.annualValueMinor : null) != null;
  for (const field of readingFields) {
    const read = r[field];
    if (!read) continue;
    const target = targetOf(field, a.kind);
    const s = sides(field, a, r, listed);
    const same = s.stored === s.value;
    let why = "why" in target ? target.why : null;
    // The currency says what the amount is in. Changing it by itself would turn the amount the agreement holds into another amount.
    if (field === "currency" && !same && holdsAmount && !(r.amount && "key" in targetOf("amount", a.kind)))
      why = `The agreement's amount is in ${a.currency}. Changing only the currency would change what that amount means; change both in the edit form.`;
    // The kind is only compared: when it is the same there is nothing to say against it.
    const state = same ? "same" : why ? "not_applicable" : "differs";
    if (state === "differs" && "key" in target) {
      const cents = field === "amount" ? parseAmount(r.amount!.value) : null;
      // An amount is saved with its currency, and a currency with its amount, so the two can never part.
      values.set(field, field === "amount" ? { [target.key]: cents, currency: r.currency!.value } : { [target.key]: s.value });
    }
    proposals.push({
      field,
      label: "key" in target ? target.label : readingLabels[field],
      current: s.current,
      proposed: s.proposed,
      passage: read.passage,
      where: whereIs(doc, read.passage),
      state,
      why: state === "not_applicable" ? why : null,
    });
  }
  return {
    documentId: doc.id,
    fileName: doc.fileName,
    suggestion: {
      id: row.id,
      status: row.status,
      model: row.model,
      createdAt: row.createdAt.toISOString(),
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
    },
    proposals,
    notFound: readingFields.filter((f) => !answered[f] && !r[f]).map((f) => readingLabels[f]),
    // An amount in a currency that is not on the list is named as such, not as a passage that does not state it.
    unverified: unverified.filter((f) => !r[f] && !(unlisted.length && (f === "amount" || f === "currency"))).map((f) => readingLabels[f]),
    unlisted,
    partly: (doc.text ?? "").length > MAX_READING_CHARS,
    values,
  };
}
const shown = ({ values: _values, ...reading }: ReturnType<typeof build>): DocumentReading => reading;

/** The AI's latest reading of each document of an agreement that has one. */
export async function listReadings(ctx: ReadingContext, agreementId: string): Promise<DocumentReading[]> {
  const [a, listed] = await Promise.all([getAgreement(ctx.db, agreementId, ctx.today()), listCurrencies(ctx.db)]);
  const out: DocumentReading[] = [];
  for (const d of a.documents) {
    const doc = await document(ctx.db, d.id);
    const row = await current(ctx.db, doc);
    if (row) out.push(shown(build(doc, row, a, listed)));
  }
  return out;
}

/** Asks the AI to read a document. The model is asked outside any transaction; its answer is stored with a line in the agreement's history. */
export async function readDocument(ctx: ReadingContext, documentId: string, by: User): Promise<DocumentReading> {
  const doc = await document(ctx.db, documentId);
  if (doc.text == null) throw new AppError(409, "not_read_yet", "The app has not read this document's text yet. Try again in a moment.");
  if (!doc.text.trim())
    throw new AppError(409, "no_text", "This document has no text the app can read (a scan, for example), so the AI cannot read it either. Fill the fields in by hand.");
  const text = readText(doc.text);
  const { output, model } = await ask(ctx.ai, contractFields, { fileName: doc.fileName, text }, "read this document");
  return ctx.db.transaction(async (tx) => {
    // One at a time per document: a second reading, or a review, waits here and then sees what this one did.
    await lockDocument(tx, documentId);
    const now = await document(tx, documentId);
    const a = await getAgreement(tx, now.agreementId, ctx.today());
    const before = await current(tx, now);
    // A reading nobody looked at is closed when a newer one takes its place, so nothing stays waiting unseen.
    if (before?.status === "proposed") await reviewSuggestion(tx, before.id, "rejected", "system", ctx.now());
    const row = await recordSuggestion(tx, { prompt: contractFields, subjectType: SUBJECT, subjectId: documentId, model, inputSummary: doc.fileName, output, at: ctx.now() });
    await setReading(tx, documentId, row.id);
    await audit(tx, {
      userEmail: by.email,
      action: "update",
      entityType: "agreement",
      entityId: a.id,
      summary: `${a.vendorName} · ${a.title}`,
      changes: { [`AI reading of ${doc.fileName}`]: { from: null, to: before ? "asked for again" : "asked for" } },
    });
    return shown(build(now, row as typeof aiSuggestions.$inferSelect, a, await listCurrencies(tx)));
  });
}

/**
 * A person uses the ticked values, or rejects the reading (AI-1). The values go through
 * the same rules as the edit form; if any is refused, nothing is changed at all.
 */
export async function reviewReading(ctx: ReadingContext, documentId: string, input: unknown, by: User): Promise<DocumentReading> {
  const review = readingReviewSchema.parse(input);
  await document(ctx.db, documentId);
  return ctx.db.transaction(async (tx) => {
    await lockDocument(tx, documentId);
    const doc = await document(tx, documentId);
    const a = await getAgreement(tx, doc.agreementId, ctx.today());
    const row = await current(tx, doc);
    if (!row) throw new AppError(409, "no_suggestion", "The AI has not read this document. Ask it to first.");
    // The person looked at one reading; if the AI has made another since, that one has not been read.
    if (row.id !== review.suggestionId) throw replaced();
    if (row.status !== "proposed")
      throw new AppError(409, "already_reviewed", "Someone has already used or rejected this reading. Ask the AI to read the document again to start over.");
    const listed = await listCurrencies(tx);
    const reading = build(doc, row, a, listed);
    let status: Exclude<SuggestionStatus, "proposed"> = "rejected";
    /** The labels of the values that were taken over, for the history: afterwards the page can only compare with the agreement as it has become. */
    let taken: string[] = [];
    if (review.action === "apply") {
      const fields = [...new Set(review.fields)];
      const unusable = fields.filter((f) => !reading.values.has(f));
      if (unusable.length)
        throw new AppError(
          409,
          "not_usable",
          `${unusable.map((f) => readingLabels[f]).join(", ")} cannot be used: the agreement already holds it, or this kind of agreement has no such field. Nothing was changed.`,
        );
      // The currency goes with the amount it was read with, whichever of the two was ticked.
      const pair = reading.values.has("amount") && reading.values.has("currency");
      if (pair && fields.includes("amount") !== fields.includes("currency"))
        throw new AppError(400, "currency_needed", "The amount and its currency in the document belong together: tick both, or neither. Nothing was changed.");
      try {
        await changeAgreement(tx, a.id, Object.assign({}, ...fields.map((f) => reading.values.get(f)!)), by, ctx.today());
      } catch (e) {
        if (e instanceof AppError && e.fields)
          throw new AppError(400, "invalid", `These values cannot be used as they are: ${Object.values(e.fields).join(" ")} Nothing was changed.`);
        if (e instanceof ZodError)
          throw new AppError(400, "invalid", "These values cannot be used as they are: one of them is not a value this agreement can hold. Nothing was changed.");
        throw e;
      }
      // Accepted when everything the document says differently was taken over; edited when only part of it was.
      status = fields.length === reading.values.size ? "accepted" : "edited";
      taken = reading.proposals.filter((p) => fields.includes(p.field)).map((p) => p.label);
    }
    await reviewSuggestion(tx, row.id, status, by.email, ctx.now());
    await audit(tx, {
      userEmail: by.email,
      action: "update",
      entityType: "agreement",
      entityId: a.id,
      summary: `${a.vendorName} · ${a.title}`,
      changes: {
        [`AI reading of ${doc.fileName}`]: { from: words("proposed"), to: `${words(status)}${taken.length ? `: ${taken.join(", ").toLowerCase()} taken from the document` : ""}` },
      },
    });
    const after = (await current(tx, doc))!;
    return shown(build(doc, after, await getAgreement(tx, a.id, ctx.today()), listed));
  });
}
