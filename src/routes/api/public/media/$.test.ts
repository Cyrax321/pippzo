// Characterisation + regression tests for the public media proxy (docs/bugs.md
// finding 7): it must stop stripping Content-Length, forward Range and the
// conditional request headers upstream, and pass 206/304 through unchanged —
// all while keeping the connect-only timeout behaviour (Wave 3c) intact.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { forward } from "./$";
import { FETCH_TIMEOUT } from "@/lib/fetch-timeout";

const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_URL = "https://abcdefghijklmnop.supabase.co";

function req(url: string, init?: RequestInit) {
  return new Request(url, init);
}

function upstreamResponse(body: BodyInit | null, init: ResponseInit) {
  return new Response(body, init);
}

beforeEach(() => {
  process.env.SUPABASE_URL = SUPABASE_URL;
});

afterEach(() => {
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("forward — path handling", () => {
  it("rejects a splat containing .. without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await forward(req("http://x/api/public/media/../secret"), {
      _splat: "../secret",
    });
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s when the splat is empty", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await forward(req("http://x/api/public/media/"), { _splat: "" });
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("500s when SUPABASE_URL is not configured", async () => {
    delete process.env.SUPABASE_URL;
    const res = await forward(req("http://x/api/public/media/object/sign/media/a.png"), {
      _splat: "object/sign/media/a.png",
    });
    expect(res.status).toBe(500);
  });
});

describe("forward — Content-Length (finding 7, bug 1)", () => {
  it("does NOT strip content-length from the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      upstreamResponse("x".repeat(100), {
        status: 200,
        headers: { "content-length": "100", "content-type": "image/png" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await forward(req("http://x/api/public/media/object/sign/media/a.png"), {
      _splat: "object/sign/media/a.png",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("100");
  });

  it("still strips genuinely hop-by-hop headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      upstreamResponse("body", {
        status: 200,
        headers: {
          connection: "keep-alive",
          "keep-alive": "timeout=5",
          "transfer-encoding": "chunked",
          upgrade: "h2c",
          "content-encoding": "gzip",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await forward(req("http://x/api/public/media/object/sign/media/a.png"), {
      _splat: "object/sign/media/a.png",
    });

    for (const h of [
      "connection",
      "keep-alive",
      "transfer-encoding",
      "upgrade",
      "content-encoding",
    ]) {
      expect(res.headers.has(h)).toBe(false);
    }
  });
});

describe("forward — Range requests (finding 7, bug 2)", () => {
  it("forwards the client's Range header upstream", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      upstreamResponse("0123456789", {
        status: 206,
        headers: { "content-range": "bytes 0-99/5389424", "content-length": "100" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await forward(
      req("http://x/api/public/media/object/sign/media/a.png", {
        headers: { range: "bytes=0-99" },
      }),
      { _splat: "object/sign/media/a.png" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const sentHeaders = new Headers(init.headers);
    expect(sentHeaders.get("range")).toBe("bytes=0-99");
  });

  it("passes a 206 and Content-Range through unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      upstreamResponse("0123456789", {
        status: 206,
        headers: { "content-range": "bytes 0-99/5389424", "content-length": "100" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await forward(
      req("http://x/api/public/media/object/sign/media/a.png", {
        headers: { range: "bytes=0-99" },
      }),
      { _splat: "object/sign/media/a.png" },
    );

    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-99/5389424");
    expect(res.headers.get("content-length")).toBe("100");
  });

  it("does not add a range header when the client sent none", async () => {
    const fetchMock = vi.fn().mockResolvedValue(upstreamResponse("body", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await forward(req("http://x/api/public/media/object/sign/media/a.png"), {
      _splat: "object/sign/media/a.png",
    });

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const sentHeaders = new Headers(init.headers);
    expect(sentHeaders.has("range")).toBe(false);
  });
});

describe("forward — conditional headers", () => {
  it("forwards if-range, if-none-match and if-modified-since upstream", async () => {
    const fetchMock = vi.fn().mockResolvedValue(upstreamResponse("body", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await forward(
      req("http://x/api/public/media/object/sign/media/a.png", {
        headers: {
          "if-range": '"etag-123"',
          "if-none-match": '"etag-123"',
          "if-modified-since": "Wed, 09 Sep 2026 10:00:00 GMT",
        },
      }),
      { _splat: "object/sign/media/a.png" },
    );

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const sentHeaders = new Headers(init.headers);
    expect(sentHeaders.get("if-range")).toBe('"etag-123"');
    expect(sentHeaders.get("if-none-match")).toBe('"etag-123"');
    expect(sentHeaders.get("if-modified-since")).toBe("Wed, 09 Sep 2026 10:00:00 GMT");
  });

  it("passes a 304 through unchanged with no body, and does not log it as an error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(upstreamResponse(null, { status: 304, headers: { etag: '"etag-123"' } }));
    vi.stubGlobal("fetch", fetchMock);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await forward(
      req("http://x/api/public/media/object/sign/media/a.png", {
        headers: { "if-none-match": '"etag-123"' },
      }),
      { _splat: "object/sign/media/a.png" },
    );

    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe('"etag-123"');
    expect(await res.text()).toBe("");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("still logs a real upstream failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(upstreamResponse("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await forward(req("http://x/api/public/media/object/sign/media/a.png"), {
      _splat: "object/sign/media/a.png",
    });

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("ETag and Last-Modified from upstream reach the client on a normal 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      upstreamResponse("body", {
        status: 200,
        headers: { etag: '"etag-123"', "last-modified": "Wed, 09 Sep 2026 10:00:00 GMT" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await forward(req("http://x/api/public/media/object/sign/media/a.png"), {
      _splat: "object/sign/media/a.png",
    });

    expect(res.headers.get("etag")).toBe('"etag-123"');
    expect(res.headers.get("last-modified")).toBe("Wed, 09 Sep 2026 10:00:00 GMT");
  });
});

describe("forward — HEAD", () => {
  it("forwards HEAD to upstream and returns the same headers with no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      upstreamResponse(null, {
        status: 200,
        headers: { "content-length": "5389424", "content-type": "video/mp4" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await forward(
      req("http://x/api/public/media/object/sign/media/a.mp4", { method: "HEAD" }),
      { _splat: "object/sign/media/a.mp4" },
    );

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("5389424");
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.body).toBeNull();
  });

  it("forwards Range on a HEAD request too", async () => {
    const fetchMock = vi.fn().mockResolvedValue(upstreamResponse(null, { status: 206 }));
    vi.stubGlobal("fetch", fetchMock);

    await forward(
      req("http://x/api/public/media/object/sign/media/a.mp4", {
        method: "HEAD",
        headers: { range: "bytes=0-99" },
      }),
      { _splat: "object/sign/media/a.mp4" },
    );

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(new Headers(init.headers).get("range")).toBe("bytes=0-99");
  });
});

describe("forward — cache-control default", () => {
  it("sets a default cache-control when upstream has none", async () => {
    const fetchMock = vi.fn().mockResolvedValue(upstreamResponse("body", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await forward(req("http://x/api/public/media/object/sign/media/a.png"), {
      _splat: "object/sign/media/a.png",
    });

    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("keeps upstream's cache-control when present", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        upstreamResponse("body", { status: 200, headers: { "cache-control": "no-store" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await forward(req("http://x/api/public/media/object/sign/media/a.png"), {
      _splat: "object/sign/media/a.png",
    });

    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("forward — connect-only timeout (Wave 3c, must not regress)", () => {
  it("aborts and returns 504 only when upstream never responds, and does not abort a slow-but-started body stream", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener("abort", () => {
            const err = new Error("This operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = forward(req("http://x/api/public/media/object/sign/media/a.png"), {
      _splat: "object/sign/media/a.png",
    });

    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT.api);
    const res = await pending;

    expect(res.status).toBe(504);
  });

  it("clears the connect timer the instant fetch settles, before any body is read", async () => {
    // Headers arriving must disarm the connect deadline immediately, per the
    // file's own comment — otherwise a large-but-healthy download would still
    // get killed mid-stream once FETCH_TIMEOUT.api elapses. Assert the timer
    // is actually cleared, rather than relying on a timing coincidence.
    const clearSpy = vi.spyOn(global, "clearTimeout");
    const fetchMock = vi.fn().mockResolvedValue(
      upstreamResponse("stream-body", {
        status: 200,
        headers: { "content-length": "11" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await forward(req("http://x/api/public/media/object/sign/media/a.png"), {
      _splat: "object/sign/media/a.png",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("11");
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

describe("forward — write verbs remain out of scope", () => {
  it("only ever calls upstream with GET or HEAD (forward is not wired to write verbs)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(upstreamResponse("body", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await forward(req("http://x/api/public/media/object/sign/media/a.png", { method: "GET" }), {
      _splat: "object/sign/media/a.png",
    });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET" });
  });
});
