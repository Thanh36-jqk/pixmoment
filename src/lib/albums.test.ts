import { describe, it, expect } from "vitest";
import { getExpiryDate, VALID_ALBUM_ID } from "./albums";

describe("getExpiryDate", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("returns undefined for 'never' and unknown values", () => {
    expect(getExpiryDate("never", now)).toBeUndefined();
    expect(getExpiryDate("", now)).toBeUndefined();
    expect(getExpiryDate("garbage", now)).toBeUndefined();
  });

  it("adds the right offset for 1d / 7d / 30d", () => {
    expect(getExpiryDate("1d", now)).toBe("2026-01-02T00:00:00.000Z");
    expect(getExpiryDate("7d", now)).toBe("2026-01-08T00:00:00.000Z");
    expect(getExpiryDate("30d", now)).toBe("2026-01-31T00:00:00.000Z");
  });
});

describe("VALID_ALBUM_ID", () => {
  it("accepts nanoid-shaped ids", () => {
    expect(VALID_ALBUM_ID.test("V1StGXR8_Z")).toBe(true);
    expect(VALID_ALBUM_ID.test("abc-DEF_123")).toBe(true);
  });

  it("rejects path-traversal and illegal characters", () => {
    expect(VALID_ALBUM_ID.test("../secret")).toBe(false);
    expect(VALID_ALBUM_ID.test("a/b")).toBe(false);
    expect(VALID_ALBUM_ID.test("a.json")).toBe(false);
    expect(VALID_ALBUM_ID.test("")).toBe(false);
  });
});
