import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithTimeout, FetchTimeoutError, FETCH_TIMEOUT } from "./fetch-timeout";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** A fetch that never settles until the signal it is given aborts. */
function hangingFetch() {
  return vi.fn((_input: unknown, init?: { signal?: AbortSignal }) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // hangs forever, which is the bug this guards against
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
}

describe("fetchWithTimeout", () => {
  it("passes a response straight through when the request is quick", async () => {
    const body = new Response("ok", { status: 200 });
    globalThis.fetch = vi.fn(async () => body) as never;
    const res = await fetchWithTimeout("https://example.com", {}, { label: "Example" });
    expect(res).toBe(body);
  });

  it("forwards method, headers and body unchanged", async () => {
    const spy = vi.fn(
      async (_input: unknown, _init?: RequestInit) => new Response("{}", { status: 200 }),
    );
    globalThis.fetch = spy as never;
    await fetchWithTimeout(
      "https://api.buffer.com",
      { method: "POST", headers: { Authorization: "Bearer t" }, body: '{"q":1}' },
      { label: "Buffer" },
    );
    const init = spy.mock.calls[0][1]!;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
    expect(init.body).toBe('{"q":1}');
  });

  it("attaches a signal even when the caller passed no init", async () => {
    const spy = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response("ok"));
    globalThis.fetch = spy as never;
    await fetchWithTimeout("https://example.com", undefined as never, { label: "Example" });
    const init = spy.mock.calls[0][1]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("gives up on a hanging request and reports it as a timeout", async () => {
    globalThis.fetch = hangingFetch() as never;
    const err = await fetchWithTimeout(
      "https://slow.example.com",
      {},
      { timeoutMs: 20, label: "Buffer" },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(FetchTimeoutError);
    expect(err.label).toBe("Buffer");
    expect(err.timeoutMs).toBe(20);
  });

  it("names the service and warns the request may still have landed", async () => {
    globalThis.fetch = hangingFetch() as never;
    const err: FetchTimeoutError = await fetchWithTimeout(
      "https://slow.example.com",
      {},
      { timeoutMs: 20, label: "Unipile" },
    ).catch((e) => e);
    // The warning matters: several call sites publish or send, so "it timed out"
    // must not be read as "it did not happen".
    expect(err.message).toContain("Unipile");
    expect(err.message).toContain("may still have been received");
  });

  it("does not disguise a non-timeout failure as a timeout", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("getaddrinfo ENOTFOUND");
    }) as never;
    const err = await fetchWithTimeout(
      "https://nope.example.com",
      {},
      { label: "Firecrawl" },
    ).catch((e) => e);
    expect(err).not.toBeInstanceOf(FetchTimeoutError);
    expect(err.message).toContain("ENOTFOUND");
  });

  it("still honours a signal the caller supplied", async () => {
    globalThis.fetch = hangingFetch() as never;
    const controller = new AbortController();
    const promise = fetchWithTimeout(
      "https://slow.example.com",
      { signal: controller.signal },
      { timeoutMs: 5_000, label: "Buffer" },
    );
    controller.abort(new Error("caller changed its mind"));
    const err = await promise.catch((e) => e);
    // Caller-driven cancellation keeps its own identity rather than being
    // relabelled as slowness.
    expect(err).not.toBeInstanceOf(FetchTimeoutError);
  });

  it("defaults to the api deadline when none is given", async () => {
    const spy = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response("ok"));
    globalThis.fetch = spy as never;
    await fetchWithTimeout("https://example.com", {}, { label: "Example" });
    expect(FETCH_TIMEOUT.api).toBe(30_000);
  });

  it("orders the presets so inference and downloads outlive plain api calls", () => {
    // Image generation legitimately takes over a minute; a 30s api ceiling would
    // turn every slow render into a spurious failure.
    expect(FETCH_TIMEOUT.inference).toBeGreaterThan(FETCH_TIMEOUT.api);
    expect(FETCH_TIMEOUT.download).toBeGreaterThan(FETCH_TIMEOUT.api);
  });
});
