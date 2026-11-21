import type { Day } from "../../../shared/dates";
import { metricKeys, type MetricKey, type Month } from "../../../shared/performance";
import {
  checkCriterion,
  criterionSchema,
  overallTenths,
  quarterBounds,
  quarterName,
  quarterOf,
  scorecardSaveSchema,
  startScorecardSchema,
  suggestedScore,
  unscored,
  type Criterion,
  type Facts,
  type LineSuggestion,
  type ProposalScore,
  type QuarterMonth,
  type Scorecard,
  type ScorecardDetail,
  type ScorecardLine,
} from "../../../shared/scorecards";
import { budgetView } from "../../../shared/sow";
import type { Page, User } from "../../../shared/types";
import { audit } from "../../platform/audit";
import { AppError, notFound } from "../../platform/errors";
import { failFields, isUniqueViolation } from "../../platform/http";
import type { AiPort, Db, Queryable } from "../../platform/ports/types";
import { currentMonth, figuresFor, type PerformanceContext } from "../performance/service";
import { getVendor } from "../vendors/service";
import * as repo from "./repo";

/** What the scorecards feature needs from the app around it. */
export interface ScorecardContext {
  db: Db;
  ai: AiPort;
  perf: PerformanceContext;
  today: () => Day;
  now: () => Date;
}
type Changes = Record<string, { from: unknown; to: unknown }>;

// ---------- Criteria (P-7)

const toCriterion = (c: repo.CriterionRow): Criterion => ({
  id: c.id,
  name: c.name,
  description: c.description,
  weight: c.weight,
  source: c.source,
  metrics: c.metrics as MetricKey[],
  active: c.active,
});
export const listCriteria = async (ctx: ScorecardContext): Promise<Criterion[]> => (await repo.listCriteria(ctx.db)).map(toCriterion);

const metricList = (keys: string[]) => (keys.length ? [...keys].sort().join(", ") : null);

/**
 * Adds a criterion, or changes one. How a criterion is scored (measured or by hand) is
 * fixed once it exists. Final scorecards are not touched: they carry their own copy.
 */
export async function saveCriterion(ctx: ScorecardContext, id: string | null, input: unknown, by: User): Promise<Criterion> {
  const value = criterionSchema.parse(input);
  const errors = checkCriterion(value);
  if (Object.keys(errors).length) failFields(errors);
  // A criterion scored by hand is not judged from figures.
  const metrics = value.source === "measured" ? metricKeys.filter((k) => value.metrics.includes(k)) : [];
  try {
    return await ctx.db.transaction(async (tx) => {
      await repo.lockCriteria(tx);
      const all = await repo.listCriteria(tx);
      if (!id) {
        const row = await repo.insertCriterion(tx, { ...value, metrics }, Math.max(0, ...all.map((c) => c.sortOrder)) + 1, by.email);
        await audit(tx, {
          userEmail: by.email,
          action: "create",
          entityType: "criterion",
          entityId: row.id,
          summary: row.name,
          changes: { weight: { from: null, to: row.weight }, "scored by": { from: null, to: row.source === "measured" ? "figures from Jira" : "the reviewer" } },
        });
        return toCriterion(row);
      }
      const before = all.find((c) => c.id === id);
      if (!before) throw notFound("That criterion");
      if (value.source !== before.source) failFields({ source: "How a criterion is scored cannot be changed afterwards. Switch this one off and add a new one." });
      if (before.active && !value.active && all.filter((c) => c.active).length === 1) failFields({ active: "This is the only criterion in use. A scorecard needs at least one." });
      const changes: Changes = {};
      const note = (label: string, from: unknown, to: unknown) => {
        if (from !== to) changes[label] = { from, to };
      };
      note("name", before.name, value.name);
      note("description", before.description, value.description || null);
      note("weight", before.weight, value.weight);
      note("figures it is judged from", metricList(before.metrics), metricList(metrics));
      note("in use", before.active, value.active);
      if (!Object.keys(changes).length) return toCriterion(before);
      const row = await repo.updateCriterion(tx, id, { name: value.name, description: value.description, weight: value.weight, metrics, active: value.active }, by.email);
      await audit(tx, { userEmail: by.email, action: "update", entityType: "criterion", entityId: id, summary: row.name, changes });
      return toCriterion(row);
    });
  } catch (e) {
    if (isUniqueViolation(e)) failFields({ name: "There is already a criterion with this name." });
    throw e;
  }
}

