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
/** The text of a Word file's body, and its XML. */
async function word(page: Page, link: string) {
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: link }).click();
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
    const { xml } = await word(page, "Download as Word");
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
    expect((await word(page, "Download as Word")).text).not.toContain("Larkspur");

    await signInAs(context, ADMIN);
    await page.goto("/admin/settings");
    await section
      .getByLabel("Choose the Word template")
      .setInputFiles({ name: "Larkspur & Vale RFP template (invented example).dotx", mimeType: "application/octet-stream", buffer: example });
    await expect(found.getByRole("listitem").filter({ hasText: "[Version]" })).toContainText("Found on the cover page");
    await expectAccessible(page);
    await signInAs(context, MEMBER);
    await open(page, rfp, "review");
    const { text } = await word(page, "Download as Word");
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
