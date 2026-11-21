import { explain, limit } from "./explain";
import { fakeJiraSite } from "./jira-fake";
import type { JiraBoard, JiraPort, JiraTicket, PortKind } from "./types";

/**
 * One request to Jira's REST API: a method, a path under the site, and a JSON body. Fails
 * with `status` set when Jira answers with an error. The real one goes over the network;
 * the stand-in answers the same paths from invented tickets, so everything below this line
 * (reading SLAs, ratings, history) is the same code in both.
 */
export type JiraTransport = (method: "GET" | "POST", path: string, body?: unknown) => Promise<unknown>;

// ---------- The shapes Jira sends, as Atlassian's published API description gives them; see the notes on `jiraClient`.

interface JiraTime {
  iso8601?: string;
  epochMillis?: number;
}
interface SlaCycle {
  startTime?: JiraTime;
  stopTime?: JiraTime;
  breached?: boolean;
}
interface SlaValue {
  completedCycles?: SlaCycle[];
  ongoingCycle?: SlaCycle;
}
interface JiraIssue {
  /** Jira's own number for the ticket. The history call answers by this, not by the key. */
  id?: string;
  key: string;
  fields: Record<string, unknown> & {
    summary?: string;
    description?: unknown;
    status?: { name?: string };
    created?: string;
    updated?: string;
    resolutiondate?: string | null;
    labels?: string[];
  };
}
interface SearchPage {
  issues?: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}
interface ChangeItem {
  field?: string;
  fieldId?: string;
  fromString?: string | null;
  toString?: string | null;
}
interface BulkChangelogPage {
  issueChangeLogs?: { issueId?: string; changeHistories?: { items?: ChangeItem[] }[] }[];
  nextPageToken?: string | null;
}

/** Jira writes "+0100"; a colon makes it a time every JavaScript engine reads. */
export function jiraDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(d.getTime()) ? null : d;
}
const slaTime = (t: JiraTime | undefined) => (t?.epochMillis != null ? new Date(t.epochMillis) : jiraDate(t?.iso8601));

/**
 * The outcome of an SLA on a ticket. A finished cycle says when it stopped and whether it
 * was late. A running cycle only has an outcome once it is already late.
 */
export function slaOutcome(value: unknown, which: "first" | "last"): { at: Date | null; breached: boolean | null } {
  const v = (value ?? {}) as SlaValue;
  // Atlassian does not say in which order the finished cycles come, so they are put in time order here.
  const when = (c: SlaCycle) => (slaTime(c.stopTime) ?? slaTime(c.startTime))?.getTime();
  const cycles = [...(v.completedCycles ?? [])];
  if (cycles.every((c) => when(c) != null)) cycles.sort((a, b) => when(a)! - when(b)!);
  const done = which === "first" ? cycles[0] : cycles.at(-1);
  if (done) return { at: slaTime(done.stopTime), breached: done.breached === true };
  if (v.ongoingCycle?.breached === true) return { at: null, breached: true };
  return { at: null, breached: null };
}

/** The text of a description, which Jira sends as a tree of paragraphs (or, from older sites, as plain text). */
export function plainText(node: unknown): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (typeof n.text === "string") return n.text;
  const inner = (n.content ?? []).map(plainText).join("");
  return n.type === "paragraph" || n.type === "heading" || n.type === "listItem" ? `${inner}\n` : inner;
}

const PAGE = 100;
/** The most tickets Jira gives the history of in one request. */
const HISTORY_BATCH = 1000;
/** A little over 24 months, the time tickets are kept after they are resolved. */
const KEEP_WEEKS = 105;
const MAX_PAGES = 2000;
const FIELD_NAMES = { firstResponse: "time to first response", resolution: "time to resolution", satisfaction: "satisfaction", satisfactionDate: "satisfaction date" } as const;
type FieldIds = Partial<Record<keyof typeof FIELD_NAMES, string>>;
type Past = { statuses: string[]; labels: string[] };
const quote = (key: string) => `"${key.replace(/[^A-Za-z0-9_]/g, "")}"`;

