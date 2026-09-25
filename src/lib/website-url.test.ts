// Tests for the competitor-website normaliser (audit finding 52 follow-up).
// normalizeWebsiteUrl is pure, so every case here is an exact input/output pair.

import { describe, it, expect } from "vitest";
import { normalizeWebsiteUrl } from "./website-url";

/** Unwraps a success, failing loudly with the error message if it was not one. */
function url(raw: string | null | undefined): string | undefined {
  const r = normalizeWebsiteUrl(raw);
  if (!r.ok) throw new Error(`expected ${JSON.stringify(raw)} to be accepted: ${r.error}`);
  return r.url;
}

function error(raw: string): string {
  const r = normalizeWebsiteUrl(raw);
  if (r.ok) throw new Error(`expected ${JSON.stringify(raw)} to be rejected, got ${r.url}`);
  return r.error;
}

describe("normalizeWebsiteUrl — the shape from the finding", () => {
  it("turns a bare domain into an https URL", () => {
    // This is the case the finding is about: "example.com" is how most people
    // write a website, and stored raw it is not a URL.
    expect(url("example.com")).toBe("https://example.com");
  });

  it("turns a bare www domain into an https URL", () => {
    expect(url("www.example.com")).toBe("https://www.example.com");
  });

  it("leaves a value that already carries a scheme alone", () => {
    expect(url("https://example.com")).toBe("https://example.com");
    expect(url("http://example.com")).toBe("http://example.com");
  });

  it("rejects something that cannot be made into a URL", () => {
    expect(error("not a url")).toMatch(/not a valid website address/);
  });
});

describe("normalizeWebsiteUrl — blank input", () => {
  it("treats empty, whitespace, null and undefined as 'no website'", () => {
    // The field is optional; blank is not an error, it is absence.
    expect(url("")).toBeUndefined();
    expect(url("   ")).toBeUndefined();
    expect(url("\n\t ")).toBeUndefined();
    expect(url(null)).toBeUndefined();
    expect(url(undefined)).toBeUndefined();
  });
});

