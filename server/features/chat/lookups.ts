import { agreementName, kindLabels, kindShort, pricingLabels, statusLabels, type Agreement } from "../../../shared/agreements";
import { MAX_ROWS, type AskLookup, type AskPassage, type AskRow, type LookupArgs, type LookupCall, type LookupName } from "../../../shared/ask";
import { formatDay, type Day } from "../../../shared/dates";
import { formatMoney } from "../../../shared/money";
import { formatMetric, formatTarget, metricInfo, metricKeys, monthName, type MonthMetrics } from "../../../shared/performance";
import { candidateListLabels, formatHundredths, rfpStageLabels } from "../../../shared/rfp";
import { formatScore, paperworkWords, quarterName } from "../../../shared/scorecards";
import { isRiskFlag, vendorStatusLabels, vendorTypeLabels, warningTypeLabels, type Vendor, type WarningType } from "../../../shared/vendors";
import { getAgreement, listAgreements, listRenewals } from "../agreements/service";
import { sowBudgetRows } from "../dashboard/service";
import { defaultPeriod, getSpend, listInvoices } from "../invoices/service";
import { getOverview, getVendorPerformance } from "../performance/service";
import { getRfp, listRfps, rfpsOfVendor } from "../rfp/service";
import { getSettings } from "../settings/service";
import { listScorecards, type ScorecardContext } from "../scorecards/service";
import { getDelivery } from "../sow/service";
import { getVendor, listPeople, listVendors } from "../vendors/service";
import { listAttention } from "../warnings/service";
import { AppError } from "../../platform/errors";
import { findPassages } from "./documents";

/**
 * The look-ups a question can be answered from (C-1). Each one calls the same function
 * the matching list page calls, with the same filter, and works out its counts and totals
 * here, in code. Nothing in this file writes to the database.
 */

export type ChatContext = ScorecardContext;

/** Who and what a name in a question can refer to. */
export interface Known {
  vendors: { id: string; name: string }[];
  people: { id: string; name: string }[];
  /** What the reader must be told about how a name was understood; filled while one look-up runs. */
  notes: string[];
}

export async function known(ctx: ChatContext): Promise<Known> {
  const vendors: Known["vendors"] = [];
  for (let page = 1; page <= 20; page++) {
    const { items, total } = await listVendors(ctx.db, { status: "all", sort: "name", dir: "asc", page, pageSize: 200 }, ctx.today());
    vendors.push(...items.map((v) => ({ id: v.id, name: v.name })));
    if (vendors.length >= total || !items.length) break;
  }
  const people = (await listPeople(ctx.db)).map((p) => ({ id: p.id, name: p.displayName ?? p.email }));
  return { vendors, people, notes: [] };
}

/** A row before it has its reference. `names` are the names and titles people typed in it, which are not figures (see `server/ai/grounding.ts`). */
type Row = Omit<AskRow, "ref"> & { names?: (string | null | undefined)[] };
type Result = Omit<AskLookup, "name" | "rows" | "passages"> & { rows: Row[]; passages?: Omit<AskPassage, "ref">[] };
const nothing = (title: string, note: string): Result => ({ title, href: null, count: null, totals: [], rows: [], more: 0, note });

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** The one entry a name points to: the exact name, or else the only one that contains it or is contained in it. */
function pick<T extends { name: string }>(list: T[], asked: string): { found: T; exact: boolean } | { problem: string } {
  const exact = list.filter((v) => same(v.name, asked));
  if (exact.length === 1) return { found: exact[0]!, exact: true };
  const q = asked.trim().toLowerCase();
  const near = list.filter((v) => v.name.toLowerCase().includes(q) || q.includes(v.name.toLowerCase()));
  if (near.length === 1) return { found: near[0]!, exact: false };
  const some = near
    .slice(0, 6)
    .map((v) => v.name)
    .join(", ");
  return { problem: near.length ? `more than one matches “${asked}”: ${some}` : `none is called “${asked}”` };
}

class Unknown extends Error {}
/** A name that is not written exactly as the app has it is said, so the reader knows whom the figures are about. */
const named = (k: Known, list: { id: string; name: string }[], asked: string | undefined, what: string) => {
  if (!asked) return undefined;
  const v = pick(list, asked);
  if ("problem" in v) throw new Unknown(`The app could not tell which ${what} is meant: ${v.problem}.`);
  if (!v.exact) k.notes.push(`“${asked}” was taken to mean ${v.found.name}.`);
  return v.found;
};
const vendorOf = (k: Known, asked: string | undefined) => named(k, k.vendors, asked, "vendor");
const personOf = (k: Known, asked: string | undefined) => named(k, k.people, asked, "colleague");

