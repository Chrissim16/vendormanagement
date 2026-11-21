import ExcelJS from "exceljs";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Dashboard } from "../../../shared/overview";
import type { RfpDetail, RfpRow } from "../../../shared/rfp";
import { ADMIN, binary, MEMBER, testApp, TODAY } from "../../testing";

/** Q-1 to Q-11 through the API, on the sample data with today pinned to 21 Nov 2026. Every test makes its own RFP. */

let t: Awaited<ReturnType<typeof testApp>>;
let me: string;
let admin: string;
const vendors: Record<string, string> = {};
beforeAll(async () => {
  t = await testApp();
  me = (await t.as(MEMBER).get("/api/me")).body.id;
  admin = (await t.as(ADMIN).get("/api/me")).body.id;
  for (const v of (await t.as(MEMBER).get("/api/vendors").query({ status: "all", pageSize: "200" })).body.items as { id: string; name: string }[]) vendors[v.name] = v.id;
});
afterAll(() => t.close());

const n = () => Math.random().toString(36).slice(2, 8);
const NIL = "00000000-0000-4000-8000-000000000000";
const textOf = async (data: Buffer) => {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(data));
  return (await extractText(doc, { mergePages: true })).text.replace(/\s+/g, " ");
};
const file = async (path: string, as = MEMBER) => {
  const res = await t.as(as).get(path).buffer(true).parse(binary);
  expect(res.status, path).toBe(200);
  return res;
};
const wordText = async (data: Buffer) => (await (await JSZip.loadAsync(data)).file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const history = async (id: string) =>
  (
    (await t.as(MEMBER).get("/api/audit/history").query({ entityType: "rfp", entityId: id })).body.items as {
      userEmail: string;
      action: string;
      changes: Record<string, { from: unknown; to: unknown }> | null;
    }[]
  ).map((e) => ({
    ...e,
    changes: e.changes ?? {},
  }));

const demand = (over: object = {}) => ({ title: `Expense tool ${n()}`, need: "A tool to submit and approve expenses.", ownerUserId: me, ...over });
const create = async (over: object = {}) => {
  const res = await t.as(MEMBER).post("/api/rfps").send(demand(over));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as RfpDetail;
};
const get = async (id: string) => (await t.as(MEMBER).get(`/api/rfps/${id}`)).body as RfpDetail;
const ok = <T>(res: { status: number; body: unknown }, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as T;
};

/** An RFP with the AI's draft taken over. */
async function drafted(over: object = {}) {
  const r = await create(over);
  const asked = ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfps/${r.id}/draft`), 201);
  return ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfps/${r.id}/draft/review`).send({ action: "accept", suggestionId: asked.draft!.id }));
}
/** … sent for review, approved by one reviewer. */
async function approved(over: object = {}) {
  const r = await drafted(over);
  ok(await t.as(MEMBER).post(`/api/rfps/${r.id}/stage`).send({ to: "in_review" }));
  ok(await t.as(MEMBER).post(`/api/rfps/${r.id}/signoffs`).send({ reviewerName: "Chris Tanaka", reviewerRole: "CTO", outcome: "approved", onDate: TODAY }), 201);
  return ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfps/${r.id}/stage`).send({ to: "approved" }));
}
const addCandidate = async (rfpId: string, body: object) =>
  ok<RfpDetail>(
    await t
      .as(MEMBER)
      .post(`/api/rfps/${rfpId}/candidates`)
      .send({ list: "shortlist", reason: "Known in the market", ...body }),
    201,
  );
/** … with two shortlisted candidates (one new prospect, one known vendor with an NDA), both issued. */
async function issued() {
  const r = await approved();
  const name = `Candidate ${n()}`;
  await addCandidate(r.id, { newVendor: { name, type: "software" } });
  let now = await addCandidate(r.id, { vendorId: vendors["Bluefinch Systems"] });
  for (const c of now.candidates) now = ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfp-candidates/${c.id}/issue`).send({ issuedOn: TODAY, ndaWarningAcknowledged: true }));
  const [fresh, known] = [now.candidates.find((c) => c.vendorName === name)!, now.candidates.find((c) => c.vendorName === "Bluefinch Systems")!];
  return { rfp: now, fresh, known };
}
/** The candidate's answer sheet as downloaded, filled in by `fill` (question number → answer). */
async function filledSheet(candidateId: string, fill: (number: number, question: string) => string | null, extra: (ws: ExcelJS.Worksheet) => void = () => {}) {
  const res = await file(`/api/rfp-candidates/${candidateId}/answer-sheet.xlsx`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body);
  const ws = wb.getWorksheet("Answers")!;
  ws.eachRow((row, i) => {
    if (i <= 5) return;
    const answer = fill(Number(row.getCell(1).value), String(row.getCell(3).value));
    if (answer != null) row.getCell(4).value = answer;
  });
  extra(ws);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const upload = (candidateId: string, data: Buffer, name = "answers.xlsx", as = MEMBER) => t.as(as).post(`/api/rfp-candidates/${candidateId}/response`).attach("file", data, name);

describe("Q-1 demand", () => {
  it("a member creates an RFP with the need, budget, sponsor, approval date and target decision date; it starts in drafting", async () => {
    const r = await create({ budgetMinor: 80_000_00, currency: "EUR", sponsor: "Finance director", demandApprovedOn: "2026-11-10", targetDecisionDate: "2027-03-31" });
    expect(r).toMatchObject({
      stage: "drafting",
      budgetMinor: 80_000_00,
      sponsor: "Finance director",
      demandApprovedOn: "2026-11-10",
      targetDecisionDate: "2027-03-31",
      ownerUserId: me,
      writtenWeight: 70,
      demoWeight: 30,
    });
    expect(r.ownerName).toBe("Mira Okafor");
    expect((await history(r.id))[0]).toMatchObject({ action: "create", userEmail: MEMBER });
  });
  it("refuses a demand without a title or need, a negative budget, a date that does not exist, an approval in the future and an owner without access", async () => {
    const bad = async (over: object, field: string) => {
      const res = await t.as(MEMBER).post("/api/rfps").send(demand(over));
      expect(res.status, field).toBe(400);
      expect(res.body.error.fields[field], field).toBeTruthy();
    };
    await bad({ title: "  " }, "title");
    await bad({ need: "" }, "need");
    await bad({ budgetMinor: -1 }, "budgetMinor");
    await bad({ budgetMinor: 10.5 }, "budgetMinor");
    await bad({ targetDecisionDate: "2027-02-30" }, "targetDecisionDate");
    await bad({ demandApprovedOn: "2026-11-22" }, "demandApprovedOn");
    await bad({ ownerUserId: NIL }, "ownerUserId");
    const former = ((await t.as(ADMIN).get("/api/admin/users")).body.items as { id: string; email: string }[]).find((u) => u.email === "former@example.test")!;
    await bad({ ownerUserId: former.id }, "ownerUserId");
  });
  it("changes the demand, keeps what was not sent, and records what changed", async () => {
    const r = await create({ sponsor: "Finance director" });
    const next = ok<RfpDetail>(await t.as(ADMIN).patch(`/api/rfps/${r.id}`).send({ budgetMinor: 50_000_00, writtenWeight: 60, demoWeight: 40 }));
    expect(next).toMatchObject({ budgetMinor: 50_000_00, sponsor: "Finance director", writtenWeight: 60, demoWeight: 40, title: r.title });
    expect((await history(r.id))[0]!.changes).toMatchObject({ budgetMinor: { from: null, to: 50_000_00 }, "Weight of the written answers": { from: 70, to: 60 } });
    expect((await t.as(MEMBER).patch(`/api/rfps/${r.id}`).send({ writtenWeight: 60, demoWeight: 60 })).status).toBe(400);
  });
});

describe("Q-2 draft", () => {
  it("the AI drafts sections, weighted criteria and numbered questions as a suggestion; the document changes only when a member takes it over", async () => {
    const r = await create({ budgetMinor: 123_456_00, sponsor: "Finance director" });
    const asked = ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfps/${r.id}/draft`), 201);
    expect(asked.draft).toMatchObject({ status: "proposed" });
    expect(asked.sections).toEqual([]);
    const d = asked.draft!.output;
    expect(d.sections.length).toBeGreaterThanOrEqual(3);
    expect(d.questions.length).toBeGreaterThanOrEqual(5);
    for (const part of ["written", "demo"] as const) expect(d.criteria.filter((c) => c.part === part).reduce((s, c) => s + c.weight, 0)).toBe(100);
    // The draft is written for vendors: the budget and the sponsor are not in it.
    expect(JSON.stringify(d)).not.toMatch(/123,456|123456|Finance director/);

    const taken = ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfps/${r.id}/draft/review`).send({ action: "accept", suggestionId: asked.draft!.id }));
    expect(taken.draft).toMatchObject({ status: "accepted", reviewedBy: MEMBER });
    expect(taken.sections.map((s) => s.heading)).toEqual(d.sections.map((s) => s.heading));
    expect(taken.questions.map((q) => q.number)).toEqual(d.questions.map((_, i) => i + 1));
    const written = new Set(taken.criteria.filter((c) => c.part === "written").map((c) => c.id));
    for (const q of taken.questions) expect(written.has(q.criterionId)).toBe(true);
  });

  it("a member edits everything; an edited draft is marked as edited, and as accepted again when it reads as the AI wrote it", async () => {
    const r = await drafted();
    const content = {
      sections: [...r.sections.map((s) => ({ heading: s.heading, body: s.body })), { heading: "Annex", body: "Our own addition." }],
      criteria: r.criteria.map((c) => ({ key: c.id, name: c.name, weight: c.weight, part: c.part })),
      questions: [...r.questions.map((q) => ({ text: q.text, criterionKey: q.criterionId })), { text: "Anything else we should know?", criterionKey: r.criteria[0]!.id }],
    };
    const edited = ok<RfpDetail>(await t.as(ADMIN).put(`/api/rfps/${r.id}/content`).send(content));
    expect(edited.sections.at(-1)).toMatchObject({ heading: "Annex" });
    expect(edited.questions.at(-1)).toMatchObject({ number: r.questions.length + 1, text: "Anything else we should know?" });
    expect(edited.draft!.status).toBe("edited");
    expect((await history(r.id))[0]!.changes).toMatchObject({ "section Annex": { from: null, to: "added" }, "AI draft": { from: "accepted", to: "accepted with changes" } });

    const back = { ...content, sections: content.sections.slice(0, -1), questions: content.questions.slice(0, -1) };
    expect(ok<RfpDetail>(await t.as(ADMIN).put(`/api/rfps/${r.id}/content`).send(back)).draft!.status).toBe("accepted");
    // Saving the same again records nothing.
    const before = (await history(r.id)).length;
    ok(await t.as(ADMIN).put(`/api/rfps/${r.id}/content`).send(back));
    expect((await history(r.id)).length).toBe(before);
  });

  it("refuses weights within a part that do not add up to 100, and a question without a written criterion", async () => {
    const r = await drafted();
    const criteria = r.criteria.map((c) => ({ key: c.id, name: c.name, weight: c.weight, part: c.part }));
    const questions = r.questions.map((q) => ({ text: q.text, criterionKey: q.criterionId }));
    const sections = r.sections.map((s) => ({ heading: s.heading, body: s.body }));
    const off = await t
      .as(MEMBER)
      .put(`/api/rfps/${r.id}/content`)
      .send({ sections, criteria: criteria.map((c, i) => (i === 0 ? { ...c, weight: c.weight + 5 } : c)), questions });
    expect(off.status).toBe(400);
    expect(off.body.error.fields["weights.written"]).toContain("add up to 105");
    const demo = r.criteria.find((c) => c.part === "demo")!;
    const wrong = await t
      .as(MEMBER)
      .put(`/api/rfps/${r.id}/content`)
      .send({ sections, criteria, questions: [{ text: "Stray?", criterionKey: demo.id }] });
    expect(wrong.body.error.fields["questions.0.criterionKey"]).toBeTruthy();
    const none = await t
      .as(MEMBER)
      .put(`/api/rfps/${r.id}/content`)
      .send({ sections, criteria, questions: [{ text: "Stray?", criterionKey: "nowhere" }] });
    expect(none.status).toBe(400);
    expect((await get(r.id)).questions).toHaveLength(r.questions.length);
  });

  it("a review names the draft that was read: after asking again, the old one cannot be taken over", async () => {
    const r = await create();
    const first = ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfps/${r.id}/draft`), 201);
    const second = ok<RfpDetail>(await t.as(ADMIN).post(`/api/rfps/${r.id}/draft`), 201);
    expect(second.draft!.id).not.toBe(first.draft!.id);
    const stale = await t.as(MEMBER).post(`/api/rfps/${r.id}/draft/review`).send({ action: "accept", suggestionId: first.draft!.id });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("suggestion_replaced");
    expect((await get(r.id)).sections).toEqual([]);
    const rejected = ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfps/${r.id}/draft/review`).send({ action: "reject", suggestionId: second.draft!.id }));
    expect(rejected.draft!.status).toBe("rejected");
  });

  it("when the AI cannot answer, nothing changes, and the template still gives a start by hand", async () => {
    const r = await create();
    t.ports.ai.simulate!("unavailable");
    try {
      const res = await t.as(MEMBER).post(`/api/rfps/${r.id}/draft`);
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe("ai_unavailable");
      t.ports.ai.simulate!("nonsense");
      expect((await t.as(MEMBER).post(`/api/rfps/${r.id}/draft`)).status).toBe(502);
    } finally {
      t.ports.ai.simulate!("working");
    }
    expect((await get(r.id)).draft).toBeNull();
    const started = ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfps/${r.id}/template`));
    expect(started.sections.length).toBe(6);
    expect(started.sections.every((s) => s.body == null)).toBe(true);
    expect(started.criteria.length).toBe(6);
    expect((await t.as(MEMBER).post(`/api/rfps/${r.id}/template`)).status).toBe(409);
  });
});

describe("Q-3 review", () => {
  it("exports as Word and as PDF, with the demand, the sections, the criteria with weights and the questions", async () => {
    const r = await drafted({ title: `Expense tool (pilot) é ${n()}`, sponsor: "Finance director", budgetMinor: 80_000_00 });
    const word = await file(`/api/rfps/${r.id}/rfp.docx`);
    expect(word.headers["content-type"]).toContain("wordprocessingml");
    expect(word.headers["content-disposition"]).toContain("%28pilot%29%20%C3%A9");
    const w = await wordText(word.body as Buffer);
    const pdf = await file(`/api/rfps/${r.id}/rfp.pdf`);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    const p = await textOf(pdf.body as Buffer);
    for (const text of [w, p]) {
      expect(text).toContain(r.title);
      expect(text).toContain("Finance director");
      expect(text).toContain("€ 80,000.00");
      expect(text).toContain(r.sections[0]!.heading);
      expect(text).toContain(`${r.criteria[0]!.name}`);
      expect(text).toContain(`${r.criteria[0]!.weight}%`);
      expect(text).toContain(r.questions.at(-1)!.text);
      expect(text).toContain("70% of the overall score");
    }
  });

  it("cannot be approved without an approval, nor while a requested change is open", async () => {
    const r = await drafted();
    const signoff = (body: object) =>
      t
        .as(MEMBER)
        .post(`/api/rfps/${r.id}/signoffs`)
        .send({ reviewerName: "Chris Tanaka", outcome: "approved", onDate: TODAY, ...body });
    expect((await signoff({})).status, "not in review yet").toBe(409);
    ok(await t.as(MEMBER).post(`/api/rfps/${r.id}/stage`).send({ to: "in_review" }));
    const none = await t.as(MEMBER).post(`/api/rfps/${r.id}/stage`).send({ to: "approved" });
    expect(none.status).toBe(409);
    expect(none.body.error.message).toContain("No reviewer has approved");

    expect((await signoff({ outcome: "changes_requested" })).body.error.fields.comment).toBeTruthy();
    expect((await signoff({ onDate: "2026-11-22" })).body.error.fields.onDate).toBeTruthy();
    const asked = ok<RfpDetail>(
      await signoff({ reviewerName: "Robin Vale", reviewerRole: "Security", outcome: "changes_requested", comment: "Add a question on audit logs." }),
      201,
    );
    ok(await signoff({ reviewerRole: "CTO" }), 201);
    const open = await t.as(MEMBER).post(`/api/rfps/${r.id}/stage`).send({ to: "approved" });
    expect(open.status).toBe(409);
    expect(open.body.error.message).toContain("still open");

    const request = asked.signoffs.find((s) => s.outcome === "changes_requested")!;
    const dealt = ok<RfpDetail>(await t.as(ADMIN).patch(`/api/rfp-signoffs/${request.id}`).send({ resolved: true }));
    expect(dealt.signoffs.find((s) => s.id === request.id)!.resolvedOn).toBe(TODAY);
    const done = ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfps/${r.id}/stage`).send({ to: "approved" }));
    expect(done.stage).toBe("approved");
    const trail = await history(r.id);
    expect(trail[0]!.changes).toMatchObject({ Stage: { from: "In review", to: "Approved" } });
    expect(trail.some((e) => "sign-off by Robin Vale" in e.changes)).toBe(true);
    // Once approved the sign-offs stand.
    expect((await t.as(MEMBER).delete(`/api/rfp-signoffs/${request.id}`)).status).toBe(409);
  });

  it("a draft that is not ready cannot go to review", async () => {
    const r = await create();
    const res = await t.as(MEMBER).post(`/api/rfps/${r.id}/stage`).send({ to: "in_review" });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain("no sections");
    ok(await t.as(MEMBER).post(`/api/rfps/${r.id}/template`));
    expect((await t.as(MEMBER).post(`/api/rfps/${r.id}/stage`).send({ to: "in_review" })).body.error.message).toContain("question list is empty");
  });
});

