import ExcelJS from "exceljs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { RfpDetail } from "../shared/rfp";
import { ADMIN, expectAccessible, MEMBER, newAgreement, newVendor, signInAs, TODAY } from "./helpers";

const BASE = "http://127.0.0.1:4173";
const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** Calls the API as a person, to set a test up. Fails the test when the call is refused. */
async function call<T = RfpDetail>(request: APIRequestContext, method: "get" | "post" | "put" | "patch", path: string, data?: unknown, as = MEMBER): Promise<T> {
  const res = await request[method](`${BASE}/api${path}`, { headers: { "x-dev-user": as, cookie: "" }, data });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}
const meId = async (request: APIRequestContext, as = MEMBER) => (await call<{ id: string }>(request, "get", "/me", undefined, as)).id;

/** A demand, straight through the API. */
async function newRfp(request: APIRequestContext, over: Record<string, unknown> = {}) {
  return call(request, "post", "/rfps", { title: unique("Expense tool"), need: "A tool to submit and approve expense claims.", ownerUserId: await meId(request), ...over });
}
/** … with the AI's draft taken over as the document. */
async function drafted(request: APIRequestContext, over: Record<string, unknown> = {}) {
  const r = await newRfp(request, over);
  const asked = await call(request, "post", `/rfps/${r.id}/draft`);
  return call(request, "post", `/rfps/${r.id}/draft/review`, { action: "accept", suggestionId: asked.draft!.id });
}
/** … reviewed and approved. */
async function approved(request: APIRequestContext, over: Record<string, unknown> = {}) {
  const r = await drafted(request, over);
  await call(request, "post", `/rfps/${r.id}/stage`, { to: "in_review" });
  await call(request, "post", `/rfps/${r.id}/signoffs`, { reviewerName: "Chris Tanaka", reviewerRole: "CTO", outcome: "approved", onDate: TODAY });
  return call(request, "post", `/rfps/${r.id}/stage`, { to: "approved" });
}
/** … issued to two shortlisted candidates: a new prospect without an NDA and a vendor with one. */
async function issued(request: APIRequestContext) {
  const r = await approved(request);
  const prospect = unique("Prospect");
  const known = await newVendor(request, "Known", { ndaRequired: true });
  await newAgreement(request, known, { kind: "nda", status: "active", signedOn: "2026-01-10" });
  await call(request, "post", `/rfps/${r.id}/candidates`, { newVendor: { name: prospect, type: "software" }, list: "shortlist", reason: "Recommended by a peer" });
  let rfp = await call(request, "post", `/rfps/${r.id}/candidates`, { vendorId: known.id, list: "shortlist", reason: "Current supplier" });
  for (const c of rfp.candidates) rfp = await call(request, "post", `/rfp-candidates/${c.id}/issue`, { issuedOn: TODAY, ndaWarningAcknowledged: true });
  return { rfp, a: rfp.candidates.find((c) => c.vendorName === prospect)!, b: rfp.candidates.find((c) => c.vendorName === known.name)! };
}
/** … with answers typed in: the prospect answers everything in detail, the known vendor briefly and not every question. */
async function answered(request: APIRequestContext) {
  const x = await issued(request);
  let rfp = x.rfp;
  for (const q of rfp.questions) {
    rfp = await call(request, "put", `/rfp-candidates/${x.a.id}/answers/${q.id}`, {
      text: `Yes, as standard since 2019. We have done this for 45 comparable finance teams, can show it working in a demonstration, and can name reference customers who are willing to take a call. Point ${q.number}.`,
    });
    if (q.number % 4 !== 0) rfp = await call(request, "put", `/rfp-candidates/${x.b.id}/answers/${q.id}`, { text: "Yes, we can." });
  }
  return { ...x, rfp };
}
const open = async (page: Page, rfp: { id: string }, tab?: string) => {
  await page.goto(`/rfps/${rfp.id}${tab ? `?tab=${tab}` : ""}`);
  await expect(page.getByRole("tablist", { name: "Parts of this RFP" })).toBeVisible();
};
const nextStep = (page: Page) => page.getByRole("region", { name: "Next step" });
const currentStage = (page: Page) => page.getByRole("list", { name: "Stages" }).locator('[aria-current="step"]');

test.afterEach(async ({ request }) => {
  await request.post(`${BASE}/api/dev/ai`, { headers: { "x-dev-user": ADMIN, cookie: "" }, data: { mode: "working" } });
});

