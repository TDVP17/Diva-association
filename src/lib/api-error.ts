/**
 * A curated, user-safe error message — always the caller-supplied,
 * already-translated `fallback` string. Never wraps a raw browser/network
 * exception, and never surfaces the API's own `error` field directly
 * either: every API route's `error` text is hardcoded English, so showing
 * it verbatim would break the app's language switch for anyone using it in
 * French. The server's real message is still logged for debugging.
 */
export class ApiError extends Error {}

/**
 * Parses a fetch Response into its JSON body, throwing an ApiError with
 * `fallback` on any non-OK response or invalid JSON body (e.g. a proxy's
 * raw HTML 502 page) — the server's own message is logged, never shown.
 */
export async function parseJsonOrThrow<T = Record<string, unknown>>(res: Response, fallback: string): Promise<T> {
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    console.error("[parseJsonOrThrow] non-JSON response body:", err);
    throw new ApiError(fallback);
  }
  if (!res.ok) {
    const serverMessage = typeof body === "object" && body && "error" in body && typeof body.error === "string" ? body.error : null;
    if (serverMessage) console.error("[parseJsonOrThrow] server error:", serverMessage);
    throw new ApiError(fallback);
  }
  return body as T;
}

/**
 * Safe message for a catch block around a fetch call. Only ApiError
 * messages (our own curated strings) are ever shown — any other thrown
 * value (a network failure, a TypeError, anything unexpected) is logged
 * and replaced with `fallback` so raw technical text never reaches a user.
 */
export function friendlyErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  console.error("[friendlyErrorMessage] unexpected error:", err);
  return fallback;
}
