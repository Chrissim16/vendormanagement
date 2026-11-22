import { diffArrays } from "diff";
import { useEffect, useMemo, useRef, useState } from "react";
import { remarkKindLabels, type ReviewerRemark } from "../../../../shared/review";
import { normalise, parseBlocks } from "../../../../shared/richtext";
import type { RfpDetail, RfpSection } from "../../../../shared/rfp";
import { suggestionStatusLabels } from "../../../../shared/scorecards";
import { api, messageOf } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { RichText, wordsOf } from "../../platform/RichText";
import { RichTextEditor } from "../../platform/RichTextEditor";
import { Button, ErrorState, Pill } from "../../platform/ui";
import { AiLabel } from "../scorecards/parts";
import { textareaClass, useRfpChange } from "./parts";
import { usePersonName } from "./Remarks";

/** Which words of the current text the rewrite removes, and which of its words are new, by their place in reading order. */
export function differences(before: string | null, after: string) {
  const a = wordsOf(parseBlocks(before));
  const b = wordsOf(parseBlocks(after));
  const removed = new Set<number>();
  const added = new Set<number>();
  let i = 0;
  let j = 0;
  for (const part of diffArrays(a, b)) {
    const n = part.count ?? part.value.length;
    for (let k = 0; k < n; k++) {
      if (part.removed) removed.add(i++);
      else if (part.added) added.add(j++);
      else {
        i++;
        j++;
      }
    }
  }
  return { removed, added };
}

const remarkLine = (m: ReviewerRemark) =>
  m.kind === "comment"
    ? `${m.author}: ${m.text ?? ""}${m.anchorText ? ` (on "${m.anchorText}")` : ""}`
    : `${m.author}: ${m.removedText ? `"${m.removedText}"` : "nothing"} becomes ${m.addedText ? `"${m.addedText}"` : "nothing"}`;

