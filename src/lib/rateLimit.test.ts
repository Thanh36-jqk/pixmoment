import { describe, it, expect } from "vitest";
import { getClientIp, isRateLimited } from "./rateLimit";

function reqWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/upload", { headers });
}

describe("getClientIp", () => {
  it("takes the first entry of x-forwarded-for", () => {
    expect(getClientIp(reqWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("trims whitespace around the forwarded ip", () => {
    expect(getClientIp(reqWith({ "x-forwarded-for": "  9.9.9.9 ,10.0.0.1" }))).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip, then to 'unknown'", () => {
    expect(getClientIp(reqWith({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
    expect(getClientIp(reqWith({}))).toBe("unknown");
  });
});

describe("isRateLimited", () => {
  it("fails open (never limits) when no limiter is configured", async () => {
    expect(await isRateLimited(null, "1.2.3.4")).toBe(false);
  });
});
