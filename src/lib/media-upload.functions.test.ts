import { describe, it, expect } from "vitest";
import {
  LIBRARY_IMAGE_BUCKET,
  LIBRARY_VIDEO_BUCKET,
  groupTargetsByBucket,
  libraryAssetStorageTargets,
  parseStorageObjectUrl,
} from "./media-upload.functions";

const WS = "11111111-2222-3333-4444-555555555555";

describe("parseStorageObjectUrl", () => {
  it("reads a signed storage URL", () => {
    expect(
      parseStorageObjectUrl(
        `https://abc.supabase.co/storage/v1/object/sign/media/${WS}/pic.png?token=xyz`,
      ),
    ).toEqual({ bucket: "media", path: `${WS}/pic.png` });
  });

  it("reads a public storage URL", () => {
    expect(
      parseStorageObjectUrl(`https://abc.supabase.co/storage/v1/object/public/media/${WS}/a.jpg`),
    ).toEqual({ bucket: "media", path: `${WS}/a.jpg` });
  });

  it("reads a local stack URL", () => {
    expect(
      parseStorageObjectUrl(
        `http://127.0.0.1:54321/storage/v1/object/sign/buffer-media/${WS}/clip.mp4?token=t`,
      ),
    ).toEqual({ bucket: "buffer-media", path: `${WS}/clip.mp4` });
  });

  it("reads a URL rewritten through the public media proxy", () => {
    // toPublicMediaUrl() reshapes signed URLs for the tunnel; the object is the
    // same one, so a delete has to find it through this shape too.
    expect(
      parseStorageObjectUrl(
        `https://tunnel.example/api/public/media/object/sign/buffer-media/${WS}/clip.mp4?token=t`,
      ),
    ).toEqual({ bucket: "buffer-media", path: `${WS}/clip.mp4` });
  });

  it("keeps nested paths whole", () => {
    expect(
      parseStorageObjectUrl(
        `https://abc.supabase.co/storage/v1/object/sign/media/${WS}/nested/dir/a.png?token=t`,
      ),
    ).toEqual({ bucket: "media", path: `${WS}/nested/dir/a.png` });
  });

  it("decodes percent-encoded segments", () => {
    expect(
      parseStorageObjectUrl(
        `https://abc.supabase.co/storage/v1/object/sign/media/${WS}/my%20photo.png?token=t`,
      ),
    ).toEqual({ bucket: "media", path: `${WS}/my photo.png` });
  });

  it("returns null for a legacy base64 data URL", () => {
    expect(parseStorageObjectUrl("data:image/png;base64,iVBORw0KGgo=")).toBeNull();
  });

  it("returns null for empty, malformed and non-storage URLs", () => {
    expect(parseStorageObjectUrl(null)).toBeNull();
    expect(parseStorageObjectUrl(undefined)).toBeNull();
    expect(parseStorageObjectUrl("   ")).toBeNull();
    expect(parseStorageObjectUrl("not a url")).toBeNull();
    expect(parseStorageObjectUrl("https://example.com/photo.png")).toBeNull();
  });

  it("returns null when a bucket has no object path after it", () => {
    expect(
      parseStorageObjectUrl("https://abc.supabase.co/storage/v1/object/sign/media"),
    ).toBeNull();
    expect(
      parseStorageObjectUrl("https://abc.supabase.co/storage/v1/object/sign/media/"),
    ).toBeNull();
  });
});

describe("libraryAssetStorageTargets", () => {
  it("uses storage_path for an uploaded image", () => {
    expect(
      libraryAssetStorageTargets({
        storage_path: `${WS}/a.png`,
        url: `https://abc.supabase.co/storage/v1/object/sign/media/${WS}/a.png?token=t`,
      }),
    ).toEqual([{ bucket: LIBRARY_IMAGE_BUCKET, path: `${WS}/a.png` }]);
  });

  it("falls back to the URL when no path column was written", () => {
    expect(
      libraryAssetStorageTargets({
        url: `https://abc.supabase.co/storage/v1/object/sign/media/${WS}/b.png?token=t`,
      }),
    ).toEqual([{ bucket: LIBRARY_IMAGE_BUCKET, path: `${WS}/b.png` }]);
  });

  it("returns nothing for a legacy base64 row — there is no object to delete", () => {
    expect(libraryAssetStorageTargets({ url: "data:image/png;base64,iVBORw0KGgo=" })).toEqual([]);
    expect(libraryAssetStorageTargets({})).toEqual([]);
  });

  it("finds a video object from video_url alone", () => {
    expect(
      libraryAssetStorageTargets({
        url: "data:image/png;base64,iVBORw0KGgo=", // poster frame, not an object
        video_url: `https://abc.supabase.co/storage/v1/object/sign/buffer-media/${WS}/v.mp4?token=t`,
      }),
    ).toEqual([{ bucket: LIBRARY_VIDEO_BUCKET, path: `${WS}/v.mp4` }]);
  });

  it("returns both objects when a row carries an image and a video", () => {
    expect(
      libraryAssetStorageTargets({
        storage_path: `${WS}/poster.png`,
        storage_path_video: `${WS}/v.mp4`,
        url: `https://abc.supabase.co/storage/v1/object/sign/media/${WS}/poster.png?token=t`,
        video_url: `https://abc.supabase.co/storage/v1/object/sign/buffer-media/${WS}/v.mp4?token=t`,
      }),
    ).toEqual([
      { bucket: LIBRARY_IMAGE_BUCKET, path: `${WS}/poster.png` },
      { bucket: LIBRARY_VIDEO_BUCKET, path: `${WS}/v.mp4` },
    ]);
  });

  it("takes the bucket from the URL when it agrees with the stored path", () => {
    // An image row whose object happens to live in the buffer-media bucket:
    // the path alone cannot say which bucket, the URL can.
    expect(
      libraryAssetStorageTargets({
        storage_path: `${WS}/c.png`,
        url: `https://abc.supabase.co/storage/v1/object/sign/buffer-media/${WS}/c.png?token=t`,
      }),
    ).toEqual([{ bucket: LIBRARY_VIDEO_BUCKET, path: `${WS}/c.png` }]);
  });

  it("defaults to the media bucket when the URL points somewhere else entirely", () => {
    expect(
      libraryAssetStorageTargets({
        storage_path: `${WS}/d.png`,
        url: "https://cdn.example.com/d.png",
      }),
    ).toEqual([{ bucket: LIBRARY_IMAGE_BUCKET, path: `${WS}/d.png` }]);
  });

  it("ignores blank path columns", () => {
    expect(libraryAssetStorageTargets({ storage_path: "   ", storage_path_video: "" })).toEqual([]);
  });

  it("dedupes when url and video_url point at the same object", () => {
    const url = `https://abc.supabase.co/storage/v1/object/sign/media/${WS}/same.mp4?token=t`;
    expect(libraryAssetStorageTargets({ url, video_url: url })).toEqual([
      { bucket: LIBRARY_IMAGE_BUCKET, path: `${WS}/same.mp4` },
    ]);
  });
});

describe("groupTargetsByBucket", () => {
  it("groups paths so each bucket is one remove() call", () => {
    const grouped = groupTargetsByBucket([
      { bucket: "media", path: "a.png" },
      { bucket: "buffer-media", path: "v.mp4" },
      { bucket: "media", path: "b.png" },
    ]);
    expect([...grouped.entries()]).toEqual([
      ["media", ["a.png", "b.png"]],
      ["buffer-media", ["v.mp4"]],
    ]);
  });

  it("is empty for no targets", () => {
    expect(groupTargetsByBucket([]).size).toBe(0);
  });
});
