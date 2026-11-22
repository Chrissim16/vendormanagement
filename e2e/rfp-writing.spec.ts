import JSZip from "jszip";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { RfpDetail } from "../shared/rfp";
import { ADMIN, expectAccessible, MEMBER, signInAs } from "./helpers";

/** M11: the RFP editor (Q-12) and the company's Word template (Q-14). */

const BASE = "http://127.0.0.1:4173";
const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function call<T = RfpDetail>(request: APIRequestContext, method: "get" | "post" | "put" | "delete", path: string, data?: unknown, as = MEMBER): Promise<T> {
  const res = await request[method](`${BASE}/api${path}`, { headers: { "x-dev-user": as, cookie: "" }, data });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}
async function drafted(request: APIRequestContext) {
  const me = (await call<{ id: string }>(request, "get", "/me")).id;
  const r = await call(request, "post", "/rfps", { title: unique("Travel tool"), need: "A tool to book and approve business travel.", ownerUserId: me });
  const asked = await call(request, "post", `/rfps/${r.id}/draft`);
  return call(request, "post", `/rfps/${r.id}/draft/review`, { action: "accept", suggestionId: asked.draft!.id });
}
const open = async (page: Page, rfp: { id: string }, tab: string) => {
  await page.goto(`/rfps/${rfp.id}?tab=${tab}`);
  await expect(page.getByRole("tablist", { name: "Parts of this RFP" })).toBeVisible();
};
/** The review copy as the Review tab downloads it: its body's text, and its XML. */
async function word(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download the review copy" }).click();
  const path = await (await download).path();
  const zip = await JSZip.loadAsync(await (await import("node:fs/promises")).readFile(path!));
  const xml = await zip.file("word/document.xml")!.async("string");
  return { zip, xml, text: xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") };
}

test.describe("Q-12 document editor", () => {
  test("Q-12 a section is formatted with buttons and the keyboard, and the Word file holds the same", async ({ page, context, request }) => {
    const rfp = await drafted(request);
    await signInAs(context, MEMBER);
    await open(page, rfp, "document");
    const box = page.getByRole("textbox", { name: "Text of section 1" });
    const tools = page.getByRole("toolbar", { name: "Formatting for text of section 1" });
    // The AI's draft arrived formatted: section 2 has lists under sub-headings, section 3 a table.
    await expect(page.getByRole("textbox", { name: "Text of section 2" }).getByRole("listitem").first()).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Text of section 3" }).locator("table")).toBeVisible();

    await box.fill("");
    await box.pressSequentially("Opening words. ");
    await page.keyboard.press("Control+b");
    await page.keyboard.type("Strong point");
    await page.keyboard.press("Control+b");
    await page.keyboard.type(" and ");
    await page.keyboard.press("Control+i");
    await page.keyboard.type("a soft one");
    await page.keyboard.press("Control+i");
    await page.keyboard.press("Enter");
    await tools.getByRole("button", { name: /^Heading/ }).click();
    await page.keyboard.type("What we need");
    await page.keyboard.press("Enter");
    await tools.getByRole("button", { name: /^Bullet list/ }).click();
    await page.keyboard.type("Booking");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Approval");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    // A numbered list straight from the keyboard.
    await page.keyboard.press("Control+Shift+7");
    await page.keyboard.type("First step");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await tools.getByRole("button", { name: "Insert a table" }).click();
    await page.keyboard.type("Country");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Travellers");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Netherlands");
    await page.keyboard.press("Tab");
    await page.keyboard.type("120");
    await expect(tools.getByRole("button", { name: "Add a row below" })).toBeVisible();
    // Tab at the last cell leaves the editor instead of adding rows: the keyboard is never caught.
    // Two empty cells are left in the third row.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(box).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(box).not.toBeFocused();

    await page.getByRole("button", { name: "Save document" }).click();
    await expect(page.getByText("Document saved")).toBeVisible();
    const saved = await call(request, "get", `/rfps/${rfp.id}`);
    expect(saved.sections[0]!.body).toBe(
      "Opening words. **Strong point** and *a soft one*\n\n## What we need\n\n- Booking\n- Approval\n\n1. First step\n\n| Country | Travellers |\n| --- | --- |\n| Netherlands | 120 |\n|   |   |",
    );

    // After a reload the editor shows the same formatting.
    await page.reload();
    await expect(box.locator("strong")).toHaveText("Strong point");
    await expect(box.locator("em")).toHaveText("a soft one");
    await expect(box.locator("h2")).toHaveText("What we need");
    await expect(box.locator("ul li")).toHaveCount(2);
    await expect(box.locator("ol li")).toHaveCount(1);
    await expect(box.locator("th").first()).toHaveText("Country");

    // The Word file holds the same: bold, italic, a heading, both lists and the table, in the template's styles.
    await page.getByRole("tab", { name: "Review" }).click();
    const { xml } = await word(page);
    expect(xml).toMatch(/<w:b\/><\/w:rPr><w:t xml:space="preserve">Strong point<\/w:t>/);
    expect(xml).toMatch(/<w:i\/><\/w:rPr><w:t xml:space="preserve">a soft one<\/w:t>/);
    expect(xml).toMatch(/<w:pStyle w:val="Heading2"\/><\/w:pPr><w:r><w:t xml:space="preserve">What we need/);
    expect(xml).toMatch(/<w:pStyle w:val="ListBullet"\/>.*Booking/);
    expect(xml).toMatch(/<w:pStyle w:val="ListNumber"\/>.*First step/);
    expect(xml).toMatch(/<w:tbl>.*Country.*Netherlands.*120.*<\/w:tbl>/);
  });

  test("Q-12 text written before M11 opens unchanged as plain paragraphs", async ({ page, context, request }) => {
    // What the server gives for such text is tested on the server; here: it reads as typed in the editor.
    const rfp = await drafted(request);
    const body = "\\# Typed with a hash\n\n\\- typed with a dash\n\n\\*\\*typed with stars\\*\\*";
    await call(request, "put", `/rfps/${rfp.id}/content`, {
      sections: [{ id: rfp.sections[0]!.id, heading: rfp.sections[0]!.heading, body }],
      criteria: rfp.criteria.map((c) => ({ key: c.id, name: c.name, weight: c.weight, part: c.part })),
      questions: rfp.questions.map((q) => ({ text: q.text, criterionKey: q.criterionId })),
    });
    await signInAs(context, MEMBER);
    await open(page, rfp, "document");
    const box = page.getByRole("textbox", { name: "Text of section 1" });
    await expect(box.locator("p")).toHaveText(["# Typed with a hash", "- typed with a dash", "**typed with stars**"]);
    await expect(box.locator("ul, h2, strong")).toHaveCount(0);
  });

  test("Q-12 X-1 the editor passes the automated accessibility checks, light and dark", async ({ page, context, request }) => {
    const rfp = await drafted(request);
    await signInAs(context, MEMBER);
    await open(page, rfp, "document");
    for (const mode of ["light", "dark"]) {
      await page.addInitScript((m) => localStorage.setItem("mode", m), mode);
      await open(page, rfp, "document");
      await page.getByRole("textbox", { name: "Text of section 3" }).locator("td").first().click();
      await expectAccessible(page);
    }
  });
});

