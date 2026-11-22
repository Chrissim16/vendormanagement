import ExcelJS from "exceljs";
import { expect, test } from "@playwright/test";
import { ADMIN, expectAccessible, MEMBER, newAgreement, newVendor, signInAs, warningCount } from "./helpers";

const sub = { kind: "subscription", annualValueMinor: 4_800_000, startDate: "2026-02-10", endDate: "2027-02-10", signedOn: "2026-02-01", status: "active" };

test.describe("A-1 add an agreement", () => {
  test("A-1 the form shows only the fields of the chosen kind, and a SOW can sit under an MSA", async ({ page, context, request }) => {
    const v = await newVendor(request, "Forms");
    await newAgreement(request, v, { kind: "msa", title: "Forms MSA" });
    await signInAs(context, MEMBER);
    await page.goto("/agreements");
    await page.getByRole("button", { name: "Add agreement" }).click();
    const dialog = page.getByRole("dialog", { name: "Add agreement" });
    await dialog.getByLabel("Vendor").selectOption({ label: v.name });

    await dialog.getByLabel("Kind").selectOption("msa");
    await expect(dialog.getByText("An MSA has no end date.")).toBeVisible();
    await expect(dialog.getByLabel("Budget")).toHaveCount(0);
    await expect(dialog.getByLabel("End date")).toHaveCount(0);
    await dialog.getByLabel("Kind").selectOption("subscription");
    await expect(dialog.getByLabel("Renewal date")).toBeVisible();
    await expect(dialog.getByLabel("Notice period in days")).toHaveValue("90");
    await expect(dialog.getByLabel("Budget")).toHaveCount(0);
    await dialog.getByLabel("Kind").selectOption("nda");
    await expect(dialog.getByLabel("Valid until (optional)")).toBeVisible();
    await expect(dialog.getByLabel("Annual value")).toHaveCount(0);

    // Values typed for one kind do not linger unseen when the kind changes.
    await dialog.getByLabel("Kind").selectOption("subscription");
    await dialog.getByLabel("Start date").fill("2026-12-01");
    await dialog.getByLabel("Annual value").fill("900");
    await dialog.getByLabel("Kind").selectOption("sow");
    await expect(dialog.getByLabel("Start date")).toHaveValue("");
    await dialog.getByLabel("Kind").selectOption("subscription");
    await expect(dialog.getByLabel("Annual value")).toHaveValue("");

    await dialog.getByLabel("Kind").selectOption("sow");
    await dialog.getByLabel("Title").fill("SOW 01 Typed in");
    await dialog.getByRole("button", { name: "Add agreement" }).click();
    for (const message of ["Choose fixed price or time and materials.", "Enter the budget.", "A SOW needs a start date.", "A SOW needs an end date."])
      await expect(dialog.getByText(message)).toBeVisible();
    await expect(dialog.getByLabel("Title")).toHaveValue("SOW 01 Typed in");

    await dialog.getByLabel("Under MSA (optional)").selectOption({ label: "Forms MSA" });
    await dialog.getByLabel("Pricing").selectOption("fixed");
    await dialog.getByLabel("Budget").fill("twelve");
    await dialog.getByLabel("Start date").fill("2026-06-01");
    await dialog.getByLabel("End date").fill("2026-05-31");
    await dialog.getByRole("button", { name: "Add agreement" }).click();
    await expect(dialog.getByText("Enter an amount like 12,500.00.")).toBeVisible();
    await dialog.getByLabel("Budget").fill("12.500,00");
    // What the app understood is shown before anything is saved.
    await expect(dialog.getByText("Read as € 12,500.00")).toBeVisible();
    await dialog.getByRole("button", { name: "Add agreement" }).click();
    await expect(dialog.getByText("The end date is before the start date.")).toBeVisible();
    await dialog.getByLabel("End date").fill("2026-12-31");
    await dialog.getByRole("button", { name: "Add agreement" }).click();

    await expect(page.getByRole("heading", { name: "SOW 01 Typed in", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Budget" })).toContainText("€ 12,500.00");
    await expect(page.getByText("31 Dec 2026")).toBeVisible();
    await expect(page.getByRole("link", { name: "Forms MSA" })).toBeVisible();
    await expect(page.getByText("Fixed price")).toBeVisible();
  });
});

test.describe("A-1 add an agreement, changing vendor", () => {
  test("A-1 choosing another vendor forgets the MSA picked for the first one", async ({ page, context, request }) => {
    const first = await newVendor(request, "First");
    await newAgreement(request, first, { kind: "msa", title: "First MSA" });
    const second = await newVendor(request, "Second");
    await signInAs(context, MEMBER);
    await page.goto("/agreements");
    await page.getByRole("button", { name: "Add agreement" }).click();
    const dialog = page.getByRole("dialog", { name: "Add agreement" });
    await dialog.getByLabel("Vendor").selectOption({ label: first.name });
    await dialog.getByLabel("Kind").selectOption("sow");
    await dialog.getByLabel("Under MSA (optional)").selectOption({ label: "First MSA" });
    await dialog.getByLabel("Vendor").selectOption({ label: second.name });
    await expect(dialog.getByLabel("Under MSA (optional)")).toHaveValue("");
    await dialog.getByLabel("Title").fill("Second vendor SOW");
    await dialog.getByLabel("Pricing").selectOption("fixed");
    await dialog.getByLabel("Budget").fill("100");
    await dialog.getByLabel("Start date").fill("2026-06-01");
    await dialog.getByLabel("End date").fill("2026-12-31");
    await dialog.getByRole("button", { name: "Add agreement" }).click();
    await expect(page.getByRole("heading", { name: "Second vendor SOW", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: second.name }).first()).toBeVisible();
  });
});

test.describe("A-2 status", () => {
  test("A-2 active needs the signed date and ended needs a reason", async ({ page, context, request }) => {
    const v = await newVendor(request, "Status");
    const a = await newAgreement(request, v, { kind: "nda", title: "Status NDA" });
    await signInAs(context, MEMBER);
    await page.goto(`/agreements/${a.id}`);
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit or change status" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Status").selectOption("active");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog.getByText("An active agreement needs the date it was signed.")).toBeVisible();
    await dialog.getByLabel("Signed on").fill("2026-11-01");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    await expect(page.getByText("Changed: status from draft to active, signed on set to 1 Nov 2026")).toBeVisible();

    await page.getByRole("button", { name: "Edit or change status" }).click();
    await dialog.getByLabel("Status").selectOption("ended");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog.getByText("Say why it ended.")).toBeVisible();
    await dialog.getByLabel("Why it ended").selectOption("replaced");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Ended", { exact: true })).toBeVisible();
    await expect(page.getByText("Replaced", { exact: true })).toBeVisible();
  });
});

