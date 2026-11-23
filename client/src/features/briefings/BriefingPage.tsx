import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { agreementName, statusLabels } from "../../../../shared/agreements";
import { formatDay } from "../../../../shared/dates";
import { isMixed, moneyLine } from "../../../../shared/money";
import { metricTrendWords, pointsOf, type Briefing, type BriefingFacts } from "../../../../shared/overview";
import { formatMetric, formatTarget, metricInfo, metricKeys, monthName } from "../../../../shared/performance";
import { formatScore, paperworkWords, quarterName } from "../../../../shared/scorecards";
import { vendorStatusLabels, vendorTypeLabels } from "../../../../shared/vendors";
import { api, messageOf } from "../../lib/api";
import { burst } from "../../lib/burst";
import { formatDateTime } from "../../lib/format";
import { TextAreaField, useForm } from "../../platform/form";
import { History } from "../../platform/History";
import { ConvertedNote, shownMoney, wholeAmounts } from "../../platform/Money";
import { Button, ConfirmButton, ErrorState, Loading, PageHeader, Pill } from "../../platform/ui";
import { agreementTone } from "../agreements/display";
import { AiTextPanel, budgetPill, Figures, linkClass, Nothing, Section, TrendWords } from "../overview/parts";

const when = (daysLeft: number) =>
  daysLeft < 0 ? `${-daysLeft} ${daysLeft === -1 ? "day" : "days"} ago` : daysLeft === 0 ? "Today" : `In ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`;

