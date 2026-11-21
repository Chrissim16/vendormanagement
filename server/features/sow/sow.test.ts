import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, MEMBER, testApp, TODAY } from "../../testing";

let t: Awaited<ReturnType<typeof testApp>>;
let me: string;
let vendorId: string;
beforeAll(async () => {
  t = await testApp();
  me = (await t.as(MEMBER).get("/api/me")).body.id;
  vendorId = (await t.as(MEMBER).post("/api/vendors").send({ name: "SOW Test Vendor", type: "consultancy", ownerUserId: me })).body.id;
});
afterAll(() => t.close());

const n = () => Math.random().toString(36).slice(2, 8);
const sow = async (o: Record<string, unknown> = {}) =>
  (
    await t
      .as(MEMBER)
      .post("/api/agreements")
      .send({
        vendorId,
        ownerUserId: me,
        kind: "sow",
        title: `SOW ${n()}`,
        pricing: "fixed",
        budgetMinor: 100_000_00,
        startDate: "2026-04-01",
        endDate: "2026-12-31",
        status: "active",
        signedOn: "2026-03-20",
        ...o,
      })
  ).body;
const history = async (id: string) =>
  (await t.as(MEMBER).get("/api/audit/history").query({ entityType: "agreement", entityId: id })).body.items as {
    userEmail: string;
    changes: Record<string, { from: unknown; to: unknown }>;
  }[];
const milestone = (id: string, o: Record<string, unknown>) =>
  t
    .as(MEMBER)
    .post(`/api/agreements/${id}/milestones`)
    .send({ title: `M ${n()}`, dueDate: "2026-09-30", ...o });

