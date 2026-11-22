import { eq } from "drizzle-orm";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rfpSections } from "../../../db/schema";
import type { RfpDetail } from "../../../shared/rfp";
import type { WordTemplateInfo } from "../../../shared/wordTemplate";
import { ADMIN, binary, MEMBER, testApp } from "../../testing";
import { exampleTemplate } from "./word/example";
import { plainTemplate } from "./word/plain";

/** M11 through the API: formatted sections (Q-12) and the company's Word template (Q-14). */

let t: Awaited<ReturnType<typeof testApp>>;
let me: string;
beforeAll(async () => {
  t = await testApp();
  me = (await t.as(MEMBER).get("/api/me")).body.id;
});
afterAll(() => t.close());

const n = () => Math.random().toString(36).slice(2, 8);
const ok = <T>(res: { status: number; body: unknown }, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as T;
};
const create = async () =>
  ok<RfpDetail>(
    await t
      .as(MEMBER)
      .post("/api/rfps")
      .send({ title: `Tool ${n()}`, need: "A need.", ownerUserId: me }),
    201,
  );
const content = (_r: RfpDetail, sections: { id?: string; heading: string; body: string | null }[]) => ({
  sections,
  criteria: [{ key: "k", name: "Fit", weight: 100, part: "written" }],
  questions: [{ text: "Why?", criterionKey: "k" }],
});
const save = (id: string, body: object) => t.as(MEMBER).put(`/api/rfps/${id}/content`).send(body);
const docText = async (path: string) => {
  const res = await t.as(MEMBER).get(path).buffer(true).parse(binary);
  expect(res.status).toBe(200);
  const zip = await JSZip.loadAsync(res.body as Buffer);
  return (await zip.file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
};

describe("Q-12 formatted sections", () => {
  it("keeps a section's identity when the document is saved again, and gives a new section a new one", async () => {
    const r = await create();
    const first = ok<RfpDetail>(await save(r.id, content(r, [{ heading: "Intro", body: "**Hello**" }])));
    const id = first.sections[0]!.id;
    const second = ok<RfpDetail>(
      await save(
        r.id,
        content(r, [
          { heading: "Added", body: null },
          { id, heading: "Intro renamed", body: "- a\n- b" },
        ]),
      ),
    );
    expect(second.sections.map((s) => s.heading)).toEqual(["Added", "Intro renamed"]);
    expect(second.sections[1]!.id).toBe(id);
    expect(second.sections[0]!.id).not.toBe(id);
    expect(second.sections[1]!.body).toBe("- a\n- b");
  });

  it("stores text in its one tidy form, so the same text never counts as a change", async () => {
    const r = await create();
    const saved = ok<RfpDetail>(await save(r.id, content(r, [{ heading: "Intro", body: "*  item one\n* item  two\n\n\n**bold**" }])));
    expect(saved.sections[0]!.body).toBe("- item one\n- item two\n\n**bold**");
    const again = ok<RfpDetail>(await save(r.id, content(r, [{ id: saved.sections[0]!.id, heading: "Intro", body: "- item one\n- item two\n\n**bold**" }])));
    const history = (await t.as(MEMBER).get("/api/audit/history").query({ entityType: "rfp", entityId: r.id })).body.items as unknown[];
    expect(again.sections[0]!.body).toBe(saved.sections[0]!.body);
    // Created, then saved once: the second save changed nothing.
    expect(history).toHaveLength(2);
  });

  it("opens text from before M11 unchanged, as plain paragraphs, and keeps it so when saved", async () => {
    const r = await create();
    const saved = ok<RfpDetail>(await save(r.id, content(r, [{ heading: "Old", body: "x" }])));
    const sectionId = saved.sections[0]!.id;
    await t.ports.database.db.update(rfpSections).set({ body: "# Not a heading\n- not a list\n**not bold**", bodyFormat: "plain" }).where(eq(rfpSections.id, sectionId));
    const read = ok<RfpDetail>(await t.as(MEMBER).get(`/api/rfps/${r.id}`));
    expect(read.sections[0]!.body).toBe("\\# Not a heading\n\n\\- not a list\n\n\\*\\*not bold\\*\\*");
    // The Word file says what was typed, character for character.
    const text = await docText(`/api/rfps/${r.id}/rfp.docx`);
    expect(text).toContain("# Not a heading");
    expect(text).toContain("**not bold**");
  });

  it("refuses a table larger than a page can hold", async () => {
    const r = await create();
    const wide = `| ${Array.from({ length: 9 }, (_, i) => `c${i}`).join(" | ")} |`;
    const res = await save(r.id, content(r, [{ heading: "Intro", body: wide }]));
    expect(res.status).toBe(400);
    expect(res.body.error.fields["sections.0.body"]).toContain("at most 60 rows and 8 columns");
  });
});

describe("Q-14 the company's Word template", () => {
  it("is uploaded, replaced and set aside by an admin only; a member is refused on the server", async () => {
    expect((await t.as(MEMBER).get("/api/admin/word-template")).status).toBe(403);
    expect(
      (
        await t
          .as(MEMBER)
          .post("/api/admin/word-template")
          .attach("file", await exampleTemplate(), "x.dotx")
      ).status,
    ).toBe(403);
    expect((await t.as(MEMBER).delete("/api/admin/word-template")).status).toBe(403);
    expect((await t.as(MEMBER).get("/api/admin/word-template/file")).status).toBe(403);

    const up = ok<WordTemplateInfo>(
      await t
        .as(ADMIN)
        .post("/api/admin/word-template")
        .attach("file", await exampleTemplate(), "Company template.dotx"),
      201,
    );
    expect(up.current).toMatchObject({ fileName: "Company template.dotx", uploadedBy: ADMIN, found: { coverPage: true, marks: { title: ["cover page", "header"] } } });
    const r = await create();
    ok(await save(r.id, content(r, [{ heading: "Intro", body: "Hello" }])));
    expect(await docText(`/api/rfps/${r.id}/rfp.docx`)).toContain("Larkspur");

    // A plain document without marks is taken, and the missing marks are reported.
    const plain = ok<WordTemplateInfo>(
      await t
        .as(ADMIN)
        .post("/api/admin/word-template")
        .attach("file", await plainTemplate(), "Plain.docx"),
      201,
    );
    expect(plain.current!.found.format).toBe("docx");
    expect(await docText(`/api/rfps/${r.id}/rfp.docx`)).not.toContain("Larkspur");

    const none = ok<WordTemplateInfo>(await t.as(ADMIN).delete("/api/admin/word-template"));
    expect(none.current).toBeNull();
    expect((await t.as(ADMIN).get("/api/admin/word-template/file")).status).toBe(404);
    const settings = (await t.as(ADMIN).get("/api/audit/history").query({ entityType: "settings", entityId: "settings" })).body.items as {
      changes: Record<string, { to: string }>;
    }[];
    expect(settings.map((e) => e.changes["Word template"]?.to).slice(0, 3)).toEqual([
      "the app's plain layout",
      "Plain.docx (Word document; marks found: [Title], [Date], [Version])",
      "Company template.dotx (Word template; marks found: [Title], [Date], [Version])",
    ]);
  });

  it("refuses what is not a usable Word template, and says why", async () => {
    const up = (data: Buffer, name: string) => t.as(ADMIN).post("/api/admin/word-template").attach("file", data, name);
    expect((await up(Buffer.from("x"), "template.pdf")).body.error.code).toBe("wrong_file_type");
    expect((await up(Buffer.from("x"), "template.dotm")).body.error.message).toContain("Word Template (.dotx)");
    expect((await up(Buffer.from("not a zip"), "template.dotx")).body.error.code).toBe("not_a_word_file");
  });
});