/** The briefing's own summary and talking points: typed by hand or taken over from the AI, saved with their own button (X-3). */
function TextForm({ briefing: b, onSaved }: { briefing: Briefing; onSaved: (b: Briefing) => void }) {
  const form = useForm({ summary: b.summary ?? "", talkingPoints: b.talkingPoints ?? "" }, (v) => api<Briefing>(`/briefings/${b.id}`, { method: "PUT", body: v }), {
    onSaved: (next) => {
      toast.success("Briefing saved");
      onSaved(next);
    },
    check: (v) => ({
      summary: v.summary.trim().length > 2000 ? "The summary is at most 2,000 characters." : "",
      talkingPoints: v.talkingPoints.trim().length > 4000 ? "The talking points are at most 4,000 characters." : "",
    }),
  });
  // When the saved text changes underneath (the AI's text was taken over), show that text.
  const { patch } = form;
  useEffect(() => patch({ summary: b.summary ?? "", talkingPoints: b.talkingPoints ?? "" }), [b.summary, b.talkingPoints]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = form.values.summary.trim() !== (b.summary ?? "") || form.values.talkingPoints.trim() !== (b.talkingPoints ?? "");
  return (
    <form
      onSubmit={(e) => {
        // Nothing to save: the button is only dimmed, so it must not send an empty change either.
        if (!changed) return e.preventDefault();
        void form.submit(e);
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <TextAreaField
          form={form}
          name="summary"
          label="Summary"
          rows={7}
          value={form.values.summary}
          onChange={(e) => form.set("summary", e.target.value)}
          placeholder="How things stand with this vendor, in a few sentences."
        />
        <TextAreaField
          form={form}
          name="talkingPoints"
          label="Talking points, one per line"
          rows={7}
          value={form.values.talkingPoints}
          onChange={(e) => form.set("talkingPoints", e.target.value)}
          placeholder="What to raise in the meeting, most pressing first."
        />
      </div>
      {form.problem && <ErrorState message={form.problem} />}
      <div className="flex items-center gap-3">
        <Button type="submit" aria-disabled={form.busy || !changed || undefined} className={!changed ? "opacity-50" : undefined}>
          {form.busy ? "Saving" : "Save briefing"}
        </Button>
        <p className="text-[13px] text-ink-2">
          {changed ? "Not saved yet. The PDF prints the saved text." : b.hasText ? "Saved. This is what the PDF prints." : "Nothing written yet: the PDF holds the facts only."}
        </p>
      </div>
    </form>
  );
}

/** The facts of a briefing, as they stood on the day it was prepared. Every figure here is the app's own. */
function Facts({ f, vendorId }: { f: BriefingFacts; vendorId: string }) {
  const money = shownMoney;
  const mixed = isMixed(f.spend.total.amounts);
  const invoiced = Object.keys(f.spend.total.amounts).length ? money(f.spend.total.eurMinor, "EUR") : "Nothing";
  const tiles: [string, string, string][] = [
    [
      mixed ? "Invoiced, last 12 months · converted to euros" : "Invoiced, last 12 months",
      invoiced,
      `${mixed ? `${wholeAmounts(moneyLine(f.spend.total.amounts))} · ` : ""}${formatDay(f.spend.from)} to ${formatDay(f.spend.to)}`,
    ],
    [
      "Latest scorecard",
      f.score ? `${formatScore(f.score.overallTenths)} out of 5` : "None yet",
      f.score ? quarterName(f.score.quarter) : f.vendor.scoringEnabled ? "No scorecard has been finalised" : "This vendor is not scored",
    ],
    ["Paperwork", `NDA ${paperworkWords[f.vendor.nda]}`, `Data processing agreement ${paperworkWords[f.vendor.dpa]}`],
  ];
  return (
    <>
      <dl aria-label="Key facts" className="grid grid-cols-3 gap-4">
        {tiles.map(([label, value, note]) => (
          <div key={label} className="min-w-0 rounded-tile bg-sunk px-7 py-6">
            <dt className="text-[13.5px] font-medium text-ink-2">{label}</dt>
            <dd className="num mt-2 text-[26px] font-semibold leading-tight tracking-[-0.02em]">{value}</dd>
            <dd className="mt-1 text-[12.5px] text-ink-2">
              {label === "Latest scorecard" && f.score && f.score.previousTenths != null ? (
                <>
                  {note} · <TrendWords trend={f.score.trend} before={formatScore(f.score.previousTenths)} />
                </>
              ) : (
                note
              )}
            </dd>
            {label.startsWith("Invoiced") && mixed && (
              <dd>
                <ConvertedNote rates={f.spend.rates} className="mt-1" />
              </dd>
            )}
          </div>
        ))}
      </dl>

      <Section title="Warnings and risk flags">
        {f.flags.length === 0 ? (
          <Nothing>Nothing was raised for this vendor on {formatDay(f.asAt)}: no deadline, budget, paperwork or risk flag needed attention.</Nothing>
        ) : (
          <ul aria-label="Warnings and risk flags" className="flex flex-col">
            {f.flags.map((w, i) => (
              <li key={i} className="flex items-center gap-4 border-b border-line py-3.5">
                <span className="w-40 shrink-0">
                  <Pill tone={w.tone}>{w.label}</Pill>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{w.title}</span>
                  <span className="block text-[13px] text-ink-2">{w.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-14">
        <Section title="Agreements">
          {f.agreements.length === 0 ? (
            <Nothing>No agreement was running or being prepared. Agreements are added on the vendor's Agreements tab.</Nothing>
          ) : (
            <Figures
              label="Agreements"
              head={["Agreement", "Status", "Ends or renews", "Value"]}
              align={[undefined, undefined, undefined, "right"]}
              rows={f.agreements.map((a) => [
                <Link key="t" to={`/agreements/${a.id}`} className={linkClass}>
                  {agreementName(a.kind, a.title)}
                </Link>,
                <Pill key="s" tone={agreementTone(a.status)}>
                  {statusLabels[a.status]}
                </Pill>,
                a.endDate ? formatDay(a.endDate) : "–",
                a.valueMinor == null ? "–" : money(a.valueMinor, a.currency),
              ])}
            />
          )}
        </Section>
        <Section title="Upcoming dates">
          {f.dates.length === 0 ? (
            <Nothing>Nothing was dated in the six months after {formatDay(f.asAt)}.</Nothing>
          ) : (
            <Figures
              label="Upcoming dates"
              head={["Date", "", "What"]}
              rows={f.dates.map((d) => [
                <span key="d" className="num whitespace-nowrap">
                  {formatDay(d.date)}
                </span>,
                <span key="w" className={`whitespace-nowrap ${d.daysLeft < 0 ? "font-semibold text-[var(--crit-text)]" : "text-ink-2"}`}>
                  {when(d.daysLeft)}
                </span>,
                d.what,
              ])}
            />
          )}
        </Section>
      </div>

      <Section title="Spend against budget">
        {f.budgets.length === 0 ? (
          <Nothing>This vendor had no active SOW with a budget.</Nothing>
        ) : (
          <Figures
            label="Spend against budget"
            head={["SOW", "Budget", "Invoiced", "Remaining", "Used", ""]}
            align={[undefined, "right", "right", "right", "right"]}
            rows={f.budgets.map((s) => [
              <Link key="t" to={`/agreements/${s.agreementId}`} className={linkClass}>
                {s.title}
              </Link>,
              money(s.budget.budgetMinor ?? 0, s.currency),
              money(s.budget.invoicedMinor, s.currency),
              s.budget.remainingMinor == null ? "–" : money(s.budget.remainingMinor, s.currency),
              s.budget.usedPct == null ? "–" : `${s.budget.usedPct}%`,
              budgetPill(s.budget),
            ])}
          />
        )}
      </Section>

      <Section
        title="Helpdesk performance and trend"
        more={
          f.performance && (
            <Link to={`/performance/${vendorId}`} className={`text-[13.5px] ${linkClass}`}>
              Open performance
            </Link>
          )
        }
      >
        {!f.performance ? (
          <Nothing>
            {f.vendor.scoringEnabled ? "This vendor has no Jira board, so there are no helpdesk figures." : "This vendor is not scored, so no helpdesk figures are kept."}
          </Nothing>
        ) : (
          <>
            <Figures
              label="Helpdesk figures"
              head={["Measure", ...f.performance.months.map((m) => monthName(m.month)), "Target", "Latest month"]}
              align={[undefined, ...f.performance.months.map(() => "right" as const), "right"]}
              rows={metricKeys.map((k) => {
                const target = f.performance!.months.at(-1)?.cells[k].targetTenths;
                const trend = f.performance!.trends[k];
                return [
                  <span key="m">
                    {metricInfo[k].label}
                    <span className="block text-[12.5px] font-normal text-ink-2">{metricInfo[k].measures}</span>
                  </span>,
                  ...f.performance!.months.map((m) => (
                    <span key={m.month} className={m.cells[k].verdict === "missed" ? "font-semibold text-[var(--crit-text)]" : undefined}>
                      {formatMetric(k, m.cells[k].valueTenths)}
                    </span>
                  )),
                  target == null ? <span className="text-ink-3">No target</span> : formatTarget(k, target),
                  <span key="t" className={trend === "worse" ? "font-semibold text-[var(--crit-text)]" : "text-ink-2"}>
                    {trend === "none" ? "–" : metricTrendWords[trend].replace(/^./, (c) => c.toUpperCase())}
                  </span>,
                ];
              })}
            />
            <p className="text-[12.5px] text-ink-2">A figure in red missed its target.</p>
          </>
        )}
      </Section>

      <Section title="Missed targets">
        {f.missed.length === 0 ? (
          <Nothing>{f.performance ? "No target was missed in these months." : "There are no helpdesk targets to miss for this vendor."}</Nothing>
        ) : (
          <Figures
            label="Missed targets"
            head={["Month", "Measure", "Figure", "Target"]}
            align={[undefined, undefined, "right", "right"]}
            rows={f.missed.map((m) => [monthName(m.month), metricInfo[m.metric].label, formatMetric(m.metric, m.valueTenths), formatTarget(m.metric, m.targetTenths)])}
          />
        )}
      </Section>

      <div className="grid grid-cols-2 gap-14">
        <Section title="Open milestones">
          {f.milestones.length === 0 ? (
            <Nothing>No milestone was open on this vendor's SOWs.</Nothing>
          ) : (
            <Figures
              label="Open milestones"
              head={["Milestone", "Due", ""]}
              rows={f.milestones.map((m) => [
                <span key="t">
                  {m.title}
                  <Link to={`/agreements/${m.sowId}`} className={`block text-[12.5px] font-normal ${linkClass}`}>
                    {m.sowTitle}
                  </Link>
                </span>,
                <span key="d" className="num whitespace-nowrap">
                  {formatDay(m.dueDate)}
                </span>,
                m.daysLate > 0 ? <Pill tone="bad">{`${m.daysLate} ${m.daysLate === 1 ? "day" : "days"} late`}</Pill> : null,
              ])}
            />
          )}
        </Section>
        <Section title="Change requests waiting for a decision">
          {f.changeRequests.length === 0 ? (
            <Nothing>No change request was waiting for a decision.</Nothing>
          ) : (
            <Figures
              label="Change requests"
              head={["Change", "Asked for", "Budget", "New end date"]}
              align={[undefined, undefined, "right"]}
              rows={f.changeRequests.map((c) => [
                <span key="t">
                  {c.title}
                  <Link to={`/agreements/${c.sowId}`} className={`block text-[12.5px] font-normal ${linkClass}`}>
                    {c.sowTitle}
                  </Link>
                </span>,
                formatDay(c.requestedOn),
                c.budgetChangeMinor ? `${c.budgetChangeMinor > 0 ? "+" : "−"} ${money(Math.abs(c.budgetChangeMinor), c.currency)}` : "–",
                c.newEndDate ? formatDay(c.newEndDate) : "–",
              ])}
            />
          )}
        </Section>
      </div>
    </>
  );
}

/** A vendor briefing (B-1): the AI's suggested text, the text the team keeps, and the facts it was prepared from. */
export function BriefingPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  // Preparing a briefing leads here; when the AI could not write its part, the page says so in place (AI-2).
  const [aiProblem, setAiProblem] = useState<string | null>((location.state as { aiProblem?: string } | null)?.aiProblem ?? null);
  const key = ["briefing", id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Briefing>(`/briefings/${id}`) });
  const set = async (b: Briefing) => {
    qc.setQueryData(key, b);
    await Promise.all([qc.invalidateQueries({ queryKey: ["history"] }), qc.invalidateQueries({ queryKey: ["briefings"] })]);
  };
  const ask = useMutation({
    mutationFn: () => api<Briefing>(`/briefings/${id}/suggestion`, { method: "POST" }),
    onMutate: () => setAiProblem(null),
    onSuccess: set,
  });
  const review = useMutation({
    mutationFn: (v: { action: "accept" | "reject"; at: DOMRect | null }) =>
      api<Briefing>(`/briefings/${id}/suggestion/review`, { body: { action: v.action, suggestionId: q.data!.suggestion!.id } }),
    onSuccess: async (b, v) => {
      if (v.action === "accept") burst(v.at, 9);
      toast.success(v.action === "accept" ? "The AI's text is now the briefing's text" : "AI text rejected");
      await set(b);
    },
    onError: async (e) => {
      toast.error(messageOf(e));
      // Someone else may have asked the AI again: show what is there now.
      await q.refetch();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/briefings/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Briefing removed");
      await qc.invalidateQueries({ queryKey: ["briefings"] });
      navigate(`/vendors?open=${q.data!.vendorId}&tab=briefings`);
    },
    onError: (e) => toast.error(messageOf(e)),
  });

  if (q.isPending) return <Loading />;
  if (q.isError)
    return (
      <>
        <PageHeader title="Briefing not found" />
        <ErrorState message={messageOf(q.error)} />
      </>
    );
  const b = q.data;
  const f = b.facts;
  const taken = b.suggestion?.status === "accepted" || b.suggestion?.status === "edited";
  return (
    <>
      <PageHeader
        context={
          <>
            <Link to={`/vendors?open=${b.vendorId}&tab=briefings`} className={`underline ${linkClass}`}>
              {b.vendorName}
            </Link>{" "}
            · {vendorTypeLabels[f.vendor.type]} · {vendorStatusLabels[f.vendor.status]} · owned by {f.vendor.ownerName}
          </>
        }
        title={`Briefing, ${formatDay(b.asAt)}`}
      >
        <ConfirmButton label={`Remove this briefing`} onConfirm={() => remove.mutate()} disabled={remove.isPending}>
          Remove
        </ConfirmButton>
        <a
          href={`/api/briefings/${b.id}/pdf`}
          download
          className="inline-flex h-[38px] items-center rounded-full bg-primary px-[18px] text-[13.5px] font-semibold text-primary-on transition duration-200 hover:-translate-y-px hover:shadow-[0_6px_18px_rgba(0,119,200,.3)] active:scale-[.96]"
        >
          Download PDF
        </a>
      </PageHeader>
      <p className="-mt-6 text-[13.5px] text-ink-2">
        The facts are as the app held them on {formatDay(b.asAt)}; they do not change afterwards. Prepared {formatDateTime(b.createdAt)}
        {b.createdBy ? ` by ${b.createdBy}` : ""}. For a meeting on a later day, prepare a new briefing from the vendor.
      </p>

      <Section title="Summary and talking points">
        <AiTextPanel
          title="AI summary and talking points"
          suggestion={b.suggestion}
          from="the facts below"
          intro="The AI can write a summary and suggest talking points from the facts below. They become part of the briefing only when you choose to use them, and you can change them afterwards."
          onAsk={() => ask.mutate()}
          asking={ask.isPending}
          askProblem={ask.isError ? messageOf(ask.error) : aiProblem}
          onReview={(action, at) => review.mutate({ action, at })}
          reviewing={review.isPending}
          note={
            taken
              ? "Taken over into the briefing below, where it can still be changed."
              : "Nothing here is part of the briefing until you use it; the boxes below are what the PDF prints."
          }
        >
          <p className="max-w-[78ch]">{b.suggestion?.output.summary}</p>
          <h3 className="mt-1 font-semibold">Suggested talking points</h3>
          <ol aria-label="Suggested talking points" className="flex max-w-[78ch] list-decimal flex-col gap-1.5 pl-5">
            {b.suggestion?.output.talkingPoints.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
        </AiTextPanel>
        <TextForm briefing={b} onSaved={(next) => void set(next)} />
        {pointsOf(b.talkingPoints).length > 0 && (
          <p className="text-[13px] text-ink-2">
            {pointsOf(b.talkingPoints).length} {pointsOf(b.talkingPoints).length === 1 ? "talking point" : "talking points"} saved.
          </p>
        )}
      </Section>

      <Facts f={f} vendorId={b.vendorId} />

      <Section title="History">
        <History entityType="briefing" entityId={b.id} limit={5} />
      </Section>
    </>
  );
}