describe("M-1 milestones", () => {
  it("adds, edits, delivers and cancels milestones, and records each step in the SOW's history", async () => {
    const s = await sow();
    const added = await milestone(s.id, { title: "Design", amountMinor: 40_000_00, dueDate: "2026-06-30" });
    expect(added.status).toBe(201);
    const m = added.body.milestones[0];
    expect(m).toMatchObject({ title: "Design", status: "open", amountMinor: 40_000_00, late: true, daysLate: 144, invoicedMinor: 0 });
    const edited = (await t.as(MEMBER).patch(`/api/milestones/${m.id}`).send({ dueDate: "2026-12-01" })).body.milestones[0];
    expect(edited).toMatchObject({ title: "Design", amountMinor: 40_000_00, dueDate: "2026-12-01", late: false });
    const delivered = (await t.as(MEMBER).patch(`/api/milestones/${m.id}`).send({ status: "delivered" })).body.milestones[0];
    expect(delivered).toMatchObject({ status: "delivered", deliveredOn: TODAY, late: false });
    expect((await t.as(MEMBER).patch(`/api/milestones/${m.id}`).send({ status: "cancelled" })).body.milestones[0]).toMatchObject({ status: "cancelled", deliveredOn: null });
    const h = await history(s.id);
    expect(h.slice(0, 4).map((e) => e.changes)).toEqual([
      { "milestone Design status": { from: "delivered", to: "cancelled" }, "milestone Design deliveredOn": { from: TODAY, to: null } },
      { "milestone Design status": { from: "open", to: "delivered" }, "milestone Design deliveredOn": { from: null, to: TODAY } },
      { "milestone Design dueDate": { from: "2026-06-30", to: "2026-12-01" } },
      { "milestone Design": { from: null, to: "added" } },
    ]);
  });
  it("marks a milestone late when delivered after its due date or still open past it", async () => {
    const s = await sow();
    await milestone(s.id, { title: "Late delivery", status: "delivered", deliveredOn: "2026-10-19" });
    await milestone(s.id, { title: "On time", status: "delivered", deliveredOn: "2026-09-30" });
    await milestone(s.id, { title: "Overdue", dueDate: "2026-11-20" });
    const d = await milestone(s.id, { title: "Due today", dueDate: TODAY });
    expect(d.body.milestones.map((m: { title: string; late: boolean; daysLate: number }) => [m.title, m.late, m.daysLate])).toEqual([
      ["Late delivery", true, 19],
      ["On time", false, 0],
      ["Overdue", true, 1],
      ["Due today", false, 0],
    ]);
  });
  it("keeps fixed-price milestone amounts within the budget", async () => {
    const s = await sow();
    await milestone(s.id, { amountMinor: 60_000_00 });
    const cancelled = (await milestone(s.id, { amountMinor: 90_000_00, status: "cancelled" })).body.milestones;
    expect(cancelled).toHaveLength(2);
    const over = await milestone(s.id, { amountMinor: 40_000_01 });
    expect(over.status).toBe(400);
    expect(over.body.error.fields.amountMinor).toMatch(/more than the SOW budget/);
    expect((await milestone(s.id, { amountMinor: 40_000_00 })).status).toBe(201);
    const first = (await t.as(MEMBER).get(`/api/agreements/${s.id}/delivery`)).body.milestones.find((m: { amountMinor: number }) => m.amountMinor === 60_000_00);
    expect((await t.as(MEMBER).patch(`/api/milestones/${first.id}`).send({ amountMinor: 60_000_01 })).status).toBe(400);
    // The budget itself cannot be cut below what the milestones add up to.
    const cut = await t.as(MEMBER).patch(`/api/agreements/${s.id}`).send({ budgetMinor: 99_999_99 });
    expect(cut.body.error.fields.budgetMinor).toMatch(/milestones add up to more/);
    expect((await t.as(MEMBER).patch(`/api/agreements/${s.id}`).send({ pricing: "time_and_materials" })).body.error.fields.pricing).toMatch(/milestones with amounts/);
  });
  it("has no amounts on a time and materials SOW, and no milestones on anything but a SOW", async () => {
    const tm = await sow({ pricing: "time_and_materials" });
    expect((await milestone(tm.id, { amountMinor: 100 })).body.error.fields.amountMinor).toMatch(/fixed-price/);
    expect((await milestone(tm.id, {})).status).toBe(201);
    const nda = (await t.as(MEMBER).post("/api/agreements").send({ vendorId, ownerUserId: me, kind: "nda", title: "Not a SOW" })).body;
    expect((await milestone(nda.id, {})).status).toBe(409);
    expect((await t.as(MEMBER).get(`/api/agreements/${nda.id}/delivery`)).status).toBe(409);
    expect((await milestone("00000000-0000-4000-8000-000000000000", {})).status).toBe(404);
  });
  it("refuses a milestone without a title or due date, or delivered in the future", async () => {
    const s = await sow();
    expect(Object.keys((await t.as(MEMBER).post(`/api/agreements/${s.id}/milestones`).send({ title: " " })).body.error.fields).sort()).toEqual(["dueDate", "title"]);
    expect((await milestone(s.id, { status: "delivered", deliveredOn: "2026-11-22" })).body.error.fields.deliveredOn).toBeTruthy();
  });
});

