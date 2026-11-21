import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { jiraBoardLinks, performanceTargets, tickets, vendors } from "../../../db/schema";
import type { BoardLinkInput, MetricKey, Month, MonthCounts, TicketSet } from "../../../shared/performance";
import { like } from "../../platform/http";
import type { JiraTicket, Queryable } from "../../platform/ports/types";

export type LinkRow = typeof jiraBoardLinks.$inferSelect;

// ---------- Board links

const linkColumns = { link: jiraBoardLinks, vendorName: vendors.name, scoringEnabled: vendors.scoringEnabled };
export const listLinks = (db: Queryable) =>
  db
    .select(linkColumns)
    .from(jiraBoardLinks)
    .innerJoin(vendors, eq(vendors.id, jiraBoardLinks.vendorId))
    .orderBy(sql`lower(${vendors.name})`);
export const getLink = async (db: Queryable, id: string) =>
  (await db.select(linkColumns).from(jiraBoardLinks).innerJoin(vendors, eq(vendors.id, jiraBoardLinks.vendorId)).where(eq(jiraBoardLinks.id, id)))[0];
export const linkOfVendor = async (db: Queryable, vendorId: string) => (await db.select().from(jiraBoardLinks).where(eq(jiraBoardLinks.vendorId, vendorId)))[0];
export const linkOfBoard = async (db: Queryable, projectKey: string) =>
  (
    await db
      .select(linkColumns)
      .from(jiraBoardLinks)
      .innerJoin(vendors, eq(vendors.id, jiraBoardLinks.vendorId))
      .where(sql`upper(${jiraBoardLinks.projectKey}) = ${projectKey.toUpperCase()}`)
  )[0];
/** Locks the link so two syncs, or a sync and an edit, take turns. Use inside a transaction. */
export async function lockLink(tx: Queryable, id: string) {
  await tx.execute(sql`select 1 from jira_board_links where id = ${id} for update`);
  return (await tx.select().from(jiraBoardLinks).where(eq(jiraBoardLinks.id, id)))[0];
}
export const insertLink = async (db: Queryable, vendorId: string, v: BoardLinkInput & { projectName: string }, by: string) =>
  (
    await db
      .insert(jiraBoardLinks)
      .values({ ...v, vendorId, createdBy: by, updatedBy: by })
      .returning()
  )[0]!;
export const updateLink = async (db: Queryable, id: string, v: Partial<typeof jiraBoardLinks.$inferInsert>, by?: string) =>
  (
    await db
      .update(jiraBoardLinks)
      .set(by ? { ...v, updatedAt: new Date(), updatedBy: by } : v)
      .where(eq(jiraBoardLinks.id, id))
      .returning()
  )[0]!;

export async function ticketCounts(db: Queryable, linkIds: string[]): Promise<Map<string, number>> {
  if (!linkIds.length) return new Map();
  const rows = await db
    .select({ id: tickets.boardLinkId, n: sql<number>`count(*)::int` })
    .from(tickets)
    .where(inArray(tickets.boardLinkId, linkIds))
    .groupBy(tickets.boardLinkId);
  return new Map(rows.map((r) => [r.id, r.n]));
}

export const getVendor = async (db: Queryable, id: string) =>
  (await db.select({ id: vendors.id, name: vendors.name, scoringEnabled: vendors.scoringEnabled, status: vendors.status }).from(vendors).where(eq(vendors.id, id)))[0];
/** Lock the vendor so two people changing its board or targets take turns. */
export const lockVendor = (tx: Queryable, id: string) => tx.execute(sql`select 1 from vendors where id = ${id} for update`);
/** Scored vendors still in use that have no board. */
export const scoredWithoutBoard = (db: Queryable) =>
  db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .leftJoin(jiraBoardLinks, eq(jiraBoardLinks.vendorId, vendors.id))
    .where(and(eq(vendors.scoringEnabled, true), inArray(vendors.status, ["active", "on_hold"]), isNull(jiraBoardLinks.id)))
    .orderBy(sql`lower(${vendors.name})`);

// ---------- Tickets

