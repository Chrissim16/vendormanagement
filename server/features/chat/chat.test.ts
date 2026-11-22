import { sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NOT_HELD, READ_ONLY, type AskAnswer, type AskLookup } from "../../../shared/ask";
import type { RfpDetail } from "../../../shared/rfp";
import type { AiRequest } from "../../platform/ports/types";
import { scorecardContext } from "../../app";
import { ADMIN, MEMBER, testApp } from "../../testing";
import { known, runLookup } from "./lookups";

/** C-1 through the API, on the sample data with today pinned to 21 Nov 2026 and the stand-in AI. */

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.close());

const ask = async (question: string, earlier: string[] = [], as = MEMBER) => {
  const res = await t.as(as).post("/api/ask").send({ question, earlier });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as AskAnswer;
};
/** The list a look-up points to, fetched from the list page's own endpoint with the same filter. */
const listBehind = async (l: AskLookup, api: string) => {
  const url = new URL(l.href!, "http://app");
  const query = Object.fromEntries(url.searchParams);
  const res = await t
    .as(MEMBER)
    .get(`/api${api}`)
    .query({ ...query, pageSize: "200" });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};
const tables = async () => {
  const db = t.ports.database.db;
  const names = (await db.execute(
    sql`select table_name as name from information_schema.tables where table_schema = 'public' and table_name not like '\_\_%' order by 1`,
  )) as unknown as { rows: { name: string }[] };
  const out: Record<string, string> = {};
  for (const { name } of names.rows) {
    if (name === "ai_suggestions") continue;
    const r = (await db.execute(sql.raw(`select count(*)::int as n, md5(coalesce(string_agg(md5(x::text), '' order by md5(x::text)), '')) as h from "${name}" x`))) as unknown as {
      rows: { n: number; h: string }[];
    };
    out[name] = `${r.rows[0]!.n}:${r.rows[0]!.h}`;
  }
  return out;
};

