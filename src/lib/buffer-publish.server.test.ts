// Tests for chooseChannel — the decision that says where a post actually goes
// — and for the publish claim + ambiguous-response handling around it.
//
// chooseChannel used to be a single `channels.find(...)`, which meant a
// workspace with two LinkedIn pages always published to whichever sorted first
// and reported success.
//
// The publish path itself is exercised with an in-memory stand-in for the
// scheduled_posts row and a stubbed fetch: no database, no Buffer.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  chooseChannel,
  claimPostForPublish,
  publishScheduledPostToBuffer,
  publishOutcomeStatus,
  PUBLISH_CLAIM_STALE_MS,
  type BufferChannel,
} from "./buffer-publish.server";
import { FetchTimeoutError } from "./fetch-timeout";
import { BUFFER_TIMEOUT } from "./buffer-shared";

const linkedinA: BufferChannel = { id: "ch-a", name: "Acme Corp", service: "linkedin" };
const linkedinB: BufferChannel = { id: "ch-b", name: "Acme Careers", service: "linkedin" };
const instagram: BufferChannel = { id: "ch-i", name: "acme.co", service: "instagram" };

describe("chooseChannel — explicit channel id", () => {
  it("uses the pinned channel even when another channel matches the platform first", () => {
    const out = chooseChannel([linkedinA, linkedinB], "linkedin", "ch-b");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.channel.id).toBe("ch-b");
      // Not ambiguous: the post said where to go, so there is nothing to warn about.
      expect(out.note).toBeUndefined();
    }
  });

  it("fails instead of silently falling back when the pinned channel is gone", () => {
    const out = chooseChannel([linkedinA], "linkedin", "ch-deleted");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toContain("ch-deleted");
      expect(out.error).toContain("nothing was sent");
      // Actionable: says where to go, not just what broke.
      expect(out.error).toContain("Settings → Connections");
    }
  });

  it("honours a pinned channel whose service does not match the post platform", () => {
    // The explicit choice is the user's, and it is more specific than our
    // platform string — publishing somewhere else would be worse.
    const out = chooseChannel([linkedinA, instagram], "linkedin", "ch-i");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.channel.id).toBe("ch-i");
  });

  it("ignores an empty explicit id and falls back to matching", () => {
    const out = chooseChannel([linkedinA], "linkedin", "");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.channel.id).toBe("ch-a");
  });
});

