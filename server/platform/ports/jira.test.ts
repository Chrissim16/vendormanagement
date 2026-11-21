import { describe, expect, it } from "vitest";
import { cloudJira, fakeJira, jiraClient, jiraDate, plainText, slaOutcome, type JiraTransport } from "./jira";
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

  it("reads a ticket's earlier statuses and labels from its history, pages of search results, and a rating sent as a number", async () => {
    const calls: string[] = [];
    const site: JiraTransport = async (method, path, body) => {
      calls.push(`${method} ${path.split("?")[0]} ${(body as { nextPageToken?: string })?.nextPageToken ?? ""}`.trim());
      if (path === "/rest/api/3/field")
        return [
          { id: "customfield_1", name: "Time to first response" },
          { id: "customfield_3", name: "Satisfaction" },
        ];
      if (path === "/rest/api/3/search/jql") {
        const issue = (key: string) => ({
          key,
          fields: {
            summary: "S",
            status: { name: "Done" },
            created: "2026-11-01T10:00:00.000+0100",
            updated: "2026-11-02T10:00:00.000+0100",
            resolutiondate: "2026-11-02T10:00:00.000+0100",
            labels: ["now"],
            customfield_3: 4,
          },
        });
        return (body as { nextPageToken?: string }).nextPageToken ? { issues: [issue("X-2")], isLast: true } : { issues: [issue("X-1")], nextPageToken: "p2", isLast: false };
      }
      if (path.includes("/changelog"))
        return {
          isLast: true,
          values: [
            { items: [{ field: "status", fromString: "Open", toString: "Escalated" }] },
            {
              items: [
                { field: "labels", fromString: "old one", toString: "now" },
                { field: "assignee", fromString: "a", toString: "b" },
              ],
            },
          ],
        };
      throw new Error(`unexpected ${path}`);
    };
    const tickets = await jiraClient(site, "real", "https://jira.example.test").fetchTickets("x", new Date("2026-11-21T11:00:00Z"), NOON);
    expect(tickets.map((t) => t.key)).toEqual(["X-1", "X-2"]);
    expect(calls.filter((c) => c.includes("search"))).toEqual(["POST /rest/api/3/search/jql", "POST /rest/api/3/search/jql p2"]);
    const t = tickets[0]!;
    expect(t.statusesSeen.sort()).toEqual(["Done", "Escalated", "Open"]);
    expect(t.labelsSeen.sort()).toEqual(["now", "old", "one"]);
    expect(t.csat).toBe(4);
    // No satisfaction date on this site: the rating counts when the ticket was resolved.
    expect(t.csatAt?.toISOString()).toBe("2026-11-02T09:00:00.000Z");
    // No "Time to resolution" on this site: no outcome, not a breach.
    expect(t.resolutionBreached).toBeNull();
    expect(t.firstResponseBreached).toBeNull();
  });

  it("leaves out a ticket that vanished between the search and the reading of its history, without failing the board", async () => {
    const site: JiraTransport = async (_m, path) => {
      if (path === "/rest/api/3/field") return [];
      if (path === "/rest/api/3/search/jql")
        return { issues: ["X-1", "X-2"].map((key) => ({ key, fields: { status: { name: "Open" }, created: "2026-11-01T10:00:00.000+0100" } })), isLast: true };
      if (path.includes("/X-1/")) throw Object.assign(new Error("Issue does not exist"), { status: 404 });
      return { values: [], isLast: true };
    };
    expect((await jiraClient(site, "real", null).fetchTickets("X", null, NOON)).map((t) => t.key)).toEqual(["X-2"]);
  });

  it("asks for changes as 'the last N minutes' with ten minutes of overlap, and for everything the first time", async () => {
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
      'project = "BLU" AND (updated >= "-70m" OR resolution IS EMPTY) ORDER BY updated ASC',
      'project = "BLU" AND (resolved >= "-105w" OR resolution IS EMPTY) ORDER BY updated ASC',
    ]);
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

  it("fails every second fetch of the flaky demo board, and not found for a board that does not exist", async () => {
    const site = fakeJira(() => NOON);
    expect((await site.fetchTickets("FLK", null, NOON)).length).toBeGreaterThan(0);
    await expect(site.fetchTickets("FLK", null, NOON)).rejects.toMatchObject({ status: 503 });
    expect((await site.fetchTickets("FLK", null, NOON)).length).toBeGreaterThan(0);
    await expect(site.fetchTickets("NOPE", null, NOON)).rejects.toMatchObject({ status: 404 });
  });
});
