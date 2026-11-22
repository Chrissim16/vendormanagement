import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, MEMBER, testApp } from "../../testing";

let t: Awaited<ReturnType<typeof testApp>>;
let me: string;
let vendorId: string;
beforeAll(async () => {
  t = await testApp({}, { empty: true });
  me = (await t.as(ADMIN).get("/api/me")).body.id;
  vendorId = (await t.as(ADMIN).post("/api/vendors").send({ name: "Currency Test Vendor", type: "software", ownerUserId: me, ndaRequired: false, dpaRequired: false })).body.id;
});
afterAll(() => t.close());

type Listed = { code: string; name: string; unitsPerEurE4: number; starting: boolean; rateSetBy: string | null; uses: Record<string, number> };
const list = async (): Promise<Listed[]> => (await t.as(MEMBER).get("/api/currencies")).body;
const sow = (currency: string, title = `SOW ${currency} ${Math.random()}`) =>
  t.as(MEMBER).post("/api/agreements").send({
    vendorId,
    ownerUserId: me,
    kind: "sow",
    title,
    pricing: "fixed",
    budgetMinor: 1_000_00,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    currency,
  });

describe("M-8 the currency list", () => {
  it("starts with the euro first, then GBP, USD, SEK, NOK and DKK at rough starting rates, for everyone to read", async () => {
    const all = await list();
    expect(all.map((c) => c.code)).toEqual(["EUR", "DKK", "GBP", "NOK", "SEK", "USD"]);
    expect(all.find((c) => c.code === "EUR")).toMatchObject({ unitsPerEurE4: 10000, starting: false });
    expect(all.filter((c) => c.code !== "EUR").every((c) => c.starting && c.rateSetBy === null)).toBe(true);
    expect(all.find((c) => c.code === "SEK")).toMatchObject({ name: "Swedish krona", unitsPerEurE4: 11_5000 });
  });

  it("only an admin changes it; a member is refused on the server", async () => {
    expect((await t.as(MEMBER).post("/api/admin/currencies").send({ code: "CHF", unitsPerEurE4: 9400 })).status).toBe(403);
    expect((await t.as(MEMBER).put("/api/admin/currencies/USD").send({ unitsPerEurE4: 10900 })).status).toBe(403);
    expect((await t.as(MEMBER).delete("/api/admin/currencies/DKK")).status).toBe(403);
    expect((await list()).find((c) => c.code === "USD")).toMatchObject({ unitsPerEurE4: 10800, starting: true });
  });

  it("an admin adds a standard currency with cents, with its rate; others are refused in words", async () => {
    const added = await t.as(ADMIN).post("/api/admin/currencies").send({ code: "chf", unitsPerEurE4: 9400 });
    expect(added.status).toBe(201);
    expect(added.body.find((c: Listed) => c.code === "CHF")).toMatchObject({ name: "Swiss franc", unitsPerEurE4: 9400, starting: false, rateSetBy: ADMIN });
    const refused = async (body: object) => (await t.as(ADMIN).post("/api/admin/currencies").send(body)).body.error.fields;
    expect((await refused({ code: "JPY", unitsPerEurE4: 1_620_000 })).code).toMatch(/Japanese yen \(JPY\) has no cents/);
    expect((await refused({ code: "BHD", unitsPerEurE4: 4100 })).code).toMatch(/Bahraini dinar \(BHD\) has 3 decimals/);
    expect((await refused({ code: "XYZ", unitsPerEurE4: 10000 })).code).toMatch(/not a standard currency code/);
    expect((await refused({ code: "CHF", unitsPerEurE4: 9500 })).code).toMatch(/already on the list/);
    expect((await refused({ code: "PLN", unitsPerEurE4: 0 })).unitsPerEurE4).toBeTruthy();
    expect((await refused({ code: "PLN" })).unitsPerEurE4).toBeTruthy();
    expect((await list()).some((c) => c.code === "PLN" || c.code === "JPY")).toBe(false);
  });

  it("an admin sets a rate as 1 EUR = so much; saving the starting rate as it is confirms it; the euro stays at 1", async () => {
    const set = await t.as(ADMIN).put("/api/admin/currencies/SEK").send({ unitsPerEurE4: 11_4900 });
    expect(set.body.find((c: Listed) => c.code === "SEK")).toMatchObject({ unitsPerEurE4: 11_4900, starting: false, rateSetBy: ADMIN });
    const confirmed = await t.as(ADMIN).put("/api/admin/currencies/NOK").send({ unitsPerEurE4: 11_7000 });
    expect(confirmed.body.find((c: Listed) => c.code === "NOK")).toMatchObject({ unitsPerEurE4: 11_7000, starting: false });
    const euro = await t.as(ADMIN).put("/api/admin/currencies/EUR").send({ unitsPerEurE4: 20000 });
    expect(euro.status).toBe(409);
    expect(euro.body.error.message).toMatch(/always 1/);
    expect((await t.as(ADMIN).put("/api/admin/currencies/SEK").send({ unitsPerEurE4: 1_000_000_000 })).status).toBe(400);
    expect((await t.as(ADMIN).put("/api/admin/currencies/ZAR").send({ unitsPerEurE4: 20_0000 })).status).toBe(404);
  });

  it("agreements, rate cards and RFPs take any currency on the list and nothing else", async () => {
    const usd = await sow("USD");
    expect(usd.status).toBe(201);
    expect(usd.body.currency).toBe("USD");
    const chf = await sow("CHF");
    expect(chf.body.currency).toBe("CHF");
    const off = await sow("PLN");
    expect(off.status).toBe(400);
    expect(off.body.error.fields.currency).toMatch(/PLN is not on the app's list of currencies/);
    expect((await t.as(MEMBER).patch(`/api/agreements/${usd.body.id}`).send({ currency: "ZAR" })).body.error.fields.currency).toMatch(/not on the app's list/);
    expect((await t.as(MEMBER).patch(`/api/agreements/${usd.body.id}`).send({ currency: "SEK" })).body.currency).toBe("SEK");
    const rate = await t.as(MEMBER).post(`/api/vendors/${vendorId}/rate-card`).send({ role: "Developer", dayRateMinor: 9_000_00, currency: "NOK", validFrom: "2026-01-01" });
    expect(rate.status).toBeLessThan(300);
    const badRate = await t.as(MEMBER).post(`/api/vendors/${vendorId}/rate-card`).send({ role: "Developer", dayRateMinor: 9_000_00, currency: "PLN", validFrom: "2026-02-01" });
    expect(badRate.body.error.fields.currency).toMatch(/not on the app's list/);
    const rfp = await t.as(MEMBER).post("/api/rfps").send({ title: "Currency RFP", need: "Something", budgetMinor: 50_000_00, currency: "DKK", ownerUserId: me });
    expect(rfp.status).toBe(201);
    expect(rfp.body.currency).toBe("DKK");
    expect((await t.as(MEMBER).post("/api/rfps").send({ title: "Off RFP", need: "Something", currency: "PLN", ownerUserId: me })).body.error.fields.currency).toMatch(/not on the app's list/);
  });

  it("a currency in use cannot be removed, and the refusal says what uses it; an unused one can; the euro never", async () => {
    const uses = (await list()).find((c) => c.code === "SEK")!.uses;
    expect(uses.agreements).toBeGreaterThan(0);
    const refused = await t.as(ADMIN).delete("/api/admin/currencies/SEK");
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/Swedish krona \(SEK\) is still used by 1 agreement/);
    expect((await t.as(ADMIN).delete("/api/admin/currencies/NOK")).body.error.message).toMatch(/1 rate card line/);
    expect((await t.as(ADMIN).delete("/api/admin/currencies/DKK")).body.error.message).toMatch(/1 RFP/);
    expect((await t.as(ADMIN).delete("/api/admin/currencies/EUR")).status).toBe(409);
    const removed = await t.as(ADMIN).delete("/api/admin/currencies/GBP");
    expect(removed.status).toBe(200);
    expect(removed.body.map((c: Listed) => c.code)).not.toContain("GBP");
    expect((await sow("GBP")).body.error.fields.currency).toMatch(/not on the app's list/);
  });

  it("every change is in the list's history, with the rate before and after", async () => {
    const log = (await t.as(ADMIN).get("/api/admin/audit").query({ entityType: "currencies" })).body.items as { action: string; summary: string; changes: object }[];
    expect(log.map((e) => [e.action, e.summary])).toEqual([
      ["delete", "Pound sterling (GBP)"],
      ["update", "Norwegian krone (NOK)"],
      ["update", "Swedish krona (SEK)"],
      ["create", "Swiss franc (CHF)"],
    ]);
    expect(log[0]!.changes).toEqual({ "currency GBP": { from: "1 EUR = 0.855 GBP (starting rate, not yet set by an admin)", to: "removed" } });
    expect(log[2]!.changes).toEqual({ "rate SEK": { from: "1 EUR = 11.50 SEK (starting rate, not yet set by an admin)", to: "1 EUR = 11.49 SEK" } });
    expect(log[3]!.changes).toEqual({ "currency CHF": { from: null, to: "1 EUR = 0.94 CHF" } });
  });
});
