// One place to put a deadline on an outbound request.
//
// Why this exists: before it, not a single fetch() in this codebase passed an
// AbortSignal. A stalled call to Buffer, Unipile, an image provider or Slack had
// no upper bound, and several of them sit on the automation tick — which runs 25
// jobs serially in one request. One hung socket could therefore stall the whole
// tick past the point where the next tick starts on top of it, which is how the
// duplicate-run bug (docs/bugs.md finding 4) became reachable. Timeouts are the
// floor that finding's fix stands on.
//
// Deliberately NOT a retry helper. Almost every call site here is a write to a
// third party — publishing a post, sending a reply, starting a paid render — and
// retrying a request whose outcome is unknown is how you publish twice. Callers
// that can safely retry should decide that for themselves, with an idempotency
// key, the way publishScheduledPostToBuffer does.

/** Thrown when a request passed its deadline. Distinct so callers can tell a
 *  timeout from a refusal and say something useful about it. */
export class FetchTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly label: string;
  constructor(label: string, timeoutMs: number) {
    super(
      `${label} did not respond within ${Math.round(timeoutMs / 1000)}s, so the request was given up on. ` +
        `It may still have been received — check before retrying anything that publishes or sends.`,
    );
    this.name = "FetchTimeoutError";
    this.timeoutMs = timeoutMs;
    this.label = label;
  }
}

/**
 * Sensible deadlines by kind of work. These are ceilings for a single HTTP
 * round trip, not budgets for an operation: a job that makes ten calls can still
 * take ten times the relevant number.
 */
export const FETCH_TIMEOUT = {
  /** Ordinary JSON API calls: Buffer, Unipile, Slack, scraping services. */
  api: 30_000,
  /** Model inference, which is legitimately slow. Image generation especially. */
  inference: 120_000,
  /** Downloading a generated asset — large, but should not hang forever. */
  download: 90_000,
} as const;

/**
 * fetch() with a deadline.
 *
 * `label` is shown to the user when the deadline is hit, so name the service as
 * a person would recognise it ("Buffer", "the image provider"), not the URL.
 *
 * Any AbortSignal already on `init` is respected as well: whichever fires first
 * wins, so an upstream cancellation still works.
 */
export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  opts: { timeoutMs?: number; label: string },
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT.api;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? // Both matter: the caller may cancel for its own reasons, and the deadline
      // must still apply if it does not.
      AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;

  try {
    return await fetch(input, { ...init, signal });
  } catch (e) {
    // Only the deadline becomes a FetchTimeoutError. A caller-driven abort, a
    // DNS failure or a refused connection are different problems and must keep
    // their own identity rather than being reported as "slow".
    if (timeoutSignal.aborted) throw new FetchTimeoutError(opts.label, timeoutMs);
    throw e;
  }
}
