/** A calendar day written YYYY-MM-DD. Contract dates are days, never moments in time. */
export type Day = string;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export function isDay(v: unknown): v is Day {
  if (typeof v !== "string" || !DAY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const utc = (day: Day) => new Date(`${day}T00:00:00Z`);
const toDay = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (day: Day, n: number): Day => toDay(new Date(utc(day).getTime() + n * 86_400_000));

/** Adds months, landing on the last day of the month when the start day does not exist there (31 Jan + 1 month = 28 or 29 Feb). */
export function addMonths(day: Day, n: number): Day {
  const d = utc(day);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return toDay(target);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export const daysBetween = (from: Day, to: Day) => Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);

/** Today's date in the team's time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): Day {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 21 Nov 2026: how a day is shown to people everywhere in the app. */
export function formatDay(day: Day): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
