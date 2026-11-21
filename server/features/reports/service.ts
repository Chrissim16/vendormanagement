import { eq, sql } from "drizzle-orm";
import { managementReports } from "../../../db/schema";
import { ask, readSuggestion, recordSuggestion, reviewSuggestion } from "../../ai";
import { reportSummary } from "../../ai/prompts/report-summary";
import { noticeDeadline } from "../../../shared/agreements";
import { addDays, addMonths, daysBetween, type Day } from "../../../shared/dates";
import { REPORT_ENDING_DAYS, reportSaveSchema, suggestionReviewSchema, type ManagementReport, type MissedTarget, type ReportData } from "../../../shared/overview";
import { addMonth, isMonth, metricKeys, monthName, type Month } from "../../../shared/performance";
import { suggestionStatusLabels, type SuggestionStatus } from "../../../shared/scorecards";
import type { User } from "../../../shared/types";
import { audit } from "../../platform/audit";
import { AppError } from "../../platform/errors";
import type { Queryable } from "../../platform/ports/types";
import { agreementsEnding } from "../dashboard/repo";
import { openRfps, sowBudgetRows, vendorScores, type OverviewContext } from "../dashboard/service";
import { getSpend } from "../invoices/service";
import { currentMonth, figuresOfAll } from "../performance/service";

/** Reports are made for months tickets are still held for. */
const KEEP_MONTHS = 24;
type Changes = Record<string, { from: unknown; to: unknown }>;

/** The month asked for: the running month or one of the 24 before it. Without one, the last month that is over. */
export function reportMonth(ctx: OverviewContext, month: string | undefined): Month {
  const now = currentMonth(ctx.perf);
  if (month === undefined) return addMonth(now, -1);
  if (!isMonth(month)) throw new AppError(400, "invalid", "Choose a month.");
  if (month > now) throw new AppError(400, "invalid", "That month has not started yet.");
  if (month < addMonth(now, -KEEP_MONTHS)) throw new AppError(400, "invalid", "That month is too long ago: a report can be made for the last two years.");
  return month;
}

/** Everything the report shows for a month (D-2), worked out from the app's records. */
export async function reportData(ctx: OverviewContext, month: Month): Promise<ReportData> {
  const today = ctx.today();
  const from: Day = `${month}-01`;
  const lastDay = addDays(addMonths(from, 1), -1);
  const running = lastDay >= today;
  const asAt = running ? today : lastDay;
  const [spend, sows, ending, scores, figures, rfps] = await Promise.all([
    getSpend(ctx.db, from, asAt),
    sowBudgetRows(ctx.db, { period: { from, asAt } }),
    agreementsEnding(ctx.db, asAt, addDays(asAt, REPORT_ENDING_DAYS)),
    vendorScores(ctx, asAt),
    figuresOfAll(ctx.perf, [month]),
    openRfps(),
  ]);
  const missed: MissedTarget[] = figures.flatMap((v) =>
    metricKeys
      .filter((k) => v.months[0]!.cells[k].verdict === "missed")
      .map((k) => ({ vendorId: v.vendorId, vendorName: v.vendorName, month, metric: k, valueTenths: v.months[0]!.cells[k].valueTenths!, targetTenths: v.months[0]!.cells[k].targetTenths! })),
  );
  return {
    month,
    asAt,
    running,
    spend: { total: spend.total, byVendor: spend.byVendor, gbpToEurE4: spend.gbpToEurE4 },
    sows,
    ending: ending.map((e) => ({
      agreementId: e.agreementId,
      vendorName: e.vendorName,
      kind: e.kind,
      title: e.title,
      endDate: e.endDate!,
      daysLeft: daysBetween(asAt, e.endDate!),
      noticeDeadline: noticeDeadline({ kind: e.kind, status: "active", endDate: e.endDate, noticePeriodDays: e.noticePeriodDays }),
    })),
    scores,
    missed,
    measuredVendors: figures.filter((v) => metricKeys.some((k) => v.months[0]!.cells[k].valueTenths != null)).length,
    rfps,
  };
}

const rowOf = async (db: Queryable, month: Month) => (await db.select().from(managementReports).where(eq(managementReports.month, month)))[0];
/** Two people working on the same month's summary take turns. */
const lockMonth = (tx: Queryable, month: Month) => tx.execute(sql`select pg_advisory_xact_lock(4205, ${Number(month.replace("-", ""))})`);

