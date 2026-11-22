import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { toast } from "sonner";
import { addMonths, formatDay, isDay } from "../../../../shared/dates";
import { formatMoney, isMixed, moneyLine, type Money, type Rate } from "../../../../shared/money";
import type { Invoice, Spend } from "../../../../shared/sow";
import type { Page } from "../../../../shared/types";
import type { Vendor } from "../../../../shared/vendors";
import { api, messageOf, queryString } from "../../lib/api";
import { pageNumber, useUrlState } from "../../lib/useUrlState";
import { DataTable, Pager, type Column } from "../../platform/DataTable";
import { ConvertedNote, ConvertedTotal, EurWithOriginal } from "../../platform/Money";
import { useToday } from "../../platform/session";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, Select, TextInput } from "../../platform/ui";
import { InvoiceForm } from "./InvoiceForm";

function MoneyTabs() {
  const cls = ({ isActive }: { isActive: boolean }) =>
    `-mb-px border-b-2 py-2.5 font-medium transition-colors ${isActive ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink"}`;
  return (
    <nav aria-label="Money views" className="-mt-4 flex gap-6 border-b border-line">
      <NavLink to="/money" end className={cls}>
        Spend
      </NavLink>
      <NavLink to="/money/invoices" className={cls}>
        Invoices
      </NavLink>
    </nav>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
/** A round number at or above the largest bar, for the top of the scale. */
function ceiling(minor: number): number {
  if (minor <= 0) return 100_00;
  const unit = 10 ** Math.floor(Math.log10(minor));
  return [1, 2, 5, 10].map((s) => s * unit).find((s) => s >= minor)!;
}
const eur = (minor: number) => formatMoney(minor, "EUR");
/** A scale label: whole where it can be, one decimal where it cannot (€2.5k, never a rounded €3k). */
const short = (minor: number) => {
  const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  return minor >= 1_000_000_00 ? `€${n(minor / 1_000_000_00)}m` : minor >= 1_000_00 ? `€${n(minor / 1_000_00)}k` : `€${n(minor / 100)}`;
};

/** Spend per month and per vendor for a chosen period (M-6). */
export function SpendPage() {
  const today = useToday();
  const periods: Record<string, { label: string; from: string; to: string }> = {
    "12m": { label: "Last 12 months", from: addMonths(`${today.slice(0, 7)}-01`, -11), to: today },
    year: { label: "This year", from: `${today.slice(0, 4)}-01-01`, to: today },
    last: { label: "Last year", from: `${Number(today.slice(0, 4)) - 1}-01-01`, to: `${Number(today.slice(0, 4)) - 1}-12-31` },
  };
  const [url, setUrl] = useUrlState({ period: "12m", from: "", to: "" });
  const custom = url.period === "custom";
  const range = custom ? { from: url.from, to: url.to } : (periods[url.period] ?? periods["12m"]!);
  const ready = isDay(range.from) && isDay(range.to);
  const q = useQuery({
    queryKey: ["spend", range.from, range.to],
    queryFn: () => api<Spend>("/spend", { query: { from: range.from, to: range.to } }),
    enabled: ready && range.from <= range.to,
    placeholderData: (p) => p,
  });
  const s = q.data;
  const top = s ? ceiling(Math.max(...s.byMonth.map((m) => m.eurMinor), 0)) : 0;
  const mixed = !!s && isMixed(s.total.amounts);
  const widest = s ? Math.max(...s.byVendor.map((v) => v.eurMinor), 1) : 1;

  return (
    <>
      <PageHeader context={ready ? `${formatDay(range.from)} to ${formatDay(range.to)}` : "Choose both dates"} title="Spend">
        {ready && range.from <= range.to && (
          <a
            href={`/api/spend/export.csv?from=${range.from}&to=${range.to}`}
            download
            className="inline-flex h-[38px] items-center rounded-full border border-line-2 px-[18px] text-[13.5px] font-semibold transition hover:bg-sunk active:scale-[.96]"
          >
            Export CSV
          </a>
        )}
      </PageHeader>
      <MoneyTabs />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Period" htmlFor="spend-period">
          <Select
            id="spend-period"
            value={url.period}
            onChange={(e) => setUrl(e.target.value === "custom" ? { period: "custom", from: range.from, to: range.to } : { period: e.target.value, from: "", to: "" })}
          >
            {Object.entries(periods).map(([k, p]) => (
              <option key={k} value={k}>
                {p.label}
              </option>
            ))}
            <option value="custom">Other dates</option>
          </Select>
        </Field>
        {custom && (
          <>
            <Field label="From" htmlFor="spend-from">
              <TextInput id="spend-from" type="date" value={url.from} onChange={(e) => setUrl({ from: e.target.value })} />
            </Field>
            <Field label="To" htmlFor="spend-to">
              <TextInput id="spend-to" type="date" value={url.to} onChange={(e) => setUrl({ to: e.target.value })} />
            </Field>
          </>
        )}
      </div>

      {!ready ? null : range.from > range.to ? (
        <EmptyState title="The end of the period is before its start">Choose an end date on or after the start date.</EmptyState>
      ) : q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />
      ) : s!.byVendor.length === 0 ? (
        <EmptyState
          title="No invoices in this period"
          action={
            <Link to="/money/invoices" className="font-semibold text-accent-ink underline-offset-2 hover:underline">
              Go to invoices
            </Link>
          }
        >
          Spend is added up from the invoices keyed in against SOWs and subscriptions. Choose another period, or add the first invoice.
        </EmptyState>
      ) : (
        <>
          <dl aria-label="Totals" className="grid grid-cols-3 gap-4">
            <div className="col-span-2 rounded-tile bg-sunk px-7 py-6">
              <ConvertedTotal label="Invoiced" money={s!.total} rates={s!.rates} />
            </div>
            <div className="rounded-tile bg-sunk px-7 py-6">
              <dt className="text-[13.5px] font-medium text-ink-2">Vendors invoiced</dt>
              <dd className="num mt-2 text-[30px] font-semibold leading-tight tracking-[-0.03em]">{s!.byVendor.length}</dd>
              <dd className="mt-1 text-[12.5px] text-ink-2">{mixed ? `In ${Object.keys(s!.total.amounts).length} currencies` : "All in euros"}</dd>
            </div>
          </dl>

          <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-14">
            <section className="flex min-w-0 flex-col gap-4">
              <h2 className="text-base font-semibold">By month{mixed && <span className="font-normal text-ink-2"> · converted to euros</span>}</h2>
              <div
                role="img"
                aria-label={`Spend per month, ${monthLabel(s!.byMonth[0]!.month)} to ${monthLabel(s!.byMonth.at(-1)!.month)}. The table below lists the same figures.`}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3"
              >
                <div className="num flex h-[170px] flex-col justify-between text-right text-[11px] text-ink-2">
                  <span>{short(top)}</span>
                  <span>{short(top / 2)}</span>
                  <span>0</span>
                </div>
                <div className="flex h-[170px] items-end gap-1.5 border-b border-line-2 bg-[linear-gradient(var(--line),var(--line)),linear-gradient(var(--line),var(--line))] bg-[length:100%_1px,100%_1px] bg-[position:0_0,0_50%] bg-no-repeat">
                  {s!.byMonth.map((m, i) => (
                    <motion.div
                      key={m.month}
                      title={`${monthLabel(m.month)}: ${eur(m.eurMinor)}`}
                      className={`min-w-0 flex-1 origin-bottom rounded-t ${i === s!.byMonth.length - 1 ? "bg-accent" : "bg-[var(--bar)]"} transition-colors hover:bg-accent`}
                      style={{ height: `${(m.eurMinor / top) * 100}%` }}
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ type: "spring", stiffness: 260, damping: 20, delay: i * 0.028 }}
                    />
                  ))}
                </div>
                <span />
                <div className="flex gap-1.5 pt-2 text-[11px] text-ink-2">
                  {s!.byMonth.map((m) => (
                    <span key={m.month} className="min-w-0 flex-1 truncate text-center">
                      {s!.byMonth.length > 14 ? MONTHS[Number(m.month.slice(5)) - 1]![0] : MONTHS[Number(m.month.slice(5)) - 1]}
                    </span>
                  ))}
                </div>
              </div>
              <table aria-label="Spend per month" className="w-full border-collapse text-left">
                <thead>
                  <tr className="text-[12.5px] text-ink-3">
                    <th scope="col" className="py-2 font-medium">
                      Month
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      {mixed ? "In euros, converted" : "In euros"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s!.byMonth
                    .filter((m) => m.eurMinor > 0)
                    .reverse()
                    .map((m) => (
                      <tr key={m.month} className="border-t border-line">
                        <td className="py-2.5">{monthLabel(m.month)}</td>
                        <td className="py-2.5 text-right">
                          <EurWithOriginal money={m} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>

            <section className="flex min-w-0 flex-col gap-4">
              <h2 className="text-base font-semibold">By vendor</h2>
              {mixed && <p className="text-[12.5px] text-ink-2">Each figure in euros is rounded on its own, so a column can differ from the total by a cent.</p>}
              <ol aria-label="Spend per vendor" className="flex flex-col">
                {s!.byVendor.map((v) => (
                  <li key={v.vendorId} className="border-b border-line py-3.5">
                    <div className="flex items-baseline gap-3">
                      <Link
                        to={`/money/invoices?vendorId=${v.vendorId}&from=${range.from}&to=${range.to}`}
                        className="min-w-0 flex-1 truncate font-semibold underline-offset-2 hover:underline"
                      >
                        {v.vendorName}
                      </Link>
                      <span className="text-right">
                        <EurWithOriginal money={v} />
                      </span>
                    </div>
                    <div aria-hidden className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
                      <motion.div
                        className="h-full rounded-full bg-accent"
                        initial={{ width: 0 }}
                        animate={{ width: `${(v.eurMinor / widest) * 100}%` }}
                        transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </>
      )}
    </>
  );
}

type ListedInvoice = Invoice & { eurMinor: number };
const columns: Column<ListedInvoice>[] = [
  { key: "invoiceNumber", header: "Invoice", sort: "invoiceNumber", cell: (i) => i.invoiceNumber, className: "w-[16%]" },
  { key: "vendor", header: "Vendor", sort: "vendor", cell: (i) => <span className="text-ink-2">{i.vendorName}</span>, className: "w-[20%]" },
  {
    key: "agreement",
    header: "For",
    sort: "agreement",
    cell: (i) => (
      <Link to={`/agreements/${i.agreementId}`} className="relative z-10 text-accent-ink underline-offset-2 hover:underline">
        {i.agreementTitle}
        {i.milestoneTitle ? ` · ${i.milestoneTitle}` : ""}
      </Link>
    ),
  },
  { key: "invoiceDate", fit: true, header: "Date", sort: "invoiceDate", cell: (i) => <span className="text-ink-2">{formatDay(i.invoiceDate)}</span> },
  {
    key: "amount",
    fit: true,
    header: "Amount",
    sort: "amount",
    cell: (i) => <EurWithOriginal money={{ amounts: { [i.currency]: i.amountMinor }, eurMinor: i.eurMinor }} />,
    className: "text-right",
  },
];
const PAGE_SIZE = 25;

/** Every invoice keyed in, with search, filters, totals and export (M-4, M-6). */
export function InvoicesPage() {
  const qc = useQueryClient();
  const [url, setUrl] = useUrlState({ q: "", vendorId: "", from: "", to: "", sort: "invoiceDate", dir: "desc", page: "1" });
  const [search, setSearch] = useState(url.q);
  const [dialog, setDialog] = useState<null | "add" | Invoice>(null);
  useEffect(() => {
    const t = setTimeout(() => search !== url.q && setUrl({ q: search, page: "1" }), 250);
    return () => clearTimeout(t);
  }, [search, url.q, setUrl]);
  const page = pageNumber(url.page);
  const filters = { q: url.q, vendorId: url.vendorId, from: isDay(url.from) ? url.from : "", to: isDay(url.to) ? url.to : "", sort: url.sort, dir: url.dir };
  const list = useQuery({
    queryKey: ["invoices", filters, page],
    queryFn: () => api<Page<ListedInvoice> & { sums: Money; rates: Rate[] }>("/invoices", { query: { ...filters, page, pageSize: PAGE_SIZE } }),
    placeholderData: (p) => p,
  });
  const vendors = useQuery({ queryKey: ["vendors", "choices-all"], queryFn: () => api<Page<Vendor>>("/vendors", { query: { pageSize: 200, sort: "name", status: "all" } }) });
  const filtered = !!(url.q || url.vendorId || url.from || url.to);
  const d = list.data;
  const saved = async (message: string) => {
    setDialog(null);
    toast.success(message);
    await qc.invalidateQueries();
  };

  return (
    <>
      <PageHeader
        context={
          !d || list.isPlaceholderData
            ? " "
            : `${d.total} ${d.total === 1 ? "invoice" : "invoices"}${d.total ? `, ${formatMoney(d.sums.eurMinor, "EUR")}${isMixed(d.sums.amounts) ? ` in euros, converted (${moneyLine(d.sums.amounts)})` : ""}` : ""}`
        }
        title="Invoices"
      >
        <a
          href={`/api/invoices/export.csv${queryString(filters)}`}
          download
          className="inline-flex h-[38px] items-center rounded-full border border-line-2 px-[18px] text-[13.5px] font-semibold transition hover:bg-sunk active:scale-[.96]"
        >
          Export CSV
        </a>
        <Button variant="primary" onClick={() => setDialog("add")}>
          Add invoice
        </Button>
      </PageHeader>
      <MoneyTabs />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search" htmlFor="invoices-q">
          <TextInput id="invoices-q" type="search" placeholder="Number, vendor or description" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        </Field>
        <Field label="Vendor" htmlFor="invoices-vendor">
          <Select id="invoices-vendor" value={url.vendorId} onChange={(e) => setUrl({ vendorId: e.target.value, page: "1" })} className="max-w-[220px]">
            <option value="">Any vendor</option>
            {vendors.data?.items.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From" htmlFor="invoices-from">
          <TextInput id="invoices-from" type="date" value={url.from} onChange={(e) => setUrl({ from: e.target.value, page: "1" })} />
        </Field>
        <Field label="To" htmlFor="invoices-to">
          <TextInput id="invoices-to" type="date" value={url.to} onChange={(e) => setUrl({ to: e.target.value, page: "1" })} />
        </Field>
      </div>
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState message={messageOf(list.error)} onRetry={() => void list.refetch()} />
      ) : d!.items.length === 0 ? (
        <EmptyState
          title={filtered ? "No invoices match these filters" : "No invoices yet"}
          action={
            !filtered && (
              <Button variant="primary" onClick={() => setDialog("add")}>
                Add the first invoice
              </Button>
            )
          }
        >
          {filtered
            ? "Clear the search or widen the dates to see more."
            : "Key in each invoice against its SOW or subscription. Budgets, warnings and the spend overview are all worked out from these."}
        </EmptyState>
      ) : (
        <div>
          <DataTable
            label="Invoices"
            rows={d!.items}
            columns={columns}
            rowId={(i) => i.id}
            rowLabel={(i) => `invoice ${i.invoiceNumber}`}
            sort={url.sort}
            dir={url.dir}
            onSort={(sort, dir) => setUrl({ sort, dir, page: "1" })}
            onOpen={(i) => setDialog(i)}
          />
          <Pager page={page} pageSize={PAGE_SIZE} total={d!.total} onPage={(p) => setUrl({ page: String(p) })} />
          <ConvertedNote rates={d!.rates} />
        </div>
      )}
      {dialog === "add" && <InvoiceForm onClose={() => setDialog(null)} onSaved={(i) => saved(`Added invoice ${i.invoiceNumber}`)} />}
      {dialog && typeof dialog === "object" && <InvoiceForm invoice={dialog} onClose={() => setDialog(null)} onSaved={(i) => saved(`Saved invoice ${i.invoiceNumber}`)} />}
    </>
  );
}
