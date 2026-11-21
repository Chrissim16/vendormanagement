import type { JiraTransport } from "./jira";

/**
 * A pretend Jira site for building and testing: a handful of invented helpdesk boards whose
 * tickets are made up by rule, and answered in the shapes Jira Cloud itself uses, so the
 * app reads them with exactly the code it will use on the real thing.
 *
 * Nothing here is real: the boards, the ticket texts and every number are invented (X-6).
 * The helpdesk "started" on 1 Sep 2025 and has been running since, so the same ticket
 * always has the same story, and each day that passes adds new tickets and moves old ones on.
 */

const EPOCH = Date.UTC(2025, 8, 1);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const FIRST_RESPONSE_GOAL = 4 * HOUR;
const RESOLUTION_GOAL = 5 * DAY;

interface Board {
  key: string;
  name: string;
  type: "service_desk" | "software";
  /** How this board shows that a ticket went to the second or third line. */
  method: "status" | "label";
  perWeekday: number;
  firstLineShare: number;
  secondLineShare: number;
  /** Chance that a first response is late, for a ticket created in the given month. */
  lateResponse: (month: string) => number;
  /** How often each rating from 1 to 5 is given. */
  ratings: [number, number, number, number, number];
  /** Every second fetch of this board fails, to show what a failed sync looks like. */
  flaky?: boolean;
}

export const FAKE_STATUSES = {
  waiting: "Waiting for support",
  progress: "In progress",
  second: "Escalated to second line",
  third: "With vendor engineering",
  resolved: "Resolved",
} as const;
export const FAKE_LABELS = { second: "tier-2", third: "tier-3" } as const;

const boards: Board[] = [
  {
    key: "BLU",
    name: "Bluefinch Systems service desk (invented)",
    type: "service_desk",
    method: "status",
    perWeekday: 3.4,
    firstLineShare: 0.71,
    secondLineShare: 0.21,
    // Answering has slipped since September 2026, so there is a missed target to look at.
    lateResponse: (m) => (m >= "2026-09" ? 0.12 : 0.02),
    ratings: [3, 4, 10, 30, 53],
  },
  {
    key: "MOS",
    name: "Mossgate IT service desk (invented)",
    type: "service_desk",
    method: "label",
    perWeekday: 1.7,
    firstLineShare: 0.8,
    secondLineShare: 0.15,
    lateResponse: () => 0.03,
    ratings: [1, 2, 7, 35, 55],
  },
  {
    key: "TAR",
    name: "Tarnwick Software support (invented)",
    type: "service_desk",
    method: "status",
    perWeekday: 1,
    firstLineShare: 0.6,
    secondLineShare: 0.28,
    lateResponse: () => 0.08,
    ratings: [5, 8, 20, 37, 30],
  },
  {
    key: "SED",
    name: "Sedgewater Cloud support (invented)",
    type: "service_desk",
    method: "label",
    perWeekday: 1.2,
    firstLineShare: 0.75,
    secondLineShare: 0.18,
    lateResponse: () => 0.05,
    ratings: [2, 4, 12, 40, 42],
  },
  {
    key: "FLK",
    name: "Flaky demo board (invented, every second sync fails)",
    type: "service_desk",
    method: "status",
    perWeekday: 0.4,
    firstLineShare: 0.7,
    secondLineShare: 0.2,
    lateResponse: () => 0.05,
    ratings: [2, 4, 12, 40, 42],
    flaky: true,
  },
  {
    key: "FIN",
    name: "Finance IT projects (invented, not a service desk)",
    type: "software",
    method: "status",
    perWeekday: 0,
    firstLineShare: 1,
    secondLineShare: 0,
    lateResponse: () => 0,
    ratings: [0, 0, 0, 0, 1],
  },
];

