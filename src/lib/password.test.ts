import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies a correct password against its own hash", () => {
    const stored = hashPassword("s3cret!");
    expect(verifyPassword("s3cret!", stored)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const stored = hashPassword("s3cret!");
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("salts each hash — same password hashes differently", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("returns false for a malformed stored value instead of throwing", () => {
    expect(verifyPassword("x", "no-colon-here")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
  });

  it("is case- and whitespace-sensitive", () => {
    const stored = hashPassword("Abc");
    expect(verifyPassword("abc", stored)).toBe(false);
    expect(verifyPassword("Abc ", stored)).toBe(false);
  });
});
