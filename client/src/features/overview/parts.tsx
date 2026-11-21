import clsx from "clsx";
import { motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { TextSuggestion, Trend } from "../../../../shared/overview";
import { suggestionStatusLabels } from "../../../../shared/scorecards";
import type { BudgetView } from "../../../../shared/sow";
import { formatDateTime } from "../../lib/format";
import { Button, ErrorState, Pill } from "../../platform/ui";
import { AiLabel } from "../scorecards/parts";

export const linkClass = "font-medium text-accent-ink underline-offset-2 hover:underline";

/** A section of a page: a heading, an optional link to the full view, then its content. */
export function Section({ title, more, children, className }: { title: string; more?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={clsx("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex items-baseline gap-3">
        <h2 className="min-w-0 flex-1 text-base font-semibold">{title}</h2>
        {more}
      </div>
      {children}
    </section>
  );
}

/** What a section says when it has nothing to list (X-2). */
export const Nothing = ({ children }: { children: ReactNode }) => <p className="rounded-2xl bg-sunk px-5 py-4 text-[13.5px] text-ink-2">{children}</p>;

/** A row that leads somewhere: it shifts a little on hover, like every list row in the app. */
export function RowLink({ to, children, label }: { to: string; children: ReactNode; label?: string }) {
  return (
    <Link to={to} aria-label={label} className="flex items-center gap-3.5 border-b border-line py-3.5 transition-[padding] duration-300 ease-out hover:pl-2.5">
      {children}
    </Link>
  );
}

/** How much of a budget is invoiced, as a thin meter with the figure in words next to it. */
export function BudgetMeter({ budget }: { budget: BudgetView }) {
  const pct = budget.budgetMinor && budget.budgetMinor > 0 ? Math.min(100, (budget.invoicedMinor / budget.budgetMinor) * 100) : 0;
  return (
    <span className="flex w-[190px] shrink-0 items-center gap-3">
      <span aria-hidden className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--line)]">
        <motion.span
          className={clsx("block h-full rounded-full", budget.state === "over" ? "bg-crit" : budget.state === "warn" ? "bg-warn" : "bg-accent")}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1], delay: 0.12 }}
        />
      </span>
      <span className="num w-[76px] text-right text-[13px] font-semibold">{budget.usedPct == null ? "–" : `${budget.usedPct}% used`}</span>
    </span>
  );
}
export const budgetPill = (budget: BudgetView) =>
  budget.state === "over" ? <Pill tone="bad">Over budget</Pill> : budget.state === "warn" ? <Pill tone="warn">Close to budget</Pill> : null;

const arrows: Record<Trend, string> = { up: "↑", down: "↓", same: "→", first: "" };
/** A score's direction against the scorecard before it, in words with a small arrow. */
export function TrendWords({ trend, before }: { trend: Trend; before: string | null }) {
  const text = trend === "first" ? "First scorecard" : trend === "same" ? `Unchanged at ${before}` : `${trend === "up" ? "Up" : "Down"} from ${before}`;
  return (
    <span className={clsx("whitespace-nowrap text-[13px]", trend === "down" ? "font-semibold text-[var(--crit-text)]" : "text-ink-2")}>
      {arrows[trend] && <span aria-hidden>{arrows[trend]} </span>}
      {text}
    </span>
  );
}

