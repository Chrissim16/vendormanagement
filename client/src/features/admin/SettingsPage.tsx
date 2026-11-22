import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatRate, parseRate, type Settings } from "../../../../shared/sow";
import { api, messageOf } from "../../lib/api";
import { FormFooter, TextField, useForm } from "../../platform/form";
import { History } from "../../platform/History";
import { ErrorState, Loading, PageHeader } from "../../platform/ui";
import { ContactRolesSection } from "../vendors/ContactRoles";

const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : NaN);

function Form({ settings }: { settings: Settings }) {
  const qc = useQueryClient();
  const start = {
    rate: formatRate(settings.gbpToEurE4),
    noticeDays: String(settings.noticeDays),
    sowEndDays: String(settings.sowEndDays),
    budgetWarningPct: String(settings.budgetWarningPct),
  };
  const form = useForm(
    start,
    (v) =>
      api<Settings>("/admin/settings", {
        method: "PUT",
        body: { gbpToEurE4: parseRate(v.rate), noticeDays: whole(v.noticeDays), sowEndDays: whole(v.sowEndDays), budgetWarningPct: whole(v.budgetWarningPct) },
      }),
    {
      onSaved: async () => {
        toast.success("Settings saved");
        await qc.invalidateQueries();
      },
      check: (v) => ({
        rate: parseRate(v.rate) == null ? "Enter a rate like 1.17, with at most four decimals." : "",
        noticeDays: Number.isNaN(whole(v.noticeDays)) ? "Enter a whole number of days." : "",
        sowEndDays: Number.isNaN(whole(v.sowEndDays)) ? "Enter a whole number of days." : "",
        budgetWarningPct: Number.isNaN(whole(v.budgetWarningPct)) ? "Enter a whole percentage." : "",
      }),
    },
  );
  const { values: v, set } = form;
  const shown = { errors: { ...form.errors, rate: form.errors.rate || form.errors.gbpToEurE4 || "" } };
  const rate = parseRate(v.rate);
  return (
    <form onSubmit={form.submit} noValidate className="flex max-w-[560px] flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">Exchange rate</h2>
          <p className="mt-1 text-ink-2">Used only to add pounds to euros in totals. Amounts keep their own currency, and no stored amount changes when the rate does.</p>
        </div>
        <TextField
          form={shown}
          name="rate"
          label="One pound in euros"
          inputMode="decimal"
          value={v.rate}
          onChange={(e) => set("rate", e.target.value, ["gbpToEurE4"])}
          hint={rate == null ? undefined : `£ 1,000.00 counts as € ${((1000 * rate) / 10000).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          className="max-w-[220px]"
        />
      </section>
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">When to warn</h2>
          <p className="mt-1 text-ink-2">These decide what appears under the bell and on the dashboard.</p>
        </div>
        <TextField
          form={shown}
          name="noticeDays"
          label="Warn this many days before a subscription's notice deadline"
          inputMode="numeric"
          value={v.noticeDays}
          onChange={(e) => set("noticeDays", e.target.value)}
          className="max-w-[220px]"
        />
        <TextField
          form={shown}
          name="sowEndDays"
          label="Warn this many days before a SOW ends"
          inputMode="numeric"
          value={v.sowEndDays}
          onChange={(e) => set("sowEndDays", e.target.value)}
          className="max-w-[220px]"
        />
        <TextField
          form={shown}
          name="budgetWarningPct"
          label="Warn when this percentage of a SOW's budget has been invoiced"
          inputMode="numeric"
          value={v.budgetWarningPct}
          onChange={(e) => set("budgetWarningPct", e.target.value)}
          className="max-w-[220px]"
        />
      </section>
      <div className="flex flex-col gap-5">
        <FormFooter problem={form.problem} busy={form.busy} submitLabel="Save settings" onCancel={() => form.patch(start)} />
      </div>
    </form>
  );
}

/** The exchange rate and the warning thresholds (M-7), and the list of contact roles (V-7). Admins only. */
export function SettingsPage() {
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings") });
  return (
    <>
      <PageHeader context="For the whole team" title="Settings" />
      {q.isPending ? (
        <Loading rows={3} />
      ) : q.isError ? (
        <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <Form key={JSON.stringify(q.data)} settings={q.data} />
      )}
      <div className="max-w-[560px]">
        <History entityType="settings" entityId="settings" limit={5} />
      </div>
      <div className="mt-12">
        <ContactRolesSection />
      </div>
    </>
  );
}
