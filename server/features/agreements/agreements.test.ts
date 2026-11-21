import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, binary, MEMBER, testApp, TODAY } from "../../testing";

let t: Awaited<ReturnType<typeof testApp>>;
let me: string;
let vendorId: string;
beforeAll(async () => {
  t = await testApp();
  me = (await t.as(MEMBER).get("/api/me")).body.id;
  vendorId = (await t.as(MEMBER).post("/api/vendors").send({ name: "Agreement Test Vendor", type: "software", ownerUserId: me })).body.id;
});
afterAll(() => t.close());

const add = (o: Record<string, unknown>) =>
  t
    .as(MEMBER)
    .post("/api/agreements")
    .send({ vendorId, ownerUserId: me, title: `T ${Math.random().toString(36).slice(2)}`, ...o });
const sow = { kind: "sow", pricing: "fixed", budgetMinor: 100_000_00, startDate: "2026-01-01", endDate: "2026-12-31" };
const sub = { kind: "subscription", annualValueMinor: 48_000_00, startDate: "2026-02-10", endDate: "2027-02-10", signedOn: "2026-02-01", status: "active" };
const find = async (title: string) => (await t.as(MEMBER).get("/api/agreements").query({ q: title })).body.items[0];
const PDF = Buffer.from("%PDF-1.4 invented test file");

describe("A-1 add an agreement", () => {
  it("adds each of the five kinds", async () => {
    for (const body of [{ kind: "msa" }, sow, { kind: "subscription", annualValueMinor: 1, endDate: "2027-01-01" }, { kind: "nda" }, { kind: "dpa" }]) {
      const res = await add(body);
      expect(res.status, body.kind).toBe(201);
      expect(res.body).toMatchObject({ kind: body.kind, status: "draft", vendorName: "Agreement Test Vendor", ownerName: "Mira Okafor" });
    }
  });
  it("keeps an MSA without an end date and without SOW or subscription fields", async () => {
    const res = await add({ kind: "msa", endDate: "2030-01-01", budgetMinor: 5, noticePeriodDays: 30 });
    expect(res.body).toMatchObject({ endDate: null, budgetMinor: null, noticePeriodDays: null, renewalState: "none", noticeDeadline: null });
  });
  it("needs start, end, pricing and budget for a SOW", async () => {
    const res = await add({ kind: "sow" });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(["budgetMinor", "endDate", "pricing", "startDate"]);
  });
  it("needs a renewal date and annual value for a subscription, and defaults the notice period to 90 days", async () => {
    expect(Object.keys((await add({ kind: "subscription" })).body.error.fields).sort()).toEqual(["annualValueMinor", "endDate"]);
    expect((await add(sub)).body).toMatchObject({ noticePeriodDays: 90, noticeDeadline: "2026-11-12", renewalState: "overdue" });
  });
  it("refuses an end date before the start date", async () => {
    const res = await add({ ...sow, startDate: "2026-06-01", endDate: "2026-05-31" });
    expect(res.body.error.fields.endDate).toMatch(/before the start/);
  });
  it("places a SOW under an MSA of the same vendor only", async () => {
    const msa = (await add({ kind: "msa", title: "Parent MSA" })).body;
    const child = (await add({ ...sow, title: "Child SOW", parentMsaId: msa.id })).body;
    expect(child.parent).toEqual({ id: msa.id, title: "Parent MSA" });
    expect((await t.as(MEMBER).get(`/api/agreements/${msa.id}`)).body.children.map((c: { title: string }) => c.title)).toEqual(["Child SOW"]);
    const other = await find("Master services agreement");
    expect((await add({ ...sow, parentMsaId: other.id })).body.error.fields.parentMsaId).toBeTruthy();
    expect((await add({ ...sow, parentMsaId: child.id })).body.error.fields.parentMsaId).toBeTruthy();
    expect((await add({ ...sow, title: "Loose SOW" })).body.parent).toBeNull();
  });
  it("refuses an offboarded vendor, an unknown vendor, and an owner without access", async () => {
    const gone = (await t.as(MEMBER).post("/api/vendors").send({ name: "Offboarded Co", type: "software", ownerUserId: me, status: "offboarded" })).body.id;
    expect((await add({ kind: "nda", vendorId: gone })).body.error.fields.vendorId).toMatch(/offboarded/);
    expect((await add({ kind: "nda", vendorId: "00000000-0000-4000-8000-000000000000" })).body.error.fields.vendorId).toBeTruthy();
    const former = (await t.as(ADMIN).get("/api/admin/users").query({ q: "former@" })).body.items[0].id;
    expect((await add({ kind: "nda", ownerUserId: former })).body.error.fields.ownerUserId).toBeTruthy();
  });
  it("refuses impossible dates and negative or fractional amounts", async () => {
    expect((await add({ ...sow, endDate: "2026-02-31" })).status).toBe(400);
    expect((await add({ ...sow, budgetMinor: -1 })).status).toBe(400);
    expect((await add({ ...sow, budgetMinor: 10.5 })).status).toBe(400);
  });
});

