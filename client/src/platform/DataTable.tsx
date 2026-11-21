import clsx from "clsx";
import { ArrowDown, ArrowUp } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { item, list } from "../lib/motion";

export interface Column<T> {
  key: string;
  header: string;
  /** The server's sort name; leave out for a column that cannot be sorted. */
  sort?: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

interface Props<T> {
  label: string;
  rows: T[];
  columns: Column<T>[];
  rowId: (row: T) => string;
  /** Name read to screen readers for the row's open button, usually the first column's text. */
  rowLabel: (row: T) => string;
  sort?: string;
  dir?: string;
  onSort?: (sort: string, dir: "asc" | "desc") => void;
  onOpen?: (row: T) => void;
  selectedId?: string;
  /** When a record is open beside the list, only the first column is shown. */
  compact?: boolean;
}

/** The list pattern used on every list page. Sorting and selection are held in the address by the page. */
export function DataTable<T>({ label, rows, columns, rowId, rowLabel, sort, dir, onSort, onOpen, selectedId, compact }: Props<T>) {
  const shown = compact ? columns.slice(0, 1) : columns;
  return (
    <table aria-label={label} className="w-full border-collapse text-left">
      <thead>
        <tr>
          {shown.map((c) => {
            const active = c.sort && c.sort === sort;
            return (
              <th
                key={c.key}
                scope="col"
                aria-sort={active ? (dir === "desc" ? "descending" : "ascending") : undefined}
                className={clsx("px-3 py-2.5 text-[12.5px] font-medium text-ink-3", c.className)}
              >
                {c.sort && onSort && !compact ? (
                  <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => onSort(c.sort!, active && dir !== "desc" ? "desc" : "asc")}>
                    {c.header}
                    {active && (dir === "desc" ? <ArrowDown size={12} aria-hidden /> : <ArrowUp size={12} aria-hidden />)}
                  </button>
                ) : (
                  c.header
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <motion.tbody variants={list} initial="initial" animate="animate">
        {rows.map((row) => {
          const id = rowId(row);
          const selected = id === selectedId;
          return (
            <motion.tr
              key={id}
              variants={item}
              className={clsx("group relative border-t border-line transition-colors", onOpen && "hover:bg-sunk", selected && "bg-tint hover:bg-tint")}
            >
              {shown.map((c, i) => (
                <td key={c.key} className={clsx("max-w-0 truncate px-3 py-[15px]", c.className)}>
                  {i === 0 && selected && <span aria-hidden className="absolute bottom-2.5 left-0 top-2.5 w-[3px] rounded-full bg-accent" />}
                  {i === 0 && onOpen ? (
                    <button
                      aria-label={`Open ${rowLabel(row)}`}
                      aria-current={selected ? "true" : undefined}
                      onClick={() => onOpen(row)}
                      className="block w-full truncate text-left font-semibold after:absolute after:inset-0"
                    >
                      {c.cell(row)}
                    </button>
                  ) : (
                    c.cell(row)
                  )}
                </td>
              ))}
            </motion.tr>
          );
        })}
      </motion.tbody>
    </table>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const btn = "rounded-full border border-line-2 px-4 py-1.5 text-[13px] font-semibold hover:bg-sunk disabled:opacity-40";
  return (
    <nav aria-label="Pages" className="flex items-center gap-3 pt-4 text-[13px] text-ink-2">
      <button className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span className="num">
        Page {page} of {pages}
      </span>
      <button className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}
