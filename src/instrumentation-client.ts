import * as Sentry from "@sentry/nextjs";

// Browser Sentry init. No-op unless NEXT_PUBLIC_SENTRY_DSN is set.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    // Session Replay off by default — opt in via env later if wanted.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

// Instruments client-side navigations (Next's hook).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
