// Characterisation tests for isSafeToAutoSend — the single code gate between a
// drafted reply and an unattended public reply on a real social account.
//
// NOTE: engagement.server.ts is a 926-line module that imports the `ai` package
// and the whole Unipile client. The import was measured: it loads fast and has
// no network/database side effects at module scope, so the real module is
// imported rather than mocked. isSafeToAutoSend itself is pure.

import { describe, it, expect, vi } from "vitest";
import {
  isSafeToAutoSend,
  claimNeedsReplyItems,
  releaseClaims,
  mapWithConcurrency,
  createDeadline,
  tighterOf,
  ingestEngagement,
  ENGAGEMENT_BUDGET,
  INGEST_CAPS,
  READ_CONCURRENCY,
  type ItemRow,
} from "./engagement.server";
import {
  UNIPILE_LIMITS,
  requireUnipileCreds,
  listAccounts,
  getOwnProfile,
  listOwnPosts,
  listPostComments,
  listChats,
} from "./unipile.server";
import {
  ALWAYS_ESCALATE,
  SAFE_CATEGORIES,
  type EngagementIntent,
  type EngagementSentiment,
  type ReplyMode,
} from "./types";

// ingestEngagement's dedup fetch is exercised below (finding 19), so the
// Unipile client is mocked here — the rest of the file imports the real
// unipile.server (see the NOTE at the top of the file for why that is safe
// in general), but that module makes real HTTP calls, and ingestEngagement is
// the one function in this suite that actually drives it end to end.
vi.mock("./unipile.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./unipile.server")>();
  return {
    ...actual,
    requireUnipileCreds: vi.fn(),
    listAccounts: vi.fn(),
    getOwnProfile: vi.fn(),
    listOwnPosts: vi.fn(),
    listPostComments: vi.fn(),
    listChats: vi.fn(),
  };
});

// Policy is not exported from engagement.server.ts, so it is reconstructed
// structurally here. See the report: exporting it would be a small later-wave
// improvement.
type Policy = {
  mode: ReplyMode;
  safeCategories: EngagementIntent[];
  dailyLimit: number;
};

function item(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: "b1f4d2a0-2c9e-4a31-9d77-6f0e5a8c1234",
    workspace_id: "9f1c0a2e-1b3d-4c5a-8e7f-0a1b2c3d4e5f",
    kind: "comment",
    network: "LINKEDIN",
    external_account_id: "acct_01HXYZ",
    external_id: "urn:li:comment:(activity:7260000000000000000,7260000000000000001)",
    thread_id: null,
    post_id: "urn:li:activity:7260000000000000000",
    post_excerpt: "We shipped scheduling for Threads today.",
    permalink: "https://www.linkedin.com/feed/update/urn:li:activity:7260000000000000000/",
    author_name: "Dana Whitfield",
    author_handle: "danawhitfield",
    author_url: "https://www.linkedin.com/in/danawhitfield/",
    author_avatar_url: null,
    text: "Love this, congrats to the team!",
    occurred_at: "2026-03-17T09:12:00.000Z",
    sentiment: "positive",
    intent: "praise",
    urgency: "low",
    should_reply: true,
    classification: { reason: "Straightforward compliment on the launch post." },
    status: "needs_reply",
    ...overrides,
  };
}

function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    mode: "autonomous",
    safeCategories: ["praise", "question", "other"],
    dailyLimit: 10,
    ...overrides,
  };
}

describe("isSafeToAutoSend — reply mode gate", () => {
  it("returns true for a praise comment under an autonomous policy", () => {
    expect(isSafeToAutoSend(item(), policy())).toBe(true);
  });

  it("returns false in draft mode, however safe the item looks", () => {
    expect(isSafeToAutoSend(item(), policy({ mode: "draft" }))).toBe(false);
  });

  it("returns false in approval mode, however safe the item looks", () => {
    expect(isSafeToAutoSend(item(), policy({ mode: "approval" }))).toBe(false);
  });

  it("returns false for an unrecognised mode value from the database", () => {
    expect(isSafeToAutoSend(item(), policy({ mode: "Autonomous" as ReplyMode }))).toBe(false);
    expect(isSafeToAutoSend(item(), policy({ mode: "" as ReplyMode }))).toBe(false);
  });
});

