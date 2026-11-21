import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { PerformanceOverview } from "../shared/performance";
import type { Criterion, ProposalState, ScorecardDetail } from "../shared/scorecards";
import { ADMIN, asAdminApi, expectAccessible, MEMBER, newAgreement, newVendor, signInAs } from "./helpers";

const BASE = "http://127.0.0.1:4173";
const asAdmin = { "x-dev-user": ADMIN, cookie: "" };
const getJson = async <T>(request: APIRequestContext, path: string) => (await (await request.get(`${BASE}/api${path}`, { headers: asAdmin })).json()) as T;
const sampleVendor = async (request: APIRequestContext, name: string) => (await getJson<PerformanceOverview>(request, "/performance")).rows.find((r) => r.vendorName === name)!;
const proposalOf = async (request: APIRequestContext, vendorId: string, month: string) =>
  (await getJson<ProposalState>(request, `/performance/vendors/${vendorId}/proposal?month=${month}`)).proposal;
const startCard = async (request: APIRequestContext, vendorId: string, quarter = "2026-Q3") => {
  const res = await asAdminApi(request, "post", "/scorecards", { vendorId, quarter });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as ScorecardDetail;
};
const aiMode = (request: APIRequestContext, mode: "working" | "unavailable" | "nonsense") => asAdminApi(request, "post", "/dev/ai", { mode });
const scoreButton = (page: Page, criterion: string, score: number) =>
  page.getByRole("group", { name: `Score for ${criterion}` }).getByRole("button", { name: String(score), exact: false });
const row = (page: Page, criterion: string) => page.getByRole("listitem", { name: criterion, exact: true });

test.afterEach(async ({ request }) => {
  await aiMode(request, "working");
});