// ---------- Reading a scorecard

/** What a final scorecard keeps of the moment it was finalised, so later changes to criteria, targets or agreements do not alter it (P-7). */
interface Snapshot {
  vendorName: string;
  hasBoard: boolean;
  lines: Pick<ScorecardLine, "criterionId" | "name" | "description" | "weight" | "source" | "metrics" | "suggestion">[];
  facts: Facts;
  helpdesk: QuarterMonth[] | null;
}

/** Budgets kept, milestones on time and the paperwork: what the app knows that helps score by hand (P-2, P-4). */
export async function factsFor(ctx: ScorecardContext, db: Queryable, vendorId: string, start: Day, end: Day): Promise<Facts> {
  const today = ctx.today();
  const [sows, due, vendor] = await Promise.all([repo.sowBudgets(db, vendorId, start, end), repo.milestonesDue(db, vendorId, start, end), getVendor(db, vendorId, today)]);
  const items = sows.map((s) => {
    const view = budgetView(s.budgetMinor, Number(s.invoicedMinor), 100);
    return { agreementId: s.agreementId, title: s.title, usedPct: view.usedPct, over: view.state === "over" };
  });
  const delivered = due.filter((m) => m.status === "delivered");
  const late = delivered.filter((m) => (m.deliveredOn ?? m.dueDate) > m.dueDate).length;
  const open = due.filter((m) => m.status === "open");
  const overdue = open.filter((m) => m.dueDate < today).length;
  return {
    budgets: { sows: items.length, within: items.filter((i) => !i.over).length, over: items.filter((i) => i.over).length, items },
    milestones: { due: due.length, onTime: delivered.length - late, late, overdue, open: open.length - overdue },
    nda: vendor.nda,
    dpa: vendor.dpa,
  };
}

/** The quarter's helpdesk figures, and what the monthly proposals suggest per criterion. */
async function quarterEvidence(ctx: ScorecardContext, vendorId: string, months: Month[]) {
  const figures = await figuresFor(ctx.perf, vendorId, months);
  const now = currentMonth(ctx.perf);
  const helpdesk: QuarterMonth[] | null = figures.hasBoard ? figures.months.map((m) => ({ month: m.month, complete: m.month < now, cells: m.cells })) : null;
  // A rejected proposal suggests nothing.
  const proposals = figures.hasBoard ? (await repo.proposalsOf(ctx.db, vendorId, months)).filter((p) => p.status !== "rejected") : [];
  const suggestionFor = (criterionId: string): LineSuggestion | null => {
    const perMonth = proposals.flatMap((p) => {
      const s = (p.scores as ProposalScore[]).find((x) => x.criterionId === criterionId);
      return s ? [{ month: p.month, score: s.score, reason: s.reason, status: p.status }] : [];
    });
    const score = suggestedScore(perMonth.map((m) => m.score));
    return score == null ? null : { score, months: perMonth };
  };
  return { hasBoard: figures.hasBoard, helpdesk, suggestionFor };
}

const quarterOfCard = (card: { periodStart: Day }) => quarterOf(card.periodStart);

function header(row: repo.CardRow, lines: { score: number | null; weight: number }[]): Scorecard {
  const { card } = row;
  return {
    id: card.id,
    vendorId: card.vendorId,
    vendorName: row.vendorName,
    quarter: quarterOfCard(card),
    periodStart: card.periodStart,
    periodEnd: card.periodEnd,
    status: card.status,
    reviewerName: row.reviewerName,
    overallTenths: overallTenths(lines),
    scored: lines.filter((l) => l.score != null).length,
    criteria: lines.length,
    finalisedAt: card.finalisedAt?.toISOString() ?? null,
    updatedAt: card.updatedAt.toISOString(),
  };
}

