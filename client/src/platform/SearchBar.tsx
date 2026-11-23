import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { CornerDownLeft, Search, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { agreementName, type Agreement } from "../../../shared/agreements";
import { exampleQuestions, MAX_QUESTION } from "../../../shared/ask";
import type { RfpRow } from "../../../shared/rfp";
import type { Page } from "../../../shared/types";
import type { Vendor } from "../../../shared/vendors";
import { api } from "../lib/api";
import { spring } from "../lib/motion";

const hints = ["Search vendors, agreements and RFPs", "Ask “Which SOWs end this quarter?”", "Ask “Which vendors have no NDA?”"];
const pages: [label: string, to: string][] = [
  ["Dashboard", "/"],
  ["Vendors", "/vendors"],
  ["Agreements", "/agreements"],
  ["Renewals", "/agreements/renewals"],
  ["Renewal calendar", "/agreements/calendar"],
  ["Money: spend", "/money"],
  ["Money: invoices", "/money/invoices"],
  ["Performance", "/performance"],
  ["Scorecards", "/performance/scorecards"],
  ["RFPs", "/rfps"],
  ["Warnings", "/warnings"],
  ["Monthly report", "/report"],
  ["Ask", "/ask"],
];

const itemClass = "flex cursor-pointer items-center gap-2.5 rounded-[9px] px-3 py-2 text-[13.5px] data-[selected=true]:bg-sunk [&_small]:text-[12.5px] [&_small]:text-ink-2";
const Group = ({ heading, children }: { heading: string; children: ReactNode }) => (
  <Command.Group
    heading={heading}
    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3"
  >
    {children}
  </Command.Group>
);

/**
 * The field in the top bar: type a name to jump to a vendor, an agreement, an RFP or a
 * page, or type a question and press Enter to ask it (C-1). "/" puts the cursor in it.
 */
export function SearchBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState(0);
  const [found, setFound] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const q = text.trim();

  useEffect(() => {
    const t = setInterval(() => setHint((n) => (n + 1) % hints.length), 3200);
    return () => clearInterval(t);
  }, []);
  // Records are looked for a moment after the typing stops.
  useEffect(() => {
    const t = setTimeout(() => setFound(q.length >= 2 ? q : ""), 200);
    return () => clearTimeout(t);
  }, [q]);
  // "/" anywhere outside a field goes to the search field, as in most tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
      if (((e.key === "/" && !typing) || (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey))) && !e.altKey) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Going to another page by any other way closes the list. What is being typed is left alone.
  useEffect(() => setOpen(false), [location.pathname, location.search]);

  const query = { q: found, pageSize: 5 };
  const on = open && found.length >= 2;
  const vendors = useQuery({ queryKey: ["search", "vendors", found], queryFn: () => api<Page<Vendor>>("/vendors", { query: { ...query, status: "all" } }), enabled: on });
  const agreements = useQuery({ queryKey: ["search", "agreements", found], queryFn: () => api<Page<Agreement>>("/agreements", { query }), enabled: on });
  const rfps = useQuery({ queryKey: ["search", "rfps", found], queryFn: () => api<Page<RfpRow>>("/rfps", { query }), enabled: on });
  const matchingPages = q ? pages.filter(([label]) => label.toLowerCase().includes(q.toLowerCase())) : [];
  // Only what matches what is in the field now; results of an earlier word are not shown under a new one.
  const fresh = found === q;

  const go = (to: string) => {
    // Emptied here, at once, and not when the new page arrives: by then the next search may already be being typed.
    setText("");
    setOpen(false);
    input.current?.blur();
    navigate(to);
  };
  const ask = (question: string) => go(`/ask?q=${encodeURIComponent(question.slice(0, MAX_QUESTION))}`);

  return (
    <div
      ref={box}
      className="relative max-w-[460px] flex-1"
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <Command label="Find anything, or ask a question" shouldFilter={false} loop>
        <div className="flex h-[38px] items-center gap-2.5 rounded-full bg-sunk px-4 text-ink-2 outline-2 outline-offset-2 outline-[var(--accent)] focus-within:outline">
          <Search size={15} aria-hidden className="shrink-0" />
          <div className="relative h-5 min-w-0 flex-1">
            <Command.Input
              ref={input}
              value={text}
              onValueChange={(v) => {
                setText(v);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  // The first Escape closes the list; the field keeps what was typed.
                  if (open) e.stopPropagation();
                  setOpen(false);
                }
              }}
              maxLength={MAX_QUESTION}
              className="absolute inset-0 w-full bg-transparent leading-5 text-ink !shadow-none !outline-none"
            />
            {/* The sliding hints stand in for a placeholder: they show what the field does while it is empty. */}
            {!text && (
              <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
                <AnimatePresence initial={false}>
                  <motion.span key={hint} className="absolute inset-0 truncate leading-5" initial={{ y: 20 }} animate={{ y: 0 }} exit={{ y: -20 }} transition={spring}>
                    {hints[hint]}
                  </motion.span>
                </AnimatePresence>
              </span>
            )}
          </div>
          <kbd aria-hidden className="hidden rounded-md border border-line-2 px-1.5 text-[11px] font-medium text-ink-3 sm:block">
            /
          </kbd>
        </div>
        {/* The list is always there, hidden while closed, so the field never points at a list that does not exist. */}
        <Command.List
          hidden={!open}
          aria-label="Suggestions"
          className="absolute left-0 right-0 top-[46px] z-30 max-h-[70vh] overflow-auto rounded-2xl border border-line bg-surface p-1.5 shadow-[0_18px_50px_rgba(9,20,45,.16)]"
        >
          {open && (
            <>
              {q ? (
                <Group heading="Ask">
                  <Command.Item value={`ask ${q}`} onSelect={() => ask(q)} className={itemClass}>
                    <Sparkles size={15} aria-hidden className="shrink-0 text-accent-ink" />
                    <span className="min-w-0 flex-1 truncate">
                      Ask: <span className="font-semibold">{q}</span>
                    </span>
                    <CornerDownLeft size={14} aria-hidden className="shrink-0 text-ink-3" />
                  </Command.Item>
                </Group>
              ) : (
                <Group heading="Try asking">
                  {exampleQuestions.map((e) => (
                    <Command.Item key={e} value={`example ${e}`} onSelect={() => ask(e)} className={itemClass}>
                      <Sparkles size={15} aria-hidden className="shrink-0 text-accent-ink" />
                      {e}
                    </Command.Item>
                  ))}
                </Group>
              )}
              {fresh && !!vendors.data?.items.length && (
                <Group heading="Vendors">
                  {vendors.data.items.map((v) => (
                    <Command.Item
                      key={v.id}
                      value={`vendor ${v.id}`}
                      onSelect={() => go(`/vendors?${v.status === "offboarded" ? "status=all&" : ""}open=${v.id}`)}
                      className={itemClass}
                    >
                      <span className="min-w-0 flex-1 truncate">{v.name}</span>
                      <small>{v.ownerName}</small>
                    </Command.Item>
                  ))}
                </Group>
              )}
              {fresh && !!agreements.data?.items.length && (
                <Group heading="Agreements">
                  {agreements.data.items.map((a) => (
                    <Command.Item key={a.id} value={`agreement ${a.id}`} onSelect={() => go(`/agreements/${a.id}`)} className={itemClass}>
                      <span className="min-w-0 flex-1 truncate">{agreementName(a.kind, a.title)}</span>
                      <small className="truncate">{a.vendorName}</small>
                    </Command.Item>
                  ))}
                </Group>
              )}
              {fresh && !!rfps.data?.items.length && (
                <Group heading="RFPs">
                  {rfps.data.items.map((r) => (
                    <Command.Item key={r.id} value={`rfp ${r.id}`} onSelect={() => go(`/rfps/${r.id}`)} className={itemClass}>
                      <span className="min-w-0 flex-1 truncate">{r.title}</span>
                      <small>{r.ownerName}</small>
                    </Command.Item>
                  ))}
                </Group>
              )}
              {matchingPages.length > 0 && (
                <Group heading="Go to">
                  {matchingPages.map(([label, to]) => (
                    <Command.Item key={to} value={`page ${to}`} onSelect={() => go(to)} className={itemClass}>
                      {label}
                    </Command.Item>
                  ))}
                </Group>
              )}
            </>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