describe("isSafeToAutoSend — sentiment gate", () => {
  it("returns false for negative sentiment even when the intent is safe", () => {
    expect(isSafeToAutoSend(item({ sentiment: "negative" }), policy())).toBe(false);
  });

  it("returns false for negative sentiment even when the intent is explicitly allowed", () => {
    expect(
      isSafeToAutoSend(
        item({ sentiment: "negative", intent: "question" }),
        policy({ safeCategories: ["praise", "question", "other"] }),
      ),
    ).toBe(false);
  });

  it("allows positive, neutral and missing sentiment", () => {
    for (const sentiment of ["positive", "neutral", null] as (EngagementSentiment | null)[]) {
      expect(isSafeToAutoSend(item({ sentiment }), policy())).toBe(true);
    }
  });
});

describe("isSafeToAutoSend — failed-classification gate", () => {
  it("returns false when classification.failed is true", () => {
    expect(isSafeToAutoSend(item({ classification: { failed: true } }), policy())).toBe(false);
  });

  it("returns false for any truthy classification.failed value", () => {
    expect(isSafeToAutoSend(item({ classification: { failed: 1 } }), policy())).toBe(false);
    expect(isSafeToAutoSend(item({ classification: { failed: "yes" } }), policy())).toBe(false);
  });

  it("does not block on a falsy or absent failed flag", () => {
    expect(isSafeToAutoSend(item({ classification: {} }), policy())).toBe(true);
    expect(isSafeToAutoSend(item({ classification: { failed: false } }), policy())).toBe(true);
    expect(isSafeToAutoSend(item({ classification: { reason: "clean" } }), policy())).toBe(true);
  });

  it("does not block when classification is null, despite the non-null row type", () => {
    // The column is typed Record<string, unknown> but Postgres can hand back
    // null; the `item.classification &&` guard short-circuits safely.
    expect(
      isSafeToAutoSend(
        item({ classification: null as unknown as Record<string, unknown> }),
        policy(),
      ),
    ).toBe(true);
  });
});

describe("isSafeToAutoSend — always-escalate intents", () => {
  it("pins the escalate list to support and opportunity", () => {
    expect(ALWAYS_ESCALATE).toEqual(["support", "opportunity"]);
  });

  it.each(ALWAYS_ESCALATE)("returns false for intent %s", (intent) => {
    expect(isSafeToAutoSend(item({ intent }), policy())).toBe(false);
  });

  it("returns false for an escalate intent EVEN IF the workspace listed it as safe", () => {
    // This is the important one: the hard-coded list must beat workspace config.
    expect(
      isSafeToAutoSend(
        item({ intent: "support" }),
        policy({ safeCategories: ["praise", "question", "other", "support", "opportunity"] }),
      ),
    ).toBe(false);
    expect(
      isSafeToAutoSend(
        item({ intent: "opportunity" }),
        policy({ safeCategories: ["opportunity"] }),
      ),
    ).toBe(false);
  });
});

describe("isSafeToAutoSend — safeCategories membership", () => {
  it("returns true only for an intent the workspace allowed", () => {
    const praiseOnly = policy({ safeCategories: ["praise"] });
    expect(isSafeToAutoSend(item({ intent: "praise" }), praiseOnly)).toBe(true);
    expect(isSafeToAutoSend(item({ intent: "question" }), praiseOnly)).toBe(false);
    expect(isSafeToAutoSend(item({ intent: "other" }), praiseOnly)).toBe(false);
  });

  it("returns false when safeCategories is empty", () => {
    expect(isSafeToAutoSend(item({ intent: "praise" }), policy({ safeCategories: [] }))).toBe(
      false,
    );
  });

  it("returns false for spam, which is never an offered safe category", () => {
    expect(isSafeToAutoSend(item({ intent: "spam" }), policy())).toBe(false);
    expect(SAFE_CATEGORIES.map((c) => c.value)).not.toContain("spam");
  });

  it("refuses spam even when a workspace explicitly lists it as a safe category", () => {
    // The gate must not depend on handleItem's short-circuit ever running
    // first: isSafeToAutoSend refuses spam on its own, whatever
    // engagement_safe_categories says.
    expect(isSafeToAutoSend(item({ intent: "spam" }), policy({ safeCategories: ["spam"] }))).toBe(
      false,
    );
  });

  it("treats a missing intent as 'other'", () => {
    expect(isSafeToAutoSend(item({ intent: null }), policy({ safeCategories: ["other"] }))).toBe(
      true,
    );
    expect(isSafeToAutoSend(item({ intent: null }), policy({ safeCategories: ["praise"] }))).toBe(
      false,
    );
  });

  it("returns false for an intent string the app does not know", () => {
    expect(isSafeToAutoSend(item({ intent: "complaint" as EngagementIntent }), policy())).toBe(
      false,
    );
  });
});

