// Characterisation tests for safeHttpUrl — the gate that stops a
// provider-supplied permalink from becoming a javascript: href.

import { describe, it, expect } from "vitest";
import { safeHttpUrl } from "./safe-url";

describe("safeHttpUrl", () => {
  it("allows https URLs", () => {
    expect(
      safeHttpUrl("https://www.linkedin.com/feed/update/urn:li:activity:7260000000000000000/"),
    ).toBe("https://www.linkedin.com/feed/update/urn:li:activity:7260000000000000000/");
    expect(safeHttpUrl("https://x.com/acme/status/1854000000000000000")).toBe(
      "https://x.com/acme/status/1854000000000000000",
    );
  });

  it("allows http URLs", () => {
    expect(safeHttpUrl("http://example.com/post/1")).toBe("http://example.com/post/1");
  });

  it("normalises the URL through the URL parser", () => {
    // A bare origin gains its trailing slash; the scheme and host are lowercased.
    expect(safeHttpUrl("https://Instagram.com")).toBe("https://instagram.com/");
    expect(safeHttpUrl("HTTPS://example.com/A/B")).toBe("https://example.com/A/B");
  });

  it("preserves query strings and fragments", () => {
    expect(safeHttpUrl("https://example.com/p?utm_source=buffer&x=1#c3")).toBe(
      "https://example.com/p?utm_source=buffer&x=1#c3",
    );
  });

  it("rejects javascript: URLs", () => {
    expect(safeHttpUrl("javascript:alert(document.cookie)")).toBeUndefined();
    // Mixed case / whitespace variants the URL parser still normalises to javascript:
    expect(safeHttpUrl("JaVaScRiPt:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("  javascript:alert(1)  ")).toBeUndefined();
  });

  it("rejects data: URLs", () => {
    expect(
      safeHttpUrl("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="),
    ).toBeUndefined();
  });

  it("rejects file: URLs", () => {
    expect(safeHttpUrl("file:///Users/rod/Desktop/secrets.env")).toBeUndefined();
  });

  it("rejects other non-http schemes", () => {
    expect(safeHttpUrl("vbscript:msgbox(1)")).toBeUndefined();
    expect(safeHttpUrl("mailto:hello@example.com")).toBeUndefined();
    expect(safeHttpUrl("ftp://files.example.com/a.png")).toBeUndefined();
    expect(safeHttpUrl("blob:https://example.com/1234-5678")).toBeUndefined();
  });

  it("rejects empty, null and undefined input", () => {
    expect(safeHttpUrl("")).toBeUndefined();
    expect(safeHttpUrl(null)).toBeUndefined();
    expect(safeHttpUrl(undefined)).toBeUndefined();
  });

  it("rejects malformed input", () => {
    expect(safeHttpUrl("not a url")).toBeUndefined();
    expect(safeHttpUrl("//example.com/protocol-relative")).toBeUndefined();
    expect(safeHttpUrl("/inbox")).toBeUndefined();
    expect(safeHttpUrl("example.com")).toBeUndefined();
    expect(safeHttpUrl("https://")).toBeUndefined();
  });
});
