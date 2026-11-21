import { eq } from "drizzle-orm";
import { aiSuggestions } from "../../../db/schema";
import { kindLabels, type AgreementDetail } from "../../../shared/agreements";
import { formatDay, type Day } from "../../../shared/dates";
import { formatMoney, parseAmount, type Currency } from "../../../shared/money";
import {
  MAX_READING_CHARS,
  readingFields,
  readingLabels,
  readingReviewSchema,
  targetOf,
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
import { AppError, notFound } from "../../platform/errors";
import type { AiPort, Db, Queryable } from "../../platform/ports/types";
import { PART_BREAK, partName } from "../../platform/text";
import { changeAgreement, documentText, getAgreement, setReading } from "../agreements/service";

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
const currencyWords: Record<Currency, string> = { EUR: "Euro (EUR)", GBP: "Pound sterling (GBP)" };
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

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
function sides(field: ReadingField, a: AgreementDetail, r: ContractReading) {
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
      return {
        current: now == null ? "Not filled in" : formatMoney(now, a.currency),
        proposed: cents == null ? r.amount!.value : formatMoney(cents, currency),
        stored: now,
        value: cents as unknown,
      };
    }
    case "currency":
      return { current: currencyWords[a.currency], proposed: currencyWords[r.currency!.value], stored: a.currency, value: r.currency!.value as unknown };
  }
}

function build(
  doc: { id: string; fileName: string; text: string | null },
  row: typeof aiSuggestions.$inferSelect,
  a: AgreementDetail,
): DocumentReading & { values: Map<ReadingField, { key: string; value: unknown }> } {
  const r = row.output as ContractReading;
  const proposals: Proposal[] = [];
  const values = new Map<ReadingField, { key: string; value: unknown }>();
  for (const field of readingFields) {
    const read = r[field];
    if (!read) continue;
    const target = targetOf(field, a.kind);
    const s = sides(field, a, r);
    const same = s.stored === s.value;
    // The kind is only compared: when it is the same there is nothing to say against it.
    const state = same ? "same" : "why" in target ? "not_applicable" : "differs";
    if (state === "differs" && "key" in target) values.set(field, { key: target.key, value: s.value });
    proposals.push({
      field,
      label: "key" in target ? target.label : readingLabels[field],
      current: s.current,
      proposed: s.proposed,
      passage: read.passage,
      where: whereIs(doc, read.passage),
      state,
      why: state === "not_applicable" && "why" in target ? target.why : null,
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
    notFound: readingFields.filter((f) => !r[f]).map((f) => readingLabels[f]),
    partly: (doc.text ?? "").length > MAX_READING_CHARS,
    values,
  };
}
const shown = ({ values: _values, ...reading }: ReturnType<typeof build>): DocumentReading => reading;

/** The AI's latest reading of each document of an agreement that has one. */
export async function listReadings(ctx: ReadingContext, agreementId: string): Promise<DocumentReading[]> {
  const a = await getAgreement(ctx.db, agreementId, ctx.today());
  const out: DocumentReading[] = [];
  for (const d of a.documents) {
    const doc = await document(ctx.db, d.id);
    const row = await current(ctx.db, doc);
    if (row) out.push(shown(build(doc, row, a)));
  }
  return out;
}

/** Asks the AI to read a document. The model is asked outside any transaction; its answer is stored with a line in the agreement's history. */
export async function readDocument(ctx: ReadingContext, documentId: string, by: User): Promise<DocumentReading> {
  const doc = await document(ctx.db, documentId);
  if (doc.text == null) throw new AppError(409, "not_read_yet", "The app has not read this document's text yet. Try again in a moment.");
  if (!doc.text.trim())
    throw new AppError(409, "no_text", "This document has no text the app can read (a scan, for example), so the AI cannot read it either. Fill the fields in by hand.");
  // Parts are named in the text itself, so the model sees where a page ends.
  const text = doc.text.slice(0, MAX_READING_CHARS).split(PART_BREAK).join("\n\n");
  const { output, model } = await ask(ctx.ai, contractFields, { fileName: doc.fileName, text }, "read this document");
  return ctx.db.transaction(async (tx) => {
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
      changes: { [`AI reading of ${doc.fileName}`]: { from: before ? words(before.status === "proposed" ? "rejected" : before.status) : null, to: "asked for" } },
    });
    return shown(build(now, row as typeof aiSuggestions.$inferSelect, a));
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
    const doc = await document(tx, documentId);
    const a = await getAgreement(tx, doc.agreementId, ctx.today());
    const row = await current(tx, doc);
    if (!row) throw new AppError(409, "no_suggestion", "The AI has not read this document. Ask it to first.");
    // The person looked at one reading; if the AI has made another since, that one has not been read.
    if (row.id !== review.suggestionId) throw replaced();
    if (row.status !== "proposed")
      throw new AppError(409, "already_reviewed", "Someone has already used or rejected this reading. Ask the AI to read the document again to start over.");
    const reading = build(doc, row, a);
    let status: Exclude<SuggestionStatus, "proposed"> = "rejected";
    if (review.action === "apply") {
      const fields = [...new Set(review.fields)];
      const unusable = fields.filter((f) => !reading.values.has(f));
      if (unusable.length)
        throw new AppError(
          409,
          "not_usable",
          `${unusable.map((f) => readingLabels[f]).join(", ")} cannot be used: the agreement already holds it, or this kind of agreement has no such field. Nothing was changed.`,
        );
      if (fields.includes("amount") && reading.values.has("currency") && !fields.includes("currency"))
        throw new AppError(
          400,
          "currency_needed",
          "The amount in the document is in another currency than the agreement. Tick the currency as well, or leave the amount out. Nothing was changed.",
        );
      try {
        await changeAgreement(tx, a.id, Object.fromEntries(fields.map((f) => [reading.values.get(f)!.key, reading.values.get(f)!.value])), by, ctx.today());
      } catch (e) {
        if (e instanceof AppError && e.fields)
          throw new AppError(400, "invalid", `These values cannot be used as they are: ${Object.values(e.fields).join(" ")} Nothing was changed.`);
        throw e;
      }
      // Accepted when everything the document says differently was taken over; edited when only part of it was.
      status = fields.length === reading.values.size ? "accepted" : "edited";
    }
    await reviewSuggestion(tx, row.id, status, by.email, ctx.now());
    await audit(tx, {
      userEmail: by.email,
      action: "update",
      entityType: "agreement",
      entityId: a.id,
      summary: `${a.vendorName} · ${a.title}`,
      changes: { [`AI reading of ${doc.fileName}`]: { from: words("proposed"), to: words(status) } },
    });
    const after = (await current(tx, doc))!;
    return shown(build(doc, after, await getAgreement(tx, a.id, ctx.today())));
  });
}
