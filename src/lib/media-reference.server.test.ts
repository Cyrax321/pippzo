import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveReferenceDataUrls,
  mimeFromPath,
  MAX_REFERENCE_TOTAL_BYTES,
  type StorageDownloadClient,
} from "./media-reference.server";

const SUPA = "http://127.0.0.1:54321";
const WS = "b6f0b4cf-edb4-4c87-9389-f1e71e61de89";
const signed = (path: string) => `${SUPA}/storage/v1/object/sign/media/${path}?token=abc`;

/** Storage stub: returns the bytes registered for a path, or an error. */
function stubClient(files: Record<string, Uint8Array>, opts: { throwOn?: string } = {}) {
  const downloads: string[] = [];
  const client: StorageDownloadClient = {
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          downloads.push(`${bucket}/${path}`);
          if (opts.throwOn === path) throw new Error("network blew up");
          const bytes = files[path];
          if (!bytes) return { data: null, error: { message: "Object not found" } };
          return {
            data: {
              arrayBuffer: async () =>
                bytes.buffer.slice(
                  bytes.byteOffset,
                  bytes.byteOffset + bytes.byteLength,
                ) as ArrayBuffer,
            },
            error: null,
          };
        },
      }),
    },
  };
  return { client, downloads };
}

const png = (n = 8) => new Uint8Array(n).fill(0x89);

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("resolveReferenceDataUrls", () => {
  it("resolves a stored image into a data URL the provider can ingest", async () => {
    const { client } = stubClient({ [`${WS}/a.png`]: png() });
    const out = await resolveReferenceDataUrls(client, [{ url: signed(`${WS}/a.png`) }], 4);
    expect(out).toHaveLength(1);
    expect(out[0].startsWith("data:image/png;base64,")).toBe(true);
  });

  it("passes a legacy base64 row straight through without a download", async () => {
    const { client, downloads } = stubClient({});
    const legacy = "data:image/png;base64,iVBORw0KGgo=";
    const out = await resolveReferenceDataUrls(client, [{ url: legacy }], 4);
    expect(out).toEqual([legacy]);
    expect(downloads).toHaveLength(0);
  });

  it("handles a library holding both shapes at once, preserving order", async () => {
    // This is the real state after the upload change: old rows inline, new rows
    // in storage. Both must work, and the newest-first order must survive.
    const { client } = stubClient({ [`${WS}/new.png`]: png() });
    const out = await resolveReferenceDataUrls(
      client,
      [{ url: signed(`${WS}/new.png`) }, { url: "data:image/png;base64,AAAA" }],
      4,
    );
    expect(out).toHaveLength(2);
    expect(out[1]).toBe("data:image/png;base64,AAAA");
  });

  it("stops at the requested limit", async () => {
    const files = Object.fromEntries([1, 2, 3, 4].map((i) => [`${WS}/${i}.png`, png()]));
    const { client } = stubClient(files);
    const rows = [1, 2, 3, 4].map((i) => ({ url: signed(`${WS}/${i}.png`) }));
    expect(await resolveReferenceDataUrls(client, rows, 2)).toHaveLength(2);
  });

  it("skips a reference that cannot be read rather than failing the whole batch", async () => {
    // A missing object must degrade the image, never fail the post.
    const { client } = stubClient({ [`${WS}/ok.png`]: png() });
    const out = await resolveReferenceDataUrls(
      client,
      [{ url: signed(`${WS}/gone.png`) }, { url: signed(`${WS}/ok.png`) }],
      4,
    );
    expect(out).toHaveLength(1);
  });

  it("survives a download that throws", async () => {
    const { client } = stubClient({ [`${WS}/ok.png`]: png() }, { throwOn: `${WS}/boom.png` });
    const out = await resolveReferenceDataUrls(
      client,
      [{ url: signed(`${WS}/boom.png`) }, { url: signed(`${WS}/ok.png`) }],
      4,
    );
    expect(out).toHaveLength(1);
  });

  it("ignores videos, which are not style references", async () => {
    const { client, downloads } = stubClient({ [`${WS}/v.mp4`]: png() });
    const out = await resolveReferenceDataUrls(
      client,
      [{ url: signed(`${WS}/v.mp4`), kind: "video" }],
      4,
    );
    expect(out).toHaveLength(0);
    expect(downloads).toHaveLength(0);
  });

  it("ignores rows with no usable URL", async () => {
    const { client } = stubClient({});
    const out = await resolveReferenceDataUrls(
      client,
      [{ url: null }, { url: "   " }, { url: "not a url" }],
      4,
    );
    expect(out).toHaveLength(0);
  });

  it("stops once the byte budget is spent, so one prompt cannot blow up memory", async () => {
    const big = new Uint8Array(Math.floor(MAX_REFERENCE_TOTAL_BYTES * 0.7)).fill(1);
    const { client } = stubClient({ [`${WS}/1.png`]: big, [`${WS}/2.png`]: big });
    const out = await resolveReferenceDataUrls(
      client,
      [{ url: signed(`${WS}/1.png`) }, { url: signed(`${WS}/2.png`) }],
      4,
    );
    expect(out).toHaveLength(1);
  });

  it("counts a legacy base64 row against the same budget", async () => {
    const { client } = stubClient({});
    const huge = `data:image/png;base64,${"A".repeat(MAX_REFERENCE_TOTAL_BYTES * 2)}`;
    expect(await resolveReferenceDataUrls(client, [{ url: huge }], 4)).toHaveLength(0);
  });

  it("returns nothing for an empty library rather than throwing", async () => {
    const { client } = stubClient({});
    expect(await resolveReferenceDataUrls(client, [], 4)).toEqual([]);
  });
});

describe("mimeFromPath", () => {
  it("maps the extension the uploader wrote from sniffed content", () => {
    expect(mimeFromPath("ws/a.png")).toBe("image/png");
    expect(mimeFromPath("ws/a.jpg")).toBe("image/jpeg");
    expect(mimeFromPath("ws/a.jpeg")).toBe("image/jpeg");
    expect(mimeFromPath("ws/a.webp")).toBe("image/webp");
    expect(mimeFromPath("ws/a.gif")).toBe("image/gif");
  });

  it("falls back to png for anything unrecognised", () => {
    expect(mimeFromPath("ws/noextension")).toBe("image/png");
  });
});
