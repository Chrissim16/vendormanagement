import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { rfpWord, type WordContent } from "../files";
import { exampleTemplate } from "./example";
import { readCustomProperties, WORD_MAIN, WORD_TEMPLATE_MAIN } from "./ooxml";
import { plainTemplate } from "./plain";
import { analyseTemplate, fillMarks } from "./template";

const content: WordContent = {
  title: "Expense & travel tool",
  need: "Internal need.",
  budgetMinor: 1_200_000,
  currency: "EUR",
  sponsor: "Finance director",
  demandApprovedOn: "2026-10-01",
  targetDecisionDate: null,
  ownerName: "Mira Okafor",
  writtenWeight: 70,
  demoWeight: 30,
  sections: [
    { id: "s1", heading: "Introduction", body: "We **invite** you.\n\n## Background\n\n- one\n- two\n\n1. first\n2. second\n\n| Item | Detail |\n| --- | --- |\n| Users | 250 |" },
    { id: "s2", heading: "Process", body: "1. again from one\n2. two" },
  ],
  criteria: [
    { id: "k1", name: "Fit", weight: 100, part: "written" },
    { id: "k2", name: "Demo", weight: 100, part: "demo" },
  ],
  questions: [{ id: "q1", number: 1, text: "Why?", criterionId: "k1" }],
};
const xmlOf = async (doc: Buffer, name = "word/document.xml") => (await JSZip.loadAsync(doc)).file(name)!.async("string");
const textOf = (xml: string) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");

