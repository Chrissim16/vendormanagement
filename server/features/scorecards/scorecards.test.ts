import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aiSuggestions, monthlyProposals } from "../../../db/schema";
import type { Criterion, Proposal, ProposalState, Scorecard, ScorecardDetail } from "../../../shared/scorecards";
import { scorecardContext } from "../../app";
import { ADMIN, binary, MEMBER, testApp } from "../../testing";
import { runMonthlyProposals } from "./proposals";

let t: Awaited<ReturnType<typeof testApp>>;
let me: string;
const ids: Record<string, string> = {};
beforeAll(async () => {
  t = await testApp();
  me = (await t.as(MEMBER).get("/api/me")).body.id;
  const vendors = (await t.as(MEMBER).get("/api/vendors").query({ status: "all", pageSize: "200" })).body.items as { id: string; name: string }[];
  for (const v of vendors) ids[v.name] = v.id;
});
afterAll(() => t.close());

const n = () => Math.random().toString(36).slice(2, 8);
const newVendor = async (name: string, fields: Record<string, unknown> = {}) =>
  (
    await t
      .as(MEMBER)
      .post("/api/vendors")
      .send({ name: `${name} ${n()}`, type: "software", ownerUserId: me, ndaRequired: false, dpaRequired: false, ...fields })
  ).body.id as string;
const criteria = async () => (await t.as(MEMBER).get("/api/scorecard-criteria")).body as Criterion[];
const history = async (entityType: string, entityId: string) =>
  (
    (await t.as(MEMBER).get("/api/audit/history").query({ entityType, entityId })).body.items as {
      userEmail: string;
      action: string;
      changes: Record<string, { from: unknown; to: unknown }> | null;
    }[]
  ).map((e) => ({ ...e, changes: e.changes ?? {} }));
const proposal = async (vendorId: string, month: string) => (await t.as(MEMBER).get(`/api/performance/vendors/${vendorId}/proposal`).query({ month })).body as ProposalState;
const askFor = (vendorId: string, month: string, as = MEMBER) => t.as(as).post(`/api/performance/vendors/${vendorId}/proposal`).send({ month });
const review = (id: string, body: unknown, as = MEMBER) =>
  t
    .as(as)
    .post(`/api/proposals/${id}/review`)
    .send(body as object);
const start = (vendorId: string, quarter: string, as = MEMBER) => t.as(as).post("/api/scorecards").send({ vendorId, quarter });
const card = async (id: string) => (await t.as(MEMBER).get(`/api/scorecards/${id}`)).body as ScorecardDetail;
const save = (id: string, body: unknown, as = MEMBER) =>
  t
    .as(as)
    .put(`/api/scorecards/${id}`)
    .send(body as object);
const scoreAll = (c: ScorecardDetail, score = 4) =>
  save(c.id, { lines: c.lines.map((l) => ({ criterionId: l.criterionId, score, vendorComment: `Comment on ${l.name}`, internalNote: `Secret about ${l.name}` })) });
/** Makes the AI fail, or answer what the test says, for the duration of `work`. */
async function withAi<T>(complete: (typeof t.ports.ai)["complete"], work: () => Promise<T>): Promise<T> {
  const real = t.ports.ai.complete;
  t.ports.ai.complete = complete;
  try {
    return await work();
  } finally {
    t.ports.ai.complete = real;
  }
}
const down = async () => {
  throw new Error("connect ECONNREFUSED");
};

describe("P-7 criteria", () => {
  it("starts with the five criteria from the domain model, two of them measured", async () => {
    const all = await criteria();
    expect(all.map((c) => [c.name, c.source])).toEqual([
      ["Quality of delivery", "measured"],
      ["Timeliness", "measured"],
      ["Responsiveness and communication", "manual"],
      ["Value for money", "manual"],
      ["Compliance and security", "manual"],
    ]);
    expect(all[0]!.metrics.sort()).toEqual(["csat", "first_line"]);
    expect(all[1]!.metrics.sort()).toEqual(["backlog_age", "first_response", "sla_breaches"]);
  });

  it("lets an admin add, reweight and switch off a criterion, each step in its history; a member cannot", async () => {
    const other = await testApp();
    try {
      const body = { name: "Innovation", description: "New ideas brought to the table.", weight: 10, source: "manual" };
      expect((await other.as(MEMBER).post("/api/admin/scorecard-criteria").send(body)).status).toBe(403);
      const added = await other.as(ADMIN).post("/api/admin/scorecard-criteria").send(body);
      expect(added.status).toBe(201);
      expect(added.body).toMatchObject({ name: "Innovation", weight: 10, source: "manual", metrics: [], active: true });
      const id = added.body.id as string;
      expect(
        (
          await other
            .as(MEMBER)
            .put(`/api/admin/scorecard-criteria/${id}`)
            .send({ ...body, weight: 30 })
        ).status,
      ).toBe(403);
      expect(
        (
          await other
            .as(ADMIN)
            .put(`/api/admin/scorecard-criteria/${id}`)
            .send({ ...body, weight: 30, active: false })
        ).body,
      ).toMatchObject({ weight: 30, active: false });
      const h = (await other.as(ADMIN).get("/api/audit/history").query({ entityType: "criterion", entityId: id })).body.items as { action: string; changes: object }[];
      expect(h.map((e) => [e.action, e.changes])).toEqual([
        ["update", { weight: { from: 10, to: 30 }, "in use": { from: true, to: false } }],
        ["create", { weight: { from: null, to: 10 }, "scored by": { from: null, to: "the reviewer" } }],
      ]);
      // A member still sees the criteria, the one switched off included.
      expect(((await other.as(MEMBER).get("/api/scorecard-criteria")).body as Criterion[]).find((c) => c.id === id)).toMatchObject({ active: false });
    } finally {
      await other.close();
    }
  });

  it("refuses a second criterion with the same name, a measured one without figures, a change of how it is scored, and switching off the last one", async () => {
    const other = await testApp();
    try {
      const admin = other.as(ADMIN);
      const all = (await admin.get("/api/scorecard-criteria")).body as Criterion[];
      const same = await admin.post("/api/admin/scorecard-criteria").send({ name: "  timeliness ", weight: 5, source: "manual" });
      expect(same.status).toBe(400);
      expect(same.body.error.fields.name).toMatch(/already a criterion/);
      expect((await admin.post("/api/admin/scorecard-criteria").send({ name: "Speed", weight: 5, source: "measured", metrics: [] })).body.error.fields.metrics).toMatch(
        /at least one/,
      );
      const first = all[0]!;
      expect((await admin.put(`/api/admin/scorecard-criteria/${first.id}`).send({ ...first, source: "manual" })).body.error.fields.source).toMatch(/cannot be changed/);
      for (const c of all.slice(1)) expect((await admin.put(`/api/admin/scorecard-criteria/${c.id}`).send({ ...c, active: false })).status).toBe(200);
      const last = await admin.put(`/api/admin/scorecard-criteria/${first.id}`).send({ ...first, active: false });
      expect(last.status).toBe(400);
      expect(last.body.error.fields.active).toMatch(/only criterion in use/);
      expect((await admin.put("/api/admin/scorecard-criteria/3f2b0c9e-8a51-4e0b-9a44-0d6f1c2e7b11").send(first)).status).toBe(404);
    } finally {
      await other.close();
    }
  });
});

