import clsx from "clsx";
import { motion } from "motion/react";
import { useId, type ReactNode } from "react";
import { spring } from "../lib/motion";

/** Sections inside a panel. The underline slides to the chosen tab; arrow keys move between tabs. */
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  children,
}: {
  label: string;
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  children: ReactNode;
}) {
  const uid = useId();
  const move = (step: number) => {
    const i = tabs.findIndex((t) => t.id === value);
    const next = tabs[(i + step + tabs.length) % tabs.length]!;
    onChange(next.id);
    document.getElementById(`${uid}-${next.id}`)?.focus();
  };
  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label={label} className="flex gap-6 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            id={`${uid}-${t.id}`}
            role="tab"
            type="button"
            aria-selected={t.id === value}
            aria-controls={`${uid}-panel`}
            tabIndex={t.id === value ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") move(1);
              if (e.key === "ArrowLeft") move(-1);
            }}
            className={clsx("relative py-2.5 font-medium transition-colors", t.id === value ? "text-ink" : "text-ink-2 hover:text-ink")}
          >
            {t.label}
            {t.id === value && <motion.span layoutId={`tab-${uid}`} transition={spring} className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>
      <motion.div
        key={value}
        id={`${uid}-panel`}
        role="tabpanel"
        aria-labelledby={`${uid}-${value}`}
        tabIndex={0}
        initial={{ x: 24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
        className="flex flex-col gap-5 outline-none"
      >
        {children}
      </motion.div>
    </div>
  );
}