const topics: [summary: string, description: string, label: string][] = [
  ["Cannot post a journal in the ledger", "Posting stops with a message that the period is locked, although the period is open.", "ledger"],
  ["Month-end report shows last month's figures", "The management report still shows the previous month after the close was finished.", "reporting"],
  ["New colleague needs access to the reporting suite", "Please give access with the same rights as the rest of the control team.", "access"],
  ["Payment run stuck at approval", "The payment proposal stays in waiting for approval after both approvers signed off.", "payments"],
  ["Bank statement import failed overnight", "No statements were loaded this morning. The import log shows a format problem.", "bank"],
  ["Exchange rates were not updated", "Today's rates are missing, so revaluation cannot be run.", "ledger"],
  ["Invoice scan lands in the wrong queue", "Scanned supplier invoices arrive in the queue of another entity.", "invoices"],
  ["Slow screens in the afternoon", "Opening a ledger account takes more than a minute between two and four.", "performance"],
  ["Password reset link does not arrive", "The reset email never arrives, also not in the spam folder.", "access"],
  ["Cost centre missing from the dropdown", "A cost centre created last week cannot be chosen when booking.", "master-data"],
  ["Export to spreadsheet cuts off rows", "The export stops at ten thousand rows without a warning.", "reporting"],
  ["Intercompany booking does not balance", "The counter booking is created in the wrong currency.", "ledger"],
  ["Dashboard tile shows an error", "The cash position tile shows that data could not be loaded.", "reporting"],
  ["Printer for remittance advice offline", "Remittance advices are not printed since the office move.", "printing"],
  ["Question about closing a fiscal period", "Which steps are needed to reopen a period for one correction?", "how-to"],
  ["Supplier bank details change request", "A supplier changed bank; the change form does not save.", "master-data"],
];

/** A small repeatable random source: the same seed always gives the same numbers. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

interface Story {
  key: string;
  summary: string;
  description: string;
  topicLabel: string;
  created: number;
  responded: number;
  second: number | null;
  third: number | null;
  resolved: number;
  rating: number | null;
  rated: number | null;
}

/** The whole life of every ticket created on one day. It does not depend on what day it is now. */
function storiesOfDay(board: Board, dayIndex: number, firstNumber: number): Story[] {
  const rnd = random(hash(board.key) * 100_003 + dayIndex);
  const start = EPOCH + dayIndex * DAY;
  const weekday = new Date(start).getUTCDay();
  const rate = board.perWeekday * (weekday === 0 || weekday === 6 ? 0.1 : 1);
  const count = Math.floor(rate) + (rnd() < rate % 1 ? 1 : 0);
  const month = new Date(start).toISOString().slice(0, 7);
  const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);
  const out: Story[] = [];
  for (let i = 0; i < count; i++) {
    const created = start + Math.round(between(7 * HOUR, 17 * HOUR) / MIN) * MIN;
    const response = Math.round(rnd() < board.lateResponse(month) ? between(250, 900) : between(4, 220)) * MIN;
    const r = rnd();
    const level = r < board.firstLineShare ? 1 : r < board.firstLineShare + board.secondLineShare ? 2 : 3;
    const hours = rnd() < 0.02 ? between(480, 1400) : level === 1 ? between(2, 40) : level === 2 ? between(10, 130) : between(50, 210);
    const duration = Math.max(Math.round(hours * 60) * MIN, response + 30 * MIN);
    const second = level >= 2 ? created + Math.max(response + 10 * MIN, Math.round((duration * 0.3) / MIN) * MIN) : null;
    const third = level === 3 ? Math.max(second! + 10 * MIN, created + Math.round((duration * 0.55) / MIN) * MIN) : null;
    const resolved = Math.max(created + duration, (third ?? second ?? 0) + 10 * MIN);
    let rating: number | null = null;
    if (rnd() < 0.35) {
      let pick = rnd() * board.ratings.reduce((a, b) => a + b, 0);
      rating = board.ratings.findIndex((w) => (pick -= w) < 0) + 1 || 5;
    }
    const topic = topics[Math.floor(rnd() * topics.length)]!;
    out.push({
      key: `${board.key}-${firstNumber + i}`,
      summary: topic[0],
      description: topic[1],
      topicLabel: topic[2],
      created,
      responded: created + response,
      second,
      third,
      resolved,
      rating,
      rated: rating == null ? null : resolved + Math.round(between(1, 60)) * HOUR,
    });
  }
  return out;
}

/** Jira's own number for a ticket: different for every ticket, and nothing like its key. */
const ticketId = (key: string) => {
  const [board = "", number = "0"] = key.split("-");
  return String((boards.findIndex((b) => b.key === board) + 1) * 1_000_000 + Number(number));
};
const jiraTime = (ms: number) => new Date(ms).toISOString().replace("Z", "+0000");
const slaTime = (ms: number) => ({ iso8601: jiraTime(ms), epochMillis: ms });
const FIELDS = { firstResponse: "customfield_10030", resolution: "customfield_10031", satisfaction: "customfield_10032", satisfactionDate: "customfield_10033" };

/** A cycle that has stopped, or one still running, in the shape of a Jira Service Management SLA field. */
function sla(started: number, stopped: number, goal: number, now: number) {
  if (stopped <= now) return { completedCycles: [{ startTime: slaTime(started), stopTime: slaTime(stopped), breached: stopped - started > goal, goalDuration: { millis: goal } }] };
  return {
    completedCycles: [],
    ongoingCycle: { startTime: slaTime(started), breachTime: slaTime(started + goal), breached: now - started > goal, goalDuration: { millis: goal } },
  };
}

