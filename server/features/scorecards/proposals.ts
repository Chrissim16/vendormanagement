import { ask, recordSuggestion, reviewSuggestion } from "../../ai";
import { monthlyProposal, type MonthlyProposalInput } from "../../ai/prompts/monthly-proposal";
import { addMonth, isMonth, metricKeys, monthName, type MetricKey, type Month, type MonthMetrics } from "../../../shared/performance";
import {
  proposalReviewSchema,
  suggestionStatusLabels,
  type Proposal,
  type ProposalScore,
  type ProposalState,
  type ProposalTheme,
  type UsedMetric,
} from "../../../shared/scorecards";
import type { User } from "../../../shared/types";
import { audit } from "../../platform/audit";
import { AppError, notFound } from "../../platform/errors";
import { failFields } from "../../platform/http";
import { currentMonth, figuresFor, linkedVendors, ticketsCreatedIn } from "../performance/service";
import type { ScorecardContext } from "./service";
import * as repo from "./repo";

/** The most tickets of one month the model is given to read. */
const MAX_TICKETS = 250;
/** Proposals are made for months tickets are still held for. */
const KEEP_MONTHS = 24;

const NOT_SCORED = "Scoring is switched off for this vendor.";

type StoredTheme = Omit<ProposalTheme, "examples"> & { examples: { key: string; summary: string }[] };

const toProposal = (ctx: ScorecardContext, r: repo.ProposalRow): Proposal => ({
  id: r.id,
  vendorId: r.vendorId,
  month: r.month,
  status: r.status,
  model: r.model,
  createdAt: r.createdAt.toISOString(),
  reviewedBy: r.reviewedBy,
  reviewedAt: r.reviewedAt?.toISOString() ?? null,
  scores: r.scores as ProposalScore[],
  themes: (r.themes as StoredTheme[]).map((t) => ({ ...t, examples: t.examples.map((e) => ({ ...e, url: ctx.perf.jira.ticketUrl(e.key) })) })),
  ticketsRead: r.ticketsRead,
});

const usedMetrics = (keys: MetricKey[], month: MonthMetrics): UsedMetric[] => keys.map((key) => ({ key, ...month.cells[key] }));

/** What stands in the way of a proposal for this vendor and month, and what the model would be given. */
async function prepare(ctx: ScorecardContext, vendorId: string, month: Month): Promise<{ blocked: string } | { blocked: null; vendorName: string; input: MonthlyProposalInput }> {
  const vendor = await repo.getVendor(ctx.db, vendorId);
  if (!vendor) throw notFound("That vendor");
  const now = currentMonth(ctx.perf);
  if (!vendor.scoringEnabled) return { blocked: NOT_SCORED };
  if (month >= now) return { blocked: "A proposal is made once the month is over, so that it is based on the whole month." };
  if (month < addMonth(now, -KEEP_MONTHS)) return { blocked: "This month is too long ago: its tickets are no longer held." };
  const figures = await figuresFor(ctx.perf, vendorId, [month]);
  if (!figures.hasBoard) return { blocked: "This vendor has no Jira board, so there is nothing for the AI to read. Its scorecard is scored by hand." };
  const criteria = (await repo.listCriteria(ctx.db, true)).filter((c) => c.source === "measured");
  if (!criteria.length) return { blocked: "No criterion is measured from Jira at the moment. An admin can add one." };
  const metrics = figures.months[0]!;
  if (metricKeys.every((k) => metrics.cells[k].valueTenths == null)) return { blocked: "Nothing was measured for this vendor in this month." };
  const tickets = await ticketsCreatedIn(ctx.perf, vendorId, month, MAX_TICKETS);
  return {
    blocked: null,
    vendorName: vendor.name,
    input: {
      vendorName: vendor.name,
      month,
      criteria: criteria.map((c) => ({ id: c.id, name: c.name, description: c.description, metrics: usedMetrics(c.metrics as MetricKey[], metrics) })),
      tickets: tickets.map((t) => ({ key: t.key, summary: t.summary ?? "", description: t.description, level: t.highestLevel, resolved: t.resolvedAt != null })),
    },
  };
}

