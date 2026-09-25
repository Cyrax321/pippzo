// The pure, client-safe half of the Buffer integration.
//
// Three files each keep their own copy of the Buffer GraphQL plumbing —
// buffer.functions.ts (the UI's server functions), buffer-publish.server.ts
// (automation) and buffer-analytics.server.ts (metrics) — and the per-network
// caption limits lived in a fourth place entirely, a React route, where only a
// character counter ever read them. Every fact below is one the UI and at least
// one of those three need to agree on, so it lives here and is imported rather
// than retyped:
//
//   - how long a Buffer request may take, per kind of request;
//   - how long a caption may be, per network;
//   - what a Buffer failure actually means, and what to tell a person about it.
//
// docs/bugs.md finding 30 is what a duplicated limit table costs: the browser
// knew a 3000-character caption would not fit on X and the server did not, so
// the post went out on LinkedIn and failed on X after a live round trip.
//
// Nothing here may import a server-only module — src/routes/crear.tsx imports
// this file into the browser bundle.

import { FETCH_TIMEOUT, FetchTimeoutError } from "./fetch-timeout";
import type { Platform } from "./types";

// ===========================================================================
// Deadlines
// ===========================================================================

/**
 * How long each kind of Buffer request may take.
 *
 * Before finding 9's fix none of them had a deadline at all, which mattered
 * most here: the metrics sync and the autopost publish both run on the
 * automation tick, which executes its jobs serially inside one request, so a
 * single hung socket could stall the tick past the point where the next one
 * starts on top of it.
 *
 * These are per round trip, not per operation — a metrics sync that pulls
 * twelve pages can still legitimately take twelve times `metricsPage`.
 */
export const BUFFER_TIMEOUT = {
  /**
   * Reads and small mutations a person is waiting on: the account/channel
   * lookup behind Settings → Connections, a delete. Nothing is at stake if one
   * is given up on — re-reading status is free — and a human staring at a
   * spinner for longer than this has already learned nothing is coming.
   */
  read: 15_000,
  /**
   * `createPost` — the one call whose outcome we cannot afford to guess about.
   * It gets the full ordinary-API budget rather than the shorter read budget
   * because giving up early does not make a slow publish fail, it makes it
   * *unknown*: the claim is then held for PUBLISH_CLAIM_STALE_MS and a person
   * has to go and look at publish.buffer.com. Waiting an extra fifteen seconds
   * is much cheaper than that.
   */
  publish: FETCH_TIMEOUT.api,
  /**
   * One page of the paginated metrics pull. Deliberately below `publish`: the
   * sync issues one of these per page per channel, serially, on the automation
   * tick, so the ceiling that matters is the product and not the single call.
   * A dropped page costs nothing — metrics are re-synced on the next run.
   */
  metricsPage: 20_000,
} as const;

// ===========================================================================
// Per-network caption limits
// ===========================================================================

/** Our own platform vocabulary, reused so the two cannot drift apart. */
export type NetworkKey = Platform;

export type NetworkSpec = {
  key: NetworkKey;
  label: string;
  /** Maximum caption length the network itself accepts, in characters. */
  captionLimit: number;
};

/**
 * The caption limits, in the order the Create page offers them.
 *
 * Counted in UTF-16 code units (`String.length`), the same way the composer's
 * counter counts, because a limit the UI enforces differently from the server
 * is the bug this table exists to close. X's real rule is subtler than that
 * (URLs bill as 23 characters, some scripts as half), but it is subtler in the
 * *user's* favour, so a caption this check passes is one X will accept.
 */
export const NETWORKS: readonly NetworkSpec[] = [
  { key: "linkedin", label: "LinkedIn", captionLimit: 3000 },
  { key: "instagram", label: "Instagram", captionLimit: 2200 },
  { key: "tiktok", label: "TikTok", captionLimit: 2200 },
  { key: "x", label: "X", captionLimit: 280 },
  { key: "facebook", label: "Facebook", captionLimit: 5000 },
];

// Buffer names channels by `service`, and its vocabulary is not ours: it says
// "twitter" where we say "x". Only services we actually know a limit for are
// listed — an unrecognised one means "we do not know this network's rule", and
// the check below then declines to block rather than inventing a ceiling.
const SERVICE_ALIASES: Readonly<Record<string, NetworkKey>> = {
  x: "x",
  twitter: "x",
  linkedin: "linkedin",
  instagram: "instagram",
  tiktok: "tiktok",
  facebook: "facebook",
};

/** Buffer's `service` (or our own platform string) -> the network we know. */
export function normalizeNetwork(service: string | null | undefined): NetworkKey | null {
  if (!service) return null;
  return SERVICE_ALIASES[service.trim().toLowerCase()] ?? null;
}

