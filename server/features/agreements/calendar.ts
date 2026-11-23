import { calendarEntries, pickEntries, toIcs, type CalendarEntry, type CalendarQuery } from "../../../shared/calendar";
import type { Day } from "../../../shared/dates";
import type { Queryable } from "../../platform/ports/types";
import { getSettings } from "../settings/service";
import * as repo from "./repo";

/** The renewal calendar's dates within the query's span and filters (A-9). */
export async function listCalendar(db: Queryable, q: CalendarQuery, today: Day): Promise<CalendarEntry[]> {
  const rows = await repo.calendarSubscriptions(db);
  const entries = calendarEntries(
    rows.map(({ decisionId, ...r }) => ({ ...r, decidedForTerm: decisionId !== null })),
    today,
  );
  return pickEntries(entries, q);
}

/** The same dates as a calendar file, with a reminder on each notice deadline at the notice warning window. */
export async function calendarFile(db: Queryable, q: CalendarQuery, today: Day, now: Date = new Date()): Promise<string> {
  const [entries, settings] = await Promise.all([listCalendar(db, q, today), getSettings(db)]);
  return toIcs(entries, { reminderDays: settings.noticeDays, stamp: now, today });
}
