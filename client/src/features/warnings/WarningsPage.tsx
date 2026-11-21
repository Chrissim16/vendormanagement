import { useSettings } from "../../platform/session";
import { motion } from "motion/react";
import { Link } from "react-router-dom";
import { isRiskFlag, warningTypeLabels, warningTypes, type Warning, type WarningType } from "../../../../shared/vendors";
import { messageOf } from "../../lib/api";
import { useWarnings } from "../../lib/data";
import { item, list } from "../../lib/motion";
import { useUrlState } from "../../lib/useUrlState";
import { EmptyState, ErrorState, Field, Loading, PageHeader, Pill, Select } from "../../platform/ui";

/** Where a warning leads: the agreement it is about, the vendor's helpdesk figures, or the vendor. */
export const warningLink = (w: Warning) =>
  w.agreementId ? `/agreements/${w.agreementId}` : w.type === "risk_metric_worsening" ? `/performance/${w.vendorId}` : `/vendors?open=${w.vendorId}`;

export function WarningRow({ w }: { w: Warning }) {
  return (
    <motion.li variants={item}>
      <Link to={warningLink(w)} className="flex items-center gap-4 border-b border-line py-4 transition-[padding] duration-300 ease-out hover:pl-2.5">
        <span className="w-40 shrink-0">
          <Pill tone={w.tone}>{w.label}</Pill>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{w.title}</span>
          <span className="block text-[13px] text-ink-2">{w.detail}</span>
        </span>
      </Link>
    </motion.li>
  );
}

const keyOf = (w: Warning, i: number) => `${w.type}-${w.agreementId ?? w.vendorId}-${i}`;

function Section({ title, about, items }: { title: string; about: string; items: Warning[] }) {
  if (!items.length) return null;
  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-[13px] text-ink-2">{about}</p>
      <motion.ul variants={list} initial="initial" animate="animate" aria-label={title} className="flex flex-col">
        {items.map((w, i) => (
          <WarningRow key={keyOf(w, i)} w={w} />
        ))}
      </motion.ul>
    </section>
  );
}

/** Everything that needs attention today: the warnings (A-7) and the risk flags (R-1). */
export function WarningsPage() {
  const q = useWarnings();
  const w = useSettings();
  const [url, setUrl] = useUrlState({ type: "" });
  const all = q.data ?? [];
  const present = warningTypes.filter((t) => all.some((x) => x.type === t));
  const type = present.includes(url.type as WarningType) ? (url.type as WarningType) : "";
  const shown = type ? all.filter((x) => x.type === type) : all;
  const n = all.length;
  return (
    <>
      <PageHeader
        context="Renewal deadlines, SOWs ending, budgets, missing paperwork and risk flags"
        title={q.data ? (n === 0 ? "Nothing needs attention" : `${n} ${n === 1 ? "thing needs" : "things need"} attention`) : "Warnings"}
      >
        {n > 0 && (
          <Field label="Show" htmlFor="warning-type">
            <Select id="warning-type" value={type} onChange={(e) => setUrl({ type: e.target.value })}>
              <option value="">Everything ({n})</option>
              {present.map((t) => (
                <option key={t} value={t}>
                  {warningTypeLabels[t]} ({all.filter((x) => x.type === t).length})
                </option>
              ))}
            </Select>
          </Field>
        )}
      </PageHeader>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />
      ) : n === 0 ? (
        <EmptyState title="All clear">
          A warning appears here when a subscription's notice deadline is within {w.noticeDays} days or has passed, when a SOW ends within {w.sowEndDays} days or has used{" "}
          {w.budgetWarningPct}% of its budget, and when an active vendor has no valid NDA or data processing agreement. A risk flag appears when a SOW is being invoiced faster than
          its budget allows, when a SOW is about to end with milestones still open, and when a helpdesk figure has got worse three months in a row.
        </EmptyState>
      ) : (
        <>
          <Section title="Warnings" about="A deadline, a budget or paperwork that needs a decision now." items={shown.filter((x) => !isRiskFlag(x))} />
          <Section
            title="Risk flags"
            about="Not wrong yet, but heading that way. Each flag says which figures set it off."
            items={shown.filter(isRiskFlag)}
          />
        </>
      )}
    </>
  );
}