/** The caption limit for a service, or null when the network is unknown to us. */
export function captionLimitFor(service: string | null | undefined): number | null {
  const key = normalizeNetwork(service);
  if (!key) return null;
  return NETWORKS.find((n) => n.key === key)?.captionLimit ?? null;
}

/** A human name for a service ("X", "LinkedIn"), falling back to what we got. */
export function networkLabel(service: string | null | undefined): string {
  const key = normalizeNetwork(service);
  return NETWORKS.find((n) => n.key === key)?.label ?? service ?? "this channel";
}

export type CaptionOverLimit = {
  network: NetworkKey;
  label: string;
  limit: number;
  length: number;
  over: number;
  /** Ready to show to a person: names the network, the limit and the overage. */
  message: string;
};

/**
 * Checks one caption against one channel's network limit.
 *
 * Returns null — meaning "send it" — when the caption fits, when the network is
 * one we have no limit for, or when there is no caption at all. That last case
 * is deliberate: an Instagram story legitimately carries no caption, and a post
 * with an empty string is never over any limit, so stories pass untouched.
 */
export function checkCaptionLength(
  service: string | null | undefined,
  text: string,
): CaptionOverLimit | null {
  const network = normalizeNetwork(service);
  const limit = captionLimitFor(service);
  if (!network || limit == null) return null;
  const length = text.length;
  if (length <= limit) return null;
  const over = length - limit;
  const label = networkLabel(service);
  return {
    network,
    label,
    limit,
    length,
    over,
    message:
      `${label} allows ${limit} characters and this caption is ${length} — ${over} over. ` +
      `Nothing was sent to ${label}; shorten it by ${over} character${over === 1 ? "" : "s"} for this channel, ` +
      `or post it to the other channels without ${label}.`,
  };
}

// ===========================================================================
// What a Buffer failure means
// ===========================================================================

/**
 * Why a Buffer call did not succeed.
 *
 * The distinction that matters (docs/bugs.md finding 29) is `auth` versus
 * everything else: a revoked token fails identically forever until a person
 * goes and reconnects it, whereas a blip fixes itself. Collapsing both into one
 * error string — which all three gql() copies used to do — is what let a
 * workspace sit with a dead Buffer connection and a green dashboard.
 */
export type BufferFailureKind =
  /** 401/403: the token is no longer accepted. A human must reconnect. */
  | "auth"
  /** The deadline was hit. Nothing is known about the outcome. */
  | "timeout"
  /** Socket error, 5xx, rate limit: Buffer's side, and temporary. */
  | "unreachable"
  /** Buffer answered and said no. Nothing was created. */
  | "rejected"
  /** Buffer answered something we could not read. Outcome unknown. */
  | "unknown";

/** Said wherever a dead Buffer token surfaces, so it always reads the same. */
export const BUFFER_RECONNECT_HINT =
  "Your Buffer connection is no longer valid — reconnect Buffer in Settings → Connections.";

/**
 * The counterpart: nothing is wrong with the connection, so nobody needs to
 * act. Deliberately does not promise a retry — only the caller knows whether
 * there will be one, and on the publish path there must not be.
 */
export const BUFFER_TRANSIENT_HINT =
  "Buffer could not be reached just now — that is Buffer's side, not your connection, and nothing needs reconnecting.";

/**
 * A Buffer failure that carries its HTTP status and what it means, instead of
 * the bare string every gql() copy used to throw.
 */
export class BufferApiError extends Error {
  readonly kind: BufferFailureKind;
  /** The HTTP status Buffer answered with, when it answered at all. */
  readonly status?: number;
  /**
   * True when the request may still have been carried out. The publish path
   * keys its claim-release decision off this: a request we cannot account for
   * keeps its claim, because retrying it is how you publish twice.
   */
  readonly outcomeUnknown: boolean;

  constructor(
    message: string,
    opts: { kind: BufferFailureKind; status?: number; outcomeUnknown?: boolean },
  ) {
    super(message);
    this.name = "BufferApiError";
    this.kind = opts.kind;
    if (opts.status !== undefined) this.status = opts.status;
    this.outcomeUnknown = opts.outcomeUnknown ?? false;
  }
}

// Buffer's GraphQL layer sometimes answers 200 with an auth message in the
// errors array rather than a 401, so the status alone is not enough to spot a
// dead token.
const AUTH_TEXT =
  /(unauthori[sz]ed|unauthenticated|not authenticated|invalid[_ ]?(access[_ ]?)?token|token (is |has |was )?(expired|revoked|invalid)|expired token|forbidden)/i;

/**
 * Turns a Buffer HTTP/GraphQL failure into a typed error that says which kind
 * of failure it is and what a person should do about it.
 *
 * `detail` (Buffer's own message) is always kept in the text: the status tells
 * us how to react, but only Buffer can say what it objected to.
 */
