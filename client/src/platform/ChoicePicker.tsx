import clsx from "clsx";
import { X } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { cleanName } from "../../../shared/vendors";
import { Field } from "./ui";

const same = (a: string, b: string) => cleanName(a).toLowerCase() === cleanName(b).toLowerCase();

/**
 * Several choices from a shared list, shown as chips, with a box to find more (V-7).
 * Typing filters the list; Enter takes the highlighted one. With `allowNew`, a name that is
 * not on the list can be added as a new one; a name that differs from one on the list only in
 * capitals or spaces is that one. Backspace in the empty box removes the last chip.
 */
export function ChoicePicker({
  id,
  label,
  noun,
  options,
  chosen,
  onChange,
  allowNew = false,
  error,
}: {
  id: string;
  label: string;
  /** What one choice is called, for the button labels: "role". */
  noun: string;
  options: string[];
  chosen: string[];
  onChange: (next: string[]) => void;
  allowNew?: boolean;
  error?: string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const typed = cleanName(text);
  const left = options.filter((o) => !chosen.some((c) => same(c, o)));
  const matches = typed ? left.filter((o) => o.toLowerCase().includes(typed.toLowerCase())) : left;
  const exact = [...options, ...chosen].find((o) => same(o, typed));
  const offerNew = allowNew && typed !== "" && !exact;
  const items: { value: string; label: string; isNew: boolean }[] = [
    ...matches.map((o) => ({ value: o, label: o, isNew: false })),
    ...(offerNew ? [{ value: typed, label: `Add "${typed}" as a new ${noun}`, isNew: true }] : []),
  ];
  const current = Math.min(active, Math.max(items.length - 1, 0));

  const take = (value: string) => {
    const known = options.find((o) => same(o, value)) ?? value;
    if (!chosen.some((c) => same(c, known))) onChange([...chosen, known]);
    setText("");
    setActive(0);
    // The list closes, so it does not cover the rest of the form; typing or the arrow keys open it again.
    setOpen(false);
    input.current?.focus();
  };
  const drop = (value: string) => {
    onChange(chosen.filter((c) => c !== value));
    input.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive(Math.min(current + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(current - 1, 0));
    } else if (e.key === "Enter") {
      // Enter in the box picks a choice; it never sends the form.
      if (!typed && !open) return;
      e.preventDefault();
      const item = open || typed ? items[current] : undefined;
      if (item) take(item.value);
      else if (exact) take(exact);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "Backspace" && text === "" && chosen.length) {
      onChange(chosen.slice(0, -1));
    }
  };
  const showList = open && items.length > 0;

  return (
    <Field label={label} htmlFor={id} error={error}>
      <div className={clsx("flex min-w-0 flex-wrap items-center gap-1.5 rounded-[19px] border border-line-2 bg-surface px-2 py-1.5 hover:border-ink-3", error && "border-crit")}>
        {chosen.length > 0 && (
          <ul aria-label={`Chosen ${noun}s`} className="contents">
            {chosen.map((c) => (
              <li key={c} className="inline-flex h-[26px] items-center gap-1 rounded-full bg-tint pl-2.5 pr-1 text-[12.5px] font-semibold text-accent-ink">
                {c}
                <button
                  type="button"
                  onClick={() => drop(c)}
                  aria-label={`Remove ${c}`}
                  className="grid h-5 w-5 place-items-center rounded-full hover:bg-surface focus-visible:outline focus-visible:outline-2"
                >
                  <X aria-hidden size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="relative min-w-[140px] flex-1">
          <input
            ref={input}
            id={id}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList ? `${listId}-${current}` : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            autoComplete="off"
            value={text}
            placeholder={chosen.length ? `Add another ${noun}` : `Find a ${noun}${allowNew ? " or type a new one" : ""}`}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKey}
            className="h-[26px] w-full min-w-0 bg-transparent px-1.5 text-sm placeholder:text-ink-3 focus:outline-none"
          />
          {showList && (
            <ul
              id={listId}
              role="listbox"
              aria-label={`Matching ${noun}s`}
              className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 max-h-60 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-float"
            >
              {items.map((item, i) => (
                <li
                  key={`${item.isNew ? "new" : "old"}-${item.value}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === current}
                  // Taking the choice before the box loses focus, so the list does not close first.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    take(item.value);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={clsx("cursor-pointer rounded-xl px-3 py-2 text-sm", i === current && "bg-sunk", item.isNew && "font-medium text-accent-ink")}
                >
                  {item.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Field>
  );
}
