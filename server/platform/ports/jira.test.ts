import { describe, expect, it } from "vitest";
import { cloudJira, fakeJira, jiraClient, jiraDate, plainText, retryWait, slaOutcome, type JiraTransport } from "./jira";
import { fakeJiraSite } from "./jira-fake";
import { FAKE_LABELS, FAKE_STATUSES } from "./jira-fake";

const NOON = new Date("2026-11-21T12:00:00Z");
const jira = fakeJira(() => NOON);

describe("reading what Jira sends", () => {
  it("reads Jira's time format, with or without a colon in the offset", () => {
    expect(jiraDate("2026-01-05T09:12:33.000+0100")?.toISOString()).toBe("2026-01-05T08:12:33.000Z");
    expect(jiraDate("2026-01-05T09:12:33.000+01:00")?.toISOString()).toBe("2026-01-05T08:12:33.000Z");
    expect(jiraDate("2026-01-05T09:12:33.000-0530")?.toISOString()).toBe("2026-01-05T14:42:33.000Z");
    expect(jiraDate(null)).toBeNull();
    expect(jiraDate("soon")).toBeNull();
  });

  it("takes an SLA's outcome from its finished cycle", () => {
    const value = { completedCycles: [{ stopTime: { epochMillis: Date.UTC(2026, 0, 5, 10) }, breached: false }], ongoingCycle: undefined };
    expect(slaOutcome(value, "first")).toEqual({ at: new Date(Date.UTC(2026, 0, 5, 10)), breached: false });
    expect(slaOutcome({ completedCycles: [{ stopTime: { iso8601: "2026-01-05T11:00:00.000+0100" }, breached: true }] }, "first")).toEqual({
      at: new Date(Date.UTC(2026, 0, 5, 10)),
      breached: true,
    });
  });
  it("uses the first cycle for the first response and the last for the resolution of a reopened ticket", () => {
    const value = {
      completedCycles: [
        { stopTime: { epochMillis: 1000 }, breached: false },
        { stopTime: { epochMillis: 2000 }, breached: true },
      ],
    };
    expect(slaOutcome(value, "first").breached).toBe(false);
    expect(slaOutcome(value, "last")).toEqual({ at: new Date(2000), breached: true });
  });
  it("puts finished cycles in time order itself, whatever order Jira sends them in", () => {
    const value = {
      completedCycles: [
        { startTime: { epochMillis: 1500 }, stopTime: { epochMillis: 2000 }, breached: true },
        { startTime: { epochMillis: 500 }, stopTime: { epochMillis: 1000 }, breached: false },
      ],
    };
    expect(slaOutcome(value, "first")).toEqual({ at: new Date(1000), breached: false });
    expect(slaOutcome(value, "last")).toEqual({ at: new Date(2000), breached: true });
  });
  it("has no outcome while an SLA is running in time, and a late one once it has run out", () => {
    expect(slaOutcome({ completedCycles: [], ongoingCycle: { breached: false } }, "first")).toEqual({ at: null, breached: null });
    expect(slaOutcome({ completedCycles: [], ongoingCycle: { breached: true } }, "first")).toEqual({ at: null, breached: true });
  });
  it("has no outcome for a ticket without that SLA", () => {
    expect(slaOutcome(null, "first")).toEqual({ at: null, breached: null });
    expect(slaOutcome(undefined, "last")).toEqual({ at: null, breached: null });
  });

  it("turns a description into plain text", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "First line " },
            { type: "text", text: "continues." },
          ],
        },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "A point" }] }] }] },
      ],
    };
    expect(plainText(doc).trim()).toBe("First line continues.\nA point");
    expect(plainText("already text")).toBe("already text");
    expect(plainText(null)).toBe("");
  });

  it("reads earlier statuses and labels from the history of all tickets at once, pages of search results, and a rating sent as a number", async () => {
    const calls: string[] = [];
    const site: JiraTransport = async (method, path, body) => {
      const b = (body ?? {}) as { nextPageToken?: string; jql?: string; issueIdsOrKeys?: string[] };
      calls.push(`${method} ${path} ${b.nextPageToken ?? ""}`.trim());
      if (path === "/rest/api/3/field")
        return [
          { id: "customfield_9", name: "Time to first response", schema: { custom: "com.example:something-else" } },
          { id: "customfield_1", name: "Time to first response", schema: { custom: "com.atlassian.servicedesk:sd-sla-field" } },
          { id: "customfield_3", name: "Satisfaction" },
        ];
      if (path === "/rest/api/3/search/jql") {
        const issue = (id: string, key: string) => ({
          id,
          key,
          fields: {
            summary: "S",
            status: { name: "Done" },
            created: "2026-11-01T10:00:00.000+0100",
            updated: "2026-11-02T10:00:00.000+0100",
            resolutiondate: "2026-11-02T10:00:00.000+0100",
            labels: ["now"],
            customfield_3: 4,
            customfield_1: { completedCycles: [{ stopTime: { epochMillis: Date.UTC(2026, 10, 1, 10) }, breached: true }] },
            customfield_9: { completedCycles: [{ stopTime: { epochMillis: 1 }, breached: false }] },
          },
        });
        if (b.jql!.includes("IS EMPTY")) return { issues: [], isLast: true };
        // The last page carries no token, as Atlassian documents.
        return b.nextPageToken ? { issues: [issue("502", "X-2")], isLast: true } : { issues: [issue("501", "X-1")], nextPageToken: "p2", isLast: false };
      }
      if (path === "/rest/api/3/changelog/bulkfetch") {
        expect(b.issueIdsOrKeys).toEqual(["501", "502"]);
        // One ticket's history arrives spread over two pages; the answer names tickets by id, never by key.
        return b.nextPageToken
          ? {
              issueChangeLogs: [
                {
                  issueId: "501",
                  changeHistories: [
                    {
                      items: [
                        { field: "labels", fieldId: "labels", fromString: "old one", toString: "now" },
                        { field: "assignee", fromString: "a", toString: "b" },
                      ],
                    },
                  ],
                },
              ],
              nextPageToken: null,
            }
          : {
              issueChangeLogs: [{ issueId: "501", changeHistories: [{ items: [{ field: "status", fieldId: "status", fromString: "Open", toString: "Escalated" }] }] }],
              nextPageToken: "h2",
            };
      }
      throw new Error(`unexpected ${path}`);
    };
    const tickets = await jiraClient(site, "real", "https://jira.example.test").fetchTickets("x", new Date("2026-11-21T11:00:00Z"), NOON);
    expect(tickets.map((t) => t.key)).toEqual(["X-1", "X-2"]);
    expect(calls.filter((c) => c.includes("search"))).toEqual(["POST /rest/api/3/search/jql", "POST /rest/api/3/search/jql p2", "POST /rest/api/3/search/jql"]);
    // Two tickets, two pages of history: two requests, not one per ticket.
    expect(calls.filter((c) => c.includes("changelog"))).toEqual(["POST /rest/api/3/changelog/bulkfetch", "POST /rest/api/3/changelog/bulkfetch h2"]);
    const t = tickets[0]!;
    expect(t.statusesSeen.sort()).toEqual(["Done", "Escalated", "Open"]);
    expect(t.labelsSeen.sort()).toEqual(["now", "old", "one"]);
    // A ticket with no history has only what it carries now.
    expect(tickets[1]!.statusesSeen).toEqual(["Done"]);
    expect(t.csat).toBe(4);
    // No satisfaction date on this site: the rating counts when the ticket was resolved.
    expect(t.csatAt?.toISOString()).toBe("2026-11-02T09:00:00.000Z");
    // No "Time to resolution" on this site: no outcome, not a breach.
    expect(t.resolutionBreached).toBeNull();
    // Of two fields with the same name, the service desk's own is read.
    expect(t.firstResponseBreached).toBe(true);
  });

  it("asks for the history of a large board a thousand tickets at a time", async () => {
    const batches: number[] = [];
    const site: JiraTransport = async (_m, path, body) => {
      if (path === "/rest/api/3/field") return [];
      if (path === "/rest/api/3/search/jql") {
        if ((body as { jql: string }).jql.includes("IS EMPTY")) return { issues: [], isLast: true };
        return {
          issues: Array.from({ length: 2300 }, (_, i) => ({ id: String(i + 1), key: `X-${i + 1}`, fields: { status: { name: "Open" }, created: "2026-11-01T10:00:00.000+0100" } })),
          isLast: true,
        };
      }
      batches.push((body as { issueIdsOrKeys: string[] }).issueIdsOrKeys.length);
      return { issueChangeLogs: [] };
    };
    expect((await jiraClient(site, "real", null).fetchTickets("X", null, NOON)).length).toBe(2300);
    expect(batches).toEqual([1000, 1000, 300]);
  });

  it("asks two plain questions: what changed in 'the last N minutes' with ten minutes of overlap (everything the first time), and what is unresolved", async () => {
    const asked: string[] = [];
    const site: JiraTransport = async (_m, path, body) => {
      if (path === "/rest/api/3/field") return [];
      asked.push((body as { jql: string }).jql);
      return { issues: [], isLast: true };
    };
    const client = jiraClient(site, "real", null);
    await client.fetchTickets("blu", new Date("2026-11-21T11:00:00Z"), NOON);
    await client.fetchTickets("BLU", null, NOON);
    // Unresolved tickets are always asked for; the first time, so are those resolved in the last two years.
    expect(asked).toEqual([
      'project = "BLU" AND updated >= "-70m" ORDER BY updated ASC',
      'project = "BLU" AND resolution IS EMPTY ORDER BY updated ASC',
      'project = "BLU" AND resolved >= "-105w" ORDER BY updated ASC',
      'project = "BLU" AND resolution IS EMPTY ORDER BY updated ASC',
    ]);
  });

  it("waits at least as long as Jira asks after 'slow down', a little longer each try, and gives up when the wait is an hourly allowance", () => {
    expect(retryWait("20", 0, () => 0)).toBe(20);
    expect(retryWait("45", 2, () => 1)).toBeCloseTo(58.5);
    for (let i = 0; i < 20; i++) expect(retryWait("7", 1)).toBeGreaterThanOrEqual(7);
    // No header: 1, 2, 4 seconds, never less.
    expect([0, 1, 2].map((n) => retryWait(null, n, () => 0))).toEqual([1, 2, 4]);
    expect(retryWait("not a number", 1, () => 0)).toBe(2);
    expect(retryWait("1800", 0)).toBeNull();
  });

  it("gives the address of a ticket on the real site, and none on the stand-in", () => {
    expect(cloudJira("https://jira.example.test/", "bot@example.test", "token").ticketUrl("BLU-12")).toBe("https://jira.example.test/browse/BLU-12");
    expect(jira.ticketUrl("BLU-12")).toBeNull();
  });
});

