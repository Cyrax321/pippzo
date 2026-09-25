// Characterisation tests for the public media proxy helpers.
//
// Several tests below assert behaviour the audit flagged as WRONG. They are
// marked "KNOWN GAP (audit finding)" and assert what the code does TODAY so
// that a later wave changing them produces a visible, deliberate test failure.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { publicAppUrl, toPublicMediaUrl, assertPubliclyFetchable } from "./public-media.server";

// A realistically-shaped Supabase Storage signed URL from a local stack.
const LOCAL_SIGNED =
  "http://127.0.0.1:54321/storage/v1/object/sign/media/9f1c0a2e-1b3d-4c5a-8e7f-0a1b2c3d4e5f/post-42.png" +
  "?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1cmwiOiJtZWRpYS85ZjFjMGEyZS9wb3N0LTQyLnBuZyIsImlhdCI6MTc2NDAwMDAwMH0.Qm9ndXNTaWduYXR1cmVGb3JUZXN0cw";

const HOSTED_SIGNED =
  "https://abcdefghijklmnop.supabase.co/storage/v1/object/sign/media/brand/reel-7.mp4" +
  "?token=eyJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJtZWRpYS9icmFuZC9yZWVsLTcubXA0In0.SGVsbG9TaWduYXR1cmU";

const ORIGINAL_PUBLIC_APP_URL = process.env.PUBLIC_APP_URL;

function setPublicAppUrl(value: string | undefined) {
  if (value === undefined) delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL = value;
}

beforeEach(() => {
  delete process.env.PUBLIC_APP_URL;
});

afterEach(() => {
  setPublicAppUrl(ORIGINAL_PUBLIC_APP_URL);
});

describe("publicAppUrl", () => {
  it("returns null when PUBLIC_APP_URL is unset", () => {
    expect(publicAppUrl()).toBeNull();
  });

  it("returns null when PUBLIC_APP_URL is blank or whitespace", () => {
    setPublicAppUrl("");
    expect(publicAppUrl()).toBeNull();
    setPublicAppUrl("   ");
    expect(publicAppUrl()).toBeNull();
  });

  it("trims surrounding whitespace and strips every trailing slash", () => {
    setPublicAppUrl("  https://social-studio.ngrok.app///  ");
    expect(publicAppUrl()).toBe("https://social-studio.ngrok.app");
  });
});

describe("toPublicMediaUrl", () => {
  it("returns the signed URL untouched when PUBLIC_APP_URL is unset (hosted Supabase)", () => {
    expect(toPublicMediaUrl(HOSTED_SIGNED)).toBe(HOSTED_SIGNED);
    expect(toPublicMediaUrl(LOCAL_SIGNED)).toBe(LOCAL_SIGNED);
  });

  it("rewrites a local Supabase signed URL through /api/public/media", () => {
    setPublicAppUrl("https://social-studio.ngrok.app");
    expect(toPublicMediaUrl(LOCAL_SIGNED)).toBe(
      "https://social-studio.ngrok.app/api/public/media/object/sign/media/9f1c0a2e-1b3d-4c5a-8e7f-0a1b2c3d4e5f/post-42.png" +
        "?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1cmwiOiJtZWRpYS85ZjFjMGEyZS9wb3N0LTQyLnBuZyIsImlhdCI6MTc2NDAwMDAwMH0.Qm9ndXNTaWduYXR1cmVGb3JUZXN0cw",
    );
  });

  it("preserves the signed token in the query string", () => {
    setPublicAppUrl("https://social-studio.ngrok.app");
    const rewritten = new URL(toPublicMediaUrl(LOCAL_SIGNED));
    const original = new URL(LOCAL_SIGNED);
    expect(rewritten.searchParams.get("token")).toBe(original.searchParams.get("token"));
    expect(rewritten.searchParams.get("token")).not.toBeNull();
  });

  it("normalises a trailing slash on PUBLIC_APP_URL (no double slash in the result)", () => {
    setPublicAppUrl("https://social-studio.ngrok.app/");
    expect(toPublicMediaUrl(LOCAL_SIGNED)).toContain(
      "https://social-studio.ngrok.app/api/public/media/object/sign/",
    );
    expect(toPublicMediaUrl(LOCAL_SIGNED)).not.toContain("ngrok.app//api");
  });

  it("rewrites a hosted Supabase signed URL too, once PUBLIC_APP_URL is set", () => {
    setPublicAppUrl("https://social-studio.ngrok.app");
    expect(toPublicMediaUrl(HOSTED_SIGNED)).toBe(
      "https://social-studio.ngrok.app/api/public/media/object/sign/media/brand/reel-7.mp4" +
        "?token=eyJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJtZWRpYS9icmFuZC9yZWVsLTcubXA0In0.SGVsbG9TaWduYXR1cmU",
    );
  });

  it("passes a non-storage URL through unchanged", () => {
    setPublicAppUrl("https://social-studio.ngrok.app");
    const cdn = "https://cdn.example.com/assets/hero.png?v=3";
    expect(toPublicMediaUrl(cdn)).toBe(cdn);
    const publicObject = "https://abcdefghijklmnop.supabase.co/rest/v1/posts?select=*";
    expect(toPublicMediaUrl(publicObject)).toBe(publicObject);
  });

  it("passes an unparseable URL through unchanged", () => {
    setPublicAppUrl("https://social-studio.ngrok.app");
    expect(toPublicMediaUrl("not a url at all")).toBe("not a url at all");
    expect(toPublicMediaUrl("")).toBe("");
    expect(toPublicMediaUrl("/storage/v1/object/sign/media/x.png")).toBe(
      "/storage/v1/object/sign/media/x.png",
    );
  });

  it("drops everything before /storage/v1/, including any path prefix", () => {
    setPublicAppUrl("https://social-studio.ngrok.app");
    expect(
      toPublicMediaUrl("http://127.0.0.1:54321/proxied/storage/v1/object/public/media/logo.svg"),
    ).toBe("https://social-studio.ngrok.app/api/public/media/object/public/media/logo.svg");
  });
});

