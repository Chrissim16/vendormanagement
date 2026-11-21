import { expect, test } from "@playwright/test";
import { ADMIN, expectAccessible, MEMBER, newAgreement, newVendor, signInAs } from "./helpers";

test.describe("V-1 vendor list", () => {
  test("V-1 shows name, type, status, owner, active agreements and warnings, and hides offboarded vendors", async ({ page, context, request }) => {
    const gone = await newVendor(request, "Offboarded", { status: "offboarded" });
    const v = await newVendor(request, "Listed", { type: "consultancy", ndaRequired: true });
    await newAgreement(request, v, { kind: "msa", title: "Listed MSA", status: "active", signedOn: "2026-01-01" });
    await newAgreement(request, v, { kind: "dpa", title: "Listed DPA", status: "active", signedOn: "2026-01-01" });
    await newAgreement(request, v, { kind: "nda", title: "Listed draft NDA" });
    await signInAs(context, MEMBER);
    await page.goto(`/vendors?q=${encodeURIComponent(v.name)}`);
    const table = page.getByRole("table", { name: "Vendors" });
    const row = table.getByRole("row").filter({ hasText: v.name });
    await expect(row).toContainText("Consultancy");
    await expect(row).toContainText("Alex Admin");
    await expect(row).toContainText("Active");
    await expect(row.getByRole("cell").nth(3)).toHaveText("2");
    await expect(row).toContainText("1 warning");
    await page.goto(`/vendors?q=${encodeURIComponent(gone.name)}`);
    await expect(page.getByRole("heading", { name: "No vendors match these filters" })).toBeVisible();
    await page.getByLabel("Status", { exact: true }).selectOption("offboarded");
    await expect(table).toContainText(gone.name);
  });

  test("V-1 can be searched, filtered and sorted, and the view survives a reload", async ({ page, context }) => {
    await signInAs(context, MEMBER);
    await page.goto("/vendors");
    const table = page.getByRole("table", { name: "Vendors" });
    await page.getByLabel("Search").fill("quillon");
    await expect(table.getByRole("row")).toHaveCount(2);
    await page.getByLabel("Search").fill("");
    await page.getByLabel("Type", { exact: true }).selectOption("advisory");
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(table).toContainText("Emberline Advisory");
    await page.getByLabel("Type", { exact: true }).selectOption("");
    await page.getByLabel("Owner", { exact: true }).selectOption({ label: "Sanne de Wit" });
    await page.getByRole("button", { name: "Vendor", exact: true }).click();
    await expect(page).toHaveURL(/dir=desc/);
    await expect(table.getByRole("row").nth(1)).toContainText("Quillon Consulting");
    await page.reload();
    await expect(page.getByLabel("Owner", { exact: true })).not.toHaveValue("");
    await expect(table.getByRole("row").nth(1)).toContainText("Quillon Consulting");
    await expect(table).not.toContainText("Bluefinch Systems");
  });
});

