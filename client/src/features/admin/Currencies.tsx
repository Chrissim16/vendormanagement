import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useState } from "react";
import { toast } from "sonner";
import { formatDay } from "../../../../shared/dates";
import { ISO_CURRENCIES, isoCurrency } from "../../../../shared/iso-currencies";
import { EUR, formatMoney, formatRate, parseRate, type ListedCurrency } from "../../../../shared/money";
import { api, messageOf } from "../../lib/api";
import { personName, useCurrencies, usePeople } from "../../lib/data";
import { FormFooter, useForm } from "../../platform/form";
import { History } from "../../platform/History";
import { Button, ConfirmButton, ErrorState, Field, Loading, Pill, TextInput } from "../../platform/ui";

const RATE_HINT = "Enter a rate like 11.49, with at most four decimals.";
/** What is wrong with a typed rate, or "" when it can be saved. */
const rateProblem = (text: string) => (parseRate(text) != null ? "" : /^\s*\d{6,}/.test(text) ? "Use at most 99,999.9999." : RATE_HINT);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What still uses a currency, in words: "2 agreements and 1 rate card line", or "Not in use". */
function usesWords(u: ListedCurrency["uses"]) {
  const parts = [
    u.agreements && plural(u.agreements, "agreement", "agreements"),
    u.rateCardLines && plural(u.rateCardLines, "rate card line", "rate card lines"),
    u.rfps && plural(u.rfps, "RFP", "RFPs"),
  ].filter(Boolean);
  return parts.length ? `Used by ${parts.join(" and ")}` : "Not in use";
}

/** What a hundred euros comes to, so a rate typed the wrong way round shows at once. */
const example = (code: string, e4: number | null) => (e4 == null ? undefined : `€ 100.00 is ${formatMoney(Math.round((100_00 * e4) / 10000), code)}`);

