import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, binary, MEMBER, testApp, TODAY } from "../../testing";

let t: Awaited<ReturnType<typeof testApp>>;
let me: string;
let vendorId: string;
beforeAll(async () => {
  t = await testApp();
  me = (await t.as(MEMBER).get("/api/me")).body.id;
  vendorId = (await t.as(MEMBER).post("/api/vendors").send({ name: "Invoice Test Vendor", type: "software", ownerUserId: me, ndaRequired: false, dpaRequired: false })).body.id;
});
afterAll(() => t.close());

const n = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const agreement = async (o: Record<string, unknown>, vendor = vendorId) =>
  (
    await t
      .as(MEMBER)
      .post("/api/agreements")
      .send({ vendorId: vendor, ownerUserId: me, title: `A ${n()}`, status: "active", signedOn: "2026-01-01", ...o })
  ).body;
const sow = (o: Record<string, unknown> = {}) => agreement({ kind: "sow", pricing: "fixed", budgetMinor: 100_000_00, startDate: "2026-01-01", endDate: "2027-06-30", ...o });
const invoice = (agreementId: string, o: Record<string, unknown> = {}) =>
  t
    .as(MEMBER)
    .post("/api/invoices")
    .send({ agreementId, invoiceNumber: `INV-${n()}`, invoiceDate: "2026-11-01", amountMinor: 10_000_00, ...o });

