import type { Day } from "../../../shared/dates";
import {
  boardLinkSchema,
  checkLevels,
  emptyCounts,
  formatTarget,
  highestLevel,
  isMonth,
  metricInfo,
  metricKeys,
  monthMetrics,
  monthOf,
  monthsUpTo,
  targetsSchema,
  type BoardLink,
  type JiraBoardChoice,
  type LinkTest,
  type MetricKey,
  type Month,
  type MonthMetrics,
  type OverviewSort,
  type PerformanceOverview,
  type SyncOutcome,
  type Targets,
  type Ticket,
  type TicketSet,
  type VendorPerformance,
} from "../../../shared/performance";
import type { Page, User } from "../../../shared/types";
import { audit } from "../../platform/audit";
import { AppError, notFound } from "../../platform/errors";
import { failFields, isUniqueViolation } from "../../platform/http";
import { explain } from "../../platform/ports/explain";
import type { Db, JiraPort, Queryable } from "../../platform/ports/types";
import * as repo from "./repo";

/** What the performance feature needs from the app around it. */
export interface PerformanceContext {
  db: Db;
  jira: JiraPort;
  timeZone: string;
  now: () => Date;
  today: () => Day;
  syncEveryMinutes: number;
}
type Changes = Record<string, { from: unknown; to: unknown }>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const toLink = (l: repo.LinkRow, tickets: number): BoardLink => ({
  id: l.id,
  vendorId: l.vendorId,
  projectKey: l.projectKey,
  projectName: l.projectName,
  escalationMethod: l.escalationMethod,
  l1Values: l.l1Values,
  l2Values: l.l2Values,
  l3Values: l.l3Values,
  active: l.active,
  lastSyncedAt: iso(l.lastSyncedAt),
  lastAttemptAt: iso(l.lastAttemptAt),
  lastSyncOk: l.lastSyncOk,
  lastSyncMessage: l.lastSyncMessage,
  lastSyncUpdated: l.lastSyncUpdated,
  tickets,
});

/** A failed call to Jira, as a sentence someone outside IT can act on. Never carries Jira's own wording or any secret. */
function jiraProblem(e: unknown, projectKey: string): string {
  const status = (e as { status?: number }).status;
  if (status === 404) return `Jira has no board with the key ${projectKey}, or the Jira account is not allowed to see it.`;
  if (status === 401 || status === 403) return "Jira refused the app's sign-in. An admin should check the Jira account's email and API token.";
  if (status === 429) return "Jira asked the app to slow down. Try again in a few minutes.";
  const { cause, fix } = explain(e);
  return `Jira could not be read. ${cause}${fix ? ` ${fix}` : ""}`;
}

// ---------- Sync (J-2)

const KEEP_MONTHS = 24;
const levelOf = (link: repo.LinkRow, t: { statusesSeen: string[]; labelsSeen: string[] }) => highestLevel(link.escalationMethod === "status" ? t.statusesSeen : t.labelsSeen, link);

/**
 * Fetches a board's tickets and overwrites the copies held here. Everything is fetched
 * before anything is written, and written in one go, so a failure of any kind leaves the
 * tickets exactly as they were. Running it twice is harmless.
 */