/** A draft follows the criteria in use today; a final scorecard shows what it was finalised with. */
async function build(ctx: ScorecardContext, row: repo.CardRow): Promise<ScorecardDetail> {
  const { card } = row;
  const saved = new Map((await repo.linesOf(ctx.db, [card.id])).map((l) => [l.criterionId, l]));
  const snapshot = card.status === "final" ? (card.snapshot as Snapshot | null) : null;
  let parts: Snapshot;
  if (snapshot) parts = snapshot;
  else {
    const [criteria, evidence, facts] = await Promise.all([
      repo.listCriteria(ctx.db, true),
      quarterEvidence(ctx, card.vendorId, quarterBounds(quarterOfCard(card)).months),
      factsFor(ctx, ctx.db, card.vendorId, card.periodStart, card.periodEnd),
    ]);
    parts = {
      vendorName: row.vendorName,
      hasBoard: evidence.hasBoard,
      facts,
      helpdesk: evidence.helpdesk,
      lines: criteria.map((c) => ({
        criterionId: c.id,
        name: c.name,
        description: c.description,
        weight: c.weight,
        source: c.source,
        metrics: c.metrics as MetricKey[],
        suggestion: c.source === "measured" ? evidence.suggestionFor(c.id) : null,
      })),
    };
  }
  const lines: ScorecardLine[] = parts.lines.map((l) => {
    const s = saved.get(l.criterionId);
    const score = s?.score ?? null;
    return {
      ...l,
      score,
      vendorComment: s?.vendorComment ?? null,
      internalNote: s?.internalNote ?? null,
      // Taken from the AI only while the score still is what the AI suggested when it was accepted.
      acceptedSuggestion: !!s?.acceptedSuggestion && score != null && s.suggestedScore === score,
    };
  });
  return {
    ...header({ ...row, vendorName: snapshot ? snapshot.vendorName : row.vendorName }, lines),
    summary: card.summary,
    finalisedBy: card.finalisedBy,
    hasBoard: parts.hasBoard,
    lines,
    facts: parts.facts,
    helpdesk: parts.helpdesk,
  };
}

async function find(ctx: ScorecardContext, id: string): Promise<repo.CardRow> {
  const row = await repo.getCard(ctx.db, id);
  // A vendor that is not scored has no scorecards (P-5); they come back when scoring is switched on again.
  if (!row || !row.scoringEnabled) throw notFound("That scorecard");
  return row;
}

export const getScorecard = async (ctx: ScorecardContext, id: string): Promise<ScorecardDetail> => build(ctx, await find(ctx, id));

export async function listScorecards(ctx: ScorecardContext, filter: repo.CardFilter): Promise<Page<Scorecard>> {
  const { items, total } = await repo.listCards(ctx.db, filter);
  const [lines, criteria] = await Promise.all([
    repo.linesOf(
      ctx.db,
      items.map((i) => i.card.id),
    ),
    repo.listCriteria(ctx.db, true),
  ]);
  return {
    total,
    items: items.map((row) => {
      const mine = new Map(lines.filter((l) => l.scorecardId === row.card.id).map((l) => [l.criterionId, l.score]));
      const snapshot = row.card.status === "final" ? (row.card.snapshot as Snapshot | null) : null;
      const using = snapshot ? snapshot.lines.map((l) => ({ id: l.criterionId, weight: l.weight })) : criteria;
      return header(
        row,
        using.map((c) => ({ score: mine.get(c.id) ?? null, weight: c.weight })),
      );
    }),
  };
}

// ---------- Changing a scorecard (P-2, P-3, P-4)

const title = (row: { vendorName: string; card: { periodStart: Day } }) => `${row.vendorName} ${quarterName(quarterOfCard(row.card))}`;
const readOnly = () => new AppError(409, "final", "This scorecard is final and can no longer be changed. An admin can reopen it.");

