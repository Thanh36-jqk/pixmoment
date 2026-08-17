import { describe, it, expect } from "vitest";
import { inferRawContentType, RAW_EXTENSIONS } from "./rawPhotoTypes";

describe("inferRawContentType", () => {
  it("maps known RAW extensions to a MIME type", () => {
    expect(inferRawContentType("DSC001.NEF")).toBe("image/x-nikon-nef");
    expect(inferRawContentType("shot.cr3")).toBe("image/x-canon-cr3");
    expect(inferRawContentType("a.dng")).toBe("image/x-adobe-dng");
  });

  it("is case-insensitive on the extension", () => {
    expect(inferRawContentType("PHOTO.ARW")).toBe("image/x-sony-arw");
  });

  it("returns null for non-RAW or extensionless names", () => {
    expect(inferRawContentType("photo.jpg")).toBeNull();
    expect(inferRawContentType("noext")).toBeNull();
  });

  it("exposes every mapped extension with a leading dot", () => {
    expect(RAW_EXTENSIONS).toContain(".nef");
    expect(RAW_EXTENSIONS.every((e) => e.startsWith("."))).toBe(true);
  });
});