export async function syncBoard(ctx: PerformanceContext, linkId: string): Promise<SyncOutcome> {
  const found = await repo.getLink(ctx.db, linkId);
  if (!found) throw notFound("That Jira board link");
  const { link, vendorName } = found;
  if (!link.active) throw new AppError(409, "sync_paused", "The sync for this board is switched off. An admin can switch it on again.");
  const startedAt = ctx.now();
  const outcome = (ok: boolean, updated: number, message: string | null): SyncOutcome => ({ vendorName, projectKey: link.projectKey, ok, updated, message });
  let fetched;
  try {
    fetched = await ctx.jira.fetchTickets(link.projectKey, link.lastSyncedAt, startedAt);
  } catch (e) {
    console.error(`Jira sync of ${link.projectKey} failed:`, (e as Error).message);
    const message = `${jiraProblem(e, link.projectKey)} ${link.lastSyncedAt ? "The tickets fetched earlier are unchanged." : "No tickets have been fetched for this board yet."}`;
    await ctx.db.transaction(async (tx) => {
      const current = await repo.lockLink(tx, link.id);
      // Another sync finished in the meantime: its result is the newer truth, and this failure is not shown over it.
      if (current && sameMoment(current.lastAttemptAt, link.lastAttemptAt))
        await repo.updateLink(tx, link.id, { lastAttemptAt: startedAt, lastSyncOk: false, lastSyncMessage: message });
    });
    return outcome(false, 0, message);
  }
  const cutoff = new Date(startedAt);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - KEEP_MONTHS);
  return ctx.db.transaction(async (tx) => {
    const current = await repo.lockLink(tx, link.id);
    // The board or its sync was changed while Jira was being read: what was fetched no longer belongs here.
    if (!current || !current.active || current.projectKey !== link.projectKey)
      return outcome(false, 0, "The board link was changed while its tickets were being fetched. Sync again.");
    // Another sync of this board finished while this one was reading Jira. Its tickets are at least as new; writing these over them could put older states back.
    if (!sameMoment(current.lastSyncedAt, link.lastSyncedAt)) return outcome(true, 0, null);
    const rows = fetched.filter((t) => !(t.resolvedAt && t.resolvedAt < cutoff)).map((t) => ({ ...t, highestLevel: levelOf(current, t) }));
    await repo.upsertTickets(tx, link.id, rows, startedAt);
    await repo.deleteOpenNotSeen(tx, link.id, new Set(fetched.map((t) => t.key)));
    await repo.deleteResolvedBefore(tx, link.id, cutoff);
    // Unresolved tickets are fetched every time whether they changed or not; only real changes are counted.
    const since = link.lastSyncedAt;
    const updated = since ? rows.filter((t) => t.updatedAt >= since).length : rows.length;
    await repo.updateLink(tx, link.id, { lastSyncedAt: startedAt, lastAttemptAt: startedAt, lastSyncOk: true, lastSyncMessage: null, lastSyncUpdated: updated });
    return outcome(true, updated, null);
  });
}

const sameMoment = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** The runs in progress, per database, so two apps in one process (the tests) do not share them. */
const runs = new WeakMap<Db, { full?: Promise<SyncOutcome[]>; due?: Promise<SyncOutcome[]> }>();
/**
 * Syncs every board whose sync is on, one after another. With `dueOnly` (the timer), only
 * boards not tried within the automatic interval. One failing board does not stop the
 * others. "Sync now" pressed twice joins the run in progress and does the work once; a
 * "Sync now" during a timer run waits for it and then syncs everything, so no board is skipped.
 */
export function syncAll(ctx: PerformanceContext, options: { dueOnly?: boolean } = {}): Promise<SyncOutcome[]> {
  const state = runs.get(ctx.db) ?? {};
  runs.set(ctx.db, state);
  const kind = options.dueOnly ? "due" : "full";
  if (state[kind]) return state[kind];
  // The timer has nothing to add while any run is going.
  if (options.dueOnly && state.full) return Promise.resolve([]);
  const after = options.dueOnly
    ? Promise.resolve()
    : (state.due ?? Promise.resolve()).then(
        () => undefined,
        () => undefined,
      );
  const run = after.then(async () => {
    const out: SyncOutcome[] = [];
    const before = ctx.now().getTime() - ctx.syncEveryMinutes * 60_000;
    for (const { link, vendorName } of await repo.listLinks(ctx.db)) {
      if (!link.active) continue;
      if (options.dueOnly && link.lastAttemptAt && link.lastAttemptAt.getTime() > before) continue;
      try {
        out.push(await syncBoard(ctx, link.id));
      } catch (e) {
        console.error(`Jira sync of ${link.projectKey} stopped:`, (e as Error).message);
        out.push({ vendorName, projectKey: link.projectKey, ok: false, updated: 0, message: "The tickets could not be saved. The tickets fetched earlier are unchanged." });
      }
    }
    return out;
  });
  state[kind] = run;
  const clear = () => {
    if (state[kind] === run) state[kind] = undefined;
  };
  run.then(clear, clear);
  return run;
}

// ---------- Board links (J-1)