test.describe("P-1 monthly proposal", () => {
  test("P-1 the AI proposes a score per measured criterion with its reason and the figures used, and names ticket themes with example tickets", async ({
    page,
    context,
    request,
  }) => {
    const tar = await sampleVendor(request, "Tarnwick Software");
    const p = (await proposalOf(request, tar.vendorId, "2026-10"))!;
    await signInAs(context, MEMBER);
    await page.goto(`/performance/${tar.vendorId}?month=2026-10`);
    const section = page.getByRole("region", { name: "AI proposal for October 2026" });
    // AI-1: labelled as AI-written, with when, and that nobody has reviewed it.
    await expect(section.getByText("AI proposal", { exact: true })).toBeVisible();
    await expect(section.getByText(/Written by the AI on \d+ \w+ \d{4}, \d\d:\d\d from \d+ tickets and the month's figures\./)).toBeVisible();
    await expect(section.getByText("Not reviewed yet.", { exact: true })).toBeVisible();
    for (const s of p.scores) {
      const item = section.getByRole("listitem", { name: s.criterionName, exact: true });
      await expect(item.getByRole("img", { name: `${s.criterionName}: ${s.score} out of 5, proposed by the AI, not accepted yet` })).toBeVisible();
      await expect(item.getByText(s.reason)).toBeVisible();
      await expect(item.getByRole("list", { name: `Figures used for ${s.criterionName}` }).getByRole("listitem")).toHaveCount(s.metrics.length);
    }
    expect(p.themes.length).toBeGreaterThan(0);
    const themes = section.getByRole("list", { name: "Ticket themes" }).getByRole("listitem");
    await expect(themes).toHaveCount(p.themes.length);
    await expect(themes.first()).toContainText(p.themes[0]!.title);
    await expect(themes.first()).toContainText(`${p.themes[0]!.tickets} tickets of the ${p.ticketsRead} read`);
    await expect(themes.first()).toContainText(p.themes[0]!.examples[0]!.key);
    await expectAccessible(page);

    // The running month has no proposal yet, and says why.
    await page.goto(`/performance/${tar.vendorId}`);
    await expect(page.getByRole("region", { name: "AI proposal for November 2026" }).getByText("A proposal is made once the month is over", { exact: false })).toBeVisible();
  });

  test("P-1 a month without a proposal offers to ask the AI for one", async ({ page, context, request }) => {
    const tar = await sampleVendor(request, "Tarnwick Software");
    await signInAs(context, MEMBER);
    await page.goto(`/performance/${tar.vendorId}?month=2026-06`);
    const section = page.getByRole("region", { name: "AI proposal for June 2026" });
    await expect(section.getByText("There is no proposal for this month yet.", { exact: false })).toBeVisible();
    await section.getByRole("button", { name: "Ask the AI for a proposal" }).click();
    await expect(section.getByText("Not reviewed yet.", { exact: true })).toBeVisible();
    await expect(section.getByRole("list", { name: "Proposed scores" }).locator(":scope > li")).toHaveCount(2);
    // It is in the vendor's history as written by the AI.
    await expect(page.getByText("AI proposal for June 2026 set to written by the AI", { exact: false })).toBeVisible();
  });
});

test.describe("AI-1 suggest and confirm", () => {
  test("AI-1 a proposal changes nothing until a person accepts it; accepting, changing and rejecting each show who decided and when", async ({ page, context, request }) => {
    const tar = await sampleVendor(request, "Tarnwick Software");
    const before = (await proposalOf(request, tar.vendorId, "2026-09"))!;
    const quality = before.scores[0]!;
    await signInAs(context, MEMBER);
    await page.goto(`/performance/${tar.vendorId}?month=2026-09`);
    const section = page.getByRole("region", { name: "AI proposal for September 2026" });
    await expect(section.getByRole("img", { name: new RegExp(`${quality.criterionName}: ${quality.score} out of 5, proposed by the AI`) })).toBeVisible();

    await section.getByRole("button", { name: "Accept proposal" }).click();
    await expect(section.getByText(/Accepted by mira@example\.test on 21 Nov 2026, \d\d:\d\d\./)).toBeVisible();
    await expect(section.getByRole("img", { name: `${quality.criterionName}: ${quality.score} out of 5, accepted` })).toBeVisible();
    await expect(section.getByRole("button", { name: "Accept proposal" })).toHaveCount(0);
    // Once a person has accepted it, the AI is not asked again over their head.
    await expect(section.getByRole("button", { name: "Ask again" })).toHaveCount(0);

    // Edit: the person's score replaces the AI's, which stays visible.
    const other = quality.aiScore === 5 ? 4 : quality.aiScore + 1;
    await section.getByRole("button", { name: "Change scores" }).click();
    const dialog = page.getByRole("dialog", { name: "Scores for September 2026" });
    await dialog
      .getByRole("group", { name: `Score for ${quality.criterionName}` })
      .getByRole("button", { name: String(other) })
      .click();
    await dialog.getByRole("button", { name: "Save scores" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(section.getByText(/Accepted with changes by mira@example\.test/)).toBeVisible();
    await expect(section.getByText(`the AI proposed ${quality.aiScore}, changed to ${other}`, { exact: false })).toBeVisible();

    await section.getByRole("button", { name: "Reject" }).click();
    await expect(section.getByText(/Rejected by mira@example\.test/)).toBeVisible();
    await page.reload();
    await expect(section.getByText(/Rejected by mira@example\.test/)).toBeVisible();
    await expect(page.getByText("AI proposal for September 2026 from accepted with changes to rejected", { exact: false })).toBeVisible();
  });
});

test.describe("AI-2 failure", () => {
  test("AI-2 when the AI is unavailable or answers nonsense the page says so, and the scorecard can still be completed by hand", async ({ page, context, request }) => {
    const tar = await sampleVendor(request, "Tarnwick Software");
    await signInAs(context, MEMBER);
    for (const mode of ["unavailable", "nonsense"] as const) {
      await aiMode(request, mode);
      await page.goto(`/performance/${tar.vendorId}?month=2026-05`);
      const section = page.getByRole("region", { name: "AI proposal for May 2026" });
      await section.getByRole("button", { name: "Ask the AI for a proposal" }).click();
      await expect(section.getByRole("alert")).toContainText(
        "The AI could not write a proposal just now. Nothing was changed, and everything on this page can still be done by hand.",
      );
      // The rest of the page is as it was: the figures are there and no proposal appeared.
      await expect(page.getByRole("list", { name: "Metrics for May 2026" })).toBeVisible();
      await expect(section.getByText("There is no proposal for this month yet.", { exact: false })).toBeVisible();
    }
    expect(await proposalOf(request, tar.vendorId, "2026-05")).toBeNull();

    // With the AI still down, a scorecard for the same helpdesk vendor is started, scored by hand and finalised.
    const card = await startCard(request, tar.vendorId, "2026-Q1");
    await page.goto(`/performance/scorecards/${card.id}`);
    await expect(page.getByRole("region", { name: "Criteria" }).getByRole("listitem")).toHaveCount(card.lines.length);
    for (const line of card.lines) await scoreButton(page, line.name, 3).click();
    await expect(page.getByRole("status")).toContainText(`All ${card.lines.length} scored.`);
    await page.getByRole("button", { name: "Finalise scorecard" }).click();
    await expect(page.getByText("Final", { exact: true })).toBeVisible();

    // Working again, the same button gives a proposal.
    await aiMode(request, "working");
    await page.goto(`/performance/${tar.vendorId}?month=2026-05`);
    await page.getByRole("button", { name: "Ask the AI for a proposal" }).click();
    await expect(page.getByRole("region", { name: "AI proposal for May 2026" }).getByText("Not reviewed yet.", { exact: true })).toBeVisible();
  });
});

test.describe("P-2 quarterly scorecard", () => {
  test("P-2 a member starts a scorecard; measured criteria come with the AI's suggestion, which counts only once accepted; comments and notes are kept", async ({
    page,
    context,
    request,
  }) => {
    const tar = await sampleVendor(request, "Tarnwick Software");
    // Q2: the AI has proposals for the months asked for in earlier tests, or none; make sure April has one.
    await asAdminApi(request, "post", `/performance/vendors/${tar.vendorId}/proposal`, { month: "2026-04" });
    const april = (await proposalOf(request, tar.vendorId, "2026-04"))!;
    await signInAs(context, MEMBER);
    await page.goto("/performance/scorecards");
    await page.getByRole("button", { name: "Start a scorecard" }).click();
    const dialog = page.getByRole("dialog", { name: "Start a scorecard" });
    // X-3: nothing chosen is refused in place.
    await dialog.getByLabel("Quarter").selectOption("2026-Q2");
    await dialog.getByRole("button", { name: "Start scorecard" }).click();
    await expect(dialog.getByText("Choose a vendor.")).toBeVisible();
    await expect(dialog.getByLabel("Quarter")).toHaveValue("2026-Q2");
    // P-5: a vendor that is not scored cannot be chosen.
    await expect(dialog.getByLabel("Vendor").locator("option", { hasText: "Emberline Advisory" })).toHaveCount(0);
    await dialog.getByLabel("Vendor").selectOption({ label: "Tarnwick Software" });
    await dialog.getByRole("button", { name: "Start scorecard" }).click();
    await expect(page.getByRole("heading", { name: "Quarterly scorecard" })).toBeVisible();
    await expect(page.getByText("Tarnwick Software · Q2 2026 · 1 Apr 2026 to 30 Jun 2026", { exact: false })).toBeVisible();
    await expect(page.getByText("Reviewer Mira Okafor.", { exact: false })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("5 of 5 still to score");
    await expect(page.getByLabel("Overall score –")).toBeVisible();

    // The suggestion is an outline, labelled as the AI's, with the evidence behind it.
    const quality = row(page, "Quality of delivery");
    const suggested = (await getJson<ScorecardDetail>(request, `/scorecards/${page.url().split("/").pop()}`)).lines[0]!.suggestion!;
    expect(suggested.months.map((m) => m.month)).toContain("2026-04");
    await expect(quality.getByText(`AI suggests ${suggested.score}`)).toBeVisible();
    await expect(quality.getByText(/Nobody has reviewed (it|them|\d of them) yet\./)).toBeVisible();
    await expect(scoreButton(page, "Quality of delivery", suggested.score)).toHaveAttribute("aria-pressed", "false");
    await expect(scoreButton(page, "Quality of delivery", suggested.score)).toHaveAccessibleName(`${suggested.score}, suggested by the AI`);
    await quality.getByRole("button", { name: "Show evidence" }).click();
    await expect(quality.getByRole("table", { name: "Figures for Quality of delivery" })).toContainText("First-line closure");
    await expect(quality.getByRole("list", { name: "Monthly proposals for Quality of delivery" })).toContainText(april.scores[0]!.reason);
    await expectAccessible(page);

    // Accepting makes it the score, with a short burst of small squares (design guide).
    await page.evaluate(() => {
      const w = window as unknown as { squares: number };
      w.squares = 0;
      new MutationObserver((list) => {
        for (const m of list)
          for (const node of m.addedNodes) if (node instanceof HTMLElement && node.style.position === "fixed" && node.getAttribute("aria-hidden") === "true") w.squares++;
      }).observe(document.body, { childList: true });
    });
    await quality.getByRole("button", { name: `Accept ${suggested.score}` }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { squares: number }).squares)).toBe(9);
    await expect(scoreButton(page, "Quality of delivery", suggested.score)).toHaveAttribute("aria-pressed", "true");
    await expect(quality.getByText("Accepted as it was.")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("4 of 5 still to score");

    // Timeliness: the reviewer chooses another score than the AI's.
    const timeliness = row(page, "Timeliness");
    const aiTimeliness = Number((await timeliness.getByText(/AI suggests \d/).innerText()).replace(/\D/g, ""));
    const own = aiTimeliness === 1 ? 2 : aiTimeliness - 1;
    await scoreButton(page, "Timeliness", own).click();
    await expect(timeliness.getByText(`AI suggested ${aiTimeliness}`)).toBeVisible();
    await expect(timeliness.getByText(`Not followed: the reviewer chose ${own}.`)).toBeVisible();

    // Manual criteria: score, a comment for the vendor and an internal note.
    await scoreButton(page, "Responsiveness and communication", 4).click();
    await page.getByLabel("Comment for the vendor on Responsiveness and communication").fill("Quick to answer, clear monthly report.");
    await page.getByLabel("Internal note on Responsiveness and communication").fill("Depends on one person. Ask who covers holidays.");
    await page.getByLabel("Summary for the vendor").fill("A good quarter overall.");
    await page.getByLabel("Summary for the vendor").blur();
    await expect(page.getByText("Responsiveness and communication: internal note set to Depends on one person.", { exact: false })).toBeVisible();
    await page.reload();
    await expect(scoreButton(page, "Responsiveness and communication", 4)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Comment for the vendor on Responsiveness and communication")).toHaveValue("Quick to answer, clear monthly report.");
    await expect(page.getByLabel("Internal note on Responsiveness and communication")).toHaveValue("Depends on one person. Ask who covers holidays.");
    await expect(page.getByLabel("Summary for the vendor")).toHaveValue("A good quarter overall.");
    await expect(row(page, "Quality of delivery").getByText("Accepted as it was.")).toBeVisible();
    // The facts that support scoring by hand are on the page.
    const facts = page.getByRole("region", { name: "Facts for this quarter" });
    await expect(facts.getByText("Budgets kept", { exact: false })).toBeVisible();
    await expect(facts.getByText("Milestones on time")).toBeVisible();
    await expect(facts.getByText(/NDA (in place|missing|expired|not required)/)).toBeVisible();
  });

  test("P-2 X-3 a comment that cannot be saved stays in its box and says so", async ({ page, context, request }) => {
    const v = await newVendor(request, "Unsaved");
    const card = await startCard(request, v.id);
    await signInAs(context, MEMBER);
    await page.goto(`/performance/scorecards/${card.id}`);
    await page.route("**/api/scorecards/*", (route) => (route.request().method() === "PUT" ? route.abort() : route.continue()));
    const box = page.getByLabel("Comment for the vendor on Value for money");
    await box.fill("Costs were as agreed.");
    await box.blur();
    await expect(page.getByText("This could not be saved. Your text is still here; click outside the box to try again.")).toBeVisible();
    await expect(box).toHaveValue("Costs were as agreed.");
    // A scorecard is not finalised over a text that was not saved.
    await page.unroute("**/api/scorecards/*");
    for (const line of card.lines) await scoreButton(page, line.name, 3).click();
    await expect(page.getByRole("status")).toContainText("A text on this page could not be saved");
    await expect(page.getByRole("button", { name: "Finalise scorecard" })).toBeDisabled();
    await page.unroute("**/api/scorecards/*");
    await box.focus();
    await box.blur();
    await expect(page.getByText("This could not be saved.", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Finalise scorecard" })).toBeEnabled();
    await page.reload();
    await expect(box).toHaveValue("Costs were as agreed.");
  });

  test("P-2 X-2 the list explains itself when nothing matches, and can be searched, filtered and sorted", async ({ page, context }) => {
    await signInAs(context, MEMBER);
    await page.goto("/performance/scorecards");
    const table = page.getByRole("table", { name: "Scorecards" });
    await expect(table.getByRole("button", { name: "Open Mossgate IT Q3 2026" })).toBeVisible();
    await expect(table.locator("tbody tr").filter({ hasText: "Mossgate IT" })).toContainText("Final");
    await expectAccessible(page);
    await page.getByLabel("Search by vendor").fill("no such vendor");
    await expect(page.getByRole("heading", { name: "No scorecards match" })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByRole("group", { name: "Status" }).getByRole("button", { name: "Final" }).click();
    await expect(table.locator("tbody tr").filter({ hasText: "Draft" })).toHaveCount(0);
    await expect(table.locator("tbody tr").filter({ hasText: "Quillon Consulting" })).toContainText("4.0");
    // Helpdesk and Scorecards are two views of Performance.
    await page.getByRole("navigation", { name: "Performance views" }).getByRole("link", { name: "Helpdesk" }).click();
    await expect(page).toHaveURL(/\/performance$/);
  });
});

test.describe("P-3 finalise", () => {
  test("P-3 finalising needs every criterion scored; a final scorecard is read-only; only an admin can reopen it", async ({ page, context, request }) => {
    const v = await newVendor(request, "Finalise");
    const card = await startCard(request, v.id);
    await signInAs(context, MEMBER);
    await page.goto(`/performance/scorecards/${card.id}`);
    const finalise = page.getByRole("button", { name: "Finalise scorecard" });
    await expect(finalise).toBeDisabled();
    const scores = [4, 4, 3, 5, 2];
    for (const [i, line] of card.lines.entries()) {
      await scoreButton(page, line.name, scores[i]!).click();
      if (i < 4) await expect(finalise).toBeDisabled();
    }
    // (4 + 4 + 3 + 5 + 2) / 5 = 3.6
    await expect(page.getByLabel("Overall score 3.6")).toBeVisible();
    await page.getByLabel("Internal note on Value for money").fill("Not for the vendor's eyes.");
    await page.getByLabel("Internal note on Value for money").blur();
    await expect(finalise).toBeEnabled();
    await finalise.click();
    await expect(page.getByText("Scorecard finalised")).toBeVisible();
    await expect(page.getByText(/Finalised 21 Nov 2026, \d\d:\d\d by mira@example\.test\. A final scorecard is read-only; an admin can reopen it\./)).toBeVisible();
    // Read-only: no boxes to type in, the selector does not respond, no Finalise, no Remove.
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await scoreButton(page, "Value for money", 1).click({ force: true });
    await expect(scoreButton(page, "Value for money", 5)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Finalise scorecard" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Remove/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Reopen/ })).toHaveCount(0);
    await expect(page.getByText("Not for the vendor's eyes.", { exact: true })).toBeVisible();
    await expectAccessible(page);
    // The server refuses as well.
    const forced = await request.put(`${BASE}/api/scorecards/${card.id}`, {
      headers: { "x-dev-user": MEMBER, cookie: "" },
      data: { lines: [{ criterionId: card.lines[0]!.criterionId, score: 1 }] },
    });
    expect(forced.status()).toBe(409);
    expect((await request.post(`${BASE}/api/scorecards/${card.id}/reopen`, { headers: { "x-dev-user": MEMBER, cookie: "" } })).status()).toBe(403);

    await signInAs(context, ADMIN);
    await page.reload();
    await page.getByRole("button", { name: /^Reopen/ }).click();
    await page.getByRole("button", { name: /Really reopen\?/ }).click();
    await expect(page.getByText("Scorecard reopened")).toBeVisible();
    await expect(page.getByRole("button", { name: "Finalise scorecard" })).toBeEnabled();
    await scoreButton(page, "Value for money", 1).click();
    await expect(page.getByLabel("Overall score 2.8")).toBeVisible();
    await expect(page.getByText("status from final to draft", { exact: false })).toBeVisible();
  });

  test("P-3 a draft started by mistake can be removed after asking once more", async ({ page, context, request }) => {
    const v = await newVendor(request, "Mistake");
    const card = await startCard(request, v.id, "2026-Q2");
    await signInAs(context, MEMBER);
    await page.goto(`/performance/scorecards/${card.id}`);
    await page.getByRole("button", { name: `Remove draft: the scorecard for ${v.name}` }).click();
    await page.getByRole("button", { name: /Really remove\?/ }).click();
    await expect(page).toHaveURL(/\/performance\/scorecards$/);
    await page.goto(`/performance/scorecards/${card.id}`);
    await expect(page.getByRole("heading", { name: "Quarterly scorecard" })).toHaveCount(0);
  });
});

test.describe("P-4 vendors without Jira", () => {
  test("P-4 a scored vendor without a board gets the same scorecard, scored by hand, with budgets, milestones and paperwork as facts", async ({ page, context, request }) => {
    const v = await newVendor(request, "Projects only", { type: "consultancy", ndaRequired: true });
    const sow = await newAgreement(request, v, {
      kind: "sow",
      title: "SOW Reporting rebuild",
      pricing: "fixed",
      budgetMinor: 20_000_00,
      startDate: "2026-06-01",
      endDate: "2026-12-31",
      status: "active",
      signedOn: "2026-05-20",
    });
    await asAdminApi(request, "post", "/invoices", { agreementId: sow.id, invoiceNumber: `P4-${Date.now()}`, invoiceDate: "2026-09-10", amountMinor: 25_000_00 });
    await asAdminApi(request, "post", `/agreements/${sow.id}/milestones`, { title: "Design", dueDate: "2026-07-31", status: "delivered", deliveredOn: "2026-07-28" });
    await asAdminApi(request, "post", `/agreements/${sow.id}/milestones`, { title: "Build", dueDate: "2026-09-15", status: "delivered", deliveredOn: "2026-09-29" });
    const card = await startCard(request, v.id);
    await signInAs(context, MEMBER);
    await page.goto(`/performance/scorecards/${card.id}`);
    await expect(page.getByText("This vendor has no Jira board, so every criterion is scored by hand", { exact: false })).toBeVisible();
    const facts = page.getByRole("region", { name: "Facts for this quarter" });
    await expect(facts.getByText("0 of 1 SOW within budget")).toBeVisible();
    await expect(facts.getByText("125% invoiced")).toBeVisible();
    await expect(facts.getByText("1 of 2 delivered on time")).toBeVisible();
    await expect(facts.getByText("NDA missing")).toBeVisible();
    await expect(facts.getByText("Data processing agreement not required")).toBeVisible();
    // The same five criteria, none with an AI suggestion.
    await expect(page.getByRole("region", { name: "Criteria" }).getByRole("listitem")).toHaveCount(5);
    await expect(page.getByText(/AI suggest/)).toHaveCount(0);
    await expect(row(page, "Timeliness").getByText("No Jira board for this vendor, so scored by the reviewer", { exact: false })).toBeVisible();
    for (const line of card.lines) await scoreButton(page, line.name, 2).click();
    await page.getByRole("button", { name: "Finalise scorecard" }).click();
    await expect(page.getByLabel("Overall score 2.0")).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe("P-5 not scored", () => {
  test("P-5 a vendor with scoring switched off has no scorecards, no proposals and no place in the performance views", async ({ page, context, request }) => {
    const v = await newVendor(request, "Scored then not");
    const card = await startCard(request, v.id);
    await signInAs(context, MEMBER);
    await page.goto(`/performance/scorecards?q=${encodeURIComponent(v.name)}`);
    await expect(page.getByRole("button", { name: `Open ${v.name} Q3 2026` })).toBeVisible();
    const res = await asAdminApi(request, "patch", `/vendors/${v.id}`, {
      name: v.name,
      type: "software",
      ownerUserId: v.ownerUserId,
      ndaRequired: false,
      dpaRequired: false,
      scoringEnabled: false,
    });
    expect(res.ok(), await res.text()).toBe(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "No scorecards match" })).toBeVisible();
    await page.goto(`/performance/scorecards/${card.id}`);
    await expect(page.getByRole("heading", { name: "Quarterly scorecard" })).toHaveCount(0);
    await page.goto(`/performance/${v.id}`);
    await expect(page.getByRole("heading", { name: "This vendor is not scored" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Scorecards" })).toHaveCount(0);
    await expect(page.getByText(/AI proposal/)).toHaveCount(0);
    await page.goto("/performance/scorecards");
    await page.getByRole("button", { name: "Start a scorecard" }).click();
    await expect(page.getByRole("dialog").getByLabel("Vendor").locator("option", { hasText: v.name })).toHaveCount(0);
    expect((await asAdminApi(request, "post", "/scorecards", { vendorId: v.id, quarter: "2026-Q2" })).status()).toBe(400);
  });
});

test.describe("P-6 vendor PDF", () => {
  test("P-6 a final scorecard downloads as a PDF; a draft offers none", async ({ page, context, request }) => {
    const cards = (await getJson<{ items: { id: string; vendorName: string; status: string }[] }>(request, "/scorecards?pageSize=200")).items;
    const final = cards.find((c) => c.vendorName === "Mossgate IT" && c.status === "final")!;
    const draft = cards.find((c) => c.vendorName === "Bluefinch Systems" && c.status === "draft")!;
    await signInAs(context, MEMBER);
    await page.goto(`/performance/scorecards/${draft.id}`);
    await expect(page.getByRole("heading", { name: "Quarterly scorecard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Vendor PDF" })).toHaveCount(0);
    expect((await request.get(`${BASE}/api/scorecards/${draft.id}/pdf`, { headers: asAdmin })).status()).toBe(409);

    await page.goto(`/performance/scorecards/${final.id}`);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Vendor PDF" }).click()]);
    expect(download.suggestedFilename()).toBe("Mossgate IT scorecard 2026-Q3.pdf");
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const file = Buffer.concat(chunks);
    expect(file.subarray(0, 5).toString()).toBe("%PDF-");
    expect(file.length).toBeGreaterThan(1500);
    // What is in it (scores and comments, no internal notes) is checked on the text of the file in the server tests.
  });
});

test.describe("P-7 criteria", () => {
  test("P-7 an admin adds, weights and switches off criteria; drafts follow, final scorecards do not change; members only read", async ({ page, context, request }) => {
    const frozen = await startCard(request, (await newVendor(request, "Frozen")).id);
    const moving = await startCard(request, (await newVendor(request, "Moving")).id);
    for (const card of [frozen, moving]) await asAdminApi(request, "put", `/scorecards/${card.id}`, { lines: card.lines.map((l) => ({ criterionId: l.criterionId, score: 4 })) });
    expect((await asAdminApi(request, "post", `/scorecards/${frozen.id}/finalise`, {})).ok()).toBe(true);
    const name = `Innovation ${Date.now().toString(36)}`;

    await signInAs(context, MEMBER);
    await page.goto("/performance/scorecards/criteria");
    await expect(page.getByRole("table", { name: "Scorecard criteria" }).locator("tbody tr")).toHaveCount((await getJson<Criterion[]>(request, "/scorecard-criteria")).length);
    await expect(page.getByRole("button", { name: "Add a criterion" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open Timeliness" })).toHaveCount(0);
    expect(
      (await request.post(`${BASE}/api/admin/scorecard-criteria`, { headers: { "x-dev-user": MEMBER, cookie: "" }, data: { name, weight: 10, source: "manual" } })).status(),
    ).toBe(403);

    await signInAs(context, ADMIN);
    await page.reload();
    await page.getByRole("button", { name: "Add a criterion" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a criterion" });
    // X-3: problems are shown at their fields and what was typed stays.
    await dialog.getByLabel("What it looks at").fill("New ideas brought to the table.");
    await dialog.getByLabel("Weight, 1 to 100").fill("250");
    await dialog.getByLabel("Scored by").selectOption("measured");
    await dialog.getByRole("button", { name: "Add criterion" }).click();
    await expect(dialog.getByText("Give the criterion a name.")).toBeVisible();
    await expect(dialog.getByText("Enter a whole number from 1 to 100.")).toBeVisible();
    await expect(dialog.getByText("Choose at least one helpdesk figure this criterion is judged from.")).toBeVisible();
    await expect(dialog.getByLabel("What it looks at")).toHaveValue("New ideas brought to the table.");
    await expectAccessible(page);
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Weight, 1 to 100").fill("20");
    await dialog.getByLabel("Scored by").selectOption("manual");
    await dialog.getByRole("button", { name: "Add criterion" }).click();
    await expect(page.getByText(`${name} added`)).toBeVisible();
    const tableRow = page.getByRole("table", { name: "Scorecard criteria" }).locator("tbody tr").filter({ hasText: name });
    await expect(tableRow).toContainText("Scored by the reviewer");
    await expect(tableRow).toContainText("In use");
    await expectAccessible(page);

    // The draft now has the new criterion and cannot be finalised until it is scored; the final one is as it was.
    await page.goto(`/performance/scorecards/${moving.id}`);
    await expect(row(page, name)).toBeVisible();
    await expect(page.getByRole("status")).toContainText(`1 of 6 still to score: ${name}.`);
    await page.goto(`/performance/scorecards/${frozen.id}`);
    await expect(page.getByRole("region", { name: "Criteria" }).getByRole("listitem")).toHaveCount(5);
    await expect(row(page, name)).toHaveCount(0);
    await expect(page.getByLabel("Overall score 4.0")).toBeVisible();

    // Reweight it, then switch it off again.
    await page.goto("/performance/scorecards/criteria");
    await page.getByRole("button", { name: `Open ${name}` }).click();
    const edit = page.getByRole("dialog", { name: `Edit ${name}` });
    await expect(edit.getByLabel("Scored by")).toBeDisabled();
    await edit.getByLabel("Weight, 1 to 100").fill("60");
    await edit.getByRole("button", { name: "Save criterion" }).click();
    await expect(tableRow).toContainText("60");
    await page.goto(`/performance/scorecards/${moving.id}`);
    await scoreButton(page, name, 1).click();
    // Five criteria of weight 20 scored 4, one of weight 60 scored 1: (5*20*4 + 60*1) / 160 = 2.9
    await expect(page.getByLabel("Overall score 2.9")).toBeVisible();

    await page.goto("/performance/scorecards/criteria");
    await page.getByRole("button", { name: `Open ${name}` }).click();
    await edit.getByLabel("In use").uncheck();
    await edit.getByRole("button", { name: "Save criterion" }).click();
    await expect(tableRow).toContainText("Switched off");
    await page.goto(`/performance/scorecards/${moving.id}`);
    await expect(row(page, name)).toHaveCount(0);
    await expect(page.getByLabel("Overall score 4.0")).toBeVisible();
    await expect(page.getByRole("button", { name: "Finalise scorecard" })).toBeEnabled();
  });
});

test.describe("X-1 keyboard", () => {
  test("X-1 a scorecard can be scored and finalised with the keyboard alone", async ({ page, context, request }) => {
    const v = await newVendor(request, "Keyboard");
    const card = await startCard(request, v.id);
    await signInAs(context, MEMBER);
    await page.goto(`/performance/scorecards/${card.id}`);
    for (const line of card.lines) {
      await scoreButton(page, line.name, 3).focus();
      await page.keyboard.press("Enter");
      await expect(scoreButton(page, line.name, 3)).toHaveAttribute("aria-pressed", "true");
    }
    // Tab moves on from a score to the next one, and on to the comment box.
    await scoreButton(page, "Quality of delivery", 5).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Comment for the vendor on Quality of delivery")).toBeFocused();
    await page.keyboard.type("Typed without a mouse.");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Internal note on Quality of delivery")).toBeFocused();
    await page.getByRole("button", { name: "Finalise scorecard" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Scorecard finalised")).toBeVisible();
    await expect(page.getByText("Typed without a mouse.", { exact: true })).toBeVisible();
  });
});
