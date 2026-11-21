import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, binary, MEMBER, testApp } from "../../testing";

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.close());

/** Fills the real template with the given rows, the way a person would in Excel. */
async function workbook(vendors: unknown[][], agreements: unknown[][]) {
  const res = await t.as(ADMIN).get("/api/admin/import/template.xlsx").buffer(true).parse(binary);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body as unknown as ArrayBuffer);
  for (const [name, rows] of [
    ["Vendors", vendors],
    ["Agreements", agreements],
  ] as const) {
    const ws = wb.getWorksheet(name)!;
    ws.spliceRows(2, 1);
    rows.forEach((r) => ws.addRow(r));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const send = (path: "preview" | "apply", file: Buffer, as = ADMIN) => t.as(as).post(`/api/admin/import/${path}`).attach("file", file, "import.xlsx");

const v = (name: string, type = "software", ...rest: unknown[]) => [name, type, ...rest];
// Vendor name, Kind, Title, Reference, Status, Owner email, Currency, Signed on, Start, End, Parent MSA title, Pricing, Budget, Annual value, Notice days, Auto renews, Term months, Notes
const a = (vendor: string, kind: string, title: string, o: Partial<Record<number, unknown>> = {}) => {
  const row: unknown[] = [vendor, kind, title, "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""];
  for (const [i, value] of Object.entries(o)) row[Number(i)] = value;
  return row;
};

describe("A-8 import", () => {
  it("offers a template with both sheets and their columns", async () => {
    const res = await t.as(ADMIN).get("/api/admin/import/template.xlsx").buffer(true).parse(binary);
    expect(res.headers["content-disposition"]).toContain("vendorapp-import-template.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    expect((wb.getWorksheet("Vendors")!.getRow(1).values as string[]).slice(1, 3)).toEqual(["Name", "Type"]);
    expect((wb.getWorksheet("Agreements")!.getRow(1).values as string[]).slice(1, 4)).toEqual(["Vendor name", "Kind", "Title"]);
  });

  it("previews valid and invalid rows with the reason for each, and saves nothing", async () => {
    const file = await workbook(
      [v("Import Alpha"), v("Import Beta", "hardware"), v(""), v("Bluefinch Systems"), v("Import Alpha"), v("Import Gamma", "advisory", "", "nobody@example.test")],
      [
        a("Import Alpha", "MSA", "Alpha MSA", { 4: "active", 7: new Date("2026-03-01T00:00:00Z") }),
        a("Import Alpha", "SOW", "Alpha SOW 1", { 8: "01-04-2026", 9: "2026-09-30", 10: "Alpha MSA", 11: "fixed", 12: "12.500,50" }),
        a("Import Alpha", "SOW", "Broken SOW", { 8: "2026-04-01", 9: "31-02-2026", 11: "fixed", 12: "lots" }),
        a("Nobody Ltd", "NDA", "NDA"),
        a("Import Alpha", "Lease", "Car"),
        a("Bluefinch Systems", "MSA", "master services agreement"),
        a("Import Alpha", "SOW", "Orphan", { 8: "2026-04-01", 9: "2026-05-01", 10: "No such MSA", 11: "fixed", 12: 100 }),
      ],
    );
    const before = (await t.as(ADMIN).get("/api/vendors").query({ status: "all" })).body.total;
    const res = await send("preview", file);
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(false);
    const rows = Object.fromEntries(res.body.rows.map((r: { sheet: string; row: number; outcome: string; problems: string[] }) => [`${r.sheet[0]}${r.row}`, r]));
    expect(rows.V2).toMatchObject({ outcome: "add", label: "Import Alpha" });
    expect(rows.V3.outcome).toBe("invalid");
    expect(rows.V4.problems.join(" ")).toMatch(/name/i);
    expect(rows.V5).toMatchObject({ outcome: "exists", problems: [] });
    expect(rows.V6.problems.join(" ")).toMatch(/more than once/);
    expect(rows.V7.problems.join(" ")).toMatch(/nobody@example.test has not opened the app/);
    expect(rows.A2.outcome).toBe("add");
    expect(rows.A3.outcome).toBe("add");
    expect(rows.A4.problems.join(" ")).toMatch(/End date: "31-02-2026" is not a date/);
    expect(rows.A4.problems.join(" ")).toMatch(/Budget: "lots" is not an amount/);
    expect(rows.A5.problems.join(" ")).toMatch(/Vendor "Nobody Ltd" is not in the app/);
    expect(rows.A6.problems.join(" ")).toMatch(/Kind: use MSA/);
    expect(rows.A7).toMatchObject({ outcome: "exists" });
    expect(rows.A8.problems.join(" ")).toMatch(/no MSA called "No such MSA"/);
    expect(res.body.counts).toEqual({ add: 3, exists: 2, invalid: 8 });
    expect((await t.as(ADMIN).get("/api/vendors").query({ status: "all" })).body.total).toBe(before);
  });

  it("imports the valid rows, and importing the same file again adds nothing", async () => {
    const file = await workbook(
      [v("Import Delta", "consultancy", "prospect", MEMBER, "Delta B.V.", "https://delta.example.test", "nl", "no", "yes", "no")],
      [
        a("Import Delta", "SOW", "Delta SOW", { 4: "active", 7: "2026-01-10", 8: "2026-02-01", 9: "2026-12-31", 10: "Delta MSA", 11: "time_and_materials", 12: 64000 }),
        a("Import Delta", "MSA", "Delta MSA", { 4: "active", 7: "2026-01-10" }),
        a("Import Delta", "Subscription", "Delta licence", { 6: "gbp", 9: "2027-06-30", 13: "31,500.00", 14: 60, 15: "yes" }),
        a("Bluefinch Systems", "DPA", "Second DPA", { 7: "2026-05-05" }),
      ],
    );
    const first = await send("apply", file);
    expect(first.body.counts).toEqual({ add: 5, exists: 0, invalid: 0 });
    expect(first.body.applied).toBe(true);

    const vendor = (await t.as(ADMIN).get("/api/vendors").query({ q: "Import Delta", status: "all" })).body.items[0];
    expect(vendor).toMatchObject({
      type: "consultancy",
      status: "prospect",
      ownerName: "Mira Okafor",
      legalName: "Delta B.V.",
      country: "NL",
      ndaRequired: false,
      dpaRequired: true,
      scoringEnabled: false,
    });
    const list = (await t.as(ADMIN).get("/api/agreements").query({ vendorId: vendor.id, sort: "title" })).body.items;
    expect(list.map((x: { title: string }) => x.title)).toEqual(["Delta licence", "Delta MSA", "Delta SOW"]);
    expect(list[0]).toMatchObject({ currency: "GBP", annualValueMinor: 31_500_00, noticePeriodDays: 60, autoRenews: true, ownerName: "Alex Admin" });
    expect(list[2]).toMatchObject({ budgetMinor: 64_000_00, pricing: "time_and_materials", status: "active", startDate: "2026-02-01", parentMsaId: list[1].id });
    const history = await t.as(ADMIN).get("/api/audit/history").query({ entityType: "vendor", entityId: vendor.id });
    expect(history.body.items[0]).toMatchObject({ action: "import", userEmail: ADMIN });

    const second = await send("apply", file);
    expect(second.body.counts).toEqual({ add: 0, exists: 5, invalid: 0 });
    expect((await t.as(ADMIN).get("/api/agreements").query({ vendorId: vendor.id })).body.total).toBe(3);
  });

  it("is for admins only", async () => {
    const file = await workbook([v("Member Import")], []);
    expect((await send("preview", file, MEMBER)).status).toBe(403);
    expect((await send("apply", file, MEMBER)).status).toBe(403);
    expect((await t.as(MEMBER).get("/api/admin/import/template.xlsx")).status).toBe(403);
    expect((await t.as(ADMIN).get("/api/vendors").query({ q: "Member Import" })).body.total).toBe(0);
  });

  it("explains a file that is not the template", async () => {
    expect((await send("preview", Buffer.from("not excel"))).body.error.message).toMatch(/could not be read as an Excel workbook/);
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Vendors").addRow(["Name"]);
    wb.addWorksheet("Agreements").addRow(["Vendor name"]);
    const res = await send("preview", Buffer.from(await wb.xlsx.writeBuffer()));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/missing the columns Type, Status/);
    expect((await t.as(ADMIN).post("/api/admin/import/preview")).status).toBe(400);
  });
});
