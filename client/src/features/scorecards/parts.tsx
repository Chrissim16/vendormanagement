import clsx from "clsx";
import { motion } from "motion/react";
import { useId } from "react";
import { NavLink } from "react-router-dom";
import { scoreValues } from "../../../../shared/scorecards";
import { bouncy } from "../../lib/motion";

/** The two views of Performance: the helpdesk figures and the scorecards. */
export function PerformanceTabs() {
  const cls = ({ isActive }: { isActive: boolean }) =>
    `-mb-px border-b-2 py-2.5 font-medium transition-colors ${isActive ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink"}`;
  return (
    <nav aria-label="Performance views" className="-mt-4 flex gap-6 border-b border-line">
      <NavLink to="/performance" end className={cls}>
        Helpdesk
      </NavLink>
      <NavLink to="/performance/scorecards" className={cls}>
        Scorecards
      </NavLink>
    </nav>
  );
}

/**
 * The 1 to 5 selector (design guide, "AI in the interface"): the chosen score is filled
 * and its thumb snaps over with a bounce. A score the AI suggests and nobody has accepted
 * yet is drawn as an outline only. Read-only when there is no `onChange`.
 */
export function ScoreSelector({
  label,
  value,
  suggested,
  onChange,
  busy,
}: {
  label: string;
  value: number | null;
  suggested?: number | null;
  onChange?: (score: number) => void;
  busy?: boolean;
}) {
  const id = useId();
  const ghost = value == null ? (suggested ?? null) : null;
  return (
    <div role="group" aria-label={label} className="relative inline-grid h-10 shrink-0 grid-cols-5 rounded-[11px] bg-sunk">
      {scoreValues.map((n) => {
        const chosen = value === n;
        const outlined = ghost === n;
        return (
          <button
            key={n}
            type="button"
            aria-pressed={chosen}
            aria-label={`${n}${outlined ? ", suggested by the AI" : ""}`}
            aria-disabled={!onChange || busy || undefined}
            onClick={() => onChange && !busy && !chosen && onChange(n)}
            className={clsx(
              "relative grid h-10 w-10 place-items-center font-semibold transition-colors",
              chosen ? "text-primary-on" : outlined ? "text-accent-ink" : "text-ink-2",
              onChange && !chosen && "hover:text-ink",
              !onChange && "cursor-default",
            )}
          >
            {chosen && <motion.span layoutId={`score-${id}`} transition={bouncy} className="absolute inset-[3px] rounded-[9px] bg-primary" />}
            {outlined && <span aria-hidden className="absolute inset-[3px] rounded-[9px] shadow-[inset_0_0_0_1.5px_var(--accent)]" />}
            <span className="num relative">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A score shown as a small square: filled once a person stands behind it, outlined while it is only the AI's. */
export function ScoreBadge({ score, confirmed, label }: { score: number; confirmed: boolean; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={clsx(
        "num grid h-9 w-9 shrink-0 place-items-center rounded-[9px] text-[15px] font-semibold",
        confirmed ? "bg-primary text-primary-on" : "text-accent-ink shadow-[inset_0_0_0_1.5px_var(--accent)]",
      )}
    >
      {score}
    </span>
  );
}

/** The label every piece of AI-written content carries (AI-1). */
export const AiLabel = ({ children = "AI suggests" }: { children?: React.ReactNode }) => (
  <span className="inline-flex h-[22px] items-center whitespace-nowrap rounded-full bg-surface px-[9px] text-[11px] font-semibold text-accent-ink shadow-[inset_0_0_0_1px_var(--line-2)]">
    {children}
  </span>
);

export const linkClass = "font-medium text-accent-ink underline-offset-2 hover:underline";
