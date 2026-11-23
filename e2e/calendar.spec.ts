import { expect, test } from "@playwright/test";
import { expectAccessible, MEMBER, newAgreement, newVendor, signInAs } from "./helpers";

const sub = { kind: "subscription", annualValueMinor: 1_200_000, startDate: "2026-02-10", signedOn: "2026-02-01", status: "active" };

test.describe("A-9 renewal calendar", () => {
  test("A-9 shows notice deadlines and renewal dates for the year ahead and by month, filtered, and downloads them", async ({ page, context, request }) => {
    const v = await newVendor(request, "Calendar");
    const soon = await newAgreement(request, v, { ...sub, title: "Calendar licence", endDate: "2027-03-20", noticePeriodDays: 90 });
    await newAgreement(request, v, { ...sub, title: "Calendar overdue", endDate: "2027-01-10", noticePeriodDays: 90 });
    await newAgreement(request, v, { kind: "msa", title: "Calendar MSA", status: "active", signedOn: "2026-01-01" });
    await signInAs(context, MEMBER);
    await page.goto("/agreements");
    await page.getByRole("navigation", { name: "Agreement views" }).getByRole("link", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/\/agreements\/calendar$/);
    await page.getByLabel("Vendor").selectOption({ label: v.name });

    const dec = page.getByRole("list", { name: "December 2026" });
    await expect(dec.getByRole("listitem").filter({ hasText: "Calendar licence" })).toContainText("20 Dec 2026");
    await expect(dec.getByRole("listitem").filter({ hasText: "Calendar licence" })).toContainText("It renews on 20 Mar 2027.");
    await expect(page.getByRole("list", { name: "March 2027" }).getByRole("listitem").filter({ hasText: "Calendar licence" })).toContainText("Renews");
    // The deadline passed on 12 Oct 2026 with no decision: shown at the top, marked overdue.
    const passed = page.getByRole("list", { name: "Passed without a decision" });
    await expect(passed.getByRole("listitem").filter({ hasText: "Calendar overdue" })).toContainText("Overdue");
    await expect(page.getByText("Calendar MSA")).toHaveCount(0);
    await expectAccessible(page);

    // Filters survive a reload.
    await page.getByLabel("Kind of date").selectOption("renewal");
    await page.reload();
    await expect(page.getByLabel("Kind of date")).toHaveValue("renewal");
    await expect(page.getByLabel("Vendor")).toHaveValue(v.id);
    await expect(page.getByRole("list", { name: "December 2026" })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "March 2027" })).toContainText("Calendar licence");

    // The download holds what is shown, with the filters.
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download for Outlook" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^renewal-calendar-\d{4}-\d{2}-\d{2}\.ics$/);
    const text = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(text).toContain("SUMMARY:Renewal date: ");
    expect(text).not.toContain("VALARM");

    // A month, paged forwards: the notice deadline sits on its day and links to the subscription.
    await page.getByLabel("Kind of date").selectOption("");
    await page.getByRole("button", { name: "Month", exact: true }).click();
    await page.getByRole("button", { name: "Next month" }).click();
    const grid = page.getByRole("table", { name: "December 2026" });
    await expect(grid).toBeVisible();
    await expectAccessible(page);
    // A-9: the chip names the kind of date, the vendor and the subscription.
    const chip = grid.getByRole("link", { name: new RegExp(`^Notice deadline ?: ${v.name} · Calendar licence$`) });
    await expect(chip).toContainText("Calendar licence");
    await chip.click();
    await expect(page).toHaveURL(new RegExp(`/agreements/${soon.id}$`));
    await page.goBack();
    await expect(page.getByRole("table", { name: "December 2026" })).toBeVisible();
    const [monthFile] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download for Outlook" }).click()]);
    const monthText = await (await monthFile.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
    expect(monthText.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(monthText).toContain("DTSTART;VALUE=DATE:20261220");
    expect(monthText).toContain("TRIGGER:-P90D");
  });

  test("A-9 a recorded decision takes the notice deadline off the calendar", async ({ page, context, request }) => {
    const v = await newVendor(request, "Calendar decided");
    const a = await newAgreement(request, v, { ...sub, title: "Decided licence", endDate: "2027-02-01" });
    await signInAs(context, MEMBER);
    await page.goto(`/agreements/calendar?vendorId=${v.id}`);
    await expect(page.getByRole("listitem").filter({ hasText: "Decided licence" })).toHaveCount(2);
    const res = await request.post(`http://127.0.0.1:4173/api/agreements/${a.id}/decisions`, { headers: { "x-dev-user": MEMBER, cookie: "" }, data: { decision: "renew", decidedOn: "2026-11-20" } });
    expect(res.ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole("listitem").filter({ hasText: "Decided licence" })).toHaveCount(1);
    await expect(page.getByRole("listitem").filter({ hasText: "Decided licence" })).toContainText("Renews");
  });
});
