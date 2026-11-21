import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jiraBoardLinks, tickets } from "../../../db/schema";
import { metricKeys, ticketSets, type MonthCounts, type OverviewRow, type PerformanceOverview, type VendorPerformance } from "../../../shared/performance";
import { performanceContext } from "../../app";
import type { JiraBoard, JiraTicket } from "../../platform/ports/types";
import { ADMIN, MEMBER, testApp } from "../../testing";
import { syncAll, syncBoard } from "./service";

let t: Awaited<ReturnType<typeof testApp>>;
let me: string;
const ids: Record<string, string> = {};
beforeAll(async () => {
  t = await testApp();
  me = (await t.as(MEMBER).get("/api/me")).body.id;
  const vendors = (await t.as(MEMBER).get("/api/vendors").query({ status: "all", pageSize: "200" })).body.items as { id: string; name: string }[];
  for (const v of vendors) ids[v.name] = v.id;
});
afterAll(() => t.close());

const newVendor = async (name: string, fields: Record<string, unknown> = {}) =>
  (
    await t
      .as(MEMBER)
      .post("/api/vendors")
      .send({ name, type: "software", ownerUserId: me, ndaRequired: false, dpaRequired: false, ...fields })
  ).body.id as string;
const statusLink = { escalationMethod: "status", l1Values: ["Waiting for support"], l2Values: ["Escalated to second line"], l3Values: ["With vendor engineering"] };
const labelLink = { escalationMethod: "label", l2Values: ["tier-2"], l3Values: ["tier-3"] };
const link = (vendorId: string, body: Record<string, unknown>, as = ADMIN) => t.as(as).put(`/api/admin/vendors/${vendorId}/jira-link`).send(body);
const perf = async (vendorId: string, month?: string) =>
  (
    await t
      .as(MEMBER)
      .get(`/api/performance/vendors/${vendorId}`)
      .query(month ? { month } : {})
  ).body as VendorPerformance;
const history = async (vendorId: string) =>
  (
    (await t.as(MEMBER).get("/api/audit/history").query({ entityType: "vendor", entityId: vendorId })).body.items as {
      changes: Record<string, { from: unknown; to: unknown }> | null;
    }[]
  ).flatMap((e) => Object.entries(e.changes ?? {}));

/** Stand-in for the stand-in: a board whose tickets the test writes by hand, so every figure can be checked against a known answer. */
function handBoard(key: string, list: () => JiraTicket[]) {
  const jira = t.ports.jira;
  const { describeBoard, fetchTickets } = jira;
  jira.describeBoard = async (k): Promise<JiraBoard> =>
    k.toUpperCase() === key
      ? {
          key,
          name: `${key} hand-made board (invented)`,
          serviceDesk: true,
          statuses: ["Open", "Second line", "Third line", "Done"],
          labels: [],
          measures: { firstResponse: true, resolution: true, satisfaction: true },
        }
      : describeBoard(k);
  jira.fetchTickets = async (k, since, now) => (k.toUpperCase() === key ? list() : fetchTickets(k, since, now));
}
const at = (s: string) => new Date(s);
const ticket = (key: string, createdAt: string, o: Partial<JiraTicket> = {}): JiraTicket => ({
  key,
  summary: `Ticket ${key}`,
  description: null,
  status: o.resolvedAt ? "Done" : "Open",
  createdAt: at(createdAt),
  updatedAt: at(createdAt),
  resolvedAt: null,
  firstResponseAt: null,
  firstResponseBreached: null,
  resolutionBreached: null,
  csat: null,
  csatAt: null,
  statusesSeen: ["Open"],
  labelsSeen: [],
  ...o,
});

