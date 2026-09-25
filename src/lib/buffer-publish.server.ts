// Server-side Buffer publishing for automation flows (cron autopost, the
// approve→publish path). The user-facing serverFn in buffer.functions.ts
// carries auth middleware and can't be called without a request context, so
// the GraphQL plumbing is mirrored here for callers that already hold the
// service-role client. Kept deliberately small: one channel, one post.

import { toPublicMediaUrl, assertPubliclyFetchable } from "./public-media.server";
import { fetchWithTimeout, FetchTimeoutError } from "./fetch-timeout";
import {
  BUFFER_TIMEOUT,
  BufferApiError,
  bufferHttpFailure,
  bufferPublishFailureMessage,
  bufferUnreadableResponse,
  classifyBufferFailure,
} from "./buffer-shared";

const ENDPOINT = "https://api.buffer.com";

async function gql<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
  op = "graphql",
  // This module exists to publish, so the publish budget is the default rather
  // than something each call site has to remember to ask for.
  timeoutMs: number = BUFFER_TIMEOUT.publish,
): Promise<T> {
  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      ENDPOINT,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query, variables }),
      },
      { timeoutMs, label: "Buffer" },
    );
  } catch (e) {
    console.error(`[buffer-publish:${op}] network error`, e);
    // A timeout keeps its own identity all the way to the caller: it is the one
    // failure where the request may have landed anyway, and the publish path
    // decides what to do about that. Wrapping it would erase the distinction.
    if (e instanceof FetchTimeoutError) throw e;
    throw new BufferApiError(
      `Buffer network error: ${e instanceof Error ? e.message : String(e)}`,
      { kind: "unreachable", outcomeUnknown: true },
    );
  }
  const ms = Date.now() - startedAt;
  let json: { data?: T; errors?: Array<{ message: string }> } | null = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok || json?.errors?.length) {
    const msg = json?.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`;
    console.error(`[buffer-publish:${op}] failed in ${ms}ms`, {
      status: res.status,
      errors: json?.errors,
    });
    // The status travels with the error now. A 401 here means a revoked token,
    // which needs a person; anything else mostly does not (finding 29).
    throw bufferHttpFailure(res.status, msg);
  }
  if (!json || json.data == null) {
    console.error(`[buffer-publish:${op}] unreadable success response in ${ms}ms`, {
      status: res.status,
      hasJson: !!json,
    });
    throw bufferUnreadableResponse(res.status, !!json);
  }
  console.info(`[buffer-publish:${op}] ok in ${ms}ms`);
  return json.data as T;
}

/**
 * How long a publish claim on a scheduled post is honoured before another
 * attempt may take it over.
 *
 * Two failure modes bound this from opposite sides. Too short and a publish
 * that is slow but alive gets double-fired, which is the exact double post we
 * are preventing; too long and a process that died mid-publish wedges the post
 * until someone edits the database by hand.
 *
 * The floor is one Buffer `createPost` round trip, which now has a hard
 * ceiling: BUFFER_TIMEOUT.publish. Ten minutes is twenty times that, so a
 * request that is still alive can never be overtaken — and when the deadline
 * does fire the window is doing its real job, holding the post shut for long
 * enough that nobody retries a publish whose outcome we do not know.
 *
 * The ceiling is human patience: a user who hits Approve, sees the tab crash
 * and tries again should not be told "wait" for the rest of the afternoon. Ten
 * minutes is short enough to retry within the same sitting and long enough
 * that it can never be mistaken for a live call. It is deliberately well under
 * STALE_RUN_MS (30 min, which covers a whole multi-step cron job) because this
 * claim covers one HTTP request, not a job.
 */
export const PUBLISH_CLAIM_STALE_MS = 10 * 60 * 1000;

export type PublishClaim =
  | { claimed: true }
  | { claimed: false; reason: "published"; bufferId: string }
  | { claimed: false; reason: "in_flight"; since?: string }
  | { claimed: false; reason: "missing" }
  | { claimed: false; reason: "error"; detail: string };

// The narrow slice of the Supabase client the claim actually uses: one
// conditional update, and one read to explain a refusal.
type ClaimRows = { data?: unknown[] | null; error?: unknown };
type ClaimUpdateChain = PromiseLike<ClaimRows> & {
  eq: (column: string, value: string) => ClaimUpdateChain;
  is: (column: string, value: null) => ClaimUpdateChain;
  or: (filter: string) => ClaimUpdateChain;
  select: (columns: string) => PromiseLike<ClaimRows>;
};
type ClaimReadChain = {
  eq: (column: string, value: string) => ClaimReadChain;
  maybeSingle: () => PromiseLike<{ data?: unknown; error?: unknown }>;
};
type ClaimClient = {
  from: (table: string) => {
    update: (patch: Record<string, unknown>) => ClaimUpdateChain;
    select: (columns: string) => ClaimReadChain;
  };
};

/**
 * Takes ownership of a scheduled post before anything is sent to Buffer.
 *
 * Every publish path in the app — the cron autopost, the Approvals screen, the
 * batch publish when approval is off, and the agent's approve tool — funnels
 * through publishScheduledPostToBuffer, and none of them used to check whether
 * the post had already gone out. A double-click, two overlapping cron ticks, or
 * a retry after an ambiguous response each produced a second real post on a
 * real social channel. This is the one place that can stop all of them, so the
 * claim lives here rather than in four callers.
 *
 * The claim is a single conditional UPDATE, so Postgres decides the winner:
 * take the row only while `buffer_id IS NULL` (never published) and the
 * previous claim is either absent or older than PUBLISH_CLAIM_STALE_MS (so a
 * crashed process cannot wedge the post). Zero rows updated means somebody
 * else holds it; a follow-up read says which of the two it is, because
 * "already published" and "a publish is running right now" need very
 * different things from the user.
 */
export async function claimPostForPublish(
  admin: ClaimClient,
  postId: string,
  now = new Date(),
): Promise<PublishClaim> {
  const cutoff = new Date(now.getTime() - PUBLISH_CLAIM_STALE_MS).toISOString();
  try {
    const { data, error } = await admin
      .from("scheduled_posts")
      .update({ publish_claimed_at: now.toISOString() })
      .eq("id", postId)
      .is("buffer_id", null)
      .or(`publish_claimed_at.is.null,publish_claimed_at.lt.${cutoff}`)
      .select("id");
    if (error) {
      console.error("[buffer-publish:claim] claim failed", { postId, error });
      return {
        claimed: false,
        reason: "error",
        detail: (error as { message?: string })?.message ?? String(error),
      };
    }
    if (((data as unknown[] | null) ?? []).length > 0) return { claimed: true };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[buffer-publish:claim] claim failed", { postId, detail });
    return { claimed: false, reason: "error", detail };
  }

  // Nothing was claimed. Read the row back to say why — reporting "already
  // published" as "a publish is in flight" (or the reverse) sends the user
  // looking in the wrong place.
  try {
    const { data: row } = await admin
      .from("scheduled_posts")
      .select("buffer_id,publish_claimed_at")
      .eq("id", postId)
      .maybeSingle();
    const existing = row as {
      buffer_id?: string | null;
      publish_claimed_at?: string | null;
    } | null;
    if (!existing) return { claimed: false, reason: "missing" };
    if (existing.buffer_id)
      return { claimed: false, reason: "published", bufferId: existing.buffer_id };
    return {
      claimed: false,
      reason: "in_flight",
      ...(existing.publish_claimed_at ? { since: existing.publish_claimed_at } : {}),
    };
  } catch (e) {
    // We know we do not hold the claim, and that is the part that matters.
    console.warn("[buffer-publish:claim] could not read back the unclaimed post", { postId }, e);
    return { claimed: false, reason: "in_flight" };
  }
}

/**
 * Hands the claim back after an attempt that definitely sent nothing (no
 * Buffer token, no usable channel, an explicit rejection from Buffer). Holding
 * it in those cases would make the user wait out the staleness window before
 * they could retry a fix that is ready now.
 *
 * Never called when the outcome is unknown — an ambiguous response keeps its
 * claim on purpose, so the retry is blocked until the window expires.
 *
 * Best effort: failing to release must not turn a clear error into a different
 * one, so it is logged and swallowed.
 */
async function releasePublishClaim(admin: ClaimClient, postId: string): Promise<void> {
  try {
    await admin
      .from("scheduled_posts")
      .update({ publish_claimed_at: null })
      .eq("id", postId)
      .is("buffer_id", null);
  } catch (e) {
    console.warn("[buffer-publish:claim] could not release the claim", { postId }, e);
  }
}

// Our post schema says "x"; Buffer's channel list says "twitter". Accept both
// directions so a platform choice never misses its channel over naming.
function serviceMatches(platform: string, service: string): boolean {
  const p = platform.toLowerCase();
  const s = service.toLowerCase();
  if (p === s) return true;
  return (p === "x" && s === "twitter") || (p === "twitter" && s === "x");
}

export type BufferChannel = { id?: string; name?: string; service?: string };

export type ChannelChoice =
  | { ok: true; channel: { id: string; name?: string }; note?: string }
  | { ok: false; error: string };

/**
 * Decides which Buffer channel a post goes to.
 *
 * An explicit channel id (scheduled_posts.buffer_channel_id, set when the post
 * was scheduled against a specific channel) always wins: picking a different
 * channel than the one the user chose is worse than not publishing.
 *
 * Without one, the post's platform is matched against the connected channels.
 * A workspace with two LinkedIn pages makes that genuinely ambiguous — the
 * first match is still used (refusing to publish would be worse), but the
 * caller gets a note naming the channel used and the ones that also matched.
 *
 * Pure: the cached channel list in, a decision out. No network, no database.
 */
export function chooseChannel(
  channels: BufferChannel[],
  platform: string,
  explicitChannelId?: string | null,
): ChannelChoice {
  const usable = channels.filter((c): c is BufferChannel & { id: string } => !!c?.id);

  if (explicitChannelId) {
    const exact = usable.find((c) => c.id === explicitChannelId);
    if (exact) return { ok: true, channel: exact };
    return {
      ok: false,
      error:
        `This post was set to publish to Buffer channel ${explicitChannelId}, which is not in the connected channel list any more — nothing was sent. ` +
        `Open Settings → Connections and hit Refresh to re-read your Buffer channels; if that channel was disconnected, schedule the post again against a current one.`,
    };
  }

  const matches = usable.filter((c) => serviceMatches(platform, String(c.service ?? "")));
  if (matches.length === 0) {
    return {
      ok: false,
      error:
        `No ${platform} channel is linked in Buffer, so the post was not sent. ` +
        `Connect one at publish.buffer.com/channels, then open Settings → Connections and hit Refresh.`,
    };
  }

  const channel = matches[0];
  const used = channel.name ?? channel.id;
  if (matches.length > 1) {
    const others = matches
      .slice(1)
      .map((c) => c.name ?? c.id)
      .join(", ");
    return {
      ok: true,
      channel,
      note:
        `${matches.length} ${platform} channels are connected and this post did not say which one to use, so "${used}" was picked (also matching: ${others}). ` +
        `To control this, schedule the post against a specific channel instead of a platform.`,
    };
  }
  return { ok: true, channel };
}

/**
 * Publishes one scheduled post to the workspace's Buffer channel: the one
 * `post.channelId` names, or failing that the first channel matching the
 * post's platform. On success the scheduled_posts row is stamped with the
 * Buffer post id + channel id so it is never swept up again.
 *
 * When `ok` is true but `error` is set, the post went out with a caveat
 * (e.g. the image was only reachable locally, so it published text-only, or
 * the channel had to be guessed) — callers should surface it as a note, not a
 * failure.
 */
export async function publishScheduledPostToBuffer(
  admin: { from: (t: string) => any; storage?: any },
  workspaceId: string,
  post: {
    id: string;
    platform: string;
    caption: string;
    imageUrl?: string | null;
    scheduledAtISO?: string | null;
    /** scheduled_posts.buffer_channel_id — the channel the post was scheduled
     * against, when it was scheduled against one. Preferred over matching. */
    channelId?: string | null;
  },
): Promise<{
  ok: boolean;
  bufferId?: string;
  channelId?: string;
  channelName?: string;
  error?: string;
  /**
   * True when nothing was sent to Buffer AND the outcome is genuinely unknown —
   * another publish holds the claim, the row vanished, or the claim itself
   * errored. Distinct from `ok:false` with this unset, which means Buffer was
   * asked and said no.
   *
   * Callers that record a status (cron, bufferPublishApprovedPost, the agent's
   * approve tool) must NOT write `publish_failed` when this is set: the post may
   * be seconds away from publishing successfully in the attempt that holds the
   * claim, and stamping it failed would contradict reality and mislead the user.
   */
  notAttempted?: boolean;
  /**
   * True when the request DID go to Buffer and we cannot say what it did with
   * it: the deadline fired, the socket dropped, Buffer answered 5xx, or the
   * reply could not be read. Buffer may have accepted the post.
   *
   * The difference from `notAttempted` is what was sent: nothing at all, versus
   * a request whose fate is unknown. Both are wrong to record as
   * `publish_failed` — that word asserts Buffer was asked and refused — but
   * only this one deserves a status of its own (`publish_unknown`), because a
   * user who reads "failed" and republishes can end up with two live posts.
   * See docs/bugs.md finding 54; `publishOutcomeStatus` is the one place that
   * turns these flags into a status, so all three writers agree.
   */
  outcomeUnknown?: boolean;
}> {
  // Claim first, before a single byte goes to Buffer. Anything that gets past
  // this line is the only publish attempt running for this post.
  const claim = await claimPostForPublish(admin, post.id);
  if (!claim.claimed) {
    if (claim.reason === "published")
      // Not a failure: the post IS on the channel. ok:true keeps the caller
      // from stamping a published row as 'publish_failed', and the note tells
      // the user why nothing new went out.
      return {
        ok: true,
        bufferId: claim.bufferId,
        error: `This post was already published to Buffer (post ${claim.bufferId}), so it was not sent a second time.`,
      };
    if (claim.reason === "in_flight")
      return {
        ok: false,
        notAttempted: true,
        error:
          `A publish for this post is already running, so it was not sent again — publishing twice would put two copies on the channel. ` +
          `Give it a minute and refresh; if it is still stuck after ${Math.round(PUBLISH_CLAIM_STALE_MS / 60000)} minutes, try again and this attempt will take over.`,
      };
    if (claim.reason === "missing")
      return {
        ok: false,
        notAttempted: true,
        error: `That post is no longer on the calendar, so there was nothing to publish. It may have been deleted while this was queued.`,
      };
    return {
      ok: false,
      notAttempted: true,
      error: `The post could not be reserved for publishing, so nothing was sent rather than risk publishing it twice (${claim.detail}). Try again in a moment.`,
    };
  }

  const { data: conn } = await admin
    .from("buffer_connection")
    .select("access_token,access_token_enc,channels")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const { readBufferToken } = await import("./crypto.server");
  const token = await readBufferToken(
    conn as { access_token?: string; access_token_enc?: string } | null,
  );
  if (!token) {
    // Nothing was sent, and the fix (connect Buffer) is immediate — do not
    // make the user wait out the claim window to retry.
    await releasePublishClaim(admin, post.id);
    return {
      ok: false,
      error:
        "Buffer is not connected for this workspace, so the post was not sent. Connect Buffer in Settings → Connections.",
    };
  }

  const channels = Array.isArray((conn as { channels?: unknown }).channels)
    ? (conn as { channels: BufferChannel[] }).channels
    : [];
  // Notes are caveats, not failures: the post still goes out and the caller
  // repeats them to the user. Collected here so a guessed channel and a
  // dropped image are both reported, not just whichever happened last.
  const notes: string[] = [];
  const choice = chooseChannel(channels, post.platform, post.channelId);
  if (!choice.ok) {
    // Same reasoning as the missing token: nothing left our process.
    await releasePublishClaim(admin, post.id);
    return { ok: false, error: choice.error };
  }
  const channel = choice.channel;
  if (choice.note) {
    console.warn("[buffer-publish:chooseChannel] ambiguous channel", {
      workspaceId,
      postId: post.id,
      platform: post.platform,
      used: channel.id,
    });
    notes.push(choice.note);
  }

  // Buffer downloads media from its own servers, so a locally-signed URL is
  // useless to it. Rewrite through the public media proxy; if the result is
  // still local-only, drop the image and say so instead of failing the post.
  let assets: Array<{ image: { url: string } }> = [];
  if (post.imageUrl) {
    const publicUrl = toPublicMediaUrl(post.imageUrl);
    try {
      assertPubliclyFetchable(publicUrl, "The image");
      assets = [{ image: { url: publicUrl } }];
    } catch (e) {
      notes.push(
        `image skipped, published text-only: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  const withNotes = (msg: string) => (notes.length ? `${msg} · ${notes.join(" · ")}` : msg);

  // customScheduled only accepts future due dates; anything else (past, or no
  // date at all) goes into the next queue slot rather than being rejected.
  const dueAtMs = post.scheduledAtISO ? Date.parse(post.scheduledAtISO) : NaN;
  const isFuture = Number.isFinite(dueAtMs) && dueAtMs > Date.now() + 60_000;
  const mode = isFuture ? "customScheduled" : "addToQueue";

  try {
    type Resp = { createPost: { post?: { id: string; dueAt?: string }; message?: string } };
    const out = await gql<Resp>(
      token,
      `mutation Create($input: CreatePostInput!) {
          createPost(input: $input) {
            ... on PostActionSuccess { post { id dueAt } }
            ... on MutationError { message }
          }
        }`,
      {
        input: {
          channelId: channel.id,
          text: post.caption,
          schedulingType: "automatic",
          mode,
          assets,
          ...(isFuture ? { dueAt: post.scheduledAtISO } : {}),
        },
      },
      "createPost",
    );
    if (!out.createPost.post) {
      // An explicit MutationError is Buffer telling us it created nothing, so
      // the claim can go back and the user can retry as soon as they have
      // fixed whatever it objected to.
      await releasePublishClaim(admin, post.id);
      return {
        ok: false,
        channelId: channel.id,
        channelName: channel.name,
        error: withNotes(out.createPost.message ?? "Buffer rejected the post."),
      };
    }
    await admin
      .from("scheduled_posts")
      .update({ buffer_id: out.createPost.post.id, buffer_channel_id: channel.id })
      .eq("id", post.id);
    return {
      ok: true,
      bufferId: out.createPost.post.id,
      channelId: channel.id,
      channelName: channel.name,
      ...(notes.length ? { error: notes.join(" · ") } : {}),
    };
  } catch (e) {
    const failure = classifyBufferFailure(e);
    if (failure.outcomeUnknown) {
      // The claim is deliberately NOT released. A request we cannot account for
      // — a timeout, a dropped socket, a 5xx, a reply we could not read — may
      // well have been accepted by Buffer. Holding the claim for the staleness
      // window is what stops a retry turning "we don't know" into two live
      // posts, and bufferPublishFailureMessage makes sure the user is told to
      // go and look rather than to try again.
      console.error("[buffer-publish:createPost] outcome unknown, claim held", {
        postId: post.id,
        kind: failure.kind,
        status: failure.status,
      });
    } else {
      // Buffer answered and refused before creating anything — a revoked token,
      // a malformed request, a caption it will not take. Nothing is live, so
      // the claim goes back and the user can retry the moment they have fixed
      // whatever it objected to, exactly as with an explicit MutationError.
      await releasePublishClaim(admin, post.id);
    }
    return {
      ok: false,
      channelId: channel.id,
      channelName: channel.name,
      // The same fact the claim decision above turned on, carried out to the
      // callers so the status they write can say "we do not know" too. Without
      // it they only see ok:false and have to guess, which is how a timeout
      // came to be recorded as a refusal.
      ...(failure.outcomeUnknown ? { outcomeUnknown: true } : {}),
      error: withNotes(bufferPublishFailureMessage(failure)),
    };
  }
}