test.describe("Q-1 demand", () => {
  test("Q-1 a member creates an RFP with the need, budget, sponsor, approval date and target decision date", async ({ page, context }) => {
    await signInAs(context, MEMBER);
    await page.goto("/rfps");
    await page.getByRole("button", { name: "New RFP" }).click();
    const dialog = page.getByRole("dialog", { name: "New RFP" });
    // X-3: a demand without a title is refused, and what was typed stays.
    await dialog.getByLabel("The need").fill("A way to plan cash across the entities.");
    await dialog.getByRole("button", { name: "Create RFP" }).click();
    await expect(dialog.getByText("Give the RFP a title.")).toBeVisible();
    await expect(dialog.getByLabel("The need")).toHaveValue("A way to plan cash across the entities.");
    const title = unique("Cash planning tool");
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("Budget").fill("45.000");
    await expect(dialog.getByText("Read as € 45,000.00")).toBeVisible();
    await dialog.getByLabel("Sponsor").fill("Group treasurer");
    await dialog.getByLabel("Demand approved on").fill("2026-11-10");
    await dialog.getByLabel("Decision wanted by").fill("2027-03-31");
    await dialog.getByRole("button", { name: "Create RFP" }).click();

    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(currentStage(page)).toContainText("Drafting");
    await page.getByRole("tab", { name: "Overview" }).click();
    const demand = page.getByRole("region", { name: "The demand" });
    await expect(demand).toContainText("A way to plan cash across the entities.");
    for (const fact of ["€ 45,000.00", "Group treasurer", "10 Nov 2026", "31 Mar 2027", "Mira Okafor", "Written answers 70%, demo and interview 30%"])
      await expect(demand).toContainText(fact);
    await expect(page.getByText(`Added${""}`).first()).toBeVisible();
    await expectAccessible(page);

    // The demand can be changed; the history says what changed.
    await demand.getByRole("button", { name: "Change the demand" }).click();
    const edit = page.getByRole("dialog", { name: "Change the demand" });
    await edit.getByLabel("Sponsor").fill("Head of treasury");
    await edit.getByRole("button", { name: "Save demand" }).click();
    await expect(demand).toContainText("Head of treasury");
    await expect(page.getByText("Sponsor from Group treasurer to Head of treasury")).toBeVisible();
  });
});

