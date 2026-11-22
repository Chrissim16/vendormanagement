import clsx from "clsx";
import type { ReactNode } from "react";
import type { Block, Run } from "../../../shared/richtext";

/**
 * Formatted text as it reads (Q-12): the same headings, lists, emphasis and tables the
 * editor and the Word file show. With `marked`, the words whose place in reading order is
 * in the set are shown as removed or added, for the differences of an AI rewrite.
 */
export function RichText({ blocks, marked, mark, className }: { blocks: Block[]; marked?: Set<number>; mark?: "added" | "removed"; className?: string }) {
  let word = 0;
  const runs = (list: Run[]): ReactNode =>
    list.map((r, i) => {
      const pieces = r.text.split(/(\s+)/).map((piece, n) => {
        if (!piece || /^\s+$/.test(piece)) return piece;
        const on = marked?.has(word++);
        if (!on) return piece;
        return mark === "removed" ? (
          <del key={n} className="rounded-sm bg-[var(--crit-tint)] text-[var(--crit-text)]">
            {piece}
          </del>
        ) : (
          <ins key={n} className="rounded-sm bg-[var(--ok-tint)] text-[var(--ok-text)] no-underline">
            {piece}
          </ins>
        );
      });
      const inner = <>{pieces}</>;
      if (r.bold && r.italic)
        return (
          <strong key={i}>
            <em>{inner}</em>
          </strong>
        );
      if (r.bold) return <strong key={i}>{inner}</strong>;
      if (r.italic) return <em key={i}>{inner}</em>;
      return <span key={i}>{inner}</span>;
    });
  return (
    <div className={clsx("rich", className)}>
      {blocks.map((b, i) => {
        if (b.kind === "paragraph") return <p key={i}>{runs(b.runs)}</p>;
        if (b.kind === "heading") return b.level === 2 ? <h4 key={i}>{runs(b.runs)}</h4> : <h5 key={i}>{runs(b.runs)}</h5>;
        if (b.kind === "list") {
          const items = b.items.map((it, n) => <li key={n}>{runs(it)}</li>);
          return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
        }
        const [head, ...rest] = b.rows;
        return (
          <div key={i} className="rich-table">
            <table>
              {head && (
                <thead>
                  <tr>
                    {head.map((c, n) => (
                      <th key={n} scope="col">
                        {runs(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {rest.map((row, r) => (
                  <tr key={r}>
                    {row.map((c, n) => (
                      <td key={n}>{runs(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/** The words of formatted text in reading order, as `RichText` counts them. */
export function wordsOf(blocks: Block[]): string[] {
  const out: string[] = [];
  const add = (list: Run[]) => list.forEach((r) => out.push(...r.text.split(/\s+/).filter(Boolean)));
  for (const b of blocks) {
    if (b.kind === "list") b.items.forEach(add);
    else if (b.kind === "table") b.rows.forEach((row) => row.forEach(add));
    else add(b.runs);
  }
  return out;
}
