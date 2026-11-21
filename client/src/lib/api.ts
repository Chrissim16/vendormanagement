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

export async function api<T>(path: string, options: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const qs = params.toString();
  let res: Response;
  try {
    res = await fetch(`/api${path}${qs ? `?${qs}` : ""}`, {
      method: options.method ?? "GET",
      headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      credentials: "same-origin",
    });
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
