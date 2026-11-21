import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { bouncy } from "../lib/motion";
import { IconButton } from "./ui";

/**
 * A list with a record open beside it. When a record is open the list narrows to a column
 * of names and the panel slides in and takes the rest.
 */
export function SplitView({ open, list, panel }: { open: boolean; list: ReactNode; panel: ReactNode }) {
  return (
    <div className="flex min-h-[420px]">
      <div className="min-w-0 shrink-0 grow-0 transition-[flex-basis] duration-[380ms] ease-out" style={{ flexBasis: open ? 248 : "100%" }}>
        {list}
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            className="min-w-0 flex-1"
            initial={{ x: 48, opacity: 0 }}
            animate={{ x: 0, opacity: 1, transition: bouncy }}
            exit={{ x: 32, opacity: 0, transition: { duration: 0.15 } }}
          >
            {panel}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The open record. Keyboard focus moves to its heading when it opens and goes back to
 * where it came from when it closes; Escape closes it. Give it a `key` per record.
 */
export function Panel({ context, title, onClose, children }: { context?: ReactNode; title: string; onClose: () => void; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    heading.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <section
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="ml-7 flex min-w-[420px] flex-col gap-6 rounded-tile border border-line bg-surface px-8 py-[30px] shadow-float"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {context && <p className="text-[13.5px] font-medium text-ink-2">{context}</p>}
          <h2 ref={heading} tabIndex={-1} className="mt-1.5 truncate text-2xl font-semibold tracking-[-0.02em] outline-none">
            {title}
          </h2>
        </div>
        <IconButton label="Close panel" onClick={onClose}>
          <X size={17} aria-hidden />
        </IconButton>
      </div>
      {children}
    </section>
  );
}