export function bufferHttpFailure(status: number, detail: string): BufferApiError {
  const isAuth = status === 401 || status === 403 || (status === 200 && AUTH_TEXT.test(detail));
  if (isAuth) {
    return new BufferApiError(
      `Buffer rejected the request [${status}]: ${detail}. ${BUFFER_RECONNECT_HINT}`,
      {
        kind: "auth",
        status,
        // A 401 is refused before Buffer does anything, so nothing was created.
        outcomeUnknown: false,
      },
    );
  }
  if (status >= 500 || status === 408) {
    return new BufferApiError(`${BUFFER_TRANSIENT_HINT} (Buffer answered ${status}: ${detail})`, {
      kind: "unreachable",
      status,
      // A 5xx can come from an edge proxy after the origin already did the
      // work, so this is genuinely ambiguous and must not be auto-retried.
      outcomeUnknown: true,
    });
  }
  if (status === 429) {
    // Rate limiting is refused at the door, so unlike a 5xx this one is certain:
    // nothing was created and the request can safely be made again later.
    return new BufferApiError(
      `Buffer is rate-limiting this workspace (${status}: ${detail}). Nothing was sent.`,
      { kind: "unreachable", status, outcomeUnknown: false },
    );
  }
  // Anything else is Buffer answering and saying no — a bad request, a caption
  // it refuses, a channel it does not recognise. Kept verbatim, as before.
  return new BufferApiError(`Buffer API: ${detail}`, {
    kind: "rejected",
    status,
    outcomeUnknown: false,
  });
}

/**
 * Buffer answered with a success status and a body we could not use.
 *
 * This is its own failure, not a missing field: `json!.data` used to throw
 * "Cannot read properties of null (reading 'data')", which told the user
 * nothing and — worse — looked like a clean failure, inviting a retry of a
 * request Buffer may already have accepted. Say what we actually know.
 */
export function bufferUnreadableResponse(status: number, hasJson: boolean): BufferApiError {
  const cause = hasJson ? "the response had no data in it" : "the response body could not be read";
  return new BufferApiError(
    `Buffer answered ${status} but ${cause}, so we cannot tell whether it went through — usually a proxy or a truncated reply. ` +
      `Check publish.buffer.com before retrying, because the request may have succeeded.`,
    { kind: "unknown", status, outcomeUnknown: true },
  );
}

export type BufferFailure = {
  kind: BufferFailureKind;
  status?: number;
  outcomeUnknown: boolean;
  /** What to tell a person on a read path. */
  message: string;
};

/**
 * Reads any thrown value back into the three things a caller needs: whether the
 * connection is dead, whether the outcome is knowable, and what to say.
 *
 * FetchTimeoutError keeps its own identity all the way from fetch-timeout.ts —
 * it is not wrapped anywhere — so it can be recognised precisely here rather
 * than by sniffing message text.
 */
export function classifyBufferFailure(e: unknown): BufferFailure {
  if (e instanceof FetchTimeoutError) {
    return { kind: "timeout", outcomeUnknown: true, message: e.message };
  }
  if (e instanceof BufferApiError) {
    return {
      kind: e.kind,
      ...(e.status !== undefined ? { status: e.status } : {}),
      outcomeUnknown: e.outcomeUnknown,
      message: e.message,
    };
  }
  const message = e instanceof Error ? e.message : String(e);
  // An unclassified throw is most often a socket that died mid-request, which
  // is exactly the case where the request may still have landed.
  return { kind: "unreachable", outcomeUnknown: true, message };
}

/** True when the workspace's Buffer token needs a human to reconnect it. */
export function isBufferAuthFailure(e: unknown): boolean {
  return classifyBufferFailure(e).kind === "auth";
}

/**
 * The same failure, phrased for a path that was in the middle of publishing.
 *
 * The rule this enforces: when the outcome is unknown we never say "it failed,
 * try again". Buffer may have accepted the post, and a person who is told to
 * retry will put a second copy on a live channel. Say what we actually know —
 * that we stopped waiting and do not know — and send them to look.
 */
export function bufferPublishFailureMessage(failure: BufferFailure): string {
  if (failure.kind === "timeout") {
    return (
      `${failure.message} ` +
      `We cannot tell whether this post went out. Check publish.buffer.com for this channel before doing anything else, ` +
      `and publish it again only if it is not there.`
    );
  }
  if (failure.outcomeUnknown && failure.kind === "unreachable") {
    const how = failure.status
      ? `it answered ${failure.status} instead of confirming the post`
      : `the connection broke before Buffer answered`;
    return (
      `${failure.message} We cannot be sure this post did not go out — ${how}. ` +
      `Check publish.buffer.com for this channel before publishing it again.`
    );
  }
  // "auth", "rejected", a rate limit, and the unreadable-response case all
  // already carry a full, accurate explanation of their own.
  return failure.message;
}