/** A small template made by hand, the way Word in another language writes one. */
async function handMade(o: { styles?: string; body: string; numbering?: string; macros?: boolean }) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${o.macros ? "application/vnd.ms-word.template.macroEnabledTemplate.main+xml" : WORD_TEMPLATE_MAIN}"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${o.styles ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' : ""}</Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${o.body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
  );
  if (o.styles) zip.file("word/styles.xml", `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${o.styles}</w:styles>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("Q-14 filling the marks on the cover page", () => {
  it("fills a mark that Word split over several pieces, and keeps the words around it", () => {
    const xml = "<w:p><w:r><w:t>Issued on [Da</w:t></w:r><w:proofErr/><w:r><w:rPr><w:b/></w:rPr><w:t>te] for </w:t></w:r><w:r><w:t>[Title]</w:t></w:r></w:p>";
    const { xml: out, found } = fillMarks(xml, { date: "22 Nov 2026", title: "A & B" });
    expect([...found].sort()).toEqual(["date", "title"]);
    expect(textOf(out)).toBe("Issued on 22 Nov 2026 for A &amp; B");
    // The pieces keep their own formatting.
    expect(out).toContain("<w:b/>");
  });

  it("does not join text across paragraphs, and leaves other square brackets alone", () => {
    const xml = "<w:p><w:r><w:t>[Ti</w:t></w:r></w:p><w:p><w:r><w:t>tle] [Client name]</w:t></w:r></w:p>";
    const { xml: out, found } = fillMarks(xml, { title: "X" });
    expect(found.size).toBe(0);
    expect(out).toBe(xml);
  });

  it("knows the marks in any capitals", () => {
    expect([...fillMarks("<w:p><w:r><w:t>[TITLE] [version]</w:t></w:r></w:p>", null).found].sort()).toEqual(["title", "version"]);
  });
});

describe("Q-14 what the app finds in a template", () => {
  it("reports the example template's cover page, marks, header, footer, logo, font and styles", async () => {
    const found = await analyseTemplate(await exampleTemplate());
    expect(found).toMatchObject({
      format: "dotx",
      coverPage: true,
      marks: { title: ["cover page", "header"], date: ["cover page"], version: ["cover page"] },
      header: true,
      footer: true,
      font: "Georgia",
      styles: { heading1: "Heading 1", heading2: "Heading 2", heading3: "Heading 3", listBullet: "List Bullet", listNumber: "List Number" },
    });
    expect(found.pictures).toBeGreaterThan(0);
  });

  it("finds styles by their built-in name when Word gave them translated ids, and reports missing marks", async () => {
    const t = await handMade({
      styles:
        '<w:style w:type="paragraph" w:styleId="Kop1"><w:name w:val="heading 1"/></w:style><w:style w:type="table" w:styleId="Tabelraster"><w:name w:val="Table Grid"/></w:style>',
      body: "<w:p><w:r><w:t>Only [Title] here</w:t></w:r></w:p>",
    });
    const found = await analyseTemplate(t);
    expect(found.marks).toEqual({ title: ["cover page"], date: [], version: [] });
    expect(found.styles).toMatchObject({ heading1: "heading 1", heading2: null, table: "Table Grid" });
    const doc = await xmlOf(await rfpWord(content, { template: t, today: "2026-11-22", version: 1 }));
    expect(doc).toContain('<w:pStyle w:val="Kop1"/>');
    expect(doc).toContain('<w:tblStyle w:val="Tabelraster"/>');
  });

  it("refuses a template with macros and a file that is not Word", async () => {
    await expect(analyseTemplate(await handMade({ body: "", macros: true }))).rejects.toMatchObject({ code: "template_has_macros" });
    await expect(analyseTemplate(Buffer.from("not a word file at all"))).rejects.toMatchObject({ code: "not_a_word_file" });
  });
});

describe("Q-12 Q-14 the RFP as a Word file made from a template", () => {
  it("keeps the template's cover page with the title, date and version, and puts the RFP's text after it", async () => {
    const doc = await rfpWord(content, { template: await exampleTemplate(), today: "2026-11-22", version: 3, review: { rfpId: "rfp-1" } });
    const zip = await JSZip.loadAsync(doc);
    const xml = await zip.file("word/document.xml")!.async("string");
    const text = textOf(xml);
    expect(text.indexOf("Expense &amp; travel tool")).toBeLessThan(text.indexOf("Introduction"));
    expect(text).toContain("Issued on 22 Nov 2026");
    expect(text).toContain("Version 3");
    expect(text).toContain("Prepared by the Finance IT team of Larkspur");
    expect(text).not.toMatch(/\[(Title|Date|Version)\]/);
    // The header's mark is filled in too.
    const headers = Object.keys(zip.files).filter((n) => /word\/header\d*\.xml/.test(n));
    const headerText = (await Promise.all(headers.map((h) => zip.file(h)!.async("string")))).map(textOf).join(" ");
    expect(headerText).toContain("Expense &amp; travel tool");
    // A .dotx becomes a document.
    const types = await zip.file("[Content_Types].xml")!.async("string");
    expect(types).toContain(WORD_MAIN);
    expect(types).not.toContain(WORD_TEMPLATE_MAIN);
    // The review copy says which RFP and version it is.
    expect(await readCustomProperties(zip)).toMatchObject({ "Vendor Management RFP": "rfp-1", "Vendor Management review version": "3" });
  });

  it("writes the formatting: bold, sub-headings, lists in the template's list styles, each numbered list from 1, and tables", async () => {
    const doc = await rfpWord(content, { template: await exampleTemplate(), today: "2026-11-22", version: 1 });
    const xml = await xmlOf(doc);
    expect(xml).toMatch(/<w:b\/><\/w:rPr><w:t xml:space="preserve">invite<\/w:t>/);
    expect(xml).toContain('<w:pStyle w:val="Heading2"/>');
    expect(xml).toContain('<w:pStyle w:val="ListBullet"/>');
    expect(xml).toContain('<w:pStyle w:val="ListNumber"/>');
    expect(xml).toContain("<w:tbl>");
    // The two numbered lists have numberings of their own, each starting at 1.
    const numIds = [...xml.matchAll(/<w:pStyle w:val="ListNumber"\/><w:numPr><w:ilvl w:val="0"\/><w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);
    expect(new Set(numIds).size).toBe(2);
    const numbering = await xmlOf(doc, "word/numbering.xml");
    for (const id of new Set(numIds))
      expect(numbering).toMatch(new RegExp(`<w:num w:numId="${id}"><w:abstractNumId w:val="\\d+"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/>`));
    // Every list refers to an abstract list that exists, and all of those come before the first list.
    expect(numbering.lastIndexOf("</w:abstractNum>")).toBeLessThan(numbering.indexOf("<w:num "));
  });

  it("leaves the budget and the sponsor out of a candidate's copy, and writes no review mark into it", async () => {
    const doc = await rfpWord(content, { template: await plainTemplate(), today: "2026-11-22", version: 2, candidate: { vendorName: "Bluefinch Systems" } });
    const zip = await JSZip.loadAsync(doc);
    const text = textOf(await zip.file("word/document.xml")!.async("string"));
    expect(text).toContain("Request for proposal for Bluefinch Systems");
    expect(text).not.toContain("Finance director");
    expect(text).not.toContain("12,000");
    expect(await readCustomProperties(zip)).toEqual({});
  });

  it("makes a file from a template without any styles or numbering of its own", async () => {
    const t = await handMade({ body: "<w:p><w:r><w:t>[Title]</w:t></w:r></w:p>" });
    const zip = await JSZip.loadAsync(await rfpWord(content, { template: t, today: "2026-11-22", version: 1 }));
    expect(zip.file("word/numbering.xml")).toBeTruthy();
    expect(await zip.file("[Content_Types].xml")!.async("string")).toContain('PartName="/word/numbering.xml"');
    expect(await zip.file("word/_rels/document.xml.rels")!.async("string")).toContain("numbering.xml");
  });
});
