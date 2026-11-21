import { and, asc, eq, gte, ilike, inArray, isNotNull, lte, ne, or, isNull, sql } from "drizzle-orm";
import { agreements, aiSuggestions, milestones, monthlyProposals, scorecardCriteria, scorecardLines, scorecards, users, vendors } from "../../../db/schema";
import type { Day } from "../../../shared/dates";
import type { Month } from "../../../shared/performance";
import type { CriterionInput, ScorecardStatus } from "../../../shared/scorecards";
import { like } from "../../platform/http";
import type { Queryable } from "../../platform/ports/types";

// ---------- Criteria

export type CriterionRow = typeof scorecardCriteria.$inferSelect;
export const listCriteria = (db: Queryable, onlyActive = false) =>
  db
    .select()
    .from(scorecardCriteria)
    .where(onlyActive ? eq(scorecardCriteria.active, true) : undefined)
    .orderBy(asc(scorecardCriteria.sortOrder), asc(scorecardCriteria.createdAt), asc(scorecardCriteria.id));
export const getCriterion = async (db: Queryable, id: string) => (await db.select().from(scorecardCriteria).where(eq(scorecardCriteria.id, id)))[0];
/** One at a time: adding and switching off criteria check each other's work. */
export const lockCriteria = (tx: Queryable) => tx.execute(sql`select pg_advisory_xact_lock(4204)`);
export const insertCriterion = async (db: Queryable, c: CriterionInput, sortOrder: number, by: string) =>
  (
    await db
      .insert(scorecardCriteria)
      .values({ ...c, description: c.description || null, sortOrder, createdBy: by, updatedBy: by })
      .returning()
  )[0]!;
export const updateCriterion = async (db: Queryable, id: string, c: Omit<CriterionInput, "source">, by: string) =>
  (
    await db
      .update(scorecardCriteria)
      .set({ ...c, description: c.description || null, updatedAt: new Date(), updatedBy: by })
      .where(eq(scorecardCriteria.id, id))
      .returning()
  )[0]!;

// ---------- Vendors

export const getVendor = async (db: Queryable, id: string) =>
  (await db.select({ id: vendors.id, name: vendors.name, scoringEnabled: vendors.scoringEnabled }).from(vendors).where(eq(vendors.id, id)))[0];
export const lockVendor = (tx: Queryable, id: string) => tx.execute(sql`select 1 from vendors where id = ${id} for update`);

// ---------- Monthly proposals

const proposalColumns = {
  id: monthlyProposals.id,
  vendorId: monthlyProposals.vendorId,
  month: monthlyProposals.month,
  suggestionId: monthlyProposals.suggestionId,
  scores: monthlyProposals.scores,
  themes: monthlyProposals.themes,
  ticketsRead: monthlyProposals.ticketsRead,
  status: aiSuggestions.status,
  model: aiSuggestions.model,
  createdAt: aiSuggestions.createdAt,
  reviewedBy: aiSuggestions.reviewedBy,
  reviewedAt: aiSuggestions.reviewedAt,
};
const proposals = (db: Queryable) => db.select(proposalColumns).from(monthlyProposals).innerJoin(aiSuggestions, eq(aiSuggestions.id, monthlyProposals.suggestionId));
export type ProposalRow = Awaited<ReturnType<typeof proposalsOf>>[number];
export const proposalsOf = (db: Queryable, vendorId: string, months: Month[]) =>
  months.length
    ? proposals(db)
        .where(and(eq(monthlyProposals.vendorId, vendorId), inArray(monthlyProposals.month, months)))
        .orderBy(asc(monthlyProposals.month))
    : Promise.resolve([]);
export const getProposal = async (db: Queryable, id: string) => (await proposals(db).where(eq(monthlyProposals.id, id)))[0];
export const lockProposal = (tx: Queryable, id: string) => tx.execute(sql`select 1 from monthly_proposals where id = ${id} for update`);
export const vendorsWithProposal = async (db: Queryable, month: Month) =>
  new Set((await db.select({ vendorId: monthlyProposals.vendorId }).from(monthlyProposals).where(eq(monthlyProposals.month, month))).map((r) => r.vendorId));
export const upsertProposal = async (tx: Queryable, p: { vendorId: string; month: Month; suggestionId: string; scores: unknown; themes: unknown; ticketsRead: number }) =>
  (
    await tx
      .insert(monthlyProposals)
      .values(p)
      .onConflictDoUpdate({
        target: [monthlyProposals.vendorId, monthlyProposals.month],
        set: { suggestionId: p.suggestionId, scores: p.scores, themes: p.themes, ticketsRead: p.ticketsRead, createdAt: new Date() },
      })
      .returning({ id: monthlyProposals.id })
  )[0]!.id;
export const setProposalScores = (tx: Queryable, id: string, scores: unknown) => tx.update(monthlyProposals).set({ scores }).where(eq(monthlyProposals.id, id));

// ---------- Scorecards

const cardColumns = {
  card: scorecards,
  vendorName: vendors.name,
  scoringEnabled: vendors.scoringEnabled,
  reviewerName: sql<string>`coalesce(${users.displayName}, ${users.email})`,
};
const cards = (db: Queryable) =>
  db.select(cardColumns).from(scorecards).innerJoin(vendors, eq(vendors.id, scorecards.vendorId)).innerJoin(users, eq(users.id, scorecards.reviewerUserId));
