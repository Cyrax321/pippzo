// Normalisation for user-typed website URLs (the competitor `website` column).
//
// Pure: string in, verdict out. No I/O, no React — safe to import from the
// browser store, the add-competitor form and the chat agent's server tools.
//
// Why this exists (audit finding 52, follow-up): nothing on any write path
// normalises this value. `example.com` — which is how most people write a
// website — is stored verbatim, and `new URL("example.com")` throws, so the
// value is unusable as a link. Wave 2 stopped that from crashing the render;
// this stops the unusable value from being stored in the first place.
//
// `safeHttpUrl` in safe-url.ts is the read-side counterpart: it decides whether
// an already-stored value is safe to put in an href. This is the write side.

export type WebsiteUrlResult =
  /** `url` is undefined when the input was blank — the field is optional. */
  { ok: true; url: string | undefined } | { ok: false; error: string };

function tryParse(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Does this look like a hostname someone meant to type, rather than a stray
 * word? Requires a dot and a final label that could be a TLD: at least two
 * characters and not all digits.
 *
 * The all-digits rule deliberately rules out bare IP addresses on this path.
 * Not because an IP cannot be a website, but because the URL parser silently
 * *repairs* numeric hosts — `new URL("https://1.2.3")` yields the host
 * `1.2.0.3` — and quietly storing an address the user never typed is the same
 * class of bug this function exists to prevent. Someone who really means an IP
 * can type the scheme ("http://192.168.1.1"), which is respected verbatim.
 */
function looksLikeHostname(host: string): boolean {
  if (!host) return false;
  if (host.startsWith("[") && host.endsWith("]")) return true; // IPv6 literal
  if (host.startsWith(".") || host.endsWith(".")) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  if (labels.some((l) => l.length === 0)) return false;
  const tld = labels[labels.length - 1];
  return tld.length >= 2 && !/^\d+$/.test(tld);
}

/** Drops the "/" the URL parser adds to a bare origin, so example.com round-trips. */
function tidy(u: URL): string {
  const s = u.toString();
  return u.pathname === "/" && !u.search && !u.hash && s.endsWith("/") ? s.slice(0, -1) : s;
}

/**
 * Normalises a user-typed website.
 *
 *   ""  / "   "                 -> ok, undefined            (optional field)
 *   "example.com"               -> ok, "https://example.com"
 *   "www.example.com/a?b=1"     -> ok, "https://www.example.com/a?b=1"
 *   "example.com:8080/path"     -> ok, "https://example.com:8080/path"
 *   "https://example.com"       -> ok, unchanged             (scheme is respected)
 *   "HTTP://Example.com/x"      -> ok, unchanged
 *   "ftp://example.com"         -> rejected, unsupported scheme
 *   "javascript:alert(1)"       -> rejected, unsupported scheme
 *   "hello" / "not a url"       -> rejected, not a web address
 *
 * A value that already carries http:// or https:// is returned exactly as
 * typed (only trimmed), because rewriting a URL the user spelled out — its
 * path, its case, its trailing slash — is not this function's job.
 */
export function normalizeWebsiteUrl(raw: string | null | undefined): WebsiteUrlResult {
  const value = (raw ?? "").trim();
  if (!value) return { ok: true, url: undefined };

  // 1. Already a full http(s) URL? Respect it verbatim.
  const asTyped = tryParse(value);
  if (asTyped && (asTyped.protocol === "http:" || asTyped.protocol === "https:")) {
    if (!asTyped.hostname) {
      return { ok: false, error: `"${value}" has no website address after the "//".` };
    }
    return { ok: true, url: value };
  }

  // 2. No usable scheme. Assume https and see whether a real host falls out.
  //    This also covers "example.com:8080/path", which the URL parser would
  //    otherwise read as a scheme called "example.com".
  const assumed = tryParse(`https://${value}`);
  if (assumed && looksLikeHostname(assumed.hostname)) {
    // "mailto:hi@example.com" parses as user "mailto", password "hi", host
    // "example.com" — a real host, but not a website the user typed. The same
    // reading catches "user:password@example.com". Neither belongs here.
    if (assumed.username || assumed.password) {
      return {
        ok: false,
        error: `"${value}" looks like an email address or a login, not a website. Enter the site itself, for example "https://example.com".`,
      };
    }
    return { ok: true, url: tidy(assumed) };
  }

  // 3. Neither worked. Say which of the two problems it is.
  if (asTyped) {
    const scheme = asTyped.protocol.replace(/:$/, "");
    return {
      ok: false,
      error: `"${value}" is a ${scheme} link, not a website. Enter an http:// or https:// address, for example "https://example.com".`,
    };
  }
  return {
    ok: false,
    error: `"${value}" is not a valid website address. Enter a domain such as "example.com" or a full "https://example.com" URL.`,
  };
}
