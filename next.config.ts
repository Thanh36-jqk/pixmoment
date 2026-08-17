import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.vercel-storage.com" },
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
};

// Only wrap (enable Sentry build instrumentation + source-map upload) when
// Sentry is actually configured; otherwise ship the plain config so builds
// without Sentry env are unaffected.
export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
    })
  : nextConfig;
