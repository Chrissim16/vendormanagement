import type { Day } from "../../../shared/dates";
import { latestScores, type Dashboard, type OpenRfp, type ScorecardDueRow, type SowBudgetRow, type VendorScoreRow } from "../../../shared/overview";
import { addQuarter, quarterOf, type Quarter, type Scorecard } from "../../../shared/scorecards";
import { budgetView } from "../../../shared/sow";
import type { Queryable } from "../../platform/ports/types";
import { defaultPeriod, getSpend } from "../invoices/service";
import { listScorecards, type ScorecardContext } from "../scorecards/service";
import { getSettings } from "../settings/service";
import * as repo from "./repo";

/** The dashboard, the monthly report and briefings need the same things as scorecards: the database, the figures, the AI and the clock. */
export type OverviewContext = ScorecardContext;

/**
 * SOWs with a budget against what was invoiced, the most used first (D-1, D-2, B-1).
 * The budget is the one the SOW holds today, also when looking back at an earlier month.
 */
export async function sowBudgetRows(db: Queryable, o: { period?: { from: Day; asAt: Day }; vendorId?: string } = {}): Promise<SowBudgetRow[]> {
  const [rows, settings] = await Promise.all([repo.sowBudgets(db, o), getSettings(db)]);
  return rows
    .map(({ budgetMinor, invoicedMinor, ...r }) => ({ ...r, budget: budgetView(budgetMinor, Number(invoicedMinor), settings.budgetWarningPct) }))
    .sort(
      (a, b) =>
        // Compared exactly, as a share of the budget, so two SOWs at "67%" still come out in the right order. Whole numbers too large for ordinary arithmetic are safe here.
        Number(BigInt(b.budget.invoicedMinor) * BigInt(a.budget.budgetMinor || 1) - BigInt(a.budget.invoicedMinor) * BigInt(b.budget.budgetMinor || 1) > 0n) -
          Number(BigInt(b.budget.invoicedMinor) * BigInt(a.budget.budgetMinor || 1) - BigInt(a.budget.invoicedMinor) * BigInt(b.budget.budgetMinor || 1) < 0n) ||
        a.vendorName.localeCompare(b.vendorName) ||
        a.title.localeCompare(b.title),
    );
}

/** Every scorecard of a scored vendor, final or draft. */
async function allScorecards(ctx: OverviewContext): Promise<Scorecard[]> {
  const out: Scorecard[] = [];
  for (let page = 1; page < 100; page++) {
    const { items, total } = await listScorecards(ctx, { sort: "quarter", dir: "desc", page, pageSize: 200 });
    out.push(...items);
    if (out.length >= total || !items.length) break;
  }
  return out;
}

const finalUpTo = (cards: Scorecard[], asAt: Day) => cards.filter((c) => c.status === "final" && c.periodEnd <= asAt);

/** Each scored vendor's latest final scorecard for a quarter that had ended by `asAt`, with the one before it. */
export async function vendorScores(ctx: OverviewContext, asAt: Day, vendorId?: string): Promise<VendorScoreRow[]> {
  const cards = finalUpTo(await allScorecards(ctx), asAt);
  return latestScores(vendorId ? cards.filter((c) => c.vendorId === vendorId) : cards);
}

/** The quarter whose scorecards are due now: the last one that is over. */
export const dueQuarter = (today: Day): Quarter => addQuarter(quarterOf(today), -1);

/** Active agreements, as they stand today, whose end date falls between two days, soonest first. */
export const agreementsEnding = repo.agreementsEnding;

/** RFPs are built in a later milestone; until then none is open. */
export const openRfps = async (): Promise<OpenRfp[]> => [];

/** The landing page (D-1). Warnings and risk flags come from their own list. */
export async function getDashboard(ctx: OverviewContext): Promise<Dashboard> {
  const today = ctx.today();
  const period = defaultPeriod(today);
  const quarter = dueQuarter(today);
  const [sows, spend, cards, vendors, rfps] = await Promise.all([
    sowBudgetRows(ctx.db),
    getSpend(ctx.db, period.from, period.to),
    allScorecards(ctx),
    repo.scoredVendors(ctx.db),
    openRfps(),
  ]);
  const ofQuarter = new Map(cards.filter((c) => c.quarter === quarter).map((c) => [c.vendorId, c]));
  const due: ScorecardDueRow[] = vendors
    .filter((v) => ofQuarter.get(v.id)?.status !== "final")
    .map((v) => {
      const draft = ofQuarter.get(v.id);
      return { vendorId: v.id, vendorName: v.name, scorecardId: draft?.id ?? null, scored: draft?.scored ?? 0, criteria: draft?.criteria ?? 0 };
    });
  return { sows, spend, scores: latestScores(finalUpTo(cards, today)), dueQuarter: quarter, due, rfps };
}