describe("Q-4 candidates", () => {
  it("keeps a longlist and a shortlist with a reason each; an unknown candidate becomes a prospect vendor", async () => {
    const r = await create();
    const name = `Newcomer ${n()}`;
    const noReason = await t
      .as(MEMBER)
      .post(`/api/rfps/${r.id}/candidates`)
      .send({ newVendor: { name, type: "software" }, reason: " " });
    expect(noReason.body.error.fields.reason).toBeTruthy();
    const one = ok<RfpDetail>(
      await t
        .as(MEMBER)
        .post(`/api/rfps/${r.id}/candidates`)
        .send({ newVendor: { name, type: "software" }, reason: "Recommended by a peer" }),
      201,
    );
    expect(one.candidates[0]).toMatchObject({ vendorName: name, vendorStatus: "prospect", list: "longlist", reason: "Recommended by a peer", nda: "missing" });
    const vendor = (await t.as(MEMBER).get(`/api/vendors/${one.candidates[0]!.vendorId}`)).body;
    expect(vendor).toMatchObject({ name, status: "prospect", type: "software", ownerUserId: me });

    const two = await addCandidate(r.id, { vendorId: vendors["Bluefinch Systems"], list: "longlist", reason: "Current supplier" });
    expect(two.candidates[1]).toMatchObject({ vendorName: "Bluefinch Systems", vendorStatus: "active", nda: "in_place" });
    expect((await t.as(MEMBER).post(`/api/rfps/${r.id}/candidates`).send({ vendorId: vendors["Bluefinch Systems"], reason: "Again" })).body.error.fields.vendorId).toContain(
      "already a candidate",
    );
    expect(
      (
        await t
          .as(MEMBER)
          .post(`/api/rfps/${r.id}/candidates`)
          .send({ newVendor: { name: name.toUpperCase(), type: "software" }, reason: "Again" })
      ).body.error.fields["newVendor.name"],
    ).toBeTruthy();

    const moved = ok<RfpDetail>(await t.as(ADMIN).patch(`/api/rfp-candidates/${two.candidates[1]!.id}`).send({ list: "shortlist", reason: "Strong references" }));
    expect(moved.candidates[1]).toMatchObject({ list: "shortlist", reason: "Strong references" });
    const dropped = ok<RfpDetail>(await t.as(ADMIN).patch(`/api/rfp-candidates/${two.candidates[0]!.id}`).send({ list: "dropped", reason: "No EU hosting" }));
    expect(dropped.candidates[0]).toMatchObject({ list: "dropped", reason: "No EU hosting", vendorStatus: "prospect" });
    expect((await t.as(ADMIN).patch(`/api/rfp-candidates/${two.candidates[0]!.id}`).send({ list: "shortlist" })).status).toBe(400);
    expect((await history(r.id))[0]!.changes[`candidate ${name}`]).toEqual({ from: "Longlist: Recommended by a peer", to: "Dropped: No EU hosting" });

    const gone = ok<RfpDetail>(await t.as(MEMBER).delete(`/api/rfp-candidates/${two.candidates[0]!.id}`));
    expect(gone.candidates).toHaveLength(1);
    // The prospect vendor stays, as the requirement says.
    expect((await t.as(MEMBER).get(`/api/vendors/${one.candidates[0]!.vendorId}`)).body.status).toBe("prospect");
  });
  it("an offboarded vendor cannot be a candidate", async () => {
    const r = await create();
    const v = ok<{ id: string }>(
      await t
        .as(ADMIN)
        .post("/api/vendors")
        .send({ name: `Gone ${n()}`, type: "software", ownerUserId: admin, status: "offboarded" }),
      201,
    );
    expect((await t.as(MEMBER).post(`/api/rfps/${r.id}/candidates`).send({ vendorId: v.id, reason: "Old friend" })).body.error.fields.vendorId).toContain("offboarded");
  });
});

