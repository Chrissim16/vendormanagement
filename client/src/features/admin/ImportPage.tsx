import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, messageOf } from "../../lib/api";
import { DropZone, FileButton, oneFileProblem } from "../../platform/files";
import { Button, EmptyState, ErrorState, PageHeader, Pill } from "../../platform/ui";

interface Row {
  sheet: string;
  row: number;
  label: string;
  outcome: "add" | "exists" | "invalid";
  problems: string[];
}
interface Result {
  rows: Row[];
  counts: { add: number; exists: number; invalid: number };
  applied: boolean;
}
const outcome = { add: ["ok", "Will be added"], exists: ["none", "Already there"], invalid: ["bad", "Has problems"] } as const;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Bring vendors and agreements in from the Excel template: check first, then import (A-8). */
export function ImportPage() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: ({ f, apply }: { f: File; apply: boolean }) => api<Result>(`/admin/import/${apply ? "apply" : "preview"}`, { file: f }),
    onSuccess: async (r) => {
      if (r.applied) await qc.invalidateQueries();
    },
  });
  const r = run.data;
  const reset = () => {
    setFile(null);
    setProblem(null);
    run.reset();
  };
  // A-8, X-7: one file, picked or dropped, checked before it is sent.
  const choose = (files: File[]) => {
    const why = oneFileProblem(files, ["xlsx"]);
    if (why) return setProblem(why);
    setProblem(null);
    setFile(files[0]!);
    run.mutate({ f: files[0]!, apply: false });
  };

  return (
    <>
      <PageHeader context="Bring in vendors and agreements from Excel" title="Import">
        <a
          href="/api/admin/import/template.xlsx"
          download
          className="inline-flex h-[38px] items-center rounded-full border border-line-2 px-[18px] text-[13.5px] font-semibold transition hover:bg-sunk active:scale-[.96]"
        >
          Download the template
        </a>
      </PageHeader>
      <ol className="-mt-4 flex max-w-[70ch] list-decimal flex-col gap-1.5 pl-5 text-ink-2">
        <li>Download the template and fill in the Vendors and Agreements sheets. Each has a help sheet next to it.</li>
        <li>Choose the file here. Nothing is saved yet: you first see what each row would do.</li>
        <li>Import the rows that are fine. Rows with problems are skipped, and rows already in the app are left alone, so the same file can be imported again safely.</li>
      </ol>
      <DropZone enabled label="Drop the filled-in template here" busy={run.isPending} onFiles={choose} onProblem={setProblem} className="flex flex-wrap items-center gap-3">
        <FileButton
          label={file ? "Choose another file" : "Choose the filled-in template"}
          busyLabel={file ? "Choose another file" : "Choose the filled-in template"}
          chooserLabel="Choose the filled-in template"
          accept={["xlsx"]}
          busy={run.isPending}
          primary={!r}
          onFiles={choose}
        />
        {file && <span className="text-ink-2">{file.name}</span>}
      </DropZone>
      {problem && <ErrorState message={problem} />}

      {run.isPending && <p className="text-ink-2">{run.variables?.apply ? "Importing" : "Checking the file"}…</p>}
      {run.isError && <ErrorState message={messageOf(run.error)} />}
      {r && (
        <>
          {r.applied ? (
            <EmptyState title={`Imported ${plural(r.counts.add, "row")}`} action={<Button onClick={reset}>Import another file</Button>}>
              {plural(r.counts.exists, "row")} already in the app {r.counts.exists === 1 ? "was" : "were"} left alone, and {plural(r.counts.invalid, "row")} with problems{" "}
              {r.counts.invalid === 1 ? "was" : "were"} skipped.
            </EmptyState>
          ) : (
            <div className="flex flex-wrap items-center gap-4 rounded-tile bg-sunk px-8 py-6">
              <p className="min-w-0 flex-1">
                <span className="font-semibold">{plural(r.counts.add, "row")} can be imported.</span> {plural(r.counts.exists, "row")} already in the app,{" "}
                {plural(r.counts.invalid, "row")} with problems.
              </p>
              <Button onClick={reset}>Cancel</Button>
              <Button variant="primary" aria-disabled={r.counts.add === 0 || undefined} onClick={() => r.counts.add > 0 && file && run.mutate({ f: file, apply: true })}>
                Import {plural(r.counts.add, "row")}
              </Button>
            </div>
          )}
          <table aria-label="Rows in the file" className="w-full border-collapse text-left">
            <thead>
              <tr className="text-[12.5px] font-medium text-ink-3">
                <th scope="col" className="w-28 px-3 py-2.5 font-medium">
                  Sheet
                </th>
                <th scope="col" className="w-16 px-3 py-2.5 font-medium">
                  Row
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  What
                </th>
                <th scope="col" className="w-36 px-3 py-2.5 font-medium">
                  Result
                </th>
                <th scope="col" className="w-[38%] px-3 py-2.5 font-medium">
                  Problems
                </th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={`${x.sheet}-${x.row}`} className="border-t border-line align-top">
                  <td className="px-3 py-3 text-ink-2">{x.sheet}</td>
                  <td className="num px-3 py-3 text-ink-2">{x.row}</td>
                  <td className="px-3 py-3 font-semibold">{x.label}</td>
                  <td className="px-3 py-3">
                    <Pill tone={outcome[x.outcome][0]}>{r.applied && x.outcome === "add" ? "Added" : outcome[x.outcome][1]}</Pill>
                  </td>
                  <td className="px-3 py-3 text-ink-2">
                    {x.problems.map((p) => (
                      <p key={p}>{p}</p>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
