import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, binary, MEMBER, testApp } from "../../testing";

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.close());

/** Fills the real template with the given rows, the way a person would in Excel. */
async function workbook(vendors: unknown[][], agreements: unknown[][], more: { contacts?: unknown[][]; rates?: unknown[][]; invoices?: unknown[][] } = {}) {
  const res = await t.as(ADMIN).get("/api/import/template.xlsx").buffer(true).parse(binary);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body as unknown as ArrayBuffer);
  for (const [name, rows] of [
    ["Vendors", vendors],
    ["Contacts", more.contacts ?? []],
    ["Agreements", agreements],
    ["Day rates", more.rates ?? []],
    ["Invoices", more.invoices ?? []],
  ] as const) {
    const ws = wb.getWorksheet(name)!;
    ws.spliceRows(2, 1);
    rows.forEach((r) => ws.addRow(r));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const send = (path: "preview" | "apply", file: Buffer, as = ADMIN) => t.as(as).post(`/api/import/${path}`).attach("file", file, "import.xlsx");

const v = (name: string, type = "software", ...rest: unknown[]) => [name, type, ...rest];
// Vendor name, Kind, Title, Reference, Status, Owner email, Currency, Signed on, Start, End, Parent MSA title, Pricing, Budget, Annual value, Notice days, Auto renews, Term months, Notes
const a = (vendor: string, kind: string, title: string, o: Partial<Record<number, unknown>> = {}) => {
  const row: unknown[] = [vendor, kind, title, "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""];
  for (const [i, value] of Object.entries(o)) row[Number(i)] = value;
  return row;
};

describe("A-8 import", () => {
  it("offers a template with both sheets and their columns", async () => {
    const res = await t.as(ADMIN).get("/api/import/template.xlsx").buffer(true).parse(binary);
    expect(res.headers["content-disposition"]).toContain("vendorapp-import-template.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    expect((wb.getWorksheet("Vendors")!.getRow(1).values as string[]).slice(1, 3)).toEqual(["Name", "Type"]);
    expect((wb.getWorksheet("Agreements")!.getRow(1).values as string[]).slice(1, 4)).toEqual(["Vendor name", "Kind", "Title"]);
  });

  it("previews valid and invalid rows with the reason for each, and saves nothing", async () => {
    const file = await workbook(
      [
        v("Import Alpha"),
        v("Import Beta", "hardware"),
        v(""),
        v("Bluefinch Systems"),
        v("Import Twice"),
        v("import twice"),
        v("Import Gamma", "advisory", "", "nobody@example.test"),
        v("Import Eps", "software", "paused"),
      ],
      [
        a("Import Alpha", "MSA", "Alpha MSA", { 4: "active", 7: new Date("2026-03-01T00:00:00Z") }),
        a("Import Alpha", "SOW", "Alpha SOW 1", { 8: "01-04-2026", 9: "2026-09-30", 10: "Alpha MSA", 11: "fixed", 12: "12.500,50" }),
        a("Import Alpha", "SOW", "Broken SOW", { 8: "2026-04-01", 9: "31-02-2026", 11: "fixed", 12: "lots" }),
        a("Nobody Ltd", "NDA", "NDA"),
        a("Import Alpha", "Lease", "Car"),
        a("Bluefinch Systems", "MSA", "master services agreement"),
        a("Import Alpha", "SOW", "Orphan", { 8: "2026-04-01", 9: "2026-05-01", 10: "No such MSA", 11: "fixed", 12: 100 }),
        a("Import Alpha", "NDA", "Odd NDA", { 4: "signed", 6: "CHF", 10: "Alpha MSA" }),
        a("Import Alpha", "SOW", "Kronor SOW", { 6: "sek", 8: "2026-04-01", 9: "2026-09-30", 11: "fixed", 12: "SEK 285 000" }),
        a("Import Alpha", "SOW", "Mixed SOW", { 6: "EUR", 8: "2026-04-01", 9: "2026-09-30", 11: "fixed", 12: "SEK 285,000" }),
      ],
    );
    const before = (await t.as(ADMIN).get("/api/vendors").query({ status: "all" })).body.total;
    const res = await send("preview", file);
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(false);
    const rows = Object.fromEntries(res.body.rows.map((r: { sheet: string; row: number; outcome: string; problems: string[] }) => [`${r.sheet[0]}${r.row}`, r]));
    expect(rows.V2).toMatchObject({ outcome: "add", label: "Import Alpha" });
    expect(rows.V3.problems).toEqual(["Type: use software, consultancy or advisory."]);
    expect(rows.V4.problems.join(" ")).toMatch(/Name: Give the vendor a name/);
    expect(rows.V5).toMatchObject({ outcome: "exists", problems: [] });
    // Both copies of a repeated vendor are refused, not just the second.
    expect(rows.V6.problems.join(" ")).toMatch(/more than once/);
    expect(rows.V7.problems.join(" ")).toMatch(/more than once/);
    expect(rows.V8.problems.join(" ")).toMatch(/nobody@example.test has not opened the app/);
    expect(rows.V9.problems).toEqual(["Status: use one of prospect, active, on_hold or offboarded."]);
    expect(rows.A2.outcome).toBe("add");
    expect(rows.A3.outcome).toBe("add");
    expect(rows.A4.problems).toEqual(['End date: "31-02-2026" is not a date. Use 2026-12-31 or 31-12-2026.', 'Budget: "lots" is not an amount with at most two decimals.']);
    expect(rows.A5.problems.join(" ")).toMatch(/Vendor name: "Nobody Ltd" is not in the app/);
    expect(rows.A6.problems.join(" ")).toMatch(/Kind: use MSA/);
    expect(rows.A7).toMatchObject({ outcome: "exists" });
    expect(rows.A8.problems.join(" ")).toMatch(/no MSA called "No such MSA"/);
    // M-8: any listed currency, and an amount in the row's own currency only.
    expect(rows.A10).toMatchObject({ outcome: "add", problems: [] });
    expect(rows.A11.problems).toEqual(['Budget: "SEK 285,000" is in SEK, but the agreement is in EUR. Put SEK in the Currency column, or write the amount without a currency.']);
    expect(rows.A9.problems.sort()).toEqual([
      "Currency: CHF is not on the app's list of currencies. Use EUR, DKK, GBP, NOK, SEK, USD, or ask an admin to add it in Settings.",
      "Parent MSA title: only a SOW can sit under an MSA.",
      "Status: use one of draft, in_negotiation, out_for_signature, active or ended.",
    ]);
    // No message leaks the validator's own wording.
    expect(JSON.stringify(res.body.rows)).not.toMatch(/Invalid option|expected one of|Too big/);
    expect(res.body.counts).toEqual({ add: 4, exists: 2, invalid: 12 });
    expect((await t.as(ADMIN).get("/api/vendors").query({ status: "all" })).body.total).toBe(before);
  });

  it("reads formula cells by their result and reports cells that show an error", async () => {
    const file = await workbook(
      [v("Formula Co")],
      [
        a("Formula Co", "SOW", "Exact", { 8: "2026-01-01", 9: "2026-12-31", 11: "fixed", 12: { formula: "1250*10", result: 12500 } }),
        a("Formula Co", "SOW", "Too fine", { 8: "2026-01-01", 9: "2026-12-31", 11: "fixed", 12: { formula: "125/8", result: 15.625 } }),
        a("Formula Co", "SOW", "Plain too fine", { 8: "2026-01-01", 9: "2026-12-31", 11: "fixed", 12: 15.625 }),
        a("Formula Co", "Subscription", "Broken lookup", { 9: "2027-06-30", 13: 100, 14: { formula: "VLOOKUP(1,A1:B2,2)", result: { error: "#N/A" } }, 15: "yes" }),
        a("Formula Co", "Subscription", "No auto renew answer", { 9: "2027-06-30", 13: 100 }),
      ],
    );
    const res = await send("apply", file);
    const rows = Object.fromEntries(res.body.rows.map((r: { label: string; outcome: string; problems: string[] }) => [r.label.split(" · ")[1] ?? r.label, r]));
    expect(rows["Exact"].outcome).toBe("add");
    expect(rows["Too fine"].problems).toEqual(['Budget: "15.625" is not an amount with at most two decimals.']);
    expect(rows["Plain too fine"].problems).toEqual(['Budget: "15.625" is not an amount with at most two decimals.']);
    expect(rows["Broken lookup"].problems).toEqual(["Notice period days: the cell shows an error (#N/A). Type the value in."]);
    expect(rows["No auto renew answer"].problems).toEqual(["Auto renews: write yes or no for a subscription."]);
    const vendor = (await t.as(ADMIN).get("/api/vendors").query({ q: "Formula Co" })).body.items[0].id;
    const saved = (await t.as(ADMIN).get("/api/agreements").query({ vendorId: vendor })).body.items;
    expect(saved.map((x: { title: string; budgetMinor: number }) => [x.title, x.budgetMinor])).toEqual([["Exact", 1_250_000]]);
  });

  it("preview and import agree on every row", async () => {
    const gone = (
      await t
        .as(ADMIN)
        .post("/api/vendors")
        .send({ name: "Import Gone", type: "software", ownerUserId: (await t.as(ADMIN).get("/api/me")).body.id, status: "offboarded" })
    ).body;
    expect(gone.status).toBe("offboarded");
    const file = await workbook(
      [v("Pair A"), v("Pair B"), v("Pair Offboarded", "software", "offboarded"), v("Example Vendor (delete this row)")],
      [
        a("Pair B", "MSA", "Master"),
        // Pair A has no MSA called Master; only Pair B does.
        a("Pair A", "SOW", "Wrong parent", { 8: "2026-01-01", 9: "2026-12-31", 10: "Master", 11: "fixed", 12: 100 }),
        a("Pair B", "SOW", "Right parent", { 8: "2026-01-01", 9: "2026-12-31", 10: "master", 11: "fixed", 12: 100 }),
        a("Import Gone", "NDA", "For an offboarded vendor"),
        a("Pair Offboarded", "NDA", "For a vendor imported as offboarded"),
        a("Example Vendor (delete this row)", "SOW", "SOW 01 Example project", { 8: "2026-01-01", 9: "2026-12-31", 11: "fixed", 12: 120000 }),
      ],
    );
    const outcomes = (r: { body: { rows: { sheet: string; row: number; outcome: string }[] } }) => r.body.rows.map((x) => `${x.sheet[0]}${x.row}:${x.outcome}`);
    const preview = await send("preview", file);
    expect(outcomes(preview)).toEqual(["V2:add", "V3:add", "V4:add", "V5:invalid", "A2:add", "A3:invalid", "A4:add", "A5:invalid", "A6:invalid", "A7:invalid"]);
    const problems = Object.fromEntries(preview.body.rows.map((x: { sheet: string; row: number; problems: string[] }) => [`${x.sheet[0]}${x.row}`, x.problems.join(" ")]));
    expect(problems.A3).toMatch(/no MSA called "Master" for this vendor/);
    expect(problems.A5).toMatch(/offboarded and cannot receive new agreements/);
    expect(problems.A6).toMatch(/offboarded and cannot receive new agreements/);
    expect(problems.V5).toMatch(/example row/);
    expect(problems.A7).toMatch(/example row/);
    const applied = await send("apply", file);
    expect(applied.status).toBe(200);
    expect(outcomes(applied)).toEqual(outcomes(preview));
    const b = (await t.as(ADMIN).get("/api/vendors").query({ q: "Pair B" })).body.items[0].id;
    const list = (await t.as(ADMIN).get("/api/agreements").query({ vendorId: b, sort: "kind" })).body.items;
    expect(list.map((x: { title: string }) => x.title)).toEqual(["Master", "Right parent"]);
    expect(list[1].parentMsaId).toBe(list[0].id);
    expect((await t.as(ADMIN).get("/api/vendors").query({ q: "Example Vendor", status: "all" })).body.total).toBe(0);
  });

  it("refuses a workbook that would unpack to an enormous size, before unpacking it", async () => {
    // A ZIP directory entry that claims a 3 GB file inside a tiny archive.
    const entry = Buffer.alloc(46);
    entry.write("PK\x01\x02", 0, "latin1");
    entry.writeUInt32LE(3_000_000_000, 24);
    const res = await send("preview", Buffer.concat([Buffer.from("PK\x03\x04", "latin1"), entry]));
    expect(res.status).toBe(413);
    expect(res.body.error.message).toMatch(/too large to import/);
  });

  it("imports the valid rows, and importing the same file again adds nothing", async () => {
    const file = await workbook(
      [
        v(
          "Import Delta",
          "consultancy",
          "prospect",
          MEMBER,
          "Delta B.V.",
          "https://delta.example.test",
          "Testweg 1",
          "",
          "2611 AA",
          "Delft",
          "nl",
          "nl 000.222.333 b01",
          "no",
          "yes",
          "no",
        ),
      ],
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
      addressLine1: "Testweg 1",
      addressLine2: null,
      postalCode: "2611 AA",
      city: "Delft",
      vatNumber: "NL000222333B01",
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

  it("is open to every member since M13, with the member in the history", async () => {
    const file = await workbook([v("Member Import")], []);
    expect((await t.as(MEMBER).get("/api/import/template.xlsx")).status).toBe(200);
    expect((await send("preview", file, MEMBER)).body.counts).toEqual({ add: 1, exists: 0, invalid: 0 });
    expect((await send("apply", file, MEMBER)).body.applied).toBe(true);
    const vendor = (await t.as(ADMIN).get("/api/vendors").query({ q: "Member Import" })).body.items[0];
    const history = (await t.as(MEMBER).get("/api/audit/history").query({ entityType: "vendor", entityId: vendor.id })).body.items;
    expect(history[0]).toMatchObject({ action: "import", userEmail: MEMBER });
  });

  it("explains a file that is not the template", async () => {
    expect((await send("preview", Buffer.from("not excel"))).body.error.message).toMatch(/could not be read as an Excel workbook/);
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Vendors").addRow(["Name"]);
    wb.addWorksheet("Agreements").addRow(["Vendor name"]);
    const res = await send("preview", Buffer.from(await wb.xlsx.writeBuffer()));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/missing the columns Type, Status/);
    const other = new ExcelJS.Workbook();
    other.addWorksheet("Sheet1").addRow(["Name"]);
    expect((await send("preview", Buffer.from(await other.xlsx.writeBuffer()))).body.error.message).toMatch(/none of the template's sheets/);
    expect((await t.as(ADMIN).post("/api/import/preview")).status).toBe(400);
  });

  it("V-5 refuses a VAT or tax number another vendor holds or that appears twice in the file", async () => {
    const holder = (await t.as(MEMBER).get("/api/vendors").query({ q: "Bluefinch" })).body.items[0];
    // Name, Type, Status, Owner, Legal name, Website, Street, Second line, Postal code, City, Country, VAT
    const vat = (name: string, number: string) => v(name, "software", "", "", "", "", "", "", "", "", "", number);
    const file = await workbook([vat("Vat One", holder.vatNumber.toLowerCase()), vat("Vat Two", "DE 123"), vat("Vat Three", "de-123"), vat("Vat Four", "FR999")], []);
    const res = await send("preview", file);
    const problems = (label: string) => res.body.rows.find((r: { label: string }) => r.label === label).problems;
    expect(problems("Vat One")).toEqual([`VAT or tax number: ${holder.name} already has this number.`]);
    expect(problems("Vat Two")).toEqual(["VAT or tax number: it appears on more than one row of the file."]);
    expect(problems("Vat Three")).toEqual(["VAT or tax number: it appears on more than one row of the file."]);
    expect(problems("Vat Four")).toEqual([]);
  });

  it("V-5 still reads a workbook made from the template before the address columns existed", async () => {
    const wb = new ExcelJS.Workbook();
    const old = ["Name", "Type", "Status", "Owner email", "Legal name", "Website", "Country", "NDA required", "DPA required", "Scored", "Description"];
    const vendors = wb.addWorksheet("Vendors");
    vendors.addRow(old);
    vendors.addRow(["Old Template Vendor", "software", "", "", "", "", "GB"]);
    wb.addWorksheet("Agreements").addRow([
      "Vendor name",
      "Kind",
      "Title",
      "Reference",
      "Status",
      "Owner email",
      "Currency",
      "Signed on",
      "Start date",
      "End date",
      "Parent MSA title",
      "Pricing",
      "Budget",
      "Annual value",
      "Notice period days",
      "Auto renews",
      "Renewal term months",
      "Notes",
    ]);
    const res = await send("preview", Buffer.from(await wb.xlsx.writeBuffer()));
    expect(res.status).toBe(200);
    expect(res.body.rows[0]).toMatchObject({ label: "Old Template Vendor", outcome: "add", problems: [] });
  });
});

describe("A-8 contacts, M-9 day rates and invoices", () => {
  type Row = { sheet: string; row: number; label: string; outcome: string; problems: string[] };
  const bySheet = (body: { rows: Row[] }, sheet: string) => body.rows.filter((r) => r.sheet === sheet);
  // Vendor name, Agreement title, Invoice number, Invoice date, Amount, Milestone title, Description
  const sow = (vendor: string, title: string, budget: number) => a(vendor, "SOW", title, { 4: "active", 7: "2026-01-05", 8: "2026-01-10", 9: "2027-06-30", 11: "fixed", 12: budget });

  it("adds contacts with their roles, leaves ones already there, and never takes the main contact from someone", async () => {
    const file = await workbook([v("Contact Co")], [], {
      contacts: [
        ["Contact Co", "Ada First", "ada@contact.example.test", "+31 1", "account manager; Data Steward M13", "yes"],
        ["Contact Co", "Bo Second", "", "", "", ""],
        ["Contact Co", "Cy Third", "not-an-email", "", "", ""],
        ["Contact Co", "Di Fourth", "di@contact.example.test", "", "", "yes"],
        ["Bluefinch Systems", "Lena Hartog", "", "", "", ""],
        ["Bluefinch Systems", "New Main", "", "", "", "yes"],
        ["Nobody Ltd", "Someone", "", "", "", ""],
        ["Contact Co", "Bo Second", "", "", "", ""],
        ["Example Vendor (delete this row)", "Sam Example", "sam@example.test", "", "", ""],
      ],
    });
    const res = await send("apply", file, MEMBER);
    const rows = bySheet(res.body, "Contacts");
    expect(rows.map((r) => r.outcome)).toEqual(["invalid", "invalid", "invalid", "invalid", "exists", "invalid", "invalid", "invalid", "invalid"]);
    expect(rows[0]!.problems).toEqual(["Primary: more than one contact of this vendor is marked as the main one."]);
    expect(rows[1]!.problems).toEqual(["This contact appears more than once in the file."]);
    expect(rows[2]!.problems).toEqual(["Email: Enter a valid email address."]);
    expect(rows[5]!.problems.join(" ")).toMatch(/^Primary: Lena Hartog is already the main contact/);
    expect(rows[6]!.problems.join(" ")).toMatch(/"Nobody Ltd" is not in the app/);
    expect(rows[8]!.problems).toEqual(["This is the template's example row. Delete it."]);

    const fixed = await workbook([], [], {
      contacts: [
        ["Contact Co", "Ada First", "ada@contact.example.test", "+31 1", "account manager; Data Steward M13", "yes"],
        ["contact co", "Bo Second", "", "", "", ""],
      ],
    });
    expect((await send("apply", fixed, MEMBER)).body.counts).toEqual({ add: 2, exists: 0, invalid: 0 });
    const vendor = (await t.as(MEMBER).get("/api/vendors").query({ q: "Contact Co" })).body.items[0];
    const detail = (await t.as(MEMBER).get(`/api/vendors/${vendor.id}`)).body;
    const ada = detail.contacts.find((c: { name: string }) => c.name === "Ada First");
    expect(ada).toMatchObject({ isPrimary: true, email: "ada@contact.example.test", roles: ["Account Manager", "Data Steward M13"] });
    expect((await t.as(MEMBER).get("/api/contact-roles")).body.map((r: { name: string }) => r.name)).toContain("Data Steward M13");
    const history = (await t.as(MEMBER).get("/api/audit/history").query({ entityType: "vendor", entityId: vendor.id })).body.items;
    expect(history[0]).toMatchObject({ action: "import", userEmail: MEMBER });
    expect((await send("apply", fixed, MEMBER)).body.counts).toEqual({ add: 0, exists: 2, invalid: 0 });
  });

  it("adds day rates, refusing repeats and amounts in another currency, and leaves ones already there", async () => {
    const file = await workbook([v("Rate Co")], [], {
      rates: [
        ["Rate Co", "Analyst", 800, "", "2026-01-01"],
        ["Rate Co", "Architect", "1.250,00", "eur", "01-02-2026"],
        ["Rate Co", "Tester", "SEK 9000", "", "2026-01-01"],
        ["Rate Co", "Lead", 900, "EUR", "2026-01-01"],
        ["Rate Co", "lead", 950, "EUR", "2026-01-01"],
        ["Rate Co", "", 500, "", "2026-01-01"],
        ["Rate Co", "Swede", "9000", "SEK", ""],
      ],
    });
    const preview = await send("preview", file, MEMBER);
    const rows = bySheet(preview.body, "Day rates");
    expect(rows.map((r) => r.outcome)).toEqual(["add", "add", "invalid", "invalid", "invalid", "invalid", "invalid"]);
    expect(rows[2]!.problems[0]).toMatch(/^Day rate: "SEK 9000" is in SEK, but the agreement is in EUR/);
    expect(rows[3]!.problems).toEqual(["This day rate appears more than once in the file."]);
    expect(rows[5]!.problems).toEqual(["Role: Name the role."]);
    expect(rows[6]!.problems).toEqual(["Valid from: this is required."]);
    const applied = await send("apply", file, MEMBER);
    expect(applied.body.rows.map((r: Row) => r.outcome)).toEqual(preview.body.rows.map((r: Row) => r.outcome));
    const vendor = (await t.as(MEMBER).get("/api/vendors").query({ q: "Rate Co" })).body.items[0];
    const card = (await t.as(MEMBER).get(`/api/vendors/${vendor.id}/rate-card`)).body;
    expect(card.map((l: { role: string; dayRateMinor: number; validFrom: string }) => [l.role, l.dayRateMinor, l.validFrom]).sort()).toEqual([
      ["Analyst", 80000, "2026-01-01"],
      ["Architect", 125000, "2026-02-01"],
    ]);
    expect(bySheet((await send("apply", file, MEMBER)).body, "Day rates").map((r) => r.outcome)).toEqual(["exists", "exists", "invalid", "invalid", "invalid", "invalid", "invalid"]);
  });

  it("adds past invoices by the invoice form's rules, in the agreement's currency, and the budget warning follows", async () => {
    const file = await workbook([v("Invoice Co")], [sow("Invoice Co", "Invoice SOW", 1000), a("Invoice Co", "Subscription", "Invoice licence", { 6: "GBP", 9: "2027-06-30", 13: 500, 15: "no" })], {
      invoices: [
        ["Invoice Co", "Invoice SOW", "INV-1", "2026-03-31", 500, "", "First half"],
        ["Invoice Co", "invoice sow", "INV-2", new Date("2026-06-30T00:00:00Z"), "350.00", "", ""],
        ["Invoice Co", "Invoice SOW", "INV-3", "2026-12-31", 10, "", ""],
        ["Invoice Co", "Invoice licence", "INV-4", "2026-04-01", "€ 100", "", ""],
        ["Invoice Co", "Invoice licence", "INV-5", "2026-04-01", "£ 100", "Kick-off", ""],
        ["Invoice Co", "No such SOW", "INV-6", "2026-04-01", 10, "", ""],
        ["Invoice Co", "Invoice SOW", "INV-7", "2026-04-01", 10, "Kick-off", ""],
        ["Invoice Co", "Invoice SOW", "inv-1", "2026-04-01", 10, "", ""],
        ["Invoice Co", "Invoice SOW", "", "2026-04-01", 10, "", ""],
      ],
    });
    const preview = await send("preview", file, MEMBER);
    const rows = bySheet(preview.body, "Invoices");
    expect(rows.map((r) => r.outcome)).toEqual(["invalid", "add", "invalid", "invalid", "invalid", "invalid", "invalid", "invalid", "invalid"]);
    expect(rows[0]!.problems).toEqual(["This invoice appears more than once in the file."]);
    expect(rows[2]!.problems).toEqual(["Invoice date: The invoice date cannot be in the future."]);
    expect(rows[3]!.problems[0]).toMatch(/^Amount: "€ 100" is in EUR, but the agreement is in GBP/);
    expect(rows[4]!.problems).toEqual(["Milestone title: only a SOW has milestones. Leave it empty for a subscription."]);
    expect(rows[5]!.problems.join(" ")).toMatch(/has no SOW or subscription called "No such SOW"/);
    expect(rows[6]!.problems).toEqual(['Milestone title: the SOW has no milestone called "Kick-off".']);
    expect(rows[8]!.problems).toEqual(["Invoice number: this is required."]);
    // Nothing was saved by the preview.
    expect((await t.as(MEMBER).get("/api/vendors").query({ q: "Invoice Co" })).body.total).toBe(0);

    const fixed = await workbook([v("Invoice Co")], [sow("Invoice Co", "Invoice SOW", 1000), a("Invoice Co", "Subscription", "Invoice licence", { 6: "GBP", 9: "2027-06-30", 13: 500, 15: "no" })], {
      invoices: [
        ["Invoice Co", "Invoice SOW", "INV-1", "2026-03-31", 500, "", "First half"],
        ["Invoice Co", "invoice sow", "INV-2", new Date("2026-06-30T00:00:00Z"), "350.00", "", ""],
        ["Invoice Co", "Invoice licence", "INV-5", "2026-04-01", "£ 100", "", ""],
      ],
    });
    expect((await send("apply", fixed, MEMBER)).body.counts).toEqual({ add: 6, exists: 0, invalid: 0 });
    const vendor = (await t.as(MEMBER).get("/api/vendors").query({ q: "Invoice Co" })).body.items[0];
    const list = (await t.as(MEMBER).get("/api/invoices").query({ vendorId: vendor.id, sort: "invoiceNumber", dir: "asc" })).body.items;
    expect(list.map((i: { invoiceNumber: string; amountMinor: number; currency: string }) => [i.invoiceNumber, i.amountMinor, i.currency])).toEqual([
      ["INV-1", 50000, "EUR"],
      ["INV-2", 35000, "EUR"],
      ["INV-5", 10000, "GBP"],
    ]);
    const history = (await t.as(MEMBER).get("/api/audit/history").query({ entityType: "invoice", entityId: list[0].id })).body.items;
    expect(history[0]).toMatchObject({ action: "import", userEmail: MEMBER });
    // 850 of 1,000 invoiced: the SOW is on the warnings page.
    const warnings = (await t.as(MEMBER).get("/api/warnings")).body;
    expect(warnings.filter((w: { title: string }) => w.title === "Invoice Co · Invoice SOW").map((w: { type: string }) => w.type)).toContain("budget_warning");
    expect((await send("apply", fixed, MEMBER)).body.counts).toEqual({ add: 0, exists: 6, invalid: 0 });
  });

  it("gives back the rows with a problem in the template's shape, with the reason, ready to upload again", async () => {
    const file = await workbook([v("Fix Co"), v("Fix Bad", "hardware")], [], {
      contacts: [["Fix Co", "Good Contact", "", "", "", ""]],
      rates: [["Fix Co", "Analyst", "lots", "", "2026-01-01"]],
    });
    const res = await t.as(MEMBER).post("/api/import/problems.xlsx").attach("file", file, "import.xlsx").buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("vendorapp-import-rows-to-fix.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    const vendors = wb.getWorksheet("Vendors")!;
    expect(vendors.actualRowCount).toBe(2);
    expect(vendors.getRow(1).getCell(17).value).toBe("Problem");
    expect(vendors.getRow(2).getCell(1).value).toBe("Fix Bad");
    expect(vendors.getRow(2).getCell(17).value).toBe("Type: use software, consultancy or advisory.");
    expect(wb.getWorksheet("Contacts")!.actualRowCount).toBe(1);
    const rates = wb.getWorksheet("Day rates")!;
    expect(rates.getRow(2).getCell(3).value).toBe("lots");
    expect(rates.getRow(2).getCell(6).value).toMatch(/^Day rate: "lots" is not an amount/);
    // Nothing was saved, and the file can be uploaded again as it is.
    expect((await t.as(MEMBER).get("/api/vendors").query({ q: "Fix Co" })).body.total).toBe(0);
    const again = await send("preview", Buffer.from(await wb.xlsx.writeBuffer()), MEMBER);
    expect(again.status).toBe(200);
    expect(again.body.counts).toEqual({ add: 0, exists: 0, invalid: 2 });
  });
});