test.describe("A-3 agreement list", () => {
  test("A-3 lists, filters and sorts agreements, and exports the filtered list as CSV", async ({ page, context, request }) => {
    const v = await newVendor(request, "Listing");
    await newAgreement(request, v, { kind: "nda", title: "Listing NDA", status: "active", signedOn: "2026-01-05" });
    await newAgreement(request, v, { ...sub, title: "Listing licence" });
    await signInAs(context, MEMBER);
    await page.goto("/agreements");
    const table = page.getByRole("table", { name: "Agreements" });
    await page.getByLabel("Vendor", { exact: true }).selectOption({ label: v.name });
    await expect(table.getByRole("row")).toHaveCount(3);
    const licence = table.getByRole("row").filter({ hasText: "Listing licence" });
    for (const text of [v.name, "Subscription", "Active", "10 Feb 2027", "Alex Admin", "€ 48,000.00"]) await expect(licence).toContainText(text);
    await page.getByRole("button", { name: "End date" }).click();
    await expect(table.getByRole("row").nth(1)).toContainText("Listing licence");
    await page.getByLabel("Kind", { exact: true }).selectOption("nda");
    await expect(table.getByRole("row")).toHaveCount(2);
    await page.reload();
    await expect(page.getByLabel("Kind", { exact: true })).toHaveValue("nda");
    await expect(table.getByRole("row")).toHaveCount(2);

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export CSV" }).click()]);
    expect(download.suggestedFilename()).toBe("agreements-2026-11-21.csv");
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const lines = Buffer.concat(chunks).toString("utf8").trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"${v.name}","NDA","Listing NDA"`);
  });
});

test.describe("A-4 agreement page", () => {
  test("A-4 an MSA shows the SOWs underneath, and each links back to its MSA and vendor", async ({ page, context, request }) => {
    const v = await newVendor(request, "Page");
    const msa = await newAgreement(request, v, { kind: "msa", title: "Page MSA", status: "active", signedOn: "2026-01-01" });
    await newAgreement(request, v, {
      kind: "sow",
      title: "Page SOW",
      parentMsaId: msa.id,
      pricing: "time_and_materials",
      budgetMinor: 6_400_000,
      startDate: "2026-02-01",
      endDate: "2027-03-31",
    });
    await signInAs(context, MEMBER);
    await page.goto(`/agreements/${msa.id}`);
    await expect(page.getByText("No end date")).toBeVisible();
    await expect(page.getByText("Runs until someone ends it")).toBeVisible();
    const child = page.getByRole("link", { name: /Page SOW/ });
    await expect(child).toContainText("€ 64,000.00");
    await expect(child).toContainText("31 Mar 2027");
    await child.click();
    await expect(page.getByRole("heading", { name: "Page SOW", level: 1 })).toBeVisible();
    await expect(page.getByText("Time and materials")).toBeVisible();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole("link", { name: "Page MSA" }).click();
    await expect(page.getByRole("heading", { name: "Page MSA", level: 1 })).toBeVisible();
    await page.getByRole("link", { name: v.name }).click();
    await expect(page.getByRole("region", { name: v.name })).toBeVisible();
  });
});

test.describe("A-5 documents", () => {
  test("A-5 a document can be attached, downloaded and removed; other file types are refused", async ({ page, context, request }) => {
    const v = await newVendor(request, "Docs");
    const a = await newAgreement(request, v, { kind: "nda", title: "Docs NDA" });
    const pdf = Buffer.from("%PDF-1.4 invented test document");
    await signInAs(context, MEMBER);
    await page.goto(`/agreements/${a.id}`);
    const input = page.getByLabel("Choose a document to attach");
    await input.setInputFiles({ name: "Signed NDA.pdf", mimeType: "application/pdf", buffer: pdf });
    await expect(page.getByText("Attached Signed NDA.pdf")).toBeVisible();
    const link = page.getByRole("link", { name: "Signed NDA.pdf" });
    // A document carries the real moment it was attached, not the pinned "today" of the sample data: the day here is the day the test runs, in the team's time zone.
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", day: "numeric", month: "short", year: "numeric" }).formatToParts(new Date()).map((p) => [p.type, p.value]),
    );
    const attachedOn = `${parts.day} ${parts.month!.replace("Sept", "Sep")} ${parts.year}`;
    await expect(page.getByRole("listitem").filter({ has: link })).toContainText(`1 KB · added ${attachedOn} by mira@example.test`);

    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    const chunks: Buffer[] = [];
    for await (const c of await download.createReadStream()) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).equals(pdf)).toBe(true);

    await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.getByRole("alert")).toContainText("Only PDF, Word and Excel files can be attached.");
    await input.setInputFiles({ name: "pretend.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html>") });
    await expect(page.getByRole("alert")).toContainText("not a real PDF file");

    await page.getByRole("button", { name: "Remove Signed NDA.pdf" }).click();
    await expect(page.getByText("No documents attached.")).toBeVisible();
    await expect(page.getByText("document Signed NDA.pdf removed")).toBeVisible();
  });
});

test.describe("A-6 renewals", () => {
  test("A-6 lists subscriptions past or near their notice deadline, and a decision takes one off the list", async ({ page, context, request }) => {
    const v = await newVendor(request, "Renewals");
    const late = await newAgreement(request, v, { ...sub, title: "Late licence", renewalTermMonths: 12 });
    await newAgreement(request, v, { ...sub, title: "Soon licence", endDate: "2027-03-20" });
    await newAgreement(request, v, { ...sub, title: "Far licence", endDate: "2027-07-01" });
    await newAgreement(request, v, { kind: "msa", title: "Never here MSA", status: "active", signedOn: "2026-01-01" });
    await signInAs(context, MEMBER);
    await page.goto(`/agreements/${late.id}`);
    await expect(page.getByText("12 Nov 2026").first()).toBeVisible();
    await expect(page.getByText("The notice deadline passed on 12 Nov 2026 and no decision has been recorded.")).toBeVisible();

    await page.goto("/agreements/renewals");
    const list = page.getByRole("list", { name: "Renewals" });
    const lateRow = list.getByRole("listitem").filter({ hasText: "Late licence" });
    const soonRow = list.getByRole("listitem").filter({ hasText: "Soon licence" });
    await expect(lateRow).toContainText("Overdue");
    await expect(soonRow).toContainText("29 days");
    await expect(soonRow).toContainText("Notice deadline is 20 Dec 2026 · renews 20 Mar 2027");
    await expect(list).not.toContainText("Far licence");
    await expect(list).not.toContainText("Never here MSA");
    // Soonest first: everything overdue comes before anything merely due.
    const labels = await list.getByRole("listitem").evaluateAll((items) => items.map((i) => (i.textContent!.startsWith("Overdue") ? "overdue" : "due")));
    expect(labels.lastIndexOf("overdue")).toBeLessThan(labels.indexOf("due") === -1 ? Infinity : labels.indexOf("due"));

    await page.getByLabel("Notice deadline within").selectOption("180");
    await expect(list).toContainText("Far licence");
    await page.getByLabel("Notice deadline within").selectOption("30");
    await expect(list).toContainText("Soon licence");
    await page.getByLabel("Whose").selectOption("1");
    await expect(list.getByRole("listitem").filter({ hasText: "Late licence" })).toHaveCount(0);
    await page.getByLabel("Whose").selectOption("");

    await page.getByRole("button", { name: "Record decision for Late licence" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Move the renewal date to 10 Feb 2028")).toBeChecked();
    await dialog.getByLabel("Notes (optional)").fill("Agreed at the same price");
    await dialog.getByRole("button", { name: "Record decision" }).click();
    await expect(page.getByText("Decision recorded")).toBeVisible();
    await expect(list.getByRole("listitem").filter({ hasText: "Late licence" })).toHaveCount(0);

    await page.goto(`/agreements/${late.id}`);
    await expect(page.getByText("10 Feb 2028").first()).toBeVisible();
    await expect(page.getByText("Renew for the term ending 10 Feb 2027: Agreed at the same price")).toBeVisible();
    // The new term is far off: the page counts down to its deadline, as the renewals page would.
    await expect(page.getByText("356 days to the notice deadline")).toBeVisible();
    await expect(page.getByText("renewal decision for the term ending 10 Feb 2027 set to renew")).toBeVisible();
  });
});

test.describe("A-7 warnings", () => {
  test("A-7 the warnings page and the header count list what needs attention, each linked to its record", async ({ page, context, request }) => {
    const v = await newVendor(request, "Warned", { ndaRequired: true });
    await newAgreement(request, v, {
      kind: "sow",
      title: "Ending SOW",
      status: "active",
      signedOn: "2026-05-01",
      pricing: "fixed",
      budgetMinor: 100,
      startDate: "2026-05-01",
      endDate: "2026-12-05",
    });
    await newAgreement(request, v, { ...sub, title: "Warned licence" });
    await signInAs(context, MEMBER);
    await page.goto("/warnings");
    const total = await warningCount(request);
    await expect(page.getByTestId("warning-count")).toHaveText(String(total));
    await expect(page.getByRole("link", { name: `${total} warnings` })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${total} things need attention`);
    const list = page.getByRole("list", { name: "Warnings" });
    // The count covers the warnings and the risk flags (R-1), which have a list of their own on the same page.
    const flags = await page.getByRole("list", { name: "Risk flags" }).getByRole("listitem").count();
    expect(flags).toBeGreaterThan(0);
    await expect(list.getByRole("listitem")).toHaveCount(total - flags);
    await expect(list.getByRole("listitem").filter({ hasText: "Warned licence" })).toContainText("Overdue");
    await expect(list.getByRole("listitem").filter({ hasText: "Ending SOW" })).toContainText("Ends in 14 days");
    await expect(list.getByRole("listitem").filter({ hasText: "Ending SOW" })).toContainText("It ends on 5 Dec 2026.");
    const nda = list.getByRole("listitem").filter({ hasText: "No NDA is in place." }).filter({ hasText: v.name });
    await expect(nda).toContainText("NDA missing");
    await expectAccessible(page);

    await list.getByRole("link").filter({ hasText: "Ending SOW" }).click();
    await expect(page.getByRole("heading", { name: "Ending SOW", level: 1 })).toBeVisible();
    await page.goBack();
    await nda.getByRole("link").click();
    await expect(page.getByRole("region", { name: v.name })).toBeVisible();

    // Dealing with the cause removes the warning and lowers the count.
    await newAgreement(request, v, { kind: "nda", title: "Now signed", status: "active", signedOn: "2026-11-20" });
    await page.goto("/");
    await expect(page.getByTestId("warning-count")).toHaveText(String(total - 1));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`${total - 1} things could use a decision.`);
  });
});