/** One currency's row: its rate as "1 EUR = [   ] SEK", who set it, and removing it. */
function Row({ c }: { c: ListedCurrency }) {
  const qc = useQueryClient();
  const people = usePeople();
  const start = { rate: formatRate(c.unitsPerEurE4) };
  const form = useForm(start, (v) => api<ListedCurrency[]>(`/admin/currencies/${c.code}`, { method: "PUT", body: { unitsPerEurE4: parseRate(v.rate) } }), {
    check: (v) => ({ rate: rateProblem(v.rate) }),
    onSaved: async () => {
      toast.success(`Rate for ${c.code} saved`);
      await qc.invalidateQueries();
    },
  });
  const remove = useMutation({
    mutationFn: () => api<ListedCurrency[]>(`/admin/currencies/${c.code}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success(`Removed ${c.name} (${c.code})`);
      await qc.invalidateQueries();
    },
  });
  const id = `rate-${c.code}`;
  const error = form.errors.rate || form.errors.unitsPerEurE4;
  const typed = parseRate(form.values.rate);
  const who = c.rateSetBy && (people.data?.find((p) => p.email === c.rateSetBy) ? personName(people.data.find((p) => p.email === c.rateSetBy)!) : c.rateSetBy);
  const changed = form.values.rate !== start.rate;
  return (
    <li className="border-b border-line py-3.5">
      <form onSubmit={form.submit} noValidate className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="w-[170px] min-w-0 pt-[30px]">
          <span className="block font-semibold">{c.code}</span>
          <span className="block truncate text-[13px] text-ink-2">{c.name}</span>
        </div>
        <Field label={`Rate for ${c.code}`} htmlFor={id} error={error}>
          <div className="flex items-center gap-2">
            <span className="num whitespace-nowrap text-ink-2">1 EUR =</span>
            <TextInput
              id={id}
              inputMode="decimal"
              value={form.values.rate}
              onChange={(e) => form.set("rate", e.target.value, ["unitsPerEurE4"])}
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-error` : `${id}-note`}
              className={clsx("num w-[130px]", error && "border-crit")}
            />
            <span className="num text-ink-2">{c.code}</span>
          </div>
        </Field>
        <div className="flex items-center gap-2 pt-[26px]">
          <Button type="submit" className="h-8 px-3.5 text-[12.5px]" disabled={form.busy || (!changed && !c.starting)}>
            {c.starting && !changed ? "Confirm rate" : "Save rate"}
          </Button>
          <ConfirmButton className="h-8 px-3.5 text-[12.5px]" label={`Remove ${c.code}`} onConfirm={() => remove.mutate()} />
        </div>
        <p id={`${id}-note`} className="num w-full pl-[186px] text-[12.5px] text-ink-2">
          {c.starting ? (
            <Pill tone="warn">Starting rate, not yet set by an admin</Pill>
          ) : (
            `Set ${c.rateSetAt ? `on ${formatDay(c.rateSetAt.slice(0, 10))}` : ""}${who ? ` by ${who}` : ""}`
          )}
          {" · "}
          {usesWords(c.uses)}
          {typed != null && changed && ` · ${example(c.code, typed)}`}
        </p>
        {(form.problem && !error) || remove.error ? (
          <p role="alert" className="w-full pl-[186px] text-[12.5px] font-medium text-[var(--crit-text)]">
            {remove.error ? messageOf(remove.error) : form.problem}
          </p>
        ) : null}
      </form>
    </li>
  );
}

/** Adding a currency from the standard list, with its rate. */
function AddCurrency({ listed, onDone }: { listed: string[]; onDone: () => void }) {
  const qc = useQueryClient();
  const form = useForm(
    { code: "", rate: "" },
    (v) => api<ListedCurrency[]>("/admin/currencies", { method: "POST", body: { code: v.code.trim().toUpperCase(), unitsPerEurE4: parseRate(v.rate) } }),
    {
      check: (v) => ({ code: /^[A-Za-z]{3}$/.test(v.code.trim()) ? "" : "Enter the three-letter code, for example CHF.", rate: rateProblem(v.rate) }),
      onSaved: async () => {
        toast.success(`Added ${form.values.code.trim().toUpperCase()}`);
        onDone();
        await qc.invalidateQueries();
      },
    },
  );
  const code = form.values.code.trim().toUpperCase();
  const iso = isoCurrency(code);
  const rateError = form.errors.rate || form.errors.unitsPerEurE4;
  return (
    <form onSubmit={form.submit} noValidate className="flex flex-col gap-4 rounded-tile bg-sunk px-6 py-5">
      <div className="flex flex-wrap items-start gap-4">
        <Field label="Currency code" htmlFor="add-currency-code" error={form.errors.code}>
          <TextInput
            id="add-currency-code"
            list="iso-currencies"
            maxLength={3}
            autoComplete="off"
            value={form.values.code}
            onChange={(e) => form.set("code", e.target.value)}
            aria-invalid={!!form.errors.code}
            aria-describedby={form.errors.code ? "add-currency-code-error" : "add-currency-code-name"}
            className={clsx("w-[110px] uppercase", form.errors.code && "border-crit")}
            autoFocus
          />
          <datalist id="iso-currencies">
            {ISO_CURRENCIES.filter(([c]) => !listed.includes(c)).map(([c, name]) => (
              <option key={c} value={c}>
                {name}
              </option>
            ))}
          </datalist>
          {!form.errors.code && (
            <p id="add-currency-code-name" className="text-[12.5px] text-ink-2">
              {iso ? iso.name : "The three letters banks use"}
            </p>
          )}
        </Field>
        <Field label="Rate" htmlFor="add-currency-rate" error={rateError}>
          <div className="flex items-center gap-2">
            <span className="num whitespace-nowrap text-ink-2">1 EUR =</span>
            <TextInput
              id="add-currency-rate"
              inputMode="decimal"
              value={form.values.rate}
              onChange={(e) => form.set("rate", e.target.value, ["unitsPerEurE4"])}
              aria-invalid={!!rateError}
              aria-describedby={rateError ? "add-currency-rate-error" : undefined}
              className={clsx("num w-[130px]", rateError && "border-crit")}
            />
            <span className="num text-ink-2">{/^[A-Z]{3}$/.test(code) ? code : ""}</span>
          </div>
          {!rateError && parseRate(form.values.rate) != null && /^[A-Z]{3}$/.test(code) && (
            <p className="num text-[12.5px] text-ink-2">{example(code, parseRate(form.values.rate))}</p>
          )}
        </Field>
      </div>
      <FormFooter problem={form.problem} busy={form.busy} submitLabel="Add currency" onCancel={onDone} />
    </form>
  );
}

/**
 * Admin: the currencies amounts may be in, with their rates to the euro (M-8). The euro
 * is the main currency; every total across currencies is in euros, converted with these.
 */
export function CurrenciesSection() {
  const list = useCurrencies();
  const [adding, setAdding] = useState(false);
  const starting = list.data?.filter((c) => c.starting).length ?? 0;
  return (
    <section id="currencies" aria-labelledby="currencies-heading" className="flex max-w-[720px] flex-col gap-4">
      <div>
        <h2 id="currencies-heading" className="text-base font-semibold">
          Currencies and exchange rates
        </h2>
        <p className="mt-1 text-ink-2">
          The euro is the main currency: every total across currencies is shown in euros, converted with the rates below. Type each rate as 1 euro = so much of the other currency, the way banks
          publish it. A rate changes converted totals only; no amount that was keyed in changes.
        </p>
        {starting > 0 && (
          <p className="mt-2 flex items-center gap-2 text-[13.5px] font-medium">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
            {starting === 1 ? "One rate is still a rough starting rate, not yet set by an admin. Check it and save it." : `${starting} rates are still rough starting rates, not yet set by an admin. Check each one and save it.`}
          </p>
        )}
      </div>
      {list.isPending ? (
        <Loading rows={4} />
      ) : list.isError ? (
        <ErrorState message={messageOf(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <ul aria-label="Currencies" className="flex flex-col">
          {list.data.map((c) =>
            c.code === EUR ? (
              <li key={c.code} className="flex items-center gap-4 border-b border-line py-3.5">
                <div className="w-[170px] min-w-0">
                  <span className="block font-semibold">{c.code}</span>
                  <span className="block truncate text-[13px] text-ink-2">{c.name}</span>
                </div>
                <span className="text-ink-2">The main currency. Its rate is always 1.</span>
              </li>
            ) : (
              <Row key={`${c.code}-${c.unitsPerEurE4}-${c.rateSetAt}`} c={c} />
            ),
          )}
        </ul>
      )}
      {adding ? (
        <AddCurrency listed={list.data?.map((c) => c.code) ?? []} onDone={() => setAdding(false)} />
      ) : (
        <div>
          <Button onClick={() => setAdding(true)}>Add a currency</Button>
          <p className="mt-2 text-[12.5px] text-ink-2">Any standard currency with cents can be added. A currency in use cannot be removed.</p>
        </div>
      )}
      <History entityType="currencies" entityId="list" limit={5} />
    </section>
  );
}
