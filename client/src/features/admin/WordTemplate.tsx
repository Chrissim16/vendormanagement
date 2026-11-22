import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { MARKS, markLabels, markMeaning, type TemplateFound, type WordTemplateInfo } from "../../../../shared/wordTemplate";
import { api, messageOf } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { ConfirmButton, ErrorState, Loading, Pill } from "../../platform/ui";
import { downloadClass, FileButton, kb } from "../rfp/parts";

const list = (places: string[]) => (places.length > 1 ? `${places.slice(0, -1).join(", ")} and ${places[places.length - 1]}` : places[0]);

/** Q-14: what the app found in the template, one line per thing, with what happens where something is missing. */
function Found({ found }: { found: TemplateFound }) {
  const rows: { label: string; ok: boolean; text: string }[] = [
    {
      label: "Cover page",
      ok: found.coverPage,
      text: found.coverPage ? "Kept as it is; the RFP's text starts on the page after it." : "The template has no words or pictures of its own, so the files have no cover page.",
    },
    ...MARKS.map((m) => ({
      label: markLabels[m],
      ok: found.marks[m].length > 0,
      text: found.marks[m].length
        ? `Found on the ${list(found.marks[m])}. Becomes ${markMeaning[m]}.`
        : `Not found. Type ${markLabels[m]} on the cover page where ${markMeaning[m]} should appear, and upload the template again.`,
    })),
    { label: "Header", ok: found.header, text: found.header ? "Kept on every page." : "The template has none." },
    { label: "Footer", ok: found.footer, text: found.footer ? "Kept on every page." : "The template has none." },
    {
      label: "Pictures",
      ok: found.pictures > 0,
      text: found.pictures
        ? found.pictures === 1
          ? "One picture, such as a logo, kept where it is."
          : `${found.pictures} pictures, such as the logo, kept where they are.`
        : "None, so no logo.",
    },
    { label: "Font", ok: !!found.font, text: found.font ? `The text is set in ${found.font}, as in the template.` : "The template does not name one; Word's own is used." },
    {
      label: "Headings",
      ok: !!found.styles.heading1,
      text: found.styles.heading1
        ? `The template's ${[found.styles.heading1, found.styles.heading2, found.styles.heading3].filter(Boolean).join(", ")}.`
        : "No heading styles found, so headings are set in plain bold.",
    },
    {
      label: "Lists",
      ok: !!(found.styles.listBullet || found.styles.listNumber),
      text:
        found.styles.listBullet || found.styles.listNumber
          ? `The template's ${[found.styles.listBullet, found.styles.listNumber].filter(Boolean).join(" and ")}.`
          : "No list styles found, so the app's own bullets and numbers are used.",
    },
    {
      label: "Tables",
      ok: !!found.styles.table,
      text: found.styles.table ? `The template's ${found.styles.table}.` : "No table style found, so tables get thin grey lines.",
    },
  ];
  return (
    <ul aria-label="What the app found in the template" className="flex flex-col">
      {rows.map((r) => (
        <li key={r.label} className="flex items-start gap-4 border-b border-line py-2.5">
          <span className="w-28 shrink-0 font-semibold">{r.label}</span>
          <span className="w-24 shrink-0">
            <Pill tone={r.ok ? "ok" : "warn"}>{r.ok ? "Found" : "Missing"}</Pill>
          </span>
          <span className="min-w-0 flex-1 text-ink-2">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Q-14: the company's Word template, uploaded by an admin; every RFP Word file is made from it. */
export function WordTemplateSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["word-template"], queryFn: () => api<WordTemplateInfo>("/admin/word-template") });
  const [problem, setProblem] = useState<string | null>(null);
  const done = async (info: WordTemplateInfo, message: string) => {
    qc.setQueryData(["word-template"], info);
    setProblem(null);
    toast.success(message);
    await qc.invalidateQueries({ queryKey: ["history"] });
  };
  const upload = useMutation({
    mutationFn: (file: File) => api<WordTemplateInfo>("/admin/word-template", { method: "POST", file }),
    onSuccess: (info) => done(info, "Template uploaded. Word files made from now on use it."),
    onError: (e) => setProblem(messageOf(e)),
  });
  const plain = useMutation({
    mutationFn: () => api<WordTemplateInfo>("/admin/word-template", { method: "DELETE" }),
    onSuccess: (info) => done(info, "The app's plain layout is used again."),
    onError: (e) => setProblem(messageOf(e)),
  });
  const current = q.data?.current;
  return (
    <section aria-labelledby="word-template" className="flex max-w-[760px] flex-col gap-4">
      <div>
        <h2 id="word-template" className="text-base font-semibold">
          Word template
        </h2>
        <p className="mt-1 text-ink-2">
          Every RFP Word file, the review copy and the copy for each candidate, is made from this template: its cover page, header and footer, logo, fonts and spacing, and its
          heading, list and table styles for the RFP&apos;s own text. On the cover page, type [Title], [Date] and [Version] where they should appear; everything else on it is kept
          as it is. A new upload is used for files made from then on.
        </p>
      </div>
      {q.isPending ? (
        <Loading rows={2} />
      ) : q.isError ? (
        <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <p role="status" className="rounded-2xl bg-sunk px-5 py-4">
            {current ? (
              <>
                In use: <span className="font-semibold">{current.fileName}</span> ({kb(current.sizeBytes)}), uploaded by {current.uploadedBy} on{" "}
                <span className="num">{formatDateTime(current.uploadedAt)}</span>.
              </>
            ) : (
              "No template has been uploaded, so the app's own plain layout is used: a simple cover page with the title, the date and the version."
            )}
          </p>
          {current && <Found found={current.found} />}
          {problem && <ErrorState message={problem} />}
          <div className="flex flex-wrap items-center gap-2.5">
            <FileButton
              label={current ? "Upload a new template" : "Upload template"}
              chooserLabel="Choose the Word template"
              accept={["dotx", "docx"]}
              wrongType="Choose a Word template (.dotx) or a Word document (.docx)."
              maxBytes={10 * 1024 * 1024}
              busy={upload.isPending}
              onFile={(f) => upload.mutate(f)}
              onProblem={setProblem}
              primary={!current}
            />
            {current && (
              <a href="/api/admin/word-template/file" download className={downloadClass}>
                Download the template in use
              </a>
            )}
            <a href="/api/admin/word-template/example" download className={downloadClass}>
              Download an example template
            </a>
            {current && (
              <ConfirmButton label="Use the plain layout instead" confirm="Really use the plain layout?" onConfirm={() => plain.mutate()} disabled={plain.isPending}>
                Use the plain layout instead
              </ConfirmButton>
            )}
          </div>
          <p className="text-[13px] text-ink-2">The example is an invented organisation&apos;s template, to see how a template is used. The company&apos;s own stays at work.</p>
        </>
      )}
    </section>
  );
}