describe("the stand-in Jira", () => {
  it("has invented boards only, each saying so", async () => {
    const projects = await jira.listProjects();
    expect(projects.map((p) => p.key)).toEqual(expect.arrayContaining(["BLU", "MOS", "TAR", "SED"]));
    for (const p of projects) expect(p.name).toMatch(/\(invented/);
  });

  it("describes a board that escalates by status and one that escalates by label", async () => {
    const blu = await jira.describeBoard("blu");
    expect(blu).toMatchObject({ key: "BLU", serviceDesk: true, measures: { firstResponse: true, resolution: true, satisfaction: true } });
    expect(blu.statuses).toEqual(expect.arrayContaining([FAKE_STATUSES.second, FAKE_STATUSES.third]));
    const mos = await jira.describeBoard("MOS");
    expect(mos.statuses).not.toContain(FAKE_STATUSES.second);
    expect(mos.labels).toEqual(expect.arrayContaining([FAKE_LABELS.second]));
    expect((await jira.describeBoard("FIN")).serviceDesk).toBe(false);
  });

  it("tells the same story every time, and only moves forward as time passes", async () => {
    const first = await jira.fetchTickets("TAR", null, NOON);
    expect(first.length).toBeGreaterThan(200);
    expect(await fakeJira(() => NOON).fetchTickets("TAR", null, NOON)).toEqual(first);
    const later = new Date("2026-12-21T12:00:00Z");
    const after = await fakeJira(() => later).fetchTickets("TAR", null, later);
    expect(after.length).toBeGreaterThan(first.length);
    const before = new Map(first.map((t) => [t.key, t]));
    for (const t of after) {
      const was = before.get(t.key);
      if (!was) continue;
      expect(t.createdAt).toEqual(was.createdAt);
      if (was.resolvedAt) expect(t.resolvedAt).toEqual(was.resolvedAt);
      if (was.firstResponseBreached !== null) expect(t.firstResponseBreached).toBe(was.firstResponseBreached);
    }
  });

  it("returns what changed since the given moment, and every ticket that is still open", async () => {
    const dayAgo = new Date(NOON.getTime() - 86_400_000);
    const recent = await jira.fetchTickets("BLU", dayAgo, NOON);
    const all = await jira.fetchTickets("BLU", null, NOON);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.length).toBeLessThan(all.length / 10);
    for (const t of recent) expect(!t.resolvedAt || t.updatedAt.getTime() >= dayAgo.getTime() - 10 * 60_000, t.key).toBe(true);
    const open = (list: typeof all) => list.filter((t) => !t.resolvedAt).map((t) => t.key);
    expect(open(recent)).toEqual(open(all));
    expect(open(all).length).toBeGreaterThan(0);
    // A ticket still waiting past its response time comes back although nothing on it changed.
    expect(all.filter((t) => t.updatedAt.getTime() >= dayAgo.getTime()).every((t) => recent.some((r) => r.key === t.key))).toBe(true);
  });

  it("the first fetch leaves out tickets resolved more than two years ago", async () => {
    const far = new Date("2028-06-01T12:00:00Z");
    const tickets = await fakeJira(() => far).fetchTickets("TAR", null, far);
    const oldest = Math.min(...tickets.filter((t) => t.resolvedAt).map((t) => t.resolvedAt!.getTime()));
    expect(oldest).toBeGreaterThanOrEqual(far.getTime() - 105 * 7 * 86_400_000);
    expect(tickets.length).toBeGreaterThan(300);
  });

  it("shows escalation as a status on one board and as a label on the other", async () => {
    const blu = await jira.fetchTickets("BLU", null, NOON);
    expect(blu.some((t) => t.statusesSeen.includes(FAKE_STATUSES.third))).toBe(true);
    expect(blu.some((t) => t.labelsSeen.includes(FAKE_LABELS.second))).toBe(false);
    const mos = await jira.fetchTickets("MOS", null, NOON);
    expect(mos.some((t) => t.labelsSeen.includes(FAKE_LABELS.third))).toBe(true);
    expect(mos.some((t) => t.statusesSeen.includes(FAKE_STATUSES.second))).toBe(false);
  });

  it("has open and resolved tickets, late and timely answers, and ratings from 1 to 5", async () => {
    const all = await jira.fetchTickets("BLU", null, NOON);
    expect(all.some((t) => !t.resolvedAt)).toBe(true);
    expect(all.some((t) => t.firstResponseBreached === true)).toBe(true);
    expect(all.some((t) => t.firstResponseBreached === false)).toBe(true);
    expect(all.some((t) => t.resolutionBreached === true)).toBe(true);
    for (const t of all) {
      if (t.csat !== null) expect(t.csat >= 1 && t.csat <= 5 && t.csatAt! > t.resolvedAt!).toBe(true);
      if (t.resolvedAt) expect(t.resolvedAt > t.createdAt).toBe(true);
      expect(t.updatedAt.getTime()).toBeLessThanOrEqual(NOON.getTime());
    }
    expect(new Set(all.map((t) => t.csat))).toEqual(new Set([null, 1, 2, 3, 4, 5]));
  });

  it("answers ticket history in pages that cut across tickets, by ticket id, and refuses more than a thousand tickets", async () => {
    const site = fakeJiraSite(() => NOON);
    const found = (await site("POST", "/rest/api/3/search/jql", { jql: 'project = "BLU" AND resolved >= "-4w"', maxResults: 100 })) as { issues: { id: string; key: string }[] };
    const ids = found.issues.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => id.includes("BLU"))).toBe(false);
    const whole = (await site("POST", "/rest/api/3/changelog/bulkfetch", { issueIdsOrKeys: ids })) as {
      issueChangeLogs: { issueId: string; changeHistories: unknown[] }[];
      nextPageToken?: string;
    };
    expect(whole.nextPageToken).toBeUndefined();
    const total = whole.issueChangeLogs.reduce((n, l) => n + l.changeHistories.length, 0);
    expect(total).toBeGreaterThan(ids.length);
    let seen = 0;
    let token: string | undefined;
    do {
      const page = (await site("POST", "/rest/api/3/changelog/bulkfetch", { issueIdsOrKeys: ids, maxResults: 7, nextPageToken: token })) as typeof whole;
      seen += page.issueChangeLogs.reduce((n, l) => n + l.changeHistories.length, 0);
      token = page.nextPageToken;
    } while (token);
    expect(seen).toBe(total);
    await expect(site("POST", "/rest/api/3/changelog/bulkfetch", { issueIdsOrKeys: Array.from({ length: 1001 }, (_, i) => String(i)) })).rejects.toMatchObject({ status: 400 });
  });

  it("fails every second fetch of the flaky demo board, and not found for a board that does not exist", async () => {
    const site = fakeJira(() => NOON);
    expect((await site.fetchTickets("FLK", null, NOON)).length).toBeGreaterThan(0);
    await expect(site.fetchTickets("FLK", null, NOON)).rejects.toMatchObject({ status: 503 });
    expect((await site.fetchTickets("FLK", null, NOON)).length).toBeGreaterThan(0);
    await expect(site.fetchTickets("NOPE", null, NOON)).rejects.toMatchObject({ status: 404 });
  });
});