const CHUNK = 400;
/** Adds the tickets or overwrites the copies already held. */
export async function upsertTickets(tx: Queryable, linkId: string, rows: (JiraTicket & { highestLevel: number })[], at: Date) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await tx
      .insert(tickets)
      .values(
        rows.slice(i, i + CHUNK).map((t) => ({
          boardLinkId: linkId,
          key: t.key,
          summary: t.summary,
          description: t.description,
          status: t.status,
          createdAt: t.createdAt,
          resolvedAt: t.resolvedAt,
          firstResponseAt: t.firstResponseAt,
          firstResponseBreached: t.firstResponseBreached,
          resolutionBreached: t.resolutionBreached,
          highestLevel: t.highestLevel,
          csat: t.csat,
          csatAt: t.csatAt,
          statusesSeen: t.statusesSeen.map((s) => s.toLowerCase()),
          labelsSeen: t.labelsSeen.map((s) => s.toLowerCase()),
          syncedAt: at,
        })),
      )
      .onConflictDoUpdate({
        target: [tickets.boardLinkId, tickets.key],
        set: Object.fromEntries(
          (
            [
              ["summary", "summary"],
              ["description", "description"],
              ["status", "status"],
              ["createdAt", "created_at"],
              ["resolvedAt", "resolved_at"],
              ["firstResponseAt", "first_response_at"],
              ["firstResponseBreached", "first_response_breached"],
              ["resolutionBreached", "resolution_breached"],
              ["highestLevel", "highest_level"],
              ["csat", "csat"],
              ["csatAt", "csat_at"],
              ["statusesSeen", "statuses_seen"],
              ["labelsSeen", "labels_seen"],
              ["syncedAt", "synced_at"],
            ] as const
          ).map(([field, column]) => [field, sql.raw(`excluded.${column}`)]),
        ),
      });
  }
}
export const deleteTicketsOf = (tx: Queryable, linkId: string) => tx.delete(tickets).where(eq(tickets.boardLinkId, linkId));
/**
 * Removes the open tickets a sync did not see. Every sync is given all unresolved tickets,
 * so one that did not come back has been deleted, moved to another board or hidden in Jira.
 */
export async function deleteOpenNotSeen(tx: Queryable, linkId: string, seen: Set<string>) {
  const open = await tx
    .select({ id: tickets.id, key: tickets.key })
    .from(tickets)
    .where(and(eq(tickets.boardLinkId, linkId), isNull(tickets.resolvedAt)));
  const gone = open.filter((t) => !seen.has(t.key)).map((t) => t.id);
  for (let i = 0; i < gone.length; i += 1000) await tx.delete(tickets).where(inArray(tickets.id, gone.slice(i, i + 1000)));
}
/** Tickets are kept for 24 months after they were resolved. */
export const deleteResolvedBefore = (tx: Queryable, linkId: string, cutoff: Date) => tx.delete(tickets).where(and(eq(tickets.boardLinkId, linkId), lt(tickets.resolvedAt, cutoff)));
export const seenValues = (tx: Queryable, linkId: string) =>
  tx
    .select({ id: tickets.id, highestLevel: tickets.highestLevel, statusesSeen: tickets.statusesSeen, labelsSeen: tickets.labelsSeen })
    .from(tickets)
    .where(eq(tickets.boardLinkId, linkId));
export async function setLevels(tx: Queryable, ids: string[], level: number) {
  for (let i = 0; i < ids.length; i += 1000)
    await tx
      .update(tickets)
      .set({ highestLevel: level })
      .where(inArray(tickets.id, ids.slice(i, i + 1000)));
}

// ---------- The month, and which tickets each figure counts

interface Bounds {
  start: SQL;
  end: SQL;
  /** The moment the backlog is measured: the end of the month, or now while the month is running. */
  asOf: SQL;
}
/** A month runs from midnight to midnight in the team's time zone. */
export function monthBounds(month: Month, timeZone: string, now: Date): Bounds {
  const first = `${month}-01`;
  const end = sql`((${first}::date + interval '1 month')::timestamp at time zone ${timeZone})`;
  return { start: sql`(${first}::date::timestamp at time zone ${timeZone})`, end, asOf: sql`least(${end}, ${now.toISOString()}::timestamptz)` };
}

/**
 * The one definition of every set of tickets behind a figure. The monthly counts and the
 * ticket lists both use it, so a number and the list it opens can never disagree (J-3).
 */
export function inSet(set: TicketSet, b: Bounds): SQL {
  const createdInMonth = sql`${tickets.createdAt} >= ${b.start} and ${tickets.createdAt} < ${b.end}`;
  const resolvedInMonth = sql`${tickets.resolvedAt} >= ${b.start} and ${tickets.resolvedAt} < ${b.end}`;
  switch (set) {
    case "fr_measured":
      return sql`(${createdInMonth} and ${tickets.firstResponseBreached} is not null)`;
    case "fr_met":
      return sql`(${createdInMonth} and ${tickets.firstResponseBreached} = false)`;
    case "fr_missed":
      return sql`(${createdInMonth} and ${tickets.firstResponseBreached} = true)`;
    case "resolved":
      return sql`(${resolvedInMonth})`;
    case "first_line":
      return sql`(${resolvedInMonth} and ${tickets.highestLevel} = 1)`;
    case "escalated":
      return sql`(${resolvedInMonth} and ${tickets.highestLevel} > 1)`;
    case "breached":
      return sql`(${resolvedInMonth} and ${tickets.resolutionBreached} = true)`;
    case "backlog":
      return sql`(${tickets.createdAt} < ${b.asOf} and (${tickets.resolvedAt} is null or ${tickets.resolvedAt} >= ${b.asOf}))`;
    case "rated":
      return sql`(${tickets.csat} is not null and ${tickets.csatAt} >= ${b.start} and ${tickets.csatAt} < ${b.end})`;
  }
}