async function build(ctx: OverviewContext, month: Month, data?: ReportData): Promise<ManagementReport> {
  const row = await rowOf(ctx.db, month);
  return {
    data: data ?? (await reportData(ctx, month)),
    summary: row?.summary ?? null,
    suggestion: await readSuggestion<{ summary: string }>(ctx.db, row?.suggestionId ?? null),
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

export const getReport = (ctx: OverviewContext, month: string | undefined): Promise<ManagementReport> => build(ctx, reportMonth(ctx, month));

const label = (month: Month) => `Management report ${monthName(month)}`;
const words = (s: SuggestionStatus) => suggestionStatusLabels[s].toLowerCase();

/** Creates the month's record when it is first needed and returns it. Inside a transaction, after `lockMonth`. */
async function ensure(tx: Queryable, month: Month, by: string) {
  const existing = await rowOf(tx, month);
  if (existing) return existing;
  return (await tx.insert(managementReports).values({ month, createdBy: by, updatedBy: by }).returning())[0]!;
}

/**
 * Asks the AI for the summary paragraph and stores it as a suggestion nobody has reviewed.
 * The report's own summary is not touched. A suggestion still waiting is replaced.
 */
export async function suggestSummary(ctx: OverviewContext, monthAsked: string | undefined, by: User): Promise<ManagementReport> {
  const month = reportMonth(ctx, monthAsked);
  const data = await reportData(ctx, month);
  const { output, model } = await ask(ctx.ai, reportSummary, data, "write a summary");
  await ctx.db.transaction(async (tx) => {
    await lockMonth(tx, month);
    const row = await ensure(tx, month, by.email);
    const before = await readSuggestion(tx, row.suggestionId);
    // The answer being replaced is closed, so nothing is left that looks as if it still waits for someone.
    if (before?.status === "proposed") await reviewSuggestion(tx, before.id, "rejected", "system", ctx.now());
    const suggestion = await recordSuggestion(tx, {
      prompt: reportSummary,
      subjectType: "report",
      subjectId: row.id,
      model,
      inputSummary: `${monthName(month)}: ${data.sows.length} SOWs, ${data.ending.length} agreements ending, ${data.scores.length} scores, ${data.missed.length} missed targets`,
      output,
      at: ctx.now(),
    });
    await tx.update(managementReports).set({ suggestionId: suggestion.id }).where(eq(managementReports.id, row.id));
    await audit(tx, {
      userEmail: by.email,
      action: "update",
      entityType: "report",
      entityId: row.id,
      summary: label(month),
      changes: { "AI summary": { from: before ? words(before.status) : null, to: before ? "written again by the AI" : "written by the AI" } },
    });
  });
  return build(ctx, month, data);
}

/** "Edited" means the person's text now differs from the AI's; taking it over unchanged is "accepted". */
const afterSave = (status: SuggestionStatus, mine: string | null, ai: string): SuggestionStatus =>
  status === "accepted" || status === "edited" ? ((mine ?? "") === ai ? "accepted" : "edited") : status;

/** Saves the summary as a person wrote it. This is what the PDF prints. */
export async function saveReport(ctx: OverviewContext, monthAsked: string | undefined, input: unknown, by: User): Promise<ManagementReport> {
  const month = reportMonth(ctx, monthAsked);
  const value = reportSaveSchema.parse(input);
  await ctx.db.transaction(async (tx) => {
    await lockMonth(tx, month);
    const row = await ensure(tx, month, by.email);
    const changes: Changes = {};
    if ((row.summary ?? null) !== value.summary) changes.Summary = { from: row.summary, to: value.summary };
    const suggestion = await readSuggestion<{ summary: string }>(tx, row.suggestionId);
    if (suggestion) {
      const status = afterSave(suggestion.status, value.summary, suggestion.output.summary);
      if (status !== suggestion.status) {
        await reviewSuggestion(tx, suggestion.id, status as "accepted" | "edited", by.email, ctx.now());
        changes["AI summary"] = { from: words(suggestion.status), to: words(status) };
      }
    }
    if (!Object.keys(changes).length) return;
    await tx.update(managementReports).set({ summary: value.summary, updatedAt: new Date(), updatedBy: by.email }).where(eq(managementReports.id, row.id));
    await audit(tx, { userEmail: by.email, action: "update", entityType: "report", entityId: row.id, summary: label(month), changes });
  });
  return build(ctx, month);
}

/** A person takes the AI's summary over as it is, or rejects it (AI-1). */
export async function reviewSummary(ctx: OverviewContext, monthAsked: string | undefined, input: unknown, by: User): Promise<ManagementReport> {
  const month = reportMonth(ctx, monthAsked);
  const { action } = suggestionReviewSchema.parse(input);
  await ctx.db.transaction(async (tx) => {
    await lockMonth(tx, month);
    const row = await rowOf(tx, month);
    const suggestion = await readSuggestion<{ summary: string }>(tx, row?.suggestionId ?? null);
    if (!row || !suggestion) throw new AppError(409, "no_suggestion", "There is no AI summary for this month. Ask the AI for one first.");
    const status: SuggestionStatus = action === "accept" ? "accepted" : "rejected";
    const changes: Changes = {};
    if (status !== suggestion.status) changes["AI summary"] = { from: words(suggestion.status), to: words(status) };
    if (action === "accept" && row.summary !== suggestion.output.summary) changes.Summary = { from: row.summary, to: suggestion.output.summary };
    if (!Object.keys(changes).length) return;
    await reviewSuggestion(tx, suggestion.id, status as "accepted" | "rejected", by.email, ctx.now());
    if (changes.Summary) await tx.update(managementReports).set({ summary: suggestion.output.summary, updatedAt: new Date(), updatedBy: by.email }).where(eq(managementReports.id, row.id));
    await audit(tx, { userEmail: by.email, action: "update", entityType: "report", entityId: row.id, summary: label(month), changes });
  });
  return build(ctx, month);
}