/** Starts a draft for a vendor and a quarter. The person who starts it is its reviewer. */
export async function startScorecard(ctx: ScorecardContext, input: unknown, by: User): Promise<ScorecardDetail> {
  const value = startScorecardSchema.parse(input);
  const vendor = await repo.getVendor(ctx.db, value.vendorId);
  if (!vendor) failFields({ vendorId: "That vendor was not found." });
  if (!vendor.scoringEnabled) failFields({ vendorId: "Scoring is switched off for this vendor, so it has no scorecards. Switch scoring on in the vendor's details first." });
  const { start, end } = quarterBounds(value.quarter);
  if (start > ctx.today()) failFields({ quarter: "That quarter has not started yet." });
  try {
    const card = await ctx.db.transaction(async (tx) => {
      const row = await repo.insertCard(tx, { vendorId: vendor.id, periodStart: start, periodEnd: end, reviewerUserId: by.id }, by.email);
      await audit(tx, { userEmail: by.email, action: "create", entityType: "scorecard", entityId: row.id, summary: title({ vendorName: vendor.name, card: row }) });
      return row;
    });
    return getScorecard(ctx, card.id);
  } catch (e) {
    if (isUniqueViolation(e)) failFields({ quarter: `${vendor.name} already has a scorecard for ${quarterName(value.quarter)}.` });
    throw e;
  }
}

/** Saves scores, comments and notes on a draft. Lines that are not sent stay as they are. */
export async function saveScorecard(ctx: ScorecardContext, id: string, input: unknown, by: User): Promise<ScorecardDetail> {
  const value = scorecardSaveSchema.parse(input);
  const current = await build(ctx, await find(ctx, id));
  if (current.status === "final") throw readOnly();
  const known = new Map(current.lines.map((l) => [l.criterionId, l]));
  await ctx.db.transaction(async (tx) => {
    const card = await repo.lockCard(tx, id);
    if (!card) throw notFound("That scorecard");
    if (card.status === "final") throw readOnly();
    const changes: Changes = {};
    const note = (label: string, from: unknown, to: unknown) => {
      if ((from ?? null) !== (to ?? null)) changes[label] = { from: from ?? null, to: to ?? null };
    };
    // What is stored now, read under the lock: a line is changed only in the parts that were sent.
    const stored = new Map((await repo.linesOf(tx, [id])).map((l) => [l.criterionId, l]));
    for (const sent of value.lines) {
      const line = known.get(sent.criterionId);
      if (!line) failFields({ lines: "One of the criteria is no longer in use. Reload the page." });
      const was = stored.get(line.criterionId);
      const before = { score: was?.score ?? null, vendorComment: was?.vendorComment ?? null, internalNote: was?.internalNote ?? null };
      const next = {
        score: sent.score === undefined ? before.score : sent.score,
        vendorComment: sent.vendorComment === undefined ? before.vendorComment : sent.vendorComment || null,
        internalNote: sent.internalNote === undefined ? before.internalNote : sent.internalNote || null,
      };
      const scored = sent.score !== undefined;
      // "Accepted" only holds when the score really is what the AI suggests. A line whose score was not sent keeps what it had.
      const accepted = scored ? sent.acceptedSuggestion && next.score != null && line.suggestion?.score === next.score : (was?.acceptedSuggestion ?? false);
      const suggested = scored ? (line.suggestion?.score ?? null) : (was?.suggestedScore ?? null);
      note(`${line.name}: score`, before.score, next.score);
      note(`${line.name}: comment for the vendor`, before.vendorComment, next.vendorComment);
      note(`${line.name}: internal note`, before.internalNote, next.internalNote);
      if (before.score !== next.score && line.suggestion)
        note(`${line.name}: AI suggestion`, null, accepted ? `accepted (${line.suggestion.score})` : `${line.suggestion.score}, not followed`);
      await repo.upsertLine(tx, { scorecardId: id, criterionId: line.criterionId, ...next, suggestedScore: suggested, acceptedSuggestion: accepted }, by.email);
    }
    if (value.summary !== undefined) note("summary", card.summary, value.summary || null);
    if (!Object.keys(changes).length) return;
    await repo.updateCard(tx, id, value.summary !== undefined ? { summary: value.summary || null } : {}, by.email);
    await audit(tx, { userEmail: by.email, action: "update", entityType: "scorecard", entityId: id, summary: `${current.vendorName} ${quarterName(current.quarter)}`, changes });
  });
  return getScorecard(ctx, id);
}

