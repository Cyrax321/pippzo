// Turns approved library images into the data URLs an image provider can ingest.
// Server-only.
//
// Why this exists: wave 4 moved library uploads off base64 and into Supabase
// Storage (docs/bugs.md finding 8), which is right — a multi-megabyte blob in a
// text column was reloaded on every library render. But two server paths picked
// their style references by filtering for `data:` URLs, because that was the
// only shape that had ever existed:
//
//   cron-executors.server.ts  generateDailyPostVisual  .like("url", "data:%")
//   api/generate-image.ts     loadApprovedReferences   DATA_URL.test(r.url)
//
// After the upload change those filters match nothing for newly uploaded images,
// so the daily post and the auto-attach path would silently stop using the
// brand's own approved visuals — a quiet capability regression rather than an
// error. This resolves both shapes instead.
//
// Note it downloads through the storage client rather than fetching the stored
// URL over HTTP. That is deliberate: the row's URL is data we wrote, but
// re-fetching it would still mean the server making a request to a URL held in
// the database, which is a server-side request forgery surface for no benefit.
// Going through the client keeps row-level security applying for a caller-scoped
// client, and needs no network guard at all.

import { parseStorageObjectUrl } from "./media-upload.functions";

/** The narrow slice of the Supabase client used here: one storage download. */
export type StorageDownloadClient = {
  storage: {
    from: (bucket: string) => {
      download: (path: string) => Promise<{
        data: { arrayBuffer: () => Promise<ArrayBuffer> } | null;
        error: { message: string } | null;
      }>;
    };
  };
};

/**
 * Total decoded bytes of reference imagery we are willing to hold in memory and
 * push into one provider request. Four references at the 15MB per-image ceiling
 * would be 60MB of base64 in a single prompt, which no provider accepts and
 * which would stall the automation tick building it.
 */
export const MAX_REFERENCE_TOTAL_BYTES = 12 * 1024 * 1024;

export type ReferenceRow = { url?: string | null; kind?: string | null };

/**
 * Resolves approved library rows into data URLs, in the order given, stopping at
 * `limit` or once the byte budget is spent.
 *
 * Never throws: a reference that cannot be resolved is skipped with a warning.
 * A failed style reference should degrade the image, not fail the post.
 */
export async function resolveReferenceDataUrls(
  client: StorageDownloadClient,
  rows: ReferenceRow[],
  limit: number,
): Promise<string[]> {
  const out: string[] = [];
  let budget = MAX_REFERENCE_TOTAL_BYTES;

  for (const row of rows) {
    if (out.length >= limit) break;
    const url = (row?.url ?? "").trim();
    if (!url) continue;
    if (row?.kind === "video") continue;

    // Legacy rows still hold the image inline. Nothing to fetch.
    if (url.startsWith("data:")) {
      // 4/3 is the base64 inflation, so this approximates the decoded size.
      const approxBytes = Math.floor((url.length * 3) / 4);
      if (approxBytes > budget) continue;
      budget -= approxBytes;
      out.push(url);
      continue;
    }

    const ref = parseStorageObjectUrl(url);
    if (!ref) continue;

    try {
      const { data, error } = await client.storage.from(ref.bucket).download(ref.path);
      if (error || !data) {
        console.warn("[media-reference] could not read a reference image", {
          path: ref.path,
          error: error?.message,
        });
        continue;
      }
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > budget) continue;
      budget -= bytes.byteLength;
      out.push(`data:${mimeFromPath(ref.path)};base64,${Buffer.from(bytes).toString("base64")}`);
    } catch (e) {
      console.warn(
        "[media-reference] reference download threw",
        ref.path,
        e instanceof Error ? e.message : e,
      );
    }
  }

  return out;
}

/**
 * The stored object's extension is written by the uploader from sniffed content,
 * not from the filename the user supplied, so it is trustworthy here.
 */
export function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}