function AskForm({ rfp, section, chosen, onClose }: { rfp: RfpDetail; section: RfpSection; chosen: string[]; onClose: () => void }) {
  const remarks = rfp.review.remarks.filter((m) => m.status === "open" && m.sectionId === section.id);
  const [instruction, setInstruction] = useState("");
  const [picked, setPicked] = useState<string[]>(chosen.filter((id) => remarks.some((m) => m.id === id)));
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => box.current?.focus(), []);
  const ask = useRfpChange(rfp.id, () => api<RfpDetail>(`/rfp-sections/${section.id}/rewrite`, { body: { instruction, remarkIds: picked } }), {
    quiet: true,
    done: "The AI's rewrite is next to the section. Nothing has changed yet.",
    after: onClose,
  });
  const go = () => {
    if (!instruction.trim() && !picked.length) return setProblem("Say what to change, or choose a reviewer's remark to rewrite for.");
    if (!ask.isPending) ask.mutate(undefined, { onError: (e) => setProblem(messageOf(e)) });
  };
  const id = `rewrite-${section.id}`;
  return (
    <div role="group" aria-label={`Ask the AI to rewrite ${section.heading}`} className="flex flex-col gap-3 rounded-2xl bg-sunk px-5 py-4">
      <label htmlFor={id} className="font-semibold">
        What should change in this section?
      </label>
      <textarea
        id={id}
        ref={box}
        rows={2}
        maxLength={1000}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="For example: shorter, more formal, or turn the requirements into a list"
        className={textareaClass}
      />
      {remarks.length > 0 && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[13.5px] font-semibold">And for these reviewers&apos; remarks</legend>
          {remarks.map((m) => (
            <label key={m.id} className="flex items-start gap-2 text-[13.5px]">
              <input
                type="checkbox"
                className="mt-1"
                checked={picked.includes(m.id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, m.id] : p.filter((x) => x !== m.id)))}
              />
              <span>
                <span className="font-medium">{remarkKindLabels[m.kind]}</span> by {remarkLine(m)}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <p className="text-[13px] text-ink-2">
        The AI writes a new version of this section only. It is shown next to the text as it is now and changes nothing until you use it. The budget and the sponsor are not passed
        to it.
      </p>
      {problem && <ErrorState message={problem} />}
      <div className="flex flex-wrap gap-2.5">
        <Button variant="primary" onClick={go} aria-disabled={ask.isPending || undefined}>
          {ask.isPending ? "The AI is writing" : "Ask the AI"}
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

/**
 * Q-12: the AI's rewrite of one section, next to it. While nobody has looked at it, it is
 * shown beside the current text with the differences marked; it is used as it is, edited
 * first, or rejected. Afterwards one quiet line says what was done.
 */
export function SectionRewrite({
  rfp,
  section,
  unsaved,
  asking,
  onAsking,
}: {
  rfp: RfpDetail;
  section: RfpSection;
  unsaved: boolean;
  /** The remarks to rewrite for when the form was opened from a remark, or null when it is closed. */
  asking: string[] | null;
  onAsking: (remarkIds: string[] | null) => void;
}) {
  const rw = section.rewrite;
  const name = usePersonName();
  const [editing, setEditing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const review = useRfpChange(
    rfp.id,
    (v: { action: "accept" | "reject"; body?: string }) => api<RfpDetail>(`/rfp-sections/${section.id}/rewrite/review`, { body: { ...v, suggestionId: rw!.id } }),
    {
      quiet: true,
      done: (_r, v) =>
        v.action === "reject"
          ? "AI rewrite rejected"
          : v.body !== undefined
            ? "Your edited version of the rewrite is now the section's text"
            : "The rewrite is now the section's text",
      after: () => (setEditing(null), setProblem(null)),
    },
  );
  const diff = useMemo(() => (rw && rw.status === "proposed" ? differences(section.body, rw.output.body) : null), [rw, section.body]);
  const run = (v: { action: "accept" | "reject"; body?: string }) => !review.isPending && review.mutate(v, { onError: (e) => setProblem(messageOf(e)) });
  const remarks = rw ? rfp.review.remarks.filter((m) => rw.remarkIds.includes(m.id)) : [];
  const forWhat = rw
    ? [
        rw.instruction && `"${rw.instruction}"`,
        remarks.length && `${remarks.length === 1 ? "a remark" : `${remarks.length} remarks`} by ${[...new Set(remarks.map((m) => m.author))].join(", ")}`,
      ]
        .filter(Boolean)
        .join(" and ")
    : "";

  if (asking) return <AskForm rfp={rfp} section={section} chosen={asking} onClose={() => onAsking(null)} />;
  if (!rw || rw.status !== "proposed")
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button onClick={() => onAsking([])} disabled={unsaved || !section.body} title={unsaved ? "Save or discard your changes to the document first." : undefined}>
          Rewrite with AI
        </Button>
        {rw && (
          <p className="text-[13px] text-ink-2">
            AI rewrite of {formatDateTime(rw.createdAt)}: {suggestionStatusLabels[rw.status].toLowerCase()}
            {rw.reviewedBy && rw.reviewedBy !== "system" ? ` by ${name(rw.reviewedBy)}` : ""}.
          </p>
        )}
      </div>
    );
  return (
    <section aria-label={`AI rewrite of ${section.heading}`} className="flex flex-col gap-4 rounded-2xl bg-tint px-5 py-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <AiLabel>AI rewrite</AiLabel>
        <p className="min-w-0 flex-1 text-[13px] text-ink-2">
          Written by the AI on {formatDateTime(rw.createdAt)}
          {forWhat ? ` for ${forWhat}` : ""}. <span className="font-semibold text-ink">Not reviewed yet.</span>
        </p>
        <Pill tone="none">{suggestionStatusLabels[rw.status]}</Pill>
      </div>
      {rw.outdated && (
        <p className="font-medium text-[var(--crit-text)]">The section was changed after the AI rewrote it, so using this would undo that change. Reject it, or ask again.</p>
      )}
      {editing !== null ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13.5px] font-semibold">Edit the rewrite before using it</p>
          <RichTextEditor label={`Edited rewrite of ${section.heading}`} value={editing} onChange={setEditing} />
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h4 className="text-[13px] font-semibold text-ink-2">Now</h4>
            <div className="rounded-xl bg-surface px-4 py-3">
              {section.body ? <RichText blocks={parseBlocks(section.body)} marked={diff?.removed} mark="removed" /> : <p className="text-ink-2">Not written.</p>}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <h4 className="text-[13px] font-semibold text-ink-2">AI rewrite</h4>
            <div className="rounded-xl bg-surface px-4 py-3">
              <RichText blocks={parseBlocks(rw.output.body)} marked={diff?.added} mark="added" />
            </div>
          </div>
        </div>
      )}
      {editing === null && diff && (
        <p className="text-[13px] text-ink-2">
          {!diff.removed.size && !diff.added.size
            ? normalise(section.body) === normalise(rw.output.body)
              ? "The rewrite is the same as the text now."
              : "The words are the same; only the formatting differs (lists, headings, bold or italic)."
            : "Struck through in red: words the rewrite takes out. Marked in green: words it adds. Changes in formatting alone are not marked."}
        </p>
      )}
      {problem && <ErrorState message={problem} />}
      {unsaved && <p className="text-[13px] text-ink-2">Save or discard your changes to the document before using the rewrite.</p>}
      <div className="flex flex-wrap items-center gap-2.5">
        {editing === null ? (
          <>
            <Button variant="primary" disabled={unsaved || rw.outdated} onClick={() => run({ action: "accept" })}>
              Use this text
            </Button>
            <Button disabled={unsaved || rw.outdated} onClick={() => setEditing(rw.output.body)}>
              Edit before using
            </Button>
            <Button onClick={() => run({ action: "reject" })}>Reject</Button>
            <Button disabled={unsaved} onClick={() => onAsking(rw.remarkIds)}>
              Ask again
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" disabled={unsaved} onClick={() => run({ action: "accept", body: editing })}>
              Use the edited text
            </Button>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
          </>
        )}
        <p className="min-w-0 flex-1 text-[13px] text-ink-2">
          {remarks.length
            ? `Using it replaces the section's text and marks the ${remarks.length === 1 ? "remark" : `${remarks.length} remarks`} as dealt with.`
            : "Using it replaces the section's text."}
        </p>
      </div>
    </section>
  );
}
