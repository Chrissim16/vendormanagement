import { desc, eq, sql } from "drizzle-orm";
import { aiSuggestions, briefings, vendors } from "../../../db/schema";
import { ask, AiUnavailable, readSuggestion, recordSuggestion, reviewSuggestion } from "../../ai";
import { briefing as briefingPrompt } from "../../ai/prompts/briefing";
import { agreementName, type Agreement } from "../../../shared/agreements";
import { addDays, daysBetween, formatDay } from "../../../shared/dates";
import {
  BRIEFING_DATES_DAYS,
  BRIEFING_MONTHS,
  briefingSaveSchema,
  metricTrend,
  pointsOf,
  pointsText,
  suggestionReviewSchema,
  type Briefing,
  type BriefingDate,
  type BriefingFacts,
  type BriefingHeader,
  type BriefingText,
  type MetricTrend,
} from "../../../shared/overview";
import { addMonth, metricKeys, monthsUpTo, type MetricKey } from "../../../shared/performance";
import { suggestionStatusLabels, type SuggestionStatus } from "../../../shared/scorecards";
import type { User } from "../../../shared/types";
import { audit } from "../../platform/audit";
import { AppError, notFound } from "../../platform/errors";
import type { Queryable } from "../../platform/ports/types";
import { listAgreements } from "../agreements/service";
import { sowBudgetRows, vendorScores, type OverviewContext } from "../dashboard/service";
import { defaultPeriod, getSpend } from "../invoices/service";
import { replaced } from "../reports/service";
import { currentMonth, figuresFor } from "../performance/service";
import { getDelivery } from "../sow/service";
import { getVendor } from "../vendors/service";
import { listAttention } from "../warnings/service";

type Changes = Record<string, { from: unknown; to: unknown }>;

/**
 * Everything a briefing says about a vendor (B-1), worked out from the app's records as
 * they stand today. It is stored with the briefing, so the briefing keeps saying what was
 * true on the day it was prepared.
 */
export async function gatherFacts(ctx: OverviewContext, vendorId: string): Promise<BriefingFacts> {
  const today = ctx.today();
  const vendor = await getVendor(ctx.db, vendorId, today);
  const period = defaultPeriod(today);
  const months = monthsUpTo(addMonth(currentMonth(ctx.perf), -1), BRIEFING_MONTHS);
  const [all, budgets, spend, figures, scores, flags] = await Promise.all([
    agreementsOf(ctx, vendorId),
    sowBudgetRows(ctx.db, { vendorId }),
    getSpend(ctx.db, period.from, period.to),
    figuresFor(ctx.perf, vendorId, months),
    vendor.scoringEnabled ? vendorScores(ctx, today, vendorId) : [],
    listAttention(ctx.perf, [vendorId]),
  ]);
  const agreements = all.filter((a) => a.status !== "ended");
  const until = addDays(today, BRIEFING_DATES_DAYS);
  const soon = (day: string) => day >= today && day <= until;
  const dates: Omit<BriefingDate, "daysLeft">[] = [];
  const milestones: BriefingFacts["milestones"] = [];
  const changeRequests: BriefingFacts["changeRequests"] = [];
  for (const a of agreements.filter((x) => x.status === "active")) {
    const name = agreementName(a.kind, a.title);
    // A notice deadline matters until someone has decided about the term, also once it has passed.
    if (a.noticeDeadline && !a.decidedForTerm && a.noticeDeadline <= until) dates.push({ date: a.noticeDeadline, what: `Last day to give notice on ${name}`, agreementId: a.id });
    if (a.endDate && (soon(a.endDate) || (a.kind === "sow" && a.endDate < today)))
      dates.push({
        date: a.endDate,
        what: a.kind === "subscription" ? `${name} renews` : a.kind === "sow" ? `${name} ends` : `${name} is valid until this day`,
        agreementId: a.id,
      });
    if (a.kind !== "sow") continue;
    const delivery = await getDelivery(ctx.db, a.id, today);
    for (const m of delivery.milestones.filter((x) => x.status === "open")) {
      milestones.push({ sowId: a.id, sowTitle: a.title, title: m.title, dueDate: m.dueDate, daysLate: m.daysLate });
      if (m.dueDate <= until) dates.push({ date: m.dueDate, what: `Milestone "${m.title}" is due (${a.title})`, agreementId: a.id });
    }
    for (const c of delivery.changeRequests.filter((x) => x.status === "proposed"))
      changeRequests.push({
        sowId: a.id,
        sowTitle: a.title,
        title: c.title,
        requestedOn: c.requestedOn,
        budgetChangeMinor: c.budgetChangeMinor,
        newEndDate: c.newEndDate,
        currency: a.currency,
      });
  }
  const invoiced = spend.byVendor.find((v) => v.vendorId === vendorId);
  const shown = figures.hasBoard ? figures.months.map(({ month, cells }) => ({ month, cells })) : null;
  const [before, latest] = [shown?.at(-2), shown?.at(-1)];
  return {
    asAt: today,
    vendor: { name: vendor.name, type: vendor.type, status: vendor.status, ownerName: vendor.ownerName, nda: vendor.nda, dpa: vendor.dpa, scoringEnabled: vendor.scoringEnabled },
    agreements: agreements.map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      status: a.status,
      startDate: a.startDate,
      endDate: a.endDate,
      valueMinor: a.budgetMinor ?? a.annualValueMinor ?? null,
      currency: a.currency,
    })),
    dates: dates.map((d) => ({ ...d, daysLeft: daysBetween(today, d.date) })).sort((a, b) => a.date.localeCompare(b.date) || a.what.localeCompare(b.what)),
    budgets: budgets.map(({ vendorId: _v, vendorName: _n, ...b }) => b),
    spend: { from: period.from, to: period.to, total: invoiced ? { EUR: invoiced.EUR, GBP: invoiced.GBP, eurMinor: invoiced.eurMinor } : { EUR: 0, GBP: 0, eurMinor: 0 } },
    performance: shown && {
      months: shown,
      trends: Object.fromEntries(metricKeys.map((k) => [k, metricTrend(k, before?.cells[k].valueTenths ?? null, latest?.cells[k].valueTenths ?? null)])) as Record<
        MetricKey,
        MetricTrend
      >,
    },
    missed: (shown ?? []).flatMap((m) =>
      metricKeys
        .filter((k) => m.cells[k].verdict === "missed")
        .map((k) => ({ month: m.month, metric: k, valueTenths: m.cells[k].valueTenths!, targetTenths: m.cells[k].targetTenths! })),
    ),
    score: scores[0]
      ? {
          quarter: scores[0].quarter,
          overallTenths: scores[0].overallTenths,
          previousQuarter: scores[0].previousQuarter,
          previousTenths: scores[0].previousTenths,
          trend: scores[0].trend,
        }
      : null,
    milestones: milestones.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    changeRequests,
    flags: flags.map(({ type, tone, label, title, detail }) => ({ type, tone, label, title, detail })),
  };
}

