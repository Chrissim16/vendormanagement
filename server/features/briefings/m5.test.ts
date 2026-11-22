import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays } from "../../../shared/dates";
import type { Briefing, BriefingHeader, Dashboard, ManagementReport } from "../../../shared/overview";
import { pointsOf } from "../../../shared/overview";
import type { Spend } from "../../../shared/sow";
import type { Warning } from "../../../shared/vendors";
import { ADMIN, binary, MEMBER, testApp, TODAY } from "../../testing";

/** R-1, D-1, D-2 and B-1 through the API, on the sample data with today pinned to 21 Nov 2026. */

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

const n = () => Math.random().toString(36).slice(2, 8);
const textOf = async (data: Buffer) => {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(data));
  return { pages: doc.numPages, text: (await extractText(doc, { mergePages: true })).text.replace(/\s+/g, " ") };
};
const pdf = async (path: string, query: Record<string, string> = {}) => {
  const res = await t.as(MEMBER).get(path).query(query).buffer(true).parse(binary);
  expect(res.status).toBe(200);
  expect(res.headers["content-type"]).toBe("application/pdf");
  return textOf(res.body as Buffer);
};
const warnings = async () => (await t.as(MEMBER).get("/api/warnings")).body as Warning[];
const history = async (entityType: string, entityId: string) =>
  (
    (await t.as(MEMBER).get("/api/audit/history").query({ entityType, entityId })).body.items as {
      userEmail: string;
      action: string;
      changes: Record<string, { from: unknown; to: unknown }> | null;
    }[]
  ).map((e) => ({ ...e, changes: e.changes ?? {} }));
/** Reviews the suggestion a report or briefing currently shows, as the page does. */
const reviewReport = async (month: string, action: "accept" | "reject", as = MEMBER) => {
  const current = (await t.as(as).get("/api/report").query({ month })).body as ManagementReport;
  return t
    .as(as)
    .post("/api/report/suggestion/review")
    .query({ month })
    .send({ action, suggestionId: current.suggestion?.id ?? "00000000-0000-4000-8000-000000000000" });
};
const reviewBriefing = async (id: string, action: "accept" | "reject", as = MEMBER) => {
  const current = (await t.as(as).get(`/api/briefings/${id}`)).body as Briefing;
  return t
    .as(as)
    .post(`/api/briefings/${id}/suggestion/review`)
    .send({ action, suggestionId: current.suggestion?.id ?? "00000000-0000-4000-8000-000000000000" });
};
const ai = (mode: "working" | "unavailable" | "nonsense") => t.as(MEMBER).post("/api/dev/ai").send({ mode });
const newVendor = async (name: string) =>
  (
    await t
      .as(MEMBER)
      .post("/api/vendors")
      .send({ name: `${name} ${n()}`, type: "consultancy", ownerUserId: me, ndaRequired: false, dpaRequired: false })
  ).body.id as string;
const newSow = async (vendorId: string, fields: Record<string, unknown>) =>
  (
    await t
      .as(MEMBER)
      .post("/api/agreements")
      .send({ vendorId, ownerUserId: me, kind: "sow", title: `SOW ${n()}`, pricing: "time_and_materials", status: "active", signedOn: "2026-01-01", ...fields })
  ).body as { id: string; title: string };

describe("R-1 risk flags", () => {
  it("are listed with the warnings, each stating the facts that set it off", async () => {
    const flags = (await warnings()).filter((w) => w.type.startsWith("risk_"));
    expect(flags.map((w) => [w.type, w.label, w.title])).toEqual([
      ["risk_open_milestones", "1 open milestone", "Quillon Consulting · SOW 02 Close process review"],
      ["risk_budget_trend", "Heading over budget", "Quillon Consulting · SOW 04 Payment controls"],
      // A fixed-price SOW is judged the same way.
      ["risk_budget_trend", "Heading over budget", "Bluefinch Systems · SOW 07 Ledger migration"],
      ["risk_metric_worsening", "Getting worse", "Mossgate IT · SLA breaches"],
    ]);
    expect(flags[0]!.detail).toBe("It ends on 9 Dec 2026, in 18 days, and one milestone is still open: Recommendations (due 1 Dec 2026).");
    expect(flags[1]!.detail).toContain("€ 27,000.00 of the € 40,000.00 budget has been invoiced in 60 of 120 days.");
    expect(flags[1]!.detail).toContain("the budget runs out around 20 Dec 2026, before the end date of 20 Jan 2027");
    expect(flags[3]!.detail).toMatch(
      /^SLA breaches \(resolved later than agreed\) got worse three months in a row: [\d.]+% in Jul, [\d.]+% in Aug, [\d.]+% in Sep, [\d.]+% in Oct 2026\. The target is 5% or less\.$/,
    );
    expect(flags.every((w) => w.tone === "warn")).toBe(true);
    expect(flags[0]!.agreementId && flags[1]!.agreementId).toBeTruthy();
    expect(flags[3]).toMatchObject({ agreementId: null, vendorId: ids["Mossgate IT"] });
  });

  it("the figures in a worsening flag are the vendor's own monthly figures", async () => {
    const flag = (await warnings()).find((w) => w.type === "risk_metric_worsening")!;
    const months = (await t.as(MEMBER).get(`/api/performance/vendors/${ids["Mossgate IT"]}`).query({ month: "2026-10" })).body.months as {
      month: string;
      cells: { sla_breaches: { valueTenths: number } };
    }[];
    const last4 = months.filter((m) => m.month >= "2026-07" && m.month <= "2026-10").map((m) => m.cells.sla_breaches.valueTenths);
    expect(last4).toHaveLength(4);
    expect(last4.every((v, i) => i === 0 || v > last4[i - 1]!)).toBe(true);
    for (const v of last4) expect(flag.detail).toContain(`${v / 10}%`);
  });

  it("a SOW invoiced faster than its budget allows is flagged, and no longer once its pace fits", async () => {
    const vendor = await newVendor("Pace Vendor");
    const sow = await newSow(vendor, { budgetMinor: 100_000_00, startDate: addDays(TODAY, -100), endDate: addDays(TODAY, 100) });
    const mine = async () => (await warnings()).filter((w) => w.agreementId === sow.id).map((w) => w.type);
    const invoice = async (amountMinor: number) =>
      (
        await t
          .as(MEMBER)
          .post("/api/invoices")
          .send({ agreementId: sow.id, invoiceNumber: `P-${n()}`, invoiceDate: addDays(TODAY, -10), amountMinor })
      ).body.id as string;
    await invoice(50_000_00);
    // Exactly on course: half the budget in half the time.
    expect(await mine()).toEqual([]);
    const extra = await invoice(10_000_00);
    expect(await mine()).toEqual(["risk_budget_trend"]);
    await t.as(MEMBER).delete(`/api/invoices/${extra}`).expect(200);
    expect(await mine()).toEqual([]);
  });

  it("a SOW about to end with an open milestone is flagged until the milestone is delivered, and follows the admin's window", async () => {
    const vendor = await newVendor("Ending Vendor");
    const sow = await newSow(vendor, { budgetMinor: 10_000_00, startDate: addDays(TODAY, -40), endDate: addDays(TODAY, 40) });
    const delivery = (
      await t
        .as(MEMBER)
        .post(`/api/agreements/${sow.id}/milestones`)
        .send({ title: "Final report", dueDate: addDays(TODAY, 30) })
        .expect(201)
    ).body;
    const milestone = delivery.milestones[0].id as string;
    const mine = async () => (await warnings()).filter((w) => w.agreementId === sow.id && w.type === "risk_open_milestones");
    expect(await mine()).toEqual([]);
    const settings = (await t.as(ADMIN).get("/api/settings")).body;
    await t
      .as(ADMIN)
      .put("/api/admin/settings")
      .send({ ...settings, sowEndDays: 45 })
      .expect(200);
    const [flag] = await mine();
    expect(flag!.detail).toContain("in 40 days, and one milestone is still open: Final report");
    await t
      .as(MEMBER)
      .patch(`/api/milestones/${milestone}`)
      .send({ title: "Final report", dueDate: addDays(TODAY, 30), status: "delivered" })
      .expect(200);
    expect(await mine()).toEqual([]);
    await t.as(ADMIN).put("/api/admin/settings").send(settings).expect(200);
  });
});