describe("M-2 change requests", () => {
  const change = (id: string, o: Record<string, unknown>) =>
    t
      .as(MEMBER)
      .post(`/api/agreements/${id}/change-requests`)
      .send({ title: `Change ${n()}`, requestedOn: "2026-11-01", ...o });
  it("approving applies the budget change and new end date, and the SOW shows original and current values", async () => {
    const s = await sow({ budgetMinor: 210_000_00, endDate: "2026-11-30" });
    const proposed = (await change(s.id, { title: "Extra entity", budgetChangeMinor: 30_000_00, newEndDate: "2027-02-28" })).body;
    expect(proposed.changeRequests[0]).toMatchObject({ status: "proposed", decidedOn: null });
    expect(proposed.budget).toMatchObject({ budgetMinor: 210_000_00, originalMinor: 210_000_00 });
    const after = (await t.as(ADMIN).post(`/api/change-requests/${proposed.changeRequests[0].id}/approve`)).body;
    expect(after.budget).toMatchObject({ budgetMinor: 240_000_00, originalMinor: 210_000_00, remainingMinor: 240_000_00 });
    expect(after.endDateOriginal).toBe("2026-11-30");
    expect(after.changeRequests[0]).toMatchObject({ status: "approved", decidedOn: TODAY, decidedBy: ADMIN, budgetBeforeMinor: 210_000_00, endDateBefore: "2026-11-30" });
    expect((await t.as(MEMBER).get(`/api/agreements/${s.id}`)).body).toMatchObject({ budgetMinor: 240_000_00, endDate: "2027-02-28" });
    expect((await history(s.id))[0]).toMatchObject({
      userEmail: ADMIN,
      changes: {
        "change request Extra entity": { from: "proposed", to: "approved" },
        budgetMinor: { from: 210_000_00, to: 240_000_00 },
        endDate: { from: "2026-11-30", to: "2027-02-28" },
      },
    });

    // A second change stacks on the first; the original stays the original.
    const second = (await change(s.id, { title: "Trim", budgetChangeMinor: -5_000_00 })).body.changeRequests.find((c: { title: string }) => c.title === "Trim");
    const twice = (await t.as(MEMBER).post(`/api/change-requests/${second.id}/approve`)).body;
    expect(twice.budget).toMatchObject({ budgetMinor: 235_000_00, originalMinor: 210_000_00 });
    expect(twice.changeRequests.find((c: { title: string }) => c.title === "Trim")).toMatchObject({ budgetBeforeMinor: 240_000_00, endDateBefore: "2027-02-28" });
  });
  it("once a change is approved, the budget and end date only move through further change requests", async () => {
    const s = await sow();
    const c = (await change(s.id, { budgetChangeMinor: 20_000_00 })).body.changeRequests[0];
    // Before any approval the budget and end date can still be corrected directly.
    expect((await t.as(MEMBER).patch(`/api/agreements/${s.id}`).send({ budgetMinor: 101_000_00, endDate: "2027-01-31" })).status).toBe(200);
    await t.as(MEMBER).post(`/api/change-requests/${c.id}/approve`);
    const direct = await t.as(MEMBER).patch(`/api/agreements/${s.id}`).send({ budgetMinor: 150_000_00, endDate: "2027-06-30" });
    expect(direct.status).toBe(400);
    expect(direct.body.error.fields.budgetMinor).toMatch(/set by an approved change request/);
    expect(direct.body.error.fields.endDate).toMatch(/set by an approved change request/);
    // Everything else on the SOW can still be edited, and sending the same budget back is not a change.
    expect((await t.as(MEMBER).patch(`/api/agreements/${s.id}`).send({ title: "Renamed SOW", budgetMinor: 121_000_00, notes: "Still editable" })).body).toMatchObject({
      title: "Renamed SOW",
      budgetMinor: 121_000_00,
    });
    const d = (await t.as(MEMBER).get(`/api/agreements/${s.id}/delivery`)).body;
    expect(d.budget).toMatchObject({ originalMinor: 101_000_00, budgetMinor: 121_000_00 });
    expect(d.endDateOriginal).toBe("2027-01-31");
  });
  it("rejecting changes nothing on the SOW, and a decided change cannot be decided or edited again", async () => {
    const s = await sow();
    const c = (await change(s.id, { budgetChangeMinor: 5_000_00 })).body.changeRequests[0];
    const rejected = (await t.as(MEMBER).post(`/api/change-requests/${c.id}/reject`)).body;
    expect(rejected.changeRequests[0]).toMatchObject({ status: "rejected", budgetBeforeMinor: null });
    expect(rejected.budget.budgetMinor).toBe(100_000_00);
    expect((await t.as(MEMBER).post(`/api/change-requests/${c.id}/approve`)).status).toBe(409);
    expect((await t.as(MEMBER).patch(`/api/change-requests/${c.id}`).send({ title: "Too late" })).status).toBe(409);
  });
  it("can be edited while proposed, changing only what was sent", async () => {
    const s = await sow();
    const c = (await change(s.id, { title: "Draft", budgetChangeMinor: 1_000_00, newEndDate: "2027-01-31" })).body.changeRequests[0];
    const edited = (await t.as(MEMBER).patch(`/api/change-requests/${c.id}`).send({ budgetChangeMinor: 2_000_00 })).body.changeRequests[0];
    expect(edited).toMatchObject({ title: "Draft", budgetChangeMinor: 2_000_00, newEndDate: "2027-01-31", status: "proposed" });
  });
  it("needs a budget change or a new end date, and refuses an approval that would break the SOW", async () => {
    const s = await sow();
    expect((await change(s.id, {})).status).toBe(400);
    expect((await change(s.id, { requestedOn: "2026-11-22", budgetChangeMinor: 1 })).body.error.fields.requestedOn).toBeTruthy();
    await milestone(s.id, { amountMinor: 90_000_00 });
    const approve = async (o: Record<string, unknown>) => {
      const c = (await change(s.id, o)).body.changeRequests.at(-1);
      return t.as(MEMBER).post(`/api/change-requests/${c.id}/approve`);
    };
    const belowMilestones = await approve({ budgetChangeMinor: -20_000_00 });
    expect(belowMilestones.status).toBe(409);
    expect(belowMilestones.body.error.message).toMatch(/below what the milestones add up to/);
    expect((await approve({ newEndDate: "2026-03-31" })).body.error.message).toMatch(/before the SOW's start date/);
    expect((await t.as(MEMBER).get(`/api/agreements/${s.id}`)).body).toMatchObject({ budgetMinor: 100_000_00, endDate: "2026-12-31" });
  });
  it("applies a change once when two people approve it at the same moment", async () => {
    const s = await sow();
    const c = (await change(s.id, { budgetChangeMinor: 10_000_00 })).body.changeRequests[0];
    const both = await Promise.all([t.as(MEMBER).post(`/api/change-requests/${c.id}/approve`), t.as(ADMIN).post(`/api/change-requests/${c.id}/approve`)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await t.as(MEMBER).get(`/api/agreements/${s.id}`)).body.budgetMinor).toBe(110_000_00);
  });
});

describe("M-3 consultants and rate cards", () => {
  const rate = (o: Record<string, unknown>, vendor = vendorId) =>
    t
      .as(MEMBER)
      .post(`/api/vendors/${vendor}/rate-card`)
      .send({ validFrom: "2026-01-01", ...o });
  it("keeps a rate card per vendor and shows which rate is in force today", async () => {
    await rate({ role: "Lead architect", dayRateMinor: 1_250_00 });
    await rate({ role: "lead architect", dayRateMinor: 1_350_00, validFrom: "2026-07-01" });
    const card = (await rate({ role: "Lead Architect", dayRateMinor: 1_400_00, validFrom: "2027-01-01" })).body as {
      role: string;
      dayRateMinor: number;
      current: boolean;
      validFrom: string;
    }[];
    expect(card.map((l) => [l.role, l.validFrom, l.dayRateMinor, l.current])).toEqual([
      ["Lead architect", "2027-01-01", 1_400_00, false],
      ["Lead architect", "2026-07-01", 1_350_00, true],
      ["Lead architect", "2026-01-01", 1_250_00, false],
    ]);
    const dup = await rate({ role: "LEAD ARCHITECT", dayRateMinor: 1, validFrom: "2026-07-01" });
    expect(dup.body.error.fields.validFrom).toMatch(/already has a rate starting/);
    expect(Object.keys((await rate({ role: "", dayRateMinor: 0 })).body.error.fields).sort()).toEqual(["dayRateMinor", "role"]);
    const h = (await t.as(MEMBER).get("/api/audit/history").query({ entityType: "vendor", entityId: vendorId })).body.items;
    expect(h[0].changes).toEqual({ "rate for Lead architect from 2027-01-01": { from: null, to: "€ 1,400.00 a day" } });
  });
  it("names consultants on a SOW with a role from the card, and shows each one's current day rate", async () => {
    await rate({ role: "Tester", dayRateMinor: 700_00, validFrom: "2027-06-01" });
    const s = await sow();
    const added = await t.as(MEMBER).post(`/api/agreements/${s.id}/consultants`).send({ name: "Alex Example", role: "lead architect", fromDate: "2026-04-01" });
    expect(added.status).toBe(201);
    expect(added.body.consultants[0]).toMatchObject({ name: "Alex Example", role: "Lead architect", dayRateMinor: 1_350_00, currency: "EUR" });
    expect(added.body.roles).toEqual(["Lead architect", "Tester"]);
    // A role whose first rate starts in the future has no rate yet.
    expect(
      (await t.as(MEMBER).post(`/api/agreements/${s.id}/consultants`).send({ name: "Robin Sample", role: "Tester" })).body.consultants.find(
        (c: { name: string }) => c.name === "Robin Sample",
      ),
    ).toMatchObject({ dayRateMinor: null });
    const unknown = await t.as(MEMBER).post(`/api/agreements/${s.id}/consultants`).send({ name: "Sam Placeholder", role: "Wizard" });
    expect(unknown.body.error.fields.role).toMatch(/rate card/);
    const id = added.body.consultants[0].id;
    expect((await t.as(MEMBER).patch(`/api/consultants/${id}`).send({ toDate: "2026-12-31" })).body.consultants[0]).toMatchObject({
      name: "Alex Example",
      fromDate: "2026-04-01",
      toDate: "2026-12-31",
    });
    expect((await t.as(MEMBER).patch(`/api/consultants/${id}`).send({ toDate: "2026-03-01" })).status).toBe(400);
    expect((await t.as(MEMBER).delete(`/api/consultants/${id}`)).body.consultants.map((c: { name: string }) => c.name)).toEqual(["Robin Sample"]);
    expect((await history(s.id))[0]!.changes).toEqual({ "consultant Alex Example": { from: "listed", to: "removed" } });
  });
  it("will not remove the only rate of a role a consultant still holds", async () => {
    const other = (await t.as(MEMBER).post("/api/vendors").send({ name: "Rate Vendor", type: "consultancy", ownerUserId: me })).body.id;
    const [first] = (await rate({ role: "Analyst", dayRateMinor: 800_00 }, other)).body;
    const card = (await rate({ role: "Analyst", dayRateMinor: 850_00, validFrom: "2026-06-01" }, other)).body;
    const s = (
      await t
        .as(MEMBER)
        .post("/api/agreements")
        .send({ vendorId: other, ownerUserId: me, kind: "sow", title: "Rate SOW", pricing: "time_and_materials", budgetMinor: 1, startDate: "2026-04-01", endDate: "2026-12-31" })
    ).body;
    await t.as(MEMBER).post(`/api/agreements/${s.id}/consultants`).send({ name: "Jo Specimen", role: "Analyst" });
    expect((await t.as(MEMBER).delete(`/api/rate-card/${first.id}`)).body).toHaveLength(1);
    const h = (await t.as(MEMBER).get("/api/audit/history").query({ entityType: "vendor", entityId: other })).body.items;
    expect(h[0].changes).toEqual({ "rate for Analyst from 2026-01-01": { from: "€ 800.00 a day", to: "removed" } });
    const last = await t.as(MEMBER).delete(`/api/rate-card/${card.find((l: { validFrom: string }) => l.validFrom === "2026-06-01").id}`);
    expect(last.status).toBe(409);
    expect(last.body.error.message).toMatch(/only rate for Analyst, and Jo Specimen still has that role/);
  });
});