describe("P-1 monthly proposal", () => {
  it("proposes a score per measured criterion with a reason and the figures used, and names ticket themes with example tickets", async () => {
    const state = await proposal(ids["Tarnwick Software"]!, "2026-10");
    expect(state.blocked).toBeNull();
    const p = state.proposal!;
    expect(p).toMatchObject({ status: "proposed", month: "2026-10", model: "scripted-strong", reviewedBy: null });
    expect(p.scores.map((s) => s.criterionName)).toEqual(["Quality of delivery", "Timeliness"]);
    // The figures shown with a proposal are the app's own, the same as on the performance page.
    const perf = (await t.as(MEMBER).get(`/api/performance/vendors/${ids["Tarnwick Software"]}`).query({ month: "2026-10" })).body.months.at(-1).cells;
    for (const s of p.scores) {
      expect(s.score).toBeGreaterThanOrEqual(1);
      expect(s.score).toBeLessThanOrEqual(5);
      expect(s.aiScore).toBe(s.score);
      expect(s.reason.length).toBeGreaterThan(10);
      for (const m of s.metrics) expect(m, m.key).toEqual({ key: m.key, ...perf[m.key] });
    }
    expect(p.scores[0]!.metrics.map((m) => m.key).sort()).toEqual(["csat", "first_line"]);
    expect(p.ticketsRead).toBeGreaterThan(5);
    for (const theme of p.themes) {
      expect(theme.tickets).toBeGreaterThanOrEqual(2);
      expect(theme.examples.length).toBeGreaterThan(0);
      expect(theme.examples.length).toBeLessThanOrEqual(3);
      for (const e of theme.examples) expect(e.key).toMatch(/^TAR-\d+$/);
    }
  });

  it("says why there is nothing to ask for: the running month, no board, not scored, too long ago", async () => {
    const tar = ids["Tarnwick Software"]!;
    expect((await proposal(tar, "2026-11")).blocked).toMatch(/once the month is over/);
    expect((await askFor(tar, "2026-11")).status).toBe(409);
    expect((await proposal(tar, "2024-01")).blocked).toMatch(/too long ago/);
    expect((await proposal(ids["Quillon Consulting"]!, "2026-10")).blocked).toMatch(/no Jira board/);
    expect((await proposal(ids["Emberline Advisory"]!, "2026-10")).blocked).toMatch(/Scoring is switched off/);
    expect((await askFor(tar, "October")).status).toBe(400);
    expect((await askFor("3f2b0c9e-8a51-4e0b-9a44-0d6f1c2e7b11", "2026-10")).status).toBe(404);
  });

  it("AI-1 changes nothing until a person accepts, edits or rejects; each decision is recorded with who and when", async () => {
    const tar = ids["Tarnwick Software"]!;
    const p = (await proposal(tar, "2026-09")).proposal!;
    expect(p.status).toBe("proposed");
    // A scorecard for the quarter shows what the AI suggests, and has no score of its own, before and after the proposal is accepted.
    const c = (await start(tar, "2026-Q3")).body as ScorecardDetail;
    const untouched = async () => {
      const now = await card(c.id);
      expect(now.lines.map((l) => l.score)).toEqual([null, null, null, null, null]);
      expect(now).toMatchObject({ overallTenths: null, scored: 0, status: "draft" });
      expect(now.lines[0]!.suggestion).not.toBeNull();
    };
    await untouched();
    const accepted = (await review(p.id, { action: "accept" })).body as Proposal;
    await untouched();
    expect(accepted).toMatchObject({ status: "accepted", reviewedBy: MEMBER, reviewedAt: "2026-11-21T12:00:00.000Z" });
    const quality = p.scores[0]!;
    const changed = quality.aiScore === 5 ? 4 : quality.aiScore + 1;
    const edited = (await review(p.id, { action: "edit", scores: [{ criterionId: quality.criterionId, score: changed }] })).body as Proposal;
    expect(edited.status).toBe("edited");
    expect(edited.scores[0]).toMatchObject({ score: changed, aiScore: quality.aiScore });
    // What the model wrote is kept untouched next to the person's change.
    const stored = (await t.ports.database.db.select().from(aiSuggestions).where(eq(aiSuggestions.subjectId, tar))).find((s) => s.status === "edited")!;
    expect((stored.output as { scores: { score: number }[] }).scores[0]!.score).toBe(quality.aiScore);
    expect(stored).toMatchObject({ kind: "monthly_proposal", promptVersion: "monthly-proposal/2", subjectType: "vendor", reviewedBy: MEMBER });
    // Putting the score back makes it a plain acceptance again.
    expect((await review(p.id, { action: "edit", scores: [{ criterionId: quality.criterionId, score: quality.aiScore }] })).body.status).toBe("accepted");
    expect((await review(p.id, { action: "reject" })).body.status).toBe("rejected");
    const h = (await history("vendor", tar)).flatMap((e) => Object.entries(e.changes).map(([k, v]) => [e.userEmail, k, v.from, v.to]));
    expect(h).toContainEqual([MEMBER, "AI proposal for September 2026", "not reviewed yet", "accepted"]);
    expect(h).toContainEqual([MEMBER, "September 2026 Quality of delivery: proposed score", quality.aiScore, changed]);
    expect(h).toContainEqual([MEMBER, "AI proposal for September 2026", "accepted", "rejected"]);
    expect(h).toContainEqual(["system", "AI proposal for September 2026", null, "written by the AI"]);
    expect((await review(p.id, { action: "edit", scores: [{ criterionId: quality.criterionId, score: 9 }] })).status).toBe(400);
    expect((await review(p.id, { action: "edit", scores: [{ criterionId: me, score: 3 }] })).status).toBe(400);
    expect((await review("3f2b0c9e-8a51-4e0b-9a44-0d6f1c2e7b11", { action: "accept" })).status).toBe(404);
  });

  it("can be asked for again while nobody has accepted it, and is kept once someone has", async () => {
    const tar = ids["Tarnwick Software"]!;
    const before = (await proposal(tar, "2026-08")).proposal!;
    const again = await askFor(tar, "2026-08");
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ id: before.id, status: "proposed" });
    // The answer that was replaced does not stay behind as something still waiting for a person.
    const waiting = (await t.ports.database.db.select().from(aiSuggestions).where(eq(aiSuggestions.subjectId, tar))).filter(
      (s) => s.status === "proposed" && s.inputSummary?.startsWith("August 2026"),
    );
    expect(waiting).toHaveLength(1);
    expect((await t.ports.database.db.select().from(monthlyProposals).where(eq(monthlyProposals.vendorId, tar))).filter((r) => r.month === "2026-08")).toHaveLength(1);
    await review(before.id, { action: "accept" });
    const kept = await askFor(tar, "2026-08");
    expect(kept.status).toBe(409);
    expect(kept.body.error.message).toMatch(/already been reviewed/);
  });

  it("AI-2 says so when the AI is unavailable or answers nonsense, and leaves everything as it was", async () => {
    const tar = ids["Tarnwick Software"]!;
    const before = (await proposal(tar, "2026-07")).proposal!;
    for (const complete of [
      down,
      async () => ({ text: "I would rather not.", model: "x" }),
      async () => ({ text: '{"scores":[{"criterionId":"nope","score":3,"reason":"x"}]}', model: "x" }),
    ]) {
      const res = await withAi(complete, () => askFor(tar, "2026-07"));
      expect(res.status).toBe(502);
      expect(res.body.error).toMatchObject({ code: "ai_unavailable", message: expect.stringMatching(/The AI could not write a proposal just now\. Nothing was changed.*by hand/) });
    }
    expect((await proposal(tar, "2026-07")).proposal).toEqual(before);
  });

  it("keeps only tickets the model was really given, and counts them itself", async () => {
    const tar = ids["Tarnwick Software"]!;
    const p = (await proposal(tar, "2026-07")).proposal!;
    const made = await withAi(
      async (req) => {
        const ask = JSON.parse(req.user) as { criteria: { id: string }[]; tickets: { key: string }[] };
        const real = ask.tickets.slice(0, 4).map((x) => x.key);
        return {
          model: "test-model",
          text: JSON.stringify({
            scores: ask.criteria.map((c) => ({ criterionId: c.id, score: 3, reason: "Fine." })),
            themes: [
              { title: "Real theme", summary: "Seen in several tickets.", ticketKeys: [...real, real[0], "TAR-999999", "OTHER-1"] },
              { title: "Made-up theme", summary: "Not in the tickets.", ticketKeys: ["TAR-999998", "TAR-999997"] },
              { title: "One ticket only", summary: "Does not recur.", ticketKeys: [real[1]] },
            ],
          }),
        };
      },
      () => askFor(tar, "2026-07"),
    );
    expect(made.status).toBe(201);
    expect(made.body.id).toBe(p.id);
    expect(made.body.model).toBe("test-model");
    expect(made.body.themes).toHaveLength(1);
    expect(made.body.themes[0]).toMatchObject({ title: "Real theme", tickets: 4 });
    expect(made.body.themes[0].examples).toHaveLength(3);
  });

  it("the monthly run writes last month's proposal for vendors that have none, once", async () => {
    const other = await testApp();
    try {
      const ctx = scorecardContext(other.config, other.ports);
      // The sample data already has October for the three linked vendors.
      expect(await runMonthlyProposals(ctx)).toEqual([]);
      const vendor = (
        await other
          .as(MEMBER)
          .post("/api/vendors")
          .send({ name: "Sedgewater run test", type: "software", ownerUserId: (await other.as(MEMBER).get("/api/me")).body.id })
      ).body.id;
      await other
        .as(ADMIN)
        .put(`/api/admin/vendors/${vendor}/jira-link`)
        .send({ projectKey: "SED", escalationMethod: "label", l2Values: ["tier-2"], l3Values: ["tier-3"] });
      const failed = await (async () => {
        const real = other.ports.ai.complete;
        other.ports.ai.complete = down;
        try {
          return await runMonthlyProposals(ctx);
        } finally {
          other.ports.ai.complete = real;
        }
      })();
      expect(failed).toEqual([{ vendorName: "Sedgewater run test", month: "2026-10", ok: false, message: expect.stringMatching(/The AI could not/) }]);
      expect(await runMonthlyProposals(ctx)).toEqual([{ vendorName: "Sedgewater run test", month: "2026-10", ok: true, message: null }]);
      expect(await runMonthlyProposals(ctx)).toEqual([]);
      const made = (await other.as(MEMBER).get(`/api/performance/vendors/${vendor}/proposal`).query({ month: "2026-10" })).body as ProposalState;
      expect(made.proposal).toMatchObject({ status: "proposed", reviewedBy: null });
    } finally {
      await other.close();
    }
  });
});