const monthAsked = (month: string | undefined): Month => {
  if (!isMonth(month)) throw new AppError(400, "invalid", "Choose a month.");
  return month;
};

/** The proposal for a month, or why there is none to ask for (P-1). */
export async function proposalState(ctx: ScorecardContext, vendorId: string, month: string | undefined): Promise<ProposalState> {
  const m = monthAsked(month);
  const ready = await prepare(ctx, vendorId, m);
  // A vendor that is no longer scored shows no proposals either (P-5).
  const row = ready.blocked === NOT_SCORED ? undefined : (await repo.proposalsOf(ctx.db, vendorId, [m]))[0];
  return { month: m, proposal: row ? toProposal(ctx, row) : null, blocked: ready.blocked };
}

/**
 * Asks the AI for a month's proposal and stores it as a suggestion nobody has reviewed.
 * It changes no score anywhere. A proposal a person has already accepted or edited is
 * not replaced. `by` is the person who asked, or "system" for the scheduled run.
 */
export async function generateProposal(ctx: ScorecardContext, vendorId: string, month: string | undefined, by: string): Promise<Proposal> {
  const m = monthAsked(month);
  const ready = await prepare(ctx, vendorId, m);
  if (ready.blocked != null) throw new AppError(409, "no_proposal", ready.blocked);
  const settled = (r: repo.ProposalRow | undefined) => r && (r.status === "accepted" || r.status === "edited");
  const reviewed = () => new AppError(409, "already_reviewed", "This proposal has already been reviewed, so it is kept as it is.");
  if (settled((await repo.proposalsOf(ctx.db, vendorId, [m]))[0])) throw reviewed();

  const { input } = ready;
  const { output, model } = await ask(ctx.ai, monthlyProposal, input, "write a proposal");
  // The model names tickets; the app keeps only those it was really given, and does the counting.
  const known = new Map(input.tickets.map((t) => [t.key, t]));
  const themes: StoredTheme[] = output.themes
    .map((t) => {
      const keys = [...new Set(t.ticketKeys)].filter((k) => known.has(k));
      return { title: t.title, summary: t.summary, tickets: keys.length, examples: keys.slice(0, 3).map((key) => ({ key, summary: known.get(key)!.summary })) };
    })
    .filter((t) => t.tickets >= 2)
    .slice(0, 5);
  const scores: ProposalScore[] = input.criteria.map((c) => {
    const s = output.scores.find((x) => x.criterionId === c.id)!;
    return { criterionId: c.id, criterionName: c.name, score: s.score, aiScore: s.score, reason: s.reason, metrics: c.metrics };
  });

  const id = await ctx.db.transaction(async (tx) => {
    await repo.lockVendor(tx, vendorId);
    const existing = (await repo.proposalsOf(tx, vendorId, [m]))[0];
    if (settled(existing)) throw reviewed();
    // The answer being replaced is closed, so no suggestion is left behind that looks as if it still waits for someone.
    if (existing?.status === "proposed") await reviewSuggestion(tx, existing.suggestionId, "rejected", "system", ctx.now());
    const suggestion = await recordSuggestion(tx, {
      prompt: monthlyProposal,
      subjectType: "vendor",
      subjectId: vendorId,
      model,
      inputSummary: `${monthName(m)}: ${input.criteria.length} criteria, ${input.tickets.length} tickets`,
      output,
      at: ctx.now(),
    });
    const proposalId = await repo.upsertProposal(tx, { vendorId, month: m, suggestionId: suggestion.id, scores, themes, ticketsRead: input.tickets.length });
    await audit(tx, {
      userEmail: by,
      action: "update",
      entityType: "vendor",
      entityId: vendorId,
      summary: ready.vendorName,
      changes: {
        [`AI proposal for ${monthName(m)}`]: {
          from: existing ? suggestionStatusLabels[existing.status].toLowerCase() : null,
          to: existing ? "written again by the AI" : "written by the AI",
        },
      },
    });
    return proposalId;
  });
  return toProposal(ctx, (await repo.getProposal(ctx.db, id))!);
}

