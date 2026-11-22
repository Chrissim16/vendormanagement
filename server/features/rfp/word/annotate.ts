import JSZip from "jszip";
import { decodeXml, escapeXml } from "./ooxml";

/**
 * Does to a review copy what a reviewer does in Word (Q-13): comments on words and
 * suggests edits with tracked changes, under a reviewer's name. For the tests and the
 * sample data only; it writes the same structure Word writes, including a reply to a
 * comment. Each edit or comment works on the first run whose text holds the words, from
 * the heading named in `under` on.
 */
export type Annotation =
  { comment: string; on: string; author: string; under?: string; reply?: { author: string; text: string } } | { replace: string; by: string; author: string; under?: string };

const RUN = /<w:r>(<w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr>)?<w:t(?:\s[^>]*)?>([^<]*)<\/w:t><\/w:r>/g;

export async function annotate(docx: Buffer, notes: Annotation[]): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  let xml = await zip.file("word/document.xml")!.async("string");
  const comments: string[] = [];
  const extended: string[] = [];
  let id = 0;
  const date = "2026-11-20T10:00:00Z";
  for (const n of notes) {
    // From the start of the heading's paragraph, so that the heading itself can be edited too.
    const heading = n.under ? xml.indexOf(`>${escapeXml(n.under)}<`) : xml.indexOf("<w:body>");
    const from = n.under && heading >= 0 ? xml.lastIndexOf("<w:p>", heading) : heading;
    if (from < 0) throw new Error(`No heading "${n.under}" in the file`);
    const find = "comment" in n ? n.on : n.replace;
    RUN.lastIndex = from;
    let m: RegExpExecArray | null;
    while ((m = RUN.exec(xml)) && !decodeXml(m[2]!).includes(find));
    if (!m) throw new Error(`No run holds "${find}"`);
    const rPr = m[1] ?? "";
    const text = decodeXml(m[2]!);
    const at = text.indexOf(find);
    const run = (t: string) => (t ? `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(t)}</w:t></w:r>` : "");
    let middle: string;
    if ("comment" in n) {
      const cid = id++;
      middle = `<w:commentRangeStart w:id="${cid}"/>${run(find)}<w:commentRangeEnd w:id="${cid}"/><w:r><w:commentReference w:id="${cid}"/></w:r>`;
      const paraId = (100000 + cid * 2).toString(16).toUpperCase().padStart(8, "0");
      comments.push(
        `<w:comment w:id="${cid}" w:author="${escapeXml(n.author)}" w:date="${date}" w:initials="X"><w:p w14:paraId="${paraId}"><w:r><w:t xml:space="preserve">${escapeXml(n.comment)}</w:t></w:r></w:p></w:comment>`,
      );
      extended.push(`<w15:commentEx w15:paraId="${paraId}" w15:done="0"/>`);
      if (n.reply) {
        const rid = id++;
        const replyPara = (100001 + cid * 2).toString(16).toUpperCase().padStart(8, "0");
        comments.push(
          `<w:comment w:id="${rid}" w:author="${escapeXml(n.reply.author)}" w:date="${date}" w:initials="Y"><w:p w14:paraId="${replyPara}"><w:r><w:t xml:space="preserve">${escapeXml(n.reply.text)}</w:t></w:r></w:p></w:comment>`,
        );
        extended.push(`<w15:commentEx w15:paraId="${replyPara}" w15:paraIdParent="${paraId}" w15:done="0"/>`);
      }
    } else {
      const del = find
        ? `<w:del w:id="${id++}" w:author="${escapeXml(n.author)}" w:date="${date}"><w:r>${rPr}<w:delText xml:space="preserve">${escapeXml(find)}</w:delText></w:r></w:del>`
        : "";
      const ins = n.by
        ? `<w:ins w:id="${id++}" w:author="${escapeXml(n.author)}" w:date="${date}"><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(n.by)}</w:t></w:r></w:ins>`
        : "";
      middle = del + ins;
    }
    xml = xml.slice(0, m.index) + run(text.slice(0, at)) + middle + run(text.slice(at + find.length)) + xml.slice(m.index + m[0].length);
  }
  zip.file("word/document.xml", xml);
  if (comments.length) {
    const ns =
      'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"';
    zip.file("word/comments.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments ${ns}>${comments.join("")}</w:comments>`);
    zip.file("word/commentsExtended.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w15:commentsEx ${ns}>${extended.join("")}</w15:commentsEx>`);
    let types = await zip.file("[Content_Types].xml")!.async("string");
    types = types.replace(
      "</Types>",
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/></Types>',
    );
    zip.file("[Content_Types].xml", types);
    let rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
    rels = rels.replace(
      "</Relationships>",
      '<Relationship Id="rIdVmC1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/><Relationship Id="rIdVmC2" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/></Relationships>',
    );
    zip.file("word/_rels/document.xml.rels", rels);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