/** The ticket as Jira would show it at `now`, and the changes that led there. */
function issueAt(board: Board, s: Story, now: number) {
  const changes: { at: number; field: "status" | "labels"; from: string; to: string }[] = [];
  let status: string = FAKE_STATUSES.waiting;
  const labels = [s.topicLabel];
  const move = (at: number | null, to: string) => {
    if (at == null || at > now) return;
    changes.push({ at, field: "status", from: status, to });
    status = to;
  };
  const tag = (at: number | null, label: string) => {
    if (at == null || at > now) return;
    changes.push({ at, field: "labels", from: labels.join(" "), to: [...labels, label].join(" ") });
    labels.push(label);
  };
  move(s.responded, FAKE_STATUSES.progress);
  if (board.method === "status") {
    move(s.second, FAKE_STATUSES.second);
    move(s.third, FAKE_STATUSES.third);
  } else {
    tag(s.second, FAKE_LABELS.second);
    tag(s.third, FAKE_LABELS.third);
  }
  move(s.resolved, FAKE_STATUSES.resolved);
  const rated = s.rated != null && s.rated <= now;
  const updated = Math.max(s.created, ...changes.map((c) => c.at), rated ? s.rated! : 0);
  return {
    updated,
    changes,
    issue: {
      id: ticketId(s.key),
      key: s.key,
      fields: {
        summary: s.summary,
        description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: s.description }] }] },
        status: { name: status },
        created: jiraTime(s.created),
        updated: jiraTime(updated),
        resolutiondate: s.resolved <= now ? jiraTime(s.resolved) : null,
        labels: [...labels],
        [FIELDS.firstResponse]: sla(s.created, s.responded, FIRST_RESPONSE_GOAL, now),
        [FIELDS.resolution]: sla(s.created, s.resolved, RESOLUTION_GOAL, now),
        [FIELDS.satisfaction]: rated ? { rating: s.rating } : null,
        [FIELDS.satisfactionDate]: rated ? jiraTime(s.rated!) : null,
      },
    },
  };
}

const refuse = (status: number, message: string) => Object.assign(new Error(message), { status });

