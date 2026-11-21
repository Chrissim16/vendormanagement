import { useState } from "react";
import { suggestionStatusLabels } from "../../../../shared/scorecards";
import { inEvaluation, isOpen, type Candidate, type RfpDetail, type RfpQuestion, type SheetRow } from "../../../../shared/rfp";
import { api, messageOf } from "../../lib/api";
import { formatDate, formatDateTime } from "../../lib/format";
import { Button, ConfirmButton, ErrorState, Pill, Segmented, Select } from "../../platform/ui";
import { linkClass, Nothing, Section } from "../overview/parts";
import { AiLabel } from "../scorecards/parts";
import { FileButton, kb, textareaClass, useAdoptRfp, useChoice, useRfpChange } from "./parts";

interface UploadAnswer {
  rfp: RfpDetail;
  result: { matched: number; unmatched: number; unanswered: number };
}

/** One question with the candidate's answer in a box of its own, saved with its own button (X-3). */
function AnswerRow({ rfp, candidate, question, readOnly }: { rfp: RfpDetail; candidate: Candidate; question: RfpQuestion; readOnly: boolean }) {
  const saved = rfp.answers.find((a) => a.candidateId === candidate.id && a.questionId === question.id)?.text ?? "";
  const [text, setText] = useState(saved);
  const [was, setWas] = useState(saved);
  // An upload or a placed row changes the saved answer underneath: show it, unless something typed here would be lost.
  if (saved !== was) {
    if (text === was) setText(saved);
    setWas(saved);
  }
  const save = useRfpChange(rfp.id, () => api<RfpDetail>(`/rfp-candidates/${candidate.id}/answers/${question.id}`, { method: "PUT", body: { text } }), {
    quiet: true,
    done: `Answer to question ${question.number} saved`,
  });
  const changed = text.trim() !== saved;
  return (
    <li className="flex gap-4 border-b border-line py-3.5">
      <span className="num w-7 shrink-0 pt-0.5 font-semibold">{question.number}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p id={`q-${candidate.id}-${question.id}`}>
          {question.text} <span className="text-[13px] text-ink-2">· {rfp.criteria.find((c) => c.id === question.criterionId)?.name}</span>
        </p>
        {readOnly ? (
          <p className="whitespace-pre-line text-ink-2">{saved || "No answer."}</p>
        ) : (
          <>
            <textarea
              aria-labelledby={`q-${candidate.id}-${question.id}`}
              rows={Math.min(8, Math.max(2, Math.ceil(text.length / 120)))}
              value={text}
              maxLength={8000}
              placeholder="No answer yet. Type or paste it here."
              onChange={(e) => setText(e.target.value)}
              className={textareaClass}
            />
            {(changed || save.isError) && (
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => !save.isPending && save.mutate()} aria-disabled={save.isPending || undefined} aria-label={`Save answer to question ${question.number}`}>
                  {save.isPending ? "Saving" : "Save answer"}
                </Button>
                <p className="text-[13px] text-ink-2">{save.isError ? messageOf(save.error) : "Not saved yet."}</p>
              </div>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/** A row of the uploaded sheet that fitted no question: choose its question, or set it aside. */
function Unmatched({ rfp, candidate, row }: { rfp: RfpDetail; candidate: Candidate; row: SheetRow }) {
  const [questionId, setQuestionId] = useState("");
  const place = useRfpChange(
    rfp.id,
    () => api<RfpDetail>(`/rfp-candidates/${candidate.id}/answers/${questionId}`, { method: "PUT", body: { text: row.answer, fromUnmatchedRow: row.row } }),
    { done: "Answer placed under its question" },
  );
  const aside = useRfpChange(rfp.id, () => api<RfpDetail>(`/rfp-candidates/${candidate.id}/unmatched/${row.row}`, { method: "DELETE" }), { done: "Row set aside" });
  const answered = new Set(rfp.answers.filter((a) => a.candidateId === candidate.id).map((a) => a.questionId));
  return (
    <li className="flex flex-col gap-2.5 border-b border-line py-3.5">
      <p className="text-[13px] text-ink-2">
        Row {row.row} of the sheet{row.number ? ` · numbered ${row.number}` : " · no number"}
        {row.question ? ` · "${row.question}"` : ""}
      </p>
      <p className="whitespace-pre-line">{row.answer}</p>
      <div className="flex flex-wrap items-center gap-2.5">
        <Select aria-label={`Question for row ${row.row}`} value={questionId} onChange={(e) => setQuestionId(e.target.value)} className="w-[420px] max-w-full">
          <option value="">Choose the question this answers</option>
          {rfp.questions.map((q) => (
            <option key={q.id} value={q.id}>
              {q.number}. {q.text.length > 70 ? `${q.text.slice(0, 70)}…` : q.text}
              {answered.has(q.id) ? " (replaces the answer there)" : ""}
            </option>
          ))}
        </Select>
        <Button disabled={!questionId} onClick={() => !place.isPending && place.mutate()} aria-label={`Use as its answer: row ${row.row}`}>
          Use as its answer
        </Button>
        <ConfirmButton label={`Set aside row ${row.row}`} confirm="Really set aside?" onConfirm={() => aside.mutate()} disabled={aside.isPending}>
          Set aside
        </ConfirmButton>
      </div>
    </li>
  );
}

function CandidateResponse({ rfp, candidate: c }: { rfp: RfpDetail; candidate: Candidate }) {
  const adopt = useAdoptRfp(rfp.id);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<UploadAnswer["result"] | null>(null);
  const [busy, setBusy] = useState<"sheet" | "document" | null>(null);
  const open = isOpen(rfp.stage);
  const send = async (kind: "sheet" | "document", file: File) => {
    setBusy(kind);
    setProblem(null);
    setResult(null);
    try {
      if (kind === "sheet") {
        const up = await api<UploadAnswer>(`/rfp-candidates/${c.id}/response`, { file });
        setResult(up.result);
        adopt(up.rfp, `Answer sheet of ${c.vendorName} read`);
      } else adopt(await api<RfpDetail>(`/rfp-candidates/${c.id}/documents`, { file }), `Attached ${file.name}`);
    } catch (e) {
      setProblem(messageOf(e));
    } finally {
      setBusy(null);
    }
  };
  const removeDoc = useRfpChange(rfp.id, (id: string) => api<RfpDetail>(`/rfp-documents/${id}`, { method: "DELETE" }), { done: "Document removed" });
  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <p className="min-w-0 flex-1 text-ink-2">
          <span className="font-semibold text-ink">
            {c.answered} of {rfp.questions.length} questions answered.
          </span>{" "}
          {c.responseReceivedOn ? `Response received on ${formatDate(c.responseReceivedOn)}.` : `Issued on ${formatDate(c.issuedOn!)}; no response yet.`}
        </p>
        {open && (
          <>
            <FileButton
              label={c.answered ? "Upload the answer sheet again" : "Upload answer sheet"}
              busyLabel="Reading the sheet"
              chooserLabel={`Choose the answer sheet of ${c.vendorName}`}
              accept={["xlsx"]}
              busy={busy === "sheet"}
              primary={!c.answered}
              onFile={(f) => void send("sheet", f)}
              onProblem={setProblem}
            />
            <FileButton
              label="Attach document"
              chooserLabel={`Choose a document of ${c.vendorName} to attach`}
              accept={["pdf", "doc", "docx", "xls", "xlsx"]}
              busy={busy === "document"}
              onFile={(f) => void send("document", f)}
              onProblem={setProblem}
            />
          </>
        )}
      </div>
      {problem && <ErrorState message={problem} />}
      {result && (
        <p role="status" className="rounded-2xl bg-sunk px-5 py-4">
          <span className="font-semibold">
            {result.matched} {result.matched === 1 ? "answer was" : "answers were"} matched to {result.matched === 1 ? "its question" : "their questions"}.
          </span>{" "}
          {result.unmatched
            ? `${result.unmatched} ${result.unmatched === 1 ? "row" : "rows"} could not be matched and ${result.unmatched === 1 ? "is" : "are"} listed below to place by hand. `
            : ""}
          {result.unanswered ? `${result.unanswered} ${result.unanswered === 1 ? "question has" : "questions have"} no answer yet.` : "Every question has an answer."}
        </p>
      )}

      {c.unmatched.length > 0 && (
        <Section title={`Could not be matched (${c.unmatched.length})`}>
          <p className="-mt-1 max-w-[78ch] text-[13.5px] text-ink-2">
            These rows of the answer sheet carry an answer but no number or wording the app recognises. Choose the question each one answers, or set it aside.
          </p>
          <ul aria-label="Rows that could not be matched" className="flex flex-col">
            {c.unmatched.map((u) => (open ? <Unmatched key={u.row} rfp={rfp} candidate={c} row={u} /> : <li key={u.row}>{u.answer}</li>))}
          </ul>
        </Section>
      )}

      <Section title="Documents">
        {c.documents.length === 0 ? (
          <Nothing>No documents. The uploaded answer sheet is kept here, and anything else the candidate sent (PDF, Word or Excel up to 25 MB) can be attached.</Nothing>
        ) : (
          <ul aria-label={`Documents of ${c.vendorName}`} className="flex flex-col">
            {c.documents.map((d) => (
              <li key={d.id} className="flex items-center gap-3 border-b border-line py-3">
                <span className="min-w-0 flex-1">
                  <a href={`/api/documents/${d.id}/download`} download className={`underline ${linkClass}`}>
                    {d.fileName}
                  </a>
                  <span className="block text-[13px] text-ink-2">
                    <span className="num">{kb(d.sizeBytes)}</span> · added {formatDate(d.createdAt)}
                    {d.createdBy ? ` by ${d.createdBy}` : ""}
                  </span>
                </span>
                {open && <ConfirmButton label={`Remove ${d.fileName}`} onConfirm={() => removeDoc.mutate(d.id)} disabled={removeDoc.isPending} />}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Answers">
        <ol aria-label={`Answers of ${c.vendorName}`} className="flex flex-col">
          {rfp.questions.map((q) => (
            <AnswerRow key={q.id} rfp={rfp} candidate={c} question={q} readOnly={!open} />
          ))}
        </ol>
      </Section>
    </>
  );
}

/** Q-7: what the AI made of the answers. It sits apart from the answers themselves and gives no score. */
function Comparison({ rfp, running }: { rfp: RfpDetail; running: Candidate[] }) {
  const ask = useRfpChange(rfp.id, () => api<RfpDetail>(`/rfps/${rfp.id}/comparison`, { method: "POST" }), { quiet: true, done: "The AI compared the answers" });
  const s = rfp.comparison;
  const open = rfp.stage === "issued" || rfp.stage === "evaluating";
  const hasAnswers = running.some((c) => c.answered > 0);
  const name = (id: string) => rfp.candidates.find((c) => c.id === id)?.vendorName ?? "A candidate";
  const button = (label: string, primary?: boolean) => (
    <Button
      variant={primary ? "primary" : "plain"}
      onClick={() => !ask.isPending && ask.mutate()}
      aria-disabled={ask.isPending || undefined}
      className={ask.isPending ? "cursor-progress" : undefined}
    >
      {ask.isPending ? "Asking the AI" : label}
    </Button>
  );
  return (
    <Section title="AI comparison of the answers">
      {!s ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl bg-sunk px-5 py-4">
          <p className="min-w-0 flex-1 text-ink-2">
            {hasAnswers
              ? "The AI can summarise each candidate's answer per question, say where they differ, and propose a score per candidate and criterion with the passage it rests on. It gives no score itself: the proposals appear on the Scoring tab for each team member to take over or not."
              : "Once a candidate's answers are in, the AI can summarise and compare them per question and propose scores."}
          </p>
          {open && hasAnswers && button("Ask the AI to compare", true)}
        </div>
      ) : (
        <section aria-label="AI comparison" className="flex flex-col gap-4 rounded-2xl bg-tint px-5 py-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <AiLabel>AI proposal</AiLabel>
            <p className="min-w-0 flex-1 text-[13px] text-ink-2">
              Written by the AI on {formatDateTime(s.createdAt)} from the candidates' answers.{" "}
              <span className="font-semibold text-ink">
                {s.status === "proposed"
                  ? "No proposed score has been taken over yet."
                  : s.status === "accepted"
                    ? "Proposed scores were taken over as they were."
                    : s.status === "edited"
                      ? "Some scores differ from what it proposed."
                      : "Replaced."}
              </span>
            </p>
            <Pill tone={s.status === "accepted" || s.status === "edited" ? "ok" : "none"}>{suggestionStatusLabels[s.status]}</Pill>
          </div>
          {rfp.comparisonOutdated && (
            <p role="status" className="flex items-center gap-3">
              <Pill tone="warn">Answers changed</Pill>
              <span>An answer was added or changed after this comparison was made. Ask again to bring it up to date.</span>
            </p>
          )}
          {rfp.criteria
            .filter((k) => k.part === "written")
            .map((k) => {
              const questions = rfp.questions.filter((q) => q.criterionId === k.id);
              if (!questions.length) return null;
              return (
                <details key={k.id} className="border-t border-line-2 pt-3">
                  <summary className="cursor-pointer font-semibold">
                    {k.name}{" "}
                    <span className="font-normal text-ink-2">
                      · {questions.length} {questions.length === 1 ? "question" : "questions"}
                    </span>
                  </summary>
                  <div className="mt-3 flex flex-col gap-4">
                    {questions.map((q) => {
                      const entry = s.output.questions.find((x) => x.questionId === q.id);
                      return (
                        <div key={q.id} className="flex flex-col gap-1.5">
                          <p className="font-medium">
                            <span className="num">{q.number}.</span> {q.text}
                          </p>
                          {entry ? (
                            <>
                              <ul className="flex flex-col gap-1">
                                {entry.summaries.map((x) => (
                                  <li key={x.candidateId}>
                                    <span className="font-semibold">{name(x.candidateId)}:</span> {x.summary}
                                  </li>
                                ))}
                              </ul>
                              <p className="text-ink-2">
                                <span className="font-semibold">Differences:</span> {entry.differences}
                              </p>
                            </>
                          ) : (
                            <p className="text-ink-2">Not compared.</p>
                          )}
                        </div>
                      );
                    })}
                    <div className="flex flex-col gap-1.5">
                      <p className="font-medium">Proposed scores on {k.name}</p>
                      {s.output.scores.filter((x) => x.criterionId === k.id).length === 0 && <p className="text-ink-2">None: nobody answered these questions.</p>}
                      <ul className="flex flex-col gap-1.5">
                        {s.output.scores
                          .filter((x) => x.criterionId === k.id)
                          .map((x) => (
                            <li key={x.candidateId}>
                              <span className="font-semibold">
                                {name(x.candidateId)}: <span className="num">{x.score}</span> out of 5.
                              </span>{" "}
                              {x.reason} <span className="text-ink-2">From the answer: “{x.quote}”</span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  </div>
                </details>
              );
            })}
          <div className="flex flex-wrap items-center gap-2.5">
            {open && button("Compare again")}
            <p className="min-w-0 flex-1 text-[13px] text-ink-2">
              Nothing here is a score. Each team member decides on the Scoring tab, where these proposals are shown next to the criterion.
            </p>
          </div>
        </section>
      )}
      {ask.isError && <ErrorState message={messageOf(ask.error)} onRetry={() => ask.mutate()} />}
    </Section>
  );
}

/** Q-6 and Q-7: each candidate's answers, with what could not be matched, and the AI's comparison of them. */
export function ResponsesTab({ rfp }: { rfp: RfpDetail }) {
  const running = rfp.candidates.filter(inEvaluation);
  const [chosen, choose] = useChoice(running);
  if (!running.length)
    return (
      <Nothing>
        {isOpen(rfp.stage)
          ? "No candidate has been issued the RFP yet. Once it has gone out, each candidate's filled answer sheet is uploaded here and its answers are matched to the questions."
          : "The RFP was never issued to a candidate, so there are no responses."}
      </Nothing>
    );
  return (
    <>
      <Comparison rfp={rfp} running={running} />
      <Section title="Responses per candidate">
        {running.length > 1 && (
          <div>
            <Segmented label="Candidate" value={chosen!.id} onChange={choose} options={running.map((c) => ({ value: c.id, label: `${c.vendorName} (${c.answered})` }))} />
          </div>
        )}
        {running.length === 1 && <p className="font-semibold">{chosen!.vendorName}</p>}
      </Section>
      <CandidateResponse key={chosen!.id} rfp={rfp} candidate={chosen!} />
    </>
  );
}