/**
 * The status a publish attempt should be written to `scheduled_posts.status`,
 * or null when it must not be written down at all.
 *
 * There are three status writers — the cron autopost, `bufferPublishApprovedPost`
 * and the agent's approve tool — and before this existed each decided for
 * itself, which is how they came to disagree about a timeout. They now all ask
 * this function, so the vocabulary means one thing everywhere:
 *
 *   published        Buffer accepted the post. (Accepted, note — a post with a
 *                    future due time is queued at Buffer, not out yet. The
 *                    calendar derives that distinction from the due time;
 *                    finding 53.)
 *   publish_failed   We know nothing went out: Buffer was asked and refused, or
 *                    it could not be asked at all (no token, no channel). Safe
 *                    to fix and publish again.
 *   publish_unknown  The request went out and no usable answer came back. It
 *                    may be live and it may not. Never republish without
 *                    looking first. (finding 54.)
 *   null             Nothing was sent and nothing may be recorded — another
 *                    attempt holds the claim, or the row is gone. Overwriting
 *                    the status here would contradict the attempt that is
 *                    actually running. (finding 53's `notAttempted`, wave 3b.)
 *
 * `notAttempted` is checked first on purpose: it is the only case where the
 * right answer is to write nothing, and it can legitimately travel alongside
 * either of the other flags.
 */
export type PublishOutcomeStatus = "published" | "publish_failed" | "publish_unknown";

export function publishOutcomeStatus(result: {
  ok: boolean;
  notAttempted?: boolean;
  outcomeUnknown?: boolean;
}): PublishOutcomeStatus | null {
  if (result.notAttempted) return null;
  if (result.ok) return "published";
  return result.outcomeUnknown ? "publish_unknown" : "publish_failed";
}
