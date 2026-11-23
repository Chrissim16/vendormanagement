import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { rfpStageLabels, type RfpDetail, type RfpStage } from "../../../../shared/rfp";
import { messageOf } from "../../lib/api";
import { Pill, type Tone } from "../../platform/ui";

const tones: Record<RfpStage, Tone> = { drafting: "brand", in_review: "brand", approved: "brand", issued: "brand", evaluating: "brand", decided: "ok", cancelled: "none" };
export const StagePill = ({ stage }: { stage: RfpStage }) => <Pill tone={tones[stage]}>{rfpStageLabels[stage]}</Pill>;

/** A link that looks like a button: for downloads, which the browser has to fetch itself. */
export const downloadClass =
  "inline-flex h-[38px] items-center rounded-full border border-line-2 px-[18px] text-[13.5px] font-semibold transition duration-200 hover:bg-sunk active:scale-[.96]";
export const primaryDownloadClass =
  "inline-flex h-[38px] items-center rounded-full bg-primary px-[18px] text-[13.5px] font-semibold text-primary-on transition duration-200 hover:-translate-y-px hover:shadow-[0_6px_18px_rgba(0,119,200,.3)] active:scale-[.96]";

/**
 * One change to an RFP. Every change answers with the RFP as it now stands, which replaces
 * what the page shows; lists and counts elsewhere are fetched again. A failure is shown as
 * a toast unless the caller shows it in place.
 */
/** Takes the RFP a change answered with as what the page now shows, and has lists and counts elsewhere fetched again. For forms that save by themselves. */
export function useAdoptRfp(id: string) {
  const qc = useQueryClient();
  return (rfp: RfpDetail, done?: string) => {
    qc.setQueryData(["rfp", id], rfp);
    if (done) toast.success(done);
    void qc.invalidateQueries({ predicate: (q) => !(q.queryKey[0] === "rfp" && q.queryKey[1] === id) });
  };
}

export function useRfpChange<V = void>(
  id: string,
  run: (v: V) => Promise<RfpDetail>,
  options: { done?: string | ((r: RfpDetail, v: V) => string); quiet?: boolean; after?: (r: RfpDetail, v: V) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (rfp, v) => {
      qc.setQueryData(["rfp", id], rfp);
      const done = typeof options.done === "function" ? options.done(rfp, v) : options.done;
      if (done) toast.success(done);
      options.after?.(rfp, v);
      // Not awaited: the RFP is already up to date, so its buttons work again at once while other lists refresh.
      void qc.invalidateQueries({ predicate: (q) => !(q.queryKey[0] === "rfp" && q.queryKey[1] === id) });
    },
    onError: async (e) => {
      if (!options.quiet) toast.error(messageOf(e));
      // Someone else may have changed the RFP in the meantime: show what is there now.
      await qc.invalidateQueries({ queryKey: ["rfp", id] });
    },
  });
}

/** Which of a few things is being looked at, remembered while the page is open. Falls back to the first when the chosen one is gone. */
export function useChoice<T extends { id: string }>(items: T[]): [T | undefined, (id: string) => void] {
  const [id, setId] = useState("");
  return [items.find((i) => i.id === id) ?? items[0], setId];
}

export const textareaClass = "min-w-0 rounded-2xl border border-line-2 bg-surface px-4 py-2.5 text-sm placeholder:text-ink-3 hover:border-ink-3";
export const kb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