test.describe("Q-14 company Word template", () => {
  test("Q-14 an admin uploads a template, is told what was found and what is missing, and every Word file uses it", async ({ page, context, request }) => {
    const example = Buffer.from(await (await request.get(`${BASE}/api/admin/word-template/example`, { headers: { "x-dev-user": ADMIN, cookie: "" } })).body());
    const rfp = await drafted(request);
    await signInAs(context, ADMIN);
    await page.goto("/admin/settings");
    const section = page.getByRole("region", { name: "Word template" });
    await expect(section.getByRole("status")).toContainText("Larkspur & Vale RFP template (invented example).dotx");

    // A document without marks: taken, and each missing mark is named with what to do.
    const plain = await new JSZip().loadAsync(example);
    const doc = await plain.file("word/document.xml")!.async("string");
    plain.file("word/document.xml", doc.replace(/\[(Date|Version)\]/g, ""));
    await section.getByLabel("Choose the Word template").setInputFiles({
      name: "Without date and version.dotx",
      mimeType: "application/octet-stream",
      buffer: await plain.generateAsync({ type: "nodebuffer" }),
    });
    await expect(page.getByText("Template uploaded. Word files made from now on use it.")).toBeVisible();
    const found = section.getByRole("list", { name: "What the app found in the template" });
    await expect(found.getByRole("listitem").filter({ hasText: "[Title]" })).toContainText("Found on the cover page and header.");
    await expect(found.getByRole("listitem").filter({ hasText: "[Date]" })).toContainText("Not found. Type [Date] on the cover page");
    await expect(found.getByRole("listitem").filter({ hasText: "[Version]" })).toContainText("Missing");
    await expect(found.getByRole("listitem").filter({ hasText: "Pictures" })).toContainText("Found");
    await expect(found.getByRole("listitem").filter({ hasText: "Font" })).toContainText("Georgia");
    await expect(page.getByRole("list", { name: "History" }).first()).toContainText("Without date and version.dotx");

    // A file of another kind is refused before anything is sent.
    await section.getByLabel("Choose the Word template").setInputFiles({ name: "template.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") });
    await expect(section.getByText("Choose a Word template (.dotx) or a Word document (.docx).")).toBeVisible();

    // The plain layout, and back to the example.
    await section.getByRole("button", { name: "Use the plain layout instead" }).click();
    await section.getByRole("button", { name: /Really use the plain layout/ }).click();
    await expect(section.getByRole("status")).toContainText("the app's own plain layout is used");
    await signInAs(context, MEMBER);
    await open(page, rfp, "review");
    expect((await word(page)).text).not.toContain("Larkspur");

    await signInAs(context, ADMIN);
    await page.goto("/admin/settings");
    await section
      .getByLabel("Choose the Word template")
      .setInputFiles({ name: "Larkspur & Vale RFP template (invented example).dotx", mimeType: "application/octet-stream", buffer: example });
    await expect(found.getByRole("listitem").filter({ hasText: "[Version]" })).toContainText("Found on the cover page");
    await expectAccessible(page);
    await signInAs(context, MEMBER);
    await open(page, rfp, "review");
    const { text } = await word(page);
    expect(text).toContain("Larkspur");
    expect(text).toContain(rfp.title);
    expect(text).toContain("Issued on 21 Nov 2026");
  });

  test("Q-14 a member does not see the template on the settings page and cannot reach it", async ({ page, context, request }) => {
    await signInAs(context, MEMBER);
    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Word template" })).toHaveCount(0);
    expect((await request.get(`${BASE}/api/admin/word-template`, { headers: { "x-dev-user": MEMBER, cookie: "" } })).status()).toBe(403);
  });
});

