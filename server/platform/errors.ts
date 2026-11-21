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

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let status = 500;
  let body: ApiErrorBody = { error: { code: "internal", message: "Something went wrong on our side. Try again." } };
  if (err instanceof AppError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, fields: err.fields } };
  } else if (err instanceof ZodError) {
    status = 400;
    const fields: Record<string, string> = {};
    for (const issue of err.issues) fields[issue.path.join(".") || "_"] = issue.message;
    body = { error: { code: "invalid", message: "Some of what was entered is not valid.", fields } };
  } else {
    console.error(err);
  }
  res.status(status).json(body);
};