/** Every agreement of the vendor, however many there are. */
async function agreementsOf(ctx: OverviewContext, vendorId: string): Promise<Agreement[]> {
  const out: Agreement[] = [];
  for (let page = 1; page < 50; page++) {
    const { items, total } = await listAgreements(ctx.db, { vendorId, sort: "title", dir: "asc", page, pageSize: 200 }, ctx.today());
    out.push(...items);
    if (out.length >= total || !items.length) break;
  }
  return out;
}

const columns = {
  briefing: briefings,
  vendorName: vendors.name,
  suggestionStatus: aiSuggestions.status,
};
const rows = (db: Queryable) =>
  db.select(columns).from(briefings).innerJoin(vendors, eq(vendors.id, briefings.vendorId)).leftJoin(aiSuggestions, eq(aiSuggestions.id, briefings.suggestionId));
type Row = Awaited<ReturnType<typeof rows>>[number];

const header = ({ briefing: b, vendorName, suggestionStatus }: Row): BriefingHeader => ({
  id: b.id,
  vendorId: b.vendorId,
  vendorName,
  asAt: b.asAt,
  createdAt: b.createdAt.toISOString(),
  createdBy: b.createdBy,
  hasText: !!(b.summary || b.talkingPoints),
  suggestionStatus,
});

async function find(db: Queryable, id: string): Promise<Row> {
  const row = (await rows(db).where(eq(briefings.id, id)))[0];
  if (!row) throw notFound("That briefing");
  return row;
}
const build = async (db: Queryable, row: Row): Promise<Briefing> => ({
  ...header(row),
  facts: row.briefing.facts as BriefingFacts,
  summary: row.briefing.summary,
  talkingPoints: row.briefing.talkingPoints,
  suggestion: await readSuggestion<BriefingText>(db, row.briefing.suggestionId),
  updatedAt: row.briefing.updatedAt.toISOString(),
  updatedBy: row.briefing.updatedBy,
});

export const getBriefing = async (ctx: OverviewContext, id: string): Promise<Briefing> => build(ctx.db, await find(ctx.db, id));

/** A vendor's briefings, newest first. */
export async function listBriefings(ctx: OverviewContext, vendorId: string): Promise<BriefingHeader[]> {
  return (await rows(ctx.db).where(eq(briefings.vendorId, vendorId)).orderBy(desc(briefings.createdAt), desc(briefings.id))).map(header);
}

