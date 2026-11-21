/** Turns a technical failure into a sentence a non-developer can act on. Never includes secrets. */
export class TokenError extends Error {}

const TIMEOUT_MS = 20_000;
/** Every call to an outside service gets a time limit, so one hung service cannot hang the app. */
export const limit = (ms = TIMEOUT_MS) => AbortSignal.timeout(ms);

export function explain(e: unknown): { cause: string; fix?: string } {
  const err = e as { message?: string; name?: string; code?: string; status?: number; cause?: { code?: string } };
  const code = err.code ?? err.cause?.code ?? "";
  if (e instanceof TokenError) {
    return {
      cause: "The app could not sign in to Databricks as itself.",
      fix: "Check that the app is running inside Databricks Apps, which supplies the app's own sign-in details.",
    };
  }
  if (err.name === "TimeoutError" || err.name === "AbortError" || code === "ETIMEDOUT")
    return { cause: "The service did not answer in time.", fix: "Try again. If it keeps happening, the service may be down or not reachable from the app." };
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { cause: "The service's address could not be found.", fix: "Check the address in the app settings." };
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || err.message === "fetch failed") {
    return { cause: "The service could not be reached.", fix: "Check the address in the app settings, and ask IT whether the app is allowed to connect to it." };
  }
  if (err.status === 401 || err.status === 403 || code === "28P01" || code === "28000" || code === "42501") {
    return { cause: "The service refused the app's sign-in or permissions." };
  }
  if (err.status === 404) return { cause: "The service says what the app asked for does not exist." };
  if (code === "EACCES" || code === "EPERM" || code === "ENOSPC") return { cause: "The app is not allowed to write there, or the disk is full." };
  if (err.status && err.status >= 500) return { cause: "The service reported a problem on its side." };
  return { cause: "An unexpected problem occurred." };
}
