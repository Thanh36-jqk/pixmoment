import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// The upload token route has no user accounts to authenticate against (per
// Vercel's own guidance: "Without this check, your upload route is open to
// the public"), so per-IP rate limiting is the practical substitute.
// Redis-backed so the count is shared across serverless invocations — an
// in-memory counter would reset per cold start and never actually limit
// anything.
//
// Requires UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (free tier at
// upstash.com). Without them configured, limiting is skipped (fail open)
// so existing deployments don't break — but a warning is logged so the gap
// is visible instead of silent.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

if (!redis && process.env.NODE_ENV !== "test") {
  console.warn(
    "[rateLimit] UPSTASH_REDIS_REST_URL/TOKEN not set — upload endpoints are running without rate limiting."
  );
}

// A batch of 200 photos now issues ~400 token requests in a few minutes —
// one per original PLUS one per thumbnail (see uploadThumbnail) — and each
// internal retry (uploadQueue.ts, up to 2 per original on flaky connections)
// requests a fresh token too. A straight 400 cap would leave zero headroom:
// any retries at all during a full-size batch would self-inflict 429s
// indistinguishable from a real network failure. 1000 gives real headroom for
// that case while still being far below what scripted abuse would need to
// matter.
export const uploadTokenRatelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(1000, "10 m"),
      prefix: "ratelimit:upload-token",
    })
  : null;

export const albumCreateRatelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, "10 m"),
      prefix: "ratelimit:albums",
    })
  : null;

// The album-unlock POST verifies a password, and without a cap it's an open
// brute-force oracle: a password-protected album could be hammered with
// unlimited guesses. Keyed per IP+album (see the route) so guessing one album
// can't exhaust another visitor's budget. 10/min is generous for a human
// mistyping but far below what a scripted guess-loop needs to matter.
export const albumUnlockRatelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "1 m"),
      prefix: "ratelimit:album-unlock",
    })
  : null;

export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function isRateLimited(limiter: Ratelimit | null, identifier: string): Promise<boolean> {
  if (!limiter) return false;
  const { success } = await limiter.limit(identifier);
  return !success;
}