describe("P-2 quarterly scorecard", () => {
  it("starts a draft with the measured criteria suggested from the quarter's proposals, nothing scored yet", async () => {
    const other = await testApp();
    try {
      const tarId = ((await other.as(MEMBER).get("/api/vendors").query({ q: "Tarnwick" })).body.items as { id: string }[])[0]!.id;
      const months = await Promise.all(
        ["2026-07", "2026-08", "2026-09"].map(
          async (m) => ((await other.as(MEMBER).get(`/api/performance/vendors/${tarId}/proposal`).query({ month: m })).body as ProposalState).proposal!,
        ),
      );
      const made = await other.as(MEMBER).post("/api/scorecards").send({ vendorId: tarId, quarter: "2026-Q3" });
      expect(made.status).toBe(201);
      const c = made.body as ScorecardDetail;
      expect(c).toMatchObject({
        status: "draft",
        quarter: "2026-Q3",
        periodStart: "2026-07-01",
        periodEnd: "2026-09-30",
        reviewerName: "Mira Okafor",
        scored: 0,
        criteria: 5,
        overallTenths: null,
        hasBoard: true,
      });
      for (const [i, line] of c.lines.entries()) {
        expect(line.score).toBeNull();
        if (line.source === "manual") expect(line.suggestion).toBeNull();
        else {
          const scores = months.map((p) => p.scores[i]!.score);
          expect(line.suggestion!.score).toBe(Math.round(scores.reduce((a, b) => a + b, 0) / 3));
          expect(line.suggestion!.months.map((m) => [m.month, m.score, m.status])).toEqual(months.map((p) => [p.month, p.scores[i]!.score, "proposed"]));
        }
      }
      expect(c.helpdesk!.map((m) => [m.month, m.complete])).toEqual([
        ["2026-07", true],
        ["2026-08", true],
        ["2026-09", true],
      ]);
      // A rejected month no longer counts towards the suggestion.
      await other.as(MEMBER).post(`/api/proposals/${months[0]!.id}/review`).send({ action: "reject" });
      const after = (await other.as(MEMBER).get(`/api/scorecards/${c.id}`)).body as ScorecardDetail;
      expect(after.lines[0]!.suggestion!.months.map((m) => m.month)).toEqual(["2026-08", "2026-09"]);
    } finally {
      await other.close();
    }
  });

  it("saves scores, a comment for the vendor and an internal note per criterion, and records whether the AI's suggestion was taken", async () => {
    const draft = ((await t.as(MEMBER).get("/api/scorecards").query({ status: "draft" })).body.items as Scorecard[]).find((c) => c.vendorName === "Bluefinch Systems")!;
    const c = await card(draft.id);
    const [quality, timeliness, responsiveness] = c.lines as [ScorecardDetail["lines"][0], ScorecardDetail["lines"][0], ScorecardDetail["lines"][0]];
    expect(quality.suggestion).not.toBeNull();
    const other = timeliness.suggestion!.score === 1 ? 2 : timeliness.suggestion!.score - 1;
    const saved = await save(c.id, {
      summary: "Answering slipped late in the quarter.",
      lines: [
        { criterionId: quality.criterionId, score: quality.suggestion!.score, acceptedSuggestion: true },
        // Claims to follow the AI but gives another score: recorded as the reviewer's own.
        { criterionId: timeliness.criterionId, score: other, acceptedSuggestion: true, vendorComment: "Responses were late in September." },
        { criterionId: responsiveness.criterionId, score: 4, internalNote: "Ask for a new service manager." },
      ],
    });
    expect(saved.status).toBe(200);
    const after = saved.body as ScorecardDetail;
    expect(after.lines[0]).toMatchObject({ score: quality.suggestion!.score, acceptedSuggestion: true });
    expect(after.lines[1]).toMatchObject({ score: other, acceptedSuggestion: false, vendorComment: "Responses were late in September." });
    expect(after.lines[2]).toMatchObject({ score: 4, internalNote: "Ask for a new service manager.", acceptedSuggestion: false });
    expect(after.summary).toBe("Answering slipped late in the quarter.");
    // The line seeded earlier and not sent now is untouched.
    expect(after.lines[4]!.score).toBe(5);
    expect(after.scored).toBe(4);
    const top = (await history("scorecard", c.id))[0]!;
    expect(top.userEmail).toBe(MEMBER);
    expect(top.changes["Quality of delivery: score"]).toEqual({ from: null, to: quality.suggestion!.score });
    expect(top.changes["Quality of delivery: AI suggestion"]).toEqual({ from: null, to: `accepted (${quality.suggestion!.score})` });
    expect(top.changes["Timeliness: AI suggestion"]).toEqual({ from: null, to: `${timeliness.suggestion!.score}, not followed` });
    expect(top.changes["Responsiveness and communication: internal note"]).toEqual({ from: null, to: "Ask for a new service manager." });
    expect(top.changes.summary).toEqual({ from: null, to: "Answering slipped late in the quarter." });
    // Saving the same again records nothing.
    const count = (await history("scorecard", c.id)).length;
    await save(c.id, { lines: [{ criterionId: responsiveness.criterionId, score: 4, internalNote: "Ask for a new service manager." }] });
    expect((await history("scorecard", c.id)).length).toBe(count);
    expect((await save(c.id, { lines: [{ criterionId: me, score: 3 }] })).status).toBe(400);
    const twice = await save(c.id, {
      lines: [
        { criterionId: quality.criterionId, score: 1 },
        { criterionId: quality.criterionId, score: 2 },
      ],
    });
    expect(twice.status).toBe(400);
    expect((await card(c.id)).lines[0]!.score).toBe(quality.suggestion!.score);
    expect((await save(c.id, { lines: [{ criterionId: quality.criterionId, score: 7 }] })).status).toBe(400);
  });

  it("changes only what is sent, so a score, a comment and a note saved at the same moment all stay", async () => {
    const v = await newVendor("Partial");
    const c = (await start(v, "2026-Q3")).body as ScorecardDetail;
    const criterionId = c.lines[2]!.criterionId;
    const done = await Promise.all([
      save(c.id, { lines: [{ criterionId, score: 4 }] }),
      save(c.id, { lines: [{ criterionId, vendorComment: "For the vendor." }] }),
      save(c.id, { lines: [{ criterionId, internalNote: "For us." }] }),
      save(c.id, { summary: "Summary." }),
    ]);
    expect(done.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const after = await card(c.id);
    expect(after.lines[2]).toMatchObject({ score: 4, vendorComment: "For the vendor.", internalNote: "For us." });
    expect(after.summary).toBe("Summary.");
    // An empty text clears that text and nothing else; a score of null clears the score.
    expect((await save(c.id, { lines: [{ criterionId, vendorComment: "" }] })).body.lines[2]).toMatchObject({ score: 4, vendorComment: null, internalNote: "For us." });
    expect((await save(c.id, { lines: [{ criterionId, score: null }] })).body.lines[2]).toMatchObject({ score: null, internalNote: "For us." });
  });

  it("refuses a second scorecard for the same vendor and quarter, a quarter that has not started, and nonsense", async () => {
    const v = await newVendor("Twice");
    expect((await start(v, "2026-Q3")).status).toBe(201);
    const twice = await start(v, "2026-Q3");
    expect(twice.status).toBe(400);
    expect(twice.body.error.fields.quarter).toMatch(/already has a scorecard for Q3 2026/);
    expect((await start(v, "2027-Q1")).body.error.fields.quarter).toMatch(/has not started/);
    // The running quarter can be started.
    expect((await start(v, "2026-Q4")).status).toBe(201);
    expect((await start(v, "2026-Q7")).status).toBe(400);
    expect((await start("3f2b0c9e-8a51-4e0b-9a44-0d6f1c2e7b11", "2026-Q3")).body.error.fields.vendorId).toMatch(/not found/);
    expect((await t.as(MEMBER).get("/api/scorecards/3f2b0c9e-8a51-4e0b-9a44-0d6f1c2e7b11")).status).toBe(404);
  });

  it("lists scorecards with their overall score, filtered by vendor and status and searched by name", async () => {
    const all = (await t.as(MEMBER).get("/api/scorecards").query({ sort: "vendor", dir: "asc", pageSize: "200" })).body as { items: Scorecard[]; total: number };
    expect(all.items.map((c) => c.vendorName)).toEqual([...all.items.map((c) => c.vendorName)].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    const mossgate = (await t.as(MEMBER).get("/api/scorecards").query({ vendorId: ids["Mossgate IT"] })).body.items as Scorecard[];
    expect(mossgate).toHaveLength(1);
    expect(mossgate[0]).toMatchObject({ status: "final", quarter: "2026-Q3", scored: 5, criteria: 5, reviewerName: "Mira Okafor" });
    expect(mossgate[0]!.overallTenths).toBe((await card(mossgate[0]!.id)).overallTenths);
    const finals = (await t.as(MEMBER).get("/api/scorecards").query({ status: "final" })).body.items as Scorecard[];
    expect(finals.every((c) => c.status === "final")).toBe(true);
    expect(((await t.as(MEMBER).get("/api/scorecards").query({ q: "quill" })).body.items as Scorecard[]).map((c) => c.vendorName)).toEqual(["Quillon Consulting"]);
    expect((await t.as(MEMBER).get("/api/scorecards").query({ status: "open" })).status).toBe(400);
  });
});

describe("P-3 finalise", () => {
  it("needs a score on every criterion, then becomes read-only; only an admin can reopen it", async () => {
    const v = await newVendor("Finalise");
    const c = (await start(v, "2026-Q3")).body as ScorecardDetail;
    await save(c.id, { lines: c.lines.slice(0, 3).map((l) => ({ criterionId: l.criterionId, score: 3 })) });
    const early = await t.as(MEMBER).post(`/api/scorecards/${c.id}/finalise`);
    expect(early.status).toBe(409);
    expect(early.body.error.message).toBe("2 criteria have no score yet: Value for money, Compliance and security. Score every criterion before finalising.");
    await save(c.id, { lines: c.lines.slice(3).map((l, i) => ({ criterionId: l.criterionId, score: 4 + i })) });
    const done = await t.as(MEMBER).post(`/api/scorecards/${c.id}/finalise`);
    expect(done.status).toBe(200);
    // (3 + 3 + 3 + 4 + 5) / 5 = 3.6
    expect(done.body).toMatchObject({ status: "final", overallTenths: 36, finalisedBy: MEMBER, finalisedAt: "2026-11-21T12:00:00.000Z" });
    const refused = await save(c.id, { lines: [{ criterionId: c.lines[0]!.criterionId, score: 1 }] });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/final and can no longer be changed/);
    expect((await t.as(MEMBER).delete(`/api/scorecards/${c.id}`)).status).toBe(409);
    expect((await card(c.id)).lines[0]!.score).toBe(3);
    expect((await t.as(MEMBER).post(`/api/scorecards/${c.id}/reopen`)).status).toBe(403);
    const reopened = await t.as(ADMIN).post(`/api/scorecards/${c.id}/reopen`);
    expect(reopened.body).toMatchObject({ status: "draft", finalisedAt: null, overallTenths: 36 });
    expect((await t.as(ADMIN).post(`/api/scorecards/${c.id}/reopen`)).status).toBe(409);
    expect((await save(c.id, { lines: [{ criterionId: c.lines[0]!.criterionId, score: 1 }] })).status).toBe(200);
    const h = (await history("scorecard", c.id)).map((e) => [e.userEmail, e.changes.status?.from, e.changes.status?.to]).filter((e) => e[1]);
    expect(h).toEqual([
      [ADMIN, "final", "draft"],
      [MEMBER, "draft", "final"],
    ]);
  });

  it("waits until the quarter is over", async () => {
    const v = await newVendor("Running quarter");
    const c = (await start(v, "2026-Q4")).body as ScorecardDetail;
    await scoreAll(c, 4);
    const early = await t.as(MEMBER).post(`/api/scorecards/${c.id}/finalise`);
    expect(early.status).toBe(409);
    expect(early.body.error).toMatchObject({ code: "quarter_running", message: expect.stringMatching(/Q4 2026 is not over yet.*after 31 Dec 2026/) });
    expect((await card(c.id)).status).toBe("draft");
  });

  it("a draft started by mistake can be removed, with a trace in the audit log", async () => {
    const v = await newVendor("Mistake");
    const c = (await start(v, "2026-Q2")).body as ScorecardDetail;
    expect((await t.as(MEMBER).delete(`/api/scorecards/${c.id}`)).status).toBe(200);
    expect((await t.as(MEMBER).get(`/api/scorecards/${c.id}`)).status).toBe(404);
    expect((await history("scorecard", c.id))[0]).toMatchObject({ action: "delete", userEmail: MEMBER });
    expect((await start(v, "2026-Q2")).status).toBe(201);
  });
});

describe("P-4 vendors without Jira", () => {
  it("gets the same criteria, all scored by hand, with budgets, milestones and paperwork shown as facts", async () => {
    const v = await newVendor("Project vendor", { type: "consultancy", ndaRequired: true, dpaRequired: true });
    const agreement = (o: Record<string, unknown>) =>
      t
        .as(MEMBER)
        .post("/api/agreements")
        .send({ vendorId: v, ownerUserId: me, status: "active", signedOn: "2026-01-10", ...o });
    await agreement({ kind: "nda", title: "NDA" });
    const sow = async (title: string, budgetMinor: number, o: Record<string, unknown> = {}) =>
      (await agreement({ kind: "sow", title, pricing: "time_and_materials", budgetMinor, startDate: "2026-02-01", endDate: "2026-12-31", ...o })).body.id as string;
    const over = await sow("Over budget", 10_000_00);
    const within = await sow("Within budget", 50_000_00);
    await sow("Ended before the quarter", 5_000_00, { startDate: "2026-01-01", endDate: "2026-06-30", status: "ended", endReason: "completed" });
    const invoice = (agreementId: string, amountMinor: number, invoiceDate: string) =>
      t
        .as(MEMBER)
        .post("/api/invoices")
        .send({ agreementId, invoiceNumber: `F-${n()}`, invoiceDate, amountMinor });
    expect((await invoice(over, 12_000_00, "2026-08-15")).status).toBe(201);
    await invoice(within, 20_000_00, "2026-09-01");
    // Invoiced after the quarter: does not count for it.
    await invoice(within, 40_000_00, "2026-10-15");
    const milestone = (o: Record<string, unknown>) =>
      t
        .as(MEMBER)
        .post(`/api/agreements/${within}/milestones`)
        .send({ title: `M ${n()}`, ...o });
    expect((await milestone({ dueDate: "2026-07-31", status: "delivered", deliveredOn: "2026-07-30" })).status).toBe(201);
    await milestone({ dueDate: "2026-08-31", status: "delivered", deliveredOn: "2026-09-12" });
    await milestone({ dueDate: "2026-09-15" });
    await milestone({ dueDate: "2026-09-20", status: "cancelled" });
    await milestone({ dueDate: "2026-10-31" });

    const c = (await start(v, "2026-Q3")).body as ScorecardDetail;
    expect(c).toMatchObject({ hasBoard: false, helpdesk: null, criteria: 5 });
    expect(c.lines.every((l) => l.suggestion === null)).toBe(true);
    expect(c.facts).toEqual({
      budgets: {
        sows: 2,
        within: 1,
        over: 1,
        items: [
          { agreementId: over, title: "Over budget", usedPct: 120, over: true },
          { agreementId: within, title: "Within budget", usedPct: 40, over: false },
        ],
      },
      milestones: { due: 3, onTime: 1, late: 1, overdue: 1, open: 0 },
      nda: "in_place",
      dpa: "missing",
    });
    await scoreAll(c, 3);
    expect((await t.as(MEMBER).post(`/api/scorecards/${c.id}/finalise`)).body).toMatchObject({ status: "final", overallTenths: 30 });
  });
});

describe("P-5 not scored", () => {
  it("has no scorecards, and the ones it had are out of sight until scoring is switched on again", async () => {
    const off = ids["Emberline Advisory"]!;
    const refused = await start(off, "2026-Q3");
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields.vendorId).toMatch(/Scoring is switched off/);

    const v = await newVendor("Was scored");
    const c = (await start(v, "2026-Q3")).body as ScorecardDetail;
    const vendor = (await t.as(MEMBER).get(`/api/vendors/${v}`)).body;
    const flip = (scoringEnabled: boolean) =>
      t
        .as(MEMBER)
        .patch(`/api/vendors/${v}`)
        .send({ name: vendor.name, type: vendor.type, ownerUserId: vendor.ownerUserId, ndaRequired: false, dpaRequired: false, scoringEnabled });
    expect((await flip(false)).status).toBe(200);
    expect(((await t.as(MEMBER).get("/api/scorecards").query({ vendorId: v })).body as { total: number }).total).toBe(0);
    expect((await t.as(MEMBER).get(`/api/scorecards/${c.id}`)).status).toBe(404);
    expect((await save(c.id, { lines: [] })).status).toBe(404);
    expect((await t.as(MEMBER).get(`/api/scorecards/${c.id}/pdf`)).status).toBe(404);
    await flip(true);
    expect((await t.as(MEMBER).get(`/api/scorecards/${c.id}`)).status).toBe(200);
  });
});