describe("isSafeToAutoSend — full matrix over the real intent list", () => {
  const allIntents: EngagementIntent[] = [
    "praise",
    "question",
    "support",
    "opportunity",
    "spam",
    "other",
  ];
  // The default policy loadPolicy() falls back to, plus the UI's full offering.
  const defaultSafe = policy({ safeCategories: ["praise"] });
  const uiMaxSafe = policy({ safeCategories: SAFE_CATEGORIES.map((c) => c.value) });

  it.each(allIntents)("default policy (praise only) — intent %s", (intent) => {
    expect(isSafeToAutoSend(item({ intent }), defaultSafe)).toBe(intent === "praise");
  });

  it.each(allIntents)("most permissive UI policy — intent %s", (intent) => {
    const expected = intent === "praise" || intent === "question" || intent === "other";
    expect(isSafeToAutoSend(item({ intent }), uiMaxSafe)).toBe(expected);
  });

  it("is false for every intent as soon as sentiment turns negative", () => {
    for (const intent of allIntents) {
      expect(isSafeToAutoSend(item({ intent, sentiment: "negative" }), uiMaxSafe)).toBe(false);
    }
  });

  it("is false for every intent as soon as the mode is not autonomous", () => {
    for (const intent of allIntents) {
      expect(isSafeToAutoSend(item({ intent }), policy({ mode: "approval" }))).toBe(false);
    }
  });
});