test.describe("Q-13 review rounds with comments from Word", () => {
  test("Q-13 a review copy is downloaded as version 1, a reviewer's file is uploaded, and every remark is dealt with before approval", async ({ page, context, request }) => {
    const rfp = await drafted(request);
    await call(request, "post", `/rfps/${rfp.id}/stage`, { to: "in_review" });
    await signInAs(context, MEMBER);
    await open(page, rfp, "review");

    // Downloading starts round 1; the version is in the file's name and on its cover.
    let download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download the review copy" }).click();
    const v1 = await download;
    expect(v1.suggestedFilename()).toBe(`${rfp.title} RFP review copy v1.docx`);
    const copy = await (await import("node:fs/promises")).readFile((await v1.path())!);
    expect(await (await JSZip.loadAsync(copy)).file("word/document.xml")!.async("string")).toContain("Version 1");
    const rounds = page.getByRole("list", { name: "Review rounds" });
    await expect(rounds.getByRole("listitem").first()).toContainText("Version 1");

    // Without a change, the same version again.
    download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download the review copy" }).click();
    expect((await download).suggestedFilename()).toBe(`${rfp.title} RFP review copy v1.docx`);
    await expect(page.getByText("Nothing changed since version 1: that copy is downloaded again.")).toBeVisible();

    // The reviewer comments and suggests edits in Word, and sends it back.
    const { annotate } = await import("../server/features/rfp/word/annotate");
    const returned = await annotate(copy, [
      { replace: "as PDF or Word", by: "as PDF", author: "Chris Tanaka", under: "How to respond" },
      { comment: "Name the systems it must connect to.", on: "as described in the introduction", author: "Chris Tanaka", under: "Scope and requirements" },
      { comment: "Ask for the price per traveller.", on: "pricing model", author: "Priya Raman", under: "Questions" },
    ]);
    await page.getByLabel("Choose a returned Word file for version 1").setInputFiles({ name: "Chris and Priya.docx", mimeType: "application/octet-stream", buffer: returned });
    await expect(page.getByText("2 comments and 1 suggested edit read from Chris Tanaka, Priya Raman. 1 could not be placed in a section.")).toBeVisible();
    await expect(rounds).toContainText("Chris and Priya.docx");

    // Each remark next to its section; the one on the questions under "Not placed".
    await expect(page.getByRole("list", { name: "Open remarks on How to respond" })).toContainText("as PDF or Word");
    await expect(page.getByRole("list", { name: "Open remarks on Scope and requirements" })).toContainText("On: as described in the introduction");
    const unplaced = page.getByRole("list", { name: "Remarks not placed" });
    await expect(unplaced).toContainText('under "Questions" in the file, not placed');

    // Approval is blocked while one is open.
    await call(request, "post", `/rfps/${rfp.id}/signoffs`, { reviewerName: "Chris Tanaka", outcome: "approved", onDate: "2026-11-21" });
    await page.reload();
    await expect(page.getByRole("button", { name: "Mark as approved" })).toBeDisabled();
    await expect(page.getByText("3 reviewers' remarks from Word are still open").last()).toBeVisible();

    // Take the edit over: the section changes.
    await page.getByRole("list", { name: "Open remarks on How to respond" }).getByRole("button", { name: "Take over this edit" }).click();
    await expect(page.getByText("Edit taken over into the section")).toBeVisible();
    const after = await call(request, "get", `/rfps/${rfp.id}`);
    expect(after.sections.find((s) => s.heading === "How to respond")!.body).toContain("any supporting material, as PDF.");
    // The comment: dealt with by hand. The unplaced one: put in a section, then set aside.
    await page.getByRole("list", { name: "Open remarks on Scope and requirements" }).getByRole("button", { name: "Dealt with by hand" }).click();
    await unplaced.getByLabel(/Section for the comment by Priya Raman/).selectOption({ label: "How responses are evaluated" });
    await unplaced.getByRole("button", { name: "Place in section" }).click();
    await page.getByRole("list", { name: "Open remarks on How responses are evaluated" }).getByRole("button", { name: "Set aside" }).click();
    await expect(page.getByText("All 3 remarks are dealt with or set aside.")).toBeVisible();

    // Taking the edit over changed the document, so a new approval is needed; then approval is open.
    await call(request, "post", `/rfps/${rfp.id}/signoffs`, { reviewerName: "Chris Tanaka", outcome: "approved", onDate: "2026-11-21" });
    await page.reload();
    await expect(page.getByRole("button", { name: "Mark as approved" })).toBeEnabled();

    // What was done with each stays with the round.
    await page.getByText("All remarks of version 1 (3) and what was done with each").click();
    const all = rounds.getByRole("listitem").first();
    await expect(all).toContainText("Dealt with, taken over by Mira Okafor");
    await expect(all).toContainText("Dealt with, by hand by Mira Okafor");
    await expect(all).toContainText("Set aside by Mira Okafor");
    await expectAccessible(page);

    // The next download holds the change and is version 2; version 1 can still be downloaded.
    download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download the review copy" }).click();
    expect((await download).suggestedFilename()).toBe(`${rfp.title} RFP review copy v2.docx`);
    download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download version 1" }).click();
    expect((await download).suggestedFilename()).toBe(`${rfp.title} RFP review copy v1.docx`);
  });

  test("Q-13 a file that is not a review copy of this RFP is refused, and says why", async ({ page, context, request }) => {
    const rfp = await drafted(request);
    await call(request, "post", `/rfps/${rfp.id}/stage`, { to: "in_review" });
    await call(request, "post", `/rfps/${rfp.id}/review-rounds`);
    await signInAs(context, MEMBER);
    await open(page, rfp, "review");
    const plain = await new JSZip().loadAsync(
      Buffer.from(await (await request.get(`${BASE}/api/admin/word-template/example`, { headers: { "x-dev-user": ADMIN, cookie: "" } })).body()),
    );
    await page.getByLabel("Choose a returned Word file for version 1").setInputFiles({
      name: "Something else.docx",
      mimeType: "application/octet-stream",
      buffer: await plain.generateAsync({ type: "nodebuffer" }),
    });
    await expect(page.getByText("That file is not a review copy made by the app")).toBeVisible();
    await page.getByLabel("Choose a returned Word file for version 1").setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") });
    await expect(page.getByText("Choose the Word file the reviewer sent back (.docx).")).toBeVisible();
  });

  test("Q-13 the remarks stand next to their section on the Document tab too", async ({ page, context, request }) => {
    const rfp = await drafted(request);
    await call(request, "post", `/rfps/${rfp.id}/stage`, { to: "in_review" });
    const { roundId } = await call<{ roundId: string }>(request, "post", `/rfps/${rfp.id}/review-rounds`);
    const copy = Buffer.from(await (await request.get(`${BASE}/api/rfp-review-rounds/${roundId}/review-copy.docx`, { headers: { "x-dev-user": MEMBER, cookie: "" } })).body());
    const { annotate } = await import("../server/features/rfp/word/annotate");
    const res = await request.post(`${BASE}/api/rfp-review-rounds/${roundId}/files`, {
      headers: { "x-dev-user": MEMBER, cookie: "" },
      multipart: {
        file: {
          name: "back.docx",
          mimeType: "application/octet-stream",
          buffer: await annotate(copy, [{ replace: "as PDF or Word", by: "as PDF", author: "Chris Tanaka", under: "How to respond" }]),
        },
      },
    });
    expect(res.ok()).toBe(true);
    await signInAs(context, MEMBER);
    await open(page, rfp, "document");
    await page.getByText("1 open remark from reviewers on How to respond").click();
    const remarks = page.getByRole("list", { name: "Open remarks on How to respond" });
    // While something typed is unsaved, nothing that changes a section can happen.
    await page.getByRole("textbox", { name: "Text of section 1" }).pressSequentially(" More.");
    await expect(remarks.getByRole("button", { name: "Take over this edit" })).toBeDisabled();
    await page.getByRole("button", { name: "Discard changes" }).click();
    await remarks.getByRole("button", { name: "Take over this edit" }).click();
    await expect(page.getByRole("textbox", { name: "Text of section 4" })).toContainText("any supporting material, as PDF.");
    await expect(page.getByText("1 open remark from reviewers on How to respond")).toHaveCount(0);
  });
});

