import { z } from "zod";
import { noticeDeadline, renewalState } from "./agreements";
import { addDays, addMonths, daysBetween, formatDay, isDay, type Day } from "./dates";

/** The two kinds of date on the renewal calendar (A-9). */
export const dateKinds = ["notice", "renewal"] as const;
export type DateKind = (typeof dateKinds)[number];
export const dateKindLabels: Record<DateKind, string> = { notice: "Notice deadline", renewal: "Renewal date" };
export const dateKindPlural: Record<DateKind, string> = { notice: "Notice deadlines", renewal: "Renewal dates" };

/** An active subscription of a vendor that is not offboarded, with what the calendar needs. */
export interface CalendarSubscription {
  id: string;
  vendorId: string;
  vendorName: string;
  title: string;
  endDate: Day | null;
  noticePeriodDays: number | null;
  /** A renewal decision has been recorded for the term ending on `endDate`. */
  decidedForTerm: boolean;
}

export interface CalendarEntry {
  /** Stays the same for the same subscription, kind and date, in every download. */
  id: string;
  date: Day;
  kind: DateKind;
  agreementId: string;
  vendorId: string;
  vendorName: string;
  title: string;
  /** For a notice deadline: it has passed and no decision is recorded. */
  overdue: boolean;
  /** The renewal date the entry belongs to; for a renewal date, the date itself. */
  renewsOn: Day;
}

const compact = (d: Day) => d.replaceAll("-", "");

/**
 * The calendar's dates, by the same rule as the renewals page and the warnings: one renewal
 * date and one notice deadline per subscription, the notice deadline left out once the term
 * has a decision. Sorted by date, notice deadlines before renewal dates on the same day.
 */
export function calendarEntries(subs: CalendarSubscription[], today: Day): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const s of subs) {
    if (!s.endDate) continue;
    const a = { kind: "subscription" as const, status: "active" as const, endDate: s.endDate, noticePeriodDays: s.noticePeriodDays };
    const base = { agreementId: s.id, vendorId: s.vendorId, vendorName: s.vendorName, title: s.title, renewsOn: s.endDate };
    if (!s.decidedForTerm) {
      const deadline = noticeDeadline(a)!;
      out.push({ ...base, id: `${s.id}-notice-${compact(deadline)}`, date: deadline, kind: "notice", overdue: renewalState(a, today, false) === "overdue" });
    }
    out.push({ ...base, id: `${s.id}-renewal-${compact(s.endDate)}`, date: s.endDate, kind: "renewal", overdue: false });
  }
  return out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0) || dateKinds.indexOf(x.kind) - dateKinds.indexOf(y.kind) || x.title.localeCompare(y.title));
}

/** The longest span one request may cover, so a file stays a sensible size. */
export const MAX_CALENDAR_DAYS = 400;

const day = z.string().refine(isDay, "Enter a real date.");
export const calendarQuery = z
  .object({
    from: day,
    to: day,
    vendorId: z.string().uuid().optional(),
    kind: z.enum(dateKinds).optional(),
    /** Also the notice deadlines before `from` that have passed without a decision. */
    withOverdue: z
      .enum(["1", "0", "true", "false"])
      .optional()
      .transform((v) => v === "1" || v === "true"),
  })
  .refine((q) => q.from <= q.to, { message: "The end of the span is before its start.", path: ["to"] })
  .refine((q) => daysBetween(q.from, q.to) < MAX_CALENDAR_DAYS, { message: `Choose a span of at most ${MAX_CALENDAR_DAYS} days.`, path: ["to"] });
export type CalendarQuery = z.infer<typeof calendarQuery>;

/** Entries within the query's span and filters. */
export function pickEntries(entries: CalendarEntry[], q: Omit<CalendarQuery, "from" | "to"> & { from: Day; to: Day }): CalendarEntry[] {
  return entries.filter(
    (e) => (!q.vendorId || e.vendorId === q.vendorId) && (!q.kind || e.kind === q.kind) && ((e.date >= q.from && e.date <= q.to) || (q.withOverdue && e.overdue && e.date < q.from)),
  );
}

/** The list view's span: today up to the day before the same date twelve months on. */
export const yearAhead = (today: Day) => ({ from: today, to: addDays(addMonths(today, 12), -1) });

/** The first and last day of the month of a day. */
export function monthSpan(month: string): { from: Day; to: Day } {
  const from = `${month}-01`;
  return { from, to: addDays(addMonths(from, 1), -1) };
}

/** Text as an iCalendar TEXT value: backslash, semicolon, comma and line breaks escaped. */
export const icsText = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");

/** Lines longer than 75 bytes are folded, as the format requires, without splitting a character. */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    // The first line holds 75 bytes; each following one starts with a space, so holds 74 more.
    if (bytes + size > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const stampOf = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/**
 * The entries as an iCalendar file that Outlook and Teams open: one all-day event per entry,
 * and a reminder on each notice deadline `reminderDays` before it (the notice warning setting).
 */
export function toIcs(entries: CalendarEntry[], { reminderDays, stamp }: { reminderDays: number; stamp: Date }): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Vendor Management//Renewal calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Renewal calendar"];
  for (const e of entries) {
    const name = `${e.vendorName} · ${e.title}`;
    const summary = `${dateKindLabels[e.kind]}: ${name}`;
    const description =
      e.kind === "notice"
        ? `The last day to cancel or renegotiate ${name}. It renews on ${formatDay(e.renewsOn)}. Record the decision on the Renewals page of the vendor management app.`
        : `${name} renews on this day.`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@vendor-management`,
      `DTSTAMP:${stampOf(stamp)}`,
      `DTSTART;VALUE=DATE:${compact(e.date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(e.date, 1))}`,
      `SUMMARY:${icsText(summary)}`,
      `DESCRIPTION:${icsText(description)}`,
      "TRANSP:TRANSPARENT",
    );
    if (e.kind === "notice" && reminderDays > 0)
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(summary)}`, `TRIGGER:-P${reminderDays}D`, "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
