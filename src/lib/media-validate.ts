// Validation for user-supplied media, before any of it is stored or sent on.
//
// Why this exists: library image uploads read a file into a base64 data URL in
// the browser and insert it straight into a text column, with no size check and
// no type check on either side (docs/bugs.md finding 8). The file picker's
// `accept="image/*"` is advisory — drag-and-drop, a renamed file, or a direct
// call to the server function all bypass it. So a 200MB video renamed .png could
// be stored as a brand image, handed to an image model as a style reference, and
// attached to a real post.
//
// Everything here is pure so it can be tested without a database or a network.

/** Image types we are willing to store and hand to a provider or to Buffer. */
export const ALLOWED_IMAGE_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number];

/**
 * Ceiling for one library image, in decoded bytes.
 *
 * Large enough for a photograph straight off a phone or a camera export, small
 * enough that a workspace's library still loads in one request. Buffer's own
 * per-image limits sit below this for every network, so anything that passes
 * here is a storage question rather than a publishing one.
 */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/**
 * Base64 inflates by 4/3, plus the `data:...;base64,` preamble. Server-side
 * validators cap the *string* before decoding, so the work of decoding an
 * oversized payload is never done at all.
 */
export const MAX_IMAGE_DATA_URL_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 128;

export type MediaError = { ok: false; error: string };
export type ParsedImage = {
  ok: true;
  mime: AllowedImageMime;
  bytes: Uint8Array;
  sizeBytes: number;
  /** Extension matching the sniffed type, not whatever the filename claimed. */
  ext: string;
};

const DATA_URL_RE = /^data:([\w.+-]+\/[\w.+-]+)?(;charset=[\w-]+)?;base64,([A-Za-z0-9+/=\s]+)$/;

const EXT_BY_MIME: Record<AllowedImageMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

/**
 * Identifies an image from its leading bytes.
 *
 * The declared mime type is a claim by the uploader and is not trusted: the
 * whole point of this check is that a file renamed .png still announces itself
 * as image/png. Returns null when the content is not an image we accept.
 */
export function sniffImageMime(bytes: Uint8Array): AllowedImageMime | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  // WEBP is a RIFF container: "RIFF" .... "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  return null;
}

/** Decodes base64 to bytes without the quadratic string building used elsewhere. */
function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Parses and validates an image data URL.
 *
 * Order matters: the string length is checked before decoding, so an oversized
 * payload is rejected without ever being expanded in memory.
 */
export function parseImageDataUrl(dataUrl: string): ParsedImage | MediaError {
  const raw = (dataUrl ?? "").trim();
  if (!raw) return { ok: false, error: "No image data was provided." };

  if (raw.length > MAX_IMAGE_DATA_URL_CHARS) {
    return {
      ok: false,
      error: `That image is larger than the ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB limit. Export it at a smaller size and try again.`,
    };
  }

  const m = DATA_URL_RE.exec(raw);
  if (!m) {
    return {
      ok: false,
      error: "That file could not be read as an image. Upload a PNG, JPEG, WebP or GIF.",
    };
  }

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(m[3]);
  } catch {
    return { ok: false, error: "That image could not be decoded — the file may be damaged." };
  }

  if (bytes.length === 0) return { ok: false, error: "That image file is empty." };
  if (bytes.length > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: `That image is ${(bytes.length / (1024 * 1024)).toFixed(1)}MB, over the ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB limit. Export it at a smaller size and try again.`,
    };
  }

  // The declared type is ignored in favour of the actual content.
  const sniffed = sniffImageMime(bytes);
  if (!sniffed) {
    const claimed = m[1];
    return {
      ok: false,
      error: claimed
        ? `That file says it is ${claimed} but its contents are not a PNG, JPEG, WebP or GIF. Upload a real image file.`
        : "That file is not a PNG, JPEG, WebP or GIF.",
    };
  }

  return { ok: true, mime: sniffed, bytes, sizeBytes: bytes.length, ext: EXT_BY_MIME[sniffed] };
}

/**
 * Storage object path for a workspace's media. The first segment must be the
 * workspace id: the storage policies key on it
 * (`(string_to_array(name,'/'))[1]::uuid`), so this shape is what makes a
 * workspace's files unreadable to another workspace.
 */
export function mediaStoragePath(
  workspaceId: string,
  ext: string,
  id: string = crypto.randomUUID(),
): string {
  return `${workspaceId}/${id}.${ext}`;
}
