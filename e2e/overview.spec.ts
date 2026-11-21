import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Briefing, Dashboard, ManagementReport } from "../shared/overview";
import type { Warning } from "../shared/vendors";
import { ADMIN, asAdminApi, expectAccessible, MEMBER, newAgreement, newInvoice, newVendor, signInAs } from "./helpers";

const BASE = "http://127.0.0.1:4173";
const asAdmin = { "x-dev-user": ADMIN, cookie: "" };
const getJson = async <T>(request: APIRequestContext, path: string) => (await (await request.get(`${BASE}/api${path}`, { headers: asAdmin })).json()) as T;
const aiMode = (request: APIRequestContext, mode: "working" | "unavailable" | "nonsense") => asAdminApi(request, "post", "/dev/ai", { mode });
const vendorId = async (request: APIRequestContext, name: string) =>
  (await getJson<{ items: { id: string; name: string }[] }>(request, "/vendors?status=all&pageSize=200")).items.find((v) => v.name === name)!.id;
/** A time and materials SOW that started 60 days before the pinned today and runs for 120, with 27,000 of 40,000 invoiced: heading over budget. */
const fastSow = async (request: APIRequestContext, label: string) => {
  const vendor = await newVendor(request, label, { type: "consultancy" });
  const sow = await newAgreement(request, vendor, {
    kind: "sow",
    pricing: "time_and_materials",
    status: "active",
    signedOn: "2026-09-20",
    startDate: "2026-09-22",
    endDate: "2027-01-20",
    budgetMinor: 40_000_00,
  });
  await newInvoice(request, sow.id, { amountMinor: 27_000_00, invoiceDate: "2026-11-10" });
  return { vendor, sow };
};

test.afterEach(async ({ request }) => {
  await aiMode(request, "working");
});

test.describe("R-1 risk flags", () => {
  test("R-1 the warnings page lists risk flags under their own heading, each with the facts behind it and a link to its record", async ({ page, context, request }) => {
    const { vendor, sow } = await fastSow(request, "Pace");
    await signInAs(context, MEMBER);
    await page.goto("/warnings");
    const flags = page.getByRole("list", { name: "Risk flags" });
    const mine = flags.getByRole("listitem").filter({ hasText: vendor.name });
    await expect(mine).toContainText("Heading over budget");
    await expect(mine).toContainText("€ 27,000.00 of the € 40,000.00 budget has been invoiced in 60 of 120 days.");
    await expect(mine).toContainText("At this pace the budget runs out around 20 Dec 2026, before the end date of 20 Jan 2027, and about € 54,000.00 would be invoiced by then.");
    // The sample data has one of each kind.
    await expect(flags.getByRole("listitem").filter({ hasText: "Quillon Consulting · SOW 02 Close process review" })).toContainText(
      "It ends on 9 Dec 2026, in 18 days, and one milestone is still open: Recommendations (due 1 Dec 2026).",
    );
    const worse = flags.getByRole("listitem").filter({ hasText: "Mossgate IT · SLA breaches" });
    await expect(worse).toContainText(/got worse three months in a row: [\d.]+% in Jul, [\d.]+% in Aug, [\d.]+% in Sep, [\d.]+% in October 2026\. The target is 5% or less\./);
    // A flag is not a warning: it is not in the list of warnings.
    await expect(page.getByRole("list", { name: "Warnings" }).getByRole("listitem").filter({ hasText: vendor.name })).toHaveCount(0);
    // The header count includes the flags.
    const total = (await getJson<Warning[]>(request, "/warnings")).length;
    await expect(page.getByRole("link", { name: `${total} warnings` })).toBeVisible();
    await expectAccessible(page);

    await worse.getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/performance/${await vendorId(request, "Mossgate IT")}`));
    await page.goBack();
    await page.getByRole("list", { name: "Risk flags" }).getByRole("listitem").filter({ hasText: vendor.name }).getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/agreements/${sow.id}`));
  });

  test("R-1 the list can be narrowed to one kind, and the choice survives a reload", async ({ page, context, request }) => {
    await fastSow(request, "Narrow");
    await signInAs(context, MEMBER);
    await page.goto("/warnings");
    await page.getByLabel("Show").selectOption("risk_budget_trend");
    await expect(page).toHaveURL(/type=risk_budget_trend/);
    await expect(page.getByRole("list", { name: "Warnings" })).toHaveCount(0);
    const rows = page.getByRole("list", { name: "Risk flags" }).getByRole("listitem");
    await expect(rows.first()).toContainText("Heading over budget");
    const n = await rows.count();
    for (let i = 0; i < n; i++) await expect(rows.nth(i)).toContainText("Heading over budget");
    await page.reload();
    await expect(page.getByLabel("Show")).toHaveValue("risk_budget_trend");
    await expect(page.getByRole("list", { name: "Risk flags" }).getByRole("listitem")).toHaveCount(n);
  });
});