describe("D-1 dashboard", () => {
  let d: Dashboard;
  beforeAll(async () => {
    d = (await t.as(MEMBER).get("/api/dashboard").expect(200)).body;
  });

  it("lists active SOWs by budget used, the most used first, with the figures of the SOW's own page", async () => {
    const sample = d.sows.filter((s) => ["Bluefinch Systems", "Quillon Consulting"].includes(s.vendorName));
    expect(sample.map((s) => [s.title, s.budget.usedPct, s.budget.state])).toEqual([
      ["SOW 07 Ledger migration", 83, "warn"],
      ["SOW 04 Payment controls", 67, "ok"],
      ["SOW 02 Close process review", 65, "ok"],
      ["SOW 09 Helpdesk run", 41, "ok"],
    ]);
    const used = d.sows.map((s) => s.budget.invoicedMinor / s.budget.budgetMinor!);
    expect(used).toEqual([...used].sort((a, b) => b - a));
    for (const s of sample) {
      const page = (await t.as(MEMBER).get(`/api/agreements/${s.agreementId}/delivery`)).body.budget;
      expect(s.budget).toMatchObject({ budgetMinor: page.budgetMinor, invoicedMinor: page.invoicedMinor, usedPct: page.usedPct, state: page.state });
    }
    // A SOW that is not active is not on the dashboard.
    expect(d.sows.some((s) => /Treasury roadmap|Discovery/.test(s.title))).toBe(false);
  });

  it("shows the spend of the last twelve months, the same as the Money page", async () => {
    const money = (await t.as(MEMBER).get("/api/spend")).body as Spend;
    expect(d.spend.byMonth).toHaveLength(12);
    expect(d.spend.byMonth.at(-1)!.month).toBe("2026-11");
    expect(d.spend.total).toEqual(money.total);
    expect(d.spend.byMonth).toEqual(money.byMonth);
  });

  it("shows each scored vendor's latest final score with its trend, and the scorecards still due for last quarter", async () => {
    expect(d.dueQuarter).toBe("2026-Q3");
    const cards = (await t.as(MEMBER).get("/api/scorecards").query({ pageSize: "200" })).body.items as {
      id: string;
      vendorName: string;
      quarter: string;
      status: string;
      overallTenths: number;
    }[];
    const finals = cards.filter((c) => c.status === "final");
    expect(d.scores.map((s) => [s.vendorName, s.quarter, s.overallTenths, s.trend]).sort()).toEqual(finals.map((c) => [c.vendorName, c.quarter, c.overallTenths, "first"]).sort());
    expect(d.scores.every((s) => finals.some((c) => c.id === s.scorecardId))).toBe(true);
    // Due: every scored vendor in use without a final scorecard for the quarter; a draft is linked.
    const draft = cards.find((c) => c.status === "draft" && c.quarter === "2026-Q3")!;
    expect(d.due.find((x) => x.vendorName === draft.vendorName)).toMatchObject({ scorecardId: draft.id });
    expect(d.due.some((x) => finals.some((c) => c.vendorName === x.vendorName && c.quarter === "2026-Q3"))).toBe(false);
    expect(d.due.some((x) => x.vendorName === "Emberline Advisory")).toBe(false); // not scored
    expect(d.due.some((x) => x.vendorName === "Harrowick Partners")).toBe(false); // a prospect
    expect(d.due.find((x) => x.vendorName === "Sedgewater Cloud")).toMatchObject({ scorecardId: null });
  });

  it("lists the RFPs still running with their stage, the nearest decision first, and leaves out the decided one", () => {
    expect(d.rfps.map((r) => [r.title, r.stage])).toEqual([
      ["Expense management tool", "Evaluating"],
      ["Travel booking tool", "In review"],
      ["Service desk tooling", "Drafting"],
    ]);
  });
});

