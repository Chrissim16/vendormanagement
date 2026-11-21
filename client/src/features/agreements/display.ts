import type { Agreement, AgreementStatus, RenewalState } from "../../../../shared/agreements";
import { daysBetween, formatDay, type Day } from "../../../../shared/dates";
import type { Tone } from "../../platform/ui";

export const agreementTone = (status: AgreementStatus): Tone => (status === "active" ? "ok" : status === "ended" ? "none" : "warn");

/** The pill for where a subscription stands: Overdue, 27 days, or nothing when all is well. */
export function renewalPill(a: Pick<Agreement, "renewalState" | "noticeDeadline">, today: Day): { tone: Tone; label: string } | null {
  const state: RenewalState = a.renewalState;
  if (!a.noticeDeadline || state === "ok" || state === "none") return null;
  if (state === "overdue") return { tone: "bad", label: "Overdue" };
  const left = daysBetween(today, a.noticeDeadline);
  return { tone: "warn", label: left === 0 ? "Today" : `${left} ${left === 1 ? "day" : "days"}` };
}

export const day = (d: Day | null) => (d ? formatDay(d) : "–");
