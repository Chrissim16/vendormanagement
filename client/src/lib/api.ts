import type { ApiErrorBody } from "../../../shared/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function queryString(query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; query?: Query; file?: File } = {}): Promise<T> {
  let res: Response;
  try {
    let body: BodyInit | undefined;
    let headers: HeadersInit | undefined;
    if (options.file) {
      // A file goes as a form upload; the browser sets the content type itself.
      body = new FormData();
      body.append("file", options.file);
    } else if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers = { "Content-Type": "application/json" };
    }
    res = await fetch(`/api${path}${queryString(options.query)}`, { method: options.method ?? (body ? "POST" : "GET"), headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "offline", "The app could not be reached. Check your connection and try again.");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    throw new ApiError(res.status, body?.error?.code ?? "unknown", body?.error?.message ?? "Something went wrong. Try again.", body?.error?.fields);
  }
  // A sign-in page instead of data means the session ended and the request was redirected.
  if (res.redirected || !res.headers.get("content-type")?.includes("application/json")) {
    throw new ApiError(401, "signed_out", "Your sign-in has ended. Reload the page to sign in again.");
  }
  return res.json() as Promise<T>;
}

export const messageOf = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Try again.");

/** Sends a file and saves the file the server makes from it, under the name the server gives. */
export async function postForFile(path: string, file: File, fallbackName: string): Promise<void> {
  const body = new FormData();
  body.append("file", file);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: "POST", body, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "offline", "The app could not be reached. Check your connection and try again.");
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    throw new ApiError(res.status, err?.error?.code ?? "unknown", err?.error?.message ?? "Something went wrong. Try again.");
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
