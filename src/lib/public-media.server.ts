// Makes Supabase Storage signed URLs reachable from the public internet.
//
// Buffer downloads post media from its own servers. That is fine when Supabase
// is hosted, but a local stack signs URLs against http://127.0.0.1:54321, which
// Buffer cannot resolve — every post with an image or video would fail with an
// unhelpful upstream error.
//
// When PUBLIC_APP_URL is set, signed URLs are rewritten to travel through this
// app's own /api/public/media proxy, which is exposed by the same tunnel that
// serves inbound webhooks. The signed token is preserved, so access control is
// unchanged.
//
// When PUBLIC_APP_URL is empty the URL is returned untouched, which is the
// correct behaviour for a hosted Supabase deployment.

const STORAGE_PREFIX = "/storage/v1/";

export function publicAppUrl(): string | null {
  const raw = process.env.PUBLIC_APP_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

/**
 * Rewrites a Supabase signed URL to go through the public media proxy.
 * Returns the input unchanged when no public URL is configured or the URL is
 * not a Supabase storage URL.
 */
export function toPublicMediaUrl(signedUrl: string): string {
  const base = publicAppUrl();
  if (!base) return signedUrl;

  let parsed: URL;
  try {
    parsed = new URL(signedUrl);
  } catch {
    return signedUrl;
  }

  const idx = parsed.pathname.indexOf(STORAGE_PREFIX);
  if (idx === -1) return signedUrl;

  const rest = parsed.pathname.slice(idx + STORAGE_PREFIX.length);
  return `${base}/api/public/media/${rest}${parsed.search}`;
}

/**
 * Throws when media is about to be handed to an external service that could
 * never fetch it. Failing here produces an actionable message instead of a
 * confusing rejection from the other side.
 */
export function assertPubliclyFetchable(url: string, what: string): void {
  let protocol: string;
  let host: string;
  try {
    const parsed = new URL(url);
    protocol = parsed.protocol;
    host = parsed.hostname.toLowerCase();
  } catch {
    throw new Error(`${what} is not a valid URL.`);
  }

  // Note: URL keeps the brackets on an IPv6 literal, e.g.
  // new URL("http://[::1]/x").hostname === "[::1]", so the loopback and
  // unique-local checks below match on the bracketed form.
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^\[f[cd]/.test(host);

  if (isLocal) {
    throw new Error(
      `${what} is only reachable at ${host}, so Buffer cannot download it. ` +
        `Start the tunnel (npm run tunnel) and set PUBLIC_APP_URL in .env to the public URL it prints, then restart the dev server.`,
    );
  }

  // The URL carries a Supabase signed-storage token good for a year — sending
  // it over plain http (or any non-https scheme) exposes that long-lived
  // credential to anyone on the network path.
  if (protocol !== "https:") {
    throw new Error(
      `${what} must be fetched over https (got "${protocol}"), because it carries a signed access ` +
        `token that would otherwise travel in cleartext. If this came from PUBLIC_APP_URL, make sure ` +
        `that variable starts with https://.`,
    );
  }
}