/** A person accepts, changes or rejects a proposal (AI-1). The decision can be changed later; each one is in the vendor's history. */
export async function reviewProposal(ctx: ScorecardContext, proposalId: string, input: unknown, by: User): Promise<Proposal> {
  const value = proposalReviewSchema.parse(input);
  const found = await repo.getProposal(ctx.db, proposalId);
  if (!found) throw notFound("That proposal");
  await ctx.db.transaction(async (tx) => {
    // The same lock as writing a proposal takes, so "ask again" and a review of the same month take turns.
    await repo.lockVendor(tx, found.vendorId);
    const row = await repo.getProposal(tx, proposalId);
    if (!row) throw notFound("That proposal");
    const vendor = (await repo.getVendor(tx, row.vendorId))!;
    if (!vendor.scoringEnabled) throw new AppError(409, "not_scored", "Scoring is switched off for this vendor.");
    const scores = row.scores as ProposalScore[];
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    let status: "accepted" | "edited" | "rejected" = value.action === "reject" ? "rejected" : "accepted";
    if (value.action === "edit") {
      for (const change of value.scores) {
        const line = scores.find((s) => s.criterionId === change.criterionId);
        if (!line) failFields({ scores: "That criterion is not part of this proposal." });
        if (line.score !== change.score) changes[`${monthName(row.month)} ${line.criterionName}: proposed score`] = { from: line.score, to: change.score };
        line.score = change.score;
      }
      await repo.setProposalScores(tx, proposalId, scores);
    }
    // "Edited" means a person's score now differs from the AI's.
    if (status === "accepted" && scores.some((s) => s.score !== s.aiScore)) status = "edited";
    if (status !== row.status)
      changes[`AI proposal for ${monthName(row.month)}`] = { from: suggestionStatusLabels[row.status].toLowerCase(), to: suggestionStatusLabels[status].toLowerCase() };
    if (!Object.keys(changes).length) return;
    await reviewSuggestion(tx, row.suggestionId, status, by.email, ctx.now());
    await audit(tx, { userEmail: by.email, action: "update", entityType: "vendor", entityId: row.vendorId, summary: vendor.name, changes });
  });
  return toProposal(ctx, (await repo.getProposal(ctx.db, proposalId))!);
}

export interface ProposalRun {
  vendorName: string;
  month: Month;
  ok: boolean;
  message: string | null;
}
/**
 * The monthly run (P-1): a proposal for last month for every scored vendor with a board
 * that does not have one yet. Safe to run twice; one vendor failing does not stop the others.
 */
export async function runMonthlyProposals(ctx: ScorecardContext): Promise<ProposalRun[]> {
  const month = addMonth(currentMonth(ctx.perf), -1);
  const have = await repo.vendorsWithProposal(ctx.db, month);
  const out: ProposalRun[] = [];
  for (const v of await linkedVendors(ctx.perf)) {
    if (have.has(v.vendorId)) continue;
    try {
      await generateProposal(ctx, v.vendorId, month, "system");
      out.push({ vendorName: v.vendorName, month, ok: true, message: null });
    } catch (e) {
      // Nothing to measure is not a failure; there is simply no proposal to make.
      if (e instanceof AppError && e.code === "no_proposal") continue;
      if (!(e instanceof AppError)) console.error(`Monthly proposal for ${v.vendorName} stopped:`, (e as Error).message);
      out.push({ vendorName: v.vendorName, month, ok: false, message: e instanceof AppError ? e.message : "The proposal could not be saved." });
    }
  }
  return out;
}