test.describe("Q-12 the AI rewrites a section", () => {
  test("Q-12 a rewrite asked in the member's own words is shown next to the text with the differences marked, and changes nothing until used", async ({
    page,
    context,
    request,
  }) => {
    const rfp = await drafted(request);
    await signInAs(context, MEMBER);
    await open(page, rfp, "document");
    const section = page.locator(`#section-${rfp.sections[5]!.id}`);
    await section.getByRole("button", { name: "Rewrite with AI" }).click();
    await expect(page.getByLabel("What should change in this section?")).toBeFocused();
    // Nothing asked for: said in place.
    await page.getByRole("button", { name: "Ask the AI" }).click();
    await expect(page.getByText("Say what to change, or choose a reviewer's remark to rewrite for.")).toBeVisible();
    await page.getByLabel("What should change in this section?").fill("Make it shorter");
    await page.getByRole("button", { name: "Ask the AI" }).click();
    const panel = page.getByRole("region", { name: "AI rewrite of Confidentiality and terms" });
    await expect(panel).toContainText('for "Make it shorter"');
    await expect(panel).toContainText("Not reviewed yet");
    // The words the rewrite takes out are struck through on the left.
    await expect(panel.locator("del").first()).toBeVisible();
    // Nothing changed yet.
    expect((await call(request, "get", `/rfps/${rfp.id}`)).sections[5]!.body).toBe(rfp.sections[5]!.body);

    // Edit it first, then use it.
    await panel.getByRole("button", { name: "Edit before using" }).click();
    const box = page.getByRole("textbox", { name: "Edited rewrite of Confidentiality and terms" });
    await box.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" Thank you.");
    await panel.getByRole("button", { name: "Use the edited text" }).click();
    await expect(page.getByText("Your edited version of the rewrite is now the section's text")).toBeVisible();
    await expect(section.getByText(/AI rewrite of .*: accepted with changes by Mira Okafor\./)).toBeVisible();
    const after = await call(request, "get", `/rfps/${rfp.id}`);
    expect(after.sections[5]!.body).toMatch(/Thank you\.$/);
    expect(after.sections[5]!.rewrite!.status).toBe("edited");
    await expect(page.getByRole("textbox", { name: "Text of section 6" })).toContainText("Thank you.");
  });

  test("Q-12 Q-13 a rewrite for a reviewer's remark is asked from the Review tab, and using it deals with the remark", async ({ page, context, request }) => {
    const rfp = await drafted(request);
    await call(request, "post", `/rfps/${rfp.id}/stage`, { to: "in_review" });
    const { roundId } = await call<{ roundId: string }>(request, "post", `/rfps/${rfp.id}/review-rounds`);
    const copy = Buffer.from(await (await request.get(`${BASE}/api/rfp-review-rounds/${roundId}/review-copy.docx`, { headers: { "x-dev-user": MEMBER, cookie: "" } })).body());
    const { annotate } = await import("../server/features/rfp/word/annotate");
    const res = await request.post(`${BASE}/api/rfp-review-rounds/${roundId}/files`, {
      headers: { "x-dev-user": MEMBER, cookie: "" },
      multipart: {
        file: {
          name: "back.docx",
          mimeType: "application/octet-stream",
          buffer: await annotate(copy, [{ replace: "confidential", by: "strictly confidential", author: "Priya Raman", under: "Confidentiality and terms" }]),
        },
      },
    });
    expect(res.ok()).toBe(true);
    await signInAs(context, MEMBER);
    await open(page, rfp, "review");
    await page.getByRole("list", { name: "Open remarks on Confidentiality and terms" }).getByRole("button", { name: "Ask the AI to rewrite for it" }).click();
    // On the Document tab, the form is open with the remark ticked.
    await expect(page.getByRole("tab", { name: "Document" })).toHaveAttribute("aria-selected", "true");
    const form = page.getByRole("group", { name: "Ask the AI to rewrite Confidentiality and terms" });
    await expect(form.getByRole("checkbox")).toBeChecked();
    await form.getByRole("button", { name: "Ask the AI" }).click();
    const panel = page.getByRole("region", { name: "AI rewrite of Confidentiality and terms" });
    await expect(panel).toContainText("for a remark by Priya Raman");
    await expect(panel.locator("ins")).toContainText(["strictly"]);
    await expectAccessible(page);
    await panel.getByRole("button", { name: "Use this text" }).click();
    await expect(page.getByText("The rewrite is now the section's text")).toBeVisible();
    const after = await call(request, "get", `/rfps/${rfp.id}`);
    expect(after.sections[5]!.body).toContain("strictly confidential");
    expect(after.review.remarks[0]).toMatchObject({ status: "dealt_with", resolution: "ai_rewrite" });
  });

  test("Q-12 AI-2 when the AI cannot answer, the page says so and the section stays as it was", async ({ page, context, request }) => {
    const rfp = await drafted(request);
    await request.post(`${BASE}/api/dev/ai`, { headers: { "x-dev-user": ADMIN, cookie: "" }, data: { mode: "unavailable" } });
    await signInAs(context, MEMBER);
    await open(page, rfp, "document");
    const section = page.locator(`#section-${rfp.sections[0]!.id}`);
    await section.getByRole("button", { name: "Rewrite with AI" }).click();
    await page.getByLabel("What should change in this section?").fill("Shorter");
    await page.getByRole("button", { name: "Ask the AI" }).click();
    await expect(section.getByText("The AI could not rewrite this section just now.")).toBeVisible();
    await expect(page.getByLabel("What should change in this section?")).toHaveValue("Shorter");
    await request.post(`${BASE}/api/dev/ai`, { headers: { "x-dev-user": ADMIN, cookie: "" }, data: { mode: "working" } });
  });

  test("Q-12 no rewrite once the RFP is approved", async ({ page, context, request }) => {
    const rfp = await drafted(request);
    await call(request, "post", `/rfps/${rfp.id}/stage`, { to: "in_review" });
    await call(request, "post", `/rfps/${rfp.id}/signoffs`, { reviewerName: "Chris Tanaka", outcome: "approved", onDate: "2026-11-21" });
    await call(request, "post", `/rfps/${rfp.id}/stage`, { to: "approved" });
    await signInAs(context, MEMBER);
    await open(page, rfp, "document");
    await expect(page.getByRole("button", { name: "Rewrite with AI" })).toHaveCount(0);
    const res = await request.post(`${BASE}/api/rfp-sections/${rfp.sections[0]!.id}/rewrite`, { headers: { "x-dev-user": MEMBER, cookie: "" }, data: { instruction: "Shorter" } });
    expect(res.status()).toBe(409);
  });
});

