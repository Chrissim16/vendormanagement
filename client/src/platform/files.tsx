import clsx from "clsx";
import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { toast } from "sonner";
import { documentTypes, MAX_DOCUMENT_BYTES } from "../../../shared/agreements";
import { messageOf } from "../lib/api";
import { Button, Pill } from "./ui";

/** The extensions a document place takes: PDF, Word and Excel (A-5). */
export const DOCUMENT_EXTENSIONS = ["pdf", "doc", "docx", "xls", "xlsx"];

const extensionOf = (file: File) => (file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "");

export const STILL_SENDING = "Files are still being sent. Wait until they are done, then drop again.";
export const ONE_AT_A_TIME = "Drop one file at a time.";

/** Why the files for a place that takes one file cannot be sent, or null when the one file can. */
export function oneFileProblem(files: File[], accept: string[]): string | null {
  if (files.length !== 1) return ONE_AT_A_TIME;
  return fileProblem(files[0]!, accept);
}

/** Why a file cannot be sent to a place that takes these extensions, or null when it can. The server checks again. */
export function fileProblem(file: File, accept: string[]): string | null {
  const ext = extensionOf(file);
  if (!accept.includes(ext) || !(ext in documentTypes))
    return accept.length === 1 && accept[0] === "xlsx" ? "Choose an Excel file (.xlsx)." : "Only PDF, Word and Excel files can be attached.";
  if (file.size > MAX_DOCUMENT_BYTES) return "That file is larger than 25 MB.";
  return null;
}