describe("M-4 invoices", () => {
  it("books an invoice against a SOW or a subscription, optionally against a milestone", async () => {
    const s = await sow();
    const m = (await t.as(MEMBER).post(`/api/agreements/${s.id}/milestones`).send({ title: "Phase one", dueDate: "2026-06-30", amountMinor: 40_000_00 })).body.milestones[0];
    const res = await invoice(s.id, { milestoneId: m.id, invoiceNumber: "  INV  001 ", amountMinor: 40_000_00, description: "Phase one" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      invoiceNumber: "INV 001",
      vendorName: "Invoice Test Vendor",
      agreementTitle: s.title,
      milestoneTitle: "Phase one",
      currency: "EUR",
      amountMinor: 40_000_00,
      createdBy: MEMBER,
    });
    expect((await t.as(MEMBER).get(`/api/agreements/${s.id}/delivery`)).body.milestones[0].invoicedMinor).toBe(40_000_00);
    const sub = await agreement({ kind: "subscription", annualValueMinor: 12_000_00, startDate: "2026-01-01", endDate: "2027-12-31", currency: "GBP", autoRenews: true });
    expect((await invoice(sub.id)).body.currency).toBe("GBP");
    expect((await t.as(MEMBER).get(`/api/agreements/${sub.id}`)).body.invoicedMinor).toBe(10_000_00);
    const log = (await t.as(ADMIN).get("/api/admin/audit").query({ entityType: "invoice" })).body.items;
    expect(log.find((e: { summary: string }) => e.summary === "Invoice Test Vendor · INV 001")).toMatchObject({
      action: "create",
      userEmail: MEMBER,
      changes: { amountMinor: { from: null, to: 40_000_00 } },
    });
  });
  it("refuses a repeated invoice number for the same vendor, ignoring case and spacing, but allows it for another vendor", async () => {
    const s = await sow();
    const other = await sow();
    expect((await invoice(s.id, { invoiceNumber: "DUP-77" })).status).toBe(201);
    for (const number of ["dup-77", "  DUP-77  "]) {
      const res = await invoice(other.id, { invoiceNumber: number });
      expect(res.status).toBe(400);
      expect(res.body.error.fields.invoiceNumber).toMatch(/already has an invoice with this number/);
    }
    const elsewhere = (await t.as(MEMBER).post("/api/vendors").send({ name: "Other Invoice Vendor", type: "software", ownerUserId: me })).body.id;
    const foreign = await agreement({ kind: "sow", pricing: "fixed", budgetMinor: 1_000_00, startDate: "2026-01-01", endDate: "2027-06-30" }, elsewhere);
    expect((await invoice(foreign.id, { invoiceNumber: "DUP-77" })).status).toBe(201);
    const two = await Promise.all([invoice(s.id, { invoiceNumber: "RACE-1" }), invoice(other.id, { invoiceNumber: "race-1" })]);
    expect(two.map((r) => r.status).sort()).toEqual([201, 400]);
  });
  it("takes its currency from the agreement, whatever is sent", async () => {
    const gbp = await sow({ currency: "GBP" });
    const res = await invoice(gbp.id, { currency: "EUR" });
    expect(res.body.currency).toBe("GBP");
    // Once invoiced, the agreement's currency is fixed.
    expect((await t.as(MEMBER).patch(`/api/agreements/${gbp.id}`).send({ currency: "EUR" })).body.error.fields.currency).toMatch(/already has invoices in GBP/);
  });
  it("moves an invoice to another agreement only within the same currency, re-checking everything for the new place", async () => {
    const eur = await sow();
    const other = await sow();
    const gbp = await sow({ currency: "GBP" });
    const nda = await agreement({ kind: "nda" });
    const inv = (await invoice(eur.id, { invoiceNumber: "MOVE-1", amountMinor: 1_000_00 })).body;
    const to = (agreementId: string) => t.as(MEMBER).patch(`/api/invoices/${inv.id}`).send({ agreementId });
    const blocked = await to(gbp.id);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.fields.agreementId).toMatch(/is in EUR. It cannot move to an agreement in GBP/);
    expect((await to(nda.id)).body.error.fields.agreementId).toMatch(/SOW or a subscription/);
    expect((await to(other.id)).body).toMatchObject({ agreementId: other.id, currency: "EUR", amountMinor: 1_000_00 });
    expect((await t.as(MEMBER).get(`/api/agreements/${eur.id}/delivery`)).body.budget.invoicedMinor).toBe(0);
    expect((await t.as(MEMBER).get("/api/invoices").query({ agreementId: other.id })).body.items[0]).toMatchObject({ invoiceNumber: "MOVE-1", agreementKind: "sow" });
  });
  it("refuses an invoice for an MSA or NDA, a milestone of another SOW, a future date, and a zero or fractional amount", async () => {
    const s = await sow();
    const other = await sow();
    const foreign = (await t.as(MEMBER).post(`/api/agreements/${other.id}/milestones`).send({ title: "Theirs", dueDate: "2026-06-30" })).body.milestones[0];
    const nda = await agreement({ kind: "nda" });
    expect((await invoice(nda.id)).body.error.fields.agreementId).toMatch(/SOW or a subscription/);
    expect((await invoice("00000000-0000-4000-8000-000000000000")).body.error.fields.agreementId).toBeTruthy();
    expect((await invoice(s.id, { milestoneId: foreign.id })).body.error.fields.milestoneId).toMatch(/milestone of this SOW/);
    expect((await invoice(s.id, { invoiceDate: "2026-11-22" })).body.error.fields.invoiceDate).toMatch(/future/);
    for (const amountMinor of [0, -100, 10.5]) expect((await invoice(s.id, { amountMinor })).status, String(amountMinor)).toBe(400);
    expect((await t.as(MEMBER).get("/api/invoices").query({ agreementId: s.id })).body.total).toBe(0);
  });
  it("edits only what was sent, and removes an invoice, recording both", async () => {
    const s = await sow();
    const created = (await invoice(s.id, { invoiceNumber: "EDIT-1", description: "First" })).body;
    const edited = (await t.as(ADMIN).patch(`/api/invoices/${created.id}`).send({ amountMinor: 12_345_67 })).body;
    expect(edited).toMatchObject({ invoiceNumber: "EDIT-1", description: "First", amountMinor: 12_345_67, invoiceDate: "2026-11-01" });
    expect((await t.as(MEMBER).delete(`/api/invoices/${created.id}`)).status).toBe(200);
    expect((await t.as(MEMBER).patch(`/api/invoices/${created.id}`).send({ amountMinor: 1 })).status).toBe(404);
    const log = (await t.as(ADMIN).get("/api/admin/audit").query({ entityType: "invoice" })).body.items.filter((e: { entityId: string }) => e.entityId === created.id);
    expect(log.map((e: { action: string; userEmail: string }) => [e.action, e.userEmail])).toEqual([
      ["delete", MEMBER],
      ["update", ADMIN],
      ["create", MEMBER],
    ]);
    expect(log[1].changes).toEqual({ amountMinor: { from: 10_000_00, to: 12_345_67 } });
    // The number is free again once the invoice is removed.
    expect((await invoice(s.id, { invoiceNumber: "EDIT-1" })).status).toBe(201);
  });
  it("lists invoices by vendor, agreement, period and search, with a total per currency", async () => {
    const s = await sow();
    await invoice(s.id, { invoiceNumber: "LIST-A", invoiceDate: "2026-03-10", amountMinor: 1_000_00 });
    await invoice(s.id, { invoiceNumber: "LIST-B", invoiceDate: "2026-06-10", amountMinor: 2_000_00 });
    await invoice(s.id, { invoiceNumber: "LIST-C", invoiceDate: "2026-09-10", amountMinor: 4_000_00, description: "Findable words" });
    const list = async (q: Record<string, string>) =>
      (
        await t
          .as(MEMBER)
          .get("/api/invoices")
          .query({ agreementId: s.id, ...q })
      ).body;
    expect((await list({})).items.map((i: { invoiceNumber: string }) => i.invoiceNumber)).toEqual(["LIST-C", "LIST-B", "LIST-A"]);
    expect((await list({})).sums).toEqual({ EUR: 7_000_00, GBP: 0 });
    expect((await list({ from: "2026-06-10", to: "2026-09-09" })).items.map((i: { invoiceNumber: string }) => i.invoiceNumber)).toEqual(["LIST-B"]);
    expect((await list({ q: "findable" })).total).toBe(1);
    expect((await list({ sort: "amount", dir: "asc" })).items[0].invoiceNumber).toBe("LIST-A");
    expect((await t.as(MEMBER).get("/api/invoices").query({ from: "2026-02-31" })).status).toBe(400);
    const csv = ((await t.as(MEMBER).get("/api/invoices/export.csv").query({ agreementId: s.id }).buffer(true).parse(binary)).body as Buffer).toString("utf8");
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe('"Vendor","Agreement","Milestone","Invoice number","Invoice date","Amount","Currency","Description"');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(`"Invoice Test Vendor","${s.title}","","LIST-C","2026-09-10","4000.00","EUR","Findable words"`);
  });
});