describe("chooseChannel — falling back to platform matching", () => {
  it("picks the only matching channel with no note", () => {
    const out = chooseChannel([linkedinA, instagram], "linkedin");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.channel.id).toBe("ch-a");
      expect(out.note).toBeUndefined();
    }
  });

  it("still publishes when several channels match, but names the ambiguity", () => {
    const out = chooseChannel([linkedinA, linkedinB, instagram], "linkedin");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.channel.id).toBe("ch-a");
      expect(out.note).toBeDefined();
      // The note must say which channel was used AND which others matched,
      // otherwise the user cannot tell where the post went.
      expect(out.note).toContain("Acme Corp");
      expect(out.note).toContain("Acme Careers");
      expect(out.note).toContain("2 linkedin channels");
    }
  });

  it("matches x and twitter in both directions", () => {
    const twitter: BufferChannel = { id: "ch-t", name: "@acme", service: "twitter" };
    const x: BufferChannel = { id: "ch-x", name: "@acme", service: "x" };
    expect(chooseChannel([twitter], "x").ok).toBe(true);
    expect(chooseChannel([x], "twitter").ok).toBe(true);
  });

  it("reports an actionable error when nothing matches", () => {
    const out = chooseChannel([instagram], "linkedin");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toContain("linkedin");
      expect(out.error).toContain("not sent");
      expect(out.error).toContain("Refresh");
    }
  });

  it("reports an actionable error when no channels are connected at all", () => {
    const out = chooseChannel([], "linkedin");
    expect(out.ok).toBe(false);
  });

  it("skips channels with no id rather than picking one it cannot publish to", () => {
    const broken: BufferChannel = { name: "half-linked page", service: "linkedin" };
    const out = chooseChannel([broken, linkedinA], "linkedin");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.channel.id).toBe("ch-a");
      // One usable match, so this is not ambiguous either.
      expect(out.note).toBeUndefined();
    }
  });

  it("is case-insensitive about the service name", () => {
    const shouty: BufferChannel = { id: "ch-s", name: "Acme", service: "LinkedIn" };
    expect(chooseChannel([shouty], "linkedin").ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The publish claim and the ambiguous-response path.
//
// Both exist because "we do not know what happened" used to be indistinguishable
// from "it failed": an unreadable 200 threw a null-property TypeError, the caller
// reported it as a plain failure, and a retry put a second copy on a live
// channel. The stand-in below models just enough of PostgREST for the conditional
// claim — filters are applied, not ignored — so the claim can be tested for what
// it actually refuses.

type PostRow = { id: string; buffer_id: string | null; publish_claimed_at: string | null };
type Filter = { op: "eq" | "is" | "or"; col: string; val: unknown };
type Call = {
  table: string;
  kind: "update" | "select";
  patch?: Record<string, unknown>;
  filters: Filter[];
};

const CHANNELS = [{ id: "ch-a", name: "Acme Corp", service: "linkedin" }];

function makeAdmin(init: { post: PostRow | null; conn?: Record<string, unknown> | null }) {
  const db = {
    post: init.post ? { ...init.post } : null,
    conn: init.conn === undefined ? { access_token: "tok-123", channels: CHANNELS } : init.conn,
  };
  const calls: Call[] = [];

  function run(c: Call): { data: unknown; error: null } {
    if (c.table === "buffer_connection") return { data: db.conn, error: null };
    const row = db.post;
    if (c.kind === "select") return { data: row ? { ...row } : null, error: null };
    if (!row) return { data: [], error: null };

    const idFilter = c.filters.find((f) => f.op === "eq" && f.col === "id");
    if (idFilter && idFilter.val !== row.id) return { data: [], error: null };
    // `.is("buffer_id", null)` — only an unpublished post may be claimed.
    if (c.filters.some((f) => f.op === "is" && f.col === "buffer_id") && row.buffer_id !== null)
      return { data: [], error: null };
    // `.or("publish_claimed_at.is.null,publish_claimed_at.lt.<cutoff>")`
    const or = c.filters.find((f) => f.op === "or");
    if (or) {
      const cutoff = String(or.val).split("publish_claimed_at.lt.")[1] ?? "";
      const free = row.publish_claimed_at === null || row.publish_claimed_at < cutoff;
      if (!free) return { data: [], error: null };
    }
    Object.assign(row, c.patch ?? {});
    return { data: [{ id: row.id }], error: null };
  }

  function chain(c: Call) {
    calls.push(c);
    const self: Record<string, unknown> = {
      eq: (col: string, val: unknown) => (c.filters.push({ op: "eq", col, val }), self),
      is: (col: string, val: unknown) => (c.filters.push({ op: "is", col, val }), self),
      or: (expr: string) => (c.filters.push({ op: "or", col: "", val: expr }), self),
      select: () => self,
      maybeSingle: () => Promise.resolve(run({ ...c, kind: "select" })),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(run(c)).then(resolve, reject),
    };
    return self;
  }

  const admin = {
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) =>
        chain({ table, kind: "update", patch, filters: [] }),
      select: () => chain({ table, kind: "select", filters: [] }),
    }),
  };
  return { admin: admin as never, db, calls };
}

const POST = {
  id: "post-1",
  platform: "linkedin",
  caption: "hello world",
};

function stubFetch(impl: () => Response | Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** A body that is not JSON at all — the proxy interstitial of the finding. */
function unparseable(status = 200): Response {
  return new Response("<html>504 Gateway Time-out</html>", {
    status,
    headers: { "content-type": "text/html" },
  });
}

function created(id = "buf-9"): Response {
  return Response.json({ data: { createPost: { post: { id, dueAt: null } } } });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PUBLISH_CLAIM_STALE_MS", () => {
  it("sits above any single Buffer request that could still be alive", () => {
    // A publish now has a hard ceiling of BUFFER_TIMEOUT.publish, so a request
    // that is still running cannot outlive the window by definition. The old
    // floor — the ~300s the cron caller treats as the outbound limit — is kept
    // as well, because the window's second job is to hold a timed-out publish
    // shut long enough that nobody retries an outcome we do not know.
    expect(PUBLISH_CLAIM_STALE_MS).toBeGreaterThan(10 * BUFFER_TIMEOUT.publish);
    expect(PUBLISH_CLAIM_STALE_MS).toBeGreaterThanOrEqual(2 * 300_000);
  });

  it("is short enough that a crashed process does not wedge the post", () => {
    // A user who retries after a crash must not be told to wait out the
    // afternoon, and this covers one HTTP request, not a whole cron job — so
    // it stays well under the 30-minute stale-run threshold.
    expect(PUBLISH_CLAIM_STALE_MS).toBeLessThan(30 * 60 * 1000);
  });
});

