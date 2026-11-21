import { useQuery } from "@tanstack/react-query";
import NumberFlow from "@number-flow/react";
import { motion } from "motion/react";
import { Link } from "react-router-dom";
import { formatMoney } from "../../../../shared/money";
import type { Dashboard } from "../../../../shared/overview";
import { monthName } from "../../../../shared/performance";
import { formatScore, quarterName } from "../../../../shared/scorecards";
import { isRiskFlag, warningTypeLabels, warningTypes } from "../../../../shared/vendors";
import { api, messageOf } from "../../lib/api";
import { useWarnings } from "../../lib/data";
import { hourNow, longDate } from "../../lib/format";
import { item, list } from "../../lib/motion";
import { ErrorState, Loading, PageHeader, Pill } from "../../platform/ui";
import { budgetPill, BudgetMeter, linkClass, Nothing, RowLink, Section, TrendWords } from "./parts";

const eur = (minor: number) => formatMoney(minor, "EUR");
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
/** A round number at or above the largest bar, for the top of the scale. */
function ceiling(minor: number): number {
  if (minor <= 0) return 100_00;
  const unit = 10 ** Math.floor(Math.log10(minor));
  return [1, 2, 5, 10].map((s) => s * unit).find((s) => s >= minor)!;
}
const short = (minor: number) => {
  const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  return minor >= 1_000_000_00 ? `€${n(minor / 1_000_000_00)}m` : minor >= 1_000_00 ? `€${n(minor / 1_000_00)}k` : `€${n(minor / 100)}`;
};

/** One of the three neutral tiles at the top: a count, what it counts, and where it leads. */
function Tile({ to, label, value, about }: { to: string; label: string; value: number | undefined; about: string }) {
  return (
    <Link
      to={to}
      className="group relative flex flex-col gap-2.5 rounded-tile bg-sunk px-[26px] pb-6 pt-[26px] transition duration-300 ease-[cubic-bezier(.34,1.5,.5,1)] hover:-translate-y-1 hover:bg-tint active:scale-[.97]"
    >
      <span className="text-[13.5px] font-medium text-ink-2">{label}</span>
      {/* The rolling digits are for the eye; the plain number next to them is what is read out. */}
      <span aria-hidden className="num text-[52px] font-semibold leading-none tracking-[-0.04em]">
        {value == null ? "–" : <NumberFlow value={value} />}
      </span>
      <span className="sr-only">{value ?? "loading"}</span>
      <span className="text-ink-2">{about}</span>
      <span
        aria-hidden
        className="absolute right-6 top-[26px] -translate-x-2 font-semibold text-accent-ink opacity-0 transition duration-300 group-hover:translate-x-0 group-hover:opacity-100"
      >
        Open →
      </span>
    </Link>
  );
}