const query = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
const title = (what: string, ...filters: (string | false | undefined | null)[]) => [what, ...filters.filter(Boolean)].join(" · ");
const between = (verb: string, from?: Day, to?: Day) =>
  from && to ? `${verb} ${formatDay(from)} to ${formatDay(to)}` : from ? `${verb} on or after ${formatDay(from)}` : to ? `${verb} on or before ${formatDay(to)}` : "";
const dayOr = (d: Day | null | undefined) => (d ? formatDay(d) : "–");
/** Facts without the ones that have nothing to say. */
const facts = (o: Record<string, string | null | undefined | false>): Record<string, string> =>
  Object.fromEntries(Object.entries(o).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));
const page = { page: 1, pageSize: MAX_ROWS };
const cut = (text: string, max = 400) => {
  if (text.length <= max) return text;
  const at = text.lastIndexOf(" ", max);
  return `${text.slice(0, at > 0 ? at : max)} …`;
};

const vendorRow = (v: Vendor): Row => ({
  label: v.name,
  names: [v.name, v.ownerName],
  href: `/vendors${query({ status: v.status === "offboarded" ? "all" : undefined, open: v.id })}`,
  facts: facts({
    Type: vendorTypeLabels[v.type],
    Status: vendorStatusLabels[v.status],
    Owner: v.ownerName,
    NDA: paperworkWords[v.nda],
    "Data processing agreement": paperworkWords[v.dpa],
    "Active agreements": String(v.activeAgreements),
    Warnings: String(v.warnings),
  }),
});

const agreementRow = (a: Agreement): Row => ({
  label: agreementName(a.kind, a.title),
  names: [a.title, a.vendorName, a.ownerName, a.reference],
  href: `/agreements/${a.id}`,
  facts: facts({
    Vendor: a.vendorName,
    Kind: kindLabels[a.kind],
    Status: statusLabels[a.status],
    Owner: a.ownerName,
    "Start date": a.startDate && formatDay(a.startDate),
    [a.kind === "subscription" ? "Renewal date" : "End date"]: a.endDate && formatDay(a.endDate),
    "Notice deadline": a.noticeDeadline && formatDay(a.noticeDeadline),
    Budget: a.budgetMinor != null && formatMoney(a.budgetMinor, a.currency),
    "Annual value": a.annualValueMinor != null && formatMoney(a.annualValueMinor, a.currency),
    Pricing: a.pricing && pricingLabels[a.pricing],
    Reference: a.reference,
  }),
});

const budgetState = { over: "over budget", warn: "close to budget", ok: "within budget", none: "no budget" } as const;

const metricFacts = (m: MonthMetrics) =>
  facts({
    ...Object.fromEntries(
      metricKeys.map((k) => {
        const c = m.cells[k];
        const target = c.targetTenths == null ? "no target" : `target ${formatTarget(k, c.targetTenths)}, ${c.verdict === "none" ? "not judged" : c.verdict}`;
        return [metricInfo[k].label, c.valueTenths == null ? "nothing measured" : `${formatMetric(k, c.valueTenths)} (${target})`];
      }),
    ),
    "Targets missed": String(m.missed),
  });

type Runner<N extends LookupName> = (ctx: ChatContext, args: LookupArgs<N>, k: Known) => Promise<Result>;

