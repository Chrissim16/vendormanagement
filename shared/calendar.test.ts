import { describe, expect, it } from "vitest";
import { calendarEntries, calendarQuery, foldLine, icsText, monthSpan, pickEntries, toIcs, yearAhead, type CalendarSubscription } from "./calendar";

const sub = (o: Partial<CalendarSubscription> = {}): CalendarSubscription => ({
  id: "11111111-1111-4111-8111-111111111111",
  vendorId: "v1",
  vendorName: "Northwind",
  title: "Licences",
  endDate: "2027-03-01",
  noticePeriodDays: 60,
  decidedForTerm: false,
  ...o,
});

describe("A-9 calendar entries", () => {
  it("gives a notice deadline and a renewal date per subscription, by the renewals rule", () => {
    const [notice, renewal] = calendarEntries([sub()], "2026-11-21");
    expect(notice).toMatchObject({ kind: "notice", date: "2026-12-31", overdue: false, renewsOn: "2027-03-01", id: "11111111-1111-4111-8111-111111111111-notice-20261231" });
    expect(renewal).toMatchObject({ kind: "renewal", date: "2027-03-01", overdue: false });
  });
  it("marks a passed notice deadline overdue and drops it once the term is decided", () => {
    expect(calendarEntries([sub()], "2027-01-01")[0]).toMatchObject({ kind: "notice", overdue: true });
    expect(calendarEntries([sub({ decidedForTerm: true })], "2027-01-01").map((e) => e.kind)).toEqual(["renewal"]);
  });
  it("uses 90 days when no notice period is set, and sorts by date", () => {
    const es = calendarEntries([sub({ id: "b", endDate: "2027-06-01", noticePeriodDays: null }), sub()], "2026-11-21");
    expect(es.map((e) => e.date)).toEqual(["2026-12-31", "2027-03-01", "2027-03-03", "2027-06-01"]);
  });
  it("picks a span and filters, with passed undecided deadlines when asked", () => {
    const es = calendarEntries([sub(), sub({ id: "c", vendorId: "v2", endDate: "2026-12-01" })], "2026-11-21");
    const span = { from: "2026-11-21", to: "2027-11-20", withOverdue: false };
    expect(pickEntries(es, span).map((e) => e.date)).toEqual(["2026-12-01", "2026-12-31", "2027-03-01"]);
    expect(pickEntries(es, { ...span, withOverdue: true }).map((e) => e.date)).toEqual(["2026-10-02", "2026-12-01", "2026-12-31", "2027-03-01"]);
    expect(pickEntries(es, { ...span, kind: "notice", vendorId: "v1" }).map((e) => e.date)).toEqual(["2026-12-31"]);
  });
  it("works out spans", () => {
    expect(yearAhead("2026-11-21")).toEqual({ from: "2026-11-21", to: "2027-11-20" });
    expect(monthSpan("2027-02")).toEqual({ from: "2027-02-01", to: "2027-02-28" });
    expect(calendarQuery.safeParse({ from: "2026-01-01", to: "2027-12-31" }).success).toBe(false);
    expect(calendarQuery.safeParse({ from: "2026-02-01", to: "2026-01-01" }).success).toBe(false);
    expect(calendarQuery.parse({ from: "2026-01-01", to: "2026-01-31", withOverdue: "1" }).withOverdue).toBe(true);
  });
});

describe("A-9 calendar file", () => {
  const stamp = new Date("2026-11-21T10:00:00.123Z");
  it("writes all-day events with a reminder on notice deadlines only", () => {
    const ics = toIcs(calendarEntries([sub()], "2026-11-21"), { reminderDays: 90, stamp });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101");
    expect(ics).toContain("DTSTAMP:20261121T100000Z");
    expect(ics).toContain("UID:11111111-1111-4111-8111-111111111111-renewal-20270301@vendor-management");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.match(/TRIGGER:-P90D/g)).toHaveLength(1);
    expect(ics).not.toMatch(/[^\r]\n/);
  });
  it("escapes text and folds long lines without splitting a character", () => {
    expect(icsText("a, b; c\\d\ne")).toBe("a\\, b\\; c\\\\d\\ne");
    const folded = foldLine(`SUMMARY:${"é".repeat(80)}`);
    for (const line of folded.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n").map((l, i) => (i ? l.slice(1) : l)).join("")).toBe(`SUMMARY:${"é".repeat(80)}`);
  });
});