describe("P-6 vendor PDF", () => {
  const textOf = async (data: Buffer) => {
    const { extractText } = await import("unpdf");
    return (await extractText(new Uint8Array(data), { mergePages: true })).text.replace(/\s+/g, " ");
  };
  it("exports a final scorecard with scores, vendor comments and the figures, and without internal notes", async () => {
    const mossgate = ((await t.as(MEMBER).get("/api/scorecards").query({ vendorId: ids["Mossgate IT"] })).body.items as Scorecard[])[0]!;
    const c = await card(mossgate.id);
    expect(c.lines.some((l) => l.internalNote)).toBe(true);
    const res = await t.as(MEMBER).get(`/api/scorecards/${mossgate.id}/pdf`).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="Mossgate IT scorecard 2026-Q3.pdf"');
    const data = res.body as Buffer;
    expect(data.subarray(0, 5).toString()).toBe("%PDF-");
    const text = await textOf(data);
    expect(text).toContain("Mossgate IT");
    expect(text).toContain("Q3 2026");
    expect(text).toContain(`${(c.overallTenths! / 10).toFixed(1)} out of 5`);
    expect(text).toContain("Mira Okafor");
    expect(text).toContain("21 Nov 2026");
    for (const l of c.lines) {
      expect(text).toContain(l.name);
      if (l.vendorComment) expect(text.replace(/ /g, "")).toContain(l.vendorComment.replace(/ /g, ""));
      if (l.internalNote) expect(text.replace(/ /g, "")).not.toContain(l.internalNote.replace(/ /g, ""));
    }
    expect(text).toContain("First response");
    expect(text).toContain("July 2026");
    expect(text).not.toMatch(/internal|\bAI\b|budget|suggest/i);
  });

  it("does not print a reviewer who is known only by an email address", async () => {
    const v = await newVendor("No name");
    const who = `nameless-${n()}@example.test`;
    const c = (await start(v, "2026-Q3", who)).body as ScorecardDetail;
    expect(c.reviewerName).toBe(who);
    await scoreAll(c, 3);
    await t.as(MEMBER).post(`/api/scorecards/${c.id}/finalise`);
    const text = await textOf((await t.as(MEMBER).get(`/api/scorecards/${c.id}/pdf`).buffer(true).parse(binary)).body as Buffer);
    expect(text).not.toContain("@");
    expect(text).not.toContain("Reviewed by");
    expect(text).toContain("Finalised");
  });

  it("is refused for a draft, and survives text the PDF's letters do not cover", async () => {
    const v = await newVendor("PDF Ünïcode");
    const c = (await start(v, "2026-Q3")).body as ScorecardDetail;
    const draft = await t.as(MEMBER).get(`/api/scorecards/${c.id}/pdf`);
    expect(draft.status).toBe(409);
    expect(draft.body.error.message).toMatch(/Only a final scorecard/);
    await save(c.id, {
      summary: "Naïve café “quotes” — fine. 你好 🙂",
      lines: c.lines.map((l) => ({ criterionId: l.criterionId, score: 2, vendorComment: "x".repeat(1900), internalNote: "TOPSECRET-NOTE" })),
    });
    await t.as(MEMBER).post(`/api/scorecards/${c.id}/finalise`);
    const res = await t.as(MEMBER).get(`/api/scorecards/${c.id}/pdf`).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    const text = await textOf(res.body as Buffer);
    expect(text).toContain("Naïve café");
    expect(text).not.toContain("TOPSECRET");
    // Long comments run on to further pages, each numbered.
    expect(text).toMatch(/Page 2 of \d/);
  });
});

