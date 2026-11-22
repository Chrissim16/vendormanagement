import clsx from "clsx";
import { useState } from "react";
import { toast } from "sonner";
import { applySuggestedEdit, remarkKindLabels, resolutionLabels, type ReviewerRemark, type ReviewRound } from "../../../../shared/review";
import { contentEditable, type RfpDetail } from "../../../../shared/rfp";
import { api, messageOf } from "../../lib/api";
import { personName, usePeople } from "../../lib/data";
import { formatDate, formatDateTime } from "../../lib/format";
import { Button, ConfirmButton, ErrorState, Pill, Select } from "../../platform/ui";
import { Nothing } from "../overview/parts";
import { downloadClass, FileButton, kb, useRfpChange } from "./parts";

/** Who did something, by name where the app knows the person. */
export function usePersonName() {
  const people = usePeople();
  return (email: string | null) => {
    const p = people.data?.find((x) => x.email === email);
    return p ? personName(p) : (email ?? "");
  };
}

/** Whether a suggested edit can be taken over into its section as the section is now, by the rule the server applies. */
export function takeOverProblem(rfp: RfpDetail, m: ReviewerRemark): string | null {
  if (m.kind !== "suggested_edit") return null;
  const s = rfp.sections.find((x) => x.id === m.sectionId);
  if (!s) return "Not placed in a section, so it cannot be taken over as it is.";
  const result = applySuggestedEdit(s.body, m);
  if (result.ok) return null;
  return result.why === "more_than_once"
    ? "These words stand more than once in the section, so the app cannot tell which to change. Make the change by hand."
    : "These words are no longer in the section as it is now. Make the change by hand.";
}

/**
 * Q-13: one comment or suggested edit from a reviewer's Word file, with what can be done
 * with it. A comment shows the words it was made on; a suggested edit what would go and
 * what would come. Once dealt with or set aside it says by whom and when.
 */
export function RemarkCard({
  rfp,
  remark: m,
  unsaved,
  onRewrite,
  showPlace,
}: {
  rfp: RfpDetail;
  remark: ReviewerRemark;
  /** The document has changes that are not saved; nothing that changes a section may happen now. */
  unsaved?: boolean;
  /** Asks the AI to rewrite the section for this remark (Q-12). */
  onRewrite?: (m: ReviewerRemark) => void;
  showPlace?: boolean;
}) {
  const name = usePersonName();
  const act = useRfpChange(rfp.id, (body: object) => api<RfpDetail>(`/rfp-remarks/${m.id}`, { body }), {
    done: (_r, v) =>
      ({ take_over: "Edit taken over into the section", by_hand: "Marked as dealt with", set_aside: "Set aside", reopen: "Open again", place: "Placed" })[
        (v as { action: string }).action
      ] ?? "Done",
  });
  const [section, setSection] = useState("");
  const editable = contentEditable(rfp.stage);
  const open = m.status === "open";
  const problem = open ? takeOverProblem(rfp, m) : null;
  const run = (body: object) => !act.isPending && act.mutate(body);
  const placed = rfp.sections.find((s) => s.id === m.sectionId);
  return (
    <li className={clsx("flex flex-col gap-2 rounded-2xl border px-4 py-3", open ? "border-line-2 bg-surface" : "border-line bg-sunk")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Pill tone={m.kind === "comment" ? "brand" : "warn"}>{remarkKindLabels[m.kind]}</Pill>
        <span className="font-semibold">{m.author}</span>
        <span className="text-[13px] text-ink-2">
          version {m.version}
          {showPlace && ` · ${placed ? `in ${placed.heading}` : `under "${m.foundUnder}" in the file, not placed`}`}
        </span>
        {!open && (
          <span className="ml-auto text-[13px] text-ink-2">
            {m.status === "set_aside" ? "Set aside" : `Dealt with${m.resolution ? `, ${resolutionLabels[m.resolution]}` : ""}`} by {name(m.resolvedBy)}
            {m.resolvedAt && (
              <>
                {" "}
                on <span className="num">{formatDate(m.resolvedAt.slice(0, 10))}</span>
              </>
            )}
          </span>
        )}
      </div>
      {m.kind === "comment" ? (
        <div className="flex flex-col gap-1">
          {m.anchorText && (
            <p className="text-[13px] text-ink-2">
              On: <q className="italic">{m.anchorText}</q>
            </p>
          )}
          <p className="whitespace-pre-line">{m.text || "(an empty comment)"}</p>
        </div>
      ) : (
        <p className="leading-relaxed">
          {m.beforeText && <span className="text-ink-2">…{m.beforeText}</span>}
          {m.removedText && (
            <del className="rounded-sm bg-[var(--crit-tint)] px-0.5 text-[var(--crit-text)]" aria-label={`removes: ${m.removedText}`}>
              {m.removedText}
            </del>
          )}
          {m.addedText && (
            <ins className="rounded-sm bg-[var(--ok-tint)] px-0.5 text-[var(--ok-text)] no-underline" aria-label={`adds: ${m.addedText}`}>
              {m.addedText}
            </ins>
          )}
          {m.afterText && <span className="text-ink-2">{m.afterText}…</span>}
        </p>
      )}
      {open && problem && m.sectionId && <p className="text-[13px] font-medium text-[var(--crit-text)]">{problem}</p>}
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          {open && !m.sectionId && (
            <>
              <Select
                aria-label={`Section for the ${remarkKindLabels[m.kind].toLowerCase()} by ${m.author}`}
                value={section}
                onChange={(e) => setSection(e.target.value)}
                className="w-56"
              >
                <option value="">Choose a section</option>
                {rfp.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.heading}
                  </option>
                ))}
              </Select>
              <Button onClick={() => (section ? run({ action: "place", sectionId: section }) : toast.error("Choose the section it belongs to."))}>Place in section</Button>
            </>
          )}
          {open && m.kind === "suggested_edit" && m.sectionId && !problem && (
            <Button
              variant="primary"
              disabled={unsaved}
              title={unsaved ? "Save or discard your changes to the document first." : undefined}
              onClick={() => run({ action: "take_over" })}
            >
              Take over this edit
            </Button>
          )}
          {open && m.sectionId && onRewrite && (
            <Button disabled={unsaved} title={unsaved ? "Save or discard your changes to the document first." : undefined} onClick={() => onRewrite(m)}>
              Ask the AI to rewrite for it
            </Button>
          )}
          {open && <Button onClick={() => run({ action: "by_hand" })}>Dealt with by hand</Button>}
          {open && <Button onClick={() => run({ action: "set_aside" })}>Set aside</Button>}
          {!open && <Button onClick={() => run({ action: "reopen" })}>Open again</Button>}
        </div>
      )}
    </li>
  );
}