test.describe("V-5 import columns", () => {
  test("V-5 the import template has the address and VAT or tax number columns, all optional, by the vendor form's rules", async ({ page, context, request }) => {
    const tag = Date.now().toString(36);
    const holder = await newVendor(request, "Import VAT holder", { vatNumber: `NL${tag.toUpperCase()}B01` });
    await signInAs(context, ADMIN);
    await page.goto("/admin/import");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download the template" }).click()]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(await download.path());
    const vendors = wb.getWorksheet("Vendors")!;
    const header = (vendors.getRow(1).values as string[]).slice(1);
    for (const c of ["Street", "Second street line", "Postal code", "City", "Country", "VAT or tax number"]) expect(header).toContain(c);
    const at = (name: string) => header.indexOf(name);
    const row = (name: string, cells: Record<string, string>) => {
      const r: string[] = header.map(() => "");
      r[at("Name")] = name;
      r[at("Type")] = "software";
      for (const [k, v] of Object.entries(cells)) r[at(k)] = v;
      return r;
    };
    vendors.spliceRows(2, 1);
    vendors.addRow(row(`Addressed import ${tag}`, { Street: "Testplein 1", "Postal code": "1000 AA", City: "Amsterdam", Country: "nl", "VAT or tax number": "nl 111.222.333 b01" }));
    vendors.addRow(row(`Bare import ${tag}`, {}));
    vendors.addRow(row(`Taken import ${tag}`, { "VAT or tax number": holder.vatNumber!.toLowerCase() }));
    wb.getWorksheet("Agreements")!.spliceRows(2, 1);
    const file = { name: "filled.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
    await page.getByLabel("Choose the filled-in template").setInputFiles(file);
    const rows = page.getByRole("table", { name: "Rows in the file" }).getByRole("row");
    await expect(rows.filter({ hasText: `Taken import ${tag}` })).toContainText(`VAT or tax number: ${holder.name} already has this number.`);
    await expect(page.getByText("2 rows can be imported.")).toBeVisible();
  });
});

test.describe("A-8 import", () => {
  test("A-8 an admin fills the template, previews what each row would do, imports, and can import again without duplicates", async ({ page, context }) => {
    const tag = Date.now().toString(36);
    await signInAs(context, ADMIN);
    await page.goto("/admin/import");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download the template" }).click()]);
    expect(download.suggestedFilename()).toBe("vendorapp-import-template.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(await download.path());
    const vendors = wb.getWorksheet("Vendors")!;
    vendors.spliceRows(2, 1);
    vendors.addRow([`Imported ${tag}`, "consultancy"]);
    vendors.addRow([`Broken ${tag}`, "hardware"]);
    vendors.addRow(["Bluefinch Systems", "software"]);
    const agreements = wb.getWorksheet("Agreements")!;
    agreements.spliceRows(2, 1);
    agreements.addRow([`Imported ${tag}`, "MSA", "Imported MSA", "", "active", "", "", "2026-03-01"]);
    agreements.addRow([`Imported ${tag}`, "SOW", "Imported SOW", "", "", "", "", "", "01-04-2026", "31-12-2026", "Imported MSA", "fixed", "64.000,00"]);
    agreements.addRow([`Imported ${tag}`, "SOW", "Bad SOW", "", "", "", "", "", "2026-04-01", "31-02-2026", "", "fixed", "lots"]);
    const file = { name: "filled.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await wb.xlsx.writeBuffer()) };

    const input = page.getByLabel("Choose the filled-in template");
    await input.setInputFiles(file);
    await expect(page.getByText("3 rows can be imported.")).toBeVisible();
    await expect(page.getByText("1 row already in the app, 2 rows with problems.")).toBeVisible();
    const rows = page.getByRole("table", { name: "Rows in the file" }).getByRole("row");
    await expect(rows.filter({ hasText: `Broken ${tag}` })).toContainText("Has problems");
    await expect(rows.filter({ hasText: "Bluefinch Systems" })).toContainText("Already there");
    await expect(rows.filter({ hasText: "Bad SOW" })).toContainText('End date: "31-02-2026" is not a date.');
    await expect(rows.filter({ hasText: "Bad SOW" })).toContainText('Budget: "lots" is not an amount with at most two decimals.');
    await expect(rows.filter({ hasText: `Broken ${tag}` })).toContainText("Type: use software, consultancy or advisory.");
    await expectAccessible(page);

    // Nothing is saved by the preview.
    await page.goto(`/vendors?q=Imported+${tag}`);
    await expect(page.getByRole("heading", { name: "No vendors match these filters" })).toBeVisible();

    await page.goto("/admin/import");
    await page.getByLabel("Choose the filled-in template").setInputFiles(file);
    await page.getByRole("button", { name: "Import 3 rows" }).click();
    await expect(page.getByRole("heading", { name: "Imported 3 rows" })).toBeVisible();
    await page.goto(`/vendors?q=Imported+${tag}`);
    await page.getByRole("button", { name: `Open Imported ${tag}` }).click();
    const panel = page.getByRole("region", { name: `Imported ${tag}` });
    await panel.getByRole("tab", { name: "Agreements (2)" }).click();
    await expect(panel.getByRole("link").nth(1)).toContainText("Imported SOW");
    await expect(panel.getByRole("link").nth(1)).toContainText("€ 64,000.00");
    await expect(panel.getByRole("link").nth(1)).toContainText("Ends 31 Dec 2026");

    await page.goto("/admin/import");
    await page.getByLabel("Choose the filled-in template").setInputFiles(file);
    await expect(page.getByText("0 rows can be imported.")).toBeVisible();
    await expect(page.getByText("4 rows already in the app, 2 rows with problems.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Import 0 rows" })).toHaveAttribute("aria-disabled", "true");
  });

  test("A-8 members have no import page", async ({ page, context }) => {
    await signInAs(context, MEMBER);
    await page.goto("/admin/import");
    await expect(page.getByRole("heading", { name: "That page does not exist" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Import" })).toHaveCount(0);
  });
});

test.describe("throughout M1", () => {
  test("X-1 the new pages and the form pass automated accessibility checks in light and dark", async ({ page, context }) => {
    await signInAs(context, ADMIN);
    for (const mode of ["light", "dark"]) {
      await page.addInitScript((m) => localStorage.setItem("mode", m), mode);
      for (const path of ["/", "/vendors", "/agreements", "/agreements/renewals", "/warnings", "/admin/import"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        if (path === "/vendors") await page.getByRole("button", { name: "Open Bluefinch Systems" }).click();
        await expectAccessible(page);
      }
      await page.goto("/agreements");
      await page.getByRole("button", { name: "Add agreement" }).click();
      await page.getByRole("dialog").getByLabel("Kind").selectOption("subscription");
      await page.getByRole("dialog").getByRole("button", { name: "Add agreement" }).click();
      await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
      await expectAccessible(page);
    }
  });

  test("X-1 a form can be filled and closed with the keyboard, and focus returns to where it started", async ({ page, context }) => {
    await signInAs(context, MEMBER);
    await page.goto("/vendors");
    const add = page.getByRole("button", { name: "Add vendor" });
    await add.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add vendor" });
    await expect(dialog.getByLabel("Name", { exact: true })).toBeFocused();
    await page.keyboard.type("Keyboard Vendor");
    // Tab stays inside the dialog.
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      // Focus may pass through the browser's own toolbar, but never lands on the page behind the dialog.
      expect(await page.evaluate(() => document.activeElement === document.body || !!document.activeElement?.closest("dialog"))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
  });

  test("X-2 an empty list says what belongs there and offers the first action", async ({ page, context }) => {
    await signInAs(context, MEMBER);
    // The shared test database is never empty, so the empty answer is supplied here; the screen is the real one.
    await page.route(/\/api\/(vendors|agreements)\?/, (route) => route.fulfill({ json: { items: [], total: 0 } }));
    await page.goto("/vendors");
    await expect(page.getByRole("heading", { name: "No vendors yet" })).toBeVisible();
    await expect(page.getByText("Every software vendor, consultancy and advisory firm the team works with belongs here")).toBeVisible();
    await page.getByRole("button", { name: "Add the first vendor" }).click();
    await expect(page.getByRole("dialog", { name: "Add vendor" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto("/agreements");
    await expect(page.getByRole("heading", { name: "No agreements yet" })).toBeVisible();
    await page.getByRole("button", { name: "Add the first agreement" }).click();
    await expect(page.getByRole("dialog", { name: "Add agreement" })).toBeVisible();
    await page.unroute(/\/api\/(vendors|agreements)\?/);

    await page.goto("/vendors?q=zzzz-nothing-matches");
    await expect(page.getByRole("heading", { name: "No vendors match these filters" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add the first vendor" })).toHaveCount(0);
    await page.goto("/agreements?q=zzzz-nothing-matches");
    await expect(page.getByRole("heading", { name: "No agreements match these filters" })).toBeVisible();
  });

  test("X-4 dates are shown as day month year on every M1 page", async ({ page, context, request }) => {
    const v = await newVendor(request, "Dates", { ndaRequired: true, dpaRequired: true });
    const a = await newAgreement(request, v, { ...sub, title: "Dated licence" });
    await newAgreement(request, v, { kind: "dpa", title: "Dated DPA", status: "active", signedOn: "2025-03-04", endDate: "2026-10-05" });
    await signInAs(context, MEMBER);
    const pages = [`/agreements/${a.id}`, `/vendors?open=${v.id}`, "/agreements", "/agreements/renewals", "/warnings", "/"];
    for (const path of pages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (path.startsWith("/vendors")) await page.getByRole("tab", { name: /Agreements/ }).click();
      await page.waitForTimeout(500);
      const text = await page.locator("main").innerText();
      // No date written the database's way (2026-11-12) or with slashes anywhere a person reads.
      expect(text.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/g) ?? [], path).toEqual([]);
    }
    await page.goto(`/agreements/${a.id}`);
    for (const shown of ["1 Feb 2026", "10 Feb 2026", "10 Feb 2027", "12 Nov 2026"]) await expect(page.getByText(shown).first()).toBeVisible();
    await page.goto("/warnings");
    await expect(page.getByRole("listitem").filter({ hasText: v.name }).filter({ hasText: "Data processing agreement expired on 5 Oct 2026." })).toBeVisible();
  });

  test("X-5 every M1 page is ready within 2 seconds", async ({ page, context }) => {
    await signInAs(context, MEMBER);
    await page.goto("/");
    for (const [path, ready] of [
      ["/vendors", page.getByRole("table", { name: "Vendors" })],
      ["/agreements", page.getByRole("table", { name: "Agreements" })],
      ["/agreements/renewals", page.getByRole("list", { name: "Renewals" })],
      ["/warnings", page.getByRole("list", { name: "Warnings" })],
    ] as const) {
      const started = Date.now();
      await page.goto(path);
      await expect(ready.getByRole(path.includes("renewals") || path === "/warnings" ? "listitem" : "row").first()).toBeVisible();
      expect(Date.now() - started, path).toBeLessThan(2000);
    }
  });
});