describe("P-7 a final scorecard is frozen", () => {
  it("keeps its figures, targets and facts when targets, invoices and milestones change afterwards", async () => {
    const other = await testApp();
    try {
      const member = other.as(MEMBER);
      const cards = (await member.get("/api/scorecards").query({ status: "final" })).body.items as Scorecard[];
      const moss = cards.find((c) => c.vendorName === "Mossgate IT")!;
      const quillon = cards.find((c) => c.vendorName === "Quillon Consulting")!;
      const get = async (id: string) => (await member.get(`/api/scorecards/${id}`)).body as ScorecardDetail;
      const [mossBefore, quillonBefore] = [await get(moss.id), await get(quillon.id)];
      expect(mossBefore.helpdesk![0]!.cells.first_response.targetTenths).toBe(950);
      expect(quillonBefore.facts.budgets.sows).toBeGreaterThan(0);

      expect((await member.put(`/api/performance/vendors/${moss.vendorId}/targets`).send({ first_response: 500, csat: null })).status).toBe(200);
      const sow = quillonBefore.facts.budgets.items[0]!.agreementId;
      expect((await member.post("/api/invoices").send({ agreementId: sow, invoiceNumber: "FROZEN-1", invoiceDate: "2026-08-01", amountMinor: 9_000_000_00 })).status).toBe(201);
      expect((await member.post(`/api/agreements/${sow}/milestones`).send({ title: "Late addition", dueDate: "2026-08-15" })).status).toBe(201);
      await member
        .patch(`/api/vendors/${quillon.vendorId}`)
        .send({ name: "Quillon Renamed", type: "consultancy", ownerUserId: (await member.get("/api/me")).body.id, ndaRequired: false, dpaRequired: false });

      expect(await get(moss.id)).toEqual(mossBefore);
      const quillonAfter = await get(quillon.id);
      expect(quillonAfter.facts).toEqual(quillonBefore.facts);
      expect(quillonAfter.vendorName).toBe("Quillon Consulting");
      expect(((await member.get("/api/scorecards").query({ vendorId: quillon.vendorId })).body.items as Scorecard[])[0]!.vendorName).toBe("Quillon Consulting");
      // The live pages do show the change, so the test changed what it meant to.
      expect((await member.get(`/api/performance/vendors/${moss.vendorId}`).query({ month: "2026-07" })).body.targets.first_response).toBe(500);

      // The database itself refuses a final scorecard without its frozen copy.
      await expect(other.ports.database.db.execute(sql`update scorecards set snapshot = null where id = ${moss.id}`)).rejects.toThrow();
    } finally {
      await other.close();
    }
  });
});

