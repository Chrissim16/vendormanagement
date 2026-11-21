import { useMutation } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { exampleQuestions, MAX_EARLIER, MAX_QUESTION, type AskAnswer, type AskLookup, type AskPassage } from "../../../../shared/ask";
import { api, messageOf } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { item, list } from "../../lib/motion";
import { Button, EmptyState, ErrorState, Loading, PageHeader, Pill, TextInput } from "../../platform/ui";
import { AiLabel } from "../scorecards/parts";

const underlined = "font-medium text-accent-ink underline underline-offset-2";

/** The conversation lasts as long as the browser tab, so following a link to a record and coming back does not lose it. Nothing in it is a record. */
const KEEP = "ask-conversation";
const MAX_KEPT = 20;
function kept(): AskAnswer[] {
  try {
    const turns = JSON.parse(sessionStorage.getItem(KEEP) ?? "[]") as AskAnswer[];
    return Array.isArray(turns) ? turns.filter((t) => t && typeof t.id === "string" && typeof t.answer === "string") : [];
  } catch {
    return [];
  }
}
function keep(turns: AskAnswer[]) {
  try {
    sessionStorage.setItem(KEEP, JSON.stringify(turns.slice(-MAX_KEPT)));
  } catch {
    // A full or blocked store only means the conversation does not survive leaving the page.
  }
}

