import { useRef, useState } from "react";
import { formatHundredths, inEvaluation, partLabels, parts, type Candidate, type RfpCriterion, type RfpDetail } from "../../../../shared/rfp";
import { api } from "../../lib/api";
import { burst } from "../../lib/burst";
import { useMe } from "../../platform/session";
import { Button, Segmented, TextInput } from "../../platform/ui";
import { Figures, Nothing, Section } from "../overview/parts";
import { AiLabel, ScoreSelector } from "../scorecards/parts";
import { useChoice, useRfpChange } from "./parts";

/** One criterion for one candidate: my score, the AI's proposal next to it, and what everyone gave. */
function CriterionRow({ rfp, candidate: c, criterion: k, canScore }: { rfp: RfpDetail; candidate: Candidate; criterion: RfpCriterion; canScore: boolean }) {
  const me = useMe();
  const acceptRef = useRef<HTMLButtonElement>(null);
  const all = rfp.scores.filter((s) => s.candidateId === c.id && s.criterionId === k.id);
  const mine = all.find((s) => s.evaluatorUserId === me.id);
  const proposal = rfp.comparison?.output.scores.find((s) => s.candidateId === c.id && s.criterionId === k.id);
  const average = rfp.results.find((r) => r.candidateId === c.id)?.criteria.find((x) => x.criterionId === k.id)?.averageHundredths;
  const [comment, setComment] = useState(mine?.comment ?? "");
  const [evidence, setEvidence] = useState(false);
  const path = `/rfp-candidates/${c.id}/scores/${k.id}`;
  const save = useRfpChange(
    rfp.id,
    (v: { score: number; comment?: string | null; accept?: DOMRect | null }) =>
      api<RfpDetail>(path, {
        method: "PUT",
        body: { score: v.score, comment: v.comment === undefined ? (mine?.comment ?? null) : v.comment, suggestionId: v.accept !== undefined ? rfp.comparison!.id : null },
      }),
    { after: (_r, v) => v.accept && burst(v.accept, 9) },
  );
  const clear = useRfpChange(rfp.id, () => api<RfpDetail>(path, { method: "DELETE" }), { after: () => setComment("") });
  const busy = save.isPending || clear.isPending;
  const then = mine ? mine.suggestedScore : (proposal?.score ?? null);
  const evidenceId = `evidence-${c.id}-${k.id}`;
  return (
    <li aria-label={k.name} className="flex flex-col gap-3 border-b border-line py-5">
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <h4 className="text-base font-semibold">{k.name}</h4>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Counts for {k.weight}% of {partLabels[k.part].toLowerCase()}
          </p>
        </div>
        <ScoreSelector
          label={`Your score for ${c.vendorName} on ${k.name}`}
          value={mine?.score ?? null}
          suggested={proposal?.score}
          busy={busy}
          onChange={canScore ? (score) => save.mutate({ score }) : undefined}
        />
      </div>
      {proposal && !mine && canScore && (
        <div className="flex flex-col gap-3 rounded-2xl bg-tint px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <AiLabel>AI suggests {proposal.score}</AiLabel>
            <p className="min-w-0 flex-1">{proposal.reason}</p>
            <Button
              ref={acceptRef}
              variant="primary"
              aria-disabled={busy || undefined}
              onClick={() => !busy && save.mutate({ score: proposal.score, accept: acceptRef.current?.getBoundingClientRect() ?? null })}
            >
              Accept {proposal.score}
            </Button>
          </div>
          <p className="text-[13px] text-ink-2">
            From the answer of {c.vendorName}: “{proposal.quote}”
          </p>
        </div>
      )}
      {(mine || !canScore || !proposal) && then != null && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
          <AiLabel>AI suggested {then}</AiLabel>
          <span>{!mine ? "Not scored by you." : mine.score === then ? "You gave the same score." : `Not followed: you chose ${mine.score}.`}</span>
          {proposal && (
            <button
              type="button"
              aria-expanded={evidence}
              aria-controls={evidenceId}
              onClick={() => setEvidence(!evidence)}
              className="font-medium text-accent-ink underline-offset-2 hover:underline"
            >
              {evidence ? "Hide evidence" : "Show evidence"}
            </button>
          )}
        </p>
      )}
      {evidence && proposal && (
        <p id={evidenceId} className="rounded-2xl bg-sunk px-5 py-3.5 text-[13.5px]">
          {proposal.reason}{" "}
          <span className="text-ink-2">
            From the answer of {c.vendorName}: “{proposal.quote}”
          </span>
        </p>
      )}
      {mine && canScore && (
        <div className="flex flex-wrap items-center gap-2.5">
          <TextInput
            aria-label={`Your comment for ${c.vendorName} on ${k.name}`}
            value={comment}
            maxLength={1000}
            placeholder="Why this score (optional, goes into the decision record)"
            onChange={(e) => setComment(e.target.value)}
            onBlur={() => comment.trim() !== (mine.comment ?? "") && save.mutate({ score: mine.score, comment: comment.trim() || null })}
            className="min-w-[280px] flex-1"
          />
          <Button onClick={() => !busy && clear.mutate()} aria-disabled={busy || undefined} aria-label={`Clear my score for ${c.vendorName} on ${k.name}`}>
            Clear my score
          </Button>
        </div>
      )}
      <p className="text-[13px] text-ink-2">
        {all.length === 0 ? (
          "Nobody has scored this yet."
        ) : (
          <>
            <span className="num font-semibold text-ink">Average {formatHundredths(average)}</span> ·{" "}
            {all.map((s) => `${s.evaluatorName} ${s.score}${s.comment ? ` (“${s.comment}”)` : ""}`).join(" · ")}
          </>
        )}
      </p>
    </li>
  );
}