/** Answers the Jira REST paths the app uses. `now` is how far the invented helpdesk has got. */
export function fakeJiraSite(now: () => Date): JiraTransport {
  const cache = new Map<string, { days: number; stories: Story[] }>();
  const fetches = new Map<string, number>();

  function stories(board: Board, at: number): Story[] {
    const days = Math.floor((at - EPOCH) / DAY) + 1;
    let hit = cache.get(board.key);
    if (!hit || hit.days < days) {
      // Carry on from the days already made; a day's tickets never change once made.
      hit ??= { days: 0, stories: [] };
      for (let d = hit.days; d < days; d++) hit.stories.push(...storiesOfDay(board, d, hit.stories.length + 1));
      hit.days = Math.max(days, 0);
      cache.set(board.key, hit);
    }
    return hit.stories.filter((s) => s.created <= at);
  }
  const boardOf = (key: string) => {
    const board = boards.find((b) => b.key === key.toUpperCase());
    if (!board) throw refuse(404, `No project could be found with key '${key}'.`);
    return board;
  };

  return async (method, path, body) => {
    const at = now().getTime();
    const [route] = path.split("?");
    let m: RegExpMatchArray | null;

    if (method === "GET" && route === "/rest/api/3/project/search") {
      return { values: boards.map((b) => ({ id: String(hash(b.key)), key: b.key, name: b.name, projectTypeKey: b.type })), isLast: true, total: boards.length };
    }
    if (method === "GET" && route === "/rest/api/3/field") {
      return [
        { id: "summary", name: "Summary" },
        { id: "status", name: "Status" },
        { id: FIELDS.firstResponse, name: "Time to first response", schema: { type: "sd-servicelevelagreement", custom: "com.atlassian.servicedesk:sd-sla-field" } },
        { id: FIELDS.resolution, name: "Time to resolution", schema: { type: "sd-servicelevelagreement", custom: "com.atlassian.servicedesk:sd-sla-field" } },
        { id: FIELDS.satisfaction, name: "Satisfaction", schema: { type: "sd-feedback", custom: "com.atlassian.servicedesk:sd-request-feedback" } },
        { id: FIELDS.satisfactionDate, name: "Satisfaction date", schema: { type: "datetime", custom: "com.atlassian.servicedesk:sd-request-feedback-date" } },
      ];
    }
    if (method === "GET" && (m = route!.match(/^\/rest\/api\/3\/project\/([^/]+)\/statuses$/))) {
      const board = boardOf(decodeURIComponent(m[1]!));
      const names = board.method === "status" ? Object.values(FAKE_STATUSES) : [FAKE_STATUSES.waiting, FAKE_STATUSES.progress, FAKE_STATUSES.resolved];
      return [{ id: "10001", name: "Service request", statuses: names.map((name, i) => ({ id: String(i + 1), name })) }];
    }
    if (method === "GET" && (m = route!.match(/^\/rest\/api\/3\/project\/([^/]+)$/))) {
      const board = boardOf(decodeURIComponent(m[1]!));
      return { id: String(hash(board.key)), key: board.key, name: board.name, projectTypeKey: board.type };
    }
    if (method === "POST" && route === "/rest/api/3/search/jql") {
      const q = body as { jql?: string; maxResults?: number; nextPageToken?: string };
      const jql = q.jql ?? "";
      const board = boardOf(jql.match(/project\s*=\s*"?([A-Za-z0-9_]+)"?/)?.[1] ?? "");
      const descending = /ORDER BY updated DESC/i.test(jql);
      const unresolved = /resolution\s+IS\s+EMPTY/i.test(jql);
      // A fetch asks two questions; the flaky board fails on the second one of every other fetch.
      if (board.flaky && unresolved && !q.nextPageToken) {
        const n = (fetches.get(board.key) ?? 0) + 1;
        fetches.set(board.key, n);
        if (n % 2 === 0) throw refuse(503, "Service Unavailable");
      }
      // The conditions the app uses, joined by OR: changed lately, resolved lately, or not resolved.
      const minutes = jql.match(/updated\s*>=\s*"-(\d+)m"/)?.[1];
      const weeks = jql.match(/resolved\s*>=\s*"-(\d+)w"/)?.[1];
      const wanted = (i: ReturnType<typeof issueAt>, s: Story) =>
        (!minutes && !weeks && !unresolved) ||
        (minutes !== undefined && i.updated >= at - Number(minutes) * MIN) ||
        (weeks !== undefined && s.resolved <= at && s.resolved >= at - Number(weeks) * 7 * DAY) ||
        (unresolved && s.resolved > at);
      const all = stories(board, at)
        .map((s) => ({ s, i: issueAt(board, s, at) }))
        .filter(({ s, i }) => wanted(i, s))
        .map(({ i }) => i)
        .sort((a, b) => (descending ? b.updated - a.updated : a.updated - b.updated));
      const size = Math.min(Math.max(q.maxResults ?? 50, 1), 100);
      const from = Number(q.nextPageToken ?? 0) || 0;
      const last = from + size >= all.length;
      return { issues: all.slice(from, from + size).map((i) => i.issue), isLast: last, ...(last ? {} : { nextPageToken: String(from + size) }) };
    }
    if (method === "POST" && route === "/rest/api/3/changelog/bulkfetch") {
      const q = body as { issueIdsOrKeys?: string[]; maxResults?: number; nextPageToken?: string };
      const asked = q.issueIdsOrKeys ?? [];
      if (asked.length < 1 || asked.length > 1000) throw refuse(400, "issueIdsOrKeys must hold between 1 and 1000 items.");
      // Every change of every ticket asked for, oldest first, cut into pages that pay no attention to where one ticket ends.
      const byId = new Map(boards.flatMap((b) => stories(b, at).map((s) => [ticketId(s.key), { b, s }] as const)));
      const all = asked
        .flatMap((id) => {
          const hit = byId.get(id);
          return hit ? issueAt(hit.b, hit.s, at).changes.map((c) => ({ id, c })) : [];
        })
        .sort((x, y) => x.c.at - y.c.at || x.id.localeCompare(y.id));
      const size = Math.min(Math.max(q.maxResults ?? 1000, 1), 10000);
      const from = Number(q.nextPageToken ?? 0) || 0;
      const logs = new Map<string, { id: string; created: string; items: unknown[] }[]>();
      all.slice(from, from + size).forEach(({ id, c }, i) => {
        const list = logs.get(id) ?? [];
        logs.set(id, list);
        list.push({ id: String(from + i + 1), created: jiraTime(c.at), items: [{ field: c.field, fieldtype: "jira", fieldId: c.field, fromString: c.from, toString: c.to }] });
      });
      return {
        issueChangeLogs: [...logs].map(([issueId, changeHistories]) => ({ issueId, changeHistories })),
        ...(from + size < all.length ? { nextPageToken: String(from + size) } : {}),
      };
    }
    throw refuse(404, `The stand-in Jira has no answer for ${method} ${route}.`);
  };
}