const label = (vendorName: string, asAt: string) => `${vendorName} briefing ${formatDay(asAt)}`;
const words = (s: SuggestionStatus) => suggestionStatusLabels[s].toLowerCase();
const lock = (tx: Queryable, id: string) => tx.execute(sql`select 1 from briefings where id = ${id} for update`);

/** Asks the AI; when it cannot answer, the briefing is still made, without its text (AI-2). */
async function tryAsk(ctx: OverviewContext, facts: BriefingFacts) {
  try {
    return { answer: await ask(ctx.ai, briefingPrompt, facts, "write the summary and talking points"), problem: null };
  } catch (e) {
    if (e instanceof AiUnavailable) return { answer: null, problem: e.message };
    throw e;
  }
}
const inputSummary = (f: BriefingFacts) =>
  `${f.vendor.name} as at ${formatDay(f.asAt)}: ${f.agreements.length} agreements, ${f.budgets.length} budgets, ${f.missed.length} missed targets, ${f.flags.length} warnings and flags`;

/**
 * Prepares a briefing: gathers the facts, asks the AI for a summary and talking points,
 * and stores both. The AI's text is a suggestion nobody has reviewed; the briefing's own
 * summary and talking points stay empty until a person takes it over or writes their own.
 */
export async function createBriefing(ctx: OverviewContext, vendorId: string, by: User): Promise<{ briefing: Briefing; aiProblem: string | null }> {
  const facts = await gatherFacts(ctx, vendorId);
  const { answer, problem } = await tryAsk(ctx, facts);
  const id = await ctx.db.transaction(async (tx) => {
    const row = (await tx.insert(briefings).values({ vendorId, asAt: facts.asAt, facts, createdBy: by.email, updatedBy: by.email }).returning())[0]!;
    if (answer) {
      const suggestion = await recordSuggestion(tx, {
        prompt: briefingPrompt,
        subjectType: "briefing",
        subjectId: row.id,
        model: answer.model,
        inputSummary: inputSummary(facts),
        output: answer.output,
        at: ctx.now(),
      });
      await tx.update(briefings).set({ suggestionId: suggestion.id }).where(eq(briefings.id, row.id));
    }
    await audit(tx, {
      userEmail: by.email,
      action: "create",
      entityType: "briefing",
      entityId: row.id,
      summary: label(facts.vendor.name, facts.asAt),
      changes: { "AI summary and talking points": { from: null, to: answer ? "written by the AI" : "the AI could not answer" } },
    });
    return row.id;
  });
  return { briefing: await getBriefing(ctx, id), aiProblem: problem };
}

/** Asks the AI again, from the facts the briefing holds. Not once a person has taken its text over. */
export async function suggestAgain(ctx: OverviewContext, id: string, by: User): Promise<Briefing> {
  const found = await find(ctx.db, id);
  const taken = (s: SuggestionStatus | null) => s === "accepted" || s === "edited";
  const kept = () => new AppError(409, "already_reviewed", "The AI's text has already been taken over in this briefing, so it is kept. Prepare a new briefing for a fresh one.");
  if (taken(found.suggestionStatus)) throw kept();
  const facts = found.briefing.facts as BriefingFacts;
  const { output, model } = await ask(ctx.ai, briefingPrompt, facts, "write the summary and talking points");
  await ctx.db.transaction(async (tx) => {
    await lock(tx, id);
    const row = await find(tx, id);
    if (taken(row.suggestionStatus)) throw kept();
    if (row.suggestionStatus === "proposed") await reviewSuggestion(tx, row.briefing.suggestionId!, "rejected", "system", ctx.now());
    const suggestion = await recordSuggestion(tx, {
      prompt: briefingPrompt,
      subjectType: "briefing",
      subjectId: id,
      model,
      inputSummary: inputSummary(facts),
      output,
      at: ctx.now(),
    });
    await tx.update(briefings).set({ suggestionId: suggestion.id }).where(eq(briefings.id, id));
    await audit(tx, {
      userEmail: by.email,
      action: "update",
      entityType: "briefing",
      entityId: id,
      summary: label(row.vendorName, row.briefing.asAt),
      changes: {
        "AI summary and talking points": {
          from: row.suggestionStatus ? words(row.suggestionStatus) : null,
          to: row.suggestionStatus ? "written again by the AI" : "written by the AI",
        },
      },
    });
  });
  return getBriefing(ctx, id);
}