/** Q-13: the open remarks next to the sections they are in, and those the app could not place. */
export function OpenRemarks({ rfp, onRewrite }: { rfp: RfpDetail; onRewrite?: (m: ReviewerRemark) => void }) {
  const open = rfp.review.remarks.filter((m) => m.status === "open");
  const done = rfp.review.remarks.length - open.length;
  if (!rfp.review.remarks.length)
    return (
      <Nothing>
        No remarks from reviewers yet. Upload the Word files they send back to their review round; their comments and tracked changes then appear here, next to the sections they
        are in.
      </Nothing>
    );
  const unplaced = open.filter((m) => !rfp.sections.some((s) => s.id === m.sectionId));
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="text-ink-2">
        {open.length ? `${open.length} open, ${done} dealt with or set aside.` : `All ${done} remarks are dealt with or set aside.`}
      </p>
      {rfp.sections.map((s) => {
        const mine = open.filter((m) => m.sectionId === s.id);
        if (!mine.length) return null;
        return (
          <div key={s.id} className="flex flex-col gap-2">
            <h3 className="font-semibold">{s.heading}</h3>
            <ul aria-label={`Open remarks on ${s.heading}`} className="flex flex-col gap-2">
              {mine.map((m) => (
                <RemarkCard key={m.id} rfp={rfp} remark={m} onRewrite={onRewrite} />
              ))}
            </ul>
          </div>
        );
      })}
      {unplaced.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">Not placed</h3>
          <p className="-mt-1 text-[13px] text-ink-2">
            These stand outside the sections (the demand, the criteria, the questions) or under a heading that is not a section now. Put each in a section, deal with it, or set it
            aside.
          </p>
          <ul aria-label="Remarks not placed" className="flex flex-col gap-2">
            {unplaced.map((m) => (
              <RemarkCard key={m.id} rfp={rfp} remark={m} showPlace />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RoundCard({ rfp, round }: { rfp: RfpDetail; round: ReviewRound }) {
  const name = usePersonName();
  const [problem, setProblem] = useState<string | null>(null);
  const upload = useRfpChange(
    rfp.id,
    async (file: File) => {
      const r = await api<{ rfp: RfpDetail; version: number; otherVersion: boolean; read: { comments: number; edits: number; notPlaced: number; reviewers: string[] } }>(
        `/rfp-review-rounds/${round.id}/files`,
        { method: "POST", file },
      );
      const said = `${r.read.comments} ${r.read.comments === 1 ? "comment" : "comments"} and ${r.read.edits} suggested ${r.read.edits === 1 ? "edit" : "edits"} read${r.read.reviewers.length ? ` from ${r.read.reviewers.join(", ")}` : ""}.${r.read.notPlaced ? ` ${r.read.notPlaced} could not be placed in a section.` : ""}`;
      toast.success(r.otherVersion ? `That file is a copy of version ${r.version}, so it was added to version ${r.version}'s round. ${said}` : said, { duration: 8000 });
      return r.rfp;
    },
    { quiet: true, after: () => setProblem(null) },
  );
  const remove = useRfpChange(rfp.id, (fileId: string) => api<RfpDetail>(`/rfp-review-files/${fileId}`, { method: "DELETE" }), { done: "File removed with its remarks" });
  const mine = rfp.review.remarks.filter((m) => m.version === round.version);
  const editable = contentEditable(rfp.stage);
  return (
    <li className="flex flex-col gap-3 border-b border-line py-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Version {round.version}</span>
          <span className="block text-[13px] text-ink-2">
            Review copy made on <span className="num">{formatDateTime(round.madeAt)}</span> by {name(round.madeBy)}
          </span>
        </span>
        <a href={`/api/rfp-review-rounds/${round.id}/review-copy.docx`} download className={downloadClass}>
          Download version {round.version}
        </a>
        {editable && (
          <FileButton
            label="Upload a returned file"
            chooserLabel={`Choose a returned Word file for version ${round.version}`}
            accept={["docx"]}
            wrongType="Choose the Word file the reviewer sent back (.docx)."
            busy={upload.isPending}
            onFile={(f) =>
              upload.mutate(f, {
                onError: (e) => setProblem(messageOf(e)),
              })
            }
            onProblem={setProblem}
          />
        )}
      </div>
      {problem && <ErrorState message={problem} />}
      {round.files.length > 0 && (
        <ul aria-label={`Files returned for version ${round.version}`} className="flex flex-col gap-1.5">
          {round.files.map((f) => {
            const remarks = mine.filter((m) => m.fileId === f.id);
            const reviewers = [...new Set(remarks.map((m) => m.author))];
            return (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-sunk px-4 py-2 text-[13.5px]">
                <a href={`/api/rfp-review-files/${f.id}/file.docx`} download className="font-medium text-accent-ink underline">
                  {f.fileName}
                </a>
                <span className="text-ink-2">
                  {kb(f.sizeBytes)} · {remarks.filter((m) => m.kind === "comment").length} comments, {remarks.filter((m) => m.kind === "suggested_edit").length} suggested edits
                  {reviewers.length ? ` by ${reviewers.join(", ")}` : ""} · uploaded by {name(f.uploadedBy)} on <span className="num">{formatDate(f.uploadedAt.slice(0, 10))}</span>
                </span>
                {editable && (
                  <span className="ml-auto">
                    <ConfirmButton label={`Remove ${f.fileName}`} onConfirm={() => remove.mutate(f.id)} disabled={remove.isPending} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {mine.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[13.5px] font-medium text-accent-ink">
            All remarks of version {round.version} ({mine.length}) and what was done with each
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {mine.map((m) => (
              <RemarkCard key={m.id} rfp={rfp} remark={m} showPlace />
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/** Q-13: the review copy to download, and the rounds with the files reviewers sent back. */
export function ReviewRounds({ rfp }: { rfp: RfpDetail }) {
  const latest = rfp.review.rounds[0];
  const make = useRfpChange(
    rfp.id,
    async () => {
      const r = await api<{ rfp: RfpDetail; roundId: string; made: boolean }>(`/rfps/${rfp.id}/review-rounds`, { method: "POST" });
      // The browser fetches the file itself, as for any download.
      const a = document.createElement("a");
      a.href = `/api/rfp-review-rounds/${r.roundId}/review-copy.docx`;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return r.rfp;
    },
    {
      done: (r) => {
        const v = r.review.rounds[0]!.version;
        return latest && latest.version === v ? `Nothing changed since version ${v}: that copy is downloaded again.` : `Version ${v} made: its review copy is downloading.`;
      },
    },
  );
  const open = rfp.stage !== "decided" && rfp.stage !== "cancelled";
  return (
    <div className="flex flex-col gap-4">
      {open && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl bg-sunk px-5 py-4">
          <p className="min-w-0 flex-1 text-ink-2">
            The review copy is a Word file in the company template, with the demand, the sections, the criteria with their weights and the questions as last saved. Reviewers
            comment and suggest edits in Word with tracked changes, and send it back.{" "}
            {latest
              ? `Downloading after a change starts version ${latest.version + 1}; without a change it gives version ${latest.version} again.`
              : "The first download is version 1."}
          </p>
          <Button variant="primary" onClick={() => !make.isPending && make.mutate()} aria-disabled={make.isPending || undefined}>
            {make.isPending ? "Making the copy" : "Download the review copy"}
          </Button>
        </div>
      )}
      {rfp.review.rounds.length === 0 ? (
        <Nothing>No review round yet. Each download of the review copy that holds changes starts one, with the next version number.</Nothing>
      ) : (
        <ul aria-label="Review rounds" className="flex flex-col">
          {rfp.review.rounds.map((r) => (
            <RoundCard key={r.id} rfp={rfp} round={r} />
          ))}
        </ul>
      )}
    </div>
  );
}