describe("claimPostForPublish", () => {
  const NOW = new Date("2026-03-17T12:00:00.000Z");

  it("claims an untouched post and stamps the claim time", async () => {
    const { admin, db } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    expect(await claimPostForPublish(admin, "post-1", NOW)).toEqual({ claimed: true });
    expect(db.post?.publish_claimed_at).toBe(NOW.toISOString());
  });

  it("refuses a second concurrent claim and calls it in-flight", async () => {
    const { admin } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    await claimPostForPublish(admin, "post-1", NOW);
    const second = await claimPostForPublish(admin, "post-1", new Date(NOW.getTime() + 1000));
    expect(second).toMatchObject({ claimed: false, reason: "in_flight" });
  });

  it("takes over a claim left behind by a crashed process", async () => {
    const stale = new Date(NOW.getTime() - PUBLISH_CLAIM_STALE_MS - 1000).toISOString();
    const { admin, db } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: stale },
    });
    expect(await claimPostForPublish(admin, "post-1", NOW)).toEqual({ claimed: true });
    expect(db.post?.publish_claimed_at).toBe(NOW.toISOString());
  });

  it("reports an already-published post as published, with its Buffer id", async () => {
    const { admin } = makeAdmin({
      post: { id: "post-1", buffer_id: "buf-7", publish_claimed_at: null },
    });
    expect(await claimPostForPublish(admin, "post-1", NOW)).toEqual({
      claimed: false,
      reason: "published",
      bufferId: "buf-7",
    });
  });

  it("reports a post that is no longer on the calendar", async () => {
    const { admin } = makeAdmin({ post: null });
    expect(await claimPostForPublish(admin, "gone", NOW)).toEqual({
      claimed: false,
      reason: "missing",
    });
  });

  it("fails closed rather than throwing when the claim write blows up", async () => {
    const admin = {
      from: () => ({
        update: () => ({
          eq: () => ({
            is: () => ({
              or: () => ({
                select: () => Promise.reject(new Error("socket hang up")),
              }),
            }),
          }),
        }),
      }),
    } as never;
    expect(await claimPostForPublish(admin, "post-1", NOW)).toMatchObject({
      claimed: false,
      reason: "error",
    });
  });
});

describe("publishScheduledPostToBuffer — idempotency", () => {
  it("publishes once and records the Buffer id", async () => {
    const { admin, db } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    const fetchSpy = stubFetch(() => created("buf-9"));
    const out = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(out.ok).toBe(true);
    expect(out.bufferId).toBe("buf-9");
    expect(db.post?.buffer_id).toBe("buf-9");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("never calls Buffer a second time for a post that already published", async () => {
    const { admin } = makeAdmin({
      post: { id: "post-1", buffer_id: "buf-9", publish_claimed_at: null },
    });
    const fetchSpy = stubFetch(() => created());
    const out = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(fetchSpy).not.toHaveBeenCalled();
    // ok:true so the caller does not stamp a live post as 'publish_failed';
    // the caveat says why nothing new went out.
    expect(out.ok).toBe(true);
    expect(out.bufferId).toBe("buf-9");
    expect(out.error).toContain("already published");
  });

  it("refuses to publish while another attempt is in flight", async () => {
    const { admin } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: new Date().toISOString() },
    });
    const fetchSpy = stubFetch(() => created());
    const out = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.ok).toBe(false);
    expect(out.error).toContain("already running");
    // Actionable: says what to do and when it stops being true.
    expect(out.error).toContain("10 minutes");
  });

  it("says so plainly when the post is gone from the calendar", async () => {
    const { admin } = makeAdmin({ post: null });
    const fetchSpy = stubFetch(() => created());
    const out = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.ok).toBe(false);
    expect(out.error).toContain("no longer on the calendar");
  });

  it("hands the claim back when Buffer is not connected, so a fix can be retried at once", async () => {
    const { admin, db } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
      conn: null,
    });
    const out = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(out.ok).toBe(false);
    expect(out.error).toContain("Settings → Connections");
    expect(db.post?.publish_claimed_at).toBeNull();
  });

  it("hands the claim back when no channel matches", async () => {
    const { admin, db } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
      conn: { access_token: "tok-123", channels: [] },
    });
    const out = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(out.ok).toBe(false);
    expect(db.post?.publish_claimed_at).toBeNull();
  });

  it("hands the claim back when Buffer explicitly rejects the post", async () => {
    const { admin, db } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    stubFetch(() => Response.json({ data: { createPost: { message: "Text is too long." } } }));
    const out = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(out.ok).toBe(false);
    expect(out.error).toContain("Text is too long.");
    // Buffer created nothing, so retrying is safe the moment the text is fixed.
    expect(db.post?.publish_claimed_at).toBeNull();
  });
});

