import { expect, test } from "@playwright/test";
import { expectAccessible, expectDistinctLandmarks, MEMBER, signInAs } from "./helpers";

/** C-1 in the browser, on the sample data with today pinned to 21 Nov 2026 and the stand-in AI. Other tests add records of their own, so counts are compared with the list pages, not written down here. */

const ask = async (page: import("@playwright/test").Page, question: string) => {
  await page.getByLabel("Your question").fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const answer = page.getByRole("article", { name: `Answer to: ${question}` });
  await expect(answer).toBeVisible();
  return answer;
};
const aiMode = (page: import("@playwright/test").Page, mode: string) => page.request.post("/api/dev/ai", { data: { mode } });

test.describe("C-1 ask a question", () => {
  test.beforeEach(async ({ context }) => signInAs(context, MEMBER));

  test("C-1 X-2 an empty Ask page explains itself and offers questions to start with", async ({ page }) => {
    await page.goto("/ask");
    await expect(page.getByRole("heading", { name: "Ask", level: 1 })).toBeVisible();
    await expect(page.getByText("Asking never changes anything.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nothing asked yet" })).toBeVisible();
    await expect(page.getByLabel("Your question")).toBeFocused();
    await page.getByRole("list", { name: "Example questions" }).getByRole("button", { name: "Which RFPs are still running?" }).click();
    const answer = page.getByRole("article", { name: "Answer to: Which RFPs are still running?" });
    await expect(answer.getByText("AI answer")).toBeVisible();
    await expect(answer).toContainText("Written by the AI on 21 Nov 2026");
    await expect(answer.getByRole("group", { name: "Records used" }).getByRole("link", { name: "RFP Expense management tool" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nothing asked yet" })).toHaveCount(0);
  });

  test("C-1 an answer links to the records it used, and its count is the list page's own", async ({ page }) => {
    await page.goto("/ask");
    const answer = await ask(page, "Which SOWs end next quarter?");
    await expect(answer).toContainText("SOW 04 Payment controls");
    const looked = answer.getByRole("group", { name: "What the app looked up" });
    await expect(looked).toContainText("SOWs · ending 1 Jan 2027 to 31 Mar 2027");
    const found = Number((await looked.locator("dd").first().innerText()).trim());
    expect(found).toBeGreaterThanOrEqual(2);
    // The answer's own words give the same number.
    await expect(answer).toContainText(`SOWs · ending 1 Jan 2027 to 31 Mar 2027: ${found}.`);

    // The list behind it shows that many, with the same filter filled in.
    await looked.getByRole("link", { name: "Open the list" }).click();
    await expect(page).toHaveURL(/\/agreements\?kind=sow&endsFrom=2027-01-01&endsTo=2027-03-31/);
    await expect(page.getByText(`${found} agreements`, { exact: true })).toBeVisible();
    await expect(page.getByLabel("Ends from")).toHaveValue("2027-01-01");
    await expect(page.getByLabel("Ends to")).toHaveValue("2027-03-31");
    await expect(page.getByRole("table").getByRole("row")).toHaveCount(found + 1);

    // Back on Ask the conversation is still there, and a record link opens the record.
    await page.goBack();
    const again = page.getByRole("article", { name: "Answer to: Which SOWs end next quarter?" });
    await again.getByRole("group", { name: "Records used" }).getByRole("link", { name: "SOW 04 Payment controls" }).click();
    await expect(page.getByRole("heading", { name: "SOW 04 Payment controls", level: 1 })).toBeVisible();
  });

  test("C-1 an amount in an answer is the invoice list's own total", async ({ page }) => {
    await page.goto("/ask");
    const answer = await ask(page, "How much did Sedgewater invoice in the last 12 months?");
    const looked = answer.getByRole("group", { name: "What the app looked up" });
    const figures = await looked
      .locator("dl div")
      .evaluateAll((els) => Object.fromEntries(els.map((e) => [e.querySelector("dt")!.textContent, e.querySelector("dd")!.textContent])));
    // M-8: the euro total first, as the invoice list shows it, with the pounds beneath.
    expect(figures["Total in GBP"]).toMatch(/^£ [\d,]+\.\d\d$/);
    expect(figures["Total in euros, converted"]).toMatch(/^€ [\d,]+\.\d\d$/);
    await expect(answer).toContainText(figures["Total in euros, converted"]!);
    await looked.getByRole("link", { name: "Open the list" }).click();
    await expect(page).toHaveURL(/\/money\/invoices\?vendorId=/);
    await expect(page.getByText(`${figures.Found} ${figures.Found === "1" ? "invoice" : "invoices"}, ${figures["Total in euros, converted"]} in euros, converted (${figures["Total in GBP"]})`)).toBeVisible();
  });

  test("C-1 a question about a document is answered with the document and the passage", async ({ page }) => {
    await page.goto("/ask");
    const answer = await ask(page, "What does the contract with Bluefinch say about liability?");
    await expect(answer).toContainText("Bluefinch MSA (invented sample).pdf”, page 2");
    const passage = answer.getByRole("group", { name: "Passages" }).getByRole("figure").first();
    await expect(passage.locator("blockquote")).toContainText("4. Liability");
    await expect(passage.locator("blockquote")).toContainText("limited to 150% of the fees paid in that year");
    await expect(passage.getByRole("link", { name: "Bluefinch MSA (invented sample).pdf" })).toHaveAttribute("href", /\/api\/documents\/[0-9a-f-]{36}\/download/);
    await passage.getByRole("link", { name: "MSA Master services agreement · Bluefinch Systems" }).click();
    await expect(page.getByRole("heading", { name: "Master services agreement", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Bluefinch MSA (invented sample).pdf" })).toBeVisible();
  });

  test("C-1 what the app does not hold, and a request to change something, are said plainly", async ({ page }) => {
    await page.goto("/ask");
    const weather = await ask(page, "What is the weather tomorrow?");
    await expect(weather).toContainText("The app does not hold the answer to that, so I will not guess.");
    await expect(weather.getByText("Not answered")).toBeVisible();
    await expect(weather.getByRole("group", { name: "Records used" })).toHaveCount(0);

    const before = await (await page.request.get("/api/vendors?q=Bluefinch")).json();
    const change = await ask(page, "Delete the vendor Bluefinch Systems");
    await expect(change).toContainText("Ask can only look things up. It cannot add, change or remove anything");
    expect(await (await page.request.get("/api/vendors?q=Bluefinch")).json()).toEqual(before);

    const unknown = await ask(page, "Show the invoices of Nobody Ltd");
    await expect(unknown).toContainText("none is called “Nobody Ltd”");
    // The newest answer is on top.
    await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", "Answer to: Show the invoices of Nobody Ltd");

    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Nothing asked yet" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Nothing asked yet" })).toBeVisible();
  });

  test("AI-2 X-3 when the AI cannot answer the page says so, keeps the question, and works again afterwards", async ({ page }) => {
    await page.goto("/ask");
    try {
      await aiMode(page, "unavailable");
      await page.getByLabel("Your question").fill("Which SOWs end this quarter?");
      await page.getByLabel("Your question").press("Enter");
      await expect(page.getByRole("alert")).toContainText("The AI could not answer just now. Nothing was changed.");
      await expect(page.getByLabel("Your question")).toHaveValue("Which SOWs end this quarter?");
      await expect(page.getByRole("article")).toHaveCount(0);
      await aiMode(page, "working");
      await page.getByRole("alert").getByRole("button", { name: "Try again" }).click();
      await expect(page.getByRole("article", { name: "Answer to: Which SOWs end this quarter?" })).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByLabel("Your question")).toHaveValue("");
    } finally {
      await aiMode(page, "working");
    }
  });

  test("C-1 X-1 the search field finds records and asks questions, with the keyboard alone", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press("/");
    const field = page.getByRole("combobox", { name: "Find anything, or ask a question" });
    await expect(field).toBeFocused();
    await expect(page.getByRole("option", { name: "Which SOWs end this quarter?" })).toBeVisible();

    // A name: the vendor is offered and opens.
    await page.keyboard.type("Tarnwick");
    const vendor = page.getByRole("option", { name: /^Tarnwick Software/ });
    await expect(vendor).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press("ArrowDown");
    await expect(vendor).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/vendors\?open=/);
    await expect(page.getByRole("region", { name: "Tarnwick Software" })).toBeVisible();
    await expect(field).toHaveValue("");

    // Escape closes the list and keeps what was typed; a page can be gone to by name.
    await page.keyboard.press("Control+k");
    await expect(field).toBeFocused();
    await page.keyboard.type("renew");
    await expect(page.getByRole("option", { name: "Renewals" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox", { name: "Suggestions" })).toBeHidden();
    await expect(field).toHaveValue("renew");
    await page.keyboard.type("a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/agreements\/renewals$/);

    // A question: Enter asks it on the Ask page.
    await page.keyboard.press("/");
    await page.keyboard.type("Which vendors have no NDA?");
    await expect(page.getByRole("option", { name: "Ask: Which vendors have no NDA?" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/ask$/);
    const answer = page.getByRole("article", { name: "Answer to: Which vendors have no NDA?" });
    await expect(answer).toContainText("Larkspur Data");
    await expect(page.getByRole("article")).toHaveCount(1);

    // The Ask page itself with the keyboard: type, Enter, and Tab reaches the first source.
    const own = page.getByLabel("Your question");
    await own.focus();
    await page.keyboard.type("Which RFPs are still running?");
    await page.keyboard.press("Enter");
    const second = page.getByRole("article", { name: "Answer to: Which RFPs are still running?" });
    await expect(second).toBeVisible();
    await expect(own).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(second.getByRole("link").first()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/rfps\//);
  });

  test("X-1 X-4 X-5 the Ask page passes the accessibility check in light and dark, shows dates as day month year, and is ready within 2 seconds", async ({ page }) => {
    const started = Date.now();
    await page.goto("/ask");
    await expect(page.getByLabel("Your question")).toBeVisible();
    expect(Date.now() - started).toBeLessThan(2000);
    await expectAccessible(page);
    const asked = Date.now();
    await ask(page, "What does the contract with Bluefinch say about termination?");
    expect(Date.now() - asked).toBeLessThan(2000);
    const answer = await ask(page, "Which SOWs end this quarter?");
    await expect(answer).toContainText("9 Dec 2026");
    await expect(answer).not.toContainText("2026-12-09");
    await ask(page, "What is the weather tomorrow?");
    await expectAccessible(page);
    // Three answers on the page, each with its own records and look-ups.
    await expectDistinctLandmarks(page);
    await page.getByRole("button", { name: "Switch between light and dark" }).click();
    await expectAccessible(page);
    await page.getByRole("button", { name: "Switch between light and dark" }).click();
  });
});