export async function listBoards(ctx: PerformanceContext): Promise<JiraBoardChoice[]> {
  let projects;
  try {
    projects = await ctx.jira.listProjects();
  } catch (e) {
    console.error("Listing Jira boards failed:", (e as Error).message);
    const notThere = (e as { status?: number }).status === 404;
    throw new AppError(502, "jira_unreachable", notThere ? "Jira was not found at the address in the app's settings. An admin should check the Jira address." : jiraProblem(e, ""));
  }
  const linked = new Map((await repo.listLinks(ctx.db)).map((l) => [l.link.projectKey.toUpperCase(), l.vendorName]));
  return projects.map((p) => ({ key: p.key, name: p.name, linkedTo: linked.get(p.key.toUpperCase()) ?? null })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Tries the board and the level values without saving anything. A failed test is an answer, not an error. */
export async function testLink(ctx: PerformanceContext, input: unknown): Promise<LinkTest> {
  const value = boardLinkSchema.parse(input);
  const fail = (message: string): LinkTest => ({ ok: false, message, warnings: [], statuses: [], labels: [] });
  let board;
  try {
    board = await ctx.jira.describeBoard(value.projectKey);
  } catch (e) {
    console.error(`Testing the Jira board ${value.projectKey} failed:`, (e as Error).message);
    return fail(jiraProblem(e, value.projectKey));
  }
  const warnings: string[] = [];
  if (!board.serviceDesk) warnings.push("This is not a service desk board, so its tickets have no response times and no satisfaction ratings.");
  if (!board.measures.firstResponse) warnings.push("This Jira has no “Time to first response” measurement, so first response cannot be shown.");
  if (!board.measures.resolution) warnings.push("This Jira has no “Time to resolution” measurement, so SLA breaches cannot be shown.");
  if (!board.measures.satisfaction) warnings.push("This Jira has no “Satisfaction” rating, so satisfaction cannot be shown.");
  const status = value.escalationMethod === "status";
  const known = new Set((status ? board.statuses : board.labels).map((s) => s.toLowerCase()));
  const unknown = [...value.l1Values, ...value.l2Values, ...value.l3Values].filter((v) => !known.has(v.toLowerCase()));
  if (unknown.length)
    warnings.push(
      status
        ? `Not a status on this board: ${unknown.join(", ")}. Check the spelling.`
        : `Not seen on this board's recent tickets: ${unknown.join(", ")}. That is fine for a label that is rarely used; otherwise check the spelling.`,
    );
  const levels = checkLevels(value);
  for (const problem of Object.values(levels)) warnings.push(problem);
  return { ok: true, message: `Connected to ${board.name}.`, warnings, statuses: board.statuses, labels: board.labels };
}

const list = (v: string[]) => (v.length ? v.join(", ") : null);

/** Links a vendor to its board, or changes the link. The first link fetches the tickets straight away. */
export async function saveLink(ctx: PerformanceContext, vendorId: string, input: unknown, by: User): Promise<{ link: BoardLink; sync: SyncOutcome | null }> {
  const value = boardLinkSchema.parse(input);
  const errors = checkLevels(value);
  if (Object.keys(errors).length) failFields(errors);
  const vendor = await repo.getVendor(ctx.db, vendorId);
  if (!vendor) throw notFound("That vendor");
  // A vendor that is not scored has no place in the performance views (P-5), so it gets no board either.
  if (!vendor.scoringEnabled)
    throw new AppError(409, "not_scored", "Scoring is switched off for this vendor, so it has no performance figures. Switch scoring on for the vendor first.");
  let board;
  try {
    board = await ctx.jira.describeBoard(value.projectKey);
  } catch (e) {
    console.error(`Checking the Jira board ${value.projectKey} failed:`, (e as Error).message);
    if ((e as { status?: number }).status === 404) failFields({ projectKey: jiraProblem(e, value.projectKey) });
    throw new AppError(502, "jira_unreachable", `${jiraProblem(e, value.projectKey)} Nothing was saved.`);
  }
  const taken = (name: string) => failFields({ projectKey: `That board is already linked to ${name}. A board belongs to one vendor.` });
  let fetchNow = false;
  let saved: repo.LinkRow;
  try {
    saved = await ctx.db.transaction(async (tx) => {
      await repo.lockVendor(tx, vendorId);
      const other = await repo.linkOfBoard(tx, value.projectKey);
      if (other && other.link.vendorId !== vendorId) taken(other.vendorName);
      const found = await repo.linkOfVendor(tx, vendorId);
      const existing = found ? await repo.lockLink(tx, found.id) : undefined;
      const next = { ...value, projectKey: board.key, projectName: board.name };
      const entry = { userEmail: by.email, action: "update" as const, entityType: "vendor", entityId: vendorId, summary: vendor.name };
      if (!existing) {
        fetchNow = next.active;
        const row = await repo.insertLink(tx, vendorId, next, by.email);
        await audit(tx, {
          ...entry,
          changes: { "Jira board": { from: null, to: `${board.key} · ${board.name}` }, "escalation recognised by": { from: null, to: next.escalationMethod } },
        });
        return row;
      }
      const changes: Changes = {};
      const note = (label: string, from: unknown, to: unknown) => {
        if (from !== to) changes[label] = { from, to };
      };
      const boardChanged = existing.projectKey !== next.projectKey;
      note("Jira board", `${existing.projectKey} · ${existing.projectName ?? ""}`, `${next.projectKey} · ${next.projectName}`);
      note("escalation recognised by", existing.escalationMethod, next.escalationMethod);
      note("level 1 values", list(existing.l1Values), list(next.l1Values));
      note("level 2 values", list(existing.l2Values), list(next.l2Values));
      note("level 3 values", list(existing.l3Values), list(next.l3Values));
      note("Jira sync", existing.active ? "on" : "off", next.active ? "on" : "off");
      if (!Object.keys(changes).length) return existing;
      const reset = boardChanged ? { lastSyncedAt: null, lastAttemptAt: null, lastSyncOk: null, lastSyncMessage: null, lastSyncUpdated: null } : {};
      const row = await repo.updateLink(tx, existing.id, { ...next, ...reset }, by.email);
      if (boardChanged) {
        // The tickets held belong to the old board.
        await repo.deleteTicketsOf(tx, existing.id);
        fetchNow = next.active;
      } else if (Object.keys(changes).some((k) => k.startsWith("level") || k.startsWith("escalation"))) {
        // Same tickets, read differently: work out every ticket's level again from what it has carried.
        const moved: Record<number, string[]> = { 1: [], 2: [], 3: [] };
        for (const t of await repo.seenValues(tx, existing.id)) {
          const level = levelOf(row, t);
          if (level !== t.highestLevel) moved[level]!.push(t.id);
        }
        for (const level of [1, 2, 3]) if (moved[level]!.length) await repo.setLevels(tx, moved[level]!, level);
      }
      await audit(tx, { ...entry, changes });
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) taken("another vendor");
    throw e;
  }
  const sync = fetchNow ? await syncBoard(ctx, saved.id) : null;
  const fresh = (await repo.linkOfVendor(ctx.db, vendorId))!;
  return { link: toLink(fresh, (await repo.ticketCounts(ctx.db, [fresh.id])).get(fresh.id) ?? 0), sync };
}

// ---------- Targets (J-4)

const noTargets = (): Targets => ({ first_response: null, first_line: null, sla_breaches: null, backlog_age: null, csat: null });
async function targetsByVendor(db: Queryable, vendorIds: string[]): Promise<Map<string, Targets>> {
  const out = new Map(vendorIds.map((id) => [id, noTargets()]));
  for (const t of await repo.targetsOf(db, vendorIds)) out.get(t.vendorId)![t.metric] = t.targetTenths;
  return out;
}

/** Sets, changes or removes a vendor's targets. Recorded in the vendor's history. */
export async function saveTargets(ctx: PerformanceContext, vendorId: string, input: unknown, by: User): Promise<Targets> {
  const value = targetsSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    await repo.lockVendor(tx, vendorId);
    const vendor = await repo.getVendor(tx, vendorId);
    if (!vendor) throw notFound("That vendor");
    const current = (await targetsByVendor(tx, [vendorId])).get(vendorId)!;
    const changes: Changes = {};
    for (const key of metricKeys) {
      const next = value[key];
      if (next === undefined || next === current[key]) continue;
      if (next === null) await repo.removeTarget(tx, vendorId, key);
      else await repo.setTarget(tx, vendorId, key, next, by.email);
      const words = (v: number | null) => (v == null ? null : formatTarget(key, v));
      const name = metricInfo[key].label;
      changes[`target for ${name.startsWith("SLA") ? name : name.toLowerCase()}`] = { from: words(current[key]), to: words(next) };
      current[key] = next;
    }
    if (Object.keys(changes).length) await audit(tx, { userEmail: by.email, action: "update", entityType: "vendor", entityId: vendorId, summary: vendor.name, changes });
    return current;
  });
}

// ---------- Reading (J-3, J-5)

const chosenMonth = (ctx: PerformanceContext, month: string | undefined): { month: Month; currentMonth: Month } => {
  const currentMonth = monthOf(ctx.today());
  return { month: isMonth(month) && month <= currentMonth ? month : currentMonth, currentMonth };
};

export async function getOverview(ctx: PerformanceContext, q: { month?: string; sort: OverviewSort; dir: "asc" | "desc" }): Promise<PerformanceOverview> {
  const { month, currentMonth } = chosenMonth(ctx, q.month);
  const links = (await repo.listLinks(ctx.db)).filter((l) => l.scoringEnabled);
  const ids = links.map((l) => l.link.id);
  const [counts, targets, tickets, unlinked] = await Promise.all([
    repo.monthCounts(ctx.db, ids, month, ctx.timeZone, ctx.now()),
    targetsByVendor(
      ctx.db,
      links.map((l) => l.link.vendorId),
    ),
    repo.ticketCounts(ctx.db, ids),
    repo.scoredWithoutBoard(ctx.db),
  ]);
  const rows = links.map(({ link, vendorName }) => ({
    vendorId: link.vendorId,
    vendorName,
    link: toLink(link, tickets.get(link.id) ?? 0),
    metrics: monthMetrics(month, counts.get(link.id) ?? emptyCounts, targets.get(link.vendorId)!),
  }));
  const byName = (a: (typeof rows)[number], b: (typeof rows)[number]) => a.vendorName.localeCompare(b.vendorName, "en", { sensitivity: "base" });
  const sign = q.dir === "desc" ? -1 : 1;
  rows.sort((a, b) => {
    if (q.sort === "vendor") return sign * byName(a, b);
    const value = (r: (typeof rows)[number]) => (q.sort === "missed" ? r.metrics.missed : r.metrics.cells[q.sort as MetricKey].valueTenths);
    const [x, y] = [value(a), value(b)];
    // A vendor with nothing to measure goes last, whichever way the column is sorted.
    if (x == null || y == null) return x == null && y == null ? byName(a, b) : x == null ? 1 : -1;
    return sign * (x - y) || byName(a, b);
  });
  return { month, currentMonth, rows, unlinked, syncEveryMinutes: ctx.syncEveryMinutes };
}

const TREND_MONTHS = 12;
export async function getVendorPerformance(ctx: PerformanceContext, vendorId: string, monthAsked?: string): Promise<VendorPerformance> {
  const vendor = await repo.getVendor(ctx.db, vendorId);
  if (!vendor) throw notFound("That vendor");
  const { month, currentMonth } = chosenMonth(ctx, monthAsked);
  // A vendor switched to "not scored" keeps its board and tickets, but shows no figures until scoring is switched on again (P-5).
  const [row, targets] = await Promise.all([vendor.scoringEnabled ? repo.linkOfVendor(ctx.db, vendorId) : undefined, targetsByVendor(ctx.db, [vendorId])]);
  const months = [];
  if (row) {
    const now = ctx.now();
    for (const m of monthsUpTo(month, TREND_MONTHS)) {
      const counts = (await repo.monthCounts(ctx.db, [row.id], m, ctx.timeZone, now)).get(row.id) ?? emptyCounts;
      months.push(monthMetrics(m, counts, targets.get(vendorId)!));
    }
  }
  return {
    vendor: { id: vendor.id, name: vendor.name, scoringEnabled: vendor.scoringEnabled },
    link: row ? toLink(row, (await repo.ticketCounts(ctx.db, [row.id])).get(row.id) ?? 0) : null,
    targets: targets.get(vendorId)!,
    months,
    currentMonth,
  };
}

/** The tickets behind one figure (J-3). */
export async function listTickets(
  ctx: PerformanceContext,
  vendorId: string,
  f: { set: TicketSet; month?: string; q?: string; sort: repo.TicketSort; dir: "asc" | "desc"; page: number; pageSize: number },
): Promise<Page<Ticket> & { month: Month; vendorName: string }> {
  const vendor = await repo.getVendor(ctx.db, vendorId);
  if (!vendor) throw notFound("That vendor");
  const { month } = chosenMonth(ctx, f.month);
  const link = vendor.scoringEnabled ? await repo.linkOfVendor(ctx.db, vendorId) : undefined;
  if (!link) return { items: [], total: 0, month, vendorName: vendor.name };
  const { items, total } = await repo.listTickets(ctx.db, { ...f, month, linkId: link.id }, ctx.timeZone, ctx.now());
  return {
    month,
    vendorName: vendor.name,
    total,
    items: items.map((t) => ({
      id: t.id,
      key: t.key,
      summary: t.summary,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      resolvedAt: iso(t.resolvedAt),
      firstResponseAt: iso(t.firstResponseAt),
      firstResponseBreached: t.firstResponseBreached,
      resolutionBreached: t.resolutionBreached,
      highestLevel: t.highestLevel,
      csat: t.csat,
      url: ctx.jira.ticketUrl(t.key),
    })),
  };
}

export async function syncVendor(ctx: PerformanceContext, vendorId: string): Promise<SyncOutcome> {
  const link = await repo.linkOfVendor(ctx.db, vendorId);
  if (!link) throw new AppError(409, "no_board", "This vendor has no Jira board yet. An admin can link one.");
  return syncBoard(ctx, link.id);
}

// ---------- For scorecards (P-1, P-2)

/** A vendor's figures for the given months, judged by today's targets. No board, or not scored: no figures. */
export async function figuresFor(ctx: PerformanceContext, vendorId: string, months: Month[]): Promise<{ hasBoard: boolean; months: MonthMetrics[] }> {
  const vendor = await repo.getVendor(ctx.db, vendorId);
  const link = vendor?.scoringEnabled ? await repo.linkOfVendor(ctx.db, vendorId) : undefined;
  if (!link) return { hasBoard: false, months: [] };
  const targets = (await targetsByVendor(ctx.db, [vendorId])).get(vendorId)!;
  const now = ctx.now();
  const out: MonthMetrics[] = [];
  for (const m of months) out.push(monthMetrics(m, (await repo.monthCounts(ctx.db, [link.id], m, ctx.timeZone, now)).get(link.id) ?? emptyCounts, targets));
  return { hasBoard: true, months: out };
}

/**
 * The figures of every scored vendor in use (active or on hold) with a board, or of just the given
 * vendors, for the given months (oldest first), judged by today's targets.
 */
export async function figuresOfAll(ctx: PerformanceContext, months: Month[], vendorIds?: string[]): Promise<{ vendorId: string; vendorName: string; months: MonthMetrics[] }[]> {
  const links = (await repo.listLinks(ctx.db)).filter(
    (l) => l.scoringEnabled && (l.vendorStatus === "active" || l.vendorStatus === "on_hold") && (!vendorIds || vendorIds.includes(l.link.vendorId)),
  );
  if (!links.length) return [];
  const ids = links.map((l) => l.link.id);
  const now = ctx.now();
  const [targets, ...counts] = await Promise.all([
    targetsByVendor(
      ctx.db,
      links.map((l) => l.link.vendorId),
    ),
    ...months.map((m) => repo.monthCounts(ctx.db, ids, m, ctx.timeZone, now)),
  ]);
  return links.map(({ link, vendorName }) => ({
    vendorId: link.vendorId,
    vendorName,
    months: months.map((m, i) => monthMetrics(m, counts[i]!.get(link.id) ?? emptyCounts, targets.get(link.vendorId)!)),
  }));
}

/** The tickets created in a month, newest first, at most `limit`. */
export async function ticketsCreatedIn(ctx: PerformanceContext, vendorId: string, month: Month, limit: number) {
  const link = await repo.linkOfVendor(ctx.db, vendorId);
  return link ? repo.ticketsCreatedIn(ctx.db, link.id, month, ctx.timeZone, ctx.now(), limit) : [];
}

/** Scored vendors that have a board: the ones the AI makes a monthly proposal for. */
export const linkedVendors = async (ctx: PerformanceContext) =>
  (await repo.listLinks(ctx.db)).filter((l) => l.scoringEnabled).map((l) => ({ vendorId: l.link.vendorId, vendorName: l.vendorName }));

export const currentMonth = (ctx: PerformanceContext): Month => monthOf(ctx.today());