describe("C-1 an answer with links to the records used", () => {
  it("C-1 answers a question about agreements and links each record it used", async () => {
    const a = await ask("Which SOWs end this quarter?");
    expect(a.answered).toBe(true);
    expect(a.answer).toContain("SOW 02 Close process review");
    expect(a.answer).toContain("9 Dec 2026");
    expect(a.sources).toEqual([{ label: "SOW 02 Close process review", href: expect.stringMatching(/^\/agreements\/[0-9a-f-]{36}$/) }]);
    // The link leads to a record that exists.
    expect((await t.as(MEMBER).get(`/api${a.sources[0]!.href}`)).body.title).toBe("SOW 02 Close process review");
    expect(a.lookups).toHaveLength(1);
    expect(a.lookups[0]!.title).toBe("SOWs · ending 1 Oct 2026 to 31 Dec 2026");
    expect(a.model).toBe("scripted-strong");
  });

  it.each([
    ["vendors", "Which vendors does Mira own?", "Bluefinch Systems", /^\/vendors\?open=/],
    ["money", "How much was invoiced last month?", "€ 110,700.00", /^\/agreements\//],
    ["performance", "How did the helpdesks do last month?", "Tarnwick Software", /^\/performance\/[0-9a-f-]{36}\?month=2026-10$/],
    ["scorecards", "Which scorecards are final?", "4.2 out of 5", /^\/performance\/scorecards\//],
    ["RFPs", "Which RFPs are still running?", "Expense management tool", /^\/rfps\//],
    ["warnings", "Which vendors have no NDA?", "Larkspur Data", /^\/vendors\?open=/],
  ])("C-1 answers a question about %s with a link to each record", async (_what, question, expected, link) => {
    const a = await ask(question);
    expect(a.answered).toBe(true);
    expect(a.answer).toContain(expected);
    expect(a.sources.length).toBeGreaterThan(0);
    for (const s of a.sources) expect(s.href).toMatch(link);
  });

  it("C-1 one record in full: a vendor, a SOW with its milestones, an RFP with its candidates", async () => {
    const vendor = await ask("Tell me about Bluefinch");
    expect(vendor.answer).toContain("Owner: Mira Okafor");
    expect(vendor.lookups[0]!.totals).toContainEqual({ label: "Agreements", value: "6" });

    const sow = await ask("What are the milestones of SOW 07?");
    expect(sow.lookups[0]!.title).toBe("SOW · SOW 07 Ledger migration · Bluefinch Systems");
    expect(sow.lookups[0]!.totals).toContainEqual({ label: "Open milestones", value: "2" });
    expect(sow.answer).toContain("Milestone First trial migration (status: delivered 19 Oct 2026, 19 days late");
    const detail = (await t.as(MEMBER).get(`/api${sow.lookups[0]!.href}/delivery`)).body as { milestones: { status: string }[] };
    expect(detail.milestones.filter((m) => m.status === "open")).toHaveLength(2);

    const rfp = await ask("Who is on the shortlist of the Expense management tool RFP?");
    expect(rfp.lookups[0]!.totals).toContainEqual({ label: "On the shortlist", value: "3" });
    expect(rfp.answer).toContain("Candidate Fennmoor Expenses (list: Shortlist)");
    const real = (await t.as(MEMBER).get(`/api${rfp.lookups[0]!.href}`)).body as RfpDetail;
    expect(real.candidates.filter((c) => c.list === "shortlist")).toHaveLength(3);
  });

  it("C-1 a follow-up takes its subject from the question before it", async () => {
    const a = await ask("and next quarter?", ["Which SOWs end this quarter?"]);
    expect(a.lookups[0]!.title).toBe("SOWs · ending 1 Jan 2027 to 31 Mar 2027");
    expect(a.lookups[0]!.count).toBe(2);
    const b = await ask("What about Quillon?", ["Which SOWs are over budget at Bluefinch?"]);
    expect(b.lookups[0]!.title).toBe("Active SOWs with a budget, the most used first · Quillon Consulting");
  });
});

describe("C-1 counts and amounts match the list pages for the same filter", () => {
  it("C-1 the count of agreements is the list's own, also with a vendor, a kind and a period", async () => {
    for (const [question, expected] of [
      ["Which SOWs end this quarter?", 1],
      ["Which SOWs of Quillon are active?", 2],
      ["Which subscriptions are there?", null],
      ["Which agreements does Bluefinch have?", 6],
      ["Which SOWs end next year?", null],
    ] as const) {
      const a = await ask(question);
      const l = a.lookups[0]!;
      expect(l.href, question).toMatch(/^\/agreements\?/);
      const list = await listBehind(l, "/agreements");
      expect(l.count, question).toBe(list.total);
      if (expected !== null) expect(l.count, question).toBe(expected);
      expect(l.rows.map((r) => r.href).sort(), question).toEqual((list.items as { id: string }[]).map((i) => `/agreements/${i.id}`).sort());
      // The answer says the same number.
      expect(a.answer, question).toContain(`: ${l.count === 0 ? "none" : l.count}.`);
    }
  });

  it("C-1 the invoice count and totals are the invoice list's own", async () => {
    for (const question of ["How much was invoiced last month?", "What did Sedgewater invoice this year?", "Show the invoices of Quillon in the last 12 months"]) {
      const a = await ask(question);
      const l = a.lookups[0]!;
      const list = await listBehind(l, "/invoices");
      expect(l.count, question).toBe(list.total);
      // M-8: the euro total first, as the invoice list shows it, then each currency in it.
      const euros = `€ ${(list.sums.eurMinor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
      const mixed = Object.keys(list.sums.amounts).some((c: string) => c !== "EUR");
      expect(l.totals[0], question).toEqual({ label: mixed ? "Total in euros, converted" : "Total in euros", value: euros });
      expect(a.answer, question).toContain(euros);
    }
    const pounds = await ask("What did Sedgewater invoice this year?");
    expect(pounds.lookups[0]!.totals).toContainEqual({ label: "Total in GBP", value: "£ 31,500.00" });
    expect(pounds.lookups[0]!.totals).toContainEqual({ label: "Rates", value: "Converted at 1 EUR = 0.8547 GBP" });
  });

  it("C-1 spend, vendors, renewals, warnings, scorecards and RFPs agree with their pages", async () => {
    const spend = await ask("How much did we spend per vendor this year?");
    const money = (await listBehind(spend.lookups[0]!, "/spend")) as { total: { eurMinor: number }; byVendor: unknown[] };
    expect(spend.lookups[0]!.totals).toContainEqual({
      label: "Invoiced in euros, converted",
      value: `€ ${(money.total.eurMinor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`,
    });
    expect(spend.lookups[0]!.totals).toContainEqual({ label: "Vendors invoiced", value: String(money.byVendor.length) });

    const vendors = await ask("Which software vendors are there?");
    expect(vendors.lookups[0]!.count).toBe((await listBehind(vendors.lookups[0]!, "/vendors")).total);
    expect(vendors.lookups[0]!.count).toBeGreaterThan(3);

    const renewals = await ask("Which subscriptions need a renewal decision?");
    expect(renewals.lookups[0]!.count).toBe(((await listBehind(renewals.lookups[0]!, "/renewals")) as unknown[]).length);
    expect(renewals.lookups[0]!.count).toBe(2);
    expect(renewals.lookups[0]!.title).toBe("Renewals without a decision · notice deadline passed or within 90 days, the team's usual window");
    expect(renewals.lookups[0]!.href).toBe("/agreements/renewals");

    const all = (await t.as(MEMBER).get("/api/warnings")).body as { type: string }[];
    const warnings = await ask("What needs attention?");
    expect(warnings.lookups[0]!.count).toBe(all.length);
    expect(warnings.lookups[0]!.href).toBe("/warnings");
    const flags = await ask("Which risk flags are there?");
    // The warnings page cannot show risk flags alone, so no list is offered that would show a different number.
    expect(flags.lookups[0]!.href).toBeNull();
    expect(flags.lookups[0]!.count).toBe(all.filter((w) => w.type.startsWith("risk_")).length);
    const nda = await ask("Which vendors have no NDA?");
    expect(nda.lookups[0]!.href).toBe("/warnings?type=nda_missing");
    expect(nda.lookups[0]!.count).toBe(all.filter((w) => w.type === "nda_missing").length);

    const cards = await ask("Which scorecards are final?");
    expect(cards.lookups[0]!.count).toBe((await listBehind(cards.lookups[0]!, "/scorecards")).total);
    const rfps = await ask("Which RFPs are still running?");
    expect(rfps.lookups[0]!.href).toBe("/rfps");
    expect(rfps.lookups[0]!.count).toBe((await t.as(MEMBER).get("/api/rfps").query({ stage: "open" })).body.total);

    const helpdesk = await ask("How did the helpdesks do last month?");
    const overview = (await listBehind(helpdesk.lookups[0]!, "/performance")) as { rows: { metrics: { missed: number } }[] };
    expect(helpdesk.lookups[0]!.count).toBe(overview.rows.length);
    expect(helpdesk.lookups[0]!.totals).toEqual([{ label: "Vendors that missed a target", value: String(overview.rows.filter((r) => r.metrics.missed > 0).length) }]);
  });

  it("C-1 a long list is counted whole although only its first rows are read", async () => {
    const a = await ask("Show all invoices");
    const l = a.lookups[0]!;
    // The sample data's invoices, in six currencies since M-8.
    expect(l.count).toBe(31);
    expect(l.rows).toHaveLength(31);
    expect(l.more).toBe(0);
    const everything = await ask("Which agreements are there?");
    expect(everything.lookups[0]!.count).toBeGreaterThan(everything.lookups[0]!.rows.length - 1);
    expect(everything.lookups[0]!.count! - everything.lookups[0]!.rows.length).toBe(everything.lookups[0]!.more);
  });

  it("C-1 an answer that quotes a figure the app did not look up is thrown away, and nothing is kept", async () => {
    const real = t.ports.ai.complete.bind(t.ports.ai);
    const before = (await tables()).audit_log;
    const kept = async () =>
      ((await t.ports.database.db.execute(sql`select count(*)::int as n from ai_suggestions where kind like 'ask%'`)) as unknown as { rows: { n: number }[] }).rows[0]!.n;
    const n = await kept();
    try {
      // A model that makes a number up, twice.
      t.ports.ai.complete = async (req: AiRequest) =>
        JSON.parse(req.user).task === "ask_answer"
          ? { text: JSON.stringify({ answered: true, answer: "There are 17 SOWs worth € 999,999.00.", sources: ["A1"] }), model: "liar" }
          : real(req);
      const res = await t.as(MEMBER).post("/api/ask").send({ question: "Which SOWs end this quarter?" });
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe("ai_unavailable");
      expect(res.body.error.message).toContain("The AI could not answer just now");
      // A model that names a record the app never looked up.
      t.ports.ai.complete = async (req: AiRequest) =>
        JSON.parse(req.user).task === "ask_answer" ? { text: JSON.stringify({ answered: true, answer: "One SOW ends.", sources: ["Z9"] }), model: "liar" } : real(req);
      expect((await t.as(MEMBER).post("/api/ask").send({ question: "Which SOWs end this quarter?" })).status).toBe(502);
      // A model that asks for a look-up that does not exist, or one that would write.
      t.ports.ai.complete = async (req: AiRequest) =>
        JSON.parse(req.user).task === "ask_plan"
          ? { text: JSON.stringify({ lookups: [{ name: "delete_vendor", args: { vendor: "Bluefinch Systems" } }] }), model: "liar" }
          : real(req);
      expect((await t.as(MEMBER).post("/api/ask").send({ question: "Which SOWs end this quarter?" })).status).toBe(502);
    } finally {
      t.ports.ai.complete = real;
    }
    expect(await kept()).toBe(n);
    expect((await tables()).audit_log).toBe(before);
  });
});

describe("C-1 what a look-up says is what it did", () => {
  const run = async (call: Parameters<typeof runLookup>[1]) => {
    const ctx = scorecardContext(t.config, t.ports);
    return (await runLookup(ctx, call, await known(ctx), "A")).lookup;
  };

  it("C-1 a vendor's helpdesk month is the month the linked page opens on", async () => {
    const a = await ask("How did the helpdesk of Bluefinch do last month?");
    const l = a.lookups[0]!;
    expect(l.title).toBe("Helpdesk figures month by month · Bluefinch Systems · the six months up to October 2026");
    expect(l.href).toMatch(/^\/performance\/[0-9a-f-]{36}\?month=2026-10$/);
    expect(l.rows[0]!.label).toBe("October 2026");
    const page = (await listBehind(l, l.href!.split("?")[0]!.replace("/performance/", "/performance/vendors/"))) as { months: { month: string; missed: number }[] };
    expect(page.months.at(-1)!.month).toBe("2026-10");
    expect(l.totals[0]!.value).toBe(String(page.months.slice(-6).reduce((n, m) => n + m.missed, 0)));
    const future = await run({ name: "vendor_helpdesk", args: { vendor: "Bluefinch Systems", month: "2027-03" } });
    expect(future.note).toBe("There are no figures for a month that has not started, so the months up to November 2026 are shown.");
  });

  it("C-1 a period with only an end, a window, and a name written loosely are each said as they were used", async () => {
    const spend = await run({ name: "spend", args: { to: "2024-12-31" } });
    expect(spend.title).toBe("Spend per vendor and per month · invoices dated 1 Jan 2024 to 31 Dec 2024");
    expect(spend.href).toBe("/money?period=custom&from=2024-01-01&to=2024-12-31");

    const window = await run({ name: "renewals", args: { withinDays: 180 } });
    expect(window.title).toBe("Renewals without a decision · notice deadline passed or within 180 days");
    expect(window.count).toBe(((await listBehind(window, "/renewals")) as unknown[]).length);

    const loose = await run({ name: "agreements", args: { vendor: "bluefinch" } });
    expect(loose.count).toBe(6);
    expect(loose.note).toBe("“bluefinch” was taken to mean Bluefinch Systems.");
    expect((await run({ name: "agreements", args: { vendor: "Bluefinch Systems" } })).note).toBeNull();
    const two = await run({ name: "agreements", args: { vendor: "software" } });
    expect(two.count).toBeNull();
    expect(two.note).toContain("more than one matches “software”");

    // A kind of warning that nothing has today: the page would show everything, so no list is offered.
    const none = await run({ name: "warnings", args: { type: "nda_expired" } });
    expect(none.count).toBe(0);
    expect(none.href).toBeNull();
  });
});

describe("C-1 says so instead of guessing", () => {
  it("C-1 a question about something the app does not hold is not answered", async () => {
    for (const question of ["What is the weather tomorrow?", "What is the share price of Bluefinch's parent company going to do?", "Why is the sky blue?"]) {
      const a = await ask(question);
      expect(a.answered, question).toBe(false);
      expect(a.answer, question).toBe(NOT_HELD);
      expect(a.sources, question).toEqual([]);
      expect(a.lookups, question).toEqual([]);
    }
  });

  it("C-1 a vendor the app does not know is said to be unknown, never left out of the filter", async () => {
    const a = await ask("Show the invoices of Nobody Ltd");
    expect(a.answered).toBe(false);
    expect(a.answer).toContain("none is called “Nobody Ltd”");
    expect(a.lookups[0]!.count).toBeNull();
    expect(a.lookups[0]!.rows).toEqual([]);
    expect(a.answer).not.toContain("€");
  });

  it("C-1 nothing found is said as none, with the count of zero from the list", async () => {
    const a = await ask("Which SOWs of Mossgate end this quarter?");
    expect(a.lookups[0]!.count).toBe(0);
    expect((await listBehind(a.lookups[0]!, "/agreements")).total).toBe(0);
    expect(a.answer).toContain("none");
    const none = await ask("How is the helpdesk of Quillon doing?");
    expect(none.answered).toBe(false);
    expect(none.answer).toContain("Quillon Consulting has no Jira board linked");
  });
});

describe("C-1 questions about the content of a document", () => {
  it("C-1 the answer names the document and quotes the passage word for word", async () => {
    const a = await ask("What does the contract with Bluefinch say about liability?");
    expect(a.answered).toBe(true);
    expect(a.answer).toContain("Bluefinch MSA (invented sample).pdf");
    expect(a.answer).toContain("page 2");
    expect(a.answer).toContain("limited to 150% of the fees paid in that year");
    expect(a.passages[0]).toMatchObject({
      document: "Bluefinch MSA (invented sample).pdf",
      part: "page 2",
      where: "MSA Master services agreement · Bluefinch Systems",
      href: expect.stringMatching(/^\/agreements\//),
    });
    expect(a.passages[0]!.text).toContain(
      "4. Liability\nThe Supplier's total liability under this agreement in any contract year is limited to 150% of the fees paid in that year.",
    );
    // The document it names can be downloaded.
    expect((await t.as(MEMBER).get(`/api/documents/${a.passages[0]!.documentId}/download`)).status).toBe(200);

    const word = await ask("Which document mentions travel expenses?");
    expect(word.passages[0]!.document).toBe("Quillon framework agreement (invented sample).docx");
    expect(word.passages[0]!.part).toBeNull();
    expect(word.answer).toContain("above EUR 500 per trip");
  });

  it("C-1 the words that name a document do not decide which passage answers", async () => {
    // "Framework agreement" is the document's own name and stands in its opening line; the question is about liability.
    const a = await ask("What does the Framework agreement of Quillon say about liability?");
    expect(a.passages).toHaveLength(1);
    expect(a.passages[0]!.text).toContain("Liability\nThe Consultancy's liability is limited to the fees of the statement of work concerned");
    expect(a.answer).toContain("with a maximum of EUR 250,000 per event");
    // Nothing in it is about payment terms: no passage, instead of the opening paragraph.
    const b = await ask("What does the Framework agreement of Quillon say about payment terms?");
    expect(b.answered).toBe(false);
    expect(b.passages).toEqual([]);
    // A word no document has is named, so a passage about the rest is not taken for the whole answer.
    const c = await ask("What do the contracts say about walrus termination notice?");
    expect(c.passages.length).toBeGreaterThan(0);
    expect(c.answer).toContain("No document searched mentions “walrus”, so these passages are about the rest of what was looked for.");
  });

  it("C-1 a condition the lists cannot apply is not left out in silence", async () => {
    const a = await ask("Which invoices are over 50000 euros?");
    expect(a.answered).toBe(false);
    expect(a.lookups).toEqual([]);
  });

  it("C-1 words no document holds, and a vendor without documents, are said plainly", async () => {
    const a = await ask("What does the Bluefinch contract say about unicorns and dragons?");
    expect(a.answered).toBe(false);
    expect(a.answer).toBe("No passage in the 1 document searched mentions these words.");
    expect(a.passages).toEqual([]);
    const b = await ask("What do the documents of Mossgate say about liability?");
    expect(b.answered).toBe(false);
    expect(b.answer).toContain("There is no document of Mossgate IT with text the app can read");
  });

  it("C-1 a document attached later is read at once: Excel by sheet, and a file without words is said to have none", async () => {
    const quillon = ((await t.as(MEMBER).get("/api/agreements").query({ q: "SOW 03 Treasury roadmap" })).body.items as { id: string }[])[0]!.id;
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Rates").addRows([
      ["Role", "Day rate"],
      ["Treasury specialist", "EUR 1,480 per day, fixed until the zeppelin milestone"],
    ]);
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
    const up = await t.as(MEMBER).post(`/api/agreements/${quillon}/documents`).attach("file", xlsx, "Treasury rates (invented).xlsx");
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(up.body.readable).toBe(true);
    const a = await ask("Which document mentions the zeppelin milestone?");
    expect(a.passages[0]).toMatchObject({ document: "Treasury rates (invented).xlsx", part: "sheet “Rates”" });
    expect(a.passages[0]!.text).toContain("Treasury specialist | EUR 1,480 per day, fixed until the zeppelin milestone");

    // An old Word file is accepted but cannot be read; the agreement page and the answer both say so.
    const doc = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600)]);
    const old = await t.as(MEMBER).post(`/api/agreements/${quillon}/documents`).attach("file", doc, "Old letter (invented).doc");
    expect(old.status, JSON.stringify(old.body)).toBe(201);
    expect(old.body.readable).toBe(false);
    const listed = (await t.as(MEMBER).get(`/api/agreements/${quillon}`)).body.documents as { fileName: string; readable: boolean }[];
    expect(listed.map((d) => [d.fileName, d.readable]).sort()).toEqual([
      ["Old letter (invented).doc", false],
      ["Treasury rates (invented).xlsx", true],
    ]);
    const b = await ask("What do the documents say about zeppelin?");
    expect(b.lookups[0]!.totals).toContainEqual({ label: "Documents without readable text", value: "1" });

    // Removing the document removes its passages.
    await t.as(MEMBER).delete(`/api/documents/${up.body.id}`);
    expect((await ask("Which document mentions the zeppelin milestone?")).passages).toEqual([]);
  });

  it("C-1 what an RFP candidate sent can be asked about too, and is named with its RFP", async () => {
    const rfp = ((await t.as(MEMBER).get("/api/rfps").query({ q: "Expense management tool" })).body.items as { id: string }[])[0]!.id;
    const detail = (await t.as(MEMBER).get(`/api/rfps/${rfp}`)).body as RfpDetail;
    const fennmoor = detail.candidates.find((c) => c.vendorName === "Fennmoor Expenses")!;
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Pricing").addRows([["Our price includes a hippogriff support desk at no extra cost."]]);
    const up = await t
      .as(MEMBER)
      .post(`/api/rfp-candidates/${fennmoor.id}/documents`)
      .attach("file", Buffer.from(await wb.xlsx.writeBuffer()), "Fennmoor pricing (invented).xlsx");
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const a = await ask("Which document mentions a hippogriff support desk?");
    expect(a.passages[0]).toMatchObject({
      document: "Fennmoor pricing (invented).xlsx",
      where: "Sent by Fennmoor Expenses for the RFP Expense management tool",
      href: `/rfps/${rfp}?tab=responses`,
    });
  });
});

describe("C-1 the chat cannot change any data", () => {
  it("C-1 asking, also asking for a change, leaves every record and the audit log as they were", async () => {
    const before = await tables();
    const refused = await ask("Delete the vendor Bluefinch Systems");
    expect(refused.answered).toBe(false);
    expect(refused.answer).toBe(READ_ONLY);
    expect(refused.lookups).toEqual([]);
    for (const question of [
      "Please approve the change request on SOW 07",
      "Set the budget of SOW 07 Ledger migration to 1 euro",
      "Which SOWs end this quarter?",
      "Tell me about Bluefinch",
      "What are the milestones of SOW 07?",
      "How did the helpdesks do last month?",
      "What does the contract with Bluefinch say about termination?",
      "Who is on the shortlist of the Expense management tool RFP?",
    ])
      await ask(question);
    expect(await tables()).toEqual(before);
  });

  it("C-1 the only address is one that reads; there is nothing to send a change to", async () => {
    for (const [method, path] of [
      ["put", "/api/ask"],
      ["patch", "/api/ask"],
      ["delete", "/api/ask"],
      ["post", "/api/ask/lookups"],
      ["get", "/api/ask"],
    ] as const)
      expect((await t.as(MEMBER)[method](path).send({})).status, `${method} ${path}`).toBe(404);
  });

  it("C-1 every answer is kept with who asked, the model and the prompt, and nothing else is written", async () => {
    const a = await ask("Which RFPs are still running?", [], ADMIN);
    const me = (await t.as(ADMIN).get("/api/me")).body.id;
    const rows = (
      (await t.ports.database.db.execute(
        sql`select kind, subject_type, subject_id, model, prompt_version, input_summary, status from ai_suggestions where id = ${a.id}`,
      )) as unknown as { rows: Record<string, string>[] }
    ).rows;
    expect(rows).toEqual([
      {
        kind: "ask_answer",
        subject_type: "user",
        subject_id: me,
        model: "scripted-strong",
        prompt_version: "ask-answer/2",
        input_summary: "Which RFPs are still running?",
        status: "proposed",
      },
    ]);
  });
});

describe("C-1 who may ask, and what happens when it goes wrong", () => {
  it("C-1 every member may ask; someone whose access is switched off may not", async () => {
    expect((await ask("Which RFPs are still running?", [], ADMIN)).answered).toBe(true);
    expect((await t.as("former@example.test").post("/api/ask").send({ question: "Which RFPs are still running?" })).status).toBe(403);
  });

  it("C-1 X-3 an empty or overlong question is refused with a plain message", async () => {
    const empty = await t.as(MEMBER).post("/api/ask").send({ question: "   " });
    expect(empty.status).toBe(400);
    expect(empty.body.error.fields.question).toBe("Type a question first.");
    const long = await t
      .as(MEMBER)
      .post("/api/ask")
      .send({ question: "x".repeat(501) });
    expect(long.status).toBe(400);
    expect(long.body.error.fields.question).toBe("A question is at most 500 characters.");
    expect(
      (
        await t
          .as(MEMBER)
          .post("/api/ask")
          .send({ question: "ok", earlier: ["a", "b", "c", "d"] })
      ).status,
    ).toBe(400);
  });

  it("AI-2 when the AI is unavailable or answers nonsense the reply says so and nothing is kept", async () => {
    try {
      for (const mode of ["unavailable", "nonsense"] as const) {
        t.ports.ai.simulate!(mode);
        const res = await t.as(MEMBER).post("/api/ask").send({ question: "Which SOWs end this quarter?" });
        expect(res.status, mode).toBe(502);
        expect(res.body.error).toEqual({
          code: "ai_unavailable",
          message:
            "The AI could not answer just now. Nothing was changed. Everything it would have looked up is still on its own page: Vendors, Agreements, Money, Performance and RFPs. Try again later.",
        });
      }
    } finally {
      t.ports.ai.simulate!("working");
    }
    expect((await ask("Which SOWs end this quarter?")).answered).toBe(true);
  });
});

describe("the agreement list's end-date filter, which Ask links to", () => {
  it("A-2 agreements can be listed and exported by the period their end date falls in", async () => {
    const list = (await t.as(MEMBER).get("/api/agreements").query({ kind: "sow", endsFrom: "2027-01-01", endsTo: "2027-03-31" })).body as {
      total: number;
      items: { title: string }[];
    };
    expect(list.items.map((i) => i.title).sort()).toEqual(["SOW 04 Payment controls", "SOW 07 Ledger migration"]);
    // An agreement without an end date never falls in a period.
    const open = (await t.as(MEMBER).get("/api/agreements").query({ kind: "msa", endsFrom: "2000-01-01" })).body as { total: number };
    expect(open.total).toBe(0);
    const csv = await t.as(MEMBER).get("/api/agreements/export.csv").query({ kind: "sow", endsFrom: "2027-01-01", endsTo: "2027-03-31" });
    expect(csv.text).toContain("SOW 04 Payment controls");
    expect(csv.text).not.toContain("SOW 02 Close process review");
    expect((await t.as(MEMBER).get("/api/agreements").query({ endsFrom: "2027-02-30" })).status).toBe(400);
  });
});

describe("C-1 a list longer than the answer can read", () => {
  it("C-1 only the first 40 rows are read, the count and totals are of the whole list, and the rest is said to be left out", async () => {
    const sow = ((await t.as(MEMBER).get("/api/agreements").query({ q: "SOW 04 Payment controls" })).body.items as { id: string }[])[0]!.id;
    for (let i = 0; i < 45; i++) {
      const res = await t
        .as(MEMBER)
        .post("/api/invoices")
        .send({ agreementId: sow, invoiceNumber: `LONG-${i}`, invoiceDate: "2026-11-02", amountMinor: 100 });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    const a = await ask("Show the invoices of Quillon this month");
    const l = a.lookups[0]!;
    const list = await listBehind(l, "/invoices");
    expect(list.total).toBeGreaterThanOrEqual(46);
    expect(l.count).toBe(list.total);
    expect(l.rows).toHaveLength(40);
    expect(l.more).toBe(list.total - 40);
    expect(l.totals[0]!.value).toBe(`€ ${(list.sums.eurMinor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`);
    expect(a.answer).toContain("Only the first ones are listed here");
  });
});