/** A plain table of figures between hairlines. */
export function Figures({ label, head, rows, align = [] }: { label: string; head: string[]; rows: ReactNode[][]; align?: ("right" | undefined)[] }) {
  return (
    <table aria-label={label} className="w-full border-collapse text-left">
      <thead>
        <tr className="text-[12.5px] text-ink-3">
          {head.map((h, i) => (
            <th key={i} scope="col" className={clsx("py-2 pr-4 font-medium last:pr-0", align[i] === "right" && "text-right")}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-line align-top">
            {r.map((c, j) => (
              <td key={j} className={clsx("py-3 pr-4 last:pr-0", align[j] === "right" && "num text-right", j === 0 && "font-medium")}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A longer piece of AI writing next to the record it belongs to (design guide, "AI in the
 * interface"): on the brand tint, labelled, saying when it was written and what a person
 * did with it (AI-1). Without a suggestion it offers to ask the AI; when the AI cannot
 * answer, the problem is shown in place and the rest of the page stays usable (AI-2).
 */
export function AiTextPanel({
  title,
  suggestion,
  from,
  intro,
  children,
  onAsk,
  asking,
  askProblem,
  onReview,
  reviewing,
  note,
  acceptLabel = "Use this text",
  canAsk = true,
}: {
  title: string;
  suggestion: TextSuggestion<unknown> | null;
  /** What the AI wrote it from, to finish "Written by the AI on … from". */
  from: string;
  /** What is offered while there is no suggestion. */
  intro: string;
  /** The AI's text. */
  children: ReactNode;
  onAsk: () => void;
  asking: boolean;
  askProblem: string | null;
  /** `at` is where the Accept button was, for the burst once the text has been taken over (the button is gone by then). */
  onReview: (action: "accept" | "reject", at: DOMRect | null) => void;
  reviewing: boolean;
  /** The line under the buttons that says what accepting does. */
  note: string;
  /** What the primary button says, when the AI's writing is more than a text (a whole draft). */
  acceptLabel?: string;
  /** False once the moment for asking has passed: the AI's writing stays readable, without buttons. */
  canAsk?: boolean;
}) {
  const acceptRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  // Accepting or rejecting removes the button that was pressed; the panel takes the focus, so the keyboard keeps its place.
  const status = suggestion?.status;
  const before = useRef(status);
  useEffect(() => {
    if (before.current === "proposed" && status && status !== "proposed" && !panelRef.current?.contains(document.activeElement)) panelRef.current?.focus();
    before.current = status;
  }, [status]);
  const s = suggestion;
  const taken = s?.status === "accepted" || s?.status === "edited";
  const ask = (label: string, primary?: boolean) => (
    <Button variant={primary ? "primary" : "plain"} onClick={() => !asking && onAsk()} aria-disabled={asking || undefined} className={asking ? "cursor-progress" : undefined}>
      {asking ? "Asking the AI" : label}
    </Button>
  );
  return (
    <section ref={panelRef} tabIndex={-1} aria-label={title} className="flex flex-col gap-3 rounded-2xl outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]">
      {!s ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl bg-sunk px-5 py-4">
          <p className="min-w-0 flex-1 text-ink-2">{intro}</p>
          {ask("Ask the AI", true)}
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-2xl bg-tint px-5 py-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <AiLabel>AI proposal</AiLabel>
            <p className="min-w-0 flex-1 text-[13px] text-ink-2">
              Written by the AI on {formatDateTime(s.createdAt)} from {from}.{" "}
              <span className="font-semibold text-ink">
                {suggestionStatusLabels[s.status]}
                {s.status !== "proposed" && s.reviewedBy && s.reviewedBy !== "system" ? ` by ${s.reviewedBy}${s.reviewedAt ? ` on ${formatDateTime(s.reviewedAt)}` : ""}` : ""}.
              </span>
            </p>
            <Pill tone={taken ? "ok" : "none"}>{suggestionStatusLabels[s.status]}</Pill>
          </div>
          <div className={clsx("flex flex-col gap-2", s.status === "rejected" && "text-ink-2")}>{children}</div>
          <div className="flex flex-wrap items-center gap-2.5">
            {!taken && canAsk && (
              <Button
                ref={acceptRef}
                variant="primary"
                onClick={() => !reviewing && onReview("accept", acceptRef.current?.getBoundingClientRect() ?? null)}
                aria-disabled={reviewing || undefined}
              >
                {acceptLabel}
              </Button>
            )}
            {s.status === "proposed" && canAsk && (
              <Button onClick={() => !reviewing && onReview("reject", null)} aria-disabled={reviewing || undefined}>
                Reject
              </Button>
            )}
            {!taken && canAsk && ask("Ask again")}
            <p className="min-w-0 flex-1 text-[13px] text-ink-2">{note}</p>
          </div>
        </div>
      )}
      {askProblem && <ErrorState message={askProblem} onRetry={onAsk} />}
    </section>
  );
}