const runners: { [N in LookupName]: Runner<N> } = {
  async vendors(ctx, a, k) {
    const owner = personOf(k, a.owner);
    const list = await listVendors(ctx.db, { q: a.search, type: a.type, status: a.status, owner: owner?.id, sort: "name", dir: "asc", ...page }, ctx.today());
    return {
      title: title(
        "Vendors",
        a.search && `name contains “${a.search}”`,
        a.type && vendorTypeLabels[a.type],
        a.status === "all" ? "including offboarded" : a.status ? vendorStatusLabels[a.status] : "not offboarded",
        owner && `owned by ${owner.name}`,
      ),
      href: `/vendors${query({ q: a.search, type: a.type, status: a.status, owner: owner?.id })}`,
      count: list.total,
      totals: [],
      rows: list.items.map(vendorRow),
      more: list.total - list.items.length,
      note: null,
    };
  },

  async vendor(ctx, a, k) {
    const v = vendorOf(k, a.vendor)!;
    const today = ctx.today();
    const [detail, agreements, rfps] = await Promise.all([
      getVendor(ctx.db, v.id, today),
      listAgreements(ctx.db, { vendorId: v.id, sort: "kind", dir: "asc", ...page }, today),
      rfpsOfVendor(ctx.db, v.id),
    ]);
    const self = vendorRow(detail);
    const contacts = detail.contacts.map((c) => [c.name, c.jobTitle, c.email, c.phone].filter(Boolean).join(", ") + (c.isPrimary ? " (primary contact)" : ""));
    return {
      title: title("Vendor", detail.name),
      href: self.href,
      count: null,
      totals: [
        { label: "Agreements", value: String(agreements.total) },
        { label: "RFPs", value: String(rfps.length) },
      ],
      rows: [
        {
          ...self,
          // What people typed about the vendor is text, not figures.
          names: [...(self.names ?? []), detail.legalName, detail.website, contacts.join("; "), detail.description && cut(detail.description)],
          facts: {
            ...self.facts,
            ...facts({
              "Legal name": detail.legalName,
              Country: detail.country,
              Website: detail.website,
              Contacts: contacts.join("; "),
              Description: detail.description && cut(detail.description),
            }),
          },
        },
        ...agreements.items.map(agreementRow),
        ...rfps.map((r) => ({
          label: `RFP ${r.title}`,
          names: [r.title],
          href: `/rfps/${r.id}`,
          facts: facts({ Stage: rfpStageLabels[r.stage], "This vendor": r.won ? "won" : candidateListLabels[r.list] }),
        })),
      ],
      more: agreements.total - agreements.items.length,
      note: null,
    };
  },

  async agreements(ctx, a, k) {
    const vendor = vendorOf(k, a.vendor);
    const owner = personOf(k, a.owner);
    const [endsFrom, endsTo] = a.endsFrom && a.endsTo && a.endsTo < a.endsFrom ? [a.endsTo, a.endsFrom] : [a.endsFrom, a.endsTo];
    const dated = !!(endsFrom || endsTo);
    const filter = { q: a.search, kind: a.kind, vendorId: vendor?.id, status: a.status, owner: owner?.id, endsFrom, endsTo };
    const list = await listAgreements(ctx.db, { ...filter, sort: dated ? "endDate" : "title", dir: "asc", ...page }, ctx.today());
    return {
      title: title(
        a.kind ? `${kindShort[a.kind]}s` : "Agreements",
        vendor?.name,
        a.status && statusLabels[a.status],
        a.search && `title, reference or vendor contains “${a.search}”`,
        owner && `owned by ${owner.name}`,
        between("ending", endsFrom, endsTo),
      ),
      href: `/agreements${query({ ...filter, sort: dated ? "endDate" : undefined })}`,
      count: list.total,
      totals: [],
      rows: list.items.map(agreementRow),
      more: list.total - list.items.length,
      note: null,
    };
  },

  async renewals(ctx, a) {
    // The Renewals page offers these windows and the team's own; the same number of days is used here and said in the title.
    const usual = (await getSettings(ctx.db)).noticeDays;
    const days = a.withinDays ?? usual;
    const list = await listRenewals(ctx.db, days, undefined, ctx.today());
    return {
      title: title("Renewals without a decision", `notice deadline passed or within ${days} days${days === usual ? ", the team's usual window" : ""}`),
      href: `/agreements/renewals${query({ window: days === usual ? undefined : days })}`,
      count: list.length,
      totals: [{ label: "Notice deadline already passed", value: String(list.filter((r) => r.renewalState === "overdue").length) }],
      rows: list.slice(0, MAX_ROWS).map((r) => ({
        ...agreementRow(r),
        facts: { ...agreementRow(r).facts, "Notice deadline": `${dayOr(r.noticeDeadline)} (${r.renewalState === "overdue" ? "passed" : "coming up"})` },
      })),
      more: Math.max(0, list.length - MAX_ROWS),
      note: null,
    };
  },

  async sow(ctx, a, k) {
    const vendor = vendorOf(k, a.vendor);
    const today = ctx.today();
    const what = title("SOW", `“${a.title}”`, vendor?.name);
    const found = await listAgreements(ctx.db, { q: a.title, kind: "sow", vendorId: vendor?.id, sort: "title", dir: "asc", ...page }, today);
    const one = found.items.filter((s) => same(s.title, a.title))[0] ?? (found.total === 1 ? found.items[0] : undefined);
    if (!found.total) return nothing(what, `No SOW matches “${a.title}”.`);
    if (!one)
      return {
        title: what,
        href: `/agreements${query({ q: a.title, kind: "sow", vendorId: vendor?.id })}`,
        count: found.total,
        totals: [],
        rows: found.items.map(agreementRow),
        more: found.total - found.items.length,
        note: "More than one SOW matches, so none is shown in full.",
      };
    const [sow, d] = await Promise.all([getAgreement(ctx.db, one.id, today), getDelivery(ctx.db, one.id, today)]);
    const href = `/agreements/${sow.id}`;
    const money = (minor: number | null) => (minor == null ? null : formatMoney(minor, sow.currency));
    const open = d.milestones.filter((m) => m.status === "open");
    return {
      title: title("SOW", agreementName("sow", sow.title), sow.vendorName),
      href,
      count: null,
      totals: [
        { label: "Milestones", value: String(d.milestones.length) },
        { label: "Open milestones", value: String(open.length) },
        { label: "Open milestones past their due date", value: String(open.filter((m) => m.late).length) },
        { label: "Change requests waiting for a decision", value: String(d.changeRequests.filter((c) => c.status === "proposed").length) },
      ],
      rows: [
        {
          ...agreementRow(sow),
          facts: {
            ...agreementRow(sow).facts,
            ...facts({
              Invoiced: money(d.budget.invoicedMinor),
              Remaining: money(d.budget.remainingMinor),
              "Budget used": d.budget.usedPct == null ? null : `${d.budget.usedPct}%`,
              "Budget state": budgetState[d.budget.state],
              "Budget it started with": d.budget.originalMinor != null && d.budget.originalMinor !== d.budget.budgetMinor && money(d.budget.originalMinor),
              "End date it started with": d.endDateOriginal && d.endDateOriginal !== sow.endDate && formatDay(d.endDateOriginal),
              Under: sow.parent?.title,
            }),
          },
        },
        ...d.milestones.map((m) => ({
          label: `Milestone ${m.title}`,
          names: [m.title],
          href,
          facts: facts({
            Due: formatDay(m.dueDate),
            Status:
              m.status === "open"
                ? m.late
                  ? `open, ${m.daysLate} days late`
                  : "open"
                : m.status === "delivered"
                  ? `delivered ${dayOr(m.deliveredOn)}${m.late ? `, ${m.daysLate} days late` : ""}`
                  : "cancelled",
            Amount: money(m.amountMinor),
            Invoiced: m.invoicedMinor ? money(m.invoicedMinor) : null,
          }),
        })),
        ...d.changeRequests.map((c) => ({
          label: `Change request ${c.title}`,
          names: [c.title],
          href,
          facts: facts({
            Status: c.status === "proposed" ? "waiting for a decision" : `${c.status}${c.decidedOn ? ` ${formatDay(c.decidedOn)}` : ""}`,
            "Requested on": formatDay(c.requestedOn),
            "Budget change": c.budgetChangeMinor ? money(c.budgetChangeMinor) : null,
            "New end date": c.newEndDate && formatDay(c.newEndDate),
          }),
        })),
        ...d.consultants.map((c) => ({
          label: `Consultant ${c.name}`,
          names: [c.name, c.role],
          href,
          facts: facts({
            Role: c.role,
            "Day rate": c.dayRateMinor != null && c.currency ? formatMoney(c.dayRateMinor, c.currency) : null,
            From: c.fromDate && formatDay(c.fromDate),
            Until: c.toDate && formatDay(c.toDate),
          }),
        })),
      ],
      more: 0,
      note: null,
    };
  },

  async sow_budgets(ctx, a, k) {
    const vendor = vendorOf(k, a.vendor);
    const rows = await sowBudgetRows(ctx.db, { vendorId: vendor?.id });
    return {
      title: title("Active SOWs with a budget, the most used first", vendor?.name),
      // The dashboard lists the same SOWs; it has no filter by vendor.
      href: vendor ? null : "/",
      count: rows.length,
      totals: [
        { label: "Over budget", value: String(rows.filter((r) => r.budget.state === "over").length) },
        { label: "Close to budget", value: String(rows.filter((r) => r.budget.state === "warn").length) },
      ],
      rows: rows.slice(0, MAX_ROWS).map((r) => ({
        label: agreementName("sow", r.title),
        names: [r.title, r.vendorName],
        href: `/agreements/${r.agreementId}`,
        facts: facts({
          Vendor: r.vendorName,
          Budget: formatMoney(r.budget.budgetMinor ?? 0, r.currency),
          Invoiced: formatMoney(r.budget.invoicedMinor, r.currency),
          Remaining: r.budget.remainingMinor == null ? null : formatMoney(r.budget.remainingMinor, r.currency),
          "Budget used": r.budget.usedPct == null ? null : `${r.budget.usedPct}%`,
          "Budget state": budgetState[r.budget.state],
          "End date": r.endDate && formatDay(r.endDate),
        }),
      })),
      more: Math.max(0, rows.length - MAX_ROWS),
      note: null,
    };
  },

  async invoices(ctx, a, k) {
    const vendor = vendorOf(k, a.vendor);
    const [from, to] = a.from && a.to && a.to < a.from ? [a.to, a.from] : [a.from, a.to];
    const filter = { q: a.search, vendorId: vendor?.id, from, to };
    const list = await listInvoices(ctx.db, { ...filter, sort: "invoiceDate", dir: "desc", ...page });
    return {
      title: title("Invoices", vendor?.name, between("dated", from, to), a.search && `number, vendor, agreement or description contains “${a.search}”`),
      href: `/money/invoices${query(filter)}`,
      count: list.total,
      totals: [
        { label: "Total in euros", value: formatMoney(list.sums.EUR, "EUR") },
        ...(list.sums.GBP ? [{ label: "Total in pounds", value: formatMoney(list.sums.GBP, "GBP") }] : []),
      ],
      rows: list.items.map((i) => ({
        label: `Invoice ${i.invoiceNumber}`,
        names: [i.invoiceNumber, i.vendorName, i.agreementTitle, i.milestoneTitle, i.description],
        href: `/agreements/${i.agreementId}`,
        facts: facts({
          Vendor: i.vendorName,
          Date: formatDay(i.invoiceDate),
          Amount: formatMoney(i.amountMinor, i.currency),
          For: i.agreementTitle,
          Milestone: i.milestoneTitle,
          Description: i.description,
        }),
      })),
      more: list.total - list.items.length,
      note: null,
    };
  },

  async spend(ctx, a) {
    const usual = defaultPeriod(ctx.today());
    // Without a first day, the twelve months that end with the last day asked for; without a last day, up to today.
    let [from, to] = [a.from ?? (a.to ? defaultPeriod(a.to).from : usual.from), a.to ?? (a.from ? ctx.today() : usual.to)];
    if (to < from) [from, to] = [to, from];
    const s = await getSpend(ctx.db, from, to);
    const money = (m: { EUR: number; GBP: number; eurMinor: number }) =>
      facts({ Euros: formatMoney(m.EUR, "EUR"), Pounds: m.GBP ? formatMoney(m.GBP, "GBP") : null, "Together in euros": formatMoney(m.eurMinor, "EUR") });
    return {
      title: title("Spend per vendor and per month", between("invoices dated", from, to)),
      href: `/money${query({ period: "custom", from, to })}`,
      count: null,
      totals: [
        { label: "Invoiced in euros", value: formatMoney(s.total.EUR, "EUR") },
        { label: "Invoiced in pounds", value: formatMoney(s.total.GBP, "GBP") },
        { label: "Together in euros", value: formatMoney(s.total.eurMinor, "EUR") },
        { label: "Vendors invoiced", value: String(s.byVendor.length) },
      ],
      rows: [
        ...s.byVendor.map((v) => ({ label: v.vendorName, names: [v.vendorName], href: `/money/invoices${query({ vendorId: v.vendorId, from, to })}`, facts: money(v) })),
        ...s.byMonth
          .filter((m) => m.eurMinor > 0)
          .reverse()
          .map((m) => ({ label: monthName(m.month), href: `/money${query({ period: "custom", from, to })}`, facts: money(m) })),
      ],
      more: 0,
      note: s.byVendor.length ? null : "Nothing was invoiced in this period.",
    };
  },

  async helpdesk(ctx, a) {
    const o = await getOverview(ctx.perf, { month: a.month, sort: "missed", dir: "desc" });
    const running = o.month === o.currentMonth;
    return {
      title: title("Helpdesk figures per vendor", `${monthName(o.month)}${running ? " so far" : ""}`),
      href: `/performance${query({ month: running ? undefined : o.month })}`,
      count: o.rows.length,
      totals: [{ label: "Vendors that missed a target", value: String(o.rows.filter((r) => r.metrics.missed > 0).length) }],
      rows: o.rows.slice(0, MAX_ROWS).map((r) => ({
        label: r.vendorName,
        names: [r.vendorName],
        href: `/performance/${r.vendorId}${query({ month: running ? undefined : o.month })}`,
        facts: metricFacts(r.metrics),
      })),
      more: Math.max(0, o.rows.length - MAX_ROWS),
      note:
        [
          a.month && a.month !== o.month ? `There are no figures for a month that has not started, so ${monthName(o.month)} is shown.` : "",
          o.unlinked.length ? `Scored vendors without a Jira board, so without figures: ${o.unlinked.map((u) => u.name).join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join(" ") || null,
    };
  },

  async vendor_helpdesk(ctx, a, k) {
    const v = vendorOf(k, a.vendor)!;
    const p = await getVendorPerformance(ctx.perf, v.id, a.month);
    const what = title("Helpdesk figures month by month", p.vendor.name);
    if (!p.vendor.scoringEnabled) return nothing(what, `${p.vendor.name} is not scored, so the app shows no helpdesk figures for it.`);
    if (!p.link) return nothing(what, `${p.vendor.name} has no Jira board linked, so there are no helpdesk figures for it.`);
    const months = [...p.months].reverse().slice(0, 6);
    const last = months[0]!.month;
    return {
      title: title(what, `the six months up to ${monthName(last)}`),
      href: `/performance/${v.id}${query({ month: last === p.currentMonth ? undefined : last })}`,
      count: null,
      totals: [{ label: `Targets missed in ${months.length} months`, value: String(months.reduce((n, m) => n + m.missed, 0)) }],
      rows: months.map((m) => ({
        label: `${monthName(m.month)}${m.month === p.currentMonth ? " (so far)" : ""}`,
        href: `/performance/${v.id}${query({ month: m.month === p.currentMonth ? undefined : m.month })}`,
        facts: metricFacts(m),
      })),
      more: 0,
      note: a.month && a.month !== last ? `There are no figures for a month that has not started, so the months up to ${monthName(last)} are shown.` : null,
    };
  },

  async scorecards(ctx, a, k) {
    const vendor = vendorOf(k, a.vendor);
    const list = await listScorecards(ctx, { vendorId: vendor?.id, status: a.status, sort: "quarter", dir: "desc", ...page });
    return {
      title: title("Scorecards", vendor?.name, a.status === "final" ? "final" : a.status === "draft" ? "draft" : ""),
      href: `/performance/scorecards${query({ vendorId: vendor?.id, status: a.status })}`,
      count: list.total,
      totals: [],
      rows: list.items.map((c) => ({
        label: `${c.vendorName} ${quarterName(c.quarter)}`,
        names: [c.vendorName, c.reviewerName],
        href: `/performance/scorecards/${c.id}`,
        facts: facts({
          Status: c.status === "final" ? "final" : "draft",
          "Overall score": c.overallTenths == null ? "not scored yet" : `${formatScore(c.overallTenths)} out of 5`,
          "Criteria scored": `${c.scored} of ${c.criteria}`,
          Reviewer: c.reviewerName,
        }),
      })),
      more: list.total - list.items.length,
      note: null,
    };
  },

  async warnings(ctx, a, k) {
    const vendor = vendorOf(k, a.vendor);
    const all = await listAttention(ctx.perf, vendor ? [vendor.id] : undefined);
    const list = all.filter((w) => (!a.type || w.type === a.type) && (!a.only || isRiskFlag(w) === (a.only === "risk_flags")));
    const kinds = [...new Set(list.map((w) => w.type))] as WarningType[];
    return {
      title: title(
        a.only === "risk_flags" ? "Risk flags today" : a.only === "warnings" ? "Warnings today" : "Warnings and risk flags today",
        a.type && warningTypeLabels[a.type],
        vendor?.name,
      ),
      // The warnings page shows everything, or one kind that has something today; it has no filter by vendor and none for risk flags alone.
      href: vendor || a.only || (a.type && !list.length) ? null : `/warnings${query({ type: a.type })}`,
      count: list.length,
      totals: a.type ? [] : kinds.map((t) => ({ label: warningTypeLabels[t], value: String(list.filter((w) => w.type === t).length) })),
      rows: list.slice(0, MAX_ROWS).map((w) => ({
        label: `${w.label}: ${w.title}`,
        names: [w.title, w.vendorName],
        href: w.agreementId ? `/agreements/${w.agreementId}` : `/vendors${query({ open: w.vendorId })}`,
        facts: facts({ Vendor: w.vendorName, Facts: w.detail, Kind: isRiskFlag(w) ? "risk flag" : "warning" }),
      })),
      more: Math.max(0, list.length - MAX_ROWS),
      note: null,
    };
  },

  async rfps(ctx, a) {
    const list = await listRfps(ctx.db, { q: a.search, stage: a.stage, sort: "target", dir: "asc", ...page });
    return {
      title: title("RFPs", a.stage === "open" ? "still running" : a.stage ? rfpStageLabels[a.stage] : "every stage", a.search && `title contains “${a.search}”`),
      href: `/rfps${query({ q: a.search, stage: a.stage === "open" ? undefined : (a.stage ?? "all") })}`,
      count: list.total,
      totals: [],
      rows: list.items.map((r) => ({
        names: [r.title, r.ownerName, r.winnerName],
        label: `RFP ${r.title}`,
        href: `/rfps/${r.id}`,
        facts: facts({
          Stage: rfpStageLabels[r.stage],
          Owner: r.ownerName,
          "Decision wanted by": r.targetDecisionDate && formatDay(r.targetDecisionDate),
          Candidates: String(r.candidates),
          Winner: r.winnerName,
        }),
      })),
      more: list.total - list.items.length,
      note: null,
    };
  },

  async rfp(ctx, a) {
    const what = title("RFP", `“${a.title}”`);
    const found = await listRfps(ctx.db, { q: a.title, sort: "title", dir: "asc", ...page });
    const one = found.items.filter((r) => same(r.title, a.title))[0] ?? (found.total === 1 ? found.items[0] : undefined);
    if (!found.total) return nothing(what, `No RFP matches “${a.title}”.`);
    if (!one)
      return {
        title: what,
        href: `/rfps${query({ q: a.title, stage: "all" })}`,
        count: found.total,
        totals: [],
        rows: found.items.map((r) => ({
          names: [r.title, r.ownerName],
          label: `RFP ${r.title}`,
          href: `/rfps/${r.id}`,
          facts: facts({ Stage: rfpStageLabels[r.stage], Owner: r.ownerName }),
        })),
        more: found.total - found.items.length,
        note: "More than one RFP matches, so none is shown in full.",
      };
    const r = await getRfp(ctx.db, one.id, ctx.today());
    const href = `/rfps/${r.id}`;
    const result = new Map(r.results.map((x) => [x.candidateId, x]));
    const running = r.candidates.filter((c) => c.list !== "dropped");
    return {
      title: title("RFP", r.title),
      href,
      count: null,
      totals: [
        { label: "Candidates still in", value: String(running.length) },
        { label: "On the shortlist", value: String(r.candidates.filter((c) => c.list === "shortlist").length) },
        { label: "Responses received", value: String(r.candidates.filter((c) => c.responseReceivedOn).length) },
        { label: "Questions", value: String(r.questions.length) },
      ],
      rows: [
        {
          label: `RFP ${r.title}`,
          names: [r.title, r.ownerName, r.sponsor, r.decision?.winnerName, cut(r.need), r.decision && cut(r.decision.rationale), r.cancelReason && cut(r.cancelReason)],
          href,
          facts: facts({
            Stage: rfpStageLabels[r.stage],
            Owner: r.ownerName,
            Need: cut(r.need),
            Budget: r.budgetMinor == null ? null : formatMoney(r.budgetMinor, r.currency),
            Sponsor: r.sponsor,
            "Demand approved on": r.demandApprovedOn && formatDay(r.demandApprovedOn),
            "Decision wanted by": r.targetDecisionDate && formatDay(r.targetDecisionDate),
            "How the parts count": `written answers ${r.writtenWeight}%, demo and interview ${r.demoWeight}%`,
            Winner: r.decision?.winnerName,
            "Decided on": r.decision && formatDay(r.decision.decidedOn),
            "Reasons for the decision": r.decision && cut(r.decision.rationale),
            "Cancelled because": r.cancelReason && cut(r.cancelReason),
          }),
        },
        ...r.candidates.map((c) => {
          const x = result.get(c.id);
          return {
            label: `Candidate ${c.vendorName}`,
            names: [c.vendorName, cut(c.reason, 250)],
            href: `${href}?tab=candidates`,
            facts: facts({
              List: candidateListLabels[c.list],
              Reason: cut(c.reason, 250),
              NDA: paperworkWords[c.nda],
              "RFP issued on": c.issuedOn && formatDay(c.issuedOn),
              "Response received on": c.responseReceivedOn && formatDay(c.responseReceivedOn),
              "Questions answered": c.issuedOn ? `${c.answered} of ${r.questions.length}` : null,
              "Written score": x?.written.hundredths != null && formatHundredths(x.written.hundredths),
              "Demo score": x?.demo.hundredths != null && formatHundredths(x.demo.hundredths),
              "Overall score": x?.overallHundredths != null && formatHundredths(x.overallHundredths),
              Place: x?.rank != null && String(x.rank),
            }),
          };
        }),
      ],
      more: 0,
      note: null,
    };
  },

  async documents(ctx, a, k) {
    const vendor = vendorOf(k, a.vendor);
    const found = await findPassages(ctx.db, a.text, vendor?.id);
    const what = title("Text of uploaded documents", `looking for “${a.text}”`, vendor?.name);
    return {
      title: what,
      href: null,
      count: null,
      totals: [
        { label: "Documents with text the app can read", value: String(found.readable) },
        { label: "Documents without readable text", value: String(found.unreadable) },
      ],
      rows: [],
      passages: found.passages,
      more: 0,
      note:
        [
          !found.readable
            ? `There ${vendor ? `is no document of ${vendor.name}` : "is no uploaded document"} with text the app can read, so nothing could be looked up.`
            : !found.passages.length
              ? `No passage in the ${found.readable} ${found.readable === 1 ? "document" : "documents"} searched mentions these words.`
              : found.missing.length
                ? `No document searched mentions ${found.missing.map((w) => `“${w}”`).join(" or ")}, so these passages are about the rest of what was looked for.`
                : "",
          found.readable && found.unreadable
            ? `${found.unreadable} ${found.unreadable === 1 ? "document has" : "documents have"} no readable text (a scan, for example) and could not be searched.`
            : "",
        ]
          .filter(Boolean)
          .join(" ") || null,
    };
  },
};

/** The words a model put into a look-up's arguments. They are repeated in titles and notes, and are not figures. */
const typedIn = (args: object) => Object.values(args).filter((v): v is string => typeof v === "string" && /\p{L}/u.test(v));

/** Runs one look-up. A name that points nowhere becomes a note the answer must pass on, never a silently dropped filter. */
export async function runLookup(ctx: ChatContext, call: LookupCall, known: Known, letter: string): Promise<{ lookup: AskLookup; names: string[] }> {
  const k: Known = { ...known, notes: [] };
  let r: Result;
  try {
    r = await (runners[call.name] as Runner<LookupName>)(ctx, call.args, k);
  } catch (e) {
    // A look-up the app refuses (a period it cannot use) is said, like a name that points nowhere; anything else is a real failure.
    if (!(e instanceof Unknown) && !(e instanceof AppError && e.status < 500)) throw e;
    r = nothing(title(call.name === "documents" ? "Text of uploaded documents" : call.name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())), e.message);
  }
  // Only the first rows are read and shown; the rest are counted as not listed, whichever look-up it is.
  const rows = r.rows.slice(0, MAX_ROWS);
  const passages = (r.passages ?? []).map((p, i) => ({ ...p, ref: `${letter}${i + 1}` }));
  return {
    lookup: {
      ...r,
      name: call.name,
      rows: rows.map(({ names: _names, ...row }, i) => ({ ...row, ref: `${letter}${i + 1}` })),
      more: r.more + (r.rows.length - rows.length),
      passages,
      note: [...k.notes, r.note].filter(Boolean).join(" ") || null,
    },
    names: [...rows.flatMap((row) => row.names ?? []), ...passages.flatMap((p) => [p.document, p.where]), ...typedIn(call.args)].filter((n): n is string => !!n),
  };
}
