/**
 * Dev-only fetch wrapper that logs every outbound call this backend makes —
 * label, method, host + path, status, duration — so during a test run you
 * can watch the terminal and see exactly which third-party APIs got hit and
 * how often, instead of trusting the code reading.
 */

/** Strip PII / column values from PostgREST-style errors before logging. */
export function redact(error: unknown): { code?: string; message: string } {
  if (!error || typeof error !== "object") {
    return { message: "unknown error" };
  }
  const e = error as {
    code?: unknown;
    message?: unknown;
    name?: unknown;
  };
  const code = typeof e.code === "string" ? e.code : undefined;
  // Prefer a short name/code over message — PostgrestError.message/details
  // often embed the offending column values (name, phone, email).
  if (code) {
    return { code, message: typeof e.name === "string" ? e.name : "error" };
  }
  if (typeof e.name === "string") {
    return { message: e.name };
  }
  return { message: "error" };
}

/**
 * The safe half of a Postgres error, from an error's `cause`.
 *
 * redact() is right to throw the message away — PostgrestError.details prints
 * the whole offending row, customer name and phone included. But it is called
 * on our own wrapper, so the underlying failure was reduced to "insert_failed"
 * and nothing else. A check constraint rejected every roof-cleaning lead for
 * weeks and the logs recorded only that an insert had failed.
 *
 * The SQLSTATE and the constraint name are facts about the schema, not about
 * the customer, so both are safe to record. Nothing else is taken.
 */
export function dbCause(cause: unknown): {
  dbCode?: string;
  constraint?: string;
} {
  if (!cause || typeof cause !== "object") return {};
  const c = cause as { code?: unknown; message?: unknown };
  const out: { dbCode?: string; constraint?: string } = {};
  if (typeof c.code === "string") out.dbCode = c.code;
  if (typeof c.message === "string") {
    // e.g.: violates check constraint "leads_job_type_known"
    const named = /constraint "([A-Za-z0-9_]+)"/.exec(c.message);
    if (named) out.constraint = named[1];
  }
  return out;
}

export async function loggedFetch(
  label: string,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const method = init?.method ?? "GET";
  let host = "?";
  let pathname = "";
  try {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const parsed = new URL(url);
    host = parsed.host;
    pathname = parsed.pathname;
  } catch {
    // Scheme-less / invalid URL — surface as config error, not delivery fail.
    throw new Error(`Invalid URL for outbound fetch (${label})`);
  }

  const start = Date.now();

  try {
    const response = await fetch(input, init);
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[outbound] ${label} ${method} ${host}${pathname} -> ${response.status} (${Date.now() - start}ms)`,
      );
    }
    return response;
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[outbound] ${label} ${method} ${host}${pathname} -> FAILED (${Date.now() - start}ms)`,
      );
    }
    throw error;
  }
}
