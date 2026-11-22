import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { IconButton } from "./ui";

/**
 * A modal for adding or editing a record. Built on the browser's own dialog, which keeps
 * keyboard focus inside, closes on Escape and returns focus to where it came from.
 */
export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const opener = document.activeElement as HTMLElement | null;
    if (!el.open) el.showModal();
    // Start in the field the form marks as the first to fill, else the first field; never on the Close button.
    (el.querySelector<HTMLElement>("[data-start]") ?? el.querySelector<HTMLElement>("input:not([type=hidden]):not([type=checkbox]), select, textarea"))?.focus();
    return () => {
      el.close();
      // By now the dialog has left the page, so the browser cannot hand focus back itself.
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={`m-auto max-h-[88vh] w-full ${wide ? "max-w-[760px]" : "max-w-[560px]"} overflow-auto rounded-tile border border-line bg-surface p-0 text-ink shadow-float backdrop:bg-[rgba(9,20,45,.35)] open:animate-[dialog-in_.28s_cubic-bezier(.34,1.5,.5,1)]`}
    >
      <div className="flex flex-col gap-6 px-8 py-7">
        <div className="flex items-start gap-3">
          <h2 className="flex-1 text-2xl font-semibold tracking-[-0.02em]">{title}</h2>
          <IconButton label="Close" type="button" onClick={onClose}>
            <X size={17} aria-hidden />
          </IconButton>
        </div>
        {children}
      </div>
    </dialog>
  );
}
