/**
 * A curated, user-safe error message — either our own API's `error` field
 * or a caller-supplied fallback string. Never wraps a raw browser/network
 * exception (a failed fetch, a non-JSON response body, an unexpected
 * runtime error), so it's always safe to render directly to a user.
 */
export class ApiError extends Error {}

/**
 * Parses a fetch Response into its JSON body, throwing an ApiError with a
 * safe message either way: the API's own curated `error` field on a
 * non-OK response, or `fallback` if the response wasn't OK, or wasn't
 * valid JSON at all (e.g. a proxy's raw HTML 502 page) — that raw body is
 * never surfaced to the user, only logged.
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
    const message = typeof body === "object" && body && "error" in body && typeof body.error === "string" ? body.error : fallback;
    throw new ApiError(message);
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