describe("Q-5 issue", () => {
  it("exports the RFP as Word and the questions as an Excel answer sheet per shortlisted candidate, without anything internal", async () => {
    const r = await approved({ sponsor: "Finance director", budgetMinor: 80_000_00 });
    const name = `Candidate ${n()}`;
    const now = await addCandidate(r.id, { newVendor: { name, type: "software" } });
    const c = now.candidates[0]!;
    const word = await wordText((await file(`/api/rfp-candidates/${c.id}/rfp.docx`)).body as Buffer);
    expect(word).toContain(`for ${name}`);
    expect(word).toContain(r.questions[0]!.text);
    expect(word).toContain(r.sections[0]!.heading);
    expect(word).not.toContain("Finance director");
    expect(word).not.toContain("80,000");
    expect(word).not.toContain("internal");

    const sheet = await file(`/api/rfp-candidates/${c.id}/answer-sheet.xlsx`);
    expect(sheet.headers["content-type"]).toContain("spreadsheetml");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(sheet.body);
    const ws = wb.getWorksheet("Answers")!;
    expect(String(ws.getRow(2).getCell(1).value)).toContain(name);
    expect((ws.getRow(5).values as unknown[]).slice(1)).toEqual(["No.", "Criterion", "Question", "Answer"]);
    expect(ws.rowCount).toBe(5 + r.questions.length);
    expect(ws.getRow(6).getCell(1).value).toBe(1);
    expect(ws.getRow(6).getCell(3).value).toBe(r.questions[0]!.text);

    // Not for a candidate on the longlist, and not before approval.
    const long = await addCandidate(r.id, { vendorId: vendors["Bluefinch Systems"], list: "longlist" });
    expect((await t.as(MEMBER).get(`/api/rfp-candidates/${long.candidates[1]!.id}/rfp.docx`)).status).toBe(409);
  });

  it("issuing without an NDA in place needs the warning acknowledged; with an NDA it does not", async () => {
    const r = await approved();
    await addCandidate(r.id, { newVendor: { name: `Candidate ${n()}`, type: "software" } });
    const now = await addCandidate(r.id, { vendorId: vendors["Bluefinch Systems"] });
    const [fresh, known] = now.candidates;
    const refused = await t.as(MEMBER).post(`/api/rfp-candidates/${fresh!.id}/issue`).send({ issuedOn: TODAY });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("nda_missing");
    expect(refused.body.error.message).toContain("No NDA is in place");
    expect((await get(r.id)).stage).toBe("approved");
    expect((await t.as(MEMBER).post(`/api/rfp-candidates/${fresh!.id}/issue`).send({ issuedOn: "2026-11-22", ndaWarningAcknowledged: true })).status).toBe(400);

    const out = ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfp-candidates/${fresh!.id}/issue`).send({ issuedOn: "2026-11-20", ndaWarningAcknowledged: true }));
    expect(out.stage).toBe("issued");
    expect(out.candidates[0]).toMatchObject({ issuedOn: "2026-11-20", ndaWarningAcknowledgedBy: MEMBER });
    expect((await history(r.id))[0]!.changes).toMatchObject({ Stage: { from: "Approved", to: "Issued" } });
    const fine = ok<RfpDetail>(await t.as(ADMIN).post(`/api/rfp-candidates/${known!.id}/issue`).send({ issuedOn: TODAY }));
    expect(fine.candidates[1]).toMatchObject({ issuedOn: TODAY, ndaWarningAcknowledgedBy: null });
    expect((await t.as(ADMIN).post(`/api/rfp-candidates/${known!.id}/issue`).send({ issuedOn: TODAY })).status).toBe(409);
  });

  it("once issued, sections, criteria, questions and the part weights are locked", async () => {
    const { rfp } = await issued();
    const content = {
      sections: rfp.sections.map((s) => ({ heading: s.heading, body: s.body })),
      criteria: rfp.criteria.map((c) => ({ key: c.id, name: c.name, weight: c.weight, part: c.part })),
      questions: rfp.questions.slice(1).map((q) => ({ text: q.text, criterionKey: q.criterionId })),
    };
    const res = await t.as(ADMIN).put(`/api/rfps/${rfp.id}/content`).send(content);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("rfp_locked");
    expect((await t.as(ADMIN).patch(`/api/rfps/${rfp.id}`).send({ writtenWeight: 50, demoWeight: 50 })).status).toBe(409);
    expect((await t.as(ADMIN).post(`/api/rfps/${rfp.id}/draft`)).status).toBe(409);
    expect((await t.as(ADMIN).post(`/api/rfps/${rfp.id}/stage`).send({ to: "drafting" })).status).toBe(409);
    expect((await get(rfp.id)).questions).toHaveLength(rfp.questions.length);
    // The rest of the demand can still be corrected.
    expect(ok<RfpDetail>(await t.as(ADMIN).patch(`/api/rfps/${rfp.id}`).send({ sponsor: "New sponsor" })).sponsor).toBe("New sponsor");
  });

  it("only an approved RFP is issued, and only to the shortlist", async () => {
    const r = await drafted();
    const now = await addCandidate(r.id, { vendorId: vendors["Bluefinch Systems"] });
    expect((await t.as(MEMBER).post(`/api/rfp-candidates/${now.candidates[0]!.id}/issue`).send({ issuedOn: TODAY })).status).toBe(409);
  });
});

describe("Q-6 responses", () => {
  it("matches an uploaded answer sheet to the questions and shows what it could not match for manual entry", async () => {
    const { rfp, fresh } = await issued();
    const last = rfp.questions.length;
    const data = await filledSheet(
      fresh.id,
      (number) => (number === 2 ? null : `Answer to question ${number}.`),
      (ws) => {
        // The vendor renumbered one row and added a remark of its own.
        ws.getRow(5 + last).getCell(1).value = 999;
        ws.getRow(5 + last).getCell(3).value = "A question we rewrote";
        ws.addRow(["", "", "", "We would also like to mention our awards."]);
      },
    );
    const up = ok<{ rfp: RfpDetail; result: { matched: number; unmatched: number; unanswered: number } }>(await upload(fresh.id, data, "Answers é.xlsx"), 201);
    expect(up.result).toEqual({ matched: last - 2, unmatched: 2, unanswered: 2 });
    const c = up.rfp.candidates.find((x) => x.id === fresh.id)!;
    expect(c).toMatchObject({ answered: last - 2, responseReceivedOn: TODAY });
    expect(c.unmatched.map((u) => u.answer)).toEqual([`Answer to question ${last}.`, "We would also like to mention our awards."]);
    expect(c.unmatched[0]).toMatchObject({ number: "999", question: "A question we rewrote" });
    expect(c.documents.map((d) => d.fileName)).toEqual(["Answers é.xlsx"]);
    expect(up.rfp.stage).toBe("evaluating");
    expect(up.rfp.answers.find((a) => a.candidateId === fresh.id && a.questionId === rfp.questions[0]!.id)!.text).toBe("Answer to question 1.");

    // Manual entry: place the unmatched row under its question, type the missing one, set the remark aside.
    const lastQ = rfp.questions.at(-1)!;
    const placed = ok<RfpDetail>(
      await t.as(ADMIN).put(`/api/rfp-candidates/${fresh.id}/answers/${lastQ.id}`).send({ text: c.unmatched[0]!.answer, fromUnmatchedRow: c.unmatched[0]!.row }),
    );
    expect(placed.candidates.find((x) => x.id === fresh.id)!.unmatched).toHaveLength(1);
    const typed = ok<RfpDetail>(await t.as(ADMIN).put(`/api/rfp-candidates/${fresh.id}/answers/${rfp.questions[1]!.id}`).send({ text: "Typed in by hand." }));
    expect(typed.candidates.find((x) => x.id === fresh.id)!.answered).toBe(last);
    const aside = ok<RfpDetail>(await t.as(ADMIN).delete(`/api/rfp-candidates/${fresh.id}/unmatched/${c.unmatched[1]!.row}`));
    expect(aside.candidates.find((x) => x.id === fresh.id)!.unmatched).toEqual([]);
    expect((await history(rfp.id)).some((e) => `answer of ${fresh.vendorName} to question 2` in e.changes)).toBe(true);

    // The stored sheet can be downloaded again.
    const doc = aside.candidates.find((x) => x.id === fresh.id)!.documents[0]!;
    expect((await file(`/api/documents/${doc.id}/download`)).headers["content-disposition"]).toContain("Answers%20%C3%A9.xlsx");
  });

  it("uploading again replaces the answers it matches and keeps the others", async () => {
    const { rfp, known } = await issued();
    ok(await upload(known.id, await filledSheet(known.id, (number) => `First ${number}`)), 201);
    const again = ok<{ rfp: RfpDetail }>(await upload(known.id, await filledSheet(known.id, (number) => (number === 1 ? "Second 1" : null))), 201);
    const mine = again.rfp.answers.filter((a) => a.candidateId === known.id);
    expect(mine).toHaveLength(rfp.questions.length);
    expect(mine.find((a) => a.questionId === rfp.questions[0]!.id)!.text).toBe("Second 1");
    expect(mine.find((a) => a.questionId === rfp.questions[1]!.id)!.text).toBe("First 2");
  });

  it("refuses a file that is not the answer sheet, and a response for a candidate the RFP did not go to", async () => {
    const { rfp, fresh } = await issued();
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Prices").addRow(["Item", "Price"]);
    const other = await upload(fresh.id, Buffer.from(await wb.xlsx.writeBuffer()));
    expect(other.status).toBe(400);
    expect(other.body.error.code).toBe("not_an_answer_sheet");
    expect((await upload(fresh.id, Buffer.from("%PDF-1.4 not a sheet"), "answers.pdf")).status).toBe(400);
    expect((await upload(fresh.id, Buffer.from("not a workbook"), "answers.xlsx")).status).toBe(400);
    expect((await get(rfp.id)).candidates.find((c) => c.id === fresh.id)!.documents).toEqual([]);
    const long = await addCandidate(rfp.id, { vendorId: vendors["Quillon Consulting"], list: "longlist" });
    const c = long.candidates.find((x) => x.vendorName === "Quillon Consulting")!;
    expect((await upload(c.id, Buffer.from("x"), "answers.xlsx")).status).toBe(409);
  });

  it("other response documents can be attached, downloaded and removed", async () => {
    const { rfp, fresh } = await issued();
    const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");
    const attached = ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfp-candidates/${fresh.id}/documents`).attach("file", PDF, "Security whitepaper.pdf"), 201);
    const doc = attached.candidates.find((c) => c.id === fresh.id)!.documents[0]!;
    expect(doc).toMatchObject({ fileName: "Security whitepaper.pdf", createdBy: MEMBER });
    expect(((await file(`/api/documents/${doc.id}/download`)).body as Buffer).equals(PDF)).toBe(true);
    expect((await t.as(MEMBER).post(`/api/rfp-candidates/${fresh.id}/documents`).attach("file", Buffer.from("hello"), "notes.txt")).status).toBe(400);
    // The agreements' own removal does not reach an RFP's documents.
    expect((await t.as(MEMBER).delete(`/api/documents/${doc.id}`)).status).toBe(404);
    const removed = ok<RfpDetail>(await t.as(ADMIN).delete(`/api/rfp-documents/${doc.id}`));
    expect(removed.candidates.find((c) => c.id === fresh.id)!.documents).toEqual([]);
    expect((await t.as(MEMBER).get(`/api/documents/${doc.id}/download`)).status).toBe(404);
    expect((await history(rfp.id))[0]!.changes[`document Security whitepaper.pdf of ${fresh.vendorName}`]).toEqual({ from: "attached", to: "removed" });
  });
});