test.describe("D-1 dashboard", () => {
  test("D-1 shows warnings and risk flags by kind, SOWs by budget used, spend, scores, scorecards due and open RFPs, each linked to its detail", async ({
    page,
    context,
    request,
  }) => {
    const { vendor, sow } = await fastSow(request, "Dash");
    const all = await getJson<Warning[]>(request, "/warnings");
    const d = await getJson<Dashboard>(request, "/dashboard");
    await signInAs(context, MEMBER);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`${all.length} things could use a decision.`);
    const flags = all.filter((w) => w.type.startsWith("risk_")).length;
    await expect(page.getByRole("link", { name: new RegExp(`^Warnings ${all.length - flags} deadlines`) })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(`^Risk flags ${flags} not wrong yet`) })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(`^Scorecards due ${d.due.length} still to finalise for Q3 2026`) })).toBeVisible();

    // By kind: the count of each kind, linked to the warnings page narrowed to it.
    const kinds = page.getByRole("list", { name: "Warnings and risk flags by kind" });
    const trend = all.filter((w) => w.type === "risk_budget_trend");
    const row = kinds.getByRole("listitem").filter({ hasText: "Heading over budget" });
    await expect(row).toContainText(String(trend.length));
    await expect(row).toContainText(vendor.name);
    await expect(kinds.getByRole("listitem").filter({ hasText: "Notice deadline passed" })).toContainText("Tarnwick Software");
    await expect(row.getByRole("link")).toHaveAttribute("href", "/warnings?type=risk_budget_trend");

    // SOWs by budget used, the most used first.
    const sows = page.getByRole("list", { name: "SOWs by budget used" }).getByRole("listitem");
    await expect(sows).toHaveCount(d.sows.length);
    await expect(sows.first()).toContainText(`${d.sows[0]!.vendorName} · ${d.sows[0]!.title}`);
    const mine = sows.filter({ hasText: vendor.name });
    await expect(mine).toContainText("€ 27,000.00 of € 40,000.00 invoiced");
    await expect(mine).toContainText("67% used");
    await expect(mine.getByRole("link")).toHaveAttribute("href", `/agreements/${sow.id}`);
    await expect(sows.filter({ hasText: "SOW 07 Ledger migration" })).toContainText("Close to budget");

    // Spend: twelve months, with the same figures in a table.
    const spend = page.getByRole("region", { name: "Spend, last 12 months" });
    await expect(spend.getByRole("img")).toHaveAttribute("aria-label", /Spend per month, December 2025 to November 2026/);
    await spend.getByText("Show the months").click();
    await expect(spend.getByRole("table", { name: "Spend per month" }).getByRole("row")).toHaveCount(13);
    await expect(spend.getByRole("link", { name: "Open spend" })).toHaveAttribute("href", "/money");

    // Scores with trend, and the scorecards still due.
    const scores = page.getByRole("list", { name: "Vendor scores" }).getByRole("listitem");
    await expect(scores).toHaveCount(d.scores.length);
    const moss = d.scores.find((s) => s.vendorName === "Mossgate IT")!;
    await expect(scores.filter({ hasText: "Mossgate IT" })).toContainText((moss.overallTenths / 10).toFixed(1));
    await expect(scores.filter({ hasText: "Mossgate IT" })).toContainText("First scorecard");
    await expect(scores.filter({ hasText: "Mossgate IT" }).getByRole("link")).toHaveAttribute("href", `/performance/scorecards/${moss.scorecardId}`);
    const due = page.getByRole("list", { name: "Scorecards due" }).getByRole("listitem");
    await expect(due).toHaveCount(d.due.length);
    await expect(due.filter({ hasText: "Sedgewater Cloud" })).toContainText("Not started");

    // Open RFPs: none until that part exists, and the section says so.
    await expect(page.getByRole("region", { name: "Open RFPs" })).toContainText("No RFP is open.");
    await expectAccessible(page);

    // A "not started" row opens the start dialog with the vendor chosen.
    await due.filter({ hasText: "Sedgewater Cloud" }).getByRole("link").click();
    const dialog = page.getByRole("dialog", { name: "Start a scorecard" });
    await expect(dialog.getByLabel("Vendor")).toHaveValue(await vendorId(request, "Sedgewater Cloud"));
    await page.keyboard.press("Escape");

    // The monthly report is one click from the dashboard.
    await page.goto("/");
    await page.getByRole("link", { name: "Monthly report" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Monthly report, October 2026");
  });

  test("D-1 a score that went down says so, with the score before", async ({ page, context, request }) => {
    // A vendor with two final scorecards, Q2 scored 4 throughout and Q3 scored 2.
    const vendor = await newVendor(request, "Slipping");
    for (const [quarter, score] of [
      ["2026-Q2", 4],
      ["2026-Q3", 2],
    ] as const) {
      const card = await (await asAdminApi(request, "post", "/scorecards", { vendorId: vendor.id, quarter })).json();
      for (const line of card.lines) expect((await asAdminApi(request, "put", `/scorecards/${card.id}`, { lines: [{ criterionId: line.criterionId, score }] })).ok()).toBe(true);
      expect((await asAdminApi(request, "post", `/scorecards/${card.id}/finalise`, {})).ok()).toBe(true);
    }
    await signInAs(context, MEMBER);
    await page.goto("/");
    const row = page.getByRole("list", { name: "Vendor scores" }).getByRole("listitem").filter({ hasText: vendor.name });
    await expect(row).toContainText("Q3 2026");
    await expect(row).toContainText("Down from 4.0");
    await expect(row).toContainText("2.0");
  });
});

