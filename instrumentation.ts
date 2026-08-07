import * as Sentry from "@sentry/nextjs";

/**
 * Error reporting.
 *
 * The motivating bug: lead notification emails were broken in production for
 * weeks and nobody knew. They fail quietly on purpose — the lead is already
 * saved by the time we try to email, so a Resend outage must never turn into a
 * 500 that loses the lead. That trade is right, but it meant the only record of
 * a failure was a console.error nobody was reading.
 *
 * So the point of this file is not crash reporting. Crashes are visible; a
 * roofer eventually says "the widget is broken". It is the handled, swallowed
 * failures that need somewhere to go.
 *
 * No DSN configured → Sentry.init is skipped and every Sentry.* call in the
 * codebase becomes a no-op. Local dev and tests stay silent with no branching
 * at the call sites.
 */
export function register(): void {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || "development",
    // Ties an event to the deploy that produced it. Without it, "when did this
    // start?" is unanswerable.
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    // Low: this is an error tracker, not an APM. Traces are volume we would pay
    // for and not read.
    tracesSampleRate: 0.05,
    // Lead payloads carry homeowner name, phone, email and address. Sentry
    // scrubs common patterns, but the reliable guarantee is not sending bodies,
    // headers or cookies at all.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
      }
      return event;
    },
  });
}

/**
 * Next's hook for errors thrown inside routes. Without it, a route that throws
 * is reported by Vercel but never reaches Sentry.
 */
export const onRequestError = Sentry.captureRequestError;