/** Both candidates answered: the new one in detail, the known one briefly and not everything. */
async function answered() {
  const x = await issued();
  ok(
    await upload(
      x.fresh.id,
      await filledSheet(
        x.fresh.id,
        (number, q) =>
          `Our answer to "${q}" is yes, in full: we have done this for 45 comparable clients since 2019, with a team of 12, and can show references for each. Reference ${number}.`,
      ),
    ),
    201,
  );
  const up = ok<{ rfp: RfpDetail }>(await upload(x.known.id, await filledSheet(x.known.id, (number) => (number % 4 === 0 ? null : "Yes, we can."))), 201);
  return { ...x, rfp: up.rfp };
}

describe("Q-7 AI comparison", () => {
  it("summarises each candidate's answer per question with the differences, and proposes a score per candidate and criterion with a reason that quotes the answer", async () => {
    const { rfp, fresh, known } = await answered();
    const compared = ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfps/${rfp.id}/comparison`), 201);
    const c = compared.comparison!;
    expect(c.status).toBe("proposed");
    expect(compared.comparisonOutdated).toBe(false);
    expect(c.output.questions.map((q) => q.questionId).sort()).toEqual(rfp.questions.map((q) => q.id).sort());
    for (const q of c.output.questions) {
      expect(q.summaries.map((s) => s.candidateId).sort()).toEqual([fresh.id, known.id].sort());
      expect(q.differences.length).toBeGreaterThan(0);
    }
    const fourth = c.output.questions.find((q) => q.questionId === rfp.questions[3]!.id)!;
    expect(fourth.summaries.find((s) => s.candidateId === known.id)!.summary).toBe("No answer.");
    const written = rfp.criteria.filter((k) => k.part === "written");
    expect(c.output.scores).toHaveLength(written.length * 2);
    for (const s of c.output.scores) {
      expect(written.some((k) => k.id === s.criterionId)).toBe(true);
      expect(s.score).toBeGreaterThanOrEqual(1);
      expect(s.score).toBeLessThanOrEqual(5);
      // The reason rests on the candidate's own words: the quote is in one of its answers to that criterion.
      const answers = rfp.answers.filter((a) => a.candidateId === s.candidateId && rfp.questions.find((q) => q.id === a.questionId)!.criterionId === s.criterionId);
      expect(answers.some((a) => a.text.includes(s.quote))).toBe(true);
    }
    // Nothing is scored by the comparison itself.
    expect(compared.scores).toEqual([]);
    expect((await history(rfp.id))[0]!.changes["AI comparison"]!.to).toContain("written by the AI");
  });

  it("says when an answer changed after the comparison, and asking again replaces it", async () => {
    const { rfp, known } = await answered();
    const first = ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfps/${rfp.id}/comparison`), 201);
    const changed = ok<RfpDetail>(await t.as(MEMBER).put(`/api/rfp-candidates/${known.id}/answers/${rfp.questions[3]!.id}`).send({ text: "Yes, added later." }));
    expect(changed.comparisonOutdated).toBe(true);
    const second = ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfps/${rfp.id}/comparison`), 201);
    expect(second.comparison!.id).not.toBe(first.comparison!.id);
    expect(second.comparisonOutdated).toBe(false);
    const summary = second.comparison!.output.questions.find((q) => q.questionId === rfp.questions[3]!.id)!.summaries.find((s) => s.candidateId === known.id)!.summary;
    expect(summary).toBe("Yes, added later.");
  });

  it("needs answers, and when the AI cannot answer nothing changes", async () => {
    const { rfp } = await issued();
    expect((await t.as(MEMBER).post(`/api/rfps/${rfp.id}/comparison`)).body.error.code).toBe("no_answers");
    const full = await answered();
    t.ports.ai.simulate!("unavailable");
    try {
      const res = await t.as(MEMBER).post(`/api/rfps/${full.rfp.id}/comparison`);
      expect(res.status).toBe(502);
      expect(res.body.error.message).toContain("can still be done by hand");
    } finally {
      t.ports.ai.simulate!("working");
    }
    expect((await get(full.rfp.id)).comparison).toBeNull();
  });
});

describe("Q-8 scoring", () => {
  it("each member scores each candidate per criterion, demo criteria included; the app shows averages, part scores, the overall score and the ranking", async () => {
    const { rfp, fresh, known } = await answered();
    const score = (as: string, candidateId: string, criterionId: string, body: object | null) =>
      body ? t.as(as).put(`/api/rfp-candidates/${candidateId}/scores/${criterionId}`).send(body) : t.as(as).delete(`/api/rfp-candidates/${candidateId}/scores/${criterionId}`);
    // Mira gives the new candidate 4 everywhere and the known one 3; the admin gives 5 and 2.
    for (const k of rfp.criteria) {
      ok(await score(MEMBER, fresh.id, k.id, { score: 4, comment: k.part === "demo" ? "Clear demo" : null }));
      ok(await score(ADMIN, fresh.id, k.id, { score: 5 }));
      ok(await score(MEMBER, known.id, k.id, { score: 3 }));
    }
    let now = await get(rfp.id);
    const of = (id: string) => now.results.find((r) => r.candidateId === id)!;
    expect(of(fresh.id)).toMatchObject({ written: { hundredths: 450 }, demo: { hundredths: 450 }, overallHundredths: 450, rank: 1 });
    expect(of(fresh.id).criteria.every((c) => c.averageHundredths === 450 && c.scores === 2)).toBe(true);
    expect(of(known.id)).toMatchObject({ overallHundredths: 300, rank: 2 });
    expect(now.scores.filter((s) => s.evaluatorUserId === me)).toHaveLength(rfp.criteria.length * 2);
    expect(now.scores.find((s) => s.evaluatorUserId === me && s.candidateId === fresh.id && s.comment)!.comment).toBe("Clear demo");

    // The admin lowers one written criterion of the known candidate; only that candidate's figures move.
    const first = rfp.criteria.find((k) => k.part === "written")!;
    ok(await score(ADMIN, known.id, first.id, { score: 1 }));
    now = await get(rfp.id);
    expect(of(known.id).criteria.find((c) => c.criterionId === first.id)).toMatchObject({ averageHundredths: 200, scores: 2 });
    // written = 3 − (weight/100)×1, overall = 0.7×written + 0.3×3
    const written = 300 - first.weight;
    expect(of(known.id).written.hundredths).toBe(written);
    expect(of(known.id).overallHundredths).toBe(Math.floor((70 * written + 30 * 300 + 50) / 100));
    expect(of(fresh.id).overallHundredths).toBe(450);

    // A score can be taken back; the candidate then has no part score until it is scored again.
    ok(await score(MEMBER, known.id, first.id, null));
    ok(await score(ADMIN, known.id, first.id, null));
    now = await get(rfp.id);
    expect(of(known.id)).toMatchObject({ written: { hundredths: null }, overallHundredths: null, rank: null });

    expect((await score(MEMBER, fresh.id, first.id, { score: 6 })).status).toBe(400);
    expect((await score(MEMBER, fresh.id, first.id, { score: 2.5 })).status).toBe(400);
    expect((await history(rfp.id)).some((e) => `score by Mira Okafor for ${known.vendorName} on ${first.name}` in e.changes)).toBe(true);
  });

  it("taking over the AI's proposed score names the comparison that was read", async () => {
    const { rfp, fresh } = await answered();
    const first = ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfps/${rfp.id}/comparison`), 201);
    const proposal = first.comparison!.output.scores.find((s) => s.candidateId === fresh.id)!;
    const put = (body: object) => t.as(MEMBER).put(`/api/rfp-candidates/${fresh.id}/scores/${proposal.criterionId}`).send(body);
    const second = ok<RfpDetail>(await t.as(ADMIN).post(`/api/rfps/${rfp.id}/comparison`), 201);
    const stale = await put({ score: proposal.score, suggestionId: first.comparison!.id });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("suggestion_replaced");
    expect((await get(rfp.id)).scores).toEqual([]);

    const taken = ok<RfpDetail>(await put({ score: proposal.score, suggestionId: second.comparison!.id }));
    expect(taken.scores[0]).toMatchObject({ score: proposal.score, suggestedScore: proposal.score, evaluatorUserId: me });
    expect(taken.comparison).toMatchObject({ status: "accepted", reviewedBy: MEMBER });
    const own = ok<RfpDetail>(await put({ score: proposal.score === 5 ? 4 : proposal.score + 1 }));
    expect(own.comparison!.status).toBe("edited");
    expect(own.scores[0]!.suggestedScore).toBe(proposal.score);
  });

  it("only candidates the RFP was issued to are scored", async () => {
    const { rfp } = await issued();
    const long = await addCandidate(rfp.id, { vendorId: vendors["Quillon Consulting"], list: "longlist" });
    const c = long.candidates.find((x) => x.vendorName === "Quillon Consulting")!;
    expect((await t.as(MEMBER).put(`/api/rfp-candidates/${c.id}/scores/${rfp.criteria[0]!.id}`).send({ score: 3 })).status).toBe(409);
    expect(long.results.map((r) => r.candidateId)).not.toContain(c.id);
  });
});

