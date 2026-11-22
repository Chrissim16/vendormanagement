import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { rfpWord, type WordContent } from "../files";
import { annotate } from "./annotate";
import { exampleTemplate } from "./example";
import { readRemarks } from "./review";

const content: WordContent = {
  title: "Travel tool",
  need: "Internal need.",
  budgetMinor: null,
  currency: "EUR",
  sponsor: null,
  demandApprovedOn: null,
  targetDecisionDate: null,
  ownerName: "Mira Okafor",
  writtenWeight: 100,
  demoWeight: 0,
  sections: [
    { id: "s1", heading: "Introduction", body: "We invite you to respond by **1 March** at the latest.\n\n- Booking\n- Approval" },
    { id: "s2", heading: "Scope", body: "The tool covers all travel." },
    { id: "s3", heading: "Introduction", body: "A second section with the same heading." },
  ],
  criteria: [{ id: "k1", name: "Fit", weight: 100, part: "written" }],
  questions: [{ id: "q1", number: 1, text: "How do you handle approvals?", criterionId: "k1" }],
};
const copy = () => exampleTemplate().then((template) => rfpWord(content, { template, today: "2026-11-22", version: 1, review: { rfpId: "r" } }));

describe("Q-13 reading comments and tracked changes from a returned Word file", () => {
  it("reads each comment with its reviewer, the words it was made on and the heading it stands under", async () => {
    const file = await annotate(await copy(), [
      { comment: "Is this date realistic?", on: "1 March", author: "Chris Tanaka", under: "Introduction", reply: { author: "Ann Berg", text: "Agreed, too early." } },
      { comment: "Which countries?", on: "all travel", author: "Ann Berg", under: "Scope" },
      { comment: "Ask about mobile approval too.", on: "approvals", author: "Ann Berg", under: "Questions" },
    ]);
    const remarks = await readRemarks(await JSZip.loadAsync(file));
    expect(remarks.map((r) => [r.kind, r.author, r.foundUnder, r.anchorText, r.text])).toEqual([
      ["comment", "Chris Tanaka", "Introduction", "1 March", "Is this date realistic?"],
      ["comment", "Ann Berg", "Introduction", "1 March", "Agreed, too early."],
      ["comment", "Ann Berg", "Scope", "all travel", "Which countries?"],
      ["comment", "Ann Berg", "Questions", "approvals", "Ask about mobile approval too."],
    ]);
  });

  it("reads a tracked change as a suggested edit: what would go, what would come, and the words around it", async () => {
    const file = await annotate(await copy(), [
      { replace: "1 March", by: "15 March", author: "Chris Tanaka", under: "Introduction" },
      { replace: "Approval", by: "Approval by the manager", author: "Ann Berg", under: "Introduction" },
      { replace: "all travel", by: "business travel", author: "Ann Berg", under: "Scope" },
    ]);
    const remarks = await readRemarks(await JSZip.loadAsync(file));
    expect(remarks).toHaveLength(3);
    expect(remarks[0]).toMatchObject({
      kind: "suggested_edit",
      author: "Chris Tanaka",
      foundUnder: "Introduction",
      removedText: "1 March",
      addedText: "15 March",
      afterText: " at the latest.",
    });
    expect(remarks[0]!.beforeText).toBe("We invite you to respond by ");
    expect(remarks[1]).toMatchObject({ removedText: "Approval", addedText: "Approval by the manager", beforeText: "", afterText: "" });
    expect(remarks[2]).toMatchObject({ foundUnder: "Scope", removedText: "all travel", addedText: "business travel" });
  });

  it("tells two sections with the same heading apart by their order", async () => {
    const file = await annotate(await copy(), [{ comment: "Second one", on: "same heading", author: "Ann Berg" }]);
    const [r] = await readRemarks(await JSZip.loadAsync(file));
    expect(r).toMatchObject({ foundUnder: "Introduction", occurrence: 1 });
  });

  it("finds nothing in a copy nobody commented on", async () => {
    expect(await readRemarks(await JSZip.loadAsync(await copy()))).toEqual([]);
  });
});

describe("Q-13 what the reader takes care of", () => {
  it("marks an edit made in a heading as such", async () => {
    const file = await annotate(await copy(), [{ replace: "Scope", by: "Scope of work", author: "Ann Berg", under: "Scope" }]);
    const [r] = await readRemarks(await JSZip.loadAsync(file));
    expect(r).toMatchObject({ kind: "suggested_edit", foundUnder: "Scope", inHeading: true, removedText: "Scope", addedText: "Scope of work" });
  });

  it("reads a text box once, takes no tab stop for a character, and refuses a file with more remarks than it reads", async () => {
    const zip = await JSZip.loadAsync(await copy());
    let xml = await zip.file("word/document.xml")!.async("string");
    const box = (t: string) =>
      `<w:p><w:r><mc:AlternateContent><mc:Choice><w:txbxContent><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:txbxContent></mc:Choice><mc:Fallback><w:txbxContent><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:txbxContent></mc:Fallback></mc:AlternateContent></w:r></w:p>`;
    xml = xml.replace(
      "<w:body>",
      `<w:body>${box('<w:commentRangeStart w:id="9"/>Boxed')}`
        .replace("<w:t><w:commentRangeStart", "<w:commentRangeStart")
        .replace('w:id="9"/>Boxed', 'w:id="9"/><w:r><w:t>Boxed</w:t></w:r><w:commentRangeEnd w:id="9"/><w:r><w:commentReference w:id="9"/></w:r><w:r><w:t>'),
    );
    zip.file("word/document.xml", xml);
    zip.file("word/comments.xml", '<w:comments><w:comment w:id="9" w:author="Ann"><w:p><w:r><w:t>In a box</w:t></w:r></w:p></w:comment></w:comments>');
    const remarks = await readRemarks(zip);
    expect(remarks.filter((r) => r.text === "In a box")).toHaveLength(1);

    const tabs = await JSZip.loadAsync(await annotate(await copy(), [{ replace: "all travel", by: "business travel", author: "A", under: "Scope" }]));
    let tx = await tabs.file("word/document.xml")!.async("string");
    tx = tx.replace(
      '<w:p><w:r><w:t xml:space="preserve">The tool covers ',
      '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t xml:space="preserve">The tool covers ',
    );
    tabs.file("word/document.xml", tx);
    const [edit] = await readRemarks(tabs);
    expect(edit!.beforeText).toBe("The tool covers ");

    const many = await annotate(
      await copy(),
      Array.from({ length: 501 }, () => ({ comment: "x", on: "travel", author: "A", under: "Scope" })),
    ).catch(() => null);
    if (many) await expect(readRemarks(await JSZip.loadAsync(many))).rejects.toMatchObject({ code: "too_many_remarks" });
  });
});
