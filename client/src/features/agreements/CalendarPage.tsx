import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router-dom";
import { dateKindPlural, dateKinds, monthSpan, yearAhead, type CalendarEntry } from "../../../../shared/calendar";
import { addDays, formatDay, type Day } from "../../../../shared/dates";
import { addMonth, isMonth, monthName, monthOf } from "../../../../shared/performance";
import type { Page } from "../../../../shared/types";
import type { Vendor } from "../../../../shared/vendors";
import { api, messageOf, queryString } from "../../lib/api";
import { item, list as listMotion } from "../../lib/motion";
import { useUrlState } from "../../lib/useUrlState";
import { useSettings, useToday } from "../../platform/session";
import { EmptyState, ErrorState, Field, IconButton, Loading, PageHeader, Pill, Segmented, Select, type Tone } from "../../platform/ui";
import { AgreementTabs } from "./AgreementsPage";
import { downloadClass } from "../rfp/parts";

type View = "list" | "month";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const toneOf = (e: CalendarEntry): Tone => (e.kind === "renewal" ? "brand" : e.overdue ? "bad" : "warn");
const dotOf = (e: CalendarEntry) => (e.kind === "renewal" ? "bg-accent" : e.overdue ? "bg-crit" : "bg-warn");
const pillLabel = (e: CalendarEntry) => (e.kind === "notice" ? (e.overdue ? "Overdue" : "Notice") : "Renews");
const what = (e: CalendarEntry) => (e.kind === "notice" ? `Notice deadline${e.overdue ? ", passed" : ""}` : "Renewal date");
const count = (n: number) => `${n} ${n === 1 ? "date" : "dates"}`;

/** Monday of the week a day falls in. */
function mondayOf(d: Day): Day {
  const weekday = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(d, -weekday);
}