// X-7: whether a file from the computer is being dragged over the window. Counted over
// enter and leave, because moving between elements fires both (the new element's enter
// first); reset by any drop. Safari leaves relatedTarget empty on every leave, so an empty
// one counts as leaving the window only when the pointer is at the window's edge.
let depth = 0;
const listeners = new Set<() => void>();
const set = (n: number) => {
  const was = depth > 0;
  depth = Math.max(0, n);
  if (was !== depth > 0) listeners.forEach((l) => l());
};
const carriesFiles = (e: DragEvent | React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

/**
 * Installed once at start. Tracks a file being dragged over the window, and keeps the
 * browser from opening a file dropped beside a drop place, which would leave the app and
 * lose anything typed. Dragged text and links are left to the browser.
 */
export function installFileDropGuard() {
  window.addEventListener("dragenter", (e) => carriesFiles(e) && set(depth + 1));
  window.addEventListener("dragleave", (e) => {
    if (!carriesFiles(e)) return;
    const atEdge = e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight;
    set(!e.relatedTarget && atEdge ? 0 : depth - 1);
  });
  window.addEventListener("dragover", (e) => {
    if (!carriesFiles(e) || e.defaultPrevented) return;
    // Not over a drop place: show that nothing happens here.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
  });
  window.addEventListener("drop", (e) => {
    if (carriesFiles(e)) e.preventDefault();
    set(0);
  });
  window.addEventListener("dragend", () => set(0));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const draggingNow = () => depth > 0;
/** True while a file is dragged anywhere over the window. */
export function useFileDragging() {
  return useSyncExternalStore(subscribe, draggingNow);
}

/**
 * A place that takes files dropped on it (X-7). While a file is dragged over the window it
 * shows a dashed outline and says what dropping does; nothing else on the page moves. When
 * it cannot take a file now, it is only its children.
 */
export function DropZone({
  enabled,
  label,
  multiple = false,
  busy = false,
  onFiles,
  onProblem,
  className,
  children,
}: {
  enabled: boolean;
  /** What dropping does, shown on the outline: "Drop to attach". */
  label: string;
  multiple?: boolean;
  busy?: boolean;
  onFiles: (files: File[]) => void;
  onProblem: (message: string) => void;
  className?: string;
  children: ReactNode;
}) {
  const dragging = useFileDragging();
  const [over, setOver] = useState(false);
  if (!enabled) return <div className={className}>{children}</div>;
  // Shown only while a file is over the window, so a drag that ends anywhere ends it here too.
  const shown = dragging;
  const near = dragging && over;
  return (
    <div
      className={clsx("relative", className)}
      onDragOver={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (!files.length) return;
        if (busy) onProblem(STILL_SENDING);
        else if (!multiple && files.length > 1) onProblem(ONE_AT_A_TIME);
        else onFiles(files);
      }}
    >
      {children}
      <div
        aria-hidden="true"
        data-drop-zone={label}
        className={clsx(
          "pointer-events-none absolute -inset-2 z-10 flex items-start justify-center rounded-2xl pt-2 border-2 border-dashed border-accent transition-[opacity,visibility] duration-150 ease-out",
          shown ? "visible opacity-100" : "invisible opacity-0",
        )}
      >
        <div className={clsx("absolute inset-0 rounded-[14px] bg-tint transition-opacity duration-150", near ? "opacity-95" : "opacity-75")} />
        <span className="relative rounded-full bg-surface px-4 py-1.5 text-[13.5px] font-semibold text-accent-ink shadow-float">{label}</span>
      </div>
    </div>
  );
}

/**
 * Sends files one after another to a place that takes several (X-7). Each is checked on its
 * own; the fine ones are sent, each refused one is named with its reason, and a message says
 * how many were attached. One file refused on its own keeps its plain message.
 */
export function useAttachEach(send: (file: File) => Promise<unknown>, options: { accept?: string[]; after?: () => unknown } = {}) {
  const accept = options.accept ?? DOCUMENT_EXTENSIONS;
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const running = useRef(false);
  const attach = async (files: File[]) => {
    if (running.current || !files.length) return;
    running.current = true;
    setBusy(true);
    setProblems([]);
    const refused: { name: string; why: string }[] = [];
    let attached = 0;
    let only = "";
    for (const file of files) {
      const why = fileProblem(file, accept);
      if (why) {
        refused.push({ name: file.name, why });
        continue;
      }
      try {
        await send(file);
        attached += 1;
        only = file.name;
      } catch (e) {
        refused.push({ name: file.name, why: messageOf(e) });
      }
    }
    running.current = false;
    setBusy(false);
    // Lists and counts elsewhere are fetched once, after the last file, not after each one.
    if (attached) void options.after?.();
    if (attached) toast.success(attached === 1 ? `Attached ${only}` : `Attached ${attached} documents`);
    setProblems(files.length === 1 ? refused.map((r) => r.why) : refused.map((r) => `${r.name}: ${r.why}`));
  };
  return { busy, problems, setProblems, attach };
}

/** What could not be attached, one line per file. */
export function FileProblems({ problems }: { problems: string[] }) {
  if (!problems.length) return null;
  return (
    <div role="alert" className="flex flex-wrap items-start gap-4 rounded-tile bg-sunk px-8 py-7">
      <Pill tone="bad">Problem</Pill>
      <ul className="min-w-0 flex-1">
        {problems.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

/** A button that opens the browser's file chooser (design guide: never a bare file box). The type and size are checked before anything is sent. */
export function FileButton({
  label,
  busyLabel = "Uploading",
  chooserLabel,
  accept,
  busy,
  multiple = false,
  onFiles,
  primary,
}: {
  label: string;
  busyLabel?: string;
  /** What the hidden file box is called for screen readers and tests. */
  chooserLabel: string;
  /** Extensions without the dot. */
  accept: string[];
  busy: boolean;
  multiple?: boolean;
  /** The chosen files, not yet checked: the caller checks them, as it does a drop. */
  onFiles: (files: File[]) => void;
  primary?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        aria-label={chooserLabel}
        accept={accept.map((e) => `.${e}`).join(",")}
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <Button variant={primary ? "primary" : "plain"} onClick={() => !busy && input.current?.click()} aria-disabled={busy || undefined}>
        {busy ? busyLabel : label}
      </Button>
    </>
  );
}