/**
 * The Jira port on top of a transport.
 *
 * UNPROVEN against a real Jira until the first deployment. Checked on 21 Nov 2026 against
 * Atlassian's published API description (developer.atlassian.com); open question W8 lists
 * what was confirmed and what can only be seen on the company's own Jira.
 * Confirmed there:
 * - search is `POST /rest/api/3/search/jql` (`jql`, `fields`, `maxResults`, `nextPageToken`); the answer has `issues`,
 *   `isLast` and a `nextPageToken` that is absent on the last page, and no total. A page may hold fewer tickets than asked for;
 * - ticket history for up to 1000 tickets at once is `POST /rest/api/3/changelog/bulkfetch`, answered per ticket id;
 * - `GET /rest/api/3/field` is one plain list; `GET /rest/api/3/project/search` gives at most 100 per page;
 * - an SLA has `completedCycles` (each with `stopTime` and `breached`) and an `ongoingCycle` (`breached`, no `stopTime`);
 * - times are written like 2026-01-05T09:12:33.000+0100.
 * Not in the documentation, so still to be seen at work with one "Test link" and one "Sync now":
 * - the names of the SLA and satisfaction fields ("Time to first response", "Time to resolution", "Satisfaction",
 *   "Satisfaction date") and the exact value of the satisfaction field on a ticket;
 * - that a status or label change is called "status" or "labels" in the history.
 * A name that differs leaves that figure empty; it never makes one wrong.
 */
