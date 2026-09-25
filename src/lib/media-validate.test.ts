import { describe, it, expect } from "vitest";
import {
  parseImageDataUrl,
  sniffImageMime,
  mediaStoragePath,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DATA_URL_CHARS,
} from "./media-validate";

// Real leading bytes for each format, which is what the sniffer reads.
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00];
const WEBP = [
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
];
// An MP4: "....ftypisom". This is the renamed-video case the audit describes.
const MP4 = [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d];

const toDataUrl = (bytes: number[], mime = "image/png") =>
  `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`;

describe("sniffImageMime", () => {
  it("identifies each format we accept from its leading bytes", () => {
    expect(sniffImageMime(new Uint8Array(PNG))).toBe("image/png");
    expect(sniffImageMime(new Uint8Array(JPEG))).toBe("image/jpeg");
    expect(sniffImageMime(new Uint8Array(GIF))).toBe("image/gif");
    expect(sniffImageMime(new Uint8Array(WEBP))).toBe("image/webp");
  });

  it("rejects a video container", () => {
    expect(sniffImageMime(new Uint8Array(MP4))).toBeNull();
  });

  it("rejects a RIFF file that is not WEBP, such as a WAV", () => {
    const wav = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45];
    expect(sniffImageMime(new Uint8Array(wav))).toBeNull();
  });

  it("does not read past the end of a truncated file", () => {
    expect(sniffImageMime(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(sniffImageMime(new Uint8Array([]))).toBeNull();
  });
});

describe("parseImageDataUrl", () => {
  it("accepts a real PNG and reports its sniffed type and size", () => {
    const r = parseImageDataUrl(toDataUrl(PNG));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mime).toBe("image/png");
    expect(r.ext).toBe("png");
    expect(r.sizeBytes).toBe(PNG.length);
  });

  it("trusts the content over the declared type", () => {
    // Declared as PNG, actually a JPEG. The stored type must match reality, or
    // the extension and the content-type sent to Buffer disagree.
    const r = parseImageDataUrl(toDataUrl(JPEG, "image/png"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mime).toBe("image/jpeg");
    expect(r.ext).toBe("jpg");
  });

  it("rejects a video renamed as an image, which the file picker cannot catch", () => {
    const r = parseImageDataUrl(toDataUrl(MP4, "image/png"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("not a PNG, JPEG, WebP or GIF");
  });

  it("names the claimed type in the error, so the user can see the mismatch", () => {
    const r = parseImageDataUrl(toDataUrl(MP4, "image/png"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("image/png");
  });

  it("rejects an empty file", () => {
    const r = parseImageDataUrl("data:image/png;base64,");
    expect(r.ok).toBe(false);
  });

  it("rejects input that is not a data URL at all", () => {
    for (const bad of [
      "",
      "   ",
      "https://example.com/x.png",
      "not a url",
      "data:image/png,plain",
    ]) {
      expect(parseImageDataUrl(bad).ok).toBe(false);
    }
  });

  it("rejects an oversized payload on string length, before decoding it", () => {
    // Deliberately built as a long string rather than real bytes: the point is
    // that the guard fires without the payload ever being expanded in memory.
    const huge = `data:image/png;base64,${"A".repeat(MAX_IMAGE_DATA_URL_CHARS + 10)}`;
    const r = parseImageDataUrl(huge);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("larger than");
  });

  it("states the limit in MB so the message is actionable", () => {
    const huge = `data:image/png;base64,${"A".repeat(MAX_IMAGE_DATA_URL_CHARS + 10)}`;
    const r = parseImageDataUrl(huge);
    if (r.ok) return;
    expect(r.error).toMatch(/\d+MB/);
  });

  it("tolerates whitespace inside the base64 payload", () => {
    const b64 = btoa(String.fromCharCode(...PNG));
    const withBreaks = `data:image/png;base64,${b64.slice(0, 4)}\n  ${b64.slice(4)}`;
    expect(parseImageDataUrl(withBreaks).ok).toBe(true);
  });

  it("accepts a data URL carrying a charset parameter", () => {
    const b64 = btoa(String.fromCharCode(...PNG));
    expect(parseImageDataUrl(`data:image/png;charset=utf-8;base64,${b64}`).ok).toBe(true);
  });

  it("keeps the byte ceiling and the character ceiling consistent", () => {
    // The char cap must be the looser of the two, or a legal image would be
    // refused by the cheap check before the real one ever ran.
    expect(MAX_IMAGE_DATA_URL_CHARS).toBeGreaterThan(MAX_IMAGE_BYTES);
  });
});

describe("mediaStoragePath", () => {
  it("puts the workspace id first, which is what the storage policy keys on", () => {
    const ws = "b6f0b4cf-edb4-4c87-9389-f1e71e61de89";
    const path = mediaStoragePath(ws, "png", "fixed-id");
    expect(path).toBe(`${ws}/fixed-id.png`);
    expect(path.split("/")[0]).toBe(ws);
  });

  it("generates a unique id when none is supplied", () => {
    const ws = "b6f0b4cf-edb4-4c87-9389-f1e71e61de89";
    expect(mediaStoragePath(ws, "png")).not.toBe(mediaStoragePath(ws, "png"));
  });
});