describe("M-5 budget view", () => {
  it("shows budget, invoiced, remaining and percentage used, and warns from 80%", async () => {
    const other = await testApp();
    const who = (await other.as(MEMBER).get("/api/me")).body.id;
    const v = (await other.as(MEMBER).post("/api/vendors").send({ name: "Budget Vendor", type: "software", ownerUserId: who, ndaRequired: false, dpaRequired: false })).body.id;
    const s = (
      await other.as(MEMBER).post("/api/agreements").send({
        vendorId: v,
        ownerUserId: who,
        kind: "sow",
        title: "Budget SOW",
        pricing: "time_and_materials",
        budgetMinor: 100_000_00,
        startDate: "2026-01-01",
        endDate: "2027-06-30",
        status: "active",
        signedOn: "2026-01-01",
      })
    ).body;
    const book = (amountMinor: number) =>
      other
        .as(MEMBER)
        .post("/api/invoices")
        .send({ agreementId: s.id, invoiceNumber: `B-${n()}`, invoiceDate: TODAY, amountMinor });
    const budget = async () => (await other.as(MEMBER).get(`/api/agreements/${s.id}/delivery`)).body.budget;
    const mine = async () =>
      (await other.as(MEMBER).get("/api/warnings")).body
        .filter((w: { agreementId: string }) => w.agreementId === s.id)
        .map((w: { type: string; label: string }) => [w.type, w.label]);
    await book(79_999_99);
    expect(await budget()).toMatchObject({ budgetMinor: 100_000_00, invoicedMinor: 79_999_99, remainingMinor: 20_000_01, usedPct: 79, state: "ok", currency: "EUR" });
    expect(await mine()).toEqual([]);
    await book(1);
    expect(await budget()).toMatchObject({ usedPct: 80, state: "warn" });
    expect(await mine()).toEqual([["budget_warning", "80% of budget used"]]);
    await book(20_000_00);
    expect(await budget()).toMatchObject({ usedPct: 100, state: "warn", remainingMinor: 0 });
    await book(1);
    expect(await budget()).toMatchObject({ state: "over", remainingMinor: -1 });
    expect(await mine()).toEqual([["budget_overrun", "Over budget"]]);
    expect((await other.as(MEMBER).get("/api/vendors").query({ q: "Budget Vendor" })).body.items[0].warnings).toBe(1);
    // An ended SOW no longer warns.
    await other.as(MEMBER).patch(`/api/agreements/${s.id}`).send({ status: "ended", endReason: "completed" });
    expect(await mine()).toEqual([]);
    await other.close();
  });
});