describe("publishScheduledPostToBuffer — a 200 we cannot read", () => {
  it("reports the outcome as unknown instead of a null-property TypeError", async () => {
    const { admin } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    stubFetch(() => unparseable());
    const out = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(out.ok).toBe(false);
    expect(out.error).not.toContain("Cannot read properties");
    expect(out.error).toContain("cannot tell whether it went through");
    // Tells the user where to look before they retry a possible live post.
    expect(out.error).toContain("publish.buffer.com");
  });

  it("treats a well-formed 200 with no data the same way", async () => {
    const { admin } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    stubFetch(() => Response.json({}));
    const out = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(out.ok).toBe(false);
    expect(out.error).toContain("cannot tell whether it went through");
  });

  it("keeps the claim, so an immediate retry cannot double-publish", async () => {
    const { admin, db } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    const fetchSpy = stubFetch(() => unparseable());
    await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(db.post?.publish_claimed_at).not.toBeNull();

    const retry = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(retry.ok).toBe(false);
    expect(retry.error).toContain("already running");
    // The whole point: Buffer was called once, not twice.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps the claim after a network error too — the request may still have landed", async () => {
    const { admin, db } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    stubFetch(() => Promise.reject(new Error("ECONNRESET")));
    const out = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(out.ok).toBe(false);
    expect(db.post?.publish_claimed_at).not.toBeNull();
  });

  it("still reports a real HTTP error as a real error", async () => {
    const { admin } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    stubFetch(() => Response.json({ errors: [{ message: "Unauthorized" }] }, { status: 401 }));
    const out = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(out.ok).toBe(false);
    expect(out.error).toContain("Unauthorized");
  });
});

// ---------------------------------------------------------------------------
// A publish that timed out.
//
// This is the one failure the timeout work had to get right: the deadline
// firing does not mean Buffer refused the post, it means we stopped listening.
// Buffer may have taken it. So the claim stays, and the wording has to send the
// user to look rather than to retry.

