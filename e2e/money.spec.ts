import { expect, test } from "@playwright/test";
import { ADMIN, asAdminApi, expectAccessible, MEMBER, newAgreement, newInvoice, newVendor, signInAs } from "./helpers";

const sow = { kind: "sow", pricing: "fixed", budgetMinor: 100_000_00, startDate: "2026-04-01", endDate: "2026-12-31", status: "active", signedOn: "2026-03-20" };

test.describe("M-1 milestones", () => {
  test("M-1 a member adds, delivers and cancels milestones; late ones are marked; fixed-price amounts stay within the budget", async ({ page, context, request }) => {
    const v = await newVendor(request, "Milestones");
    const s = await newAgreement(request, v, { ...sow, title: "Milestone SOW" });
    await signInAs(context, MEMBER);
    await page.goto(`/agreements/${s.id}`);
    await expect(page.getByText("No milestones yet.")).toBeVisible();

    const add = async (title: string, due: string, amount: string) => {
      await page.getByRole("button", { name: "Add milestone" }).click();
      const dialog = page.getByRole("dialog", { name: "Add milestone" });
      await dialog.getByLabel("Milestone").fill(title);
      await dialog.getByLabel("Due date").fill(due);
      await dialog.getByLabel("Payment in EUR (optional)").fill(amount);
      await dialog.getByRole("button", { name: "Add milestone" }).click();
      return dialog;
    };
    await add("Design", "2026-06-30", "60.000,00");
    const list = page.getByRole("list", { name: "Milestones" });
    const design = list.getByRole("listitem").filter({ hasText: "Design" });
    await expect(design).toContainText("Due 30 Jun 2026");
    await expect(design).toContainText("€ 60,000.00");
    // Open and past its due date: 144 days late on 21 Nov 2026.
    await expect(design).toContainText("144 days late");

    const dialog = await add("Too much", "2026-12-01", "40000.01");
    await expect(dialog.getByText("With this amount the milestones add up to more than the SOW budget.")).toBeVisible();
    await expect(dialog.getByLabel("Milestone")).toHaveValue("Too much");
    await dialog.getByLabel("Payment in EUR (optional)").fill("40000");
    await expect(dialog.getByText("Read as € 40,000.00")).toBeVisible();
    await dialog.getByLabel("Milestone").fill("Build");
    await dialog.getByRole("button", { name: "Add milestone" }).click();
    const build = list.getByRole("listitem").filter({ hasText: "Build" });
    await expect(build).toContainText("Due 1 Dec 2026");
    await expect(build).not.toContainText("late");

    await page.getByRole("button", { name: "Mark Build delivered" }).click();
    await expect(build).toContainText("Delivered 21 Nov 2026, due 1 Dec 2026");
    await expect(page.getByRole("button", { name: "Mark Build delivered" })).toHaveCount(0);

    await page.getByRole("button", { name: "Edit Design" }).click();
    const edit = page.getByRole("dialog", { name: "Edit Design" });
    await edit.getByLabel("Status").selectOption("cancelled");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(design).toContainText("Cancelled");
    await expect(design).not.toContainText("late");
    await expect(page.getByText("milestone Design status from open to cancelled")).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe("M-2 change requests", () => {
  test("M-2 approving a change moves the budget and end date, and the SOW shows where it started and where it is now", async ({ page, context, request }) => {
    const v = await newVendor(request, "Changes");
    const s = await newAgreement(request, v, { ...sow, title: "Change SOW", budgetMinor: 210_000_00, endDate: "2026-11-30" });
    await signInAs(context, MEMBER);
    await page.goto(`/agreements/${s.id}`);
    await page.getByRole("button", { name: "Add change" }).click();
    const dialog = page.getByRole("dialog", { name: "Add change request" });
    await dialog.getByLabel("What changes").fill("Extra entity in scope");
    await dialog.getByRole("button", { name: "Add change request" }).click();
    await expect(dialog.getByText("Enter a budget change, a new end date, or both.")).toBeVisible();
    await dialog.getByLabel("By, in EUR (optional)").fill("30000");
    await expect(dialog.getByText("Read as + € 30,000.00")).toBeVisible();
    await dialog.getByLabel("New end date (optional)").fill("2027-02-28");
    await dialog.getByRole("button", { name: "Add change request" }).click();

    const row = page.getByRole("list", { name: "Change requests" }).getByRole("listitem").filter({ hasText: "Extra entity in scope" });
    await expect(row).toContainText("Proposed");
    await expect(row).toContainText("+ € 30,000.00 · end date to 28 Feb 2027");
    // Nothing has changed on the SOW yet.
    const budget = page.getByRole("region", { name: "Budget" });
    await expect(budget).toContainText("€ 210,000.00");
    await expect(page.getByText("30 Nov 2026").first()).toBeVisible();

    await page.getByRole("button", { name: "Approve Extra entity in scope" }).click();
    await expect(row).toContainText("Approved");
    await expect(budget).toContainText("€ 240,000.00");
    await expect(budget).toContainText("€ 210,000.00 originally");
    await expect(page.getByText("Started at € 210,000.00, ending 30 Nov 2026. Now € 240,000.00, ending 28 Feb 2027.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve Extra entity in scope" })).toHaveCount(0);
    // One history line says all three things; their order within the line is not fixed.
    const line = page.getByRole("listitem").filter({ hasText: "change request Extra entity in scope from proposed to approved" });
    await expect(line).toContainText("budget from 210,000.00 to 240,000.00");
    await expect(line).toContainText("end date from 30 Nov 2026 to 28 Feb 2027");

    // A rejected change leaves the SOW as it was.
    await page.getByRole("button", { name: "Add change" }).click();
    const second = page.getByRole("dialog", { name: "Add change request" });
    await second.getByLabel("What changes").fill("Shorter hypercare");
    await second.getByLabel("Budget goes").selectOption("less");
    await second.getByLabel("By, in EUR (optional)").fill("5000");
    await expect(second.getByText("Read as − € 5,000.00")).toBeVisible();
    await second.getByRole("button", { name: "Add change request" }).click();
    await page.getByRole("button", { name: "Reject Shorter hypercare" }).click();
    await expect(page.getByRole("list", { name: "Change requests" }).getByRole("listitem").filter({ hasText: "Shorter hypercare" })).toContainText("Rejected");
    await expect(budget).toContainText("€ 240,000.00");
  });
});

test.describe("M-3 consultants and rate cards", () => {
  test("M-3 a rate card per vendor, consultants named with a role from it, and each consultant's current day rate", async ({ page, context, request }) => {
    const v = await newVendor(request, "Rates");
    const s = await newAgreement(request, v, { ...sow, title: "Rates SOW", pricing: "time_and_materials" });
    await signInAs(context, MEMBER);
    await page.goto(`/agreements/${s.id}`);
    await expect(page.getByText("To name consultants, first add day rates for")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add consultant" })).toHaveCount(0);

    await page.goto(`/vendors?open=${v.id}`);
    const panel = page.getByRole("region", { name: v.name });
    await panel.getByRole("tab", { name: "Money" }).click();
    await expect(panel.getByText("No day rates yet.")).toBeVisible();
    const addRate = async (role: string, rate: string, from: string) => {
      await panel.getByRole("button", { name: "Add day rate" }).click();
      const dialog = page.getByRole("dialog", { name: "Add day rate" });
      await dialog.getByLabel("Role").fill(role);
      await dialog.getByLabel("Rate per day").fill(rate);
      await dialog.getByLabel("Applies from").fill(from);
      await dialog.getByRole("button", { name: "Add rate" }).click();
      return dialog;
    };
    await addRate("Lead architect", "1250", "2025-01-01");
    await addRate("Lead architect", "1.350,00", "2026-07-01");
    const rates = panel.getByRole("list", { name: "Day rates" }).getByRole("listitem");
    await expect(rates).toHaveCount(2);
    await expect(rates.filter({ hasText: "From 1 Jul 2026" })).toContainText("In force");
    await expect(rates.filter({ hasText: "From 1 Jul 2026" })).toContainText("€ 1,350.00 a day");
    await expect(rates.filter({ hasText: "From 1 Jan 2025" })).not.toContainText("In force");
    const dup = await addRate("lead architect", "1", "2026-07-01");
    await expect(dup.getByText("This role already has a rate starting on that date.")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto(`/agreements/${s.id}`);
    await page.getByRole("button", { name: "Add consultant" }).click();
    const dialog = page.getByRole("dialog", { name: "Add consultant" });
    await dialog.getByLabel("Name").fill("Alex Example");
    await dialog.getByRole("button", { name: "Add consultant" }).click();
    await expect(dialog.getByText("Choose a role from the rate card.")).toBeVisible();
    await dialog.getByLabel("Role on the rate card").selectOption("Lead architect");
    await dialog.getByRole("button", { name: "Add consultant" }).click();
    const person = page.getByRole("list", { name: "Consultants" }).getByRole("listitem").filter({ hasText: "Alex Example" });
    await expect(person).toContainText("Lead architect");
    await expect(person).toContainText("€ 1,350.00 a day");
    await page.getByRole("button", { name: "Remove Alex Example" }).click();
    await page.getByRole("button", { name: "Remove Alex Example" }).click();
    await expect(page.getByText("Nobody named yet.")).toBeVisible();
  });
});

test.describe("M-4 invoices and M-5 budget view", () => {
  test("M-4 an invoice is keyed in against a SOW and a milestone, and M-5 the budget keeps itself up to date", async ({ page, context, request }) => {
    const v = await newVendor(request, "Invoicing");
    const s = await newAgreement(request, v, { ...sow, title: "Invoiced SOW" });
    await asAdminApi(request, "post", `/agreements/${s.id}/milestones`, { title: "Phase one", dueDate: "2026-12-15", amountMinor: 79_000_00 });
    await signInAs(context, MEMBER);
    await page.goto(`/agreements/${s.id}`);
    const budget = page.getByRole("region", { name: "Budget" });
    await expect(budget).toContainText("0% invoiced");
    await expect(page.getByText("No invoices yet.")).toBeVisible();

    const add = async (number: string, amount: string, milestone?: string) => {
      await page.getByRole("button", { name: "Add invoice" }).click();
      const dialog = page.getByRole("dialog", { name: "Add invoice" });
      await dialog.getByLabel("Invoice number").fill(number);
      await dialog.getByLabel("Amount in EUR").fill(amount);
      if (milestone) await dialog.getByLabel("For milestone (optional)").selectOption({ label: milestone });
      await dialog.getByRole("button", { name: "Add invoice" }).click();
      return dialog;
    };
    const first = await add("INV-001", "seventy-nine");
    await expect(first.getByText("Enter an amount like 12,500.00.")).toBeVisible();
    await first.getByLabel("Amount in EUR").fill("79.000,00");
    await expect(first.getByText("Read as € 79,000.00")).toBeVisible();
    await first.getByLabel("For milestone (optional)").selectOption({ label: "Phase one" });
    await first.getByRole("button", { name: "Add invoice" }).click();

    const invoices = page.getByRole("list", { name: "Invoices" }).getByRole("listitem");
    await expect(invoices.filter({ hasText: "INV-001" })).toContainText("€ 79,000.00");
    await expect(invoices.filter({ hasText: "INV-001" })).toContainText("21 Nov 2026 · Phase one");
    await expect(page.getByRole("list", { name: "Milestones" })).toContainText("invoiced in full");
    await expect(budget).toContainText("79% invoiced");
    await expect(budget).toContainText("€ 21,000.00");
    await expect(budget).not.toContainText("Close to budget");

    // The same number again for this vendor is refused, whatever its case.
    const dup = await add("inv-001", "1000");
    await expect(dup.getByText("This vendor already has an invoice with this number.")).toBeVisible();
    await dup.getByLabel("Invoice number").fill("INV-002");
    await dup.getByRole("button", { name: "Add invoice" }).click();
    await expect(budget).toContainText("80% invoiced");
    await expect(budget).toContainText("Close to budget");
    await page.goto("/warnings");
    const warning = page.getByRole("listitem").filter({ hasText: "Invoiced SOW" });
    await expect(warning).toContainText("80% of budget used");
    await expect(warning).toContainText("€ 80,000.00 of the € 100,000.00 budget has been invoiced.");

    // Past 100% it is an overrun.
    await newInvoice(request, s.id, { amountMinor: 20_000_01 });
    await warning.getByRole("link").click();
    await expect(budget).toContainText("Over budget");
    await expect(budget).toContainText("Over budget by");
    await expect(budget).toContainText("€ 0.01");

    await page.getByRole("button", { name: "Edit invoice INV-002" }).click();
    const edit = page.getByRole("dialog", { name: "Edit invoice INV-002" });
    await edit.getByLabel("Amount in EUR").fill("500");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(invoices.filter({ hasText: "INV-002" })).toContainText("€ 500.00");
    await page.getByRole("button", { name: "Remove invoice INV-002" }).click();
    await page.getByRole("button", { name: "Remove invoice INV-002" }).click();
    await expect(invoices.filter({ hasText: "INV-002" })).toHaveCount(0);
    await expectAccessible(page);
  });

  test("M-4 an invoice against a subscription takes the subscription's currency", async ({ page, context, request }) => {
    const v = await newVendor(request, "Pounds");
    const s = await newAgreement(request, v, {
      kind: "subscription",
      title: "Pound licence",
      currency: "GBP",
      annualValueMinor: 31_500_00,
      startDate: "2026-01-01",
      endDate: "2027-12-31",
      status: "active",
      signedOn: "2026-01-01",
      autoRenews: false,
    });
    await signInAs(context, MEMBER);
    await page.goto("/money/invoices");
    await page.getByRole("button", { name: "Add invoice" }).click();
    const dialog = page.getByRole("dialog", { name: "Add invoice" });
    await dialog.getByRole("button", { name: "Add invoice" }).click();
    await expect(dialog.getByText("Choose the SOW or subscription this invoice is for.")).toBeVisible();
    await dialog.getByLabel("SOW or subscription").selectOption({ label: `${v.name} · Pound licence` });
    await expect(dialog.getByLabel("Amount in GBP")).toBeVisible();
    await dialog.getByLabel("Invoice number").fill("GB-1");
    await dialog.getByLabel("Amount in GBP").fill("31,500.00");
    await dialog.getByRole("button", { name: "Add invoice" }).click();
    await expect(page.getByText("Added invoice GB-1")).toBeVisible();
    await page.goto(`/agreements/${s.id}`);
    await expect(page.getByText("Invoiced so far")).toBeVisible();
    await expect(page.getByText("£ 31,500.00").first()).toBeVisible();
  });
});

test.describe("M-6 spend overview and M-7 exchange rate", () => {
  test("M-6 spend per vendor and month in each currency with a converted total, and M-7 the admin's rate changes only that total", async ({ page, context, request }) => {
    // A period nobody else uses, so the figures are this test's own.
    const a = await newVendor(request, "Spend Euro");
    const b = await newVendor(request, "Spend Pound");
    const sa = await newAgreement(request, a, { ...sow, title: "Euro SOW", pricing: "time_and_materials" });
    const sb = await newAgreement(request, b, { ...sow, title: "Pound SOW", pricing: "time_and_materials", currency: "GBP" });
    await newInvoice(request, sa.id, { invoiceDate: "2019-01-15", amountMinor: 100_00 });
    await newInvoice(request, sa.id, { invoiceDate: "2019-02-01", amountMinor: 50_00 });
    await newInvoice(request, sb.id, { invoiceDate: "2019-02-28", amountMinor: 200_00 });
    const rate = (gbpToEurE4: number) => asAdminApi(request, "put", "/admin/settings", { gbpToEurE4, noticeDays: 90, sowEndDays: 30, budgetWarningPct: 80 });
    await rate(11700);
    try {
      await signInAs(context, MEMBER);
      await page.goto("/money?period=custom&from=2019-01-01&to=2019-03-31");
      await expect(page.getByText("1 Jan 2019 to 31 Mar 2019")).toBeVisible();
      const totals = page.getByRole("definition");
      await expect(totals.filter({ hasText: "€ 150.00" }).first()).toBeVisible();
      await expect(page.getByText("£ 200.00").first()).toBeVisible();
      await expect(page.getByText("€ 384.00").first()).toBeVisible();
      await expect(page.getByText("Pounds converted at 1.17")).toBeVisible();

      const vendors = page.getByRole("list", { name: "Spend per vendor" }).getByRole("listitem");
      await expect(vendors).toHaveCount(2);
      await expect(vendors.nth(0)).toContainText(b.name);
      await expect(vendors.nth(0)).toContainText("£ 200.00");
      await expect(vendors.nth(0)).toContainText("€ 234.00 in euros");
      await expect(vendors.nth(1)).toContainText(a.name);
      await expect(vendors.nth(1)).toContainText("€ 150.00");
      const months = page.getByRole("table", { name: "Spend per month" }).getByRole("row");
      await expect(months).toHaveCount(3);
      await expect(months.nth(1)).toContainText("Feb 2019");
      await expect(months.nth(1)).toContainText("€ 50.00");
      await expect(months.nth(1)).toContainText("£ 200.00");
      await expect(months.nth(1)).toContainText("€ 284.00");
      await expect(months.nth(2)).toContainText("Jan 2019");
      await expectAccessible(page);

      // From a vendor's bar to that vendor's invoices for the same period, and out to a file.
      await vendors.nth(1).getByRole("link").click();
      await expect(page.getByRole("heading", { name: "Invoices", level: 1 })).toBeVisible();
      await expect(page.getByText("2 invoices, € 150.00")).toBeVisible();
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export CSV" }).click()]);
      expect(download.suggestedFilename()).toBe("invoices-2026-11-21.csv");
      const chunks: Buffer[] = [];
      for await (const c of await download.createReadStream()) chunks.push(c as Buffer);
      const lines = Buffer.concat(chunks).toString("utf8").trim().split("\r\n");
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain(`"${a.name}","Euro SOW","",`);
      expect(lines[1]).toContain('"2019-02-01","50.00","EUR"');

      // M-7: a member has no settings page; the admin changes the rate there.
      await page.goto("/admin/settings");
      await expect(page.getByRole("heading", { name: "That page does not exist" })).toBeVisible();
      await signInAs(context, ADMIN);
      await page.goto("/admin/settings");
      const box = page.getByLabel("One pound in euros");
      await expect(box).toHaveValue("1.17");
      await box.fill("one point two");
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByText("Enter a rate like 1.17, with at most four decimals.")).toBeVisible();
      await box.fill("1,20");
      await expect(page.getByText("£ 1,000.00 counts as € 1,200.00")).toBeVisible();
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByText("Settings saved")).toBeVisible();
      await expect(page.getByText("Changed: pound to euro rate from 1.17 to 1.20")).toBeVisible();

      await page.goto("/money?period=custom&from=2019-01-01&to=2019-03-31");
      await expect(page.getByText("€ 390.00").first()).toBeVisible();
      await expect(page.getByText("Pounds converted at 1.20")).toBeVisible();
      // The amounts themselves are untouched.
      await expect(page.getByText("€ 150.00").first()).toBeVisible();
      await expect(page.getByText("£ 200.00").first()).toBeVisible();
    } finally {
      await rate(11700);
    }
  });

  test("M-7 the admin's warning thresholds decide what appears on the warnings page, and M-5 an overrun shows there", async ({ page, context, request }) => {
    const v = await newVendor(request, "Thresholds");
    const half = await newAgreement(request, v, { ...sow, title: "Half used SOW", pricing: "time_and_materials", endDate: "2027-12-31" });
    const over = await newAgreement(request, v, { ...sow, title: "Overrun SOW", pricing: "time_and_materials", endDate: "2027-12-31" });
    await newInvoice(request, half.id, { amountMinor: 55_000_00 });
    await newInvoice(request, over.id, { amountMinor: 100_000_01 });
    const settings = (budgetWarningPct: number) => asAdminApi(request, "put", "/admin/settings", { gbpToEurE4: 11700, noticeDays: 90, sowEndDays: 30, budgetWarningPct });
    try {
      await signInAs(context, MEMBER);
      await page.goto("/warnings");
      const warnings = page.getByRole("list", { name: "Warnings" });
      await expect(warnings.getByRole("listitem").filter({ hasText: "Overrun SOW" })).toContainText("Over budget");
      await expect(warnings.getByRole("listitem").filter({ hasText: "Half used SOW" })).toHaveCount(0);
      await settings(50);
      await page.reload();
      await expect(warnings.getByRole("listitem").filter({ hasText: "Half used SOW" })).toContainText("55% of budget used");
    } finally {
      await settings(80);
    }
    await page.reload();
    await expect(page.getByRole("list", { name: "Warnings" }).getByRole("listitem").filter({ hasText: "Overrun SOW" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Warnings" }).getByRole("listitem").filter({ hasText: "Half used SOW" })).toHaveCount(0);
  });

  test("M-6 the spend overview can be exported, and a period that ends before it starts says so", async ({ page, context }) => {
    await signInAs(context, MEMBER);
    await page.goto("/money?period=custom&from=2026-01-01&to=2026-11-21");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export CSV" }).click()]);
    expect(download.suggestedFilename()).toBe("spend-2026-01-01-to-2026-11-21.csv");
    await page.goto("/money?period=custom&from=2026-12-01&to=2026-01-01");
    await expect(page.getByText("The end of the period is before its start")).toBeVisible();
  });

  test("X-2 a period with no invoices says so and points to the invoices", async ({ page, context }) => {
    await signInAs(context, MEMBER);
    await page.goto("/money?period=custom&from=2001-01-01&to=2001-12-31");
    await expect(page.getByRole("heading", { name: "No invoices in this period" })).toBeVisible();
    await page.getByRole("link", { name: "Go to invoices" }).click();
    await expect(page.getByRole("heading", { name: "Invoices", level: 1 })).toBeVisible();
    await page.goto("/money/invoices?q=zzzz-nothing");
    await expect(page.getByRole("heading", { name: "No invoices match these filters" })).toBeVisible();
  });
});

test.describe("throughout M2", () => {
  test("X-1 the money pages and their forms pass automated accessibility checks in light and dark", async ({ page, context, request }) => {
    const v = await newVendor(request, "A11y");
    const s = await newAgreement(request, v, { ...sow, title: "A11y SOW" });
    await asAdminApi(request, "post", `/vendors/${v.id}/rate-card`, { role: "Analyst", dayRateMinor: 900_00, validFrom: "2026-01-01" });
    await asAdminApi(request, "post", `/agreements/${s.id}/milestones`, { title: "One", dueDate: "2026-06-30", amountMinor: 10_000_00 });
    await asAdminApi(request, "post", `/agreements/${s.id}/change-requests`, { title: "More", requestedOn: "2026-11-01", budgetChangeMinor: 1_000_00 });
    await asAdminApi(request, "post", `/agreements/${s.id}/consultants`, { name: "Alex Example", role: "Analyst" });
    await newInvoice(request, s.id, { amountMinor: 95_000_00 });
    await signInAs(context, ADMIN);
    for (const mode of ["light", "dark"]) {
      await page.addInitScript((m) => localStorage.setItem("mode", m), mode);
      for (const path of [`/agreements/${s.id}`, "/money", "/money/invoices", "/admin/settings"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectAccessible(page);
      }
      await page.goto(`/vendors?open=${v.id}`);
      await page.getByRole("tab", { name: "Money" }).click();
      await expectAccessible(page);
      await page.goto(`/agreements/${s.id}`);
      for (const [button, dialog] of [
        ["Add milestone", "Add milestone"],
        ["Add change", "Add change request"],
        ["Add invoice", "Add invoice"],
      ] as const) {
        await page.getByRole("button", { name: button, exact: true }).click();
        await page.getByRole("dialog", { name: dialog }).getByRole("button", { name: dialog, exact: true }).click();
        await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
        await expectAccessible(page);
        await page.keyboard.press("Escape");
      }
    }
  });

  test("X-4 dates on the money pages are day month year", async ({ page, context, request }) => {
    const v = await newVendor(request, "Money dates");
    const s = await newAgreement(request, v, { ...sow, title: "Dated SOW" });
    await asAdminApi(request, "post", `/vendors/${v.id}/rate-card`, { role: "Analyst", dayRateMinor: 900_00, validFrom: "2026-01-05" });
    await asAdminApi(request, "post", `/agreements/${s.id}/milestones`, { title: "One", dueDate: "2026-06-30", status: "delivered", deliveredOn: "2026-07-04" });
    await asAdminApi(request, "post", `/agreements/${s.id}/change-requests`, { title: "Longer", requestedOn: "2026-11-01", newEndDate: "2027-03-31" });
    await newInvoice(request, s.id, { invoiceDate: "2026-10-09" });
    await signInAs(context, MEMBER);
    for (const path of [`/agreements/${s.id}`, `/money/invoices?vendorId=${v.id}`, "/money", `/vendors?open=${v.id}`]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (path.startsWith("/vendors")) await page.getByRole("tab", { name: "Money" }).click();
      await page.waitForTimeout(500);
      const text = await page.locator("main").innerText();
      expect(text.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/g) ?? [], path).toEqual([]);
    }
    await page.goto(`/agreements/${s.id}`);
    for (const shown of ["Delivered 4 Jul 2026, due 30 Jun 2026", "end date to 31 Mar 2027", "9 Oct 2026"]) await expect(page.getByText(shown).first()).toBeVisible();
  });

  test("X-5 the money pages are ready within 2 seconds", async ({ page, context }) => {
    await signInAs(context, MEMBER);
    await page.goto("/");
    for (const [path, ready] of [
      ["/money", page.getByRole("list", { name: "Spend per vendor" }).getByRole("listitem").first()],
      ["/money/invoices", page.getByRole("table", { name: "Invoices" }).getByRole("row").nth(1)],
    ] as const) {
      const started = Date.now();
      await page.goto(path);
      await expect(ready).toBeVisible();
      expect(Date.now() - started, path).toBeLessThan(2000);
    }
  });
});