describe("M-6 spend overview and M-7 exchange rate", () => {
  it("shows spend per vendor and per month, per currency, with a converted euro total that follows the rate", async () => {
    const other = await testApp({}, { empty: true });
    const who = (await other.as(ADMIN).get("/api/me")).body.id;
    const vendor = async (name: string) => (await other.as(ADMIN).post("/api/vendors").send({ name, type: "software", ownerUserId: who })).body.id;
    const sowOf = async (vendorId: string, currency: string) =>
      (
        await other
          .as(ADMIN)
          .post("/api/agreements")
          .send({
            vendorId,
            ownerUserId: who,
            kind: "sow",
            title: `SOW ${n()}`,
            pricing: "time_and_materials",
            budgetMinor: 1_000_000_00,
            startDate: "2025-01-01",
            endDate: "2027-12-31",
            currency,
          })
      ).body.id;
    const a = await sowOf(await vendor("Spend A"), "EUR");
    const b = await sowOf(await vendor("Spend B"), "GBP");
    const book = (agreementId: string, invoiceDate: string, amountMinor: number) =>
      other
        .as(ADMIN)
        .post("/api/invoices")
        .send({ agreementId, invoiceNumber: `S-${n()}`, invoiceDate, amountMinor });
    await book(a, "2026-01-15", 100_00);
    await book(a, "2026-02-01", 50_00);
    await book(b, "2026-02-28", 200_00);
    await book(a, "2025-11-30", 999_00);
    const spend = async (q: Record<string, string> = {}) => (await other.as(ADMIN).get("/api/spend").query(q)).body;

    const first = await spend({ from: "2026-01-01", to: "2026-03-31" });
    expect(first.total).toEqual({ EUR: 150_00, GBP: 200_00, eurMinor: 384_00 });
    expect(first.byVendor.map((v: { vendorName: string; eurMinor: number }) => [v.vendorName, v.eurMinor])).toEqual([
      ["Spend B", 234_00],
      ["Spend A", 150_00],
    ]);
    expect(first.byMonth.map((m: { month: string; EUR: number; GBP: number }) => [m.month, m.EUR, m.GBP])).toEqual([
      ["2026-01", 100_00, 0],
      ["2026-02", 50_00, 200_00],
      ["2026-03", 0, 0],
    ]);
    expect(first.gbpToEurE4).toBe(11700);

    // Without dates it covers the last twelve months up to today, from the first of the month.
    const dflt = await spend();
    expect([dflt.from, dflt.to]).toEqual(["2025-12-01", TODAY]);
    expect(dflt.byMonth).toHaveLength(12);
    expect(dflt.total.EUR).toBe(150_00);

    // M-7: only an admin sets the rate, and it changes converted totals only.
    expect((await other.as(MEMBER).put("/api/admin/settings").send({ gbpToEurE4: 12000, noticeDays: 90, sowEndDays: 30, budgetWarningPct: 80 })).status).toBe(403);
    expect((await other.as(ADMIN).put("/api/admin/settings").send({ gbpToEurE4: 12000, noticeDays: 90, sowEndDays: 30, budgetWarningPct: 80 })).status).toBe(200);
    const second = await spend({ from: "2026-01-01", to: "2026-03-31" });
    expect(second.total).toEqual({ EUR: 150_00, GBP: 200_00, eurMinor: 390_00 });
    expect((await other.as(ADMIN).get("/api/invoices")).body.sums).toEqual({ EUR: 1_149_00, GBP: 200_00 });
    expect((await other.as(MEMBER).get("/api/settings")).body.gbpToEurE4).toBe(12000);
    const log = (await other.as(ADMIN).get("/api/admin/audit").query({ entityType: "settings" })).body.items;
    expect(log[0]).toMatchObject({ userEmail: ADMIN, changes: { gbpToEurE4: { from: 11700, to: 12000 } } });
    expect((await spend({ from: "2026-03-01", to: "2026-02-01" })).error.fields.to).toBeTruthy();
    await other.close();
  });
  it("exports the spend overview as a file, one row per vendor, month and currency", async () => {
    const other = await testApp({}, { empty: true });
    const who = (await other.as(ADMIN).get("/api/me")).body.id;
    const v = (await other.as(ADMIN).post("/api/vendors").send({ name: '=Export, "Vendor"', type: "software", ownerUserId: who })).body.id;
    const s2 = (
      await other.as(ADMIN).post("/api/agreements").send({
        vendorId: v,
        ownerUserId: who,
        kind: "sow",
        title: "S",
        pricing: "time_and_materials",
        budgetMinor: 1,
        startDate: "2025-01-01",
        endDate: "2027-12-31",
        currency: "GBP",
      })
    ).body.id;
    for (const [d, a] of [
      ["2026-01-05", 100_00],
      ["2026-01-20", 50_50],
      ["2026-03-01", 7],
    ] as const)
      await other
        .as(ADMIN)
        .post("/api/invoices")
        .send({ agreementId: s2, invoiceNumber: `X-${d}`, invoiceDate: d, amountMinor: a });
    const res = await other.as(MEMBER).get("/api/spend/export.csv").query({ from: "2026-01-01", to: "2026-03-31" }).buffer(true).parse(binary);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="spend-2026-01-01-to-2026-03-31.csv"');
    const lines = (res.body as Buffer).toString("utf8").slice(1).trimEnd().split("\r\n");
    expect(lines).toEqual(['"Vendor","Month","Currency","Invoiced"', '"\'=Export, ""Vendor""","2026-01","GBP","150.50"', '"\'=Export, ""Vendor""","2026-03","GBP","0.07"']);
    await other.close();
  });
  it("lists renewals within the admin's own notice window unless another is asked for", async () => {
    const other = await testApp();
    const titles = async (q: Record<string, string> = {}) => (await other.as(MEMBER).get("/api/renewals").query(q)).body.map((x: { title: string }) => x.title);
    expect(await titles()).toEqual(["Reporting suite", "Service desk licence"]);
    await other.as(ADMIN).put("/api/admin/settings").send({ gbpToEurE4: 11700, noticeDays: 20, sowEndDays: 30, budgetWarningPct: 80 });
    expect(await titles()).toEqual(["Reporting suite"]);
    expect(await titles({ window: "45" })).toEqual(["Reporting suite", "Service desk licence"]);
    expect((await other.as(MEMBER).get("/api/renewals").query({ window: "0" })).status).toBe(400);
    await other.close();
  });
  it("uses the admin's warning windows and refuses nonsense settings", async () => {
    const other = await testApp();
    const count = async (type: string) => (await other.as(MEMBER).get("/api/warnings")).body.filter((w: { type: string }) => w.type === type).length;
    expect(await count("sow_ending")).toBe(1);
    expect(await count("budget_warning")).toBe(1);
    const save = (o: Record<string, unknown>) =>
      other
        .as(ADMIN)
        .put("/api/admin/settings")
        .send({ gbpToEurE4: 11700, noticeDays: 90, sowEndDays: 30, budgetWarningPct: 80, ...o });
    await save({ sowEndDays: 10, budgetWarningPct: 90, noticeDays: 20 });
    expect(await count("sow_ending")).toBe(0);
    expect(await count("budget_warning")).toBe(0);
    expect(await count("renewal_due")).toBe(0);
    await save({ sowEndDays: 365 });
    expect(await count("sow_ending")).toBeGreaterThan(1);
    for (const bad of [{ gbpToEurE4: 0 }, { noticeDays: 0 }, { sowEndDays: 400 }, { budgetWarningPct: 101 }, { budgetWarningPct: 79.5 }])
      expect((await save(bad)).status, JSON.stringify(bad)).toBe(400);
    await other.close();
  });
  it("sorts agreements by value in euros, so pounds and euros compare fairly", async () => {
    const a = await sow({ title: "Value EUR 110", budgetMinor: 110_00 });
    const b = await sow({ title: "Value GBP 100", budgetMinor: 100_00, currency: "GBP" });
    const titles = (await t.as(MEMBER).get("/api/agreements").query({ vendorId, sort: "value", dir: "desc", q: "Value " })).body.items.map((x: { title: string }) => x.title);
    expect(titles).toEqual([b.title, a.title]);
  });
});
