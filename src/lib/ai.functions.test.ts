import { describe, it, expect } from "vitest";
import {
  decodePdfDataUrl,
  ExtractPdfInputSchema,
  MAX_PDF_BYTES,
  MAX_PDF_DATA_URL_CHARS,
} from "./ai.functions";

// Real PDF header bytes ("%PDF-1.4..."), which is what the sniffer reads.
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];
// A renamed non-PDF (plain text), the case this guards against.
const NOT_PDF = [0x68, 0x65, 0x6c, 0x6c, 0x6f]; // "hello"

const toDataUrl = (bytes: number[], mime = "application/pdf") =>
  `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`;

describe("decodePdfDataUrl", () => {
  it("decodes a real PDF and reports its declared mime and bytes", () => {
    const { mime, bytes } = decodePdfDataUrl(toDataUrl(PDF_HEADER));
    expect(mime).toBe("application/pdf");
    expect(Array.from(bytes)).toEqual(PDF_HEADER);
  });

  it("rejects a file whose content is not a PDF, regardless of the declared type", () => {
    // Declared as application/pdf, actually plain text — the declared type is
    // a claim by the uploader, same as media-validate.ts treats images.
    expect(() => decodePdfDataUrl(toDataUrl(NOT_PDF))).toThrow(/not a PDF/i);
  });

  it("rejects a string that is not a data URL at all", () => {
    expect(() => decodePdfDataUrl("not-a-data-url")).toThrow(/data:application\/pdf;base64/i);
  });

  it("rejects base64 that cannot be decoded", () => {
    expect(() => decodePdfDataUrl("data:application/pdf;base64,not_valid_base64!!!")).toThrow(
      /could not be decoded/i,
    );
  });
});

describe("ExtractPdfInputSchema", () => {
  it("accepts a PDF data URL within the 20MB limit", () => {
    const result = ExtractPdfInputSchema.safeParse({ dataUrl: toDataUrl(PDF_HEADER) });
    expect(result.success).toBe(true);
  });

  it("rejects a data URL string longer than the 20MB-equivalent character cap", () => {
    // The client (guia.tsx:62) already refuses a file over 20MB; the server
    // must independently refuse a data-URL string over the equivalent
    // base64-inflated length, without ever decoding it.
    const oversized = "data:application/pdf;base64," + "A".repeat(MAX_PDF_DATA_URL_CHARS);
    const result = ExtractPdfInputSchema.safeParse({ dataUrl: oversized });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/20MB limit/);
    }
  });

  it("rejects a value that isn't a data URL", () => {
    const result = ExtractPdfInputSchema.safeParse({ dataUrl: "https://example.com/brand.pdf" });
    expect(result.success).toBe(false);
  });

  it("keeps the server cap in step with the 20MB the client claims", () => {
    expect(MAX_PDF_BYTES).toBe(20 * 1024 * 1024);
  });
});