test.describe("Q-2 draft", () => {
  test("Q-2 the AI drafts sections, weighted criteria and numbered questions; a member takes the draft over and can edit everything", async ({ page, context, request }) => {
    const rfp = await newRfp(request);
    await signInAs(context, MEMBER);
    await open(page, rfp);
    // The page opens on the Document tab, where the next step is done; nothing is written yet (X-2).
    await expect(nextStep(page)).toContainText("Write the RFP");
    await expect(page.getByText("No sections yet. A section is")).toBeVisible();
    const panel = page.getByRole("region", { name: "AI draft" });
    await panel.getByRole("button", { name: "Ask the AI" }).click();
    await expect(panel).toContainText("AI proposal");
    await expect(panel).toContainText("Not reviewed yet");
    await expect(panel).toContainText("6 sections, 6 criteria and 13 questions.");
    // Still only a proposal: the document is empty until it is used.
    await expect(page.getByText("No sections yet. A section is")).toBeVisible();
    await panel.getByText("Read the draft").click();
    await expect(panel).toContainText("Functional fit: 40% of written answers");
    await panel.getByRole("button", { name: "Use this draft" }).click();
    await expect(panel).toContainText("Accepted by mira@example.test");

    // Everything is in the form now and can be changed.
    await expect(page.getByLabel("Heading of section 1")).toHaveValue("Introduction and background");
    await expect(page.getByLabel("Question 13", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Criterion of question 1", { exact: true }).locator("option:checked")).toHaveText("Functional fit");
    const written = page.getByRole("group", { name: "Written answers" });
    await expect(written).toContainText("Adds up to 100.");
    await expectAccessible(page);

    // Weights within a part must add up to 100: a save that breaks this is refused and nothing typed is lost (X-3).
    await page.getByLabel("Weight of Functional fit").fill("50");
    await page.getByLabel("Question 1", { exact: true }).fill("How does your product handle receipts in a foreign currency?");
    await expect(written).toContainText("Adds up to 110; it must be 100.");
    // A look at another tab does not lose what was typed and not saved.
    await page.getByRole("tab", { name: "Review" }).click();
    await page.getByRole("tab", { name: "Document" }).click();
    await expect(page.getByLabel("Question 1", { exact: true })).toHaveValue("How does your product handle receipts in a foreign currency?");
    await expect(page.getByLabel("Weight of Functional fit")).toHaveValue("50");
    await page.getByRole("button", { name: "Save document" }).click();
    await expect(page.getByRole("alert")).toContainText("Some of what was entered is not valid");
    await expect(page.getByText("The weights for written answers must add up to 100. They now add up to 110.")).toBeVisible();
    await expect(page.getByLabel("Question 1", { exact: true })).toHaveValue("How does your product handle receipts in a foreign currency?");
    // A question without a criterion is refused as well.
    await page.getByLabel("Weight of Commercial terms").fill("5");
    await page.getByRole("button", { name: "Add question" }).click();
    await page.getByLabel("Question 14", { exact: true }).fill("Which currencies do you support?");
    await page.getByRole("button", { name: "Save document" }).click();
    await expect(page.getByText("Choose the criterion this question belongs to.")).toBeVisible();
    await page.getByLabel("Criterion of question 14").selectOption({ label: "Commercial terms" });
    await page.getByRole("button", { name: "Add section" }).click();
    await page.getByLabel("Heading of section 7").fill("Annex: our systems");
    await page.getByLabel("Text of section 7").fill("A list of the systems the tool has to work with.");
    await page.getByRole("button", { name: "Save document" }).click();
    await expect(page.getByText("Document saved")).toBeVisible();
    await expect(panel).toContainText("Accepted with changes");

    await page.reload();
    await expect(page.getByLabel("Question 1", { exact: true })).toHaveValue("How does your product handle receipts in a foreign currency?");
    await expect(page.getByLabel("Question 14", { exact: true })).toHaveValue("Which currencies do you support?");
    await expect(page.getByLabel("Weight of Functional fit")).toHaveValue("50");
    await expect(page.getByLabel("Heading of section 7")).toHaveValue("Annex: our systems");
    await expect(nextStep(page)).toContainText("Send it for review");
  });

  test("Q-2 when the AI cannot answer, the page says so in place and the template still gives a start", async ({ page, context, request }) => {
    const rfp = await newRfp(request);
    await request.post(`${BASE}/api/dev/ai`, { headers: { "x-dev-user": ADMIN, cookie: "" }, data: { mode: "unavailable" } });
    await signInAs(context, MEMBER);
    await open(page, rfp);
    await page.getByRole("region", { name: "AI draft" }).getByRole("button", { name: "Ask the AI" }).click();
    await expect(page.getByRole("alert")).toContainText("The AI could not write a draft just now.");
    // Something typed and not saved is never replaced: the template is offered again once it is discarded.
    await page.getByRole("button", { name: "Add section" }).click();
    await page.getByLabel("Heading of section 1").fill("My own start");
    await expect(page.getByRole("button", { name: "Start from the template" })).toHaveCount(0);
    await page.getByRole("button", { name: "Discard changes" }).click();
    await page.getByRole("button", { name: "Start from the template" }).click();
    await expect(page.getByLabel("Heading of section 6")).toHaveValue("Confidentiality and terms");
    await expect(page.getByRole("group", { name: "Demo and interview" })).toContainText("Adds up to 100.");
    await expect(page.getByText("No questions yet.")).toBeVisible();
  });
});

test.describe("Q-3 review", () => {
  test("Q-3 exports as Word and PDF; approved needs at least one approval and no open change request", async ({ page, context, request }) => {
    const rfp = await drafted(request);
    await signInAs(context, MEMBER);
    await open(page, rfp, "review");
    for (const [name, ext] of [
      ["Download as Word", ".docx"],
      ["Download as PDF", ".pdf"],
    ] as const) {
      const download = page.waitForEvent("download");
      await page.getByRole("link", { name }).click();
      expect((await download).suggestedFilename()).toBe(`${rfp.title} RFP review copy${ext}`);
    }
    await expect(page.getByText("No sign-offs yet. They are recorded once the draft has been sent for review.")).toBeVisible();
    await page.getByRole("button", { name: "Send for review" }).click();
    await expect(currentStage(page)).toContainText("In review");
    const approve = page.getByRole("button", { name: "Mark as approved" });
    await expect(approve).toBeDisabled();
    await expect(page.getByText("No reviewer has approved the RFP yet. Record at least one approval first.").last()).toBeVisible();

    const record = async (name: string, role: string, outcome: string, comment?: string) => {
      await page.getByRole("button", { name: "Record a sign-off" }).click();
      const dialog = page.getByRole("dialog", { name: "Record a sign-off" });
      await dialog.getByLabel("Reviewer").fill(name);
      await dialog.getByLabel("Role or team").fill(role);
      await dialog.getByLabel("Outcome").selectOption({ label: outcome });
      if (comment) await dialog.getByLabel("The changes asked for").fill(comment);
      await dialog.getByRole("button", { name: "Record sign-off" }).click();
      await expect(dialog).toBeHidden();
    };
    await record("Robin Vale", "Security", "Changes requested", "Ask about audit logging.");
    await record("Chris Tanaka", "CTO", "Approved");
    const signoffs = page.getByRole("list", { name: "Sign-offs" }).getByRole("listitem");
    await expect(signoffs).toHaveCount(2);
    await expect(signoffs.filter({ hasText: "Robin Vale" })).toContainText("Changes requested, open");
    await expect(signoffs.filter({ hasText: "Chris Tanaka" })).toContainText("21 Nov 2026");
    // One approval, but a requested change is still open.
    await expect(approve).toBeDisabled();
    await expect(page.getByRole("status").filter({ hasText: "A requested change is still open" })).toBeVisible();
    await expectAccessible(page);

    await signoffs.filter({ hasText: "Robin Vale" }).getByRole("button", { name: "Mark as dealt with" }).click();
    await expect(signoffs.filter({ hasText: "Robin Vale" })).toContainText("Changes dealt with");
    await approve.click();
    await expect(currentStage(page)).toContainText("Approved");
    await expect(nextStep(page)).toContainText("Shortlist the candidates");

    // If the document is changed after all, the approval was for an earlier version and a new one is needed.
    await page.getByRole("button", { name: "Back to drafting" }).click();
    await page.getByRole("tab", { name: "Document" }).click();
    await page.getByLabel("Question 1", { exact: true }).fill("A question the reviewers never saw?");
    await page.getByRole("button", { name: "Save document" }).click();
    await expect(page.getByText("Document saved")).toBeVisible();
    await page.getByRole("button", { name: "Send for review" }).click();
    await page.getByRole("tab", { name: "Review" }).click();
    await expect(signoffs.filter({ hasText: "Chris Tanaka" })).toContainText("Approved an earlier version");
    await expect(approve).toBeDisabled();
    await expect(page.getByRole("status").filter({ hasText: "the earlier approval no longer counts" })).toBeVisible();
  });
});

test.describe("Q-4 candidates", () => {
  test("Q-4 a longlist and a shortlist with a reason per candidate; an unknown candidate becomes a prospect vendor", async ({ page, context, request }) => {
    const rfp = await newRfp(request);
    const known = await newVendor(request, "Known");
    await signInAs(context, MEMBER);
    await open(page, rfp, "candidates");
    await expect(page.getByText("No candidates yet.")).toBeVisible();

    const name = unique("Newcomer");
    await page.getByRole("button", { name: "Add candidate" }).click();
    let dialog = page.getByRole("dialog", { name: "Add a candidate" });
    await dialog.getByRole("button", { name: "A new vendor" }).click();
    await dialog.getByLabel("Vendor name").fill(name);
    await dialog.getByLabel("Type").selectOption({ label: "Software" });
    // A reason is required, and what was typed stays (X-3).
    await dialog.getByRole("button", { name: "Add candidate" }).click();
    await expect(dialog.getByText("Give the reason.")).toBeVisible();
    await expect(dialog.getByLabel("Vendor name")).toHaveValue(name);
    await dialog.getByLabel("Reason").fill("Recommended by a peer.");
    await dialog.getByRole("button", { name: "Add candidate" }).click();
    const longlist = page.getByRole("list", { name: "Longlist" });
    const fresh = longlist.getByRole("listitem", { name });
    await expect(fresh).toContainText("Prospect");
    await expect(fresh).toContainText("No NDA");
    await expect(fresh).toContainText("Recommended by a peer.");

    await page.getByRole("button", { name: "Add candidate" }).click();
    dialog = page.getByRole("dialog", { name: "Add a candidate" });
    await dialog.getByLabel("Vendor", { exact: true }).selectOption({ label: `${known.name} (active)` });
    await dialog.getByRole("button", { name: "Shortlist" }).click();
    await dialog.getByLabel("Reason").fill("Current supplier.");
    await dialog.getByRole("button", { name: "Add candidate" }).click();
    await expect(page.getByRole("list", { name: "Shortlist" }).getByRole("listitem", { name: known.name })).toContainText("Current supplier.");

    // Moving needs a reason too.
    await fresh.getByRole("button", { name: "Move", exact: true }).click();
    const move = page.getByRole("dialog", { name: `Move ${name}` });
    await move.getByLabel("Move to").selectOption({ label: "Shortlist" });
    await move.getByLabel("Reason").fill("Strong demo at the trade fair.");
    await move.getByRole("button", { name: "Move candidate" }).click();
    await expect(page.getByRole("list", { name: "Shortlist" }).getByRole("listitem", { name })).toContainText("Strong demo at the trade fair.");
    await expect(page.getByText("No candidate is on the longlist.")).toBeVisible();
    await expectAccessible(page);

    // The new candidate is a prospect on the Vendors page, and its panel lists this RFP.
    await page.getByRole("list", { name: "Shortlist" }).getByRole("link", { name }).click();
    await expect(page).toHaveURL(/\/vendors\?open=/);
    const panel = page.getByRole("region", { name, exact: true });
    await expect(panel).toContainText("Prospect");
    await expect(panel.getByRole("region", { name: "RFPs" }).getByRole("link", { name: rfp.title })).toHaveAttribute("href", `/rfps/${rfp.id}`);
  });
});

test.describe("Q-5 issue", () => {
  test("Q-5 per shortlisted candidate the RFP as Word and an Excel answer sheet; no NDA needs acknowledging; issuing locks the questions and criteria", async ({
    page,
    context,
    request,
  }) => {
    const r = await approved(request);
    const name = unique("Prospect");
    await call(request, "post", `/rfps/${r.id}/candidates`, { newVendor: { name, type: "software" }, list: "shortlist", reason: "Recommended by a peer" });
    await signInAs(context, MEMBER);
    await open(page, r);
    // An approved RFP opens on its candidates, where it is issued.
    await expect(nextStep(page)).toContainText("Issue the RFP");
    const row = page.getByRole("list", { name: "Shortlist" }).getByRole("listitem", { name });
    let download = page.waitForEvent("download");
    await row.getByRole("link", { name: `RFP (Word) for ${name}` }).click();
    expect((await download).suggestedFilename()).toBe(`${r.title} RFP for ${name}.docx`);
    download = page.waitForEvent("download");
    await row.getByRole("link", { name: `Answer sheet (Excel) for ${name}` }).click();
    const sheet = await download;
    expect(sheet.suggestedFilename()).toBe(`${r.title} answer sheet ${name}.xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(await sheet.path());
    const ws = wb.getWorksheet("Answers")!;
    expect(ws.getRow(6).getCell(3).value).toBe(r.questions[0]!.text);
    expect(ws.rowCount).toBe(5 + r.questions.length);

    // What was approved is what goes out: the approved document is shown, not open for changes.
    await page.getByRole("tab", { name: "Document" }).click();
    await expect(page.getByText("This is the document as it was approved.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save document" })).toHaveCount(0);
    await page.getByRole("tab", { name: "Candidates" }).click();

    await row.getByRole("button", { name: `Issue the RFP to ${name}` }).click();
    const dialog = page.getByRole("dialog", { name: `Issue the RFP to ${name}` });
    await expect(dialog.getByRole("alert")).toContainText(`No NDA is in place with ${name}.`);
    // Without acknowledging the warning nothing is issued.
    await dialog.getByRole("button", { name: "Record as issued" }).click();
    await expect(dialog.getByText("Tick the box to confirm that the RFP goes out without an NDA in place.")).toBeVisible();
    await expect(currentStage(page)).toContainText("Approved");
    await dialog.getByLabel("Issue the RFP anyway").check();
    await dialog.getByRole("button", { name: "Record as issued" }).click();
    await expect(row).toContainText("Issued 21 Nov 2026, without NDA");
    await expect(row).toContainText("acknowledged by mira@example.test");
    await expect(currentStage(page)).toContainText("Issued");
    await expectAccessible(page);

    // Locked: the document is shown, not editable.
    await page.getByRole("tab", { name: "Document" }).click();
    await expect(page.getByText("The RFP has been issued, so its sections, criteria and questions can no longer be changed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save document" })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Questions" }).getByRole("listitem")).toHaveCount(r.questions.length);
  });

  test("Q-5 a candidate with an NDA in place is issued without a warning", async ({ page, context, request }) => {
    const r = await approved(request);
    const known = await newVendor(request, "Known", { ndaRequired: true });
    await newAgreement(request, known, { kind: "nda", status: "active", signedOn: "2026-01-10" });
    await call(request, "post", `/rfps/${r.id}/candidates`, { vendorId: known.id, list: "shortlist", reason: "Current supplier" });
    await signInAs(context, MEMBER);
    await open(page, r, "candidates");
    const row = page.getByRole("listitem", { name: known.name });
    await expect(row).toContainText("NDA in place");
    await row.getByRole("button", { name: `Issue the RFP to ${known.name}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Record as issued" }).click();
    await expect(row).toContainText("Issued 21 Nov 2026");
    await expect(row).not.toContainText("without NDA");
  });
});

test.describe("Q-6 responses", () => {
  test("Q-6 an uploaded answer sheet is matched to the questions; what could not be matched is shown for manual entry; other documents can be attached", async ({
    page,
    context,
    request,
  }) => {
    const { rfp, a } = await issued(request);
    // The candidate's own sheet, filled in: question 2 left empty, the last one renumbered, and a remark of its own added.
    const res = await request.get(`${BASE}/api/rfp-candidates/${a.id}/answer-sheet.xlsx`, { headers: { "x-dev-user": MEMBER, cookie: "" } });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await res.body()) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Answers")!;
    const last = rfp.questions.length;
    for (let n = 1; n <= last; n++) if (n !== 2) ws.getRow(5 + n).getCell(4).value = `Our answer to question ${n}.`;
    ws.getRow(5 + last).getCell(1).value = 999;
    ws.getRow(5 + last).getCell(3).value = "A question we rewrote";
    ws.addRow(["", "", "", "We would also like to mention our awards."]);
    const filled = Buffer.from(await wb.xlsx.writeBuffer());

    await signInAs(context, MEMBER);
    await open(page, rfp);
    await expect(nextStep(page)).toContainText("Upload the answers");
    await page
      .getByRole("group", { name: "Candidate" })
      .getByRole("button", { name: new RegExp(a.vendorName) })
      .click();
    await expect(page.getByText(`0 of ${last} questions answered.`)).toBeVisible();
    // A file that is not the answer sheet is refused in plain words.
    const other = new ExcelJS.Workbook();
    other.addWorksheet("Prices").addRow(["Item", "Price"]);
    const chooser = page.getByLabel(`Choose the answer sheet of ${a.vendorName}`);
    await chooser.setInputFiles({
      name: "prices.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(await other.xlsx.writeBuffer()),
    });
    await expect(page.getByRole("alert")).toContainText("That workbook is not the answer sheet");

    await chooser.setInputFiles({ name: "Answers from the candidate.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: filled });
    await expect(page.getByRole("status").filter({ hasText: "matched" })).toContainText(
      `${last - 2} answers were matched to their questions. 2 rows could not be matched and are listed below to place by hand. 2 questions have no answer yet.`,
    );
    await expect(page.getByText(`${last - 2} of ${last} questions answered.`)).toBeVisible();
    await expect(currentStage(page)).toContainText("Evaluating");
    const answers = page.getByRole("list", { name: `Answers of ${a.vendorName}` }).getByRole("listitem");
    await expect(answers.nth(0).getByRole("textbox")).toHaveValue("Our answer to question 1.");
    await expect(answers.nth(1).getByRole("textbox")).toHaveValue("");
    await expect(page.getByRole("list", { name: `Documents of ${a.vendorName}` })).toContainText("Answers from the candidate.xlsx");

    // The two rows that fitted no question: place one under its question, set the other aside.
    const unmatched = page.getByRole("list", { name: "Rows that could not be matched" }).getByRole("listitem");
    await expect(unmatched).toHaveCount(2);
    await expect(unmatched.nth(0)).toContainText("numbered 999");
    await expect(unmatched.nth(0)).toContainText("A question we rewrote");
    await expect(unmatched.nth(0)).toContainText(`Our answer to question ${last}.`);
    await expectAccessible(page);
    await unmatched.nth(0).getByRole("combobox").selectOption({ index: last });
    await unmatched
      .nth(0)
      .getByRole("button", { name: /Use as its answer: row \d+/ })
      .click();
    await expect(answers.nth(last - 1).getByRole("textbox")).toHaveValue(`Our answer to question ${last}.`);
    await expect(unmatched).toHaveCount(1);
    const aside = unmatched.nth(0).getByRole("button", { name: /Set aside row \d+/ });
    await aside.click();
    await page.getByRole("button", { name: /Really set aside/ }).click();
    await expect(page.getByRole("list", { name: "Rows that could not be matched" })).toHaveCount(0);

    // Manual entry for the question the candidate skipped.
    await answers.nth(1).getByRole("textbox").fill("Given by phone: yes, as standard.");
    await answers.nth(1).getByRole("button", { name: "Save answer to question 2" }).click();
    await expect(page.getByText(`${last} of ${last} questions answered.`)).toBeVisible();

    // Another document the candidate sent.
    await page
      .getByLabel(`Choose a document of ${a.vendorName} to attach`)
      .setInputFiles({ name: "Security whitepaper.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF") });
    const docs = page.getByRole("list", { name: `Documents of ${a.vendorName}` });
    await expect(docs.getByRole("listitem")).toHaveCount(2);
    const download = page.waitForEvent("download");
    await docs.getByRole("link", { name: "Security whitepaper.pdf" }).click();
    expect((await download).suggestedFilename()).toBe("Security whitepaper.pdf");
    await open(page, rfp, "responses");
    await page
      .getByRole("group", { name: "Candidate" })
      .getByRole("button", { name: new RegExp(a.vendorName) })
      .click();
    await expect(answers.nth(1).getByRole("textbox")).toHaveValue("Given by phone: yes, as standard.");
  });
});

test.describe("Q-7 AI comparison", () => {
  test("Q-7 per question a summary of each candidate's answer and the differences, and a proposed score per candidate and criterion with a reason that quotes the answer", async ({
    page,
    context,
    request,
  }) => {
    const { rfp, a, b } = await answered(request);
    await signInAs(context, MEMBER);
    await open(page, rfp, "responses");
    await page.getByRole("button", { name: "Ask the AI to compare" }).click();
    const panel = page.getByRole("region", { name: "AI comparison", exact: true });
    await expect(panel).toContainText("AI proposal");
    await expect(panel).toContainText("No proposed score has been taken over yet.");
    const first = rfp.criteria[0]!;
    await panel.getByText(first.name).first().click();
    const q1 = rfp.questions[0]!;
    await expect(panel).toContainText(`1. ${q1.text}`);
    await expect(panel).toContainText(`${a.vendorName}: Yes, as standard since 2019.`);
    await expect(panel).toContainText(`${b.vendorName}: Yes, we can.`);
    await expect(panel).toContainText(`Differences: ${a.vendorName} gave the most detail.`);
    // The fourth question was not answered by the second candidate.
    await expect(panel).toContainText(`${b.vendorName}: No answer.`);
    await expect(panel).toContainText(`Proposed scores on ${first.name}`);
    await expect(panel).toContainText(`${a.vendorName}: 4 out of 5.`);
    await expect(panel).toContainText("From the answer: “Yes, as standard since 2019.”");
    await expect(panel).toContainText(`${b.vendorName}: 2 out of 5.`);
    await expect(panel).toContainText("From the answer: “Yes, we can.”");
    await expectAccessible(page);

    // An answer changed afterwards: the page says the comparison is behind.
    await page
      .getByRole("group", { name: "Candidate" })
      .getByRole("button", { name: new RegExp(b.vendorName) })
      .click();
    const fourth = page
      .getByRole("list", { name: `Answers of ${b.vendorName}` })
      .getByRole("listitem")
      .nth(3);
    await fourth.getByRole("textbox").fill("Added later: yes.");
    await fourth.getByRole("button", { name: "Save answer to question 4" }).click();
    await expect(panel).toContainText("An answer was added or changed after this comparison was made.");
    await panel.getByRole("button", { name: "Compare again" }).click();
    await expect(panel).not.toContainText("An answer was added or changed");
    await expect(panel).toContainText(`${b.vendorName}: 3 out of 5.`);
  });

  test("Q-7 when the AI cannot answer, the page says so and the answers can still be read and scored", async ({ page, context, request }) => {
    const { rfp } = await answered(request);
    await request.post(`${BASE}/api/dev/ai`, { headers: { "x-dev-user": ADMIN, cookie: "" }, data: { mode: "nonsense" } });
    await signInAs(context, MEMBER);
    await open(page, rfp, "responses");
    await page.getByRole("button", { name: "Ask the AI to compare" }).click();
    await expect(page.getByRole("alert")).toContainText("The AI could not compare the answers just now.");
    await page.getByRole("tab", { name: "Scoring" }).click();
    await page
      .getByRole("group", { name: new RegExp(`Your score for .* on ${rfp.criteria[0]!.name}`) })
      .getByRole("button", { name: "3" })
      .click();
    await expect(page.getByRole("status").filter({ hasText: "You have given 1 of" })).toBeVisible();
  });
});

test.describe("Q-8 scoring", () => {
  test("Q-8 each member scores each candidate per criterion, demo included; averages, weighted written and demo scores, the overall score and the ranking follow", async ({
    page,
    context,
    request,
  }) => {
    const { rfp, a, b } = await answered(request);
    await call(request, "post", `/rfps/${rfp.id}/comparison`);
    // A colleague has already scored the first candidate 5 on everything.
    for (const k of rfp.criteria) await call(request, "put", `/rfp-candidates/${a.id}/scores/${k.id}`, { score: 5 }, ADMIN);
    await signInAs(context, MEMBER);
    await open(page, rfp, "scoring");
    const ranking = page.getByRole("table", { name: "Ranking" });
    const rowOf = (name: string) => ranking.getByRole("row").filter({ hasText: name });
    await expect(rowOf(a.vendorName)).toContainText("5.00");
    await expect(rowOf(b.vendorName)).toContainText("0 of 4 scored");
    await expect(page.getByRole("status").filter({ hasText: `You have given 0 of ${rfp.criteria.length * 2} scores.` })).toBeVisible();

    // The AI's proposal sits next to the criterion as an outline; accepting it makes it my score.
    const written = rfp.criteria.filter((k) => k.part === "written");
    const demo = rfp.criteria.filter((k) => k.part === "demo");
    const item = (name: string) => page.getByRole("listitem", { name, exact: true });
    await expect(item(written[0]!.name)).toContainText("AI suggests 4");
    await expect(item(written[0]!.name)).toContainText("From");
    await expect(item(written[0]!.name).getByRole("button", { name: "4, suggested by the AI" })).toHaveAttribute("aria-pressed", "false");
    await item(written[0]!.name).getByRole("button", { name: "Accept 4" }).click();
    await expect(item(written[0]!.name).getByRole("button", { name: "4", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(item(written[0]!.name)).toContainText("AI suggested 4");
    await expect(item(written[0]!.name)).toContainText("You gave the same score.");
    await expect(item(written[0]!.name)).toContainText("Average 4.50 · Alex Admin 5 · Mira Okafor 4");
    // The others by hand: 4 on the written criteria, 3 on the demo ones, with a comment.
    for (const k of written.slice(1)) await item(k.name).getByRole("button", { name: /^4/ }).click();
    for (const k of demo) await item(k.name).getByRole("button", { name: "3", exact: true }).click();
    await expect(item(demo[1]!.name)).toContainText("Average 4.00");
    const comment = item(demo[0]!.name).getByLabel(`Your comment for ${a.vendorName} on ${demo[0]!.name}`);
    await comment.fill("Demo ran into an error twice.");
    await comment.blur();
    await expect(item(demo[0]!.name)).toContainText("Mira Okafor 3 (“Demo ran into an error twice.”)");
    // Written (4+5)/2 = 4.50, demo (3+5)/2 = 4.00, overall 0.7 × 4.50 + 0.3 × 4.00 = 4.35.
    await expect(rowOf(a.vendorName)).toContainText("4.50");
    await expect(rowOf(a.vendorName)).toContainText("4.00");
    await expect(rowOf(a.vendorName)).toContainText("4.35");
    await expect(rowOf(a.vendorName).getByRole("cell").first()).toHaveText("1");
    await expectAccessible(page);

    // The second candidate: 2 on everything, the keyboard alone (X-1).
    await page.getByRole("group", { name: "Candidate to score" }).getByRole("button", { name: b.vendorName }).click();
    for (const k of rfp.criteria) {
      const two = item(k.name).getByRole("button", { name: /^2/ });
      await two.focus();
      await page.keyboard.press("Enter");
      await expect(two).toHaveAttribute("aria-pressed", "true");
    }
    await expect(rowOf(b.vendorName)).toContainText("2.00");
    await expect(rowOf(b.vendorName).getByRole("cell").first()).toHaveText("2");
    await expect(page.getByRole("status").filter({ hasText: `You have given ${rfp.criteria.length * 2} of ${rfp.criteria.length * 2} scores.` })).toBeVisible();
    await expect(nextStep(page)).toContainText("Record the decision");

    // A score can be taken back; the candidate then has no overall score and no rank.
    await item(demo[0]!.name)
      .getByRole("button", { name: /Clear my score/ })
      .click();
    await expect(rowOf(b.vendorName)).toContainText("1 of 2 scored");
    await expect(rowOf(b.vendorName).getByRole("cell").first()).toHaveText("–");
  });
});

test.describe("Q-9 decision and Q-10 decision record", () => {
  test("Q-9 a member records the winner and the rationale; the winner becomes an active vendor, no agreement is created, the other stays a prospect", async ({
    page,
    context,
    request,
  }) => {
    const r = await approved(request);
    const [winner, other] = [unique("Winner"), unique("Runner-up")];
    for (const name of [winner, other])
      await call(request, "post", `/rfps/${r.id}/candidates`, { newVendor: { name, type: "software" }, list: "shortlist", reason: `Reason for ${name}` });
    let rfp = await call(request, "get", `/rfps/${r.id}`);
    for (const c of rfp.candidates) rfp = await call(request, "post", `/rfp-candidates/${c.id}/issue`, { issuedOn: TODAY, ndaWarningAcknowledged: true });
    const [w, o] = rfp.candidates;
    for (const k of rfp.criteria) {
      await call(request, "put", `/rfp-candidates/${w!.id}/scores/${k.id}`, { score: 5 });
      await call(request, "put", `/rfp-candidates/${w!.id}/scores/${k.id}`, { score: 4 }, ADMIN);
      await call(request, "put", `/rfp-candidates/${o!.id}/scores/${k.id}`, { score: 3 });
    }
    const agreements = (await call<{ total: number }>(request, "get", "/agreements?pageSize=1")).total;

    await signInAs(context, MEMBER);
    await open(page, rfp);
    await expect(nextStep(page)).toContainText("Record the decision");
    // The best-ranked candidate is filled in; the reasons are required (X-3).
    await expect(page.getByLabel("Winner").locator("option:checked")).toHaveText(`${winner} · 4.50 · rank 1`);
    await page.getByRole("button", { name: "Record the decision" }).click();
    await expect(page.getByText("Give the reasons for the decision.")).toBeVisible();
    await expect(page.getByText(`${winner} becomes an active vendor.`)).toBeVisible();
    await page.getByLabel("Reasons").fill("Highest score, and the strongest references.");
    await expectAccessible(page);
    await page.getByRole("button", { name: "Record the decision" }).click();

    await expect(currentStage(page)).toContainText("Decided");
    const decision = page.getByRole("region", { name: "Decision", exact: true });
    await expect(decision).toContainText(winner);
    await expect(decision).toContainText("21 Nov 2026");
    await expect(decision).toContainText("4.50");
    await expect(decision).toContainText("Highest score, and the strongest references.");
    await expect(nextStep(page)).toContainText(`${winner} was chosen.`);

    // The winner is now an active vendor, the other still a prospect, and no agreement was made.
    await page.getByRole("tab", { name: "Candidates" }).click();
    await expect(page.getByRole("listitem", { name: winner })).toContainText("Winner");
    await expect(page.getByRole("listitem", { name: winner })).toContainText("Active");
    await expect(page.getByRole("listitem", { name: other })).toContainText("Prospect");
    expect((await call<{ total: number }>(request, "get", "/agreements?pageSize=1")).total).toBe(agreements);
    // Nothing can be changed any more.
    await expect(page.getByRole("button", { name: "Add candidate" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Move" })).toHaveCount(0);

    // Q-10: the whole trail as one PDF.
    await page.getByRole("tab", { name: "Decision" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download decision record" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`${rfp.title} decision record.pdf`);
    const { extractText, getDocumentProxy } = await import("unpdf");
    const { readFile } = await import("node:fs/promises");
    const text = (await extractText(await getDocumentProxy(new Uint8Array(await readFile(await file.path()))), { mergePages: true })).text.replace(/\s+/g, " ");
    for (const part of [
      rfp.title,
      "A tool to submit and approve expense claims.",
      "Chris Tanaka, CTO",
      winner,
      other,
      `Reason for ${winner}`,
      `Reason for ${other}`,
      "Mira Okafor",
      "Alex Admin",
      "4.50",
      "3.00",
      "Highest score, and the strongest references.",
      "Decided on 21 Nov 2026",
    ])
      expect(text, part).toContain(part);
  });
});

test.describe("Q-11 overview", () => {
  test("Q-11 a list of RFPs with stage, owner and target date, and a page per RFP with the current stage and the next step", async ({ page, context, request }) => {
    const mine = await newRfp(request, { targetDecisionDate: "2027-02-28" });
    const cancelled = await newRfp(request);
    await call(request, "post", `/rfps/${cancelled.id}/cancel`, { reason: "The budget was withdrawn." });
    await signInAs(context, MEMBER);
    await page.goto("/");
    await page.getByRole("link", { name: "RFPs" }).click();
    const rows = page.getByRole("table", { name: "RFPs" }).getByRole("row");
    // Running RFPs are shown first; the sample data has one being evaluated and one in drafting.
    await expect(rows.filter({ hasText: "Expense management tool" })).toContainText("Evaluating");
    await expect(rows.filter({ hasText: "Expense management tool" })).toContainText("Mira Okafor");
    await expect(rows.filter({ hasText: "Expense management tool" })).toContainText("31 Dec 2026");
    await expect(rows.filter({ hasText: "Service desk tooling" })).toContainText("Drafting");
    await expect(rows.filter({ hasText: mine.title })).toContainText("28 Feb 2027");
    await expect(rows.filter({ hasText: "Treasury reporting advice" })).toHaveCount(0);
    await expect(rows.filter({ hasText: cancelled.title })).toHaveCount(0);
    await expectAccessible(page);

    // Filters live in the address and survive a reload.
    await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Decided" }).click();
    await expect(rows.filter({ hasText: "Treasury reporting advice" })).toContainText("Won by Emberline Advisory");
    await expect(rows.filter({ hasText: "Expense management tool" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Decided" })).toHaveAttribute("aria-pressed", "true");
    await expect(rows.filter({ hasText: "Treasury reporting advice" })).toBeVisible();
    await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "All" }).click();
    await page.getByLabel("Search by title").fill(cancelled.title);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText("Cancelled");
    await page.getByLabel("Search by title").fill("no such rfp anywhere");
    await expect(page.getByRole("heading", { name: "No RFPs match" })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();

    // A row opens the RFP's own page, with the keyboard (X-1).
    await rows.filter({ hasText: "Expense management tool" }).getByRole("button").first().focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Expense management tool", level: 1 })).toBeVisible();
    await expect(currentStage(page)).toContainText("Evaluating");
    await expect(nextStep(page)).toContainText("Score the candidates");
    await expect(nextStep(page)).toContainText("You have given 8 of 12 scores.");
    // Tabs are reached with the arrow keys, and the chosen tab is in the address.
    await page.getByRole("tab", { name: "Scoring" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Decision" })).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/tab=decision/);
    await page.goBack();
    await expect(page.getByRole("tab", { name: "Scoring" })).toHaveAttribute("aria-selected", "true");

    // The decided and the cancelled one say how they ended.
    await page.goto(`/rfps/${cancelled.id}`);
    await expect(page.getByRole("region", { name: "Next step" })).toContainText("The budget was withdrawn.");
    await expect(page.getByRole("button", { name: "Change the demand" })).toHaveCount(0);
    await page.goto("/rfps/00000000-0000-4000-8000-000000000000");
    await expect(page.getByRole("heading", { name: "RFP not found" })).toBeVisible();
  });

  test("X-1 X-5 every tab of an RFP passes the accessibility check and is ready within 2 seconds", async ({ page, context, request }) => {
    const list = await call<{ items: { id: string; title: string }[] }>(request, "get", "/rfps?pageSize=200");
    const sample = list.items.find((r) => r.title === "Expense management tool")!;
    const decided = list.items.find((r) => r.title === "Treasury reporting advice")!;
    await signInAs(context, MEMBER);
    for (const [rfp, tabs] of [
      [sample, ["overview", "document", "review", "candidates", "responses", "scoring", "decision"]],
      [decided, ["scoring", "decision"]],
    ] as const)
      for (const tab of tabs) {
        const started = Date.now();
        await page.goto(`/rfps/${rfp.id}?tab=${tab}`);
        await expect(page.getByRole("tab", { selected: true })).toHaveText(new RegExp(tab, "i"));
        await expect(page.getByRole("tabpanel")).not.toBeEmpty();
        expect(Date.now() - started, `${rfp.title} ${tab}`).toBeLessThan(2000);
        await expectAccessible(page);
      }
  });
});
