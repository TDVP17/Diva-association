/**
 * A curated, user-safe error message — by default the caller-supplied,
 * already-translated `fallback` string. Never wraps a raw browser/network
 * exception, and never surfaces the API's own `error` field directly
 * either: every API route's `error` text is hardcoded English, so showing
 * it verbatim would break the app's language switch for anyone using it in
 * French. The server's real message is still logged for debugging.
 *
 * A route that needs to surface a *specific* reason (which of several
 * fields failed, and why) instead of a generic fallback can additionally
 * return `errorKey`/`errorVars` — an i18n key + {placeholder} values from
 * translations.ts — which `friendlyErrorMessage` below resolves through the
 * normal translation table, so the detail is still fully localized rather
 * than raw English.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly errorKey?: string,
    readonly errorVars?: Record<string, string>,
  ) {
    super(message);
  }
}

/**
 * Parses a fetch Response into its JSON body, throwing an ApiError with
 * `fallback` on any non-OK response or invalid JSON body (e.g. a proxy's
 * raw HTML 502 page) — the server's own message is logged, never shown
 * verbatim. If the body carries `errorKey`/`errorVars`, they're attached to
 * the thrown ApiError so a caller that wants the specific translated
 * message (not just the generic fallback) can ask for it via
 * `friendlyErrorMessage`'s `translate` argument.
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
    const record = typeof body === "object" && body ? (body as Record<string, unknown>) : null;
    const serverMessage = record && typeof record.error === "string" ? record.error : null;
    const errorKey = record && typeof record.errorKey === "string" ? record.errorKey : undefined;
    const errorVars =
      record && typeof record.errorVars === "object" && record.errorVars
        ? (record.errorVars as Record<string, string>)
        : undefined;
    if (serverMessage) console.error("[parseJsonOrThrow] server error:", serverMessage);
    throw new ApiError(fallback, errorKey, errorVars);
  }
  return body as T;
}

/**
 * Safe message for a catch block around a fetch call. Any thrown value that
 * isn't our own ApiError (a network failure, a TypeError, anything
 * unexpected) is logged and replaced with `fallback` so raw technical text
 * never reaches a user.
 *
 * For an ApiError, `fallback` is still the default — unless the caller
 * passes `translate` (the page's own `t`/`translate` function) AND the
 * error carries a valid `errorKey`, in which case the specific, fully
 * localized server message is shown instead. An unrecognized/missing key
 * silently falls back to `fallback` rather than throwing.
 */
export function friendlyErrorMessage(
  err: unknown,
  fallback: string,
  translate?: (key: string, vars?: Record<string, string>) => string | undefined,
): string {
  if (err instanceof ApiError) {
    if (err.errorKey && translate) {
      const translated = translate(err.errorKey, err.errorVars);
      if (translated) return translated;
    }
    return err.message;
  }
  console.error("[friendlyErrorMessage] unexpected error:", err);
  return fallback;
}
