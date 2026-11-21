import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useEffect, useState, type MutableRefObject } from "react";
import { contentEditable, contentLocked, contentProblems, partLabels, parts, reviewBlockers, rfpContentSchema, type Part, type RfpDetail } from "../../../../shared/rfp";
import { api, ApiError, messageOf } from "../../lib/api";
import { burst } from "../../lib/burst";
import { Button, ErrorState, IconButton, Select, TextInput } from "../../platform/ui";
import { AiTextPanel, Nothing, Section } from "../overview/parts";
import { textareaClass, useRfpChange } from "./parts";

interface Editing {
  sections: { heading: string; body: string }[];
  criteria: { key: string; name: string; weight: string; part: Part }[];
  questions: { text: string; criterionKey: string }[];
}
/** Unsaved changes to the document, held by the RFP's page so that they outlive this tab. */
export type Kept = MutableRefObject<{ v: Editing; base: string } | null>;
const editingOf = (r: RfpDetail): Editing => ({
  sections: r.sections.map((s) => ({ heading: s.heading, body: s.body ?? "" })),
  criteria: r.criteria.map((c) => ({ key: c.id, name: c.name, weight: String(c.weight), part: c.part })),
  questions: r.questions.map((q) => ({ text: q.text, criterionKey: q.criterionId })),
});
const move = <T,>(list: T[], i: number, by: number) => {
  const next = [...list];
  const [item] = next.splice(i, 1);
  next.splice(i + by, 0, item!);
  return next;
};
const Problem = ({ id, children }: { id?: string; children?: string }) =>
  children ? (
    <p id={id} className="text-[12.5px] font-medium text-[var(--crit-text)]">
      {children}
    </p>
  ) : null;