describe("normalizeWebsiteUrl — schemeless input gets https", () => {
  it("keeps the path, query and fragment", () => {
    expect(url("example.com/blog")).toBe("https://example.com/blog");
    expect(url("example.com/search?q=a%20b")).toBe("https://example.com/search?q=a%20b");
    expect(url("example.com/docs#intro")).toBe("https://example.com/docs#intro");
  });

  it("keeps an explicit port, which the URL parser would read as a scheme", () => {
    // new URL("example.com:8080/path") parses with protocol "example.com:" —
    // the reason this function tries the https-prefixed form before giving up.
    expect(url("example.com:8080/path")).toBe("https://example.com:8080/path");
  });

  it("accepts a deep subdomain and a multi-part TLD", () => {
    expect(url("blog.eu.example.co.uk")).toBe("https://blog.eu.example.co.uk");
  });

  it("accepts a trailing slash and does not add one to a bare origin", () => {
    expect(url("example.com/")).toBe("https://example.com");
    expect(url("example.com")).toBe("https://example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(url("  example.com  ")).toBe("https://example.com");
    expect(url("  https://example.com  ")).toBe("https://example.com");
  });

  it("repairs a protocol-relative address", () => {
    expect(url("//example.com")).toBe("https://example.com");
  });

  it("accepts an internationalised domain", () => {
    // The URL parser punycodes it; what matters is that it is accepted and
    // comes back as a value new URL() can parse again.
    const out = url("münchen.de") as string;
    expect(out.startsWith("https://")).toBe(true);
    expect(new URL(out).hostname).toMatch(/^xn--/);
  });
});

describe("normalizeWebsiteUrl — values with a scheme are respected verbatim", () => {
  it("does not rewrite case, path or trailing slash", () => {
    expect(url("HTTP://Example.COM/Path/")).toBe("HTTP://Example.COM/Path/");
    expect(url("https://example.com/a/b/")).toBe("https://example.com/a/b/");
  });

  it("keeps an explicit port and query", () => {
    expect(url("https://example.com:8443/x?y=1")).toBe("https://example.com:8443/x?y=1");
  });

  it("accepts localhost with a scheme, which a bare word would not be", () => {
    expect(url("http://localhost:5173")).toBe("http://localhost:5173");
    expect(error("localhost")).toMatch(/not a valid website address/);
  });
});

describe("normalizeWebsiteUrl — rejections name the problem", () => {
  it("rejects a bare word with no dot", () => {
    expect(error("hello")).toMatch(/not a valid website address/);
    expect(error("competitor")).toContain("example.com");
  });

  it("rejects a hostname whose last label cannot be a TLD", () => {
    expect(error("example.c")).toMatch(/not a valid website address/);
  });

  it("rejects a bare IP, because the parser silently repairs numeric hosts", () => {
    // new URL("https://1.2.3") yields the host 1.2.0.3 — storing an address
    // nobody typed is the bug this module exists to prevent. An IP with an
    // explicit scheme is still accepted, verbatim.
    expect(error("1.2.3")).toMatch(/not a valid website address/);
    expect(error("192.168.1.1")).toMatch(/not a valid website address/);
    expect(url("http://192.168.1.1")).toBe("http://192.168.1.1");
  });

  it("rejects a value with spaces in it", () => {
    expect(error("some competitor website")).toMatch(/not a valid website address/);
  });

  it("rejects a javascript: URL and says it is the scheme that is wrong", () => {
    // safeHttpUrl already stops this becoming a clickable href on the read
    // side; this stops it being stored on the write side.
    const msg = error("javascript:alert(1)");
    expect(msg).toContain("javascript");
    expect(msg).toMatch(/not a website/);
  });

  it("rejects a data: URL", () => {
    expect(error("data:text/html,<h1>x</h1>")).toContain("data");
  });

  it("rejects other non-web schemes", () => {
    expect(error("ftp://example.com")).toContain("ftp");
    expect(error("tel:+34600000000")).toContain("tel");
    expect(error("file:///etc/passwd")).toContain("file");
  });

  it("rejects a mailto address rather than reading it as credentials", () => {
    // "https://" + "mailto:hi@example.com" parses as user "mailto", password
    // "hi", host "example.com" — a real host, but not what was typed.
    const msg = error("mailto:hi@example.com");
    expect(msg).toContain("mailto");
    expect(msg).toMatch(/email address or a login/);
  });

  it("rejects an address with embedded credentials", () => {
    expect(error("user:password@example.com")).toMatch(/email address or a login/);
  });

  it("rejects a dangling dot", () => {
    expect(error(".com")).toMatch(/not a valid website address/);
    expect(error("example..com")).toMatch(/not a valid website address/);
  });

  it("quotes the offending value so the message is actionable", () => {
    expect(error("hello")).toContain('"hello"');
  });
});

describe("normalizeWebsiteUrl — every accepted value is usable as a link", () => {
  const inputs = [
    "example.com",
    "www.example.com",
    "https://example.com",
    "http://example.com/a?b=1#c",
    "example.com:8080/path",
    "//example.com",
    "http://192.168.1.1",
    "blog.eu.example.co.uk",
  ];

  it("survives new URL() and is http(s), which is what the render path needs", () => {
    // The wave 2 crash was `new URL(c.website)` throwing during render. Nothing
    // this function accepts can do that.
    for (const input of inputs) {
      const out = url(input) as string;
      const parsed = new URL(out);
      expect(["http:", "https:"]).toContain(parsed.protocol);
      expect(parsed.hostname.length).toBeGreaterThan(0);
    }
  });

  it("is idempotent — normalising an already-normalised value is a no-op", () => {
    for (const input of inputs) {
      const once = url(input) as string;
      expect(url(once)).toBe(once);
    }
  });
});