/** Q-8: every team member scores each candidate per criterion; the app works out the averages, the two parts, the overall score and the ranking. */
export function ScoringTab({ rfp }: { rfp: RfpDetail }) {
  const me = useMe();
  const running = rfp.candidates.filter(inEvaluation);
  const [chosen, choose] = useChoice(running);
  const canScore = rfp.stage === "issued" || rfp.stage === "evaluating";
  if (!running.length)
    return <Nothing>Candidates are scored once the RFP has been issued to them. Each team member then gives every candidate a score from 1 to 5 on every criterion.</Nothing>;
  const name = (id: string) => rfp.candidates.find((c) => c.id === id)?.vendorName ?? "";
  const ranked = [...rfp.results].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || name(a.candidateId).localeCompare(name(b.candidateId)));
  const part = (p: { hundredths: number | null; scored: number; criteria: number }) =>
    p.criteria === 0 ? "–" : p.hundredths == null ? `${p.scored} of ${p.criteria} scored` : formatHundredths(p.hundredths);
  const cells = running.length * rfp.criteria.length;
  const mine = rfp.scores.filter((s) => s.evaluatorUserId === me.id && running.some((c) => c.id === s.candidateId)).length;
  return (
    <>
      <Section title="Ranking">
        <Figures
          label="Ranking"
          head={["Rank", "Candidate", `Written (${rfp.writtenWeight}%)`, `Demo and interview (${rfp.demoWeight}%)`, "Overall"]}
          align={[undefined, undefined, "right", "right", "right"]}
          rows={ranked.map((r) => [
            r.rank ?? "–",
            name(r.candidateId),
            part(r.written),
            part(r.demo),
            <span key="o" className="font-semibold">
              {formatHundredths(r.overallHundredths)}
            </span>,
          ])}
        />
        <p className="max-w-[86ch] text-[13px] text-ink-2">
          A candidate's score on a criterion is the average of everyone's scores for it. A part's score weighs its criteria; the overall score combines the two parts. A part shows
          a score once every one of its criteria has been scored by at least one person, and a candidate is ranked once it has an overall score. Equal scores share a place.
        </p>
      </Section>

      <Section title={canScore ? "Your scores" : "Scores"}>
        {canScore && (
          <p role="status" className="-mt-1 text-[13.5px] text-ink-2">
            You have given {mine} of {cells} scores. A score is saved the moment you choose it.
          </p>
        )}
        {running.length > 1 ? (
          <div>
            <Segmented label="Candidate to score" value={chosen!.id} onChange={choose} options={running.map((c) => ({ value: c.id, label: c.vendorName }))} />
          </div>
        ) : (
          <p className="font-semibold">{chosen!.vendorName}</p>
        )}
        {parts.map((p) => {
          const criteria = rfp.criteria.filter((k) => k.part === p);
          if (!criteria.length) return null;
          return (
            <div key={p} className="flex flex-col">
              <h3 className="mt-3 text-[13.5px] font-medium text-ink-2">
                {partLabels[p]} · {p === "written" ? rfp.writtenWeight : rfp.demoWeight}% of the overall score
              </h3>
              <ul aria-label={`${partLabels[p]} criteria for ${chosen!.vendorName}`} className="flex flex-col">
                {criteria.map((k) => (
                  <CriterionRow key={`${chosen!.id}-${k.id}`} rfp={rfp} candidate={chosen!} criterion={k} canScore={canScore} />
                ))}
              </ul>
            </div>
          );
        })}
      </Section>
    </>
  );
}
