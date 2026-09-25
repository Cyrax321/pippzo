import { describe, it, expect } from "vitest";
import { parseReferenceImageDataUrl } from "./video-gen.functions";
import { MAX_IMAGE_DATA_URL_CHARS } from "./media-validate";

// Real leading bytes for a PNG and a JPEG, which is what the sniffer reads.
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00];
const NOT_AN_IMAGE = [0x68, 0x65, 0x6c, 0x6c, 0x6f]; // "hello"

const toDataUrl = (bytes: number[], mime = "image/png") =>
  `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`;

describe("parseReferenceImageDataUrl", () => {
  it("accepts a real image and returns its sniffed mime plus re-encoded bytes", () => {
    const out = parseReferenceImageDataUrl(toDataUrl(PNG));
    expect(out.mimeType).toBe("image/png");
    expect(Array.from(Buffer.from(out.bytesBase64Encoded, "base64"))).toEqual(PNG);
  });

  it("rejects content that isn't a real image, regardless of the declared type", () => {
    // This used to just regex-match `data:...;base64,...` and pass along
    // whatever mime the caller claimed — no size cap, no content check
    // (docs/bugs.md finding 25). It must now be sniffed like any other
    // image-shaped input.
    expect(() => parseReferenceImageDataUrl(toDataUrl(NOT_AN_IMAGE))).toThrow(
      /not a PNG, JPEG, WebP or GIF/i,
    );
  });

  it("rejects a payload over the shared 15MB image ceiling before decoding it", () => {
    const oversized = "data:image/png;base64," + "A".repeat(MAX_IMAGE_DATA_URL_CHARS);
    expect(() => parseReferenceImageDataUrl(oversized)).toThrow(/limit/i);
  });

  it("rejects a string that is not a data URL at all", () => {
    expect(() => parseReferenceImageDataUrl("not-a-data-url")).toThrow();
  });
});