const same = (mine: { summary: string | null; talkingPoints: string | null }, ai: BriefingText) =>
  (mine.summary ?? "") === ai.summary.trim() && pointsText(pointsOf(mine.talkingPoints)) === pointsText(pointsOf(pointsText(ai.talkingPoints)));

/** Saves the summary and talking points as a person wrote them. This is what the PDF prints. */
export async function saveBriefing(ctx: OverviewContext, id: string, input: unknown, by: User): Promise<Briefing> {
  const value = briefingSaveSchema.parse(input);
  await find(ctx.db, id);
  await ctx.db.transaction(async (tx) => {
    await lock(tx, id);
    const row = await find(tx, id);
    const changes: Changes = {};
    if ((row.briefing.summary ?? null) !== value.summary) changes.Summary = { from: row.briefing.summary, to: value.summary };
    if ((row.briefing.talkingPoints ?? null) !== value.talkingPoints) changes["Talking points"] = { from: row.briefing.talkingPoints, to: value.talkingPoints };
    const suggestion = await readSuggestion<BriefingText>(tx, row.briefing.suggestionId);
    // "Edited" means the person's text now differs from the AI's.
    if (suggestion && (suggestion.status === "accepted" || suggestion.status === "edited")) {
      const status = same(value, suggestion.output) ? "accepted" : "edited";
      if (status !== suggestion.status) {
        await reviewSuggestion(tx, suggestion.id, status, by.email, ctx.now());
        changes["AI summary and talking points"] = { from: words(suggestion.status), to: words(status) };
      }
    }
    if (!Object.keys(changes).length) return;
    await tx.update(briefings).set({ summary: value.summary, talkingPoints: value.talkingPoints, updatedAt: new Date(), updatedBy: by.email }).where(eq(briefings.id, id));
    await audit(tx, { userEmail: by.email, action: "update", entityType: "briefing", entityId: id, summary: label(row.vendorName, row.briefing.asAt), changes });
  });
  return getBriefing(ctx, id);
}

/** A person takes the AI's summary and talking points over as they are, or rejects them (AI-1). */
export async function reviewBriefing(ctx: OverviewContext, id: string, input: unknown, by: User): Promise<Briefing> {
  const { action, suggestionId } = suggestionReviewSchema.parse(input);
  await find(ctx.db, id);
  await ctx.db.transaction(async (tx) => {
    await lock(tx, id);
    const row = await find(tx, id);
    const suggestion = await readSuggestion<BriefingText>(tx, row.briefing.suggestionId);
    if (!suggestion) throw new AppError(409, "no_suggestion", "There is no AI text for this briefing. Ask the AI for it first.");
    // The person reviewed one text; if the AI has written another since, that one has not been read.
    if (suggestion.id !== suggestionId) throw replaced();
    const status: SuggestionStatus = action === "accept" ? "accepted" : "rejected";
    const changes: Changes = {};
    if (status !== suggestion.status) changes["AI summary and talking points"] = { from: words(suggestion.status), to: words(status) };
    const ai = { summary: suggestion.output.summary.trim(), talkingPoints: pointsText(suggestion.output.talkingPoints) };
    if (action === "accept") {
      if (row.briefing.summary !== ai.summary) changes.Summary = { from: row.briefing.summary, to: ai.summary };
      if (row.briefing.talkingPoints !== ai.talkingPoints) changes["Talking points"] = { from: row.briefing.talkingPoints, to: ai.talkingPoints };
    }
    if (!Object.keys(changes).length) return;
    await reviewSuggestion(tx, suggestion.id, status as "accepted" | "rejected", by.email, ctx.now());
    if (action === "accept")
      await tx
        .update(briefings)
        .set({ ...ai, updatedAt: new Date(), updatedBy: by.email })
        .where(eq(briefings.id, id));
    await audit(tx, { userEmail: by.email, action: "update", entityType: "briefing", entityId: id, summary: label(row.vendorName, row.briefing.asAt), changes });
  });
  return getBriefing(ctx, id);
}

/** Removes a briefing. An AI text nobody had looked at is closed, so nothing is left waiting. */
export async function removeBriefing(ctx: OverviewContext, id: string, by: User): Promise<void> {
  await find(ctx.db, id);
  await ctx.db.transaction(async (tx) => {
    await lock(tx, id);
    const row = await find(tx, id);
    if (row.suggestionStatus === "proposed") await reviewSuggestion(tx, row.briefing.suggestionId!, "rejected", "system", ctx.now());
    await tx.delete(briefings).where(eq(briefings.id, id));
    await audit(tx, { userEmail: by.email, action: "delete", entityType: "briefing", entityId: id, summary: label(row.vendorName, row.briefing.asAt) });
  });
}