export type CardRow = NonNullable<Awaited<ReturnType<typeof getCard>>>;
export const getCard = async (db: Queryable, id: string) => (await cards(db).where(eq(scorecards.id, id)))[0];
/** Locks the scorecard so a save and a finalise take turns. Use inside a transaction. */
export async function lockCard(tx: Queryable, id: string) {
  await tx.execute(sql`select 1 from scorecards where id = ${id} for update`);
  return (await tx.select().from(scorecards).where(eq(scorecards.id, id)))[0];
}

const sorts = {
  quarter: [scorecards.periodStart, sql`lower(${vendors.name})`],
  vendor: [sql`lower(${vendors.name})`, scorecards.periodStart],
  status: [scorecards.status, scorecards.periodStart],
  updated: [scorecards.updatedAt],
};
export type CardSort = keyof typeof sorts;
export const cardSorts = Object.keys(sorts) as CardSort[];
export interface CardFilter {
  vendorId?: string;
  status?: ScorecardStatus;
  q?: string;
  sort: CardSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}
/** Scorecards of vendors that are scored. A vendor with scoring switched off keeps its scorecards out of sight (P-5). */
export async function listCards(db: Queryable, f: CardFilter) {
  const where = and(
    eq(vendors.scoringEnabled, true),
    f.vendorId ? eq(scorecards.vendorId, f.vendorId) : undefined,
    f.status ? eq(scorecards.status, f.status) : undefined,
    f.q ? ilike(vendors.name, like(f.q)) : undefined,
  );
  const order = sorts[f.sort].map((c) => (f.dir === "desc" ? sql`${c} desc` : sql`${c} asc`));
  const [items, total] = await Promise.all([
    cards(db)
      .where(where)
      .orderBy(...order, asc(scorecards.id))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(scorecards)
      .innerJoin(vendors, eq(vendors.id, scorecards.vendorId))
      .where(where),
  ]);
  return { items, total: total[0]?.n ?? 0 };
}
export const insertCard = async (tx: Queryable, c: { vendorId: string; periodStart: Day; periodEnd: Day; reviewerUserId: string }, by: string) =>
  (
    await tx
      .insert(scorecards)
      .values({ ...c, createdBy: by, updatedBy: by })
      .returning()
  )[0]!;
export const updateCard = (tx: Queryable, id: string, c: Partial<typeof scorecards.$inferInsert>, by: string) =>
  tx
    .update(scorecards)
    .set({ ...c, updatedAt: new Date(), updatedBy: by })
    .where(eq(scorecards.id, id));
export const deleteCard = (tx: Queryable, id: string) => tx.delete(scorecards).where(eq(scorecards.id, id));

export type LineRow = typeof scorecardLines.$inferSelect;
export const linesOf = (db: Queryable, cardIds: string[]) =>
  cardIds.length ? db.select().from(scorecardLines).where(inArray(scorecardLines.scorecardId, cardIds)) : Promise.resolve([] as LineRow[]);
export const upsertLine = (
  tx: Queryable,
  l: {
    scorecardId: string;
    criterionId: string;
    score: number | null;
    vendorComment: string | null;
    internalNote: string | null;
    suggestedScore: number | null;
    acceptedSuggestion: boolean;
  },
  by: string,
) =>
  tx
    .insert(scorecardLines)
    .values({ ...l, createdBy: by, updatedBy: by })
    .onConflictDoUpdate({
      target: [scorecardLines.scorecardId, scorecardLines.criterionId],
      set: {
        score: l.score,
        vendorComment: l.vendorComment,
        internalNote: l.internalNote,
        suggestedScore: l.suggestedScore,
        acceptedSuggestion: l.acceptedSuggestion,
        updatedAt: new Date(),
        updatedBy: by,
      },
    });

// ---------- Facts for scoring by hand

/** SOWs with a budget that were running at some point in the period, with what was invoiced on them up to its end. */
export const sowBudgets = (db: Queryable, vendorId: string, start: Day, end: Day) =>
  db
    .select({
      agreementId: agreements.id,
      title: agreements.title,
      budgetMinor: agreements.budgetMinor,
      // Written out with table names: inside a sub-select, bare column names would both be read as the invoice's own.
      invoicedMinor: sql<number>`(select coalesce(sum(i.amount_minor), 0) from invoices i where i.agreement_id = "agreements"."id" and i.invoice_date <= ${end})::float8`,
    })
    .from(agreements)
    .where(
      and(
        eq(agreements.vendorId, vendorId),
        eq(agreements.kind, "sow"),
        inArray(agreements.status, ["active", "ended"]),
        isNotNull(agreements.budgetMinor),
        or(isNull(agreements.startDate), lte(agreements.startDate, end)),
        or(isNull(agreements.endDate), gte(agreements.endDate, start)),
      ),
    )
    .orderBy(sql`lower(${agreements.title})`);

/** The vendor's milestones due in the period, cancelled ones left out. */
export const milestonesDue = (db: Queryable, vendorId: string, start: Day, end: Day) =>
  db
    .select({ status: milestones.status, dueDate: milestones.dueDate, deliveredOn: milestones.deliveredOn })
    .from(milestones)
    .innerJoin(agreements, eq(agreements.id, milestones.sowId))
    .where(and(eq(agreements.vendorId, vendorId), gte(milestones.dueDate, start), lte(milestones.dueDate, end), ne(milestones.status, "cancelled")));