test.describe("D-2 monthly management report", () => {
  test("D-2 shows the month's figures, takes a summary from the AI only when a person uses it, lets it be edited, and downloads as a PDF", async ({ page, context, request }) => {
    const r = await getJson<ManagementReport>(request, "/report?month=2026-10");
    await signInAs(context, MEMBER);
    await page.goto("/report");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Monthly report, October 2026");
    await expect(page.getByText("figures as at 31 Oct 2026")).toBeVisible();
    // The five sections.
    const budgets = page.getByRole("table", { name: "SOW budgets" });
    await expect(budgets.getByRole("row").filter({ hasText: "SOW 07 Ledger migration" })).toContainText("€ 240,000.00");
    await expect(budgets.getByRole("row").filter({ hasText: "SOW 07 Ledger migration" })).toContainText("€ 175,000.00");
    await expect(budgets.getByRole("row").filter({ hasText: "SOW 07 Ledger migration" })).toContainText("72%");
    await expect(page.getByRole("table", { name: "Agreements ending" }).getByRole("row").filter({ hasText: "SOW 02 Close process review" })).toContainText("9 Dec 2026");
    await expect(page.getByRole("table", { name: "Vendor scores" }).getByRole("row").filter({ hasText: "Mossgate IT" })).toContainText("/ 5");
    await expect(page.getByRole("table", { name: "Missed helpdesk targets" }).getByRole("row")).toHaveCount(r.data.missed.length + 1);
    await expect(page.getByRole("region", { name: "Open RFPs" })).toContainText("No RFP is open.");

    // AI-1: the AI's paragraph is a suggestion; the report's own summary stays empty.
    const ai = page.getByRole("region", { name: "AI summary" });
    await ai.getByRole("button", { name: "Ask the AI" }).click();
    await expect(ai.getByText("AI proposal", { exact: true })).toBeVisible();
    await expect(ai.getByText(/Written by the AI on \d+ \w+ \d{4}, \d\d:\d\d from this month's figures\./)).toBeVisible();
    await expect(ai.getByText("Not reviewed yet.", { exact: true })).toBeVisible();
    await expect(ai).toContainText("In October 2026,");
    const box = page.getByLabel("Summary printed at the top of the report");
    await expect(box).toHaveValue("");
    await expect(page.getByText("No summary yet: the PDF starts with the figures.")).toBeVisible();
    await expectAccessible(page);

    await ai.getByRole("button", { name: "Use this text" }).click();
    await expect(ai.getByText(/Accepted by mira@example\.test on /)).toBeVisible();
    await expect(box).toHaveValue(/^In October 2026,/);
    await expect(ai.getByRole("button", { name: "Use this text" })).toHaveCount(0);

    // Edited before export.
    await box.fill(`${await box.inputValue()} Checked by hand.`);
    await expect(page.getByText("Not saved yet. The PDF prints the saved summary.")).toBeVisible();
    await page.getByRole("button", { name: "Save summary" }).click();
    await expect(ai.getByText(/Accepted with changes by mira@example\.test on /)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Summary printed at the top of the report")).toHaveValue(/Checked by hand\.$/);

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download PDF" }).click()]);
    expect(download.suggestedFilename()).toBe("vendor-report-2026-10.pdf");
    const chunks: Buffer[] = [];
    for await (const c of await download.createReadStream()) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("D-2 another month can be chosen, and a summary can be written and saved without the AI when it cannot answer", async ({ page, context, request }) => {
    await signInAs(context, MEMBER);
    await page.goto("/report");
    await page.getByLabel("Month").selectOption("2026-04");
    await expect(page).toHaveURL(/month=2026-04/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Monthly report, April 2026");
    await expect(page.getByText("figures as at 30 Apr 2026")).toBeVisible();
    await expect(page.getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", "/api/report/pdf?month=2026-04");

    await aiMode(request, "unavailable");
    await page.getByRole("region", { name: "AI summary" }).getByRole("button", { name: "Ask the AI" }).click();
    await expect(page.getByRole("alert")).toContainText("The AI could not write a summary just now. Nothing was changed, and everything on this page can still be done by hand.");
    const box = page.getByLabel("Summary printed at the top of the report");
    await box.fill("April was quiet.");
    await page.getByRole("button", { name: "Save summary" }).click();
    await expect(page.getByText("Saved. This is what the PDF prints.")).toBeVisible();
    expect((await getJson<ManagementReport>(request, "/report?month=2026-04")).summary).toBe("April was quiet.");

    // X-3: a summary that is too long is refused and stays in the box.
    await box.fill("x".repeat(1501));
    await page.getByRole("button", { name: "Save summary" }).click();
    await expect(page.getByText("Keep the summary under 1500 characters.")).toBeVisible();
    await expect(box).toHaveValue("x".repeat(1501));

    // The running month says so.
    await page.getByLabel("Month").selectOption("2026-11");
    await expect(page.getByText("figures as at 21 Nov 2026, the month is still running")).toBeVisible();
  });
});

test.describe("B-1 vendor briefing", () => {
  test("B-1 a briefing is prepared from the vendor, shows the app's own figures, takes the AI's text only when used, and can be edited, saved and downloaded", async ({
    page,
    context,
    request,
  }) => {
    const blue = await vendorId(request, "Bluefinch Systems");
    await signInAs(context, MEMBER);
    await page.goto(`/vendors?open=${blue}`);
    await page.getByRole("tab", { name: "Briefings" }).click();
    await page.getByRole("button", { name: "Prepare a briefing" }).click();
    await expect(page).toHaveURL(/\/briefings\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Briefing, 21 Nov 2026");
    const id = page.url().split("/").pop()!;
    const b = await getJson<Briefing>(request, `/briefings/${id}`);

    // Every section, with figures that are the app's own.
    const budget = page.getByRole("table", { name: "Spend against budget" }).getByRole("row").filter({ hasText: "SOW 07 Ledger migration" });
    await expect(budget).toContainText("€ 240,000.00");
    await expect(budget).toContainText("€ 199,200.00");
    await expect(budget).toContainText("83%");
    await expect(page.getByRole("table", { name: "Agreements" }).getByRole("row")).toHaveCount(b.facts.agreements.length + 1);
    await expect(page.getByRole("table", { name: "Upcoming dates" }).getByRole("row").filter({ hasText: "Parallel run" })).toContainText("15 Jan 2027");
    await expect(page.getByRole("table", { name: "Helpdesk figures" }).getByRole("columnheader", { name: "October 2026" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Missed targets" }).getByRole("row")).toHaveCount(b.facts.missed.length + 1);
    await expect(page.getByRole("table", { name: "Open milestones" }).getByRole("row").filter({ hasText: "Go-live and handover" })).toContainText("28 Feb 2027");
    await expect(page.getByRole("table", { name: "Change requests" }).getByRole("row").filter({ hasText: "Extended hypercare" })).toContainText("+ € 12,000.00");
    await expect(page.getByRole("list", { name: "Warnings and risk flags" }).getByRole("listitem")).toHaveCount(b.facts.flags.length);
    await expect(page.getByRole("list", { name: "Warnings and risk flags" })).toContainText("€ 199,200.00 of the € 240,000.00 budget has been invoiced.");

    // AI-1: suggested, labelled, and not part of the briefing yet.
    const ai = page.getByRole("region", { name: "AI summary and talking points" });
    await expect(ai.getByText("AI proposal", { exact: true })).toBeVisible();
    await expect(ai.getByText("Not reviewed yet.", { exact: true })).toBeVisible();
    await expect(ai.getByRole("list", { name: "Suggested talking points" }).getByRole("listitem")).toHaveCount(b.suggestion!.output.talkingPoints.length);
    await expect(page.getByLabel("Summary", { exact: true })).toHaveValue("");
    await expect(page.getByText("Nothing written yet: the PDF holds the facts only.")).toBeVisible();
    await expectAccessible(page);

    await ai.getByRole("button", { name: "Use this text" }).click();
    await expect(ai.getByText(/Accepted by mira@example\.test on /)).toBeVisible();
    await expect(page.getByLabel("Summary", { exact: true })).toHaveValue(b.suggestion!.output.summary);
    const points = page.getByLabel("Talking points, one per line");
    await expect(points).toHaveValue(b.suggestion!.output.talkingPoints.join("\n"));

    // Edit and save.
    await points.fill(`${await points.inputValue()}\nAsk about cover over the holidays`);
    await page.getByRole("button", { name: "Save briefing" }).click();
    await expect(ai.getByText(/Accepted with changes by mira@example\.test on /)).toBeVisible();
    await expect(page.getByText(`${b.suggestion!.output.talkingPoints.length + 1} talking points saved.`)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Talking points, one per line")).toHaveValue(/Ask about cover over the holidays$/);

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download PDF" }).click()]);
    expect(download.suggestedFilename()).toBe("Bluefinch Systems briefing 2026-11-21.pdf");

    // It is listed on the vendor, and opens from there.
    await page.getByRole("link", { name: "Bluefinch Systems" }).first().click();
    const row = page.getByRole("list", { name: "Briefings" }).getByRole("listitem").first();
    await expect(row).toContainText("Briefing, 21 Nov 2026");
    await expect(row).toContainText("AI text accepted with changes");
  });

  test("B-1 when the AI cannot answer, the briefing is still made, says so, and its text can be typed; it can be removed", async ({ page, context, request }) => {
    const vendor = await newVendor(request, "Quiet");
    await aiMode(request, "unavailable");
    await signInAs(context, MEMBER);
    await page.goto(`/vendors?open=${vendor.id}&tab=briefings`);
    // X-2: the empty tab says what a briefing is and offers to prepare the first.
    await expect(page.getByRole("heading", { name: "No briefings yet" })).toBeVisible();
    await page.getByRole("button", { name: "Prepare a briefing" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Briefing, 21 Nov 2026");
    await expect(page.getByRole("alert")).toContainText("The AI could not write the summary and talking points just now.");
    // A vendor with nothing yet: every section explains itself.
    await expect(page.getByText("No agreement was running or being prepared.")).toBeVisible();
    await expect(page.getByText("This vendor had no active SOW with a budget.")).toBeVisible();
    await expect(page.getByText("This vendor has no Jira board, so there are no helpdesk figures.")).toBeVisible();
    await expectAccessible(page);

    await page.getByLabel("Summary", { exact: true }).fill("Written by hand, with an é and an apostrophe's worth of care.");
    await page.getByLabel("Talking points, one per line").fill("First point\nSecond point");
    await page.getByRole("button", { name: "Save briefing" }).click();
    await expect(page.getByText("2 talking points saved.")).toBeVisible();

    // Once the AI is back it can be asked from the page, and rejected.
    await aiMode(request, "working");
    const ai = page.getByRole("region", { name: "AI summary and talking points" });
    await ai.getByRole("button", { name: "Ask the AI" }).click();
    await expect(ai.getByText("Not reviewed yet.", { exact: true })).toBeVisible();
    await ai.getByRole("button", { name: "Reject" }).click();
    await expect(ai.getByText("Rejected by mira@example.test", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Summary", { exact: true })).toHaveValue(/^Written by hand/);

    // Remove asks once more, then leads back to the vendor's empty tab.
    await page.getByRole("button", { name: "Remove this briefing" }).click();
    await page.getByRole("button", { name: /Really remove\?/ }).click();
    await expect(page).toHaveURL(new RegExp(`/vendors\\?open=${vendor.id}&tab=briefings`));
    await expect(page.getByRole("heading", { name: "No briefings yet" })).toBeVisible();
  });

  test("X-1 the dashboard, the report and a briefing can be used with the keyboard alone", async ({ page, context, request }) => {
    await signInAs(context, MEMBER);
    await page.goto("/");
    const report = page.getByRole("link", { name: "Monthly report" });
    await report.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Monthly report");
    const box = page.getByLabel("Summary printed at the top of the report");
    await box.focus();
    await page.keyboard.type("Typed with the keyboard.");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Save summary" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Saved. This is what the PDF prints.")).toBeVisible();
    await asAdminApi(request, "put", "/report", { summary: "" });
  });
});