describe("assertPubliclyFetchable — hosts it correctly rejects", () => {
  const blocked = [
    ["localhost", "http://localhost:5173/storage/v1/object/sign/media/a.png"],
    ["127.0.0.1", "http://127.0.0.1:54321/storage/v1/object/sign/media/a.png"],
    [".local mDNS host", "http://rods-macbook.local:5173/media/a.png"],
    ["10.x private range", "http://10.0.1.42:5173/media/a.png"],
    ["192.168.x private range", "http://192.168.1.7:5173/media/a.png"],
    ["172.16.x private range", "http://172.16.0.1/media/a.png"],
    ["172.20.x private range", "http://172.20.10.3/media/a.png"],
    ["172.31.x private range", "http://172.31.255.254/media/a.png"],
    ["169.254.x link-local / cloud metadata", "http://169.254.169.254/latest/meta-data/iam/"],
    ["0.0.0.0", "http://0.0.0.0:54321/storage/v1/object/sign/media/a.png"],
    ["IPv6 loopback [::1]", "http://[::1]:54321/storage/v1/object/sign/media/a.png"],
    ["IPv6 unique-local fd00::/7", "http://[fd12:3456:789a::1]/media/a.png"],
    ["IPv6 unique-local fc00::/7", "http://[fc00::1]/media/a.png"],
  ] as const;

  for (const [label, url] of blocked) {
    it(`throws for ${label}`, () => {
      expect(() => assertPubliclyFetchable(url, "The post image")).toThrow(
        /is only reachable at .*so Buffer cannot download it/s,
      );
    });
  }

  it("names the caller-supplied subject and points at the tunnel fix", () => {
    expect(() =>
      assertPubliclyFetchable(
        "http://127.0.0.1:54321/storage/v1/object/sign/media/a.png",
        "The video",
      ),
    ).toThrow(/^The video is only reachable at 127\.0\.0\.1/);
    expect(() =>
      assertPubliclyFetchable(
        "http://127.0.0.1:54321/storage/v1/object/sign/media/a.png",
        "The video",
      ),
    ).toThrow(/npm run tunnel/);
  });

  it("throws a distinct message for an unparseable URL", () => {
    expect(() => assertPubliclyFetchable("not a url", "The post image")).toThrow(
      "The post image is not a valid URL.",
    );
    expect(() => assertPubliclyFetchable("", "The post image")).toThrow(
      "The post image is not a valid URL.",
    );
  });
});

describe("assertPubliclyFetchable — hosts it allows", () => {
  it("does not throw for a normal public host", () => {
    expect(() =>
      assertPubliclyFetchable(
        "https://social-studio.ngrok.app/api/public/media/a.png",
        "The image",
      ),
    ).not.toThrow();
    expect(() =>
      assertPubliclyFetchable(
        "https://abcdefghijklmnop.supabase.co/storage/v1/object/sign/media/a.png",
        "The image",
      ),
    ).not.toThrow();
  });

  it("accepts a plain https:// URL to a public host", () => {
    expect(() =>
      assertPubliclyFetchable("https://cdn.example.com/assets/hero.png", "The image"),
    ).not.toThrow();
  });

  it("does not throw for public addresses adjacent to the 172.16-31 private block", () => {
    // 172.15.x and 172.32.x are genuinely public, so allowing them is correct.
    // (https, since http is now rejected regardless of host — see the https
    // requirement tests below.)
    expect(() => assertPubliclyFetchable("https://172.15.0.1/a.png", "The image")).not.toThrow();
    expect(() => assertPubliclyFetchable("https://172.32.0.1/a.png", "The image")).not.toThrow();
  });
});

describe("assertPubliclyFetchable — https requirement", () => {
  it("rejects a plain http:// URL to a public host", () => {
    expect(() =>
      assertPubliclyFetchable("http://cdn.example.com/assets/hero.png", "The image"),
    ).toThrow(/must be fetched over https/);
  });

  it("rejects non-http(s) schemes too", () => {
    expect(() => assertPubliclyFetchable("ftp://cdn.example.com/hero.png", "The image")).toThrow(
      /must be fetched over https/,
    );
    expect(() =>
      assertPubliclyFetchable("file:///Users/rod/Desktop/hero.png", "The image"),
    ).toThrow(/must be fetched over https/);
  });
});

describe("assertPubliclyFetchable — known gaps (asserting today's behaviour)", () => {
  it("does NOT block a hostname that merely resolves to a private address", () => {
    // KNOWN GAP (audit finding): the check is textual, not a DNS resolution,
    // so localtest.me style hosts (which resolve to 127.0.0.1) pass. Uses
    // https so this test isolates the DNS-resolution gap from the (fixed)
    // https requirement above.
    expect(() =>
      assertPubliclyFetchable("https://app.localtest.me/a.png", "The image"),
    ).not.toThrow();
  });
});
