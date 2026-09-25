// Characterisation tests for the base64 conversion in the URL-fallback
// branches of generateOpenAI / generateAzure (docs/bugs.md finding 20).
//
// These used to build base64 by hand — `let bin = ""; for (const b of buf)
// bin += String.fromCharCode(b); btoa(bin)` — which is correct but roughly
// 300-450x slower than `Buffer.from(buf).toString("base64")` and, being
// synchronous, blocks Node's single thread for over a second on a large
// image, on the daily_post automation path. The fix is Buffer-based; these
// tests pin its correctness against known RFC 4648 test vectors so a future
// change cannot silently corrupt image bytes while "optimising" them again.
// The reference-image decode side (`Uint8Array.from(atob(...), c =>
// c.charCodeAt(0))`) has the same per-byte-callback shape and is covered too.

import { describe, it, expect, afterEach, vi } from "vitest";
import { generateWithProvider, type ImageProviderRow } from "./image-gen.server";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function stubFetch(impl: (...args: unknown[]) => Response | Promise<Response>) {
  const spy = vi.fn(impl);
  globalThis.fetch = spy as never;
  return spy;
}

function row(overrides: Partial<ImageProviderRow> = {}): ImageProviderRow {
  return {
    id: "row-1",
    provider: "openai",
    label: "OpenAI",
    api_key: "sk-test",
    base_url: null,
    default_model: null,
    ...overrides,
  };
}

// RFC 4648 §10 test vector: "foobar" <-> "Zm9vYmFy". Chosen because it is a
// published, independently-verifiable vector rather than something computed
// with the very Buffer API under test.
const FOOBAR_BYTES = Uint8Array.from([102, 111, 111, 98, 97, 114]); // "foobar"
const FOOBAR_B64 = "Zm9vYmFy";

describe("generateWithProvider(openai) — URL-fallback base64 encoding", () => {
  it("base64-encodes a downloaded image against a known vector", async () => {
    stubFetch(
      vi
        .fn()
        // 1. POST /images/generations — no b64_json, only a url, forcing the
        //    download-then-encode fallback path.
        .mockResolvedValueOnce(Response.json({ data: [{ url: "https://cdn.example/img.png" }] }))
        // 2. GET the image itself.
        .mockResolvedValueOnce(new Response(FOOBAR_BYTES)),
    );

    const result = await generateWithProvider(row(), "a prompt", []);

    expect(result.error).toBeUndefined();
    expect(result.b64).toBe(FOOBAR_B64);
  });

  it("round-trips a full byte range (0-255), not just ASCII", async () => {
    const allBytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    stubFetch(
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ data: [{ url: "https://cdn.example/img.png" }] }))
        .mockResolvedValueOnce(new Response(allBytes)),
    );

    const result = await generateWithProvider(row(), "a prompt", []);

    expect(result.b64).toBe(Buffer.from(allBytes).toString("base64"));
    // Decoding the result must reproduce every original byte value in order.
    expect(new Uint8Array(Buffer.from(result.b64 ?? "", "base64"))).toEqual(allBytes);
  });
});

describe("generateWithProvider(azure) — URL-fallback base64 encoding", () => {
  it("base64-encodes a downloaded image against the same known vector", async () => {
    stubFetch(
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ data: [{ url: "https://cdn.example/img.png" }] }))
        .mockResolvedValueOnce(new Response(FOOBAR_BYTES)),
    );

    const result = await generateWithProvider(
      row({
        provider: "azure",
        base_url: "https://acme.cognitiveservices.azure.com/openai/deployments/gpt-image-2",
      }),
      "a prompt",
      [],
    );

    expect(result.error).toBeUndefined();
    expect(result.b64).toBe(FOOBAR_B64);
  });
});

describe("generateWithProvider(openai) — reference image base64 decoding", () => {
  it("decodes a base64 data URL reference back to the exact original bytes", async () => {
    const fetchSpy = stubFetch(
      vi.fn().mockResolvedValueOnce(Response.json({ data: [{ b64_json: "AAAA" }] })),
    );

    const dataUrl = `data:image/png;base64,${FOOBAR_B64}`;
    const result = await generateWithProvider(row(), "a prompt", [dataUrl]);

    expect(result.error).toBeUndefined();
    expect(result.referencesUsed).toBe(1);

    // Inspect the multipart body actually sent: the decoded reference bytes
    // must match "foobar" exactly, proving the decode side is still correct
    // after moving off the per-character atob()/charCodeAt() loop.
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    const file = form.get("image[]") as File;
    expect(file).toBeInstanceOf(Blob);
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(bytes).toEqual(FOOBAR_BYTES);
    expect(Buffer.from(bytes).toString("utf8")).toBe("foobar");
  });
});
