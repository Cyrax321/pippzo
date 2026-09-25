// Library image uploads, and the path resolution needed to clean objects up
// again.
//
// Why this exists (docs/bugs.md findings 8 and 16): library images used to be
// read into a base64 data URL in the browser and inserted straight into
// `brand_images.url`, a plain text column — no size check, no type check, and
// every subsequent `select("*")` over the workspace dragged the whole blob
// back out. `uploadLibraryVideo` (buffer.functions.ts) and the cron daily
// visual (cron-executors.server.ts) already did the right thing; this is the
// same shape for images. Nothing here deletes a row: it moves bytes and
// resolves paths, so the store stays in charge of the row.
//
// Validation lives in media-validate.ts and is deliberately not duplicated
// here — it sniffs magic bytes rather than trusting the declared type, and
// checks string length before decoding so an oversized payload is never
// expanded in memory.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MAX_IMAGE_DATA_URL_CHARS,
  mediaStoragePath,
  parseImageDataUrl,
} from "@/lib/media-validate";

/** Brand/library media. Private — reads go through signed URLs. */
export const LIBRARY_IMAGE_BUCKET = "media";
/**
 * Where `uploadLibraryVideo` puts library video. Different bucket, so a delete
 * has to know which one a given path belongs to.
 */
export const LIBRARY_VIDEO_BUCKET = "buffer-media";

/**
 * A year, matching the video path. The URL is stored in the row, so a short
 * expiry would quietly turn every library thumbnail into a broken image.
 */
export const MEDIA_SIGNED_URL_TTL_SEC = 60 * 60 * 24 * 365;

/**
 * The one read this function makes through the caller's own client, typed
 * structurally rather than cast to `any` so the filter chain stays checked.
 */
type MembershipClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        eq: (
          column: string,
          value: string,
        ) => {
          maybeSingle: () => PromiseLike<{
            data: { workspace_id: string } | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
};

export type UploadedLibraryImage = {
  /** `<workspaceId>/<uuid>.<ext>` in the `media` bucket. */
  storagePath: string;
  /** Signed URL to store in `brand_images.url` and render from. */
  url: string;
  mimeType: string;
  sizeBytes: number;
};

/**
 * Validates an image data URL, stores the bytes in the `media` bucket and
 * returns the path plus a signed URL. The caller writes the row: this function
 * owns the object only, and removes it again if it cannot produce a URL for it.
 */
export const uploadLibraryImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspaceId: string; dataUrl: string; name?: string }) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        // The real checks (magic bytes, decoded size) run in the handler. This
        // is only the cheap string-length backstop, so a multi-hundred-MB body
        // is rejected before anything tries to decode it.
        dataUrl: z.string().min(20).max(MAX_IMAGE_DATA_URL_CHARS, "That image is too large."),
        name: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<UploadedLibraryImage> => {
    const parsed = parseImageDataUrl(data.dataUrl);
    if (!parsed.ok) throw new Error(parsed.error);

    // Same guard as uploadLibraryVideo: membership is proven through the
    // caller's OWN client (so RLS applies) before the service-role client
    // writes anything. Without it any signed-in user could plant files in
    // another workspace's storage path, which is also its read-policy prefix.
    const { data: member, error: memErr } = await (context.supabase as unknown as MembershipClient)
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", data.workspaceId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (memErr) throw new Error(`Could not verify workspace membership: ${memErr.message}`);
    if (!member) throw new Error("You are not a member of this workspace.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const path = mediaStoragePath(data.workspaceId, parsed.ext);
    const up = await supabaseAdmin.storage
      .from(LIBRARY_IMAGE_BUCKET)
      .upload(path, parsed.bytes, { contentType: parsed.mime, upsert: false });
    if (up.error) throw new Error(`Storage upload failed: ${up.error.message}`);

    const signed = await supabaseAdmin.storage
      .from(LIBRARY_IMAGE_BUCKET)
      .createSignedUrl(path, MEDIA_SIGNED_URL_TTL_SEC);
    const signedUrl = signed.data?.signedUrl;
    if (!signedUrl) {
      // Nothing will ever reference this object — drop it rather than leak it.
      const rm = await supabaseAdmin.storage.from(LIBRARY_IMAGE_BUCKET).remove([path]);
      if (rm.error) console.warn(`[media-upload] orphan cleanup failed for ${path}`, rm.error);
      throw new Error(`Could not create image URL: ${signed.error?.message ?? "unknown"}`);
    }

    // A local Supabase signs against 127.0.0.1, which is fine in a browser but
    // not for anything off-machine; the proxy rewrite is a no-op when
    // PUBLIC_APP_URL is unset, which is the hosted case.
    const { toPublicMediaUrl } = await import("./public-media.server");
    return {
      storagePath: path,
      url: toPublicMediaUrl(signedUrl),
      mimeType: parsed.mime,
      sizeBytes: parsed.sizeBytes,
    };
  });