test.describe("V-2 add and edit a vendor", () => {
  test("V-2 a member can add a vendor; missing fields are pointed out and X-3 nothing typed is lost", async ({ page, context }) => {
    const name = `Added Vendor ${Date.now()}`;
    await signInAs(context, MEMBER);
    await page.goto("/vendors");
    await page.getByRole("button", { name: "Add vendor" }).click();
    const dialog = page.getByRole("dialog", { name: "Add vendor" });
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    await dialog.getByLabel("Website (optional)").fill("not a link");
    await dialog.getByRole("button", { name: "Add vendor" }).click();
    await expect(dialog.getByText("Choose a type.")).toBeVisible();
    await expect(dialog.getByText("Enter a web address starting with https://")).toBeVisible();
    await expect(dialog.getByRole("alert")).toContainText("not valid");
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(name);
    await expect(dialog.getByLabel("Website (optional)")).toHaveValue("not a link");

    await dialog.getByLabel("Type").selectOption("consultancy");
    await dialog.getByLabel("Website (optional)").fill("https://added.example.test");
    await dialog.getByLabel("A data processing agreement is required").uncheck();
    await dialog.getByRole("button", { name: "Add vendor" }).click();
    await expect(page.getByText(`Added ${name}`)).toBeVisible();
    const panel = page.getByRole("region", { name });
    await expect(panel).toContainText("Consultancy · owned by Mira Okafor");
    await expect(panel.getByRole("definition").filter({ hasText: "Missing" })).toHaveCount(1);
    await expect(panel).toContainText("Not required");
  });

  test("V-2 a second vendor with the same name is refused with a clear message", async ({ page, context, request }) => {
    const existing = await newVendor(request, "Duplicate");
    await signInAs(context, MEMBER);
    await page.goto("/vendors");
    await page.getByRole("button", { name: "Add vendor" }).click();
    const dialog = page.getByRole("dialog", { name: "Add vendor" });
    await dialog.getByLabel("Name", { exact: true }).fill(`  ${existing.name.toUpperCase()} `);
    await dialog.getByLabel("Type").selectOption("software");
    await dialog.getByRole("button", { name: "Add vendor" }).click();
    await expect(dialog.getByText("A vendor with this name already exists.")).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});

test.describe("V-3 vendor page", () => {
  test("V-3 shows details, contacts with one primary, agreements grouped by kind, and paperwork status", async ({ page, context, request }) => {
    const v = await newVendor(request, "Panel", { ndaRequired: true, dpaRequired: true });
    const msa = await newAgreement(request, v, { kind: "msa", title: "The MSA", status: "active", signedOn: "2026-01-01" });
    await newAgreement(request, v, {
      kind: "sow",
      title: "SOW under it",
      parentMsaId: msa.id,
      pricing: "fixed",
      budgetMinor: 1_250_000,
      startDate: "2026-02-01",
      endDate: "2027-06-30",
    });
    await newAgreement(request, v, { kind: "nda", title: "The NDA", status: "active", signedOn: "2026-01-01" });
    await signInAs(context, MEMBER);
    await page.goto(`/vendors?open=${v.id}`);
    const panel = page.getByRole("region", { name: v.name });
    await expect(panel.getByRole("definition").filter({ hasText: "In place" })).toHaveCount(1);
    await expect(panel.getByRole("definition").filter({ hasText: "Missing" })).toHaveCount(1);
    // A data processing agreement past its valid-until date shows as expired, not missing.
    await newAgreement(request, v, { kind: "dpa", title: "Lapsed DPA", status: "active", signedOn: "2025-01-01", endDate: "2026-11-20" });
    await page.reload();
    await expect(panel.getByRole("definition").filter({ hasText: "Expired" })).toHaveCount(1);
    await expect(panel.getByRole("definition").filter({ hasText: "Missing" })).toHaveCount(0);

    await panel.getByRole("tab", { name: /Contacts/ }).click();
    await panel.getByRole("button", { name: "Add contact" }).click();
    let dialog = page.getByRole("dialog", { name: "Add contact" });
    await dialog.getByLabel("Name", { exact: true }).fill("Ada Vale");
    await dialog.getByLabel("Email (optional)").fill("ada@panel.example.test");
    await dialog.getByLabel("Primary contact").check();
    await dialog.getByRole("button", { name: "Add contact" }).click();
    await panel.getByRole("button", { name: "Add contact" }).click();
    dialog = page.getByRole("dialog", { name: "Add contact" });
    await dialog.getByLabel("Name", { exact: true }).fill("Bo Lind");
    await dialog.getByLabel("Primary contact").check();
    await dialog.getByRole("button", { name: "Add contact" }).click();
    await expect(panel.getByRole("tab", { name: "Contacts (2)" })).toBeVisible();
    await expect(panel.getByText("Primary", { exact: true })).toHaveCount(1);
    await expect(panel.getByRole("listitem").filter({ hasText: "Bo Lind" })).toContainText("Primary");
    await panel.getByRole("button", { name: "Edit Ada Vale" }).click();
    dialog = page.getByRole("dialog", { name: "Edit Ada Vale" });
    await dialog.getByLabel("Job title (optional)").fill("Finance lead");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(panel.getByRole("listitem").filter({ hasText: "Ada Vale" })).toContainText("Finance lead · ada@panel.example.test");
    await panel.getByRole("button", { name: "Remove Bo Lind" }).click();
    await expect(panel.getByRole("tab", { name: "Contacts (1)" })).toBeVisible();

    await panel.getByRole("tab", { name: /Agreements/ }).click();
    const rows = panel.getByRole("link");
    await expect(rows.nth(0)).toContainText("The MSA");
    await expect(rows.nth(1)).toContainText("SOW under it");
    await expect(rows.nth(1)).toContainText("€ 12,500.00");
    await expect(rows.nth(1)).toContainText("Ends 30 Jun 2027");
    await expect(panel.getByRole("link").filter({ hasText: "The NDA" })).toBeVisible();

    await panel.getByRole("tab", { name: "History" }).click();
    await expect(panel.getByText("contact Bo Lind removed")).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe("V-4 offboarding", () => {
  test("V-4 is refused while the vendor has an active agreement, naming the agreement", async ({ page, context, request }) => {
    const v = await newVendor(request, "Offboard");
    await newAgreement(request, v, { kind: "nda", title: "Still running NDA", status: "active", signedOn: "2026-01-01" });
    await signInAs(context, ADMIN);
    await page.goto(`/vendors?open=${v.id}`);
    await page.getByRole("region", { name: v.name }).getByRole("button", { name: "Edit vendor" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Status").selectOption("offboarded");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog.getByRole("alert")).toContainText("This vendor still has an active agreement: Still running NDA");
    await expect(dialog.getByLabel("Status")).toHaveValue("offboarded");
  });
});