/** The counts of one month for each of the given boards. A board with no tickets at all is absent. */
export async function monthCounts(db: Queryable, linkIds: string[], month: Month, timeZone: string, now: Date): Promise<Map<string, MonthCounts>> {
  if (!linkIds.length) return new Map();
  const b = monthBounds(month, timeZone, now);
  const count = (set: TicketSet) => sql<number>`(count(*) filter (where ${inSet(set, b)}))::int`;
  const ageDays = sql`floor(extract(epoch from (${b.asOf} - ${tickets.createdAt})) / 86400)`;
  const rows = await db
    .select({
      linkId: tickets.boardLinkId,
      frMeasured: count("fr_measured"),
      frMet: count("fr_met"),
      frMedianMinutes: sql<
        number | null
      >`(percentile_cont(0.5) within group (order by (extract(epoch from (${tickets.firstResponseAt} - ${tickets.createdAt})) / 60)::float8) filter (where ${inSet("fr_measured", b)} and ${tickets.firstResponseAt} is not null))::float8`,
      resolved: count("resolved"),
      firstLine: count("first_line"),
      breached: count("breached"),
      existed: sql<number>`(count(*) filter (where ${tickets.createdAt} < ${b.asOf}))::int`,
      backlog: count("backlog"),
      backlogMedianDays: sql<number | null>`(percentile_cont(0.5) within group (order by (${ageDays})::float8) filter (where ${inSet("backlog", b)}))::float8`,
      backlogOldestDays: sql<number | null>`(max(${ageDays}) filter (where ${inSet("backlog", b)}))::int`,
      ratings: count("rated"),
      ratingSum: sql<number>`(coalesce(sum(${tickets.csat}) filter (where ${inSet("rated", b)}), 0))::int`,
    })
    .from(tickets)
    .where(inArray(tickets.boardLinkId, linkIds))
    .groupBy(tickets.boardLinkId);
  return new Map(
    rows.map(({ linkId, ...c }) => [
      linkId,
      {
        ...c,
        frMedianMinutes: c.frMedianMinutes == null ? null : Number(c.frMedianMinutes),
        backlogMedianDays: c.backlogMedianDays == null ? null : Math.floor(Number(c.backlogMedianDays)),
      },
    ]),
  );
}

const sorts = {
  // PROJ-9 before PROJ-10.
  key: [sql`length(${tickets.key})`, tickets.key],
  summary: [sql`lower(${tickets.summary})`],
  status: [sql`lower(${tickets.status})`],
  created: [tickets.createdAt],
  resolved: [tickets.resolvedAt],
  level: [tickets.highestLevel],
  csat: [tickets.csat],
};
export type TicketSort = keyof typeof sorts;
export const ticketSorts = Object.keys(sorts) as TicketSort[];
export interface TicketFilter {
  linkId: string;
  set: TicketSet;
  month: Month;
  q?: string;
  sort: TicketSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}
export async function listTickets(db: Queryable, f: TicketFilter, timeZone: string, now: Date) {
  const where = and(
    eq(tickets.boardLinkId, f.linkId),
    inSet(f.set, monthBounds(f.month, timeZone, now)),
    f.q ? or(ilike(tickets.key, like(f.q)), ilike(tickets.summary, like(f.q)), ilike(tickets.status, like(f.q))) : undefined,
  );
  const order = sorts[f.sort].map((c) => (f.dir === "desc" ? sql`${c} desc nulls last` : sql`${c} asc nulls last`));
  const [items, total] = await Promise.all([
    db
      .select()
      .from(tickets)
      .where(where)
      .orderBy(...order, f.dir === "desc" ? desc(tickets.id) : asc(tickets.id))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(tickets)
      .where(where),
  ]);
  return { items, total: total[0]?.n ?? 0 };
}

// ---------- Targets

export const targetsOf = (db: Queryable, vendorIds: string[]) =>
  vendorIds.length ? db.select().from(performanceTargets).where(inArray(performanceTargets.vendorId, vendorIds)) : Promise.resolve([]);
export const setTarget = (tx: Queryable, vendorId: string, metric: MetricKey, targetTenths: number, by: string) =>
  tx
    .insert(performanceTargets)
    .values({ vendorId, metric, targetTenths, createdBy: by, updatedBy: by })
    .onConflictDoUpdate({ target: [performanceTargets.vendorId, performanceTargets.metric], set: { targetTenths, updatedAt: new Date(), updatedBy: by } });
export const removeTarget = (tx: Queryable, vendorId: string, metric: MetricKey) =>
  tx.delete(performanceTargets).where(and(eq(performanceTargets.vendorId, vendorId), eq(performanceTargets.metric, metric)));