describe("P-7 final scorecards do not change when criteria change", () => {
  it("keeps its criteria, weights and overall score; a draft follows the new set", async () => {
    const other = await testApp();
    try {
      const member = other.as(MEMBER);
      const admin = other.as(ADMIN);
      const myId = (await member.get("/api/me")).body.id;
      const mk = async (name: string) =>
        (await member.post("/api/vendors").send({ name, type: "software", ownerUserId: myId, ndaRequired: false, dpaRequired: false })).body.id as string;
      const finalCard = (await member.post("/api/scorecards").send({ vendorId: await mk("Frozen"), quarter: "2026-Q3" })).body as ScorecardDetail;
      const draftCard = (await member.post("/api/scorecards").send({ vendorId: await mk("Moving"), quarter: "2026-Q3" })).body as ScorecardDetail;
      const scores = [5, 5, 1, 1, 1];
      for (const c of [finalCard, draftCard])
        await member.put(`/api/scorecards/${c.id}`).send({ lines: c.lines.map((l, i) => ({ criterionId: l.criterionId, score: scores[i] })) });
      expect((await member.post(`/api/scorecards/${finalCard.id}/finalise`)).body.overallTenths).toBe(26);

      const all = (await admin.get("/api/scorecard-criteria")).body as Criterion[];
      // Quality now weighs four times as much, Compliance is switched off, and a new criterion appears.
      await admin.put(`/api/admin/scorecard-criteria/${all[0]!.id}`).send({ ...all[0], name: "Quality (renamed)", weight: 80 });
      await admin.put(`/api/admin/scorecard-criteria/${all[4]!.id}`).send({ ...all[4], active: false });
      await admin.post("/api/admin/scorecard-criteria").send({ name: "Innovation", weight: 20, source: "manual" });

      const frozen = (await member.get(`/api/scorecards/${finalCard.id}`)).body as ScorecardDetail;
      expect(frozen.lines.map((l) => [l.name, l.weight, l.score])).toEqual(finalCard.lines.map((l, i) => [l.name, 20, scores[i]]));
      expect(frozen).toMatchObject({ overallTenths: 26, scored: 5, criteria: 5 });
      const listed = ((await member.get("/api/scorecards").query({ vendorId: finalCard.vendorId })).body.items as Scorecard[])[0]!;
      expect(listed).toMatchObject({ overallTenths: 26, scored: 5, criteria: 5 });

      const moving = (await member.get(`/api/scorecards/${draftCard.id}`)).body as ScorecardDetail;
      expect(moving.lines.map((l) => [l.name, l.weight, l.score])).toEqual([
        ["Quality (renamed)", 80, 5],
        ["Timeliness", 20, 5],
        ["Responsiveness and communication", 20, 1],
        ["Value for money", 20, 1],
        ["Innovation", 20, null],
      ]);
      // (5*80 + 5*20 + 1*20 + 1*20) / 140 = 3.86
      expect(moving).toMatchObject({ overallTenths: 39, scored: 4, criteria: 5 });
      expect((await member.post(`/api/scorecards/${draftCard.id}/finalise`)).body.error.message).toMatch(/One criterion has no score yet: Innovation/);

      // Reopened, the frozen one follows today's criteria as well.
      const reopened = (await admin.post(`/api/scorecards/${finalCard.id}/reopen`)).body as ScorecardDetail;
      expect(reopened.lines.map((l) => l.name)).toContain("Innovation");
    } finally {
      await other.close();
    }
  });
});
