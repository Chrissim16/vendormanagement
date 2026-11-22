import { eq } from "drizzle-orm";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rfpSections } from "../../../db/schema";
import type { RfpDetail } from "../../../shared/rfp";
import type { WordTemplateInfo } from "../../../shared/wordTemplate";
import { ADMIN, binary, MEMBER, testApp } from "../../testing";
import { rfpWord } from "./files";
import { annotate } from "./word/annotate";
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
const NIL = "00000000-0000-4000-8000-000000000000";
/** A Word file made by the app that is not a review copy: no hidden mark. */
const rfpWordPlain = async () =>
  rfpWord(
    {
      title: "X",
      need: "n",
      budgetMinor: null,
      currency: "EUR",
      sponsor: null,
      demandApprovedOn: null,
      targetDecisionDate: null,
      ownerName: "M",
      writtenWeight: 100,
      demoWeight: 0,
      sections: [],
      criteria: [],
      questions: [],
    },
    { template: await plainTemplate(), today: "2026-11-22", version: null, candidate: { vendorName: "V" } },
  );
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
/** The text of the RFP's review copy, downloaded the way the Review tab does: a round first, then its file. */
const docText = async (rfpPath: string) => {
  const rfpId = /\/api\/rfps\/([^/]+)\//.exec(rfpPath)![1]!;
  const round = (await t.as(MEMBER).post(`/api/rfps/${rfpId}/review-rounds`)).body as { roundId: string };
  const res = await t.as(MEMBER).get(`/api/rfp-review-rounds/${round.roundId}/review-copy.docx`).buffer(true).parse(binary);
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

// ---------- Q-13 review rounds and remarks from Word

type Round = { rfp: RfpDetail; roundId: string; made: boolean };
type Uploaded = { rfp: RfpDetail; version: number; otherVersion: boolean; read: { comments: number; edits: number; notPlaced: number; reviewers: string[] } };
const round = async (rfpId: string, as = MEMBER) => {
  const res = await t.as(as).post(`/api/rfps/${rfpId}/review-rounds`);
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  return res.body as Round;
};
const copyOf = async (roundId: string) => (await t.as(MEMBER).get(`/api/rfp-review-rounds/${roundId}/review-copy.docx`).buffer(true).parse(binary)).body as Buffer;
const upload = (roundId: string, data: Buffer, name = "Reviewed by Chris.docx") => t.as(MEMBER).post(`/api/rfp-review-rounds/${roundId}/files`).attach("file", data, name);
const act = (remarkId: string, body: object, as = MEMBER) => t.as(as).post(`/api/rfp-remarks/${remarkId}`).send(body);
/** An RFP with two sections, a criterion and a question, in review. */
async function inReview() {
  const r = await create();
  ok(
    await save(r.id, {
      sections: [
        { heading: "Introduction", body: "We invite you to respond by **1 March** at the latest.\n\n- Booking\n- Approval" },
        { heading: "Scope", body: "The tool covers all travel." },
      ],
      criteria: [{ key: "k", name: "Fit", weight: 100, part: "written" }],
      questions: [{ text: "How do you handle approvals?", criterionKey: "k" }],
    }),
  );
  ok(await t.as(MEMBER).patch(`/api/rfps/${r.id}`).send({ writtenWeight: 100, demoWeight: 0 }));
  return ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfps/${r.id}/stage`).send({ to: "in_review" }));
}

describe("Q-13 review rounds", () => {
  it("numbers the rounds, reuses a round when nothing changed, and keeps each version's copy", async () => {
    const r = await inReview();
    const first = await round(r.id);
    expect(first.made).toBe(true);
    expect(first.rfp.review.rounds.map((x) => x.version)).toEqual([1]);
    const again = await round(r.id);
    expect(again).toMatchObject({ made: false, roundId: first.roundId });
    const v1 = await copyOf(first.roundId);
    const zip = await JSZip.loadAsync(v1);
    expect(await zip.file("word/document.xml")!.async("string")).toContain("Version 1");

    const changed = r.sections.map((s) => ({ id: s.id, heading: s.heading, body: s.heading === "Scope" ? "The tool covers business travel." : s.body }));
    ok(
      await save(r.id, {
        sections: changed,
        criteria: [{ key: r.criteria[0]!.id, name: "Fit", weight: 100, part: "written" }],
        questions: [{ text: r.questions[0]!.text, criterionKey: r.criteria[0]!.id }],
      }),
    );
    const second = await round(r.id);
    expect(second.made).toBe(true);
    expect(second.rfp.review.rounds.map((x) => x.version)).toEqual([2, 1]);
    const res = await t.as(MEMBER).get(`/api/rfp-review-rounds/${second.roundId}/review-copy.docx`).buffer(true).parse(binary);
    expect(res.headers["content-disposition"]).toContain("review%20copy%20v2.docx");
    // Version 1 is still the copy the reviewers got.
    expect((await copyOf(first.roundId)).equals(v1)).toBe(true);
    const history = (await t.as(MEMBER).get("/api/audit/history").query({ entityType: "rfp", entityId: r.id })).body.items as { changes: Record<string, { to: string }> }[];
    expect(history.filter((h) => h.changes?.["Review round"]).map((h) => h.changes["Review round"]!.to)).toEqual(["version 2: review copy made", "version 1: review copy made"]);
  });
});

describe("Q-13 remarks from a returned Word file", () => {
  it("reads comments and suggested edits, places each in its section, and lists one it cannot place", async () => {
    const r = await inReview();
    const { roundId } = await round(r.id);
    const returned = await annotate(await copyOf(roundId), [
      { comment: "Is this date realistic?", on: "1 March", author: "Chris Tanaka", under: "Introduction" },
      { replace: "all travel", by: "business travel", author: "Ann Berg", under: "Scope" },
      { comment: "Add mobile approval.", on: "approvals", author: "Ann Berg", under: "Questions" },
    ]);
    const up = ok<Uploaded>(await upload(roundId, returned), 201);
    expect(up).toMatchObject({ version: 1, otherVersion: false, read: { comments: 2, edits: 1, notPlaced: 1, reviewers: ["Chris Tanaka", "Ann Berg"] } });
    const [intro, scope] = up.rfp.sections;
    expect(up.rfp.review.remarks.map((m) => [m.kind, m.author, m.sectionId, m.foundUnder, m.status])).toEqual([
      ["comment", "Chris Tanaka", intro!.id, "Introduction", "open"],
      ["suggested_edit", "Ann Berg", scope!.id, "Scope", "open"],
      ["comment", "Ann Berg", null, "Questions", "open"],
    ]);
    expect(up.rfp.review.remarks[0]).toMatchObject({ anchorText: "1 March", text: "Is this date realistic?" });
    // The same file twice is refused.
    expect((await upload(roundId, returned)).body.error.code).toBe("already_uploaded");
  });

  it("refuses a file that is not a review copy of this RFP, and puts a copy of another version in that version's round", async () => {
    const r = await inReview();
    const v1 = await round(r.id);
    const other = await inReview();
    const otherRound = await round(other.id);
    expect((await upload(v1.roundId, await copyOf(otherRound.roundId))).body.error.message).toContain("another RFP");
    const plainDocx = await rfpWordPlain();
    expect((await upload(v1.roundId, plainDocx)).body.error.message).toContain("not a review copy made by the app");
    expect((await upload(v1.roundId, Buffer.from("%PDF-1.4"), "x.pdf")).body.error.code).toBe("wrong_file_type");

    // Version 2 is made; a reviewer sends back version 1, uploaded to version 2's round.
    ok(await t.as(MEMBER).patch(`/api/rfps/${r.id}`).send({ need: "A changed need." }));
    const v2 = await round(r.id);
    expect(v2.made).toBe(true);
    const back = await annotate(await copyOf(v1.roundId), [{ comment: "Fine.", on: "all travel", author: "Ann Berg", under: "Scope" }]);
    const up = ok<Uploaded>(await upload(v2.roundId, back, "Ann.docx"), 201);
    expect(up).toMatchObject({ version: 1, otherVersion: true });
    expect(up.rfp.review.rounds.find((x) => x.version === 1)!.files.map((f) => f.fileName)).toEqual(["Ann.docx"]);
    expect(up.rfp.review.remarks[0]).toMatchObject({ version: 1 });
  });

  it("takes a suggested edit over into its section, and blocks approval until every remark is dealt with or set aside", async () => {
    const r = await inReview();
    const { roundId } = await round(r.id);
    const returned = await annotate(await copyOf(roundId), [
      { replace: "1 March", by: "15 March", author: "Chris Tanaka", under: "Introduction" },
      { comment: "Which countries?", on: "all travel", author: "Ann Berg", under: "Scope" },
      { comment: "Nice.", on: "approvals", author: "Ann Berg", under: "Questions" },
    ]);
    let rfp = ok<Uploaded>(await upload(roundId, returned), 201).rfp;
    ok(await t.as(MEMBER).post(`/api/rfps/${r.id}/signoffs`).send({ reviewerName: "Chris Tanaka", outcome: "approved", onDate: "2026-11-20" }), 201);
    const refused = await t.as(MEMBER).post(`/api/rfps/${r.id}/stage`).send({ to: "approved" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toContain("3 reviewers' remarks from Word are still open");

    const [edit, comment, unplaced] = rfp.review.remarks;
    rfp = ok<RfpDetail>(await act(edit!.id, { action: "take_over" }));
    expect(rfp.sections[0]!.body).toBe("We invite you to respond by **15 March** at the latest.\n\n- Booking\n- Approval");
    expect(rfp.review.remarks[0]).toMatchObject({ status: "dealt_with", resolution: "taken_over", resolvedBy: MEMBER });
    // Taking over changed the document, so the approval given before no longer counts.
    expect(rfp.signoffs[0]!.superseded).toBe(true);
    // Done is done: taking it over twice is refused.
    expect((await act(edit!.id, { action: "take_over" })).body.error.code).toBe("remark_closed");

    expect((await act(comment!.id, { action: "take_over" })).body.error.code).toBe("not_an_edit");
    ok(await act(comment!.id, { action: "by_hand" }));
    expect((await act(unplaced!.id, { action: "place", sectionId: NIL })).status).toBe(400);
    rfp = ok<RfpDetail>(await act(unplaced!.id, { action: "place", sectionId: rfp.sections[1]!.id }));
    expect(rfp.review.remarks[2]!.sectionId).toBe(rfp.sections[1]!.id);
    rfp = ok<RfpDetail>(await act(unplaced!.id, { action: "set_aside" }));
    expect(rfp.review.remarks.map((m) => m.status)).toEqual(["dealt_with", "dealt_with", "set_aside"]);
    ok(await t.as(MEMBER).post(`/api/rfps/${r.id}/signoffs`).send({ reviewerName: "Chris Tanaka", outcome: "approved", onDate: "2026-11-21" }), 201);
    const approved = ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfps/${r.id}/stage`).send({ to: "approved" }));
    expect(approved.stage).toBe("approved");
    // Once approved, remarks are no longer worked on.
    expect((await act(unplaced!.id, { action: "reopen" })).body.error.code).toBe("review_over");
    const history = (await t.as(MEMBER).get("/api/audit/history").query({ entityType: "rfp", entityId: r.id })).body.items as { changes: Record<string, { to: string }> }[];
    const said = history.flatMap((h) => Object.entries(h.changes ?? {}).map(([k, v]) => `${k}: ${v.to}`));
    expect(said).toContain("suggested edit by Chris Tanaka (version 1): dealt with: taken over");
    expect(said).toContain("comment by Ann Berg (version 1): set aside");
    expect(said).toContain("section Introduction: 15 March");
  });

  it("does not take an edit over whose words are no longer in the section", async () => {
    const r = await inReview();
    const { roundId } = await round(r.id);
    const rfp = ok<Uploaded>(
      await upload(roundId, await annotate(await copyOf(roundId), [{ replace: "all travel", by: "business travel", author: "Ann Berg", under: "Scope" }])),
      201,
    ).rfp;
    const sections = rfp.sections.map((s) => ({ id: s.id, heading: s.heading, body: s.heading === "Scope" ? "Rewritten completely." : s.body }));
    ok(
      await save(r.id, {
        sections,
        criteria: [{ key: rfp.criteria[0]!.id, name: "Fit", weight: 100, part: "written" }],
        questions: [{ text: rfp.questions[0]!.text, criterionKey: rfp.criteria[0]!.id }],
      }),
    );
    const res = await act(rfp.review.remarks[0]!.id, { action: "take_over" });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('no longer in "Scope"');
  });

  it("puts the remarks of a section that is removed under Not placed", async () => {
    const r = await inReview();
    const { roundId } = await round(r.id);
    const rfp = ok<Uploaded>(await upload(roundId, await annotate(await copyOf(roundId), [{ comment: "Hm.", on: "all travel", author: "Ann Berg", under: "Scope" }])), 201).rfp;
    const after = ok<RfpDetail>(
      await save(r.id, {
        sections: [{ id: rfp.sections[0]!.id, heading: "Introduction", body: rfp.sections[0]!.body }],
        criteria: [{ key: rfp.criteria[0]!.id, name: "Fit", weight: 100, part: "written" }],
        questions: [{ text: rfp.questions[0]!.text, criterionKey: rfp.criteria[0]!.id }],
      }),
    );
    expect(after.review.remarks[0]).toMatchObject({ sectionId: null, foundUnder: "Scope" });
  });

  it("removes a file uploaded by mistake, until one of its remarks was worked on", async () => {
    const r = await inReview();
    const { roundId } = await round(r.id);
    const rfp = ok<Uploaded>(await upload(roundId, await annotate(await copyOf(roundId), [{ comment: "Hm.", on: "all travel", author: "Ann Berg", under: "Scope" }])), 201).rfp;
    const fileId = rfp.review.rounds[0]!.files[0]!.id;
    ok(await act(rfp.review.remarks[0]!.id, { action: "set_aside" }));
    expect((await t.as(MEMBER).delete(`/api/rfp-review-files/${fileId}`)).body.error.code).toBe("remarks_worked_on");
    ok(await act(rfp.review.remarks[0]!.id, { action: "reopen" }));
    const gone = ok<RfpDetail>(await t.as(MEMBER).delete(`/api/rfp-review-files/${fileId}`));
    expect(gone.review.remarks).toEqual([]);
    expect(gone.review.rounds[0]!.files).toEqual([]);
  });
});