describe("J-1 board link", () => {
  it("lets only an admin see the boards, test a link and save one", async () => {
    const v = await newVendor("Link Roles Vendor");
    expect((await t.as(MEMBER).get("/api/admin/jira/boards")).status).toBe(403);
    expect(
      (
        await t
          .as(MEMBER)
          .post("/api/admin/jira/test")
          .send({ projectKey: "SED", ...labelLink })
      ).status,
    ).toBe(403);
    expect((await link(v, { projectKey: "SED", ...labelLink }, MEMBER)).status).toBe(403);
    expect((await perf(v)).link).toBeNull();
  });

  it("lists the boards and says which are already linked", async () => {
    const boards = (await t.as(ADMIN).get("/api/admin/jira/boards")).body as { key: string; name: string; linkedTo: string | null }[];
    expect(boards.find((b) => b.key === "BLU")).toMatchObject({ linkedTo: "Bluefinch Systems" });
    expect(boards.find((b) => b.key === "SED")).toMatchObject({ linkedTo: null });
  });

  it("tests a link without saving: what the board has, and values that are not on it", async () => {
    const ok = (
      await t
        .as(ADMIN)
        .post("/api/admin/jira/test")
        .send({ projectKey: "blu", ...statusLink })
    ).body;
    expect(ok).toMatchObject({ ok: true, message: "Connected to Bluefinch Systems service desk (invented).", warnings: [] });
    expect(ok.statuses).toContain("Escalated to second line");

    const typo = (
      await t
        .as(ADMIN)
        .post("/api/admin/jira/test")
        .send({ projectKey: "BLU", ...statusLink, l2Values: ["Escalated to 2nd line"] })
    ).body;
    expect(typo.ok).toBe(true);
    expect(typo.warnings).toEqual(["Not a status on this board: Escalated to 2nd line. Check the spelling."]);

    const notDesk = (
      await t
        .as(ADMIN)
        .post("/api/admin/jira/test")
        .send({ projectKey: "FIN", ...statusLink })
    ).body;
    expect(notDesk.warnings[0]).toMatch(/not a service desk board/);

    const missing = (
      await t
        .as(ADMIN)
        .post("/api/admin/jira/test")
        .send({ projectKey: "NOPE", ...statusLink })
    ).body;
    expect(missing).toMatchObject({ ok: false, message: "Jira has no board with the key NOPE, or the Jira account is not allowed to see it." });
  });

  it("refuses a link without level 2 or 3 values, with one value for two levels, to a board that does not exist, or to a board another vendor has", async () => {
    const v = await newVendor("Link Rules Vendor");
    const none = await link(v, { projectKey: "SED", escalationMethod: "label", l1Values: ["tier-1"] });
    expect(none.status).toBe(400);
    expect(none.body.error.fields.l2Values).toMatch(/at least one label/);
    const twice = await link(v, { projectKey: "SED", escalationMethod: "label", l2Values: ["tier-2"], l3Values: ["TIER-2"] });
    expect(twice.body.error.fields.l3Values).toMatch(/already listed for level 2/);
    const nowhere = await link(v, { projectKey: "NOPE", ...labelLink });
    expect(nowhere.status).toBe(400);
    expect(nowhere.body.error.fields.projectKey).toMatch(/no board with the key NOPE/);
    const taken = await link(v, { projectKey: "blu", ...statusLink });
    expect(taken.status).toBe(400);
    expect(taken.body.error.fields.projectKey).toBe("That board is already linked to Bluefinch Systems. A board belongs to one vendor.");
    expect((await link(v, { escalationMethod: "label" })).body.error.fields.projectKey).toBe("Choose a board.");
    expect((await link("00000000-0000-4000-8000-000000000000", { projectKey: "SED", ...labelLink })).status).toBe(404);
    expect((await perf(v)).link).toBeNull();
  });

  it("links a vendor, fetches its tickets straight away, and records it in the vendor's history", async () => {
    const v = await newVendor("Sedgewater Link Vendor");
    const res = await link(v, { projectKey: "sed", ...labelLink });
    expect(res.status).toBe(200);
    expect(res.body.link).toMatchObject({
      projectKey: "SED",
      projectName: "Sedgewater Cloud support (invented)",
      escalationMethod: "label",
      l2Values: ["tier-2"],
      active: true,
      lastSyncOk: true,
    });
    expect(res.body.sync).toMatchObject({ ok: true, projectKey: "SED" });
    expect(res.body.link.tickets).toBeGreaterThan(200);
    expect(res.body.link.tickets).toBe(res.body.sync.updated);
    expect(await history(v)).toEqual(expect.arrayContaining([["Jira board", { from: null, to: "SED · Sedgewater Cloud support (invented)" }]]));
    const p = await perf(v, "2026-10");
    expect(p.months).toHaveLength(12);
    expect(p.months.at(-1)!.counts.resolved).toBeGreaterThan(10);
    // Some tickets went beyond the first line, read from their labels.
    expect(p.months.at(-1)!.counts.firstLine).toBeLessThan(p.months.at(-1)!.counts.resolved);
  });

  it("works every ticket's level out again when the level values change, without fetching again", async () => {
    const v = ids["Tarnwick Software"]!;
    const before = (await perf(v, "2026-10")).months.at(-1)!.counts;
    expect(before.firstLine).toBeLessThan(before.resolved);
    const syncedAt = (await perf(v)).link!.lastSyncedAt;
    // Second line no longer counts as an escalation: only the third line does.
    const res = await link(v, {
      projectKey: "TAR",
      escalationMethod: "status",
      l1Values: ["Waiting for support", "Escalated to second line"],
      l2Values: [],
      l3Values: ["With vendor engineering"],
    });
    expect(res.status).toBe(200);
    expect(res.body.sync).toBeNull();
    const after = (await perf(v, "2026-10")).months.at(-1)!.counts;
    expect(after.resolved).toBe(before.resolved);
    expect(after.firstLine).toBeGreaterThan(before.firstLine);
    expect((await perf(v)).link!.lastSyncedAt).toBe(syncedAt);
    expect(await history(v)).toEqual(expect.arrayContaining([["level 2 values", { from: "Escalated to second line", to: null }]]));
    // Reading by label on a board that escalates by status: nothing was ever escalated.
    await link(v, { projectKey: "TAR", ...labelLink });
    const byLabel = (await perf(v, "2026-10")).months.at(-1)!.counts;
    expect(byLabel.firstLine).toBe(byLabel.resolved);
    await link(v, { projectKey: "TAR", ...statusLink });
    expect((await perf(v, "2026-10")).months.at(-1)!.counts).toEqual(before);
  });

  it("saving a link unchanged writes no history", async () => {
    const v = ids["Tarnwick Software"]!;
    const n = (await history(v)).length;
    expect((await link(v, { projectKey: "TAR", ...statusLink })).status).toBe(200);
    expect((await history(v)).length).toBe(n);
  });

  it("moving a vendor to another board drops the old board's tickets and fetches the new one's", async () => {
    const v = await newVendor("Board Mover");
    handBoard("MOVA", () => [ticket("MOVA-1", "2026-10-05T09:00:00Z")]);
    handBoard("MOVB", () => [ticket("MOVB-1", "2026-10-05T09:00:00Z"), ticket("MOVB-2", "2026-10-06T09:00:00Z")]);
    expect((await link(v, { projectKey: "MOVA", escalationMethod: "status", l2Values: ["Second line"] })).body.link.tickets).toBe(1);
    const moved = await link(v, { projectKey: "MOVB", escalationMethod: "status", l2Values: ["Second line"] });
    expect(moved.body.link).toMatchObject({ projectKey: "MOVB", tickets: 2 });
    const keys = (await t.as(MEMBER).get(`/api/performance/vendors/${v}/tickets`).query({ set: "backlog", month: "2026-11" })).body.items.map((x: { key: string }) => x.key);
    expect(keys.sort()).toEqual(["MOVB-1", "MOVB-2"]);
  });
});