export function jiraClient(call: JiraTransport, kind: PortKind, browseBase: string | null): JiraPort {
  let fieldIds: Promise<FieldIds> | null = null;
  const fields = () =>
    (fieldIds ??= (async () => {
      const all = (await call("GET", "/rest/api/3/field")) as { id: string; name: string; schema?: { custom?: string } }[];
      const out: FieldIds = {};
      for (const [k, name] of Object.entries(FIELD_NAMES) as [keyof typeof FIELD_NAMES, string][]) {
        // Two fields can carry the same name; the one that belongs to the service desk is the one meant.
        const named = all.filter((f) => f.name?.trim().toLowerCase() === name);
        out[k] = (named.find((f) => f.schema?.custom?.includes("servicedesk")) ?? named[0])?.id;
      }
      return out;
    })().catch((e) => {
      fieldIds = null;
      throw e;
    }));

  async function search(jql: string, fieldList: string[], onlyFirstPage = false): Promise<JiraIssue[]> {
    const issues: JiraIssue[] = [];
    let nextPageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = (await call("POST", "/rest/api/3/search/jql", { jql, fields: fieldList, maxResults: PAGE, ...(nextPageToken ? { nextPageToken } : {}) })) as SearchPage;
      issues.push(...(res.issues ?? []));
      nextPageToken = res.nextPageToken;
      if (onlyFirstPage || !nextPageToken || res.isLast === true) return issues;
    }
    throw new Error("Jira kept sending more pages than a board can hold.");
  }

  /**
   * Every status and label each ticket carried before the ones it has now, by Jira's ticket id.
   * Asked for a thousand tickets at a time, so a large board takes a handful of requests, not one per ticket.
   */
  async function histories(ids: string[]): Promise<Map<string, Past>> {
    const out = new Map<string, Past>();
    for (let from = 0; from < ids.length; from += HISTORY_BATCH) {
      const issueIdsOrKeys = ids.slice(from, from + HISTORY_BATCH);
      let nextPageToken: string | undefined;
      for (let page = 0; ; page++) {
        if (page >= MAX_PAGES) throw new Error("Jira kept sending more pages of ticket history than a board can hold.");
        const res = (await call("POST", "/rest/api/3/changelog/bulkfetch", {
          issueIdsOrKeys,
          maxResults: HISTORY_BATCH,
          ...(nextPageToken ? { nextPageToken } : {}),
        })) as BulkChangelogPage;
        for (const log of res.issueChangeLogs ?? []) {
          if (!log.issueId) continue;
          // One ticket's history can be spread over several pages.
          const past = out.get(log.issueId) ?? { statuses: [], labels: [] };
          out.set(log.issueId, past);
          for (const item of (log.changeHistories ?? []).flatMap((h) => h.items ?? [])) {
            const both = [item.fromString, item.toString].filter((s): s is string => typeof s === "string" && s.length > 0);
            const names = [item.fieldId, item.field].map((n) => n?.toLowerCase());
            if (names.includes("status")) past.statuses.push(...both);
            // A label change lists all labels before and after, separated by spaces.
            if (names.includes("labels")) past.labels.push(...both.flatMap((s) => s.split(/\s+/)).filter(Boolean));
          }
        }
        nextPageToken = res.nextPageToken ?? undefined;
        if (!nextPageToken) break;
      }
    }
    return out;
  }

  const unique = (list: string[]) => [...new Map(list.map((s) => [s.toLowerCase(), s])).values()];

  function toTicket(issue: JiraIssue, ids: FieldIds, past: Past): JiraTicket | null {
    const f = issue.fields;
    const createdAt = jiraDate(f.created);
    if (!createdAt) return null;
    const first = slaOutcome(ids.firstResponse ? f[ids.firstResponse] : null, "first");
    const resolution = slaOutcome(ids.resolution ? f[ids.resolution] : null, "last");
    const resolvedAt = jiraDate(f.resolutiondate);
    const updatedAt = jiraDate(f.updated) ?? createdAt;
    const rawRating = ids.satisfaction ? f[ids.satisfaction] : null;
    const rating = Number(typeof rawRating === "object" && rawRating ? (rawRating as { rating?: unknown }).rating : rawRating);
    const csat = Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null;
    return {
      key: issue.key,
      summary: (f.summary ?? "").slice(0, 500),
      description: plainText(f.description).trim().slice(0, 4000) || null,
      status: f.status?.name ?? "",
      createdAt,
      updatedAt,
      resolvedAt,
      firstResponseAt: first.at,
      firstResponseBreached: first.breached,
      // A ticket that is not resolved has no final answer on its resolution SLA unless it is already late.
      resolutionBreached: resolution.breached,
      csat,
      // Without a rating date, the rating counts in the month the ticket was resolved.
      csatAt: csat == null ? null : ((ids.satisfactionDate ? jiraDate(f[ids.satisfactionDate]) : null) ?? resolvedAt ?? updatedAt),
      statusesSeen: unique([f.status?.name ?? "", ...past.statuses].filter(Boolean)),
      labelsSeen: unique([...(f.labels ?? []), ...past.labels]),
    };
  }

  const port: JiraPort = {
    kind,
    async listProjects() {
      const out: { key: string; name: string }[] = [];
      for (let startAt = 0, page = 0; page < 50; page++) {
        const data = (await call("GET", `/rest/api/3/project/search?startAt=${startAt}&maxResults=${PAGE}`)) as { values?: { key: string; name: string }[]; isLast?: boolean };
        const values = data.values ?? [];
        out.push(...values.map((p) => ({ key: p.key, name: p.name })));
        startAt += values.length;
        if (data.isLast !== false || values.length === 0) break;
      }
      return out;
    },
    async describeBoard(projectKey): Promise<JiraBoard> {
      const key = projectKey.toUpperCase();
      const project = (await call("GET", `/rest/api/3/project/${encodeURIComponent(key)}`)) as { key: string; name: string; projectTypeKey?: string };
      const perType = (await call("GET", `/rest/api/3/project/${encodeURIComponent(key)}/statuses`)) as { statuses?: { name: string }[] }[];
      const recent = await search(`project = ${quote(key)} ORDER BY updated DESC`, ["labels"], true);
      const ids = await fields();
      const names = (list: string[]) => [...new Map(list.map((s) => [s.toLowerCase(), s])).values()].sort((a, b) => a.localeCompare(b));
      return {
        key: project.key,
        name: project.name,
        serviceDesk: project.projectTypeKey === "service_desk",
        statuses: names(perType.flatMap((t) => (t.statuses ?? []).map((s) => s.name))),
        labels: names(recent.flatMap((i) => i.fields.labels ?? [])),
        measures: { firstResponse: !!ids.firstResponse, resolution: !!ids.resolution, satisfaction: !!ids.satisfaction },
      };
    },
    async fetchTickets(projectKey, since, now) {
      const ids = await fields();
      // Asked as "changed in the last N minutes", which means the same in every time zone. Ten minutes of overlap, since Jira compares by the minute.
      const minutes = since ? Math.max(1, Math.ceil((now.getTime() - since.getTime()) / 60_000) + 10) : null;
      // Every unresolved ticket is asked for each time as well: an SLA that runs out does not count as a change in Jira, and
      // an open ticket that no longer comes back has been deleted or moved away. The first time, tickets resolved more than
      // two years ago are left where they are.
      const changed = minutes ? `updated >= "-${minutes}m"` : `resolved >= "-${KEEP_WEEKS}w"`;
      const project = `project = ${quote(projectKey.toUpperCase())}`;
      const wanted = ["summary", "description", "status", "created", "updated", "resolutiondate", "labels", ...Object.values(ids).filter((v): v is string => !!v)];
      // Two plain questions instead of one joined by OR: every ticket that matches either comes back, whatever Jira makes of the combination.
      const byKey = new Map<string, JiraIssue>();
      for (const condition of [changed, "resolution IS EMPTY"])
        for (const issue of await search(`${project} AND ${condition} ORDER BY updated ASC`, wanted)) byKey.set(issue.key, issue);
      const issues = [...byKey.values()];
      const past = await histories(issues.map((i) => i.id).filter((id): id is string => !!id));
      const none: Past = { statuses: [], labels: [] };
      return issues
        .map((issue) => toTicket(issue, ids, (issue.id ? past.get(issue.id) : undefined) ?? none))
        .filter((t): t is JiraTicket => !!t)
        .sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }));
    },
    ticketUrl: (ticketKey) => (browseBase ? `${browseBase}/browse/${encodeURIComponent(ticketKey)}` : null),
    async check() {
      try {
        const projects = await port.listProjects();
        if (kind === "stand-in") return { ok: true, detail: `Stand-in Jira with ${projects.length} invented boards.` };
        return projects.length
          ? { ok: true, detail: `Connected to Jira. The account can see ${projects.length} boards.` }
          : { ok: false, detail: "Connected to Jira, but the account cannot see any boards.", fix: "Give the Jira service account access to each vendor's service desk." };
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 401 || status === 403) {
          return { ok: false, detail: "Jira refused the sign-in.", fix: "Check the Jira service account's email and API token in the app settings." };
        }
        console.error("Jira check failed:", (e as Error).message);
        return {
          ok: false,
          detail: `Jira did not respond as expected. ${explain(e).cause}`,
          fix: "Check JIRA_BASE_URL, and ask IT whether Databricks Apps are allowed to connect out to Atlassian.",
        };
      }
    },
  };
  return port;
}

