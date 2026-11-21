import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { formatMetric, formatTarget, metricInfo, monthName, monthShort, type MetricKey } from "../../../../shared/performance";
import {
  formatScore,
  paperworkWords,
  quarterName,
  sourceLabels,
  suggestionStatusLabels,
  quarterOver,
  unscored,
  type Facts,
  type QuarterMonth,
  type ScorecardDetail,
  type ScorecardLine,
  type ScorecardSave,
} from "../../../../shared/scorecards";
import { api, ApiError, messageOf } from "../../lib/api";
import { burst } from "../../lib/burst";
import { formatDate, formatDateTime } from "../../lib/format";
import { History } from "../../platform/History";
import { useMe, useToday } from "../../platform/session";
import { Button, ConfirmButton, ErrorState, Loading, PageHeader, Pill } from "../../platform/ui";
import { NotFoundPage } from "../placeholders";
import { AiLabel, linkClass, ScoreSelector } from "./parts";

type LineChange = Partial<ScorecardSave["lines"][number]> & { criterionId: string };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the app already knows that helps score by hand (P-2, P-4): budgets kept, milestones on time, paperwork. */
function FactTiles({ facts, vendorId }: { facts: Facts; vendorId: string }) {
  const { budgets: b, milestones: m } = facts;
  const delivered = m.onTime + m.late;
  const paper = (label: string, state: Facts["nda"]) => (
    <span className="flex items-center gap-1.5">
      {state !== "not_required" && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${state === "in_place" ? "bg-ok" : "bg-crit"}`} />}
      {label} {paperworkWords[state]}
    </span>
  );
  const tile = "flex min-w-0 flex-col gap-1.5 rounded-tile bg-sunk px-5 py-4";
  const head = "text-[12.5px] font-medium text-ink-2";
  return (
    <section aria-label="Facts for this quarter" className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Facts for this quarter</h2>
      <div className="grid grid-cols-3 gap-4">
        <div className={tile}>
          <h3 className={head}>Budgets kept, by the end of the quarter</h3>
          {b.sows === 0 ? (
            <p className="text-ink-2">No SOW with a budget ran in this quarter.</p>
          ) : (
            <>
              <p className="font-semibold">
                {b.within} of {plural(b.sows, "SOW")} within budget
              </p>
              <ul className="flex flex-col gap-0.5 text-[13px]">
                {b.items.map((i) => (
                  <li key={i.agreementId} className="truncate">
                    <Link to={`/agreements/${i.agreementId}`} className={linkClass}>
                      {i.title}
                    </Link>{" "}
                    <span className={i.over ? "num font-semibold text-[var(--crit-text)]" : "num text-ink-2"}>{i.usedPct == null ? "" : `${i.usedPct}% invoiced`}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className={tile}>
          <h3 className={head}>Milestones on time</h3>
          {m.due === 0 ? (
            <p className="text-ink-2">No milestone was due in this quarter.</p>
          ) : (
            <>
              <p className="font-semibold">{delivered === 0 ? `None of ${plural(m.due, "milestone")} delivered yet` : `${m.onTime} of ${delivered} delivered on time`}</p>
              <p className="num text-[13px] text-ink-2">
                {plural(m.due, "milestone")} due in the quarter: {m.onTime} on time, {m.late} late
                {m.overdue ? `, ${m.overdue} overdue and not delivered` : ""}
                {m.open ? `, ${m.open} not due yet` : ""}.
              </p>
            </>
          )}
        </div>
        <div className={tile}>
          <h3 className={head}>Paperwork</h3>
          <p className="flex flex-col gap-1 font-semibold">
            {paper("NDA", facts.nda)}
            {paper("Data processing agreement", facts.dpa)}
          </p>
          <Link to={`/vendors?open=${vendorId}`} className={`${linkClass} text-[13px]`}>
            Open the vendor
          </Link>
        </div>
      </div>
    </section>
  );
}

/** The helpdesk figures behind a measured criterion, month by month, and what the AI proposed each month. */
function Evidence({ line, helpdesk, vendorId }: { line: ScorecardLine; helpdesk: QuarterMonth[] | null; vendorId: string }) {
  return (
    <div className="flex flex-col gap-4 pt-1">
      {helpdesk && line.metrics.length > 0 && (
        <table aria-label={`Figures for ${line.name}`} className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="text-ink-3">
              <th scope="col" className="py-1.5 font-medium">
                Measure
              </th>
              {helpdesk.map((m) => (
                <th key={m.month} scope="col" className="py-1.5 text-right font-medium">
                  <Link to={`/performance/${vendorId}?month=${m.month}`} className={linkClass}>
                    {monthShort(m.month)}
                  </Link>
                  {m.complete ? "" : " so far"}
                </th>
              ))}
              <th scope="col" className="py-1.5 pl-6 font-medium">
                Target
              </th>
            </tr>
          </thead>
          <tbody>
            {line.metrics.map((k: MetricKey) => (
              <tr key={k} className="border-t border-line">
                <th scope="row" className="py-2 font-normal">
                  {metricInfo[k].label}
                </th>
                {helpdesk.map((m) => (
                  <td key={m.month} className="num py-2 text-right">
                    {m.cells[k].verdict === "missed" ? (
                      <span className="font-semibold text-[var(--crit-text)]">
                        {formatMetric(k, m.cells[k].valueTenths)}
                        <span className="sr-only"> (target missed)</span>
                      </span>
                    ) : (
                      formatMetric(k, m.cells[k].valueTenths)
                    )}
                  </td>
                ))}
                <td className="num py-2 pl-6 text-ink-2">{helpdesk[0]!.cells[k].targetTenths == null ? "No target" : formatTarget(k, helpdesk[0]!.cells[k].targetTenths!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {line.suggestion && (
        <ul aria-label={`Monthly proposals for ${line.name}`} className="flex flex-col gap-2 text-[13px]">
          {line.suggestion.months.map((m) => (
            <li key={m.month}>
              <Link to={`/performance/${vendorId}?month=${m.month}`} className={linkClass}>
                {monthName(m.month)}
              </Link>
              <span className="num font-semibold"> · {m.score}</span> <span className="text-ink-2">· {suggestionStatusLabels[m.status].toLowerCase()} ·</span> {m.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A text box that saves when it is left, and keeps what was typed when saving fails (X-3). */
function NoteBox({
  id,
  label,
  hint,
  value,
  readOnly,
  onSave,
  onUnsaved,
}: {
  id: string;
  label: string;
  hint: string;
  value: string | null;
  readOnly: boolean;
  onSave: (text: string) => Promise<boolean>;
  /** Tells the page that this box holds text the server does not have, or no longer does. */
  onUnsaved?: (id: string, unsaved: boolean) => void;
}) {
  const [text, setText] = useState(value ?? "");
  const [failed, setFailed] = useState(false);
  const saved = useRef(value ?? "");
  useEffect(() => {
    // Follow the server's value unless the person is ahead of it.
    if ((value ?? "") !== saved.current) {
      saved.current = value ?? "";
      setText(value ?? "");
    }
  }, [value]);
  if (readOnly)
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-[12.5px] font-medium text-ink-2">{label}</p>
        <p className={value ? "whitespace-pre-wrap" : "text-ink-2"}>{value || "None"}</p>
      </div>
    );
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[12.5px] font-medium text-ink-2">
        {label}
      </label>
      <textarea
        id={id}
        rows={2}
        maxLength={2000}
        value={text}
        aria-describedby={`${id}-hint`}
        aria-invalid={failed || undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={async () => {
          if (text.trim() === saved.current.trim()) return;
          const ok = await onSave(text);
          setFailed(!ok);
          onUnsaved?.(id, !ok);
          if (ok) saved.current = text;
        }}
        className={`min-w-0 rounded-2xl border bg-surface px-4 py-2.5 text-sm placeholder:text-ink-3 hover:border-ink-3 ${failed ? "border-crit" : "border-line-2"}`}
      />
      <p id={`${id}-hint`} className={`text-[12.5px] ${failed ? "font-medium text-[var(--crit-text)]" : "text-ink-3"}`}>
        {failed ? "This could not be saved. Your text is still here; click outside the box to try again." : hint}
      </p>
    </div>
  );
}

/** One criterion: what it is, the 1 to 5 selector, the AI's suggestion where there is one, and the two texts. */
function CriterionRow({
  card,
  line,
  share,
  readOnly,
  onChange,
  onUnsaved,
}: {
  card: ScorecardDetail;
  line: ScorecardLine;
  share: number;
  readOnly: boolean;
  onChange: (change: LineChange) => Promise<boolean>;
  onUnsaved: (id: string, unsaved: boolean) => void;
}) {
  const [evidence, setEvidence] = useState(false);
  const acceptRef = useRef<HTMLButtonElement>(null);
  const s = line.suggestion;
  // Only what changed is sent, so a score and a note saved at the same moment do not overwrite each other.
  const current = { criterionId: line.criterionId };
  // Once scored, the line says what the AI suggested at that moment, which a later change to a monthly proposal does not rewrite.
  const then = line.score == null ? (s?.score ?? null) : line.suggestedWhenScored;
  const waiting = s?.months.filter((m) => m.status === "proposed").length ?? 0;
  const hasEvidence = !!s || (!!card.helpdesk && line.metrics.length > 0);
  const evidenceId = `evidence-${line.criterionId}`;
  const toggle = hasEvidence && (
    <button type="button" aria-expanded={evidence} aria-controls={evidenceId} onClick={() => setEvidence(!evidence)} className={`${linkClass} text-[13px]`}>
      {evidence ? "Hide evidence" : "Show evidence"}
    </button>
  );
  return (
    <li aria-label={line.name} className="flex flex-col gap-3.5 border-b border-line py-[22px]">
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold">{line.name}</h3>
          {line.description && <p className="mt-1 max-w-[62ch] text-ink-2">{line.description}</p>}
          <p className="mt-1.5 text-[12.5px] text-ink-3">
            {line.source === "measured" && !card.hasBoard ? "No Jira board for this vendor, so scored by the reviewer" : sourceLabels[line.source]} · counts for {share}% of the
            overall score
          </p>
        </div>
        <ScoreSelector
          label={`Score for ${line.name}`}
          value={line.score}
          suggested={s?.score}
          onChange={readOnly ? undefined : (score) => void onChange({ ...current, score, acceptedSuggestion: false })}
        />
      </div>

      {s && line.score == null && !readOnly && (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-xl bg-tint px-4 py-3.5">
          <AiLabel>AI suggests {s.score}</AiLabel>
          <p className="min-w-[240px] flex-1">
            The average of {plural(s.months.length, "monthly proposal")}: {s.months.map((m) => `${monthShort(m.month)} ${m.score}`).join(", ")}.
            {waiting > 0 &&
              ` ${waiting === s.months.length ? (waiting === 1 ? "It has" : "None has") : `${waiting} of them ${waiting === 1 ? "has" : "have"}`} not been reviewed by anyone yet.`}
          </p>
          {toggle}
          <Button
            ref={acceptRef}
            variant="primary"
            className="h-8"
            onClick={async () => {
              if (await onChange({ ...current, score: s.score, acceptedSuggestion: true })) burst(acceptRef.current, 9);
            }}
          >
            Accept {s.score}
          </Button>
        </div>
      )}
      {(!s || line.score != null || readOnly) && (then != null || hasEvidence) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
          {then != null && (
            <>
              <AiLabel>AI suggested {then}</AiLabel>
              <span>
                {line.score == null
                  ? "Not scored."
                  : line.acceptedSuggestion
                    ? "Accepted as it was."
                    : line.score === then
                      ? "The reviewer chose the same score."
                      : `Not followed: the reviewer chose ${line.score}.`}
              </span>
            </>
          )}
          {toggle}
        </p>
      )}
      {hasEvidence && (
        <div id={evidenceId} hidden={!evidence}>
          {evidence && <Evidence line={line} helpdesk={card.helpdesk} vendorId={card.vendorId} />}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <NoteBox
          id={`comment-${line.criterionId}`}
          label={`Comment for the vendor on ${line.name}`}
          hint="Appears in the vendor's PDF."
          value={line.vendorComment}
          readOnly={readOnly}
          onSave={(vendorComment) => onChange({ ...current, vendorComment })}
          onUnsaved={onUnsaved}
        />
        <NoteBox
          id={`note-${line.criterionId}`}
          label={`Internal note on ${line.name}`}
          hint="For the team only. Never in the PDF."
          value={line.internalNote}
          readOnly={readOnly}
          onSave={(internalNote) => onChange({ ...current, internalNote })}
          onUnsaved={onUnsaved}
        />
      </div>
    </li>
  );
}

/** One vendor's scorecard for a quarter (P-2 to P-6): score, comment, finalise, export. */
export function ScorecardPage() {
  const { id = "" } = useParams();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const finaliseRef = useRef<HTMLButtonElement>(null);
  const key = ["scorecard", id];
  const q = useQuery({ queryKey: key, queryFn: () => api<ScorecardDetail>(`/scorecards/${id}`), retry: false });
  const took = async (c: ScorecardDetail) => {
    qc.setQueryData(key, c);
    await Promise.all([qc.invalidateQueries({ queryKey: ["history"] }), qc.invalidateQueries({ queryKey: ["scorecard", "list"] })]);
  };
  // Several saves can be on their way at once and their answers can arrive in any order. Only when the last one is in
  // is the page brought up to date, and then from a fresh read, so an older answer never puts older text back.
  const saving = useRef(0);
  const save = useMutation({
    mutationFn: async (body: { summary?: string; lines?: LineChange[] }) => {
      saving.current++;
      try {
        return await api<ScorecardDetail>(`/scorecards/${id}`, { method: "PUT", body });
      } finally {
        saving.current--;
      }
    },
    onSuccess: async (c) => {
      if (saving.current > 0) return;
      await took(c);
      void qc.invalidateQueries({ queryKey: key, exact: true });
    },
  });
  const act = useMutation({
    mutationFn: (what: "finalise" | "reopen") => api<ScorecardDetail>(`/scorecards/${id}/${what}`, { method: "POST" }),
    onSuccess: async (c, what) => {
      if (what === "finalise") burst(finaliseRef.current, 30);
      toast.success(what === "finalise" ? "Scorecard finalised" : "Scorecard reopened");
      await took(c);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const today = useToday();
  // Boxes whose text could not be saved. While there is one, the scorecard is not finalised over it.
  const [unsaved, setUnsaved] = useState<string[]>([]);
  const markUnsaved = (box: string, on: boolean) => setUnsaved((list) => (on ? [...new Set([...list, box])] : list.filter((b) => b !== box)));
  const remove = useMutation({
    mutationFn: () => api(`/scorecards/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Draft removed");
      await qc.invalidateQueries({ queryKey: ["scorecard", "list"] });
      navigate("/performance/scorecards");
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  if (q.isError && q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400)) return <NotFoundPage />;

  const c = q.data;
  const final = c?.status === "final";
  const left = c ? unscored(c.lines) : [];
  const running = !!c && !quarterOver(c.quarter, today);
  const weights = c?.lines.reduce((n, l) => n + l.weight, 0) ?? 0;
  /** Saves one change at once. On failure the page says so and nothing typed is lost. */
  const change = async (body: { summary?: string; lines?: LineChange[] }): Promise<boolean> => {
    try {
      await save.mutateAsync(body);
      return true;
    } catch (e) {
      toast.error(messageOf(e));
      return false;
    }
  };

  return (
    <>
      <PageHeader
        context={
          <>
            <Link to="/performance/scorecards" className="underline-offset-2 hover:underline">
              Scorecards
            </Link>
            {c ? ` · ${c.vendorName} · ${quarterName(c.quarter)} · ${formatDate(c.periodStart)} to ${formatDate(c.periodEnd)}` : ""}
          </>
        }
        title="Quarterly scorecard"
      >
        {c && (final ? <Pill tone="ok">Final</Pill> : <Pill>Draft</Pill>)}
        {c && !final && (
          <ConfirmButton label={`Remove draft: the scorecard for ${c.vendorName}`} onConfirm={() => remove.mutate()}>
            Remove draft
          </ConfirmButton>
        )}
        {c && final && me.role === "admin" && (
          <ConfirmButton label={`Reopen the scorecard for ${c.vendorName}`} confirm="Really reopen?" onConfirm={() => !act.isPending && act.mutate("reopen")}>
            Reopen
          </ConfirmButton>
        )}
        {c && final && (
          <a
            href={`/api/scorecards/${c.id}/pdf`}
            download
            className="inline-flex h-[38px] items-center rounded-full bg-primary px-[18px] text-[13.5px] font-semibold text-primary-on transition duration-200 hover:-translate-y-px hover:shadow-[0_6px_18px_rgba(0,119,200,.3)]"
          >
            Vendor PDF
          </a>
        )}
      </PageHeader>

      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <p className="text-ink-2">
            Reviewer {c!.reviewerName}.{" "}
            {final
              ? `Finalised ${c!.finalisedAt ? formatDateTime(c!.finalisedAt) : ""}${c!.finalisedBy ? ` by ${c!.finalisedBy}` : ""}. A final scorecard is read-only${me.role === "admin" ? "; Reopen makes it a draft again" : "; an admin can reopen it"}.`
              : c!.hasBoard
                ? "Criteria measured from Jira come with the AI's suggestion; nothing counts until you choose a score. Every change is saved at once."
                : "This vendor has no Jira board, so every criterion is scored by hand, with the facts below as support. Every change is saved at once."}
          </p>

          <FactTiles facts={c!.facts} vendorId={c!.vendorId} />

          <section aria-label="Criteria" className="flex flex-col">
            <h2 className="text-base font-semibold">Scores</h2>
            <ul className="flex flex-col">
              {c!.lines.map((line) => (
                <CriterionRow
                  key={line.criterionId}
                  card={c!}
                  line={line}
                  share={Math.round((line.weight * 100) / weights)}
                  readOnly={final}
                  onChange={(lineChange) => change({ lines: [lineChange] })}
                  onUnsaved={markUnsaved}
                />
              ))}
            </ul>
          </section>

          <div className="max-w-[720px]">
            <NoteBox
              id="scorecard-summary"
              label="Summary for the vendor"
              hint="Opens the vendor's PDF. Optional."
              value={c!.summary}
              readOnly={final}
              onSave={(summary) => change({ summary })}
              onUnsaved={markUnsaved}
            />
          </div>

          <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-tile border border-line bg-surface px-6 py-4 shadow-float">
            <div>
              <p className="text-[12.5px] font-medium text-ink-2">{final ? "Overall" : `Overall so far, ${c!.scored} of ${c!.lines.length} scored`}</p>
              <p aria-label={`Overall score ${formatScore(c!.overallTenths)}`} className="num text-[26px] font-semibold leading-tight tracking-[-0.02em]">
                {formatScore(c!.overallTenths)}
              </p>
            </div>
            <p role="status" className="min-w-[160px] flex-1 text-ink-2">
              {final
                ? "Internal notes stay out of the vendor PDF."
                : unsaved.length
                  ? "A text on this page could not be saved (marked in red). Click in that box and outside it again to save it before finalising."
                  : left.length
                    ? `${left.length} of ${c!.lines.length} still to score: ${left.join(", ")}.`
                    : running
                      ? `All ${c!.lines.length} scored. ${quarterName(c!.quarter)} runs until ${formatDate(c!.periodEnd)}; the scorecard can be finalised after that.`
                      : `All ${c!.lines.length} scored. Internal notes stay out of the vendor PDF.`}
            </p>
            {!final && (
              <Button
                ref={finaliseRef}
                variant="primary"
                disabled={left.length > 0 || running || unsaved.length > 0}
                aria-disabled={act.isPending || undefined}
                onClick={() => !act.isPending && act.mutate("finalise")}
              >
                Finalise scorecard
              </Button>
            )}
          </div>

          <div className="max-w-[720px]">
            <History entityType="scorecard" entityId={c!.id} />
          </div>
        </>
      )}
    </>
  );
}