describe("publishScheduledPostToBuffer — the deadline fired", () => {
  const timesOut = () =>
    stubFetch(() => Promise.reject(new FetchTimeoutError("Buffer", BUFFER_TIMEOUT.publish)));

  it("keeps the claim, because Buffer may have accepted the post", async () => {
    const { admin, db } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    timesOut();
    const out = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(out.ok).toBe(false);
    expect(db.post?.publish_claimed_at).not.toBeNull();
  });

  it("says the outcome is unknown and where to check it", async () => {
    const { admin } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    timesOut();
    const out = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(out.error).toContain("may still have been received");
    expect(out.error).toContain("cannot tell whether this post went out");
    expect(out.error).toContain("publish.buffer.com");
  });

  it("never tells the user it failed and to try again", async () => {
    const { admin } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    timesOut();
    const out = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    // "try again" after an unknown outcome is how a post goes out twice.
    expect(out.error).not.toMatch(/try again/i);
    expect(out.error).not.toMatch(/\bfailed\b/i);
  });

  it("blocks an immediate second attempt, so 'we don't know' cannot become two posts", async () => {
    const { admin } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    const fetchSpy = timesOut();
    await publishScheduledPostToBuffer(admin, "ws-1", POST);
    const retry = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(retry.error).toContain("already running");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not retry the request itself", async () => {
    const { admin } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    const fetchSpy = timesOut();
    await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// A revoked token versus a blip. Both used to read as one anonymous failure
// string (finding 29), so a workspace could sit dead for weeks with nothing
// ever telling anyone to reconnect.

describe("publishScheduledPostToBuffer — a dead token versus a blip", () => {
  const rejectWith = (status: number, message: string) =>
    stubFetch(() => Response.json({ errors: [{ message }] }, { status }));

  it("names a 401 as a connection that must be reconnected", async () => {
    const { admin } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    rejectWith(401, "Invalid access token");
    const out = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(out.ok).toBe(false);
    expect(out.error).toContain("no longer valid");
    expect(out.error).toContain("Settings → Connections");
    // Buffer's own words survive: only it can say what it objected to.
    expect(out.error).toContain("Invalid access token");
    expect(out.error).toContain("401");
  });

  it("treats a 403 the same way", async () => {
    const { admin } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    rejectWith(403, "Forbidden");
    const out = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(out.error).toContain("no longer valid");
  });

  it("spots an auth failure Buffer chose to answer 200 with", async () => {
    const { admin } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    stubFetch(() => Response.json({ errors: [{ message: "Unauthenticated." }] }, { status: 200 }));
    const out = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(out.error).toContain("no longer valid");
  });

  it("hands the claim back on a 401 — nothing was created, so a fix can be retried at once", async () => {
    const { admin, db } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    rejectWith(401, "Invalid access token");
    await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(db.post?.publish_claimed_at).toBeNull();
  });

  it("does not tell the user to reconnect over a 503", async () => {
    const { admin, db } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    rejectWith(503, "Service Unavailable");
    const out = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(out.error).not.toContain("no longer valid");
    expect(out.error).toContain("not your connection");
    // A 5xx can come from a proxy after the origin already did the work, so
    // this one is ambiguous and the claim stays put.
    expect(db.post?.publish_claimed_at).not.toBeNull();
    expect(out.error).toContain("publish.buffer.com");
  });

  it("keeps a plain rejection plain — no reconnect advice, claim released", async () => {
    const { admin, db } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    rejectWith(400, "Text is too long.");
    const out = await publishScheduledPostToBuffer(admin, "ws-1", POST);
    expect(out.error).toContain("Text is too long.");
    expect(out.error).not.toContain("no longer valid");
    expect(db.post?.publish_claimed_at).toBeNull();
  });
});

describe("publishScheduledPostToBuffer — the request carries a deadline", () => {
  it("passes an abort signal to Buffer, so a hung socket cannot stall the tick", async () => {
    const { admin } = makeAdmin({
      post: { id: "post-1", buffer_id: null, publish_claimed_at: null },
    });
    const fetchSpy = stubFetch(() => created());
    await publishScheduledPostToBuffer(admin, "ws-1", POST);
    const calls = fetchSpy.mock.calls as unknown as unknown[][];
    const init = calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

// ---------------------------------------------------------------------------
// What status a publish attempt gets written down as.
//
// docs/bugs.md finding 54: a timeout used to be stamped `publish_failed`, which
// asserts Buffer was asked and refused — something we do not know. A user who
// read that and republished could end up with two live posts. There are three
// writers (the cron autopost, bufferPublishApprovedPost and the agent's approve
// tool) and they used to decide this for themselves, which is how they came to
// disagree; publishOutcomeStatus is now the only place it is decided, so these
// tests cover all three at once.

describe("publishOutcomeStatus — the decision table", () => {
  it("records a success as published", () => {
    expect(publishOutcomeStatus({ ok: true })).toBe("published");
  });

  it("records a definite refusal as publish_failed", () => {
    expect(publishOutcomeStatus({ ok: false })).toBe("publish_failed");
  });

  it("records an unaccounted-for request as publish_unknown, not as a failure", () => {
    expect(publishOutcomeStatus({ ok: false, outcomeUnknown: true })).toBe("publish_unknown");
  });

  it("writes nothing at all when nothing was sent", () => {
    // Another attempt holds the claim, or the row is gone. Overwriting the
    // status here would contradict the publish that is actually running.
    expect(publishOutcomeStatus({ ok: false, notAttempted: true })).toBeNull();
  });

  it("lets notAttempted win over an unknown outcome", () => {
    // Nothing left our process, so there is no outcome to be unsure about.
    expect(
      publishOutcomeStatus({ ok: false, notAttempted: true, outcomeUnknown: true }),
    ).toBeNull();
  });
});

describe("publishScheduledPostToBuffer — which status each failure earns", () => {
  const freshPost = { id: "post-1", buffer_id: null, publish_claimed_at: null };
  const statusFor = async (setUp: () => { admin: never }) => {
    const { admin } = setUp();
    return publishOutcomeStatus(await publishScheduledPostToBuffer(admin, "ws-1", POST));
  };

  it("calls a timed-out publish unknown — the request went out, the answer did not come back", async () => {
    const status = await statusFor(() => {
      const made = makeAdmin({ post: { ...freshPost } });
      stubFetch(() => Promise.reject(new FetchTimeoutError("Buffer", BUFFER_TIMEOUT.publish)));
      return made;
    });
    expect(status).toBe("publish_unknown");
  });

  it("calls a dropped socket unknown too — it may still have landed", async () => {
    const status = await statusFor(() => {
      const made = makeAdmin({ post: { ...freshPost } });
      stubFetch(() => Promise.reject(new Error("ECONNRESET")));
      return made;
    });
    expect(status).toBe("publish_unknown");
  });

  it("calls a 503 unknown — an edge proxy can answer after the origin did the work", async () => {
    const status = await statusFor(() => {
      const made = makeAdmin({ post: { ...freshPost } });
      stubFetch(() =>
        Response.json({ errors: [{ message: "Service Unavailable" }] }, { status: 503 }),
      );
      return made;
    });
    expect(status).toBe("publish_unknown");
  });

  it("calls a reply we could not read unknown", async () => {
    const status = await statusFor(() => {
      const made = makeAdmin({ post: { ...freshPost } });
      stubFetch(() => unparseable());
      return made;
    });
    expect(status).toBe("publish_unknown");
  });

  it("keeps a revoked token a plain failure — a 401 is refused before Buffer does anything", async () => {
    const status = await statusFor(() => {
      const made = makeAdmin({ post: { ...freshPost } });
      stubFetch(() =>
        Response.json({ errors: [{ message: "Invalid access token" }] }, { status: 401 }),
      );
      return made;
    });
    expect(status).toBe("publish_failed");
  });

  it("keeps a rate limit a plain failure — refused at the door, nothing created", async () => {
    const status = await statusFor(() => {
      const made = makeAdmin({ post: { ...freshPost } });
      stubFetch(() =>
        Response.json({ errors: [{ message: "Too many requests" }] }, { status: 429 }),
      );
      return made;
    });
    expect(status).toBe("publish_failed");
  });

  it("keeps an outright rejection a plain failure", async () => {
    const status = await statusFor(() => {
      const made = makeAdmin({ post: { ...freshPost } });
      stubFetch(() =>
        Response.json({ errors: [{ message: "Text is too long." }] }, { status: 400 }),
      );
      return made;
    });
    expect(status).toBe("publish_failed");
  });

  it("keeps an explicit MutationError a plain failure", async () => {
    const status = await statusFor(() => {
      const made = makeAdmin({ post: { ...freshPost } });
      stubFetch(() => Response.json({ data: { createPost: { message: "Text is too long." } } }));
      return made;
    });
    expect(status).toBe("publish_failed");
  });

  it("keeps a missing Buffer connection a plain failure — we know nothing went out", async () => {
    const status = await statusFor(() => makeAdmin({ post: { ...freshPost }, conn: null }));
    expect(status).toBe("publish_failed");
  });

  it("keeps a missing channel a plain failure", async () => {
    const status = await statusFor(() =>
      makeAdmin({ post: { ...freshPost }, conn: { access_token: "tok-123", channels: [] } }),
    );
    expect(status).toBe("publish_failed");
  });

  it("writes nothing while another attempt holds the claim", async () => {
    const status = await statusFor(() =>
      makeAdmin({
        post: { id: "post-1", buffer_id: null, publish_claimed_at: new Date().toISOString() },
      }),
    );
    expect(status).toBeNull();
  });

  it("writes nothing for a post that is no longer on the calendar", async () => {
    const status = await statusFor(() => makeAdmin({ post: null }));
    expect(status).toBeNull();
  });

  it("records a success as published", async () => {
    const status = await statusFor(() => {
      const made = makeAdmin({ post: { ...freshPost } });
      stubFetch(() => created());
      return made;
    });
    expect(status).toBe("published");
  });

  it("records an already-published post as published rather than as a failure", async () => {
    const status = await statusFor(() =>
      makeAdmin({ post: { id: "post-1", buffer_id: "buf-7", publish_claimed_at: null } }),
    );
    expect(status).toBe("published");
  });
});