/** Local stand-in: invented boards and tickets, answered in Jira's own shapes. `now` is the moment the invented helpdesk has reached. */
export const fakeJira = (now: () => Date = () => new Date()): JiraPort => jiraClient(fakeJiraSite(now), "stand-in", null);

/**
 * How many seconds to wait before asking Jira again after a "slow down" answer, or null when it is
 * better to give up and let the next sync try. Atlassian's guidance: never wait less than Retry-After,
 * back off further at each attempt, and add some randomness so callers do not all return at once.
 * A wait of more than a minute means an hourly allowance is used up; waiting inside a request is no use then.
 */
export function retryWait(retryAfter: string | null, attempt: number, random: () => number = Math.random): number | null {
  const asked = Number(retryAfter);
  if (Number.isFinite(asked) && asked > 60) return null;
  const base = Number.isFinite(asked) && asked > 0 ? asked : 2 ** attempt;
  return base * (1 + 0.3 * random());
}

/** Deployed: Jira Cloud REST API with a service account's email and API token. UNPROVEN until first deployment. */
export function cloudJira(baseUrl: string, email: string, token: string): JiraPort {
  const auth = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
  const base = baseUrl.replace(/\/$/, "");
  const call: JiraTransport = async (method, path, body) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(base + path, {
        method,
        headers: { Authorization: auth, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: limit(),
      });
      // Jira asks callers to slow down with 429, and says in Retry-After (seconds) how long to wait at the least.
      if (res.status === 429 && attempt < 3) {
        const wait = retryWait(res.headers.get("Retry-After"), attempt);
        if (wait != null) {
          await new Promise((r) => setTimeout(r, wait * 1000));
          continue;
        }
      }
      if (!res.ok) throw Object.assign(new Error(`Jira answered ${res.status} ${res.statusText}`), { status: res.status });
      return res.json() as Promise<unknown>;
    }
  };
  return jiraClient(call, "real", base);
}
