import * as Sentry from "@sentry/nextjs";

// Server/edge Sentry init. No-op unless SENTRY_DSN is set, so local dev and
// deployments without Sentry configured are completely unaffected.
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
    });
  }
}

// Report nested React Server Component errors to Sentry (Next's hook).
export const onRequestError = Sentry.captureRequestError;
