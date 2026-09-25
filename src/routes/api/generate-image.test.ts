import { describe, it, expect } from "vitest";
import { parseGenerateImageBody } from "./generate-image";

// Real leading bytes for a PNG and an MP4, which is what the sniffer reads.
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00];
const MP4 = [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d];

const toDataUrl = (bytes: number[], mime = "image/png") =>
  `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`;

const validBody = () => ({
  prompt: "A product shot on a marble table",
  references: [toDataUrl(PNG)],
});

describe("parseGenerateImageBody", () => {
  it("accepts a well-formed request", () => {
    const result = parseGenerateImageBody(validBody());
    expect(result.ok).toBe(true);
  });

  it("accepts a request with no references at all", () => {
    const result = parseGenerateImageBody({ prompt: "A product shot" });
    expect(result.ok).toBe(true);
  });

  // This route used to read the body as `(await request.json()) as Body` with
  // no runtime validation at all (docs/bugs.md finding 25): prompt length,
  // reference count, and reference size/type were all unbounded.

  it("rejects a missing prompt", () => {
    const result = parseGenerateImageBody({});
    expect(result.ok).toBe(false);
  });

  it("rejects a prompt over the 4000-character limit", () => {
    const result = parseGenerateImageBody({ prompt: "a".repeat(4001) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/4000-character limit/);
  });

  it("rejects more than 6 references", () => {
    const result = parseGenerateImageBody({
      prompt: "A product shot",
      references: Array(7).fill(toDataUrl(PNG)),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at most 6 reference images/);
  });

  it("accepts exactly 6 references", () => {
    const result = parseGenerateImageBody({
      prompt: "A product shot",
      references: Array(6).fill(toDataUrl(PNG)),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a reference that isn't really an image, naming its position", () => {
    const result = parseGenerateImageBody({
      prompt: "A product shot",
      references: [toDataUrl(PNG), toDataUrl(MP4)],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^Reference image 2:/);
  });

  it("rejects style notes over the 6000-character limit", () => {
    const result = parseGenerateImageBody({
      prompt: "A product shot",
      styleNotes: "a".repeat(6001),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/6000-character limit/);
  });

  it("rejects a non-uuid workspaceId instead of silently ignoring it", () => {
    const result = parseGenerateImageBody({ prompt: "A product shot", workspaceId: "not-a-uuid" });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown aspect value", () => {
    const result = parseGenerateImageBody({ prompt: "A product shot", aspect: "wide" });
    expect(result.ok).toBe(false);
  });
});