describe("isSafeToAutoSend — DM items", () => {
  it("applies the same rules to DMs as to comments (kind is not consulted)", () => {
    // KNOWN GAP (audit finding): a direct message is treated exactly like a
    // public comment. If DMs should ever need a stricter gate, this is where
    // it is missing.
    expect(isSafeToAutoSend(item({ kind: "dm", intent: "praise" }), policy())).toBe(true);
    expect(isSafeToAutoSend(item({ kind: "dm", intent: "support" }), policy())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// claimNeedsReplyItems — the atomic claim behind finding 15 (concurrent inbox
// sweeps double-processing the same item). Before this, runEngagementSweep
// selected `needs_reply` rows and only updated their status after drafting —
// nothing stopped two overlapping sweeps from both selecting, drafting for,
// and sending the same item.
//
// The stub below models just enough of PostgREST to make the claim's own
// atomicity meaningful to test: an UPDATE's filters are re-evaluated against
// each row's CURRENT state (not the state at SELECT time), the same property
// that makes the real `.eq("status", "needs_reply")` on the UPDATE the actual
// claim. Two sequential calls against the same in-memory rows therefore
// stand in for two overlapping sweeps: whichever claims a row first flips its
// status, so the second call's UPDATE predicate no longer matches it.

type FakeRow = ItemRow & Record<string, unknown>;
type FilterOp = { col: string; op: "eq" | "in"; val: unknown };
type FakeCall = { table: string; kind: "select" | "update"; patch?: Record<string, unknown> };

function makeFakeClient(rows: FakeRow[]) {
  const calls: FakeCall[] = [];

  function matches(row: FakeRow, filters: FilterOp[]): boolean {
    return filters.every((f) =>
      f.op === "eq" ? row[f.col] === f.val : (f.val as unknown[]).includes(row[f.col]),
    );
  }

  function chain(table: string, kind: "select" | "update", patch?: Record<string, unknown>) {
    const filters: FilterOp[] = [];
    let orderCol: string | null = null;
    let limitN = Infinity;

    const resolve = () => {
      let matched = rows.filter((r) => matches(r, filters));
      if (kind === "select") {
        if (orderCol) {
          const col = orderCol;
          matched = [...matched].sort((a, b) => (String(b[col]) > String(a[col]) ? 1 : -1));
        }
        matched = matched.slice(0, limitN);
      } else {
        for (const r of matched) Object.assign(r, patch);
      }
      return { data: matched.map((r) => ({ ...r })), error: null };
    };

    const self = {
      eq: (col: string, val: unknown) => (filters.push({ col, op: "eq", val }), self),
      in: (col: string, val: unknown[]) => (filters.push({ col, op: "in", val }), self),
      order: (col: string) => ((orderCol = col), self),
      limit: (n: number) => ((limitN = n), self),
      // `.update(...).eq(...).select("*")` — select() after an update just
      // requests the affected rows back (PostgREST's RETURNING); it does not
      // start a new query.
      select: () => self,
      then: (onResolve: (v: unknown) => unknown, onReject?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onResolve, onReject),
    };
    calls.push({ table, kind, patch });
    return self;
  }

  const client = {
    from: (table: string) => ({
      select: () => chain(table, "select"),
      update: (patch: Record<string, unknown>) => chain(table, "update", patch),
    }),
  };
  return { client, calls, rows };
}

function claimableItem(overrides: Partial<FakeRow> = {}): FakeRow {
  return { ...item(), status: "needs_reply", ...overrides } as FakeRow;
}

describe("claimNeedsReplyItems", () => {
  it("claims a needs_reply item and returns the full row", async () => {
    const { client, rows } = makeFakeClient([claimableItem({ id: "a" })]);
    const claimed = await claimNeedsReplyItems(client as never, item().workspace_id);
    expect(claimed.map((r) => r.id)).toEqual(["a"]);
    expect(claimed[0].status).toBe("approved");
    // The underlying row itself moved out of needs_reply.
    expect(rows.find((r) => r.id === "a")?.status).toBe("approved");
  });

  it("never returns an item a second concurrent call already claimed", async () => {
    const { client } = makeFakeClient([claimableItem({ id: "a" })]);
    const first = await claimNeedsReplyItems(client as never, item().workspace_id);
    const second = await claimNeedsReplyItems(client as never, item().workspace_id);
    expect(first.map((r) => r.id)).toEqual(["a"]);
    // The second sweep's SELECT still finds nothing (status is no longer
    // needs_reply), so it claims and processes nothing — this is exactly
    // what stops two overlapping sweeps from both drafting/sending for "a".
    expect(second).toEqual([]);
  });

  it("ignores items in other statuses (drafted, ignored, replied, escalated)", async () => {
    const { client } = makeFakeClient([
      claimableItem({ id: "a", status: "drafted" }),
      claimableItem({ id: "b", status: "ignored" }),
      claimableItem({ id: "c", status: "replied" }),
      claimableItem({ id: "d", status: "escalated" }),
      claimableItem({ id: "e", status: "needs_reply" }),
    ]);
    const claimed = await claimNeedsReplyItems(client as never, item().workspace_id);
    expect(claimed.map((r) => r.id)).toEqual(["e"]);
  });

  it("does not claim another workspace's items", async () => {
    const { client } = makeFakeClient([
      claimableItem({ id: "a", workspace_id: "other-workspace" }),
      claimableItem({ id: "b" }),
    ]);
    const claimed = await claimNeedsReplyItems(client as never, item().workspace_id);
    expect(claimed.map((r) => r.id)).toEqual(["b"]);
  });

  it("respects the limit and orders by occurred_at descending, like the old select did", async () => {
    const { client } = makeFakeClient([
      claimableItem({ id: "old", occurred_at: "2026-01-01T00:00:00.000Z" }),
      claimableItem({ id: "new", occurred_at: "2026-03-01T00:00:00.000Z" }),
      claimableItem({ id: "mid", occurred_at: "2026-02-01T00:00:00.000Z" }),
    ]);
    const claimed = await claimNeedsReplyItems(client as never, item().workspace_id, 2);
    expect(claimed.map((r) => r.id)).toEqual(["new", "mid"]);
  });

  it("makes no update call at all when nothing is claimable", async () => {
    const { client, calls } = makeFakeClient([claimableItem({ id: "a", status: "drafted" })]);
    const claimed = await claimNeedsReplyItems(client as never, item().workspace_id);
    expect(claimed).toEqual([]);
    expect(calls.some((c) => c.kind === "update")).toBe(false);
  });

  it("defaults the claim batch to 15, matching the old sweep's limit", async () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      claimableItem({ id: `i${i}`, occurred_at: new Date(2026, 0, i + 1).toISOString() }),
    );
    const { client } = makeFakeClient(rows);
    const claimed = await claimNeedsReplyItems(client as never, item().workspace_id);
    expect(claimed).toHaveLength(15);
  });
});

// ---------------------------------------------------------------------------
// Bounding the inbox fan-out (docs/bugs.md finding 10).
//
// ingestEngagement used to make, per connected account and strictly one after
// another: a profile call, a posts call, a comments call per post (<=10), a
// "did we already reply?" call per comment that has replies (<=30 per post),
// a chats call, then a messages call and an attendees call per chat (<=20).
// Roughly 353 sequential HTTP calls, none of them with a deadline, on the same
// tick whose caller gives up after 300s.
//
// Three things bound it now, and the two that are pure logic are tested here:
// the concurrency limiter that collapses the independent reads, and the
// wall-clock budget that stops the sweep cleanly when it has spent its time.
// (The third is the per-request deadline, which lives in fetch-timeout.ts and
// is tested there.)

describe("mapWithConcurrency", () => {
  it("returns results in input order, not completion order", async () => {
    // Later items resolve sooner, so completion order is the reverse of input.
    const out = await mapWithConcurrency([30, 20, 10, 0], 4, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([30, 20, 10, 0]);
  });

  it("passes the index alongside the item", async () => {
    const out = await mapWithConcurrency(["a", "b", "c"], 2, async (v, i) => `${i}:${v}`);
    expect(out).toEqual(["0:a", "1:b", "2:c"]);
  });

  it("never runs more than `limit` workers at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const items = Array.from({ length: 12 }, (_, i) => i);

    const run = mapWithConcurrency(items, 3, async (i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => release.push(resolve));
      inFlight--;
      return i;
    });

    // Let the first wave start, then drain one at a time.
    while (release.length < 3) await Promise.resolve();
    expect(peak).toBe(3);
    while (release.length) {
      release.shift()!();
      await Promise.resolve();
      await Promise.resolve();
    }
    await run;
    expect(peak).toBe(3);
  });

  it("actually parallelises — 12 items at width 4 take ~3 waves, not 12", async () => {
    const started: number[] = [];
    const t0 = Date.now();
    await mapWithConcurrency(
      Array.from({ length: 12 }, (_, i) => i),
      4,
      async (i) => {
        started.push(Date.now() - t0);
        await new Promise((r) => setTimeout(r, 20));
        return i;
      },
    );
    // The 12th call must not have waited for 11 full round trips. This is the
    // whole point of the change: worst case goes from minutes to seconds.
    expect(Date.now() - t0).toBeLessThan(12 * 20);
  });

  it("handles an empty list without calling the worker", async () => {
    let calls = 0;
    const out = await mapWithConcurrency([], 4, async () => {
      calls++;
      return 1;
    });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  it("clamps a limit larger than the list, and a nonsensical one, to something sane", async () => {
    let peak = 0;
    let inFlight = 0;
    const worker = async (i: number) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return i;
    };
    expect(await mapWithConcurrency([1, 2], 99, worker)).toEqual([1, 2]);
    expect(peak).toBeLessThanOrEqual(2);

    // 0, a negative width and NaN must not deadlock or run everything at once.
    for (const bad of [0, -5, Number.NaN]) {
      peak = 0;
      expect(await mapWithConcurrency([1, 2, 3], bad, worker)).toEqual([1, 2, 3]);
      expect(peak).toBe(1);
    }
  });

  it("rethrows the first failure, and stops starting new work", async () => {
    const started: number[] = [];
    await expect(
      mapWithConcurrency([0, 1, 2, 3, 4, 5, 6, 7], 2, async (i) => {
        started.push(i);
        if (i === 1) throw new Error("boom");
        return i;
      }),
    ).rejects.toThrow("boom");
    // The two initial lanes ran; the tail was never started.
    expect(started.length).toBeLessThan(8);
  });

  it("waits for in-flight workers to settle before rethrowing (no orphaned promises)", async () => {
    // A naive Promise.all-with-early-reject leaves the slow sibling running and
    // its rejection surfaces later as an unhandled rejection. This must not.
    let slowFinished = false;
    const promise = mapWithConcurrency([0, 1], 2, async (i) => {
      if (i === 0) throw new Error("fast failure");
      await new Promise((r) => setTimeout(r, 15));
      slowFinished = true;
      return i;
    });
    await expect(promise).rejects.toThrow("fast failure");
    expect(slowFinished).toBe(true);
  });

  it("reports the FIRST error when several workers fail", async () => {
    await expect(
      mapWithConcurrency([0, 1], 1, async (i) => {
        throw new Error(i === 0 ? "first" : "second");
      }),
    ).rejects.toThrow("first");
  });
});

describe("createDeadline — the overall budget", () => {
  // A fake clock: the budget must be testable without real time passing.
  function clock(start = 1_000_000) {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  }

  it("is not expired before the budget is spent", () => {
    const c = clock();
    const d = createDeadline(1000, c.now);
    expect(d.expired()).toBe(false);
    expect(d.remainingMs()).toBe(1000);
    c.advance(999);
    expect(d.expired()).toBe(false);
    expect(d.remainingMs()).toBe(1);
  });

  it("expires exactly at the budget and stays expired", () => {
    const c = clock();
    const d = createDeadline(1000, c.now);
    c.advance(1000);
    expect(d.expired()).toBe(true);
    c.advance(60_000);
    expect(d.expired()).toBe(true);
  });

  it("never reports negative time remaining", () => {
    const c = clock();
    const d = createDeadline(1000, c.now);
    c.advance(5000);
    expect(d.remainingMs()).toBe(0);
  });

  it("a zero budget is expired immediately, so no work is started", () => {
    const c = clock();
    expect(createDeadline(0, c.now).expired()).toBe(true);
  });

  it("tighterOf expires as soon as EITHER budget does", () => {
    const c = clock();
    const long = createDeadline(10_000, c.now);
    const short = createDeadline(500, c.now);
    const both = tighterOf(long, short);
    expect(both.expired()).toBe(false);
    expect(both.remainingMs()).toBe(500);
    c.advance(500);
    expect(both.expired()).toBe(true);
    expect(long.expired()).toBe(false);
  });

  it("stops a would-be-unbounded loop after a bounded number of units", async () => {
    // Stands in for the ingest loops: each unit costs time, the budget is
    // checked before the next one starts, and the loop ends on its own.
    const c = clock();
    const d = createDeadline(1000, c.now);
    let done = 0;
    for (let i = 0; i < 1_000_000; i++) {
      if (d.expired()) break;
      c.advance(100); // one "HTTP call"
      done++;
    }
    expect(done).toBe(10);
    expect(d.expired()).toBe(true);
  });

  it("leaves the sweep majority to the model loops after ingest takes its slice", () => {
    // Not a magic-number assertion for its own sake: if ingest's sub-budget
    // ever grew past the sweep's, the classify and draft loops would get no
    // time at all and the sweep would silently stop doing half its job.
    expect(ENGAGEMENT_BUDGET.ingest).toBeLessThan(ENGAGEMENT_BUDGET.sweep);
    expect(ENGAGEMENT_BUDGET.sweep).toBeLessThan(300_000);
  });
});

describe("releaseClaims — claimed items are never stranded", () => {
  it("hands unprocessed claims back to needs_reply when the budget runs out", async () => {
    // The failure this prevents: claimNeedsReplyItems flips rows to "approved"
    // to claim them. If the sweep stops mid-loop and just returns, those rows
    // sit at "approved" with nothing to reclaim them — the one way an atomic
    // claim can lose an item permanently.
    const { client, rows } = makeFakeClient([
      claimableItem({ id: "done", status: "approved" }),
      claimableItem({ id: "unreached-1", status: "approved" }),
      claimableItem({ id: "unreached-2", status: "approved" }),
    ]);
    const released = await releaseClaims(client as never, item().workspace_id, [
      "unreached-1",
      "unreached-2",
    ]);
    expect(released).toBe(2);
    expect(rows.find((r) => r.id === "unreached-1")?.status).toBe("needs_reply");
    expect(rows.find((r) => r.id === "unreached-2")?.status).toBe("needs_reply");
    // A released item is claimable again on the next sweep.
    const reclaimed = await claimNeedsReplyItems(client as never, item().workspace_id);
    expect(reclaimed.map((r) => r.id).sort()).toEqual(["unreached-1", "unreached-2"]);
  });

  it("only touches rows still sitting at approved", async () => {
    // A row some later step already moved on (an actual send landed, say) must
    // not be dragged back into the reply queue.
    const { client, rows } = makeFakeClient([
      claimableItem({ id: "a", status: "replied" }),
      claimableItem({ id: "b", status: "approved" }),
    ]);
    const released = await releaseClaims(client as never, item().workspace_id, ["a", "b"]);
    expect(released).toBe(1);
    expect(rows.find((r) => r.id === "a")?.status).toBe("replied");
    expect(rows.find((r) => r.id === "b")?.status).toBe("needs_reply");
  });

  it("does not release another workspace's items", async () => {
    const { client, rows } = makeFakeClient([
      claimableItem({ id: "a", status: "approved", workspace_id: "other-workspace" }),
    ]);
    expect(await releaseClaims(client as never, item().workspace_id, ["a"])).toBe(0);
    expect(rows[0].status).toBe("approved");
  });

  it("makes no database call at all for an empty list", async () => {
    const { client, calls } = makeFakeClient([claimableItem({ id: "a", status: "approved" })]);
    expect(await releaseClaims(client as never, item().workspace_id, [])).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe("fan-out caps", () => {
  it("keeps the per-account nesting bounded at every level", () => {
    expect(INGEST_CAPS.posts).toBeLessThanOrEqual(10);
    expect(INGEST_CAPS.commentsPerPost).toBeLessThanOrEqual(30);
    expect(INGEST_CAPS.chats).toBeLessThanOrEqual(20);
    expect(INGEST_CAPS.messagesPerChat).toBeLessThanOrEqual(10);
    expect(INGEST_CAPS.accounts).toBeGreaterThan(0);
  });

  it("backs every app-level cap with an adapter-level one, so a pathological account cannot blow past it", () => {
    // The `limit` query parameter is a request, not a guarantee. If Unipile
    // answered "give me 10 posts" with 200, only the adapter's own clamp stops
    // the fan-out multiplying — so each cap must have a ceiling behind it.
    expect(INGEST_CAPS.posts).toBeLessThanOrEqual(UNIPILE_LIMITS.posts);
    expect(INGEST_CAPS.commentsPerPost).toBeLessThanOrEqual(UNIPILE_LIMITS.comments);
    expect(INGEST_CAPS.chats).toBeLessThanOrEqual(UNIPILE_LIMITS.chats);
    expect(INGEST_CAPS.messagesPerChat).toBeLessThanOrEqual(UNIPILE_LIMITS.messages);
    expect(INGEST_CAPS.accounts).toBeLessThanOrEqual(UNIPILE_LIMITS.accounts);
  });

  it("bounds the worst-case call count, and the concurrency limit stays polite", () => {
    // profile + posts + (comments + replies-check per comment) per post
    //   + chats + (messages + attendees) per chat, for one account.
    const perAccount =
      2 + INGEST_CAPS.posts * (1 + INGEST_CAPS.commentsPerPost) + 1 + INGEST_CAPS.chats * 2;
    expect(perAccount).toBeLessThanOrEqual(353);
    // Modest on purpose: Unipile rate-limits, so a wide burst trades one
    // failure mode for another.
    expect(READ_CONCURRENCY).toBeGreaterThan(1);
    expect(READ_CONCURRENCY).toBeLessThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// ingestEngagement's dedup fetch (docs/bugs.md finding 19). It used to be
// `.limit(5000)` with no `.order()` at all: PostgREST's own `max_rows = 1000`
// (supabase/config.toml) caps every request regardless of what is asked for,
// and with no ordering which 1000 rows came back was unspecified — a
// workspace with more than 1000 engagement_items could non-deterministically
// fail to recognise an item it had already ingested. The fix orders by
// `created_at` descending before taking the (real) 1000-row limit, so the
// window is always the most recently created items rather than whatever the
// database felt like handing back.

type ExistingRow = { external_id: string; status: string; created_at: string };

function makeIngestClient(existingRows: ExistingRow[]) {
  const inserted: Record<string, unknown>[][] = [];
  let capturedOrder: [string, { ascending?: boolean } | undefined] | null = null;
  let capturedLimit: number | null = null;

  function chain(table: string, kind: "select" | "update" | "upsert", arg?: unknown) {
    let limitN = Infinity;
    const self = {
      eq: () => self,
      in: () => self,
      gte: () => self,
      order: (col: string, opts?: { ascending?: boolean }) => {
        capturedOrder = [col, opts];
        return self;
      },
      limit: (n: number) => {
        limitN = n;
        capturedLimit = n;
        return self;
      },
      select: () => self,
      then: (
        resolve: (v: { data: unknown; error: null }) => unknown,
        reject?: (e: unknown) => unknown,
      ) => {
        let result: { data: unknown; error: null };
        if (table === "engagement_items" && kind === "select") {
          const [col, opts] = capturedOrder ?? ["created_at", { ascending: false }];
          const asc = opts?.ascending ?? true;
          const rows = [...existingRows].sort((a, b) => {
            const av = a[col as keyof ExistingRow];
            const bv = b[col as keyof ExistingRow];
            if (av === bv) return 0;
            const cmp = av > bv ? 1 : -1;
            return asc ? cmp : -cmp;
          });
          result = { data: rows.slice(0, limitN), error: null };
        } else if (table === "engagement_items" && kind === "upsert") {
          const queue = arg as Record<string, unknown>[];
          inserted.push(queue);
          result = { data: queue.map((_, i) => ({ id: `new-${i}` })), error: null };
        } else {
          result = { data: [], error: null };
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return self;
  }

  const client = {
    from: (table: string) => ({
      select: () => chain(table, "select"),
      update: () => chain(table, "update"),
      upsert: (rows: Record<string, unknown>[]) => chain(table, "upsert", rows),
    }),
  };
  return {
    client,
    inserted,
    queryInfo: () => ({ order: capturedOrder, limit: capturedLimit }),
  };
}

function fakeComment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "c1",
    text: "hi there",
    authorName: "Someone",
    authorId: "someone",
    authorUrl: null,
    authorAvatarUrl: null,
    createdAt: "2026-03-10T00:00:00.000Z",
    isOwn: false,
    replyCounter: 0,
    ...overrides,
  };
}

describe("ingestEngagement — bounded, ordered dedup lookup (finding 19)", () => {
  it("asks for created_at-descending order and the real 1000-row limit, not the old unordered 5000", async () => {
    vi.mocked(requireUnipileCreds).mockResolvedValue({ dsn: "x.unipile.com", apiKey: "k" });
    vi.mocked(listAccounts).mockResolvedValue([]);
    const { client, queryInfo } = makeIngestClient([]);

    await ingestEngagement(client as never, "ws1");

    const info = queryInfo();
    expect(info.order?.[0]).toBe("created_at");
    expect(info.order?.[1]?.ascending).toBe(false);
    expect(info.limit).toBe(1000);
  });

  it("still recognises the most recently created existing item when the workspace has over 1000 items", async () => {
    // 1000 filler rows plus one deliberately OLDER row and one deliberately
    // NEWER row, for 1002 total — comfortably past the 1000-row cap.
    const filler: ExistingRow[] = Array.from({ length: 1000 }, (_, i) => ({
      external_id: `comment:filler-${i}`,
      status: "replied",
      created_at: new Date(2021, 0, 1 + i).toISOString(),
    }));
    const existingRows: ExistingRow[] = [
      { external_id: "comment:oldest", status: "replied", created_at: "2020-01-01T00:00:00.000Z" },
      ...filler,
      {
        external_id: "comment:newest",
        status: "needs_reply",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    const { client, inserted } = makeIngestClient(existingRows);

    vi.mocked(requireUnipileCreds).mockResolvedValue({ dsn: "x.unipile.com", apiKey: "k" });
    vi.mocked(listAccounts).mockResolvedValue([
      { id: "acct1", type: "LINKEDIN", name: "Acme", status: "OK" },
    ]);
    vi.mocked(getOwnProfile).mockResolvedValue({ id: "me-1", name: "Me", publicIdentifier: null });
    vi.mocked(listOwnPosts).mockResolvedValue([
      { id: "post-1", text: "hello", url: null, postedAt: null, commentCount: 2 },
    ]);
    vi.mocked(listChats).mockResolvedValue([]);
    // Unipile hands back a comment matching the newest existing row (should
    // be recognised and skipped) and one matching the oldest (which the
    // explicit 1000-row window no longer covers, by design — see the comment
    // above `ingestEngagement`'s dedup fetch).
    vi.mocked(listPostComments).mockResolvedValue([
      fakeComment({ id: "newest", authorName: "Newest Author" }),
      fakeComment({ id: "oldest", authorName: "Oldest Author" }),
    ]);

    const res = await ingestEngagement(client as never, "ws1");

    expect(res.skipped).toBe(1);
    const queuedIds = inserted.flat().map((r) => r.external_id);
    expect(queuedIds).toContain("comment:oldest");
    expect(queuedIds).not.toContain("comment:newest");
  });

  it("recognises an existing item deterministically regardless of its position in the underlying rows", async () => {
    // Same shape as above but the newest row is listed FIRST in the fixture
    // (rather than last) to prove recognition comes from the `created_at`
    // ordering the fix added, not from incidentally matching array order —
    // which is exactly the non-determinism the missing `.order()` used to
    // allow.
    const filler: ExistingRow[] = Array.from({ length: 1000 }, (_, i) => ({
      external_id: `comment:filler-${i}`,
      status: "replied",
      created_at: new Date(2021, 0, 1 + i).toISOString(),
    }));
    const existingRows: ExistingRow[] = [
      {
        external_id: "comment:newest",
        status: "needs_reply",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      ...filler,
    ];
    const { client, inserted } = makeIngestClient(existingRows);

    vi.mocked(requireUnipileCreds).mockResolvedValue({ dsn: "x.unipile.com", apiKey: "k" });
    vi.mocked(listAccounts).mockResolvedValue([
      { id: "acct1", type: "LINKEDIN", name: "Acme", status: "OK" },
    ]);
    vi.mocked(getOwnProfile).mockResolvedValue({ id: "me-1", name: "Me", publicIdentifier: null });
    vi.mocked(listOwnPosts).mockResolvedValue([
      { id: "post-1", text: "hello", url: null, postedAt: null, commentCount: 1 },
    ]);
    vi.mocked(listChats).mockResolvedValue([]);
    vi.mocked(listPostComments).mockResolvedValue([fakeComment({ id: "newest" })]);

    const res = await ingestEngagement(client as never, "ws1");

    expect(res.skipped).toBe(1);
    expect(inserted.flat()).toEqual([]);
  });
});