/** Makes a draft final (P-3). Every criterion in use needs a score. What the scorecard shows is frozen from this moment. */
export async function finaliseScorecard(ctx: ScorecardContext, id: string, by: User): Promise<ScorecardDetail> {
  const row = await find(ctx, id);
  const detail = await build(ctx, row);
  if (detail.status === "final") return detail;
  await ctx.db.transaction(async (tx) => {
    const card = await repo.lockCard(tx, id);
    if (!card) throw notFound("That scorecard");
    if (card.status === "final") return;
    // Read the scores again under the lock: a save may have landed since the page was built.
    const saved = new Map((await repo.linesOf(tx, [id])).map((l) => [l.criterionId, l.score]));
    const lines = detail.lines.map((l) => ({ ...l, score: saved.get(l.criterionId) ?? null }));
    const missing = unscored(lines);
    if (missing.length)
      throw new AppError(
        409,
        "not_scored_yet",
        `${missing.length === 1 ? "One criterion has" : `${missing.length} criteria have`} no score yet: ${missing.join(", ")}. Score every criterion before finalising.`,
      );
    const snapshot: Snapshot = {
      vendorName: detail.vendorName,
      hasBoard: detail.hasBoard,
      facts: detail.facts,
      helpdesk: detail.helpdesk,
      lines: detail.lines.map(({ criterionId, name, description, weight, source, metrics, suggestion }) => ({
        criterionId,
        name,
        description,
        weight,
        source,
        metrics,
        suggestion,
      })),
    };
    await repo.updateCard(tx, id, { status: "final", finalisedAt: ctx.now(), finalisedBy: by.email, snapshot }, by.email);
    await audit(tx, {
      userEmail: by.email,
      action: "update",
      entityType: "scorecard",
      entityId: id,
      summary: title(row),
      changes: { status: { from: "draft", to: "final" }, "overall score": { from: null, to: (overallTenths(lines)! / 10).toFixed(1) } },
    });
  });
  return getScorecard(ctx, id);
}

/** Admin only: a final scorecard becomes a draft again, and follows today's criteria and figures until it is finalised anew. */
export async function reopenScorecard(ctx: ScorecardContext, id: string, by: User): Promise<ScorecardDetail> {
  const row = await find(ctx, id);
  await ctx.db.transaction(async (tx) => {
    const card = await repo.lockCard(tx, id);
    if (!card) throw notFound("That scorecard");
    if (card.status !== "final") throw new AppError(409, "not_final", "This scorecard is a draft already.");
    await repo.updateCard(tx, id, { status: "draft", finalisedAt: null, finalisedBy: null, snapshot: null }, by.email);
    await audit(tx, { userEmail: by.email, action: "update", entityType: "scorecard", entityId: id, summary: title(row), changes: { status: { from: "final", to: "draft" } } });
  });
  return getScorecard(ctx, id);
}

/** Removes a draft started by mistake. A final scorecard is never removed. */
export async function removeScorecard(ctx: ScorecardContext, id: string, by: User): Promise<void> {
  const row = await find(ctx, id);
  await ctx.db.transaction(async (tx) => {
    const card = await repo.lockCard(tx, id);
    if (!card) throw notFound("That scorecard");
    if (card.status === "final") throw readOnly();
    await repo.deleteCard(tx, id);
    await audit(tx, { userEmail: by.email, action: "delete", entityType: "scorecard", entityId: id, summary: title(row) });
  });
}