/** The AI's text: sentences as paragraphs, lines that start with a dash as a list. */
function AnswerText({ text }: { text: string }) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const line of text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    const isItem = /^[-•]\s+/.test(line);
    const last = blocks.at(-1);
    if (last && last.list === isItem && isItem) last.lines.push(line.replace(/^[-•]\s+/, ""));
    else blocks.push({ list: isItem, lines: [isItem ? line.replace(/^[-•]\s+/, "") : line] });
  }
  return (
    <div className="flex flex-col gap-2.5 text-[15px] leading-relaxed">
      {blocks.map((b, i) =>
        b.list ? (
          <ul key={i} className="flex list-disc flex-col gap-1 pl-5">
            {b.lines.map((l, j) => (
              <li key={j}>{l}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{b.lines[0]}</p>
        ),
      )}
    </div>
  );
}

/** A passage of an uploaded document, word for word, with where it comes from. */
function Passage({ p }: { p: AskPassage }) {
  return (
    <figure className="flex flex-col gap-2 rounded-xl bg-surface px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--line)]">
      <blockquote className="whitespace-pre-line text-[14px] leading-relaxed">{p.text}</blockquote>
      <figcaption className="text-[13px] text-ink-2">
        From{" "}
        <a href={`/api/documents/${p.documentId}/download`} className={underlined}>
          {p.document}
        </a>
        {p.part ? `, ${p.part}` : ""}, attached to{" "}
        <Link to={p.href} className={underlined}>
          {p.where}
        </Link>
        .
      </figcaption>
    </figure>
  );
}

/** One thing the app looked up: what, how many, the totals, and the page that shows the same. */
function Lookup({ l }: { l: AskLookup }) {
  const figures = [...(l.count == null ? [] : [{ label: "Found", value: String(l.count) }]), ...l.totals];
  return (
    <li className="flex flex-col gap-1.5 border-t border-line py-3.5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="min-w-0 flex-1 font-medium">{l.title}</p>
        {l.href && (
          <Link to={l.href} className={underlined}>
            {l.count == null ? "Open the page" : "Open the list"}
          </Link>
        )}
      </div>
      {figures.length > 0 && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[13.5px]">
          {figures.map((f) => (
            <div key={f.label} className="flex gap-1.5">
              <dt className="text-ink-2">{f.label}</dt>
              <dd className="num font-semibold">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {l.note && <p className="text-[13.5px] text-ink-2">{l.note}</p>}
    </li>
  );
}

function Answer({ a, newest }: { a: AskAnswer; newest: boolean }) {
  return (
    <motion.article {...(newest ? item : {})} aria-label={`Answer to: ${a.question}`} className="flex flex-col gap-3.5">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] [text-wrap:balance]">{a.question}</h2>
      <div className="flex flex-col gap-4 rounded-2xl bg-tint px-5 py-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <AiLabel>AI answer</AiLabel>
          <p className="min-w-0 flex-1 text-[13px] text-ink-2">
            Written by the AI on {formatDateTime(a.createdAt)}
            {a.lookups.length ? " from what the app looked up. The counts and amounts under it are the app's own." : "."}
          </p>
          {!a.answered && <Pill tone="warn">Not answered</Pill>}
        </div>
        <AnswerText text={a.answer} />
        {a.passages.length > 0 && (
          <section aria-label="Passages" className="flex flex-col gap-2.5">
            {a.passages.map((p) => (
              <Passage key={p.ref} p={p} />
            ))}
          </section>
        )}
        {a.sources.length > 0 && (
          <section aria-label="Records used" className="flex flex-col gap-1.5">
            <h3 className="text-[13px] font-semibold text-ink-2">Records used</h3>
            <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
              {a.sources.map((s, i) => (
                <li key={i}>
                  <Link to={s.href} className={underlined}>
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {a.lookups.length > 0 && (
        <section aria-label="What the app looked up" className="flex flex-col">
          <h3 className="pb-2 text-[13px] font-semibold text-ink-2">What the app looked up</h3>
          <ul className="flex flex-col border-b border-line">
            {a.lookups.map((l, i) => (
              <Lookup key={i} l={l} />
            ))}
          </ul>
        </section>
      )}
    </motion.article>
  );
}

/** C-1: ask a question in plain language; the answer names the records it used and the lists its figures come from. */
export function AskPage() {
  const [params, setParams] = useSearchParams();
  const [turns, setTurns] = useState<AskAnswer[]>(kept);
  const [text, setText] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // "Start over" while an answer is on its way: that answer belongs to the conversation that was cleared, and is dropped.
  const conversation = useRef(0);
  const ask = useMutation({
    mutationFn: async (question: string) => {
      const started = conversation.current;
      const answer = await api<AskAnswer>("/ask", { body: { question, earlier: turns.slice(-MAX_EARLIER).map((t) => t.question) } });
      return { answer, current: started === conversation.current };
    },
    onSuccess: ({ answer: a, current }) => {
      if (!current) return;
      setTurns((before) => {
        const next = [...before, a];
        keep(next);
        return next;
      });
      setFresh(a.id);
      // What was typed is only cleared once it has been answered (X-3).
      setText((t) => (t.trim() === a.question ? "" : t));
    },
  });
  const send = (question: string) => {
    const q = question.trim();
    if (!q || ask.isPending) return;
    ask.mutate(q);
  };

  // A question typed in the search field at the top arrives in the address; it is asked once and then taken out of it.
  const arrived = params.get("q");
  const asked = useRef<string | null>(null);
  useEffect(() => {
    // Once the question is out of the address, the same one may arrive again.
    if (!arrived) asked.current = null;
    if (!arrived || asked.current === arrived) return;
    asked.current = arrived;
    setText(arrived.slice(0, MAX_QUESTION));
    setParams({}, { replace: true });
    send(arrived.slice(0, MAX_QUESTION));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };
  const clear = () => {
    conversation.current++;
    setTurns([]);
    keep([]);
    ask.reset();
    input.current?.focus();
  };

  return (
    <>
      <PageHeader context="Answers come from what the app holds. Asking never changes anything." title="Ask">
        {turns.length > 0 && <Button onClick={clear}>Start over</Button>}
      </PageHeader>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2.5" aria-label="Ask a question">
        <label htmlFor="ask-question" className="sr-only">
          Your question
        </label>
        <TextInput
          ref={input}
          id="ask-question"
          autoFocus
          autoComplete="off"
          maxLength={MAX_QUESTION}
          placeholder={turns.length ? "Ask a follow-up, or something else" : "Ask about vendors, agreements, money, performance or RFPs"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="!h-[46px] flex-1 !px-5 !text-[15px]"
        />
        <Button
          variant="primary"
          type="submit"
          aria-disabled={ask.isPending || !text.trim() || undefined}
          className={ask.isPending ? "!h-[46px] cursor-progress !px-6" : "!h-[46px] !px-6"}
        >
          {ask.isPending ? "Looking it up" : "Ask"}
        </Button>
      </form>

      <div aria-live="polite" className="flex flex-col gap-10">
        {ask.isPending && (
          <div className="flex flex-col gap-2">
            <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{ask.variables}</h2>
            <Loading rows={3} />
          </div>
        )}
        {ask.isError && <ErrorState message={messageOf(ask.error)} onRetry={() => send(ask.variables ?? text)} />}
        {turns.length === 0 && !ask.isPending ? (
          <EmptyState
            title="Nothing asked yet"
            action={
              <motion.ul variants={list} initial="initial" animate="animate" aria-label="Example questions" className="flex flex-wrap gap-2">
                {exampleQuestions.map((q) => (
                  <motion.li key={q} variants={item}>
                    <Button
                      className="bg-surface"
                      onClick={() => {
                        setText(q);
                        send(q);
                      }}
                    >
                      {q}
                    </Button>
                  </motion.li>
                ))}
              </motion.ul>
            }
          >
            Type a question in plain words. The app looks the answer up in its own records, says which records it used, and says so when it does not hold the answer. Try one of
            these to start.
          </EmptyState>
        ) : (
          [...turns].reverse().map((a) => <Answer key={a.id} a={a} newest={a.id === fresh} />)
        )}
      </div>
    </>
  );
}