describe("A-2 status", () => {
  it("moves through the statuses; active needs the signed date; ended needs a reason", async () => {
    const a = (await add({ kind: "nda" })).body;
    const set = (body: Record<string, unknown>) => t.as(MEMBER).patch(`/api/agreements/${a.id}`).send(body);
    expect((await set({ status: "in_negotiation" })).body.status).toBe("in_negotiation");
    expect((await set({ status: "out_for_signature" })).body.status).toBe("out_for_signature");
    expect((await set({ status: "active" })).body.error.fields.signedOn).toBeTruthy();
    expect((await set({ status: "active", signedOn: "2026-11-01" })).body).toMatchObject({ status: "active", signedOn: "2026-11-01" });
    expect((await set({ status: "ended" })).body.error.fields.endReason).toBeTruthy();
    expect((await set({ status: "ended", endReason: "replaced" })).body).toMatchObject({ status: "ended", endReason: "replaced" });
    expect((await set({ status: "active" })).body).toMatchObject({ status: "active", endReason: null });
    const history = (await t.as(MEMBER).get("/api/audit/history").query({ entityType: "agreement", entityId: a.id })).body.items;
    expect(history[0].changes).toEqual({ status: { from: "ended", to: "active" }, endReason: { from: "replaced", to: null } });
  });
  it("never changes the vendor or the kind of an existing agreement", async () => {
    const a = (await add({ kind: "nda" })).body;
    expect((await t.as(MEMBER).patch(`/api/agreements/${a.id}`).send({ kind: "dpa" })).body.error.fields.kind).toBeTruthy();
    expect((await t.as(MEMBER).patch(`/api/agreements/${a.id}`).send({ vendorId: "00000000-0000-4000-8000-000000000000" })).body.error.fields.vendorId).toBeTruthy();
  });
  it("writes nothing to the history when nothing changed", async () => {
    const a = (await add({ kind: "nda", title: "Still" })).body;
    await t.as(MEMBER).patch(`/api/agreements/${a.id}`).send({ title: "Still" });
    expect((await t.as(MEMBER).get("/api/audit/history").query({ entityType: "agreement", entityId: a.id })).body.items).toHaveLength(1);
  });
});