/** Spend per month as bars, the latest month in the accent, with the same figures in a table underneath. */
function SpendBars({ spend }: { spend: Dashboard["spend"] }) {
  const top = ceiling(Math.max(...spend.byMonth.map((m) => m.eurMinor), 0));
  return (
    <>
      <div
        role="img"
        aria-label={`Spend per month, ${monthName(spend.byMonth[0]!.month)} to ${monthName(spend.byMonth.at(-1)!.month)}, ${eur(spend.total.eurMinor)} in all. The table below lists the same figures.`}
        className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3"
      >
        <div className="num flex h-[130px] flex-col justify-between text-right text-[11px] text-ink-2">
          <span>{short(top)}</span>
          <span>{short(top / 2)}</span>
          <span>0</span>
        </div>
        <div className="flex h-[130px] items-end gap-1.5 border-b border-line-2 bg-[linear-gradient(var(--line),var(--line)),linear-gradient(var(--line),var(--line))] bg-[length:100%_1px,100%_1px] bg-[position:0_0,0_50%] bg-no-repeat">
          {spend.byMonth.map((m, i) => (
            <motion.div
              key={m.month}
              title={`${monthName(m.month)}: ${eur(m.eurMinor)}`}
              className={`min-w-0 flex-1 origin-bottom rounded-t ${i === spend.byMonth.length - 1 ? "bg-accent" : "bg-[var(--bar)]"} transition-colors hover:bg-accent`}
              style={{ height: `${(m.eurMinor / top) * 100}%` }}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 20, delay: i * 0.028 }}
            />
          ))}
        </div>
        <span />
        <div className="flex gap-1.5 pt-2 text-[11px] text-ink-2">
          {spend.byMonth.map((m) => (
            <span key={m.month} className="min-w-0 flex-1 text-center">
              {MONTHS[Number(m.month.slice(5)) - 1]}
            </span>
          ))}
        </div>
      </div>
      <details className="text-[13px]">
        <summary className="cursor-pointer text-ink-2 hover:text-ink">
          {eur(spend.total.eurMinor)} in all{spend.total.GBP > 0 ? ", pounds converted to euros" : ""}. Show the months
        </summary>
        <table aria-label="Spend per month" className="mt-2 w-full border-collapse text-left">
          <thead>
            <tr className="text-[12.5px] text-ink-3">
              <th scope="col" className="py-1.5 font-medium">
                Month
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                Invoiced, in euros
              </th>
            </tr>
          </thead>
          <tbody>
            {[...spend.byMonth].reverse().map((m) => (
              <tr key={m.month} className="border-t border-line">
                <td className="py-1.5">{monthName(m.month)}</td>
                <td className="num py-1.5 text-right">{eur(m.eurMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

/** The landing page (D-1): what needs attention, budgets, spend, scores, scorecards due and open RFPs, each leading to its detail. */
export function DashboardPage() {
  const warnings = useWarnings();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/dashboard") });
  const hour = hourNow();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const all = warnings.data ?? [];
  const n = all.length;
  const headline = !warnings.data ? "" : n === 0 ? " Nothing needs a decision." : n === 1 ? " One thing could use a decision." : ` ${n} things could use a decision.`;
  const flags = all.filter(isRiskFlag).length;
  const d = q.data;
  const byType = warningTypes.map((t) => ({ type: t, items: all.filter((w) => w.type === t) })).filter((g) => g.items.length);
  return (
    <>
      <PageHeader context={longDate(new Date())} title={`${greeting}.${headline}`}>
        <Link
          to="/report"
          className="inline-flex h-[38px] items-center rounded-full border border-line-2 px-[18px] text-[13.5px] font-semibold transition hover:bg-sunk active:scale-[.96]"
        >
          Monthly report
        </Link>
      </PageHeader>
      <div className="grid grid-cols-3 gap-4">
        <Tile to="/warnings" label="Warnings" value={warnings.data ? n - flags : undefined} about="deadlines, budgets and paperwork that need a decision" />
        <Tile to="/warnings" label="Risk flags" value={warnings.data ? flags : undefined} about="not wrong yet, but heading that way" />
        <Tile
          to="/performance/scorecards"
          label="Scorecards due"
          value={d?.due.length}
          about={d ? `still to finalise for ${quarterName(d.dueQuarter)}` : "still to finalise for last quarter"}
        />
      </div>
      {q.isError ? (
        <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-14">
          <div className="flex min-w-0 flex-col gap-10">
            <Section
              title="Needs attention, by kind"
              more={
                <Link to="/warnings" className={`text-[13.5px] ${linkClass}`}>
                  See all
                </Link>
              }
            >
              {warnings.isPending ? (
                <Loading rows={3} />
              ) : warnings.isError ? (
                <ErrorState message={messageOf(warnings.error)} onRetry={() => void warnings.refetch()} />
              ) : byType.length === 0 ? (
                <Nothing>All clear. Notice deadlines, SOWs about to end, budgets, missing paperwork and risk flags are counted here as soon as there are any.</Nothing>
              ) : (
                <motion.ul variants={list} initial="initial" animate="animate" aria-label="Warnings and risk flags by kind" className="flex flex-col">
                  {byType.map(({ type, items }) => (
                    <motion.li key={type} variants={item}>
                      <RowLink to={`/warnings?type=${type}`}>
                        <span className="num w-9 shrink-0 text-[22px] font-semibold leading-none tracking-[-0.02em]">{items.length}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{warningTypeLabels[type]}</span>
                          <span className="block truncate text-[13px] text-ink-2">{[...new Set(items.map((w) => w.vendorName))].join(", ")}</span>
                        </span>
                        <Pill tone={items[0]!.tone}>{isRiskFlag(items[0]!) ? "Risk flag" : items[0]!.tone === "bad" ? "Past its limit" : "Needs attention"}</Pill>
                      </RowLink>
                    </motion.li>
                  ))}
                </motion.ul>
              )}
            </Section>

            <Section
              title="SOWs by budget used"
              more={
                <Link to="/agreements?kind=sow&status=active" className={`text-[13.5px] ${linkClass}`}>
                  All SOWs
                </Link>
              }
            >
              {!d ? (
                <Loading rows={3} />
              ) : d.sows.length === 0 ? (
                <Nothing>No active SOW has a budget yet. Once a SOW with a budget is active, it is listed here with how much of it has been invoiced.</Nothing>
              ) : (
                <motion.ul variants={list} initial="initial" animate="animate" aria-label="SOWs by budget used" className="flex flex-col">
                  {d.sows.map((s) => (
                    <motion.li key={s.agreementId} variants={item}>
                      <RowLink to={`/agreements/${s.agreementId}`}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">
                            {s.vendorName} · {s.title}
                          </span>
                          <span className="num block truncate text-[13px] text-ink-2">
                            {formatMoney(s.budget.invoicedMinor, s.currency)} of {formatMoney(s.budget.budgetMinor ?? 0, s.currency)} invoiced
                          </span>
                        </span>
                        {budgetPill(s.budget)}
                        <BudgetMeter budget={s.budget} />
                      </RowLink>
                    </motion.li>
                  ))}
                </motion.ul>
              )}
            </Section>
          </div>

          <div className="flex min-w-0 flex-col gap-10">
            <Section
              title="Spend, last 12 months"
              more={
                <Link to="/money" className={`text-[13.5px] ${linkClass}`}>
                  Open spend
                </Link>
              }
            >
              {!d ? (
                <Loading rows={2} />
              ) : d.spend.total.eurMinor === 0 ? (
                <Nothing>No invoices in the last twelve months. Spend is added up from the invoices keyed in under Money.</Nothing>
              ) : (
                <SpendBars spend={d.spend} />
              )}
            </Section>

            <Section
              title="Vendor scores"
              more={
                <Link to="/performance/scorecards" className={`text-[13.5px] ${linkClass}`}>
                  All scorecards
                </Link>
              }
            >
              {!d ? (
                <Loading rows={2} />
              ) : d.scores.length === 0 ? (
                <Nothing>No scorecard has been finalised yet. A vendor's latest final score appears here, with whether it went up or down.</Nothing>
              ) : (
                <ul aria-label="Vendor scores" className="flex flex-col">
                  {d.scores.map((s) => (
                    <li key={s.vendorId}>
                      <RowLink to={`/performance/scorecards/${s.scorecardId}`}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{s.vendorName}</span>
                          <span className="block text-[13px] text-ink-2">{quarterName(s.quarter)}</span>
                        </span>
                        <TrendWords trend={s.trend} before={s.previousTenths == null ? null : formatScore(s.previousTenths)} />
                        <span className="num w-10 text-right text-[18px] font-semibold">{formatScore(s.overallTenths)}</span>
                      </RowLink>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={d ? `Scorecards due for ${quarterName(d.dueQuarter)}` : "Scorecards due"}>
              {!d ? (
                <Loading rows={2} />
              ) : d.due.length === 0 ? (
                <Nothing>Every scored vendor has a final scorecard for {quarterName(d.dueQuarter)}.</Nothing>
              ) : (
                <ul aria-label="Scorecards due" className="flex flex-col">
                  {d.due.map((x) => (
                    <li key={x.vendorId}>
                      <RowLink to={x.scorecardId ? `/performance/scorecards/${x.scorecardId}` : `/performance/scorecards?start=${x.vendorId}`}>
                        <span className="min-w-0 flex-1 truncate font-semibold">{x.vendorName}</span>
                        <span className="text-[13px] text-ink-2">{x.scorecardId ? `Draft, ${x.scored} of ${x.criteria} scored` : "Not started"}</span>
                      </RowLink>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Open RFPs">
              {!d ? (
                <Loading rows={1} />
              ) : d.rfps.length === 0 ? (
                <Nothing>No RFP is open. A running RFP is listed here with its stage once the RFP part of the app is built.</Nothing>
              ) : (
                <ul aria-label="Open RFPs" className="flex flex-col">
                  {d.rfps.map((r) => (
                    <li key={r.id}>
                      <RowLink to="/rfps">
                        <span className="min-w-0 flex-1 truncate font-semibold">{r.title}</span>
                        <span className="text-[13px] text-ink-2">{r.stage}</span>
                      </RowLink>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      )}
    </>
  );
}