/** The weeks shown for a month: whole weeks from the Monday on or before the 1st to the Sunday on or after the last day. */
function weeksOf(month: string): Day[][] {
  const { from, to } = monthSpan(month);
  const weeks: Day[][] = [];
  for (let start = mondayOf(from); start <= to; start = addDays(start, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
  return weeks;
}

function MonthGrid({ month, entries, today }: { month: string; entries: CalendarEntry[]; today: Day }) {
  const byDay = new Map<Day, CalendarEntry[]>();
  for (const e of entries) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  return (
    <table aria-label={monthName(month)} className="w-full table-fixed border-collapse">
      <thead>
        <tr>
          {WEEKDAYS.map((d) => (
            <th key={d} scope="col" className="pb-2 text-left text-[12px] font-semibold tracking-[.04em] text-ink-2 uppercase">
              {d}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeksOf(month).map((week) => (
          <tr key={week[0]}>
            {week.map((d) => {
              const inMonth = monthOf(d) === month;
              const mine = byDay.get(d) ?? [];
              return (
                <td key={d} className={clsx("h-[104px] border border-line p-1.5 align-top", !inMonth && "bg-rail")}>
                  <span
                    className={clsx(
                      "num inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12.5px]",
                      d === today ? "bg-primary font-semibold text-primary-on" : inMonth ? "text-ink" : "text-ink-3",
                    )}
                  >
                    {/* Screen readers hear the whole date; the grid shows only the day of the month. */}
                    <span aria-hidden>{Number(d.slice(8))}</span>
                    <span className="sr-only">{formatDay(d)}</span>
                  </span>
                  {inMonth && mine.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-1">
                      {mine.map((e) => (
                        <li key={e.id}>
                          <Link
                            to={`/agreements/${e.agreementId}`}
                            title={`${what(e)}: ${e.vendorName} · ${e.title}`}
                            className="block rounded-md bg-sunk px-1.5 py-1 text-[12px] leading-tight underline-offset-2 hover:underline"
                          >
                            {/* The kind in words as well as by colour, then vendor and subscription (A-9). */}
                            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-2">
                              <span aria-hidden className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", dotOf(e))} />
                              <span>
                                {what(e)}
                                <span className="sr-only">: </span>
                              </span>
                            </span>
                            <span className="block truncate font-medium">{e.vendorName}</span>
                            <span className="sr-only"> · </span>
                            <span className="block truncate text-ink-2">{e.title}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Row({ e }: { e: CalendarEntry }) {
  return (
    <motion.li variants={item} className="flex items-center gap-4 border-b border-line py-3.5">
      <span className="num w-28 shrink-0 text-ink-2">{formatDay(e.date)}</span>
      <span className="w-24 shrink-0">
        <Pill tone={toneOf(e)}>{pillLabel(e)}</Pill>
      </span>
      <span className="min-w-0 flex-1">
        <Link to={`/agreements/${e.agreementId}`} className="block truncate font-semibold underline-offset-2 hover:underline">
          {e.vendorName} · {e.title}
        </Link>
        <span className="block truncate text-[13px] text-ink-2">
          {e.kind === "notice"
            ? `${e.overdue ? "The notice deadline passed" : "The last day to cancel or renegotiate"}. It renews on ${formatDay(e.renewsOn)}.`
            : "Renews on this day."}
        </span>
      </span>
    </motion.li>
  );
}

function YearList({ entries, today }: { entries: CalendarEntry[]; today: Day }) {
  const groups = new Map<string, CalendarEntry[]>();
  for (const e of entries) {
    const key = e.date < today ? "overdue" : monthOf(e.date);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return (
    <div className="flex flex-col gap-8">
      {[...groups].map(([key, es]) => (
        <section key={key} aria-labelledby={`cal-${key}`}>
          <h2 id={`cal-${key}`} className="text-base font-semibold">
            {key === "overdue" ? "Passed without a decision" : monthName(key)}
            <span className="ml-2 font-normal text-ink-2">{count(es.length)}</span>
          </h2>
          <motion.ul variants={listMotion} initial="initial" animate="animate" aria-label={key === "overdue" ? "Passed without a decision" : monthName(key)} className="mt-1 flex flex-col">
            {es.map((e) => (
              <Row key={e.id} e={e} />
            ))}
          </motion.ul>
        </section>
      ))}
    </div>
  );
}

/** Notice deadlines and renewal dates, as a month or the year ahead, with a calendar file to download (A-9). */
export function CalendarPage() {
  const today = useToday();
  const noticeDays = useSettings().noticeDays;
  const [url, setUrl] = useUrlState({ view: "list", month: "", vendorId: "", kind: "" });
  const view: View = url.view === "month" ? "month" : "list";
  const month = isMonth(url.month) ? url.month : monthOf(today);
  const span = view === "month" ? monthSpan(month) : yearAhead(today);
  const query = {
    ...span,
    // An unreadable vendor in a shared link is ignored, as an unknown kind is.
    vendorId: UUID.test(url.vendorId) ? url.vendorId : undefined,
    kind: dateKinds.includes(url.kind as never) ? url.kind : undefined,
    withOverdue: view === "list" ? "1" : undefined,
  };
  const q = useQuery({ queryKey: ["calendar", query], queryFn: () => api<CalendarEntry[]>("/calendar", { query }), placeholderData: (p) => p });
  const vendors = useQuery({ queryKey: ["vendors", "choices-all"], queryFn: () => api<Page<Vendor>>("/vendors", { query: { pageSize: 200, sort: "name", status: "all" } }) });
  const filtered = !!(url.vendorId || url.kind);
  const shown = q.data?.length;
  const passed = q.data?.filter((e) => e.date < today).length ?? 0;
  const context =
    shown === undefined
      ? " "
      : view === "month"
        ? `${count(shown)} in ${monthName(month)}`
        : `${count(shown - passed)} in the next twelve months${passed ? `, and ${passed} passed without a decision` : ""}`;

  return (
    <>
      <PageHeader context={context} title="Calendar">
        {/* A plain link, so the browser downloads the file the server builds from what is shown. */}
        {/* A calendar file must hold at least one date, so there is nothing to download when nothing is shown. */}
        {!!shown && (
          <a href={`/api/calendar.ics${queryString(query)}`} download className={downloadClass}>
            Download for Outlook
          </a>
        )}
      </PageHeader>
      <AgreementTabs />
      <div className="flex flex-wrap items-end gap-3">
        <Segmented<View>
          label="Show as"
          value={view}
          options={[
            { value: "list", label: "Next 12 months" },
            { value: "month", label: "Month" },
          ]}
          onChange={(v) => setUrl({ view: v })}
        />
        <Field label="Vendor" htmlFor="calendar-vendor">
          <Select id="calendar-vendor" value={url.vendorId} onChange={(e) => setUrl({ vendorId: e.target.value })} className="max-w-[220px]">
            <option value="">Any vendor</option>
            {vendors.data?.items.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kind of date" htmlFor="calendar-kind">
          <Select id="calendar-kind" value={url.kind} onChange={(e) => setUrl({ kind: e.target.value })}>
            <option value="">Both kinds</option>
            {dateKinds.map((k) => (
              <option key={k} value={k}>
                {dateKindPlural[k]}
              </option>
            ))}
          </Select>
        </Field>
        {view === "month" && (
          <div className="ml-auto flex items-center gap-2">
            <IconButton label="Previous month" onClick={() => setUrl({ month: addMonth(month, -1) })}>
              <ChevronLeft size={16} aria-hidden />
            </IconButton>
            <span className="min-w-[132px] text-center font-semibold" aria-live="polite">
              {monthName(month)}
            </span>
            <IconButton label="Next month" onClick={() => setUrl({ month: addMonth(month, 1) })}>
              <ChevronRight size={16} aria-hidden />
            </IconButton>
            {month !== monthOf(today) && (
              <button type="button" onClick={() => setUrl({ month: "" })} className="ml-1 text-[13.5px] font-semibold text-ink-2 underline-offset-2 hover:text-ink hover:underline">
                This month
              </button>
            )}
          </div>
        )}
      </div>
      <p className="text-[13px] text-ink-2">
        Active subscriptions&apos; notice deadlines, until a renewal decision is recorded, and their renewal dates. The download holds what is shown, with a reminder{" "}
        {noticeDays} days before each notice deadline, the notice warning window.
      </p>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />
      ) : view === "month" ? (
        <>
          {q.data.length === 0 && (
            <p className="rounded-2xl bg-sunk px-5 py-4 text-ink-2">
              No notice deadlines or renewal dates in {monthName(month)}
              {filtered ? " for these filters" : ""}. Page to another month, or see the next twelve months.
            </p>
          )}
          <MonthGrid month={month} entries={q.data} today={today} />
        </>
      ) : q.data.length === 0 ? (
        <EmptyState title={filtered ? "No dates match these filters" : "No dates in the next twelve months"}>
          {filtered
            ? "Choose another vendor or kind of date to see more."
            : "Notice deadlines and renewal dates appear here for active subscriptions. MSAs, SOWs, NDAs and data processing agreements do not renew, so they never appear."}
        </EmptyState>
      ) : (
        <YearList entries={q.data} today={today} />
      )}
    </>
  );
}