describe("D-2 monthly management report", () => {
  const report = async (month?: string) =>
    (
      await t
        .as(MEMBER)
        .get("/api/report")
        .query(month ? { month } : {})
    ).body as ManagementReport;

  it("opens on the last month that is over, with every section worked out as at its last day", async () => {
    const r = await report();
    expect(r.data).toMatchObject({ month: "2026-10", asAt: "2026-10-31", running: false });
    expect(r.data.rfps.map((x) => [x.title, x.stage])).toEqual([
      ["Expense management tool", "Evaluating"],
      ["Travel booking tool", "In review"],
      ["Service desk tooling", "Drafting"],
    ]);
    expect(r.summary).toBeNull();
    expect(r.suggestion).toBeNull();
    // Spend in the month equals the Money page for the same dates.
    const money = (await t.as(MEMBER).get("/api/spend").query({ from: "2026-10-01", to: "2026-10-31" })).body as Spend;
    expect(r.data.spend.total).toEqual(money.total);
    expect(r.data.spend.total.eurMinor).toBeGreaterThan(0);
    // Budgets: invoiced up to the last day of the month only.
    const ledger = r.data.sows.find((s) => s.title === "SOW 07 Ledger migration")!;
    expect(ledger.budget).toMatchObject({ budgetMinor: 240_000_00, invoicedMinor: 175_000_00, usedPct: 72 });
    // SOW 04 started on 22 Sep, so it is in October's report; a SOW that ended long ago is not.
    expect(r.data.sows.some((s) => s.title === "SOW 04 Payment controls")).toBe(true);
    expect(r.data.sows.some((s) => s.title === "SOW 04 Discovery")).toBe(false);
    // Ending within 90 days of 31 Oct: both Quillon SOWs and nothing later than 29 Jan 2027.
    expect(r.data.ending.map((e) => e.title)).toEqual(expect.arrayContaining(["SOW 02 Close process review", "SOW 04 Payment controls"]));
    expect(r.data.ending.every((e) => e.endDate >= "2026-10-31" && e.endDate <= "2027-01-29" && e.daysLeft >= 0 && e.daysLeft <= 90)).toBe(true);
    expect(r.data.ending.map((e) => e.endDate)).toEqual([...r.data.ending.map((e) => e.endDate)].sort());
    // Scores: the third-quarter scorecards were final by then.
    expect(r.data.scores.length).toBeGreaterThanOrEqual(2);
    expect(r.data.measuredVendors).toBe(3);
  });

  it("lists exactly the helpdesk targets missed in the month", async () => {
    const r = await report("2026-10");
    const overview = (await t.as(MEMBER).get("/api/performance").query({ month: "2026-10" })).body.rows as {
      vendorName: string;
      metrics: { cells: Record<string, { verdict: string; valueTenths: number }> };
    }[];
    const expected = overview.flatMap((v) =>
      Object.entries(v.metrics.cells)
        .filter(([, c]) => c.verdict === "missed")
        .map(([k, c]) => `${v.vendorName} ${k} ${c.valueTenths}`),
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(r.data.missed.map((m) => `${m.vendorName} ${m.metric} ${m.valueTenths}`).sort()).toEqual(expected.sort());
  });

  it("covers the running month up to today, and refuses a month that has not started or is too long ago", async () => {
    expect((await report("2026-11")).data).toMatchObject({ month: "2026-11", asAt: TODAY, running: true });
    await t.as(MEMBER).get("/api/report").query({ month: "2026-12" }).expect(400);
    await t.as(MEMBER).get("/api/report").query({ month: "2024-10" }).expect(400);
    await t.as(MEMBER).get("/api/report").query({ month: "October" }).expect(400);
  });

  it("the PDF is one to two pages with every section, and prints the summary only once a person has saved one", async () => {
    const before = await pdf("/api/report/pdf", { month: "2026-09" });
    expect(before.pages).toBeLessThanOrEqual(2);
    for (const heading of [
      "Monthly report, September 2026",
      "Spend against budgets",
      "Agreements ending within 90 days",
      "Vendor scores",
      "Missed helpdesk targets",
      "Open RFPs",
      "Expense management tool",
      "Evaluating",
      "Travel booking tool",
      "In review",
      "Service desk tooling",
      "Drafting",
    ])
      expect(before.text).toContain(heading);
    expect(before.text).toContain("figures as at 30 Sep 2026");
    await t.as(MEMBER).put("/api/report").query({ month: "2026-09" }).send({ summary: "A quiet month, typed by hand." }).expect(200);
    expect((await pdf("/api/report/pdf", { month: "2026-09" })).text).toContain("A quiet month, typed by hand.");
  });

  it("the PDF's figures are the report's figures", async () => {
    const r = await report("2026-10");
    const { text, pages } = await pdf("/api/report/pdf", { month: "2026-10" });
    expect(pages).toBeLessThanOrEqual(2);
    expect(text).toContain("Bluefinch Systems · SOW 07 Ledger migration € 240,000.00 € 175,000.00 72%");
    expect(text).toContain("Quillon Consulting · SOW 02 Close process review");
    for (const s of r.data.scores) expect(text).toContain(`${s.vendorName} Q3 2026 ${(s.overallTenths / 10).toFixed(1)} / 5`);
    for (const m of r.data.missed) expect(text).toContain(m.vendorName);
  });

  it("stays within two pages when there is far more than fits, and says what was left out", async () => {
    const other = await testApp();
    const who = (await other.as(MEMBER).get("/api/me")).body.id;
    for (let i = 0; i < 14; i++) {
      const v = (
        await other
          .as(MEMBER)
          .post("/api/vendors")
          .send({ name: `Crowd Vendor ${String(i).padStart(2, "0")} with a rather long name`, type: "software", ownerUserId: who, ndaRequired: false, dpaRequired: false })
      ).body.id;
      await other
        .as(MEMBER)
        .post("/api/agreements")
        .send({
          vendorId: v,
          ownerUserId: who,
          kind: "sow",
          title: `SOW ${i} with a long descriptive title for the report`,
          pricing: "fixed",
          status: "active",
          signedOn: "2026-01-01",
          budgetMinor: 10_000_00 + i,
          startDate: "2026-06-01",
          endDate: "2026-12-20",
        })
        .expect(201);
    }
    await other
      .as(MEMBER)
      .put("/api/report")
      .query({ month: "2026-10" })
      .send({ summary: "Long summary. ".repeat(100).trim() })
      .expect(200);
    const res = await other.as(MEMBER).get("/api/report/pdf").query({ month: "2026-10" }).buffer(true).parse(binary);
    const { pages, text } = await textOf(res.body as Buffer);
    expect(pages).toBeLessThanOrEqual(2);
    expect(text).toMatch(/And \d+ more SOWs, listed in the app\./);
    expect(text).toMatch(/And \d+ more agreements, listed in the app\./);
    await other.close();
  });

  describe("AI summary (AI-1, AI-2)", () => {
    const month = "2026-08";
    const q = { month };
    it("is a suggestion until a person takes it over; the PDF does not print it before", async () => {
      const r = (await t.as(MEMBER).post("/api/report/suggestion").query(q).expect(201)).body as ManagementReport;
      expect(r.summary).toBeNull();
      expect(r.suggestion).toMatchObject({ status: "proposed", reviewedBy: null });
      expect(r.suggestion!.output.summary).toMatch(/^In August 2026, € [\d,]+\.\d\d was invoiced|^Nothing was invoiced in August 2026/);
      expect((await pdf("/api/report/pdf", q)).text).not.toContain(r.suggestion!.output.summary.slice(0, 40));

      const accepted = (await reviewReport(month, "accept")).body as ManagementReport;
      expect(accepted.summary).toBe(r.suggestion!.output.summary);
      expect(accepted.suggestion).toMatchObject({ status: "accepted", reviewedBy: MEMBER });
      expect((await pdf("/api/report/pdf", q)).text).toContain(r.suggestion!.output.summary.slice(0, 40));
    });
    it("becomes 'accepted with changes' when the person edits the text, and the AI's own text is kept", async () => {
      const before = await report(month);
      const edited = (
        await t
          .as(ADMIN)
          .put("/api/report")
          .query(q)
          .send({ summary: `${before.summary} Reviewed with finance.` })
          .expect(200)
      ).body as ManagementReport;
      expect(edited.summary).toMatch(/Reviewed with finance\.$/);
      expect(edited.suggestion).toMatchObject({ status: "edited", reviewedBy: ADMIN });
      expect(edited.suggestion!.output.summary).toBe(before.suggestion!.output.summary);
      // Putting the AI's text back makes it "accepted" again.
      const back = (await t.as(ADMIN).put("/api/report").query(q).send({ summary: before.suggestion!.output.summary }).expect(200)).body as ManagementReport;
      expect(back.suggestion!.status).toBe("accepted");
    });
    it("can be rejected, which leaves the person's own summary alone, and asked for again", async () => {
      await t.as(MEMBER).put("/api/report").query({ month: "2026-07" }).send({ summary: "My own words." }).expect(200);
      await t.as(MEMBER).post("/api/report/suggestion").query({ month: "2026-07" }).expect(201);
      const rejected = (await reviewReport("2026-07", "reject")).body as ManagementReport;
      expect(rejected).toMatchObject({ summary: "My own words.", suggestion: { status: "rejected" } });
      const again = (await t.as(MEMBER).post("/api/report/suggestion").query({ month: "2026-07" }).expect(201)).body as ManagementReport;
      expect(again).toMatchObject({ summary: "My own words.", suggestion: { status: "proposed" } });
      expect(again.suggestion!.id).not.toBe(rejected.suggestion!.id);
    });
    it("when the AI cannot answer the page is told so, nothing is stored and the summary can still be typed", async () => {
      for (const mode of ["unavailable", "nonsense"] as const) {
        await ai(mode);
        const res = await t.as(MEMBER).post("/api/report/suggestion").query({ month: "2026-06" });
        expect(res.status).toBe(502);
        expect(res.body.error).toMatchObject({ code: "ai_unavailable" });
        expect(res.body.error.message).toContain("can still be done by hand");
      }
      expect((await report("2026-06")).suggestion).toBeNull();
      const typed = (await t.as(MEMBER).put("/api/report").query({ month: "2026-06" }).send({ summary: "Typed without the AI." }).expect(200)).body as ManagementReport;
      expect(typed.summary).toBe("Typed without the AI.");
      await ai("working");
      expect((await reviewReport("2026-05", "accept")).status).toBe(409);
    });
    it("a summary that is too long is refused with the reason, and every change is in the audit log", async () => {
      const res = await t
        .as(MEMBER)
        .put("/api/report")
        .query(q)
        .send({ summary: "x".repeat(1501) });
      expect(res.status).toBe(400);
      expect(res.body.error.fields.summary).toContain("at most 1,500 characters");
      const log = (await t.as(ADMIN).get("/api/admin/audit").query({ entityType: "report", pageSize: "100" })).body.items as {
        summary: string;
        changes: Record<string, unknown>;
      }[];
      const august = log.filter((e) => e.summary === "Management report August 2026");
      expect(august.some((e) => e.changes?.["AI summary"])).toBe(true);
      expect(august.some((e) => e.changes?.Summary)).toBe(true);
    });
  });
});

describe("B-1 vendor briefing", () => {
  const prepare = async (vendor: string, as = MEMBER) =>
    (await t.as(as).post(`/api/vendors/${ids[vendor]}/briefings`).expect(201)).body as { briefing: Briefing; aiProblem: string | null };

  it("gathers the vendor's agreements, dates, budgets, performance, missed targets, open work and flags, matching the app's own pages", async () => {
    const { briefing: b, aiProblem } = await prepare("Quillon Consulting");
    expect(aiProblem).toBeNull();
    const f = b.facts;
    expect(f).toMatchObject({
      asAt: TODAY,
      vendor: { name: "Quillon Consulting", type: "consultancy", status: "active", ownerName: "Sanne de Wit", nda: "in_place", dpa: "in_place" },
    });
    // Agreements: everything that has not ended, also the SOW still out for signature.
    expect(f.agreements.map((a) => a.title).sort()).toEqual([
      "Data processing agreement",
      "Framework agreement",
      "Mutual NDA",
      "SOW 02 Close process review",
      "SOW 03 Treasury roadmap",
      "SOW 04 Payment controls",
    ]);
    // Dates, soonest first.
    expect(f.dates.map((d) => [d.date, d.daysLeft, d.what])).toEqual([
      ["2026-12-01", 10, 'Milestone "Recommendations" is due (SOW 02 Close process review)'],
      ["2026-12-09", 18, "SOW 02 Close process review ends"],
      ["2027-01-20", 60, "SOW 04 Payment controls ends"],
    ]);
    // Budgets equal the SOW pages.
    for (const s of f.budgets) {
      const page = (await t.as(MEMBER).get(`/api/agreements/${s.agreementId}/delivery`)).body.budget;
      expect(s.budget).toMatchObject({ budgetMinor: page.budgetMinor, invoicedMinor: page.invoicedMinor, usedPct: page.usedPct, state: page.state });
    }
    expect(f.budgets.map((s) => s.title)).toEqual(["SOW 04 Payment controls", "SOW 02 Close process review"]);
    // Spend equals the vendor's line on the Money page.
    const money = (await t.as(MEMBER).get("/api/spend")).body as Spend;
    const line = money.byVendor.find((v) => v.vendorId === ids["Quillon Consulting"])!;
    expect(f.spend.total).toEqual({ EUR: line.EUR, GBP: line.GBP, eurMinor: line.eurMinor });
    expect(f.milestones).toEqual([expect.objectContaining({ sowTitle: "SOW 02 Close process review", title: "Recommendations", dueDate: "2026-12-01", daysLate: 0 })]);
    // Flags: the vendor's own warnings and risk flags, as the warnings page has them.
    const mine = (await warnings()).filter((w) => w.vendorId === ids["Quillon Consulting"]);
    expect(f.flags.map((w) => [w.type, w.detail])).toEqual(mine.map((w) => [w.type, w.detail]));
    expect(f.flags.map((w) => w.type).sort()).toEqual(["risk_budget_trend", "risk_open_milestones", "sow_ending"]);
    // No board: no helpdesk figures.
    expect(f.performance).toBeNull();
    expect(f.missed).toEqual([]);
  });

  it("for a helpdesk vendor carries the last three whole months, their trend and the missed targets, as the performance page has them", async () => {
    const { briefing: b } = await prepare("Bluefinch Systems");
    const f = b.facts;
    const page = (await t.as(MEMBER).get(`/api/performance/vendors/${ids["Bluefinch Systems"]}`).query({ month: "2026-10" })).body.months as {
      month: string;
      cells: Record<string, { valueTenths: number | null; verdict: string }>;
    }[];
    expect(f.performance!.months.map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    for (const m of f.performance!.months) expect(m.cells).toEqual(page.find((p) => p.month === m.month)!.cells);
    const [sep, oct] = [page.find((p) => p.month === "2026-09")!, page.find((p) => p.month === "2026-10")!];
    expect(f.performance!.trends.first_response).toBe(
      oct.cells.first_response!.valueTenths! > sep.cells.first_response!.valueTenths!
        ? "better"
        : oct.cells.first_response!.valueTenths === sep.cells.first_response!.valueTenths
          ? "same"
          : "worse",
    );
    const missed = f.performance!.months.flatMap((m) =>
      Object.entries(m.cells)
        .filter(([, c]) => c.verdict === "missed")
        .map(([k]) => `${m.month} ${k}`),
    );
    expect(f.missed.map((m) => `${m.month} ${m.metric}`).sort()).toEqual(missed.sort());
    expect(missed.length).toBeGreaterThan(0);
    // The proposed change request and the open milestones of its SOWs.
    expect(f.changeRequests).toEqual([expect.objectContaining({ title: "Extended hypercare", sowTitle: "SOW 07 Ledger migration", budgetChangeMinor: 12_000_00 })]);
    expect(f.milestones.map((m) => m.title)).toEqual(["Parallel run", "Go-live and handover"]);
    // Its scorecard for last quarter is still a draft, so there is no score yet; a vendor with a final one has it.
    expect(f.score).toBeNull();
    const mossgate = (await prepare("Mossgate IT")).briefing.facts;
    const card = (
      (await t.as(MEMBER).get("/api/scorecards").query({ vendorId: ids["Mossgate IT"], status: "final" })).body.items as { quarter: string; overallTenths: number }[]
    )[0]!;
    expect(mossgate.score).toEqual({ quarter: card.quarter, overallTenths: card.overallTenths, previousQuarter: null, previousTenths: null, trend: "first" });
  });

  it("the AI's summary and talking points are a suggestion: the briefing has no text of its own until a person accepts or writes it (AI-1)", async () => {
    const { briefing: b } = await prepare("Quillon Consulting");
    expect(b).toMatchObject({ summary: null, talkingPoints: null, hasText: false, suggestionStatus: "proposed" });
    expect(b.suggestion!.output.talkingPoints.length).toBeGreaterThanOrEqual(2);
    expect(b.suggestion!.output.summary).toContain("Quillon Consulting");
    const before = await pdf(`/api/briefings/${b.id}/pdf`);
    expect(before.text).not.toContain("Talking points");

    const accepted = (await reviewBriefing(b.id, "accept")).body as Briefing;
    expect(accepted.summary).toBe(b.suggestion!.output.summary);
    expect(pointsOf(accepted.talkingPoints)).toEqual(b.suggestion!.output.talkingPoints);
    expect(accepted.suggestion).toMatchObject({ status: "accepted", reviewedBy: MEMBER });

    const edited = (
      await t
        .as(ADMIN)
        .put(`/api/briefings/${b.id}`)
        .send({ summary: accepted.summary, talkingPoints: `${accepted.talkingPoints}\n- Ask about the holiday cover` })
        .expect(200)
    ).body as Briefing;
    expect(pointsOf(edited.talkingPoints).at(-1)).toBe("Ask about the holiday cover");
    expect(edited.suggestion).toMatchObject({ status: "edited", reviewedBy: ADMIN });
    expect(edited.suggestion!.output).toEqual(b.suggestion!.output);
    // Once taken over, the AI is not asked again for this briefing.
    await t.as(MEMBER).post(`/api/briefings/${b.id}/suggestion`).expect(409);

    const after = await pdf(`/api/briefings/${b.id}/pdf`);
    expect(after.text).toContain("Talking points");
    expect(after.text).toContain("Ask about the holiday cover");
    expect(after.text).toContain(`drafted by the AI and changed by ${ADMIN}`);
    const log = await history("briefing", b.id);
    expect(log.map((e) => e.action)).toEqual(expect.arrayContaining(["create", "update"]));
    expect(log.some((e) => e.changes["Talking points"])).toBe(true);
  });

  it("can be rejected and written by hand, and asked for again while nobody has taken it over", async () => {
    const { briefing: b } = await prepare("Tarnwick Software");
    const rejected = (await reviewBriefing(b.id, "reject")).body as Briefing;
    expect(rejected).toMatchObject({ summary: null, suggestion: { status: "rejected" } });
    const own = (await t.as(MEMBER).put(`/api/briefings/${b.id}`).send({ summary: "My own summary.", talkingPoints: "First\n\n  Second  " }).expect(200)).body as Briefing;
    expect(own).toMatchObject({ summary: "My own summary.", hasText: true, suggestion: { status: "rejected" } });
    expect(pointsOf(own.talkingPoints)).toEqual(["First", "Second"]);
    const again = (await t.as(MEMBER).post(`/api/briefings/${b.id}/suggestion`).expect(201)).body as Briefing;
    expect(again).toMatchObject({ summary: "My own summary.", suggestion: { status: "proposed" } });
  });

  it("is still made when the AI cannot answer: the facts are there and the text can be typed (AI-2)", async () => {
    await ai("unavailable");
    const { briefing: b, aiProblem } = await prepare("Mossgate IT");
    await ai("working");
    expect(aiProblem).toContain("The AI could not write the summary and talking points just now.");
    expect(b).toMatchObject({ suggestion: null, summary: null });
    expect(b.facts.flags.length).toBeGreaterThan(0);
    const typed = (await t.as(MEMBER).put(`/api/briefings/${b.id}`).send({ summary: "By hand.", talkingPoints: "One point" }).expect(200)).body as Briefing;
    expect(typed.summary).toBe("By hand.");
    expect((await pdf(`/api/briefings/${b.id}/pdf`)).text).toContain("By hand.");
    // And the AI can be asked afterwards.
    expect(((await t.as(MEMBER).post(`/api/briefings/${b.id}/suggestion`).expect(201)).body as Briefing).suggestion).toMatchObject({ status: "proposed" });
  });

  it("keeps the facts of the day it was prepared, whatever changes later", async () => {
    const vendor = await newVendor("Frozen Vendor");
    const sow = await newSow(vendor, { budgetMinor: 50_000_00, startDate: addDays(TODAY, -20), endDate: addDays(TODAY, 200) });
    const made = (await t.as(MEMBER).post(`/api/vendors/${vendor}/briefings`).expect(201)).body.briefing as Briefing;
    expect(made.facts.budgets[0]!.budget.invoicedMinor).toBe(0);
    await t
      .as(MEMBER)
      .post("/api/invoices")
      .send({ agreementId: sow.id, invoiceNumber: `F-${n()}`, invoiceDate: TODAY, amountMinor: 20_000_00 })
      .expect(201);
    expect(((await t.as(MEMBER).get(`/api/briefings/${made.id}`)).body as Briefing).facts.budgets[0]!.budget.invoicedMinor).toBe(0);
    const fresh = (await t.as(MEMBER).post(`/api/vendors/${vendor}/briefings`).expect(201)).body.briefing as Briefing;
    expect(fresh.facts.budgets[0]!.budget).toMatchObject({ invoicedMinor: 20_000_00, usedPct: 40 });
    const list = (await t.as(MEMBER).get(`/api/vendors/${vendor}/briefings`)).body as BriefingHeader[];
    expect(list.map((x) => x.id)).toEqual([fresh.id, made.id]);
  });

  it("the PDF carries every section with the briefing's own figures", async () => {
    const { briefing: b } = await prepare("Bluefinch Systems");
    const { text } = await pdf(`/api/briefings/${b.id}/pdf`);
    for (const heading of [
      "Bluefinch Systems",
      "facts as at 21 Nov 2026",
      "Warnings and risk flags",
      "Agreements",
      "Upcoming dates",
      "Spend against budget",
      "Helpdesk performance",
      "Open milestones and change requests",
    ])
      expect(text).toContain(heading);
    expect(text).toContain("SOW 07 Ledger migration € 240,000.00 € 199,200.00 83% (close)");
    expect(text).toContain("Change request waiting for a decision: Extended hypercare (SOW 07 Ledger migration)");
    expect(text).toContain("budget + € 12,000.00");
    expect(text).toContain("Parallel run");
    expect(text).toContain("Aug 2026 Sep 2026 Oct 2026");
  });

  it("can be removed, refuses text that is too long, and answers 404 for one that does not exist", async () => {
    const { briefing: b } = await prepare("Sedgewater Cloud");
    const long = await t
      .as(MEMBER)
      .put(`/api/briefings/${b.id}`)
      .send({ summary: "x".repeat(2001), talkingPoints: "" });
    expect(long.status).toBe(400);
    expect(long.body.error.fields.summary).toContain("at most 2,000 characters");
    await t.as(MEMBER).delete(`/api/briefings/${b.id}`).expect(200);
    await t.as(MEMBER).get(`/api/briefings/${b.id}`).expect(404);
    await t.as(MEMBER).get(`/api/briefings/${b.id}/pdf`).expect(404);
    expect((await history("briefing", b.id)).map((e) => e.action)).toContain("delete");
    await t.as(MEMBER).post("/api/vendors/00000000-0000-4000-8000-000000000000/briefings").expect(404);
  });
});

describe("review fixes: what a person accepts is what they read, and a summary knows when its figures moved on", () => {
  it("AI-1 accepting or rejecting names the text that was read; if the AI has written another since, nothing happens (report)", async () => {
    const month = "2026-03";
    const first = (await t.as(MEMBER).post("/api/report/suggestion").query({ month }).expect(201)).body as ManagementReport;
    // A colleague asks again before the first person presses the button.
    const second = (await t.as(ADMIN).post("/api/report/suggestion").query({ month }).expect(201)).body as ManagementReport;
    expect(second.suggestion!.id).not.toBe(first.suggestion!.id);
    for (const action of ["accept", "reject"] as const) {
      const res = await t.as(MEMBER).post("/api/report/suggestion/review").query({ month }).send({ action, suggestionId: first.suggestion!.id });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: "suggestion_replaced" });
    }
    const now = (await t.as(MEMBER).get("/api/report").query({ month })).body as ManagementReport;
    expect(now).toMatchObject({ summary: null, suggestion: { id: second.suggestion!.id, status: "proposed" } });
    await t.as(MEMBER).post("/api/report/suggestion/review").query({ month }).send({ action: "accept" }).expect(400);
    await t.as(MEMBER).post("/api/report/suggestion/review").query({ month }).send({ action: "accept", suggestionId: second.suggestion!.id }).expect(200);
  });

  it("AI-1 the same for a briefing", async () => {
    const made = (await t.as(MEMBER).post(`/api/vendors/${ids["Larkspur Data"]}/briefings`).expect(201)).body.briefing as Briefing;
    const again = (await t.as(ADMIN).post(`/api/briefings/${made.id}/suggestion`).expect(201)).body as Briefing;
    const stale = await t.as(MEMBER).post(`/api/briefings/${made.id}/suggestion/review`).send({ action: "accept", suggestionId: made.suggestion!.id });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("suggestion_replaced");
    expect((await t.as(MEMBER).get(`/api/briefings/${made.id}`)).body).toMatchObject({
      summary: null,
      talkingPoints: null,
      suggestion: { id: again.suggestion!.id, status: "proposed" },
    });
  });

  it("AI-1 two people accepting the same text at the same moment leave one summary and no error", async () => {
    const month = "2026-02";
    const r = (await t.as(MEMBER).post("/api/report/suggestion").query({ month }).expect(201)).body as ManagementReport;
    const send = (as: string) => t.as(as).post("/api/report/suggestion/review").query({ month }).send({ action: "accept", suggestionId: r.suggestion!.id });
    const [a, b] = await Promise.all([send(MEMBER), send(ADMIN)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const now = (await t.as(MEMBER).get("/api/report").query({ month })).body as ManagementReport;
    expect(now).toMatchObject({ summary: r.suggestion!.output.summary, suggestion: { status: "accepted" } });
  });

  it("D-2 a saved summary is marked once the month's figures have changed, in the report and in the PDF, until someone saves it again", async () => {
    const other = await testApp();
    const who = (await other.as(MEMBER).get("/api/me")).body.id;
    const month = "2026-11"; // the running month
    const get = async () => (await other.as(MEMBER).get("/api/report").query({ month })).body as ManagementReport;
    const text = async () => textOf((await other.as(MEMBER).get("/api/report/pdf").query({ month }).buffer(true).parse(binary)).body as Buffer);
    const note = "The figures below have changed since this summary was written";
    await other.as(MEMBER).put("/api/report").query({ month }).send({ summary: "November so far looks calm." }).expect(200);
    expect((await get()).summaryOutdated).toBe(false);
    expect((await text()).text).not.toContain(note);
    // An invoice dated in the month is keyed in afterwards.
    const v = (await other.as(MEMBER).post("/api/vendors").send({ name: "Late Invoice Vendor", type: "software", ownerUserId: who, ndaRequired: false, dpaRequired: false })).body
      .id;
    const sub = (
      await other.as(MEMBER).post("/api/agreements").send({
        vendorId: v,
        ownerUserId: who,
        kind: "subscription",
        title: "Licence",
        status: "active",
        signedOn: "2026-01-01",
        startDate: "2026-01-01",
        endDate: "2027-12-31",
        annualValueMinor: 1000_00,
        autoRenews: true,
      })
    ).body.id;
    await other.as(MEMBER).post("/api/invoices").send({ agreementId: sub, invoiceNumber: "LATE-1", invoiceDate: "2026-11-20", amountMinor: 1000_00 }).expect(201);
    expect((await get()).summaryOutdated).toBe(true);
    expect((await text()).text).toContain(note);
    // Saving the same words again confirms them for today's figures.
    const confirmed = (await other.as(MEMBER).put("/api/report").query({ month }).send({ summary: "November so far looks calm." }).expect(200)).body as ManagementReport;
    expect(confirmed.summaryOutdated).toBe(false);
    expect((await text()).text).not.toContain(note);
    // A report without a summary is never "outdated".
    await other.as(MEMBER).put("/api/report").query({ month }).send({ summary: "" }).expect(200);
    expect((await get()).summaryOutdated).toBe(false);
    await other.close();
  });

  it("D-2 saving nothing on an untouched month creates no record, and the first real save is logged as the record being made", async () => {
    const count = async () =>
      ((await t.as(ADMIN).get("/api/admin/audit").query({ entityType: "report", pageSize: "200" })).body.items as { summary: string; action: string }[]).filter(
        (e) => e.summary === "Management report January 2026",
      );
    await t.as(MEMBER).put("/api/report").query({ month: "2026-01" }).send({ summary: "" }).expect(200);
    await t.as(MEMBER).put("/api/report").query({ month: "2026-01" }).send({ summary: null }).expect(200);
    expect(await count()).toEqual([]);
    expect((await t.as(MEMBER).get("/api/report").query({ month: "2026-01" })).body).toMatchObject({ summary: null, updatedBy: null });
    await t.as(MEMBER).put("/api/report").query({ month: "2026-01" }).send({ summary: "First words." }).expect(200);
    await t.as(MEMBER).put("/api/report").query({ month: "2026-01" }).send({ summary: "Second words." }).expect(200);
    expect((await count()).map((e) => e.action).sort()).toEqual(["create", "update"]);
  });

  it("R-1 and D-2 a helpdesk vendor that is no longer in use raises no flag and is not in the report's missed targets", async () => {
    const other = await testApp();
    const before = (await other.as(MEMBER).get("/api/report").query({ month: "2026-10" })).body as ManagementReport;
    expect(before.data.missed.some((m) => m.vendorName === "Tarnwick Software")).toBe(true);
    const all = (await other.as(MEMBER).get("/api/vendors").query({ status: "all", pageSize: "200" })).body.items as { id: string; name: string }[];
    const tarnwick = all.find((v) => v.name === "Tarnwick Software")!;
    const detail = (await other.as(MEMBER).get(`/api/vendors/${tarnwick.id}`)).body;
    // Its only agreement is ended first, since a vendor with a running agreement cannot be offboarded.
    const agreements = (await other.as(MEMBER).get("/api/agreements").query({ vendorId: tarnwick.id, pageSize: "200" })).body.items as { id: string; status: string }[];
    for (const a of agreements.filter((x) => x.status === "active")) {
      const full = (await other.as(MEMBER).get(`/api/agreements/${a.id}`)).body;
      await other
        .as(MEMBER)
        .patch(`/api/agreements/${a.id}`)
        .send({ ...full, status: "ended", endReason: "terminated" })
        .expect(200);
    }
    await other
      .as(MEMBER)
      .patch(`/api/vendors/${tarnwick.id}`)
      .send({ ...detail, status: "offboarded" })
      .expect(200);
    const after = (await other.as(MEMBER).get("/api/report").query({ month: "2026-10" })).body as ManagementReport;
    expect(after.data.missed.some((m) => m.vendorName === "Tarnwick Software")).toBe(false);
    expect(after.data.measuredVendors).toBe(before.data.measuredVendors - 1);
    await other.close();
  });

  it("B-1 a briefing's PDF keeps the accents of the vendor's name in its file name", async () => {
    const v = (
      await t
        .as(MEMBER)
        .post("/api/vendors")
        .send({ name: `Société Générique ${n()}`, type: "software", ownerUserId: me, ndaRequired: false, dpaRequired: false })
    ).body as { id: string; name: string };
    const b = (await t.as(MEMBER).post(`/api/vendors/${v.id}/briefings`).expect(201)).body.briefing as Briefing;
    const res = await t.as(MEMBER).get(`/api/briefings/${b.id}/pdf`).buffer(true).parse(binary);
    expect(res.headers["content-disposition"]).toContain(`filename*=UTF-8''${encodeURIComponent(`${v.name} briefing ${TODAY}`)}.pdf`);
    expect(res.headers["content-disposition"]).toMatch(/filename="Socit Gnrique \w+ briefing 2026-11-21\.pdf"/);
  });

  it("B-1 an apostrophe or brackets in the vendor's name are written as codes in the file name, so browsers do not ignore it", async () => {
    const odd = (
      await t
        .as(MEMBER)
        .post("/api/vendors")
        .send({ name: `Société d'Été (Sud) ${n()}`, type: "software", ownerUserId: me, ndaRequired: false, dpaRequired: false })
    ).body as { id: string; name: string };
    const made = (await t.as(MEMBER).post(`/api/vendors/${odd.id}/briefings`).expect(201)).body.briefing as Briefing;
    const header = (await t.as(MEMBER).get(`/api/briefings/${made.id}/pdf`).buffer(true).parse(binary)).headers["content-disposition"] as string;
    const star = header.split("filename*=UTF-8''")[1]!;
    expect(star).toMatch(/^[A-Za-z0-9%._-]+$/);
    expect(decodeURIComponent(star)).toBe(`${odd.name} briefing ${TODAY}.pdf`);
  });
});