describe("J-2 sync", () => {
  it("a member syncs one board on demand: only what changed since the last sync is fetched, and the result is shown", async () => {
    const v = ids["Bluefinch Systems"]!;
    const before = (await perf(v)).link!;
    expect(before).toMatchObject({ lastSyncOk: true, lastSyncMessage: null });
    expect(before.tickets).toBeGreaterThan(900);
    const res = await t.as(MEMBER).post(`/api/performance/vendors/${v}/sync`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, vendorName: "Bluefinch Systems", projectKey: "BLU", message: null });
    // The stand-in clock stands still, so only the ten-minute overlap comes back.
    expect(res.body.updated).toBeLessThan(10);
    const after = (await perf(v)).link!;
    expect(after.tickets).toBe(before.tickets);
    expect(after.lastSyncUpdated).toBe(res.body.updated);
    expect(after.lastSyncedAt).toBe("2026-11-21T12:00:00.000Z");
  });

  it("syncing twice changes nothing: the same tickets, the same figures", async () => {
    const v = ids["Mossgate IT"]!;
    const before = await perf(v);
    const ctx = performanceContext(t.config, t.ports);
    await t.ports.database.db.update(jiraBoardLinks).set({ lastSyncedAt: null }).where(eq(jiraBoardLinks.vendorId, v));
    const full = await syncBoard(ctx, before.link!.id);
    expect(full).toMatchObject({ ok: true, updated: before.link!.tickets });
    const after = await perf(v);
    expect(after.months).toEqual(before.months);
    expect(after.link!.tickets).toBe(before.link!.tickets);
  });

  it("a failed sync says why in plain words and leaves the tickets as they were; the next good sync clears the message", async () => {
    const v = await newVendor("Flaky Vendor");
    // The flaky demo board fails every second fetch.
    const first = await link(v, { projectKey: "FLK", ...statusLink });
    expect(first.body.sync.ok).toBe(true);
    const held = first.body.link.tickets as number;
    expect(held).toBeGreaterThan(50);
    const figures = (await perf(v)).months;

    const failed = (await t.as(MEMBER).post(`/api/performance/vendors/${v}/sync`)).body;
    expect(failed).toEqual({
      ok: false,
      updated: 0,
      vendorName: "Flaky Vendor",
      projectKey: "FLK",
      message: "Jira could not be read. The service reported a problem on its side. The tickets fetched earlier are unchanged.",
    });
    const after = await perf(v);
    expect(after.link).toMatchObject({ tickets: held, lastSyncOk: false, lastSyncMessage: failed.message, lastSyncedAt: first.body.link.lastSyncedAt });
    expect(after.months).toEqual(figures);

    expect((await t.as(MEMBER).post(`/api/performance/vendors/${v}/sync`)).body.ok).toBe(true);
    expect((await perf(v)).link).toMatchObject({ tickets: held, lastSyncOk: true, lastSyncMessage: null });
    // Switched off so the later "sync everything" tests are not thrown by its every-second failure.
    await link(v, { projectKey: "FLK", ...statusLink, active: false });
  });

  it("never passes Jira's own error text or anything secret on to the screen", async () => {
    const v = await newVendor("Leaky Vendor");
    handBoard("LEAK", () => [ticket("LEAK-1", "2026-10-05T09:00:00Z")]);
    await link(v, { projectKey: "LEAK", escalationMethod: "status", l2Values: ["Second line"] });
    handBoard("LEAK", () => {
      throw Object.assign(new Error("401 Unauthorized for bot@example.test token=abc123"), { status: 401 });
    });
    const res = (await t.as(MEMBER).post(`/api/performance/vendors/${v}/sync`)).body;
    expect(res.message).toBe("Jira refused the app's sign-in. An admin should check the Jira account's email and API token. The tickets fetched earlier are unchanged.");
    expect(JSON.stringify(await perf(v))).not.toContain("abc123");
    await link(v, { projectKey: "LEAK", escalationMethod: "status", l2Values: ["Second line"], active: false });
  });

  it("a failure while saving rolls everything back: no half-written tickets", async () => {
    const v = await newVendor("Rollback Vendor");
    let list = [ticket("ROLL-1", "2026-10-05T09:00:00Z"), ticket("ROLL-2", "2026-10-06T09:00:00Z")];
    handBoard("ROLL", () => list);
    const linked = await link(v, { projectKey: "ROLL", escalationMethod: "status", l2Values: ["Second line"] });
    // The second ticket of this batch cannot be stored (a rating of 9), so the first must not be stored either.
    list = [ticket("ROLL-1", "2026-10-05T09:00:00Z", { summary: "Changed" }), ticket("ROLL-3", "2026-10-07T09:00:00Z", { csat: 9, csatAt: at("2026-10-08T09:00:00Z") })];
    const all = await syncAll(performanceContext(t.config, t.ports));
    expect(all.find((r) => r.projectKey === "ROLL")).toMatchObject({ ok: false, updated: 0 });
    const rows = await t.ports.database.db.select({ key: tickets.key, summary: tickets.summary }).from(tickets).where(eq(tickets.boardLinkId, linked.body.link.id));
    expect(rows.sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: "ROLL-1", summary: "Ticket ROLL-1" },
      { key: "ROLL-2", summary: "Ticket ROLL-2" },
    ]);
    await link(v, { projectKey: "ROLL", escalationMethod: "status", l2Values: ["Second line"], active: false });
  });

  it("'Sync now' for everything syncs each board that is switched on and reports per board; one failing board does not stop the rest", async () => {
    const v = await newVendor("Broken Board Vendor");
    handBoard("BRKN", () => [ticket("BRKN-1", "2026-10-05T09:00:00Z")]);
    await link(v, { projectKey: "BRKN", escalationMethod: "status", l2Values: ["Second line"] });
    handBoard("BRKN", () => {
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    });
    const res = await t.as(MEMBER).post("/api/performance/sync");
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries((res.body as { projectKey: string; ok: boolean; message: string | null }[]).map((r) => [r.projectKey, r]));
    expect(byKey.BLU).toMatchObject({ ok: true });
    expect(byKey.MOS).toMatchObject({ ok: true });
    expect(byKey.BRKN).toMatchObject({ ok: false });
    expect(byKey.BRKN!.message).toMatch(/^Jira could not be read\. The service did not answer in time\./);
    // Boards whose sync is switched off are left alone.
    expect(byKey.FLK).toBeUndefined();
    await link(v, { projectKey: "BRKN", escalationMethod: "status", l2Values: ["Second line"], active: false });
  });

  it("a board whose sync is switched off cannot be synced, and keeps its tickets", async () => {
    const v = await newVendor("Paused Vendor");
    handBoard("PAUS", () => [ticket("PAUS-1", "2026-10-05T09:00:00Z")]);
    await link(v, { projectKey: "PAUS", escalationMethod: "status", l2Values: ["Second line"] });
    const off = await link(v, { projectKey: "PAUS", escalationMethod: "status", l2Values: ["Second line"], active: false });
    expect(off.body.link).toMatchObject({ active: false, tickets: 1 });
    const res = await t.as(MEMBER).post(`/api/performance/vendors/${v}/sync`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("The sync for this board is switched off. An admin can switch it on again.");
    expect(await history(v)).toEqual(expect.arrayContaining([["Jira sync", { from: "on", to: "off" }]]));
  });

  it("a vendor without a board cannot be synced", async () => {
    const v = await newVendor("No Board Vendor");
    const res = await t.as(MEMBER).post(`/api/performance/vendors/${v}/sync`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/no Jira board yet/);
  });

  it("the scheduled run only syncs boards that have not been tried within the interval", async () => {
    const ctx = performanceContext(t.config, t.ports);
    // Everything was tried a moment ago (the pinned clock), so nothing is due.
    expect(await syncAll(ctx, { dueOnly: true })).toEqual([]);
    await t.ports.database.db
      .update(jiraBoardLinks)
      .set({ lastAttemptAt: new Date("2026-11-21T10:59:00Z") })
      .where(eq(jiraBoardLinks.vendorId, ids["Bluefinch Systems"]!));
    const due = await syncAll(ctx, { dueOnly: true });
    expect(due.map((r) => r.projectKey)).toEqual(["BLU"]);
    expect(await syncAll(ctx, { dueOnly: true })).toEqual([]);
  });

  it("drops tickets resolved more than 24 months ago, and never takes them in", async () => {
    const v = await newVendor("Old Tickets Vendor");
    handBoard("OLDT", () => [
      ticket("OLDT-1", "2024-10-01T09:00:00Z", { resolvedAt: at("2024-11-20T09:00:00Z") }),
      ticket("OLDT-2", "2024-10-01T09:00:00Z", { resolvedAt: at("2024-11-22T09:00:00Z") }),
      ticket("OLDT-3", "2023-01-01T09:00:00Z"),
    ]);
    const res = await link(v, { projectKey: "OLDT", escalationMethod: "status", l2Values: ["Second line"] });
    // Resolved 24 months and a day ago: not kept. Resolved a day less than 24 months ago, or still open however old: kept.
    expect(res.body.link.tickets).toBe(2);
    const linkId = res.body.link.id as string;
    await t.ports.database.db.insert(tickets).values({ boardLinkId: linkId, key: "OLDT-0", createdAt: at("2024-01-01T09:00:00Z"), resolvedAt: at("2024-02-01T09:00:00Z") });
    await t.as(MEMBER).post(`/api/performance/vendors/${v}/sync`);
    const keys = (await t.ports.database.db.select({ key: tickets.key }).from(tickets).where(eq(tickets.boardLinkId, linkId))).map((r) => r.key).sort();
    expect(keys).toEqual(["OLDT-2", "OLDT-3"]);
    await link(v, { projectKey: "OLDT", escalationMethod: "status", l2Values: ["Second line"], active: false });
  });
});