describe("Q-9 decision and Q-10 decision record", () => {
  it("records the winner and the rationale; the winner becomes an active vendor, no agreement is created, the others stay prospects", async () => {
    const r = await approved();
    const [winnerName, loserName] = [`Winner ${n()}`, `Runner-up ${n()}`];
    await addCandidate(r.id, { newVendor: { name: winnerName, type: "software" }, reason: "Best fit on paper" });
    let now = await addCandidate(r.id, { newVendor: { name: loserName, type: "software" }, reason: "Cheapest" });
    for (const c of now.candidates) now = ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfp-candidates/${c.id}/issue`).send({ issuedOn: TODAY, ndaWarningAcknowledged: true }));
    const [winner, loser] = now.candidates;
    for (const k of now.criteria) {
      ok(
        await t
          .as(MEMBER)
          .put(`/api/rfp-candidates/${winner!.id}/scores/${k.id}`)
          .send({ score: 5, comment: k === now.criteria[0] ? "Excellent fit" : null }),
      );
      ok(await t.as(ADMIN).put(`/api/rfp-candidates/${winner!.id}/scores/${k.id}`).send({ score: 4 }));
      ok(await t.as(MEMBER).put(`/api/rfp-candidates/${loser!.id}/scores/${k.id}`).send({ score: 3 }));
    }
    const agreementsBefore = (await t.as(MEMBER).get("/api/agreements").query({ pageSize: "1" })).body.total;

    const decide = (body: object) =>
      t
        .as(MEMBER)
        .post(`/api/rfps/${r.id}/decision`)
        .send({ winnerCandidateId: winner!.id, decidedOn: TODAY, rationale: "Highest score and the strongest references.", ...body });
    expect((await decide({ rationale: " " })).body.error.fields.rationale).toBeTruthy();
    expect((await decide({ decidedOn: "2026-11-22" })).body.error.fields.decidedOn).toBeTruthy();
    expect((await decide({ winnerCandidateId: NIL })).body.error.fields.winnerCandidateId).toBeTruthy();
    const decided = ok<RfpDetail>(await decide({}));
    expect(decided.stage).toBe("decided");
    expect(decided.decision).toEqual({ winnerCandidateId: winner!.id, winnerName, decidedOn: TODAY, rationale: "Highest score and the strongest references." });
    expect(decided.candidates.map((c) => c.vendorStatus)).toEqual(["active", "prospect"]);
    expect((await t.as(MEMBER).get("/api/agreements").query({ pageSize: "1" })).body.total).toBe(agreementsBefore);
    // The vendor's own history says it became active.
    const vendorTrail = (await t.as(MEMBER).get("/api/audit/history").query({ entityType: "vendor", entityId: winner!.vendorId })).body.items as {
      changes: Record<string, unknown> | null;
    }[];
    expect(vendorTrail[0]!.changes).toMatchObject({ status: { from: "prospect", to: "active" } });

    // Nothing can be changed after the decision.
    expect((await decide({})).status).toBe(409);
    expect((await t.as(MEMBER).put(`/api/rfp-candidates/${loser!.id}/scores/${now.criteria[0]!.id}`).send({ score: 5 })).status).toBe(409);
    expect((await t.as(MEMBER).patch(`/api/rfp-candidates/${loser!.id}`).send({ list: "dropped", reason: "Lost" })).status).toBe(409);
    expect((await t.as(MEMBER).post(`/api/rfps/${r.id}/cancel`).send({ reason: "Changed our mind" })).status).toBe(409);

    // Q-10: the whole trail in one PDF.
    const pdf = await file(`/api/rfps/${r.id}/decision-record.pdf`);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    const text = await textOf(pdf.body as Buffer);
    for (const part of [
      r.title,
      "A tool to submit and approve expenses.",
      "Chris Tanaka, CTO",
      "Approved",
      winnerName,
      loserName,
      "Best fit on paper",
      "Cheapest",
      "without an NDA in place",
      "Mira Okafor",
      "Alex Admin",
      "4.50",
      "3.00",
      "Excellent fit",
      "Highest score and the strongest references.",
      "Decided on 21 Nov 2026",
    ])
      expect(text, part).toContain(part);
  });

  it("a decision needs an issued RFP, and a winner the RFP went to", async () => {
    const r = await approved();
    const now = await addCandidate(r.id, { vendorId: vendors["Bluefinch Systems"] });
    const res = await t.as(MEMBER).post(`/api/rfps/${r.id}/decision`).send({ winnerCandidateId: now.candidates[0]!.id, decidedOn: TODAY, rationale: "Only one" });
    expect(res.status).toBe(409);
  });

  it("an RFP can be cancelled with a reason, after which nothing changes; its record says so", async () => {
    const { rfp } = await issued();
    expect((await t.as(MEMBER).post(`/api/rfps/${rfp.id}/cancel`).send({})).status).toBe(400);
    const cancelled = ok<RfpDetail>(await t.as(MEMBER).post(`/api/rfps/${rfp.id}/cancel`).send({ reason: "The budget was withdrawn." }));
    expect(cancelled).toMatchObject({ stage: "cancelled", cancelReason: "The budget was withdrawn." });
    expect((await t.as(MEMBER).patch(`/api/rfps/${rfp.id}`).send({ sponsor: "x" })).status).toBe(409);
    expect(await textOf((await file(`/api/rfps/${rfp.id}/decision-record.pdf`)).body as Buffer)).toContain("This RFP was cancelled. The budget was withdrawn.");
  });
});

describe("Q-11 overview", () => {
  it("lists RFPs with stage, owner and target date, searchable and filterable; open ones appear on the dashboard and in the report", async () => {
    const tag = n();
    const a = await create({ title: `Zeta ${tag} first`, targetDecisionDate: "2027-01-31" });
    const b = await create({ title: `Zeta ${tag} second`, targetDecisionDate: "2026-12-15", ownerUserId: admin });
    ok(await t.as(MEMBER).post(`/api/rfps/${b.id}/cancel`).send({ reason: "Not needed" }));
    const list = async (query: Record<string, string>) =>
      (
        await t
          .as(MEMBER)
          .get("/api/rfps")
          .query({ q: `Zeta ${tag}`, ...query })
      ).body as { items: RfpRow[]; total: number };
    const all = await list({});
    expect(all.total).toBe(2);
    expect(all.items.map((r) => [r.title, r.stage, r.ownerName, r.targetDecisionDate])).toEqual([
      [b.title, "cancelled", "Alex Admin", "2026-12-15"],
      [a.title, "drafting", "Mira Okafor", "2027-01-31"],
    ]);
    expect((await list({ stage: "open" })).items.map((r) => r.id)).toEqual([a.id]);
    expect((await list({ stage: "cancelled" })).items.map((r) => r.id)).toEqual([b.id]);
    expect((await list({ sort: "title", dir: "desc" })).items.map((r) => r.id)).toEqual([b.id, a.id]);
    expect((await t.as(MEMBER).get("/api/rfps").query({ stage: "nonsense" })).status).toBe(400);
    expect((await t.as(MEMBER).get(`/api/rfps/${NIL}`)).status).toBe(404);

    const dashboard = (await t.as(MEMBER).get("/api/dashboard")).body as Dashboard;
    expect(dashboard.rfps).toContainEqual({ id: a.id, title: a.title, stage: "Drafting" });
    expect(dashboard.rfps.map((r) => r.id)).not.toContain(b.id);
    const report = (await t.as(MEMBER).get("/api/report").query({ month: "2026-10" })).body as { data: { rfps: { id: string }[] } };
    expect(report.data.rfps.map((r) => r.id)).toContain(a.id);
  });

  it("a vendor's RFPs are listed for its panel", async () => {
    const { rfp, known } = await issued();
    const mine = (await t.as(MEMBER).get(`/api/vendors/${known.vendorId}/rfps`)).body as { id: string; title: string; stage: string; list: string; won: boolean }[];
    expect(mine).toContainEqual({ id: rfp.id, title: rfp.title, stage: "issued", list: "shortlist", won: false });
  });

  it("someone whose access is switched off can do nothing here", async () => {
    expect((await t.as("former@example.test").get("/api/rfps")).status).toBe(403);
    expect((await t.as("former@example.test").post("/api/rfps").send(demand())).status).toBe(403);
  });
});
