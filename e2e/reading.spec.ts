import { expect, test, type APIRequestContext } from "@playwright/test";
import { attachPdf, expectAccessible, MEMBER, newAgreement, newVendor, signInAs } from "./helpers";

/** E-1 in the browser, with the stand-in AI. Every test brings its own vendor, subscription and document. */

const orderForm = [
  "Order form (invented sample)",
  "Subscription: Forecasting tool",
  "This order form was signed on 4 January 2027.",
  "The subscription starts on 1 February 2027.",
  "It renews on 31 January 2028 unless cancelled.",
  "The annual fee is € 26,500.00, invoiced yearly in advance.",
  "Either party may cancel by giving 45 days' written notice.",
];
async function setUp(request: APIRequestContext, lines = orderForm) {
  const vendor = await newVendor(request, "Reading vendor");
  const a = await newAgreement(request, vendor, { kind: "subscription", status: "draft", endDate: "2027-06-30", annualValueMinor: 20_000_00, noticePeriodDays: 90 });
  const doc = await attachPdf(request, a.id, "Forecasting order form (invented).pdf", lines);
  return { a, doc };
}
const aiMode = (request: APIRequestContext, mode: string) => request.post("/api/dev/ai", { data: { mode } });

test.describe("E-1 contract reading", () => {
  test.beforeEach(async ({ context }) => signInAs(context, MEMBER));

  test("E-1 M-8 an amount in US dollars is offered with its currency; one in a currency not on the list is left out and named", async ({ page, request }) => {
    const { a, doc } = await setUp(request, ["Order form (invented sample)", "Subscription: Forecasting tool", "The annual fee is USD 9,000.00, invoiced yearly in advance."]);
    await page.goto(`/agreements/${a.id}`);
    await page.getByRole("button", { name: `Read with AI: ${doc.fileName}` }).click();
    const panel = page.getByRole("group", { name: `AI reading of ${doc.fileName}` });
    const row = (field: string) => panel.getByRole("row").filter({ has: page.getByRole("rowheader", { name: field, exact: true }) });
    await expect(row("Annual value")).toContainText("$ 9,000.00");
    await expect(row("Currency")).toContainText("US dollar (USD)");

    const francs = await attachPdf(request, a.id, "Francs order form (invented).pdf", ["Order form (invented sample)", "The annual fee is CHF 12,000.00, invoiced yearly."]);
    await page.reload();
    await page.getByRole("button", { name: `Read with AI: ${francs.fileName}` }).click();
    const other = page.getByRole("group", { name: `AI reading of ${francs.fileName}` });
    await expect(other).toContainText("The amount is in CHF, which is not on the app's list of currencies, so it was left out. An admin can add it in Settings.");
    await expectAccessible(page);
  });

  test("E-1 the AI proposes values with their passages; only the ticked ones are saved, and only when confirmed", async ({ page, request }) => {
    const { a, doc } = await setUp(request);
    await page.goto(`/agreements/${a.id}`);
    await expect(page.getByRole("region", { name: "Read from the documents" })).toHaveCount(0);
    await page.getByRole("button", { name: `Read with AI: ${doc.fileName}` }).click();

    const panel = page.getByRole("group", { name: `AI reading of ${doc.fileName}` });
    await expect(panel).toBeVisible();
    await expect(panel).toBeFocused();
    await expect(panel.getByText("AI proposal")).toBeVisible();
    await expect(panel).toContainText("Read by the AI on 21 Nov 2026");
    await expect(panel).toContainText("Not reviewed yet");
    const row = (field: string) => panel.getByRole("row", { name: new RegExp(`^(Use )?.*${field}`) }).filter({ has: page.getByRole("rowheader", { name: field, exact: true }) });
    await expect(row("Annual value")).toContainText("€ 20,000.00");
    await expect(row("Annual value")).toContainText("€ 26,500.00");
    await expect(row("Annual value")).toContainText("“The annual fee is € 26,500.00, invoiced yearly in advance.”");
    await expect(row("Annual value")).toContainText("page 1");
    await expect(row("Renews on")).toContainText("31 Jan 2028");
    await expect(row("Starts")).toContainText("“The subscription starts on 1 February 2027.”");
    await expect(row("Kind")).toContainText("The same");
    await expect(row("Kind").getByRole("checkbox")).toHaveCount(0);
    // Everything that differs starts ticked.
    for (const field of ["Title", "Signed on", "Starts", "Renews on", "Notice period", "Annual value"]) await expect(row(field).getByRole("checkbox")).toBeChecked();

    // Nothing has changed on the agreement so far, also after a reload.
    await page.reload();
    await expect(page.getByText("€ 20,000.00").first()).toBeVisible();
    await expect(panel).toBeVisible();

    // Take the fee and the notice period, leave the rest.
    for (const field of ["Title", "Signed on", "Starts", "Renews on"]) await row(field).getByRole("checkbox").uncheck();
    await panel.getByRole("button", { name: "Use the ticked values" }).click();
    await expect(page.getByText("The agreement was updated from the document")).toBeVisible();
    await expect(panel).toContainText("Accepted with changes by mira@example.test");
    await expect(panel.getByRole("button", { name: "Use the ticked values" })).toHaveCount(0);
    // The facts at the top of the page now read as the document does; what was left out stayed.
    await expect(page.getByText("€ 26,500.00").first()).toBeVisible();
    await expect(page.getByText("45 days before renewal")).toBeVisible();
    await expect(page.getByText("30 Jun 2027").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: a.title, level: 1 })).toBeVisible();
    // The history says what happened.
    await expect(page.getByText(`AI reading of ${doc.fileName}`).first()).toBeVisible();
    // What the AI read can still be looked at.
    await panel.getByText("What it read").click();
    await expect(panel.getByRole("row", { name: /Annual value/ })).toContainText("The same");
    await expect(panel.getByRole("row", { name: /Renews on/ })).toContainText("Differs");
    await expect(panel.getByRole("checkbox")).toHaveCount(0);
  });

  test("E-1 rejecting changes nothing, and the AI can be asked to read again", async ({ page, request }) => {
    const { a, doc } = await setUp(request);
    await page.goto(`/agreements/${a.id}`);
    await page.getByRole("button", { name: `Read with AI: ${doc.fileName}` }).click();
    const panel = page.getByRole("group", { name: `AI reading of ${doc.fileName}` });
    await panel.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByText("The reading was rejected; nothing was changed")).toBeVisible();
    await expect(panel).toContainText("Rejected by mira@example.test");
    await expect(page.getByText("€ 20,000.00").first()).toBeVisible();
    await expect(page.getByText("90 days before renewal")).toBeVisible();
    await panel.getByRole("button", { name: "Read again" }).click();
    await expect(panel).toContainText("Not reviewed yet");
    await expect(panel.getByRole("button", { name: "Use the ticked values" })).toBeVisible();
    // With nothing ticked there is nothing to use, and the page says so.
    for (const box of await panel.getByRole("checkbox").all()) await box.uncheck();
    await expect(panel).toContainText("Tick at least one value to use.");
    await expect(panel.getByRole("button", { name: "Use the ticked values" })).toBeDisabled();
    await expect(panel).toContainText("Not reviewed yet");
  });

  test("E-1 X-3 values the agreement cannot take are refused in place, and the ticks stay", async ({ page, request }) => {
    // The document renews before the start date the agreement already holds.
    const vendor = await newVendor(request, "Reading vendor");
    const a = await newAgreement(request, vendor, {
      kind: "subscription",
      status: "draft",
      startDate: "2027-09-01",
      endDate: "2028-08-31",
      annualValueMinor: 20_000_00,
      noticePeriodDays: 90,
    });
    const doc = await attachPdf(request, a.id, "Odd order form (invented).pdf", [
      "Order form",
      "It renews on 1 March 2027 unless cancelled.",
      "Either party may cancel by giving 45 days' written notice.",
    ]);
    await page.goto(`/agreements/${a.id}`);
    await page.getByRole("button", { name: `Read with AI: ${doc.fileName}` }).click();
    const panel = page.getByRole("group", { name: `AI reading of ${doc.fileName}` });
    await panel.getByRole("button", { name: "Use the ticked values" }).click();
    await expect(panel.getByRole("alert")).toContainText("These values cannot be used as they are: The end date is before the start date. Nothing was changed.");
    await expect(page.getByText("90 days before renewal")).toBeVisible();
    await expect(panel.getByRole("checkbox", { name: /Use Notice period/ })).toBeChecked();
    await panel.getByRole("checkbox", { name: /Use Renews on/ }).uncheck();
    await panel.getByRole("button", { name: "Use the ticked values" }).click();
    await expect(page.getByText("45 days before renewal")).toBeVisible();
  });

  test("AI-2 when the AI cannot read the document the page says so and the agreement can still be edited by hand", async ({ page, request }) => {
    const { a, doc } = await setUp(request);
    await page.goto(`/agreements/${a.id}`);
    try {
      await aiMode(request, "unavailable");
      await page.getByRole("button", { name: `Read with AI: ${doc.fileName}` }).click();
      await expect(page.getByRole("alert")).toContainText(
        "The AI could not read this document just now. Nothing was changed, and everything on this page can still be done by hand.",
      );
      await expect(page.getByRole("group", { name: `AI reading of ${doc.fileName}` })).toHaveCount(0);
      await page.getByRole("button", { name: "Edit or change status" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await aiMode(request, "working");
      await page.getByRole("button", { name: `Read with AI: ${doc.fileName}` }).click();
      await expect(page.getByRole("group", { name: `AI reading of ${doc.fileName}` })).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
    } finally {
      await aiMode(request, "working");
    }
  });

  test("E-1 what the document does not say is named, and a field this kind of agreement does not have is shown as not applying", async ({ page, request }) => {
    const vendor = await newVendor(request, "Reading vendor");
    const msa = await newAgreement(request, vendor, { kind: "msa", status: "draft" });
    const doc = await attachPdf(request, msa.id, "Framework terms (invented).pdf", [
      "Master services agreement",
      "It was signed on 4 January 2027.",
      "Either party may end it by giving 60 days' written notice.",
      "Longer engagements need 3 months' notice.",
    ]);
    await page.goto(`/agreements/${msa.id}`);
    await page.getByRole("button", { name: `Read with AI: ${doc.fileName}` }).click();
    const panel = page.getByRole("group", { name: `AI reading of ${doc.fileName}` });
    const notice = panel.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Notice period", exact: true }) });
    await expect(notice).toContainText("60 days");
    await expect(notice).toContainText("A notice period does not apply to this kind of agreement.");
    await expect(notice.getByRole("checkbox")).toHaveCount(0);
    await expect(panel.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Kind", exact: true }) })).toContainText("The same");
    await expect(panel).toContainText("The document does not say: title, start date, end or renewal date, value or budget, currency.");
    // The one value that can be used is the signing date.
    await expect(panel.getByRole("checkbox")).toHaveCount(1);
    await panel.getByRole("button", { name: "Use the ticked values" }).click();
    await expect(panel).toContainText("Accepted by mira@example.test");
    await expect(page.getByText("4 Jan 2027").first()).toBeVisible();
    await expect(page.getByText("accepted: signed on taken from the document").first()).toBeVisible();
  });

  test("E-1 a document without readable text offers no reading and says why", async ({ page, request }) => {
    const { a } = await setUp(request, [""]);
    await page.goto(`/agreements/${a.id}`);
    await expect(page.getByText("no readable text, so it cannot be searched or read by the AI")).toBeVisible();
    await expect(page.getByRole("button", { name: /Read with AI/ })).toHaveCount(0);
  });

  test("X-1 X-4 X-5 a reading works with the keyboard alone, passes the accessibility check in light and dark, and is ready within 2 seconds", async ({ page, request }) => {
    const { a, doc } = await setUp(request);
    const started = Date.now();
    await page.goto(`/agreements/${a.id}`);
    const ask = page.getByRole("button", { name: `Read with AI: ${doc.fileName}` });
    await expect(ask).toBeVisible();
    expect(Date.now() - started).toBeLessThan(2000);
    await ask.focus();
    const asked = Date.now();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("group", { name: `AI reading of ${doc.fileName}` });
    await expect(panel).toBeFocused();
    expect(Date.now() - asked).toBeLessThan(2000);
    // From the panel, Tab reaches the first tick box; Space unticks it.
    await page.keyboard.press("Tab");
    const first = panel.getByRole("checkbox").first();
    await expect(first).toBeFocused();
    await page.keyboard.press("Space");
    await expect(first).not.toBeChecked();
    await expect(panel).toContainText("4 Jan 2027");
    await expect(panel).not.toContainText("2027-01-04");
    await expectAccessible(page);
    await page.getByRole("button", { name: "Switch between light and dark" }).click();
    await expectAccessible(page);
    await page.getByRole("button", { name: "Switch between light and dark" }).click();
    // Confirm with the keyboard: on to the button, Enter.
    await panel.getByRole("button", { name: "Use the ticked values" }).focus();
    await page.keyboard.press("Enter");
    await expect(panel).toContainText("Accepted with changes");
    await expectAccessible(page);
  });
});