describe("J-3 monthly metrics", () => {
  let v: string;
  beforeAll(async () => {
    v = await newVendor("Hand Counted Vendor");
    const met = { firstResponseBreached: false };
    handBoard("HAND", () => [
      // A: answered in 30 minutes, solved by the first line next day, rated 5 in October.
      ticket("HAND-1", "2026-10-05T09:00:00Z", {
        ...met,
        firstResponseAt: at("2026-10-05T09:30:00Z"),
        resolvedAt: at("2026-10-06T09:00:00Z"),
        resolutionBreached: false,
        csat: 5,
        csatAt: at("2026-10-07T09:00:00Z"),
      }),
      // B: answered late, went to the second line, resolved late, rated 2 in November.
      ticket("HAND-2", "2026-10-10T09:00:00Z", {
        firstResponseBreached: true,
        firstResponseAt: at("2026-10-10T14:00:00Z"),
        resolvedAt: at("2026-10-20T09:00:00Z"),
        resolutionBreached: true,
        statusesSeen: ["Open", "Second line", "Done"],
        csat: 2,
        csatAt: at("2026-11-02T09:00:00Z"),
      }),
      // C: answered in 20 minutes, still open.
      ticket("HAND-3", "2026-10-12T08:00:00Z", { ...met, firstResponseAt: at("2026-10-12T08:20:00Z") }),
      // D: created in September, resolved in October by the third line.
      ticket("HAND-4", "2026-09-20T09:00:00Z", {
        ...met,
        firstResponseAt: at("2026-09-20T09:10:00Z"),
        resolvedAt: at("2026-10-03T09:00:00Z"),
        resolutionBreached: false,
        statusesSeen: ["Open", "THIRD LINE", "Done"],
      }),
      // E: created half an hour into November, Amsterdam time. Not answered yet, still in time.
      ticket("HAND-5", "2026-10-31T23:30:00Z"),
      // F: created half an hour into October, Amsterdam time. Answered in an hour, resolved in November.
      ticket("HAND-6", "2026-09-30T22:30:00Z", { ...met, firstResponseAt: at("2026-09-30T23:30:00Z"), resolvedAt: at("2026-11-05T09:00:00Z"), resolutionBreached: false }),
      // G: no SLAs on it at all. Solved by the first line.
      ticket("HAND-7", "2026-10-15T09:00:00Z", { resolvedAt: at("2026-10-16T09:00:00Z") }),
    ]);
    await link(v, { projectKey: "HAND", escalationMethod: "status", l2Values: ["Second line"], l3Values: ["Third line"] });
  });

  it("works out the five metrics of a past month as the domain model defines them, by the team's calendar", async () => {
    const october = (await perf(v, "2026-10")).months.at(-1)!;
    expect(october.month).toBe("2026-10");
    expect(october.counts).toEqual<MonthCounts>({
      // A, B, C and F were created in October and have an outcome; G has no SLA; E belongs to November.
      frMeasured: 4,
      frMet: 3,
      // 20, 30, 60 and 300 minutes.
      frMedianMinutes: 45,
      // A, B, D and G.
      resolved: 4,
      firstLine: 2,
      breached: 1,
      // C (19 days) and F (31 days) were open when October ended.
      backlog: 2,
      backlogMedianDays: 25,
      backlogOldestDays: 31,
      ratings: 1,
      ratingSum: 5,
    });
    expect(Object.fromEntries(metricKeys.map((k) => [k, october.cells[k].valueTenths]))).toEqual({
      first_response: 750,
      first_line: 500,
      sla_breaches: 250,
      backlog_age: 310,
      csat: 50,
    });
  });

  it("measures the running month's backlog as of now", async () => {
    const november = (await perf(v)).months.at(-1)!;
    expect(november.month).toBe("2026-11");
    expect(november.counts).toEqual<MonthCounts>({
      frMeasured: 0,
      frMet: 0,
      frMedianMinutes: null,
      resolved: 1,
      firstLine: 1,
      breached: 0,
      // C is 40 days old at noon on 21 Nov, E is 20.
      backlog: 2,
      backlogMedianDays: 30,
      backlogOldestDays: 40,
      ratings: 1,
      ratingSum: 2,
    });
    expect(november.cells.first_response.valueTenths).toBeNull();
    expect(november.cells.csat.valueTenths).toBe(20);
  });

  it("shows twelve months ending with the chosen one, and never a month that has not started", async () => {
    const p = await perf(v, "2026-06");
    expect(p.months.map((m) => m.month)).toEqual([
      "2025-07",
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
    expect(p.currentMonth).toBe("2026-11");
    expect((await perf(v, "2027-03")).months.at(-1)!.month).toBe("2026-11");
    expect((await perf(v, "nonsense")).months.at(-1)!.month).toBe("2026-11");
  });

  const list = async (vendorId: string, query: Record<string, string>) => (await t.as(MEMBER).get(`/api/performance/vendors/${vendorId}/tickets`).query(query)).body;

  it("opens exactly the tickets behind each number", async () => {
    const keys = async (set: string, month = "2026-10") => ((await list(v, { set, month, sort: "key", dir: "asc" })).items as { key: string }[]).map((x) => x.key);
    expect(await keys("fr_measured")).toEqual(["HAND-1", "HAND-2", "HAND-3", "HAND-6"]);
    expect(await keys("fr_met")).toEqual(["HAND-1", "HAND-3", "HAND-6"]);
    expect(await keys("fr_missed")).toEqual(["HAND-2"]);
    expect(await keys("resolved")).toEqual(["HAND-1", "HAND-2", "HAND-4", "HAND-7"]);
    expect(await keys("first_line")).toEqual(["HAND-1", "HAND-7"]);
    expect(await keys("escalated")).toEqual(["HAND-2", "HAND-4"]);
    expect(await keys("breached")).toEqual(["HAND-2"]);
    expect(await keys("backlog")).toEqual(["HAND-3", "HAND-6"]);
    expect(await keys("rated")).toEqual(["HAND-1"]);
    expect(await keys("backlog", "2026-11")).toEqual(["HAND-3", "HAND-5"]);
    expect(await keys("rated", "2026-11")).toEqual(["HAND-2"]);
  });

  it("lists a ticket with what the figures were built from", async () => {
    const res = await list(v, { set: "breached", month: "2026-10" });
    expect(res).toMatchObject({ total: 1, month: "2026-10", vendorName: "Hand Counted Vendor" });
    expect(res.items[0]).toMatchObject({
      key: "HAND-2",
      summary: "Ticket HAND-2",
      status: "Done",
      createdAt: "2026-10-10T09:00:00.000Z",
      resolvedAt: "2026-10-20T09:00:00.000Z",
      firstResponseBreached: true,
      resolutionBreached: true,
      highestLevel: 2,
      csat: 2,
      url: null,
    });
  });

  it("for every board, month and figure, the list holds as many tickets as the number says", async () => {
    for (const name of ["Bluefinch Systems", "Mossgate IT"]) {
      const p = await perf(ids[name]!);
      for (const m of [p.months.at(-1)!, p.months.at(-2)!, p.months[0]!]) {
        const expected: Record<(typeof ticketSets)[number], number> = {
          fr_measured: m.counts.frMeasured,
          fr_met: m.counts.frMet,
          fr_missed: m.counts.frMeasured - m.counts.frMet,
          resolved: m.counts.resolved,
          first_line: m.counts.firstLine,
          escalated: m.counts.resolved - m.counts.firstLine,
          breached: m.counts.breached,
          backlog: m.counts.backlog,
          rated: m.counts.ratings,
        };
        for (const set of ticketSets) expect((await list(ids[name]!, { set, month: m.month, pageSize: "1" })).total, `${name} ${m.month} ${set}`).toBe(expected[set]);
      }
    }
  });

  it("searches, sorts and pages the ticket list on the server", async () => {
    const blu = ids["Bluefinch Systems"]!;
    const all = await list(blu, { set: "resolved", month: "2026-10", pageSize: "200", sort: "key", dir: "asc" });
    expect(all.total).toBeGreaterThan(40);
    const numbers = (all.items as { key: string }[]).map((x) => Number(x.key.split("-")[1]));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    const page2 = await list(blu, { set: "resolved", month: "2026-10", pageSize: "10", page: "2", sort: "key", dir: "asc" });
    expect(page2.items.map((x: { key: string }) => x.key)).toEqual(all.items.slice(10, 20).map((x: { key: string }) => x.key));
    const found = await list(blu, { set: "resolved", month: "2026-10", q: "ledger" });
    expect(found.total).toBeGreaterThan(0);
    expect(found.total).toBeLessThan(all.total);
    for (const x of found.items as { summary: string }[]) expect(x.summary.toLowerCase()).toContain("ledger");
    // % and _ are text, not wildcards.
    expect((await list(blu, { set: "resolved", month: "2026-10", q: "%" })).total).toBe(0);
    const newest = await list(blu, { set: "resolved", month: "2026-10", sort: "resolved", dir: "desc", pageSize: "200" });
    const times = (newest.items as { resolvedAt: string }[]).map((x) => x.resolvedAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  it("refuses a list without a known figure, and gives an empty list for a vendor without a board", async () => {
    expect((await t.as(MEMBER).get(`/api/performance/vendors/${v}/tickets`).query({ set: "everything" })).status).toBe(400);
    expect((await t.as(MEMBER).get(`/api/performance/vendors/${v}/tickets`)).status).toBe(400);
    const bare = await newVendor("Bare Vendor");
    expect(await list(bare, { set: "resolved" })).toMatchObject({ items: [], total: 0 });
    expect((await t.as(MEMBER).get("/api/performance/vendors/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect(await perf(bare)).toMatchObject({ link: null, months: [] });
  });

  it("the sample boards tell the story they were written for", async () => {
    const blu = await perf(ids["Bluefinch Systems"]!, "2026-10");
    // Twelve months of figures.
    for (const m of blu.months) expect(m.counts.resolved, m.month).toBeGreaterThan(20);
    // Bluefinch answered more than 95% in time until the summer, and has slipped since September.
    expect(blu.months.find((m) => m.month === "2026-05")!.cells.first_response.valueTenths).toBeGreaterThanOrEqual(940);
    expect(blu.months.at(-1)!.cells.first_response.valueTenths).toBeLessThan(940);
  });
});

describe("J-4 targets", () => {
  const put = (vendorId: string, body: Record<string, unknown>, as = MEMBER) => t.as(as).put(`/api/performance/vendors/${vendorId}/targets`).send(body);

  it("a member sets a target per metric, and each month then shows met or missed", async () => {
    const v = ids["Hand Counted Vendor"] ?? (await t.as(MEMBER).get("/api/vendors").query({ q: "Hand Counted Vendor" })).body.items[0].id;
    expect((await perf(v, "2026-10")).months.at(-1)!.missed).toBe(0);
    const res = await put(v, { first_response: 750, first_line: 650, sla_breaches: 250, backlog_age: 300, csat: 42 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ first_response: 750, first_line: 650, sla_breaches: 250, backlog_age: 300, csat: 42 });
    const october = (await perf(v, "2026-10")).months.at(-1)!;
    // 75% against at least 75%: met. 50% against at least 65%: missed. 25% against at most 25%: met. 31 days against at most 30: missed. 5.0 against 4.2: met.
    expect(Object.fromEntries(metricKeys.map((k) => [k, october.cells[k].verdict]))).toEqual({
      first_response: "met",
      first_line: "missed",
      sla_breaches: "met",
      backlog_age: "missed",
      csat: "met",
    });
    expect(october.missed).toBe(2);
    expect(october.cells.backlog_age).toEqual({ valueTenths: 310, targetTenths: 300, verdict: "missed" });
    // November has no first-response figure: no verdict, not a miss.
    const november = (await perf(v)).months.at(-1)!;
    expect(november.cells.first_response.verdict).toBe("none");
    expect(november.cells.csat.verdict).toBe("missed");
    expect(await history(v)).toEqual(
      expect.arrayContaining([
        ["target for first response", { from: null, to: "75% or more" }],
        ["target for backlog age", { from: null, to: "30 days or less" }],
        ["target for satisfaction", { from: null, to: "4.2 or more" }],
      ]),
    );
  });

  it("changes one target without touching the others, and removes one", async () => {
    const v = (await t.as(MEMBER).get("/api/vendors").query({ q: "Hand Counted Vendor" })).body.items[0].id as string;
    const n = (await history(v)).length;
    expect((await put(v, { first_line: 500, csat: null })).body).toEqual({ first_response: 750, first_line: 500, sla_breaches: 250, backlog_age: 300, csat: null });
    const october = (await perf(v, "2026-10")).months.at(-1)!;
    expect(october.cells.first_line.verdict).toBe("met");
    expect(october.cells.csat).toEqual({ valueTenths: 50, targetTenths: null, verdict: "none" });
    const added = (await history(v)).slice(0, (await history(v)).length - n);
    expect(added).toHaveLength(2);
    expect(added).toEqual(expect.arrayContaining([["target for satisfaction", { from: "4.2 or more", to: null }]]));
    // Saving the same again records nothing.
    await put(v, { first_line: 500 });
    expect((await history(v)).length).toBe(n + 2);
  });

  it("refuses a target that makes no sense, keeping what was there", async () => {
    const v = (await t.as(MEMBER).get("/api/vendors").query({ q: "Hand Counted Vendor" })).body.items[0].id as string;
    const bad = await put(v, { first_response: 1200, csat: 5, sla_breaches: "five" });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(["csat", "first_response", "sla_breaches"]);
    expect((await perf(v)).targets.first_response).toBe(750);
    expect((await put("00000000-0000-4000-8000-000000000000", { csat: 40 })).status).toBe(404);
  });

  it("a vendor can have targets before it has a board", async () => {
    const v = await newVendor("Targets First Vendor");
    expect((await put(v, { csat: 40 })).status).toBe(200);
    expect(await perf(v)).toMatchObject({ link: null, targets: { csat: 40, first_response: null } });
  });
});

describe("J-5 performance overview", () => {
  const overview = async (query: Record<string, string> = {}) => (await t.as(MEMBER).get("/api/performance").query(query)).body as PerformanceOverview;

  it("lists every scored vendor that has a board with this month's figures against target", async () => {
    const o = await overview();
    expect(o).toMatchObject({ month: "2026-11", currentMonth: "2026-11", syncEveryMinutes: 60 });
    const names = o.rows.map((r) => r.vendorName);
    expect(names).toEqual(expect.arrayContaining(["Bluefinch Systems", "Mossgate IT", "Tarnwick Software"]));
    const blu = o.rows.find((r) => r.vendorName === "Bluefinch Systems")!;
    expect(blu.link).toMatchObject({ projectKey: "BLU", lastSyncOk: true });
    expect(blu.metrics.cells.first_response).toMatchObject({ targetTenths: 950, verdict: "missed" });
    expect(blu.metrics).toEqual((await perf(blu.vendorId)).months.at(-1));
    // Tarnwick has no satisfaction target: a figure, no verdict.
    const tar = o.rows.find((r) => r.vendorName === "Tarnwick Software")!;
    expect(tar.metrics.cells.csat.targetTenths).toBeNull();
    expect(tar.metrics.cells.csat.verdict).toBe("none");
  });

  it("shows another month when asked", async () => {
    const o = await overview({ month: "2026-08" });
    expect(o.month).toBe("2026-08");
    const blu = o.rows.find((r) => r.vendorName === "Bluefinch Systems")!;
    expect(blu.metrics).toEqual((await perf(blu.vendorId, "2026-08")).months.at(-1));
  });

  it("sorts by vendor, by targets missed and by each metric, with nothing-to-measure last either way", async () => {
    const names = (o: PerformanceOverview) => o.rows.map((r) => r.vendorName);
    const az = names(await overview({ sort: "vendor", dir: "asc" }));
    expect(az).toEqual([...az].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    expect(names(await overview({ sort: "vendor", dir: "desc" }))).toEqual([...az].reverse());

    const worst = await overview();
    const missed = worst.rows.map((r) => r.metrics.missed);
    expect(missed).toEqual([...missed].sort((a, b) => b - a));
    expect(missed[0]).toBeGreaterThan(0);

    for (const dir of ["asc", "desc"] as const) {
      const o = await overview({ sort: "csat", dir });
      const values = o.rows.map((r) => r.metrics.cells.csat.valueTenths);
      const measured = values.filter((x): x is number => x != null);
      expect(values.slice(0, measured.length)).toEqual(measured);
      expect(measured).toEqual([...measured].sort((a, b) => (dir === "asc" ? a - b : b - a)));
    }
    expect((await t.as(MEMBER).get("/api/performance").query({ sort: "luck" })).status).toBe(400);
  });

  it("leaves out a vendor that is not scored, and names the scored vendors that have no board yet", async () => {
    const o = await overview();
    expect(o.unlinked.map((u) => u.name)).toEqual(expect.arrayContaining(["Quillon Consulting", "Sedgewater Cloud"]));
    // Not scored (Emberline), offboarded or a prospect: not waiting for a board.
    expect(o.unlinked.map((u) => u.name)).not.toEqual(expect.arrayContaining(["Emberline Advisory"]));
    expect(o.unlinked.map((u) => u.name)).not.toEqual(expect.arrayContaining(["Harrowick Partners"]));
    expect(o.unlinked.map((u) => u.name)).not.toEqual(expect.arrayContaining(["Bluefinch Systems"]));

    const v = await newVendor("Unscored With Board", { scoringEnabled: false });
    handBoard("UNSC", () => [ticket("UNSC-1", "2026-11-05T09:00:00Z")]);
    await link(v, { projectKey: "UNSC", escalationMethod: "status", l2Values: ["Second line"] });
    const names = (await overview()).rows.map((r: OverviewRow) => r.vendorName);
    expect(names).not.toContain("Unscored With Board");
    // Its own page still works.
    expect((await perf(v)).link).toMatchObject({ projectKey: "UNSC", tickets: 1 });
    await link(v, { projectKey: "UNSC", escalationMethod: "status", l2Values: ["Second line"], active: false });
  });

  it("answers quickly with tens of thousands of tickets (X-5)", async () => {
    const linkId = (await perf(ids["Tarnwick Software"]!)).link!.id;
    // 40,000 more tickets on one board, spread over two years.
    await t.ports.database.db.execute(sql`
      insert into tickets (board_link_id, key, summary, status, created_at, resolved_at, first_response_at, first_response_breached, resolution_breached, highest_level, csat, csat_at)
      select ${linkId}, 'BULK-' || n, 'Bulk ticket ' || n, 'Resolved',
        c, c + interval '2 days', c + interval '1 hour', n % 9 = 0, n % 13 = 0, 1 + (n % 3), 1 + (n % 5), c + interval '3 days'
      from (select n, timestamptz '2024-12-01' + (n * interval '25 minutes') as c from generate_series(1, 40000) n) s`);
    const timed = async (run: () => Promise<{ status: number }>) => {
      const start = Date.now();
      expect((await run()).status).toBe(200);
      return Date.now() - start;
    };
    expect(await timed(() => t.as(MEMBER).get("/api/performance"))).toBeLessThan(2000);
    expect(await timed(() => t.as(MEMBER).get(`/api/performance/vendors/${ids["Tarnwick Software"]}`))).toBeLessThan(2000);
    expect(await timed(() => t.as(MEMBER).get(`/api/performance/vendors/${ids["Tarnwick Software"]}/tickets`).query({ set: "resolved", month: "2026-10" }))).toBeLessThan(2000);
    await t.ports.database.db.execute(sql`delete from tickets where key like 'BULK-%'`);
  });
});
