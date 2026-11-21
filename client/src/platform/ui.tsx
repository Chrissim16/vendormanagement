import clsx from "clsx";
import { motion } from "motion/react";
import { forwardRef, useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { bouncy } from "../lib/motion";

/**
 * A remove button that asks once more: the first click arms it, the second does it.
 * It goes back to rest after five seconds or when focus moves away.
 */
export function ConfirmButton({
  label,
  onConfirm,
  className,
  disabled,
  children = "Remove",
  confirm = "Really remove?",
}: {
  /** What the button asks once armed. */
  confirm?: string;
  label: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      className={clsx(className, armed && "border-crit text-crit-text")}
      disabled={disabled}
      aria-label={armed ? `${confirm} ${label}, click again to confirm` : label}
      onBlur={() => setArmed(false)}
      onClick={() => {
        setArmed(!armed);
        if (armed) onConfirm();
      }}
    >
      {armed ? confirm : children}
    </Button>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "plain" | "primary" }>(function Button(
  { variant = "plain", className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      {...props}
      className={clsx(
        "inline-flex h-[38px] items-center justify-center gap-2 rounded-full px-[18px] text-[13.5px] font-semibold transition duration-200 ease-out active:scale-[.96] disabled:pointer-events-none disabled:opacity-40",
        variant === "primary" ? "bg-primary text-primary-on hover:-translate-y-px hover:shadow-[0_6px_18px_rgba(0,119,200,.3)]" : "border border-line-2 hover:bg-sunk",
        className,
      )}
    />
  );
});

export function IconButton({ label, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={clsx("relative grid h-[38px] w-[38px] place-items-center rounded-full text-ink-2 transition duration-200 hover:bg-sunk hover:text-ink active:scale-90", className)}
    />
  );
}

const dots = { bad: "bg-crit", warn: "bg-warn", ok: "bg-ok" } as const;
export type Tone = keyof typeof dots | "none" | "brand";

/** A status pill: neutral, with a small coloured dot carrying the status. See the design guide. */
export function Pill({ tone = "none", children }: { tone?: Tone; children: ReactNode }) {
  const plain = tone === "none";
  return (
    <span
      className={clsx(
        "inline-flex h-[22px] items-center gap-[7px] whitespace-nowrap rounded-full px-[9px] text-[11px] font-semibold",
        plain ? "border border-line-2 text-ink-2" : tone === "brand" ? "bg-tint text-accent-ink" : "bg-sunk text-ink-2",
      )}
    >
      {tone in dots && <span aria-hidden className={clsx("h-1.5 w-1.5 rounded-full", dots[tone as keyof typeof dots])} />}
      {children}
    </span>
  );
}

export function PageHeader({ context, title, children }: { context?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="min-w-0">
        {context && <p className="text-[13.5px] font-medium text-ink-2">{context}</p>}
        <h1 className="mt-2 text-[30px] font-semibold leading-[1.15] tracking-[-0.025em] [text-wrap:balance]">{title}</h1>
      </div>
      <div className="ml-auto flex items-center gap-2.5">{children}</div>
    </div>
  );
}

/** What an empty list shows: what belongs here, and the way to add the first one. */
export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-tile bg-sunk px-8 py-10">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-[58ch] text-ink-2">{children}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-4 rounded-tile bg-sunk px-8 py-7">
      <Pill tone="bad">Problem</Pill>
      <p className="min-w-0 flex-1">{message}</p>
      {onRetry && <Button onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="border-b border-line py-[18px]">
          <div className="h-3.5 animate-pulse rounded-full bg-sunk" style={{ width: `${55 - i * 8}%` }} />
        </div>
      ))}
    </div>
  );
}

/** A labelled form control. The error sits next to the field it belongs to. */
export function Field({ label, error, htmlFor, children }: { label: string; error?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${htmlFor}-error`} className="text-[12.5px] font-medium text-[var(--crit-text)]">
          {error}
        </p>
      )}
    </div>
  );
}

const control = "h-[38px] min-w-0 rounded-full border border-line-2 bg-surface px-4 text-sm placeholder:text-ink-3 hover:border-ink-3";
export const TextInput = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={clsx(control, className)} />;
export const Select = ({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} className={clsx(control, "pr-8", className)} />;

/**
 * A choice between a few options that takes effect at once; the highlight slides to the
 * chosen one. These are toggle buttons (`aria-pressed`), each reachable with Tab. While a
 * save is running (`busy`) presses are ignored but the buttons stay focusable, so the
 * keyboard does not lose its place.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  busy,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  busy?: boolean;
}) {
  const id = useId();
  return (
    <div role="group" aria-label={label} className="inline-flex h-10 rounded-full bg-sunk p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          aria-disabled={busy || undefined}
          onClick={() => !busy && o.value !== value && onChange(o.value)}
          className={clsx(
            "relative min-w-[84px] rounded-full px-4 text-[13.5px] font-semibold transition-colors",
            o.value === value ? "text-primary-on" : "text-ink-2 hover:text-ink",
            busy && "cursor-progress",
          )}
        >
          {o.value === value && <motion.span layoutId={`seg-${id}`} transition={bouncy} className="absolute inset-0 rounded-full bg-primary" />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