// ---- Object resolution for deletes -------------------------------------------

export type StorageObjectRef = { bucket: string; path: string };

/** Segments Supabase puts between `/object/` and the bucket name. */
const OBJECT_MODES = new Set(["sign", "public", "authenticated", "upload", "info"]);

/**
 * Recovers `{ bucket, path }` from a stored media URL.
 *
 * Handles the three shapes that reach `brand_images`:
 *   …/storage/v1/object/sign/media/<ws>/<id>.png?token=…    (signed)
 *   …/storage/v1/object/public/media/<ws>/<id>.png          (public)
 *   …/api/public/media/object/sign/buffer-media/<ws>/<id>.mp4?token=…
 *     (the same signed URL rewritten by toPublicMediaUrl for the tunnel)
 *
 * Returns null for anything else — notably the legacy `data:image/...;base64,…`
 * rows, which have no object behind them at all.
 */
export function parseStorageObjectUrl(url: string | null | undefined): StorageObjectRef | null {
  const raw = (url ?? "").trim();
  if (!raw || raw.startsWith("data:")) return null;

  let pathname: string;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    return null;
  }

  const marker = pathname.indexOf("/object/");
  if (marker === -1) return null;

  const segments = pathname
    .slice(marker + "/object/".length)
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  if (segments.length && OBJECT_MODES.has(segments[0])) segments.shift();

  // Need a bucket and at least one path segment.
  if (segments.length < 2) return null;
  const [bucket, ...rest] = segments;
  return { bucket, path: rest.join("/") };
}

/** The row columns that can point at a stored object. */
export type LibraryAssetPaths = {
  url?: string | null;
  video_url?: string | null;
  storage_path?: string | null;
  storage_path_video?: string | null;
};

/**
 * Every storage object a library row owns, deduped.
 *
 * `storage_path`/`storage_path_video` are authoritative when present; the URLs
 * are the fallback for rows written before those columns were used (library
 * video, which stores only a signed `video_url`). A row whose `url` is a base64
 * data URL contributes nothing, which is exactly right — there is no object.
 *
 * The bucket comes from the URL when it agrees with the stored path, because
 * images live in `media` and video in `buffer-media` and a path alone does not
 * say which.
 */
export function libraryAssetStorageTargets(row: LibraryAssetPaths): StorageObjectRef[] {
  const fromUrl = parseStorageObjectUrl(row.url);
  const fromVideoUrl = parseStorageObjectUrl(row.video_url);

  const targets: StorageObjectRef[] = [];
  const push = (ref: StorageObjectRef | null) => {
    if (!ref || !ref.path) return;
    if (targets.some((t) => t.bucket === ref.bucket && t.path === ref.path)) return;
    targets.push(ref);
  };

  const imagePath = row.storage_path?.trim();
  if (imagePath) {
    push({
      bucket: fromUrl?.path === imagePath ? fromUrl.bucket : LIBRARY_IMAGE_BUCKET,
      path: imagePath,
    });
  } else {
    push(fromUrl);
  }

  const videoPath = row.storage_path_video?.trim();
  if (videoPath) {
    push({
      bucket: fromVideoUrl?.path === videoPath ? fromVideoUrl.bucket : LIBRARY_VIDEO_BUCKET,
      path: videoPath,
    });
  } else {
    push(fromVideoUrl);
  }

  return targets;
}

/** Groups refs by bucket so a delete is one call per bucket, not one per file. */
export function groupTargetsByBucket(targets: StorageObjectRef[]): Map<string, string[]> {
  const byBucket = new Map<string, string[]>();
  for (const t of targets) {
    const paths = byBucket.get(t.bucket);
    if (paths) paths.push(t.path);
    else byBucket.set(t.bucket, [t.path]);
  }
  return byBucket;
}
