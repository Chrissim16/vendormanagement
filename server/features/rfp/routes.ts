import { Router, type Response } from "express";
import { z } from "zod";
import { rfpStages } from "../../../shared/rfp";
import { currentUser, requireRole } from "../../platform/auth";
import { AppError } from "../../platform/errors";
import { dir, id, paging, text, upload } from "../../platform/http";
import * as candidates from "./candidates";
import * as evaluation from "./evaluation";
import { answerSheet, decisionRecordPdf, rfpWord } from "./files";
import * as review from "./review";
import * as template from "./template";
import { templateInForce } from "./template";
import { exampleTemplate } from "./word/example";
import * as service from "./service";

const listQuery = z.object({
  q: text.optional(),
  stage: z.enum([...rfpStages, "open"]).optional(),
  sort: z.enum(service.rfpSorts as [string, ...string[]]).default("target"),
  dir: dir.default("asc"),
  ...paging,
});

const types = {
  pdf: "application/pdf",
  dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Sends a file made by the app under a readable name: a plain one for old software, the full one, accents included, for everything else. */
function download(res: Response, name: string, ext: keyof typeof types, data: Buffer) {
  const plain =
    name
      .replace(/[^A-Za-z0-9 ._-]/g, "")
      .replace(/\s+/g, " ")
      .trim() || "rfp";
  // encodeURIComponent leaves ' ( ) * as they are, which a file name in this header may not contain.
  const full = encodeURIComponent(name.replace(/[\\/:*?"<>|]/g, " ")).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  res
    .set({
      "Content-Type": types[ext],
      "Content-Disposition": `attachment; filename="${plain}.${ext}"; filename*=UTF-8''${full}.${ext}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    })
    .send(data);
}

/** RFPs (Q-1 to Q-11). Every team member may do everything here; the history shows who did. */
export function rfpRoutes(ctx: service.RfpContext) {
  const r = Router();
  const body = (req: { body?: unknown }) => req.body ?? {};
  const get = (rfpId: string) => service.getRfp(ctx.db, rfpId, ctx.today());
  const file = (req: { file?: { originalname: string; buffer: Buffer } }, missing: string) => {
    if (!req.file) throw new AppError(400, "file_missing", missing);
    // Browsers send the name as Latin-1 bytes; read it back as the UTF-8 it was.
    return { name: Buffer.from(req.file.originalname, "latin1").toString("utf8"), data: req.file.buffer };
  };

  r.get("/rfps", async (req, res) => {
    const q = listQuery.parse(req.query);
    res.json(await service.listRfps(ctx.db, { ...q, sort: q.sort as service.RfpSort }));
  });
  r.post("/rfps", async (req, res) => res.status(201).json(await service.createRfp(ctx, body(req), currentUser(req))));
  r.get("/vendors/:id/rfps", async (req, res) => res.json(await service.rfpsOfVendor(ctx.db, id.parse(req.params.id))));
  r.get("/rfps/:id", async (req, res) => res.json(await get(id.parse(req.params.id))));
  r.patch("/rfps/:id", async (req, res) => res.json(await service.updateRfp(ctx, id.parse(req.params.id), body(req), currentUser(req))));
  r.put("/rfps/:id/content", async (req, res) => res.json(await service.saveContent(ctx, id.parse(req.params.id), body(req), currentUser(req))));
  r.post("/rfps/:id/template", async (req, res) => res.json(await service.startFromTemplate(ctx, id.parse(req.params.id), currentUser(req))));
  r.post("/rfps/:id/draft", async (req, res) => res.status(201).json(await service.suggestDraft(ctx, id.parse(req.params.id), currentUser(req))));
  r.post("/rfps/:id/draft/review", async (req, res) => res.json(await service.reviewDraft(ctx, id.parse(req.params.id), body(req), currentUser(req))));
  r.post("/rfps/:id/stage", async (req, res) => res.json(await service.moveStage(ctx, id.parse(req.params.id), body(req), currentUser(req))));
  r.post("/rfps/:id/cancel", async (req, res) => res.json(await evaluation.cancelRfp(ctx, id.parse(req.params.id), body(req), currentUser(req))));

  // Review (Q-3)
  r.post("/rfps/:id/signoffs", async (req, res) => res.status(201).json(await service.addSignoff(ctx, id.parse(req.params.id), body(req), currentUser(req))));
  r.patch("/rfp-signoffs/:id", async (req, res) => res.json(await service.changeSignoff(ctx, id.parse(req.params.id), body(req), currentUser(req))));
  r.delete("/rfp-signoffs/:id", async (req, res) => res.json(await service.changeSignoff(ctx, id.parse(req.params.id), { remove: true }, currentUser(req))));
  // Review rounds and the remarks read from returned Word files (Q-13)
  r.post("/rfps/:id/review-rounds", async (req, res) => {
    const made = await review.makeRound(ctx, id.parse(req.params.id), currentUser(req));
    res.status(made.made ? 201 : 200).json(made);
  });
  r.get("/rfp-review-rounds/:id/review-copy.docx", async (req, res) => {
    const f = await review.roundFile(ctx, id.parse(req.params.id));
    download(res, f.name, "docx", f.data);
  });
  r.post("/rfp-review-rounds/:id/files", upload.single("file"), async (req, res) =>
    res.status(201).json(await review.uploadReturned(ctx, id.parse(req.params.id), file(req, "Choose the Word file the reviewer sent back."), currentUser(req))),
  );
  r.get("/rfp-review-files/:id/file.docx", async (req, res) => {
    const f = await review.returnedFile(ctx, id.parse(req.params.id));
    download(res, f.name, "docx", f.data);
  });
  r.delete("/rfp-review-files/:id", async (req, res) => res.json(await review.removeReturned(ctx, id.parse(req.params.id), currentUser(req))));
  r.post("/rfp-remarks/:id", async (req, res) => res.json(await review.actOnRemark(ctx, id.parse(req.params.id), body(req), currentUser(req))));

  // The company's Word template (Q-14), admins only.
  r.get("/admin/word-template", requireRole("admin"), async (_req, res) => res.json(await template.templateInfo(ctx.db)));
  r.post("/admin/word-template", requireRole("admin"), upload.single("file"), async (req, res) =>
    res.status(201).json(await template.uploadTemplate(ctx, file(req, "Choose the template file."), currentUser(req))),
  );
  r.delete("/admin/word-template", requireRole("admin"), async (req, res) => res.json(await template.usePlainLayout(ctx.db, currentUser(req))));
  r.get("/admin/word-template/file", requireRole("admin"), async (_req, res) => {
    const f = await template.templateFile(ctx.db, ctx.storage);
    const ext = /\.dotx$/i.test(f.fileName) ? "dotx" : "docx";
    download(res, f.fileName.replace(/\.(dotx|docx)$/i, ""), ext, f.data);
  });
  r.get("/admin/word-template/example", requireRole("admin"), async (_req, res) => download(res, "Example RFP template (invented)", "dotx", await exampleTemplate()));

  // Candidates and issue (Q-4, Q-5)
  r.post("/rfps/:id/candidates", async (req, res) => res.status(201).json(await candidates.addCandidate(ctx, id.parse(req.params.id), body(req), currentUser(req))));
  r.patch("/rfp-candidates/:id", async (req, res) => res.json(await candidates.moveCandidate(ctx, id.parse(req.params.id), body(req), currentUser(req))));
  r.delete("/rfp-candidates/:id", async (req, res) => res.json(await candidates.removeCandidate(ctx, id.parse(req.params.id), currentUser(req))));
  r.post("/rfp-candidates/:id/issue", async (req, res) => res.json(await candidates.issueCandidate(ctx, id.parse(req.params.id), body(req), currentUser(req))));
  r.get("/rfp-candidates/:id/rfp.docx", async (req, res) => {
    const candidateId = id.parse(req.params.id);
    const rfp = await get(await candidates.rfpOfCandidate(ctx.db, candidateId));
    const candidate = candidates.exportable(rfp, candidateId);
    const doc = await rfpWord(rfp, { candidate, template: await templateInForce(ctx.db, ctx.storage), today: ctx.today(), version: null });
    download(res, `${rfp.title} RFP for ${candidate.vendorName}`, "docx", doc);
  });
  r.get("/rfp-candidates/:id/answer-sheet.xlsx", async (req, res) => {
    const candidateId = id.parse(req.params.id);
    const rfp = await get(await candidates.rfpOfCandidate(ctx.db, candidateId));
    const candidate = candidates.exportable(rfp, candidateId);
    download(res, `${rfp.title} answer sheet ${candidate.vendorName}`, "xlsx", await answerSheet(rfp, candidate));
  });

  // Responses (Q-6)
  r.post("/rfp-candidates/:id/response", upload.single("file"), async (req, res) =>
    res.status(201).json(await candidates.uploadResponse(ctx, id.parse(req.params.id), file(req, "Choose the filled answer sheet."), currentUser(req))),
  );
  r.put("/rfp-candidates/:id/answers/:questionId", async (req, res) =>
    res.json(await candidates.saveAnswer(ctx, id.parse(req.params.id), id.parse(req.params.questionId), body(req), currentUser(req))),
  );
  r.post("/rfp-candidates/:id/unmatched/discard", async (req, res) => res.json(await candidates.discardUnmatched(ctx, id.parse(req.params.id), body(req), currentUser(req))));
  r.post("/rfp-candidates/:id/documents", upload.single("file"), async (req, res) =>
    res.status(201).json(await candidates.addDocument(ctx, id.parse(req.params.id), file(req, "Choose a file to attach."), currentUser(req))),
  );
  r.delete("/rfp-documents/:id", async (req, res) => res.json(await candidates.removeDocument(ctx, id.parse(req.params.id), currentUser(req))));

  // Comparison, scores and the decision (Q-7 to Q-10)
  r.post("/rfps/:id/comparison", async (req, res) => res.status(201).json(await evaluation.compareAnswers(ctx, id.parse(req.params.id), currentUser(req))));
  r.put("/rfp-candidates/:id/scores/:criterionId", async (req, res) =>
    res.json(await evaluation.saveScore(ctx, id.parse(req.params.id), id.parse(req.params.criterionId), body(req), currentUser(req))),
  );
  r.delete("/rfp-candidates/:id/scores/:criterionId", async (req, res) =>
    res.json(await evaluation.saveScore(ctx, id.parse(req.params.id), id.parse(req.params.criterionId), null, currentUser(req))),
  );
  r.post("/rfps/:id/decision", async (req, res) => res.json(await evaluation.decide(ctx, id.parse(req.params.id), body(req), currentUser(req))));
  r.get("/rfps/:id/decision-record.pdf", async (req, res) => {
    const rfp = await get(id.parse(req.params.id));
    download(res, `${rfp.title} decision record`, "pdf", await decisionRecordPdf(rfp, ctx.today()));
  });
  return r;
}