describe("A-3 agreement list", () => {
  const titles = async (q: Record<string, string>) =>
    (
      await t
        .as(MEMBER)
        .get("/api/agreements")
        .query({ pageSize: "200", ...q })
    ).body.items.map((a: { title: string }) => a.title);
  it("filters by kind, vendor, status and owner, and searches title, reference and vendor", async () => {
    const bluefinch = (await t.as(MEMBER).get("/api/vendors").query({ q: "Bluefinch" })).body.items[0].id;
    expect((await titles({ vendorId: bluefinch, kind: "sow" })).sort()).toEqual(["SOW 04 Discovery", "SOW 07 Ledger migration", "SOW 09 Helpdesk run"]);
    expect(await titles({ vendorId: bluefinch, status: "ended" })).toEqual(["SOW 04 Discovery"]);
    expect(await titles({ q: "tarnwick" })).toContain("Reporting suite");
    const jonas = (await t.as(MEMBER).get("/api/people")).body.find((p: { email: string }) => p.email === "jonas@example.test").id;
    expect((await titles({ owner: jonas, kind: "subscription" })).sort()).toEqual(["Data platform licence", "Reporting suite"]);
  });
  it("sorts by any column, with empty values last", async () => {
    const ends = (await t.as(MEMBER).get("/api/agreements").query({ sort: "endDate", pageSize: "200" })).body.items.map((a: { endDate: string | null }) => a.endDate);
    const dated = ends.filter(Boolean);
    expect(dated).toEqual([...dated].sort());
    expect(ends.slice(dated.length).every((e: string | null) => e === null)).toBe(true);
    expect((await titles({ sort: "value", dir: "desc" }))[0]).toBe("SOW 07 Ledger migration");
    expect((await t.as(MEMBER).get("/api/agreements").query({ sort: "nope" })).status).toBe(400);
  });
  it("exports the filtered list as a CSV that Excel opens correctly", async () => {
    await add({ kind: "nda", title: '=HYPERLINK("http://evil.example.test")', reference: 'Quote " and, comma' });
    const res = await t.as(MEMBER).get("/api/agreements/export.csv").query({ vendorId }).buffer(true).parse(binary);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="agreements-${TODAY}.csv"`);
    const text = (res.body as Buffer).toString("utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      '"Vendor","Kind","Title","Reference","Status","Owner","Signed on","Start date","End date","Notice deadline","Currency","Budget","Annual value","Pricing","Auto renews"',
    );
    expect(lines.length - 1).toBe((await t.as(MEMBER).get("/api/agreements").query({ vendorId })).body.total);
    expect(text).toContain(`"'=HYPERLINK(""http://evil.example.test"")","Quote "" and, comma"`);
    expect(lines.every((l) => l.startsWith('"Agreement Test Vendor"') || l.startsWith('"Vendor"'))).toBe(true);
    expect(text).toMatch(/"48000\.00"/);
  });
});

describe("A-4 agreement page", () => {
  it("shows the details, the parent, documents and decisions", async () => {
    const a = await find("SOW 07 Ledger migration");
    const res = await t.as(MEMBER).get(`/api/agreements/${a.id}`);
    expect(res.body).toMatchObject({
      kind: "sow",
      pricing: "fixed",
      budgetMinor: 240_000_00,
      currency: "EUR",
      vendorName: "Bluefinch Systems",
      parent: { title: "Master services agreement" },
      documents: [],
      decisions: [],
    });
    expect((await t.as(MEMBER).get("/api/agreements/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});

describe("A-5 documents", () => {
  const attach = (id: string, name: string, data: Buffer) => t.as(MEMBER).post(`/api/agreements/${id}/documents`).attach("file", data, name);
  it("attaches, downloads and removes a file, and records each step", async () => {
    const a = (await add({ kind: "nda" })).body;
    const up = await attach(a.id, "Signed NDA é.pdf", PDF);
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ fileName: "Signed NDA é.pdf", contentType: "application/pdf", sizeBytes: PDF.length, createdBy: MEMBER });
    const down = await t.as(ADMIN).get(`/api/documents/${up.body.id}/download`).buffer(true).parse(binary);
    expect((down.body as Buffer).equals(PDF)).toBe(true);
    expect(down.headers["content-disposition"]).toContain("filename*=UTF-8''Signed%20NDA%20%C3%A9.pdf");
    expect(down.headers["x-content-type-options"]).toBe("nosniff");
    expect((await t.as(MEMBER).get(`/api/agreements/${a.id}`)).body.documents).toHaveLength(1);
    expect((await t.as(MEMBER).delete(`/api/documents/${up.body.id}`)).status).toBe(200);
    expect((await t.as(MEMBER).get(`/api/documents/${up.body.id}/download`)).status).toBe(404);
    const history = (await t.as(MEMBER).get("/api/audit/history").query({ entityType: "agreement", entityId: a.id })).body.items;
    expect(history.map((h: { changes: object }) => Object.values(h.changes ?? {})[0])).toEqual([{ from: "attached", to: "removed" }, { from: null, to: "attached" }, undefined]);
  });
  it("accepts PDF, Word and Excel and refuses everything else", async () => {
    const a = (await add({ kind: "nda" })).body;
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]);
    for (const [name, data] of [
      ["a.docx", zip],
      ["a.xlsx", zip],
      ["a.doc", ole],
      ["a.xls", ole],
      ["A.PDF", PDF],
    ] as const)
      expect((await attach(a.id, name, data)).status, name).toBe(201);
    for (const [name, data] of [
      ["a.exe", PDF],
      ["a.html", PDF],
      ["no-extension", PDF],
      ["fake.pdf", Buffer.from("<html>")],
      ["fake.docx", PDF],
      ["empty.pdf", Buffer.alloc(0)],
    ] as const) {
      const res = await attach(a.id, name, data);
      expect(res.status, name).toBe(400);
      expect(res.body.error.message, name).toBeTruthy();
    }
    expect((await t.as(MEMBER).get(`/api/agreements/${a.id}`)).body.documents).toHaveLength(5);
  });
  it("refuses a file larger than 25 MB with a clear message", async () => {
    const a = (await add({ kind: "nda" })).body;
    const big = Buffer.concat([PDF, Buffer.alloc(25 * 1024 * 1024 + 1)]);
    const res = await attach(a.id, "big.pdf", big);
    expect(res.status).toBe(413);
    expect(res.body.error.message).toMatch(/25 MB/);
  });
  it("never lets a file name reach the storage path", async () => {
    const a = (await add({ kind: "nda" })).body;
    const res = await attach(a.id, "../../etc/passwd.pdf", PDF);
    expect(res.status).toBe(201);
    expect(res.body.fileName).not.toMatch(/[\\/]/);
    expect((await attach("00000000-0000-4000-8000-000000000000", "a.pdf", PDF)).status).toBe(404);
  });
});

describe("A-6 renewals", () => {
  const renewals = (q: Record<string, string> = {}) => t.as(MEMBER).get("/api/renewals").query(q);
  it("lists overdue and due subscriptions soonest first, by window", async () => {
    const list = (await renewals()).body.filter((a: { vendorName: string }) => a.vendorName !== "Agreement Test Vendor");
    expect(list.map((a: { title: string; renewalState: string }) => [a.title, a.renewalState])).toEqual([
      ["Reporting suite", "overdue"],
      ["Service desk licence", "due_soon"],
    ]);
    const titles = async (window: string) => (await renewals({ window })).body.map((a: { title: string }) => a.title);
    expect(await titles("30")).not.toContain("Data platform licence");
    expect(await titles("180")).toContain("Data platform licence");
    expect((await renewals({ window: "45" })).status).toBe(400);
  });
  it("never lists an MSA, a SOW or a subscription that is not active", async () => {
    await add({ ...sub, status: "draft", title: "Draft subscription" });
    const kinds = new Set((await renewals({ window: "180" })).body.map((a: { kind: string; title: string }) => a.kind));
    expect([...kinds]).toEqual(["subscription"]);
    expect((await renewals({ window: "180" })).body.map((a: { title: string }) => a.title)).not.toContain("Draft subscription");
  });
  it("records a decision, which takes the subscription off the list", async () => {
    const a = (await add({ ...sub, title: "Decide me" })).body;
    const res = await t.as(MEMBER).post(`/api/agreements/${a.id}/decisions`).send({ decision: "renegotiate", decidedOn: TODAY, notes: "Ask for 10% off" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      renewalState: "ok",
      endDate: "2027-02-10",
      decisions: [{ decision: "renegotiate", decidedBy: MEMBER, termEndDate: "2027-02-10", notes: "Ask for 10% off" }],
    });
    expect((await renewals({ window: "180" })).body.map((x: { title: string }) => x.title)).not.toContain("Decide me");
    const again = await t.as(MEMBER).post(`/api/agreements/${a.id}/decisions`).send({ decision: "renew", decidedOn: TODAY });
    expect(again.status).toBe(409);
  });
  it("rolls the renewal date forward by the term when renewing, opening the next term", async () => {
    const a = (await add({ ...sub, title: "Roll me", renewalTermMonths: 24 })).body;
    const res = await t.as(MEMBER).post(`/api/agreements/${a.id}/decisions`).send({ decision: "renew", decidedOn: TODAY, rollForward: true });
    expect(res.body).toMatchObject({ endDate: "2029-02-10", noticeDeadline: "2028-11-12", renewalState: "ok", startDate: "2026-02-10" });
    expect((await t.as(MEMBER).post(`/api/agreements/${a.id}/decisions`).send({ decision: "terminate", decidedOn: TODAY })).status).toBe(201);
    const history = (await t.as(MEMBER).get("/api/audit/history").query({ entityType: "agreement", entityId: a.id })).body.items;
    expect(history[1].changes.endDate).toEqual({ from: "2027-02-10", to: "2029-02-10" });
  });
  it("refuses a decision for anything but an active subscription, or dated in the future", async () => {
    const nda = (await add({ kind: "nda" })).body;
    expect((await t.as(MEMBER).post(`/api/agreements/${nda.id}/decisions`).send({ decision: "renew", decidedOn: TODAY })).status).toBe(409);
    const a = (await add({ ...sub, title: "Future" })).body;
    expect((await t.as(MEMBER).post(`/api/agreements/${a.id}/decisions`).send({ decision: "renew", decidedOn: "2026-11-22" })).body.error.fields.decidedOn).toBeTruthy();
    expect((await t.as(MEMBER).post(`/api/agreements/${a.id}/decisions`).send({ decision: "maybe", decidedOn: TODAY })).status).toBe(400);
  });
  it("records one decision when two arrive at the same moment", async () => {
    const a = (await add({ ...sub, title: "Race" })).body;
    const both = await Promise.all([1, 2].map(() => t.as(MEMBER).post(`/api/agreements/${a.id}/decisions`).send({ decision: "renew", decidedOn: TODAY })));
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
  });
});

describe("A-7 warnings", () => {
  it("lists notice deadlines, SOWs ending soon and paperwork gaps, each linked to its record", async () => {
    const other = await testApp();
    const list = (await other.as(MEMBER).get("/api/warnings")).body as { type: string; title: string; tone: string; agreementId: string | null; vendorId: string; label: string }[];
    expect(list.map((w) => [w.type, w.title])).toEqual([
      ["dpa_expired", "Mossgate IT"],
      ["renewal_overdue", "Tarnwick Software · Reporting suite"],
      ["sow_ending", "Quillon Consulting · SOW 02 Close process review"],
      ["renewal_due", "Mossgate IT · Service desk licence"],
      ["nda_missing", "Larkspur Data"],
    ]);
    expect(list[1]).toMatchObject({ tone: "bad", label: "Overdue" });
    expect(list[2]).toMatchObject({ tone: "warn", label: "Ends in 18 days" });
    expect(list[3]!.label).toBe("27 days");
    expect(list.every((w) => w.vendorId)).toBe(true);
    expect(list.filter((w) => w.type.startsWith("renewal") || w.type.startsWith("sow")).every((w) => w.agreementId)).toBe(true);
    await other.close();
  });
  it("drops a warning once the cause is dealt with", async () => {
    const other = await testApp();
    const count = async () => (await other.as(MEMBER).get("/api/warnings")).body.length;
    const before = await count();
    const larkspur = (await other.as(MEMBER).get("/api/vendors").query({ q: "Larkspur" })).body.items[0].id;
    const nda = (await other.as(MEMBER).get("/api/agreements").query({ vendorId: larkspur, kind: "nda" })).body.items[0].id;
    await other.as(MEMBER).patch(`/api/agreements/${nda}`).send({ status: "active", signedOn: TODAY });
    expect(await count()).toBe(before - 1);
    await other.close();
  });
});