/** The document as it reads, for when it can no longer be changed. */
function ReadOnly({ rfp }: { rfp: RfpDetail }) {
  return (
    <>
      <Section title="Sections">
        {rfp.sections.map((s) => (
          <div key={s.id} className="border-b border-line py-4">
            <h3 className="font-semibold">{s.heading}</h3>
            <p className="mt-1 max-w-[78ch] whitespace-pre-line text-ink-2">{s.body ?? "Not written."}</p>
          </div>
        ))}
      </Section>
      <Section title="Criteria and weights">
        <div className="grid grid-cols-2 gap-10">
          {parts.map((part) => (
            <div key={part}>
              <h3 className="font-semibold">
                {partLabels[part]} · {part === "written" ? rfp.writtenWeight : rfp.demoWeight}% of the overall score
              </h3>
              <ul aria-label={`Criteria for ${partLabels[part].toLowerCase()}`} className="mt-2 flex flex-col">
                {rfp.criteria
                  .filter((c) => c.part === part)
                  .map((c) => (
                    <li key={c.id} className="flex border-b border-line py-2.5">
                      <span className="flex-1">{c.name}</span>
                      <span className="num font-semibold">{c.weight}%</span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Questions">
        <ol aria-label="Questions" className="flex flex-col">
          {rfp.questions.map((q) => (
            <li key={q.id} className="flex gap-4 border-b border-line py-3">
              <span className="num w-7 shrink-0 font-semibold">{q.number}</span>
              <span className="min-w-0 flex-1">{q.text}</span>
              <span className="w-48 shrink-0 text-right text-[13px] text-ink-2">{rfp.criteria.find((c) => c.id === q.criterionId)?.name}</span>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}

/** Sections, criteria and questions in one form with one Save (Q-2). Nothing typed is lost when saving fails (X-3). */
function Editor({ rfp, onDirty, keep }: { rfp: RfpDetail; onDirty: (dirty: boolean) => void; keep: Kept }) {
  const saved = editingOf(rfp);
  // What was typed and not saved survives a look at another tab: the page keeps it while this form is away.
  const [v, setV] = useState<Editing>(() => keep.current?.v ?? saved);
  // When the saved document changes underneath (a colleague saved), follow it, unless something typed here would be lost.
  const savedJson = JSON.stringify(saved);
  const [base, setBase] = useState(() => keep.current?.base ?? savedJson);
  const [overtaken, setOvertaken] = useState(false);
  useEffect(() => {
    if (savedJson === base) return;
    if (JSON.stringify(v) === base) setV(saved);
    else setOvertaken(true);
    setBase(savedJson);
  }, [savedJson]); // eslint-disable-line react-hooks/exhaustive-deps
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);
  // The page above needs to know, so that it never replaces the document while something typed here is unsaved.
  useEffect(() => onDirty(dirty), [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    keep.current = dirty ? { v, base } : null;
  }, [v, base, dirty, keep]);
  // Closing or reloading the window with unsaved text asks first, the way browsers do.
  useEffect(() => {
    if (!dirty) return;
    const ask = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [dirty]);
  const save = useRfpChange(
    rfp.id,
    () => {
      const body = { sections: v.sections, criteria: v.criteria.map((c) => ({ ...c, weight: /^\d+$/.test(c.weight.trim()) ? Number(c.weight) : NaN })), questions: v.questions };
      // The same rules the server applies, checked first so nothing is sent only to be refused.
      const found: Record<string, string> = {};
      const parsed = rfpContentSchema.safeParse(body);
      if (!parsed.success)
        for (const issue of parsed.error.issues)
          found[issue.path.join(".")] ??= /^(Invalid|Too|Unrecognized)/.test(issue.message) ? "Enter a whole number from 1 to 100." : issue.message;
      else Object.assign(found, contentProblems(parsed.data));
      if (Object.keys(found).length) throw new ApiError(400, "invalid", "Some of what was entered is not valid. The problems are marked above.", found);
      return api<RfpDetail>(`/rfps/${rfp.id}/content`, { method: "PUT", body });
    },
    {
      quiet: true,
      done: "Document saved",
      after: (next) => {
        setErrors({});
        setProblem(null);
        setOvertaken(false);
        setBase(JSON.stringify(editingOf(next)));
        setV(editingOf(next));
      },
    },
  );
  const submit = () => {
    if (save.isPending || !dirty) return;
    save.mutate(undefined, {
      onError: (e) => {
        setErrors(e instanceof ApiError ? (e.fields ?? {}) : {});
        setProblem(messageOf(e));
      },
    });
  };
  const set = (patch: Partial<Editing>) => setV((x) => ({ ...x, ...patch }));
  const invalid = (key: string) => (errors[key] ? { "aria-invalid": true as const, "aria-describedby": `p-${key}` } : {});
  const written = v.criteria.filter((c) => c.part === "written");
  const newKey = () => `new-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const stage = useRfpChange(rfp.id, () => api<RfpDetail>(`/rfps/${rfp.id}/stage`, { body: { to: "in_review" } }), {
    done: "Sent for review. Record the reviewers' sign-offs on the Review tab.",
  });
  const blockers = reviewBlockers(rfp);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-10"
    >
      <Section title="Sections">
        {v.sections.length === 0 && <Nothing>No sections yet. A section is a heading with the text under it, such as the introduction or how to respond.</Nothing>}
        <ol aria-label="Sections" className="flex flex-col">
          {v.sections.map((s, i) => (
            <li key={i} className="flex gap-3 border-b border-line py-4">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <TextInput
                  aria-label={`Heading of section ${i + 1}`}
                  value={s.heading}
                  maxLength={200}
                  placeholder="Heading"
                  {...invalid(`sections.${i}.heading`)}
                  onChange={(e) => set({ sections: v.sections.map((x, n) => (n === i ? { ...x, heading: e.target.value } : x)) })}
                  className="font-semibold"
                />
                <Problem id={`p-sections.${i}.heading`}>{errors[`sections.${i}.heading`]}</Problem>
                <textarea
                  aria-label={`Text of section ${i + 1}`}
                  rows={Math.min(10, Math.max(3, Math.ceil(s.body.length / 110)))}
                  value={s.body}
                  maxLength={10000}
                  placeholder="The text of this section"
                  {...invalid(`sections.${i}.body`)}
                  onChange={(e) => set({ sections: v.sections.map((x, n) => (n === i ? { ...x, body: e.target.value } : x)) })}
                  className={textareaClass}
                />
                <Problem id={`p-sections.${i}.body`}>{errors[`sections.${i}.body`]}</Problem>
              </div>
              <div className="flex flex-col">
                <IconButton
                  type="button"
                  label={`Move section ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => set({ sections: move(v.sections, i, -1) })}
                  className="disabled:opacity-30"
                >
                  <ArrowUp size={16} aria-hidden />
                </IconButton>
                <IconButton
                  type="button"
                  label={`Move section ${i + 1} down`}
                  disabled={i === v.sections.length - 1}
                  onClick={() => set({ sections: move(v.sections, i, 1) })}
                  className="disabled:opacity-30"
                >
                  <ArrowDown size={16} aria-hidden />
                </IconButton>
                <IconButton type="button" label={`Remove section ${i + 1}`} onClick={() => set({ sections: v.sections.filter((_, n) => n !== i) })}>
                  <X size={16} aria-hidden />
                </IconButton>
              </div>
            </li>
          ))}
        </ol>
        <div>
          <Button type="button" onClick={() => set({ sections: [...v.sections, { heading: "", body: "" }] })}>
            Add section
          </Button>
        </div>
      </Section>

      <Section title="Criteria and weights">
        <p className="-mt-1 max-w-[78ch] text-[13.5px] text-ink-2">
          Candidates are scored from 1 to 5 on each criterion. The weights within each part add up to 100. Written answers count for {rfp.writtenWeight}% of the overall score and
          demo and interview for {rfp.demoWeight}%; those two are set in the demand.
        </p>
        <div className="grid grid-cols-2 gap-10">
          {parts.map((part) => {
            const mine = v.criteria.map((c, i) => ({ c, i })).filter((x) => x.c.part === part);
            const sum = mine.reduce((n, x) => n + (/^\d+$/.test(x.c.weight.trim()) ? Number(x.c.weight) : 0), 0);
            return (
              <div key={part} role="group" aria-label={partLabels[part]} className="flex min-w-0 flex-col gap-2">
                <h3 className="font-semibold">{partLabels[part]}</h3>
                {mine.length === 0 && (
                  <p className="text-[13.5px] text-ink-2">{part === "demo" ? "No criteria. Leave this empty when there is no demo or interview." : "No criteria yet."}</p>
                )}
                <ul className="flex flex-col gap-2">
                  {mine.map(({ c, i }, n) => (
                    <li key={c.key} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <TextInput
                          aria-label={`Name of criterion ${n + 1} for ${partLabels[part].toLowerCase()}`}
                          value={c.name}
                          maxLength={120}
                          placeholder="Criterion"
                          {...invalid(`criteria.${i}.name`)}
                          onChange={(e) => set({ criteria: v.criteria.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })}
                          className="flex-1"
                        />
                        <TextInput
                          aria-label={`Weight of ${c.name || `criterion ${n + 1}`}`}
                          value={c.weight}
                          inputMode="numeric"
                          maxLength={3}
                          {...invalid(`criteria.${i}.weight`)}
                          onChange={(e) => set({ criteria: v.criteria.map((x, k) => (k === i ? { ...x, weight: e.target.value } : x)) })}
                          className="num w-[72px] text-right"
                        />
                        <span aria-hidden className="text-ink-2">
                          %
                        </span>
                        <IconButton
                          type="button"
                          label={`Remove ${c.name || `criterion ${n + 1}`}`}
                          onClick={() =>
                            set({ criteria: v.criteria.filter((_, k) => k !== i), questions: v.questions.map((q) => (q.criterionKey === c.key ? { ...q, criterionKey: "" } : q)) })
                          }
                        >
                          <X size={16} aria-hidden />
                        </IconButton>
                      </div>
                      <Problem id={`p-criteria.${i}.name`}>{errors[`criteria.${i}.name`]}</Problem>
                      <Problem id={`p-criteria.${i}.weight`}>{errors[`criteria.${i}.weight`]}</Problem>
                    </li>
                  ))}
                </ul>
                {mine.length > 0 && (
                  <p role="status" className={`num text-[13px] ${sum === 100 ? "text-ink-2" : "font-semibold text-[var(--crit-text)]"}`}>
                    {sum === 100 ? "Adds up to 100." : `Adds up to ${sum}; it must be 100.`}
                  </p>
                )}
                <div>
                  <Button type="button" onClick={() => set({ criteria: [...v.criteria, { key: newKey(), name: "", weight: "", part }] })}>
                    Add criterion
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={`Questions (${v.questions.length})`}>
        <p className="-mt-1 max-w-[78ch] text-[13.5px] text-ink-2">
          The candidates answer these in the Excel answer sheet. They are numbered in this order, and each belongs to one criterion for the written answers.
        </p>
        {v.questions.length === 0 && <Nothing>No questions yet.</Nothing>}
        <ol aria-label="Questions" className="flex flex-col">
          {v.questions.map((q, i) => (
            <li key={i} className="flex gap-3 border-b border-line py-3">
              <span className="num w-7 shrink-0 pt-2 font-semibold">{i + 1}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <textarea
                  aria-label={`Question ${i + 1}`}
                  rows={q.text.length > 110 ? 3 : 2}
                  value={q.text}
                  maxLength={1000}
                  {...invalid(`questions.${i}.text`)}
                  onChange={(e) => set({ questions: v.questions.map((x, n) => (n === i ? { ...x, text: e.target.value } : x)) })}
                  className={textareaClass}
                />
                <Problem id={`p-questions.${i}.text`}>{errors[`questions.${i}.text`]}</Problem>
                <Problem id={`p-questions.${i}.criterionKey`}>{errors[`questions.${i}.criterionKey`]}</Problem>
              </div>
              <Select
                aria-label={`Criterion of question ${i + 1}`}
                value={q.criterionKey}
                {...invalid(`questions.${i}.criterionKey`)}
                onChange={(e) => set({ questions: v.questions.map((x, n) => (n === i ? { ...x, criterionKey: e.target.value } : x)) })}
                className="w-56 shrink-0"
              >
                <option value="">Choose a criterion</option>
                {written.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name || "Criterion without a name"}
                  </option>
                ))}
              </Select>
              <div className="flex shrink-0">
                <IconButton
                  type="button"
                  label={`Move question ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => set({ questions: move(v.questions, i, -1) })}
                  className="disabled:opacity-30"
                >
                  <ArrowUp size={16} aria-hidden />
                </IconButton>
                <IconButton
                  type="button"
                  label={`Move question ${i + 1} down`}
                  disabled={i === v.questions.length - 1}
                  onClick={() => set({ questions: move(v.questions, i, 1) })}
                  className="disabled:opacity-30"
                >
                  <ArrowDown size={16} aria-hidden />
                </IconButton>
                <IconButton type="button" label={`Remove question ${i + 1}`} onClick={() => set({ questions: v.questions.filter((_, n) => n !== i) })}>
                  <X size={16} aria-hidden />
                </IconButton>
              </div>
            </li>
          ))}
        </ol>
        <div>
          <Button type="button" onClick={() => set({ questions: [...v.questions, { text: "", criterionKey: written.length === 1 ? written[0]!.key : "" }] })}>
            Add question
          </Button>
        </div>
      </Section>

      <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-tile border border-line bg-surface px-6 py-4 shadow-float">
        {(errors["weights.written"] || errors["weights.demo"]) && <Problem>{[errors["weights.written"], errors["weights.demo"]].filter(Boolean).join(" ")}</Problem>}
        {problem && <ErrorState message={problem} />}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <p role="status" className="min-w-[200px] flex-1 text-ink-2">
            {dirty && overtaken
              ? "Someone else saved this document while you were typing. What you typed is kept; saving now replaces their version."
              : dirty
                ? "Not saved yet. The exports and the review use the saved document."
                : rfp.stage !== "drafting"
                  ? "Saved. A change made now means that an approval already recorded no longer counts."
                  : blockers.length
                    ? `Saved. Before it can go to review: ${blockers.join(" ")}`
                    : "Saved. The draft is complete enough to go to review."}
          </p>
          {dirty && (
            <Button type="button" onClick={() => (setV(saved), setErrors({}), setProblem(null), setOvertaken(false))}>
              Discard changes
            </Button>
          )}
          <Button
            type="submit"
            variant={dirty || rfp.stage !== "drafting" ? "primary" : "plain"}
            aria-disabled={!dirty || save.isPending || undefined}
            className={!dirty ? "opacity-50" : undefined}
          >
            {save.isPending ? "Saving" : "Save document"}
          </Button>
          {rfp.stage === "drafting" && !dirty && (
            <Button type="button" variant="primary" disabled={blockers.length > 0} aria-disabled={stage.isPending || undefined} onClick={() => !stage.isPending && stage.mutate()}>
              Send for review
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

/** Q-2: the RFP's own text. The AI's draft is a proposal next to it; the document is what people saved. */
export function DocumentTab({ rfp, keep }: { rfp: RfpDetail; keep: Kept }) {
  const empty = rfp.sections.length + rfp.criteria.length + rfp.questions.length === 0;
  const drafting = rfp.stage === "drafting";
  const ask = useRfpChange(rfp.id, () => api<RfpDetail>(`/rfps/${rfp.id}/draft`, { method: "POST" }), { quiet: true });
  const review = useRfpChange(
    rfp.id,
    (v: { action: "accept" | "reject"; at: DOMRect | null }) => api<RfpDetail>(`/rfps/${rfp.id}/draft/review`, { body: { action: v.action, suggestionId: rfp.draft!.id } }),
    {
      done: (_r, v) => (v.action === "accept" ? "The AI's draft is now the document. Change whatever you like." : "AI draft rejected"),
      after: (_r, v) => v.action === "accept" && (burst(v.at, 9), ((keep.current = null), setReplacedTimes((n) => n + 1))),
    },
  );
  const template = useRfpChange(rfp.id, () => api<RfpDetail>(`/rfps/${rfp.id}/template`, { method: "POST" }), {
    done: "Started from the template",
    after: () => ((keep.current = null), setReplacedTimes((n) => n + 1)),
  });
  const d = rfp.draft?.output;
  const taken = rfp.draft?.status === "accepted" || rfp.draft?.status === "edited";
  const [confirming, setConfirming] = useState(false);
  // Counts the times the whole document was replaced (a draft taken over, the template), so the form starts afresh then.
  const [replacedTimes, setReplacedTimes] = useState(0);
  const [unsaved, setUnsaved] = useState(false);

  if (!contentEditable(rfp.stage))
    return (
      <>
        <Nothing>
          {contentLocked(rfp.stage)
            ? "The RFP has been issued, so its sections, criteria and questions can no longer be changed: every candidate answers the same questions."
            : "This is the document as it was approved. To change it, take the RFP back to drafting on the Review tab; it then needs approving again."}
        </Nothing>
        <ReadOnly rfp={rfp} />
      </>
    );
  return (
    <>
      {(drafting || rfp.draft) && (
        <Section title="First draft by the AI">
          <AiTextPanel
            title="AI draft"
            suggestion={rfp.draft}
            from="the need and the template"
            intro="The AI can write a first draft from the need and the team's template: the sections, criteria with weights and a numbered question list. It becomes the document only when you choose to use it, and everything can be changed afterwards. The budget and the sponsor are not passed to it."
            onAsk={() => ask.mutate()}
            asking={ask.isPending}
            askProblem={ask.isError ? messageOf(ask.error) : null}
            onReview={(action, at) => {
              // Taking a draft over replaces what is there: ask once more when there is something to lose.
              if (action === "accept" && (!empty || unsaved) && !confirming) return setConfirming(true);
              setConfirming(false);
              review.mutate({ action, at });
            }}
            reviewing={review.isPending}
            acceptLabel={confirming ? "Really replace the document?" : "Use this draft"}
            canAsk={drafting}
            note={
              taken
                ? "Taken over as the document below, where it can still be changed."
                : !drafting
                  ? "This draft was not used."
                  : confirming
                    ? `Using the draft replaces the sections, criteria and questions that are there now${unsaved ? ", including what you typed and have not saved" : ""}. Press again to confirm.`
                    : empty
                      ? "Nothing here is part of the RFP until you use it. It is written from the need, so read it as a vendor would before it goes out."
                      : "Using it replaces the sections, criteria and questions below."
            }
          >
            {d && (
              <>
                <p>
                  {d.sections.length} sections, {d.criteria.length} criteria and {d.questions.length} questions.
                </p>
                <details>
                  <summary className="cursor-pointer font-medium text-accent-ink">Read the draft</summary>
                  <div className="mt-3 flex max-w-[78ch] flex-col gap-3">
                    {d.sections.map((s, i) => (
                      <div key={i}>
                        <h3 className="font-semibold">{s.heading}</h3>
                        <p className="whitespace-pre-line">{s.body}</p>
                      </div>
                    ))}
                    <div>
                      <h3 className="font-semibold">Criteria</h3>
                      <ul className="list-disc pl-5">
                        {d.criteria.map((c, i) => (
                          <li key={i}>
                            {c.name}: {c.weight}% of {partLabels[c.part].toLowerCase()}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-semibold">Questions</h3>
                      <ol className="list-decimal pl-5">
                        {d.questions.map((q, i) => (
                          <li key={i}>
                            {q.text} <span className="text-ink-2">({q.criterion})</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                </details>
              </>
            )}
          </AiTextPanel>
          {drafting && empty && !unsaved && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl bg-sunk px-5 py-4">
              <p className="min-w-0 flex-1 text-ink-2">Or write it yourself: the template gives the usual sections, still empty, and the usual criteria with their weights.</p>
              <Button onClick={() => !template.isPending && template.mutate()} aria-disabled={template.isPending || undefined}>
                Start from the template
              </Button>
            </div>
          )}
        </Section>
      )}
      <Editor key={replacedTimes} rfp={rfp} onDirty={setUnsaved} keep={keep} />
    </>
  );
}
