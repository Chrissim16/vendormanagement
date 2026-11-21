import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { AgreementDetail } from "../../../../shared/agreements";
import { formatDay } from "../../../../shared/dates";
import { formatMoney } from "../../../../shared/money";
import type { Invoice } from "../../../../shared/sow";
import type { Page } from "../../../../shared/types";
import { api, messageOf } from "../../lib/api";
import { Button, ErrorState, Loading } from "../../platform/ui";
import { InvoiceForm } from "./InvoiceForm";

/** The invoices booked against one SOW or subscription, on that agreement's page. */
export function InvoicesSection({ agreement: a }: { agreement: AgreementDetail }) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<null | "add" | Invoice>(null);
  const q = useQuery({ queryKey: ["invoices", { agreementId: a.id }], queryFn: () => api<Page<Invoice>>("/invoices", { query: { agreementId: a.id, pageSize: 200 } }) });
  const remove = useMutation({
    mutationFn: (i: Invoice) => api(`/invoices/${i.id}`, { method: "DELETE" }),
    onSuccess: async (_r, i) => {
      toast.success(`Removed invoice ${i.invoiceNumber}`);
      await qc.invalidateQueries();
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const saved = async (message: string) => {
    setDialog(null);
    toast.success(message);
    await qc.invalidateQueries();
  };
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="flex-1 text-base font-semibold">Invoices</h2>
        <Button onClick={() => setDialog("add")}>Add invoice</Button>
      </div>
      {q.isPending ? (
        <Loading rows={2} />
      ) : q.isError ? (
        <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <p className="text-ink-2">No invoices yet. Key in each invoice as it arrives, and the {a.kind === "sow" ? "budget above" : "total"} keeps itself up to date.</p>
      ) : (
        <ul aria-label="Invoices" className="flex flex-col">
          {q.data.items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 border-b border-line py-3.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{i.invoiceNumber}</span>
                <span className="num block truncate text-[13px] text-ink-2">{[formatDay(i.invoiceDate), i.milestoneTitle, i.description].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="num font-medium">{formatMoney(i.amountMinor, i.currency)}</span>
              <Button className="h-8 px-3.5 text-[12.5px]" onClick={() => setDialog(i)} aria-label={`Edit invoice ${i.invoiceNumber}`}>
                Edit
              </Button>
              <Button className="h-8 px-3.5 text-[12.5px]" onClick={() => remove.mutate(i)} aria-label={`Remove invoice ${i.invoiceNumber}`}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {dialog === "add" && <InvoiceForm agreement={a} onClose={() => setDialog(null)} onSaved={(i) => saved(`Added invoice ${i.invoiceNumber}`)} />}
      {dialog && typeof dialog === "object" && (
        <InvoiceForm invoice={dialog} agreement={a} onClose={() => setDialog(null)} onSaved={(i) => saved(`Saved invoice ${i.invoiceNumber}`)} />
      )}
    </section>
  );
}
