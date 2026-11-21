import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { ApiErrorBody } from "../../shared/types";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, "not_found", `${what} was not found.`);
export const forbidden = () => new AppError(403, "forbidden", "Only an admin can do this.");

/** A validation problem in plain words. Messages written for this app pass through; the validator's stock ones are replaced. */
function plainIssue(issue: { code?: string; message: string; input?: unknown }): string {
  const stock = /^(Invalid|Too big|Too small|Unrecognized)/.test(issue.message);
  if (!stock) return issue.message;
  if (issue.code === "invalid_type")
    return issue.message.includes("received undefined") || issue.message.includes("received null") ? "This is required." : "That is not the kind of value expected here.";
  if (issue.code === "invalid_value") return "Choose one of the options.";
  if (issue.code === "too_big") return "That is too long or too large.";
  if (issue.code === "too_small") return "That is too short or too small.";
  if (issue.code === "invalid_format") return "That is not written the way it should be.";
  return "That value is not valid.";
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  let status = 500;
  let body: ApiErrorBody = { error: { code: "internal", message: "Something went wrong on our side. Try again." } };
  if (err instanceof AppError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, fields: err.fields } };
  } else if (err instanceof ZodError) {
    status = 400;
    const fields: Record<string, string> = {};
    for (const issue of err.issues) fields[issue.path.join(".") || "_"] = plainIssue(issue);
    body = { error: { code: "invalid", message: "Some of what was entered is not valid.", fields } };
  } else if (err?.name === "MulterError") {
    status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    body = { error: { code: "file_refused", message: err.code === "LIMIT_FILE_SIZE" ? "That file is larger than 25 MB." : "That file could not be received." } };
  } else if (err?.type === "entity.too.large") {
    status = 413;
    body = { error: { code: "too_large", message: "That is too much to send at once." } };
  } else if (err?.type === "entity.parse.failed" || (err?.expose === true && typeof err?.status === "number" && err.status >= 400 && err.status < 500)) {
    status = err.status ?? 400;
    body = { error: { code: "bad_request", message: "The request could not be read." } };
  } else {
    console.error(err);
  }
  res.status(status).json(body);
};