test.describe("Q-13 files of another RFP or another version", () => {
  /** An RFP in review with a first round, and its review copy. */
  async function withRound(request: APIRequestContext) {
    const rfp = await drafted(request);
    await call(request, "post", `/rfps/${rfp.id}/stage`, { to: "in_review" });
    const { roundId } = await call<{ roundId: string }>(request, "post", `/rfps/${rfp.id}/review-rounds`);
    const copy = Buffer.from(await (await request.get(`${BASE}/api/rfp-review-rounds/${roundId}/review-copy.docx`, { headers: { "x-dev-user": MEMBER, cookie: "" } })).body());
    return { rfp, copy };
  }

  test("Q-13 a review copy of another RFP is refused, and one of an earlier version goes to its own round with a note that says so", async ({ page, context, request }) => {
    const mine = await withRound(request);
    const other = await withRound(request);
    // A change, so the next download is version 2.
    await request.patch(`${BASE}/api/rfps/${mine.rfp.id}`, { headers: { "x-dev-user": MEMBER, cookie: "" }, data: { need: "A changed need, for a second version." } });
    await call(request, "post", `/rfps/${mine.rfp.id}/review-rounds`);
    await signInAs(context, MEMBER);
    await open(page, mine.rfp, "review");
    await page.getByLabel("Choose a returned Word file for version 2").setInputFiles({ name: "Other RFP.docx", mimeType: "application/octet-stream", buffer: other.copy });
    await expect(page.getByText("That file is a review copy of another RFP. Upload it on that RFP's Review tab.")).toBeVisible();

    const { annotate } = await import("../server/features/rfp/word/annotate");
    const back = await annotate(mine.copy, [{ comment: "Still fine?", on: "as described in the introduction", author: "Ann Berg", under: "Scope and requirements" }]);
    await page.getByLabel("Choose a returned Word file for version 2").setInputFiles({ name: "Ann on version 1.docx", mimeType: "application/octet-stream", buffer: back });
    await expect(page.getByRole("status").filter({ hasText: "Ann on version 1.docx is a copy of version 1, not 2, so it was added to version 1's round." })).toBeVisible();
    await expect(page.getByRole("list", { name: "Files returned for version 1" })).toContainText("Ann on version 1.docx");
    await expect(page.getByRole("list", { name: "Open remarks on Scope and requirements" })).toContainText("version 1");
  });

  test("Q-13 an edit is not taken over on the Review tab while the document has unsaved changes", async ({ page, context, request }) => {
    const { rfp, copy } = await withRound(request);
    const { annotate } = await import("../server/features/rfp/word/annotate");
    const res = await request.post(`${BASE}/api/rfps/${rfp.id}/review-rounds`, { headers: { "x-dev-user": MEMBER, cookie: "" } });
    const { roundId } = (await res.json()) as { roundId: string };
    await request.post(`${BASE}/api/rfp-review-rounds/${roundId}/files`, {
      headers: { "x-dev-user": MEMBER, cookie: "" },
      multipart: {
        file: {
          name: "back.docx",
          mimeType: "application/octet-stream",
          buffer: await annotate(copy, [{ replace: "confidential", by: "strictly confidential", author: "Priya Raman", under: "Confidentiality and terms" }]),
        },
      },
    });
    await signInAs(context, MEMBER);
    await open(page, rfp, "document");
    await page.getByRole("textbox", { name: "Text of section 1" }).pressSequentially(" Typed.");
    await page.getByRole("tab", { name: "Review" }).click();
    await expect(page.getByText("The document has changes on the Document tab that are not saved.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Take over this edit" })).toBeDisabled();
    await page.getByRole("button", { name: "Go to the document" }).click();
    await page.getByRole("button", { name: "Save document" }).click();
    await expect(page.getByText("Document saved")).toBeVisible();
    await page.getByRole("tab", { name: "Review" }).click();
    await page.getByRole("button", { name: "Take over this edit" }).click();
    await expect(page.getByText("Edit taken over into the section")).toBeVisible();
    const after = await call(request, "get", `/rfps/${rfp.id}`);
    expect(after.sections[0]!.body).toContain("Typed.");
    expect(after.sections[5]!.body).toContain("strictly confidential");
  });
});
