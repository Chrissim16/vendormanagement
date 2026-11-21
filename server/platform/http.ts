import multer from "multer";
import { z } from "zod";
import { MAX_DOCUMENT_BYTES } from "../../shared/agreements";
import { isDay } from "../../shared/dates";
import { AppError } from "./errors";

/** Free text from a search box: trimmed, bounded, and without control characters the database rejects. */
export const text = z
  .string()
  .trim()
  .max(200)
  .refine((v) => ![...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127), "That contains characters that cannot be searched for.");

/** A real calendar day, written YYYY-MM-DD. */
export const day = z.string().refine(isDay, "That date does not exist. Use a date like 2026-11-21.");

export const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) };
export const dir = z.enum(["asc", "desc"]).default("asc");
export const bool = z.enum(["true", "false"]).transform((v) => v === "true");
export const id = z.string().uuid();

/** Search text is matched literally: % and _ are not wildcards. */
export const like = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Turns rule failures into the standard "these fields are wrong" reply. */
export function failFields(errors: Record<string, string>): never {
  throw new AppError(400, "invalid", "Some of what was entered is not valid.", errors);
}

/** A database error caused by a unique rule, whichever driver raised it. */
export const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
};

/**
 * A CSV file that opens correctly in Excel: a byte-order mark so accents survive, CRLF
 * line ends, every value quoted. Values that Excel would run as a formula are neutralised.
 */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    let s = v == null ? "" : String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return "﻿" + [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** One uploaded file, held in memory, at most 25 MB. Used as `upload.single("file")`. */
export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } });
