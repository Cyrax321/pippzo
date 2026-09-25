// Tests for the approval transition — the point where a post stops being
// pending. The thing under test is the race: the guard and the write used to be
// separate round trips, so two approvals arriving together both passed the
// check and both published. The write now carries the guard with it.
//
// The Supabase query builder is stubbed by a tiny in-memory table so the
// filters a call builds (which rows it is willing to touch) and the interleaving
// of two concurrent callers can both be observed.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  transitionPendingApproval,
  describeTakenPost,
  approvePostForAgent,
  rejectPostForAgent,
} from "./approvals.server";

// The publish helper is only reachable through a dynamic import inside the
// module; mocking it keeps the test off the network and counts the calls, which
// is the whole point — one approval, one publish.
const publishMock = vi.fn(
  async (): Promise<{
    ok: boolean;
    channelName?: string;
    error?: string | null;
    notAttempted?: boolean;
    outcomeUnknown?: boolean;
  }> => ({ ok: true, channelName: "Test Page", error: null }),
);
// `publishOutcomeStatus` is the real one on purpose: the point of the wave-5
// change is that all three status writers share one decision, so a test that
// stubbed it would stop checking the thing that matters.
vi.mock("@/lib/buffer-publish.server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/buffer-publish.server")>(
    "@/lib/buffer-publish.server",
  );
  return {
    publishOutcomeStatus: actual.publishOutcomeStatus,
    publishScheduledPostToBuffer: (...args: unknown[]) => publishMock(...(args as [])),
  };
});
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

type Row = Record<string, unknown> & { id: string; workspace_id: string; status: string };

function fakeDb(rows: Row[], opts: { updateError?: string; readError?: string } = {}) {
  const inserted: Record<string, unknown>[] = [];
  const updateFilters: [string, unknown][][] = [];

  const from = (table: string) => {
    let mode: "select" | "update" = "select";
    let patch: Record<string, unknown> = {};
    const filters: [string, unknown][] = [];
    const match = () => rows.filter((r) => filters.every(([column, value]) => r[column] === value));

    const chain = {
      select: (_columns: string) => chain,
      update: (p: Record<string, unknown>) => {
        mode = "update";
        patch = p;
        return chain;
      },
      insert: async (row: Record<string, unknown>) => {
        inserted.push({ table, ...row });
        return { error: null };
      },
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return chain;
      },
      maybeSingle: () => run(true),
      // The real query builder is a thenable, and the outcome write awaits it
      // without asking for a row back.
      then: (
        onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => run(false).then(onFulfilled, onRejected),
    };

    async function run(single: boolean) {
      // A turn of the event loop, so two callers can interleave the way two
      // browser tabs do.
      await Promise.resolve();
      if (mode === "update") {
        updateFilters.push([...filters]);
        if (opts.updateError) return { data: null, error: { message: opts.updateError } };
        const hit = match();
        hit.forEach((r) => Object.assign(r, patch));
        const copies = hit.map((r) => ({ ...r }));
        return { data: single ? (copies[0] ?? null) : copies, error: null };
      }
      if (opts.readError) return { data: null, error: { message: opts.readError } };
      const copies = match().map((r) => ({ ...r }));
      return { data: single ? (copies[0] ?? null) : copies, error: null };
    }

    return chain;
  };

  return { db: { from } as { from: (t: string) => never }, inserted, updateFilters, rows };
}

const pendingRow = (over: Partial<Row> = {}): Row => ({
  id: "post-1",
  workspace_id: "ws-1",
  status: "pending_approval",
  post: { platform: "linkedin", caption: "Hello" },
  scheduled_at: "2026-09-20T09:00:00.000Z",
  image_url: null,
  buffer_channel_id: null,
  ...over,
});

beforeEach(() => {
  publishMock.mockClear();
});

describe("transitionPendingApproval", () => {
  it("writes the guard as a filter on the update, not as a separate read", async () => {
    const { db, updateFilters } = fakeDb([pendingRow()]);
    const res = await transitionPendingApproval(db, "ws-1", "post-1", { status: "scheduled" });

    expect(res.outcome).toBe("changed");
    expect(updateFilters[0]).toEqual([
      ["id", "post-1"],
      ["workspace_id", "ws-1"],
      ["status", "pending_approval"],
    ]);
  });

  it("returns the row it moved, so the caller publishes what it actually claimed", async () => {
    const { db } = fakeDb([pendingRow({ image_url: "https://example.test/a.png" })]);
    const res = await transitionPendingApproval(db, "ws-1", "post-1", { status: "scheduled" });

    expect(res.outcome === "changed" && res.row.image_url).toBe("https://example.test/a.png");
  });

  it("reports 'taken' with the current status when the row already moved on", async () => {
    const { db } = fakeDb([pendingRow({ status: "published" })]);
    const res = await transitionPendingApproval(db, "ws-1", "post-1", { status: "scheduled" });

    expect(res).toEqual({ outcome: "taken", status: "published" });
  });

  it("reports 'taken' with a null status when the row is gone", async () => {
    const { db } = fakeDb([]);
    const res = await transitionPendingApproval(db, "ws-1", "post-1", { status: "scheduled" });

    expect(res).toEqual({ outcome: "taken", status: null });
  });

  it("will not touch a post in another workspace", async () => {
    const { db, rows } = fakeDb([pendingRow({ workspace_id: "ws-other" })]);
    const res = await transitionPendingApproval(db, "ws-1", "post-1", { status: "scheduled" });

    expect(res.outcome).toBe("taken");
    expect(rows[0].status).toBe("pending_approval");
  });

  it("surfaces a write error rather than pretending the transition happened", async () => {
    const { db } = fakeDb([pendingRow()], { updateError: "connection reset" });
    const res = await transitionPendingApproval(db, "ws-1", "post-1", { status: "scheduled" });

    expect(res).toEqual({ outcome: "error", message: "connection reset" });
  });

  it("lets exactly one of two concurrent callers through", async () => {
    const { db } = fakeDb([pendingRow()]);
    const both = await Promise.all([
      transitionPendingApproval(db, "ws-1", "post-1", { status: "scheduled" }),
      transitionPendingApproval(db, "ws-1", "post-1", { status: "scheduled" }),
    ]);

    expect(both.filter((r) => r.outcome === "changed")).toHaveLength(1);
    expect(both.filter((r) => r.outcome === "taken")).toHaveLength(1);
  });
});

describe("describeTakenPost", () => {
  it("says the post was approved by someone else, not that it failed", () => {
    const msg = describeTakenPost("published", "approve");
    expect(msg).toContain("already approved");
    expect(msg).toContain("published");
    expect(msg.toLowerCase()).not.toContain("failed");
  });

  it("distinguishes an earlier rejection", () => {
    expect(describeTakenPost("rejected", "reject")).toContain("already rejected");
  });

  it("says a deleted post is gone", () => {
    expect(describeTakenPost(null, "approve")).toContain("deleted");
  });
});

describe("approvePostForAgent", () => {
  it("publishes once when two approvals arrive together", async () => {
    const { db } = fakeDb([pendingRow()]);
    const both = await Promise.all([
      approvePostForAgent(db, "ws-1", "post-1"),
      approvePostForAgent(db, "ws-1", "post-1"),
    ]);

    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(both.filter((r) => r.ok)).toHaveLength(1);

    const loser = both.find((r) => !r.ok) as {
      alreadyHandled?: boolean;
      error?: string;
      publishNote?: string;
    };
    expect(loser.alreadyHandled).toBe(true);
    expect(loser.error).toContain("already approved");
    // The agent must not report a publish it did not make.
    expect(loser.publishNote).toContain("did NOT publish");
  });

  it("records the publish outcome on the row it claimed", async () => {
    const { db, rows } = fakeDb([pendingRow()]);
    const res = await approvePostForAgent(db, "ws-1", "post-1", "Edited caption");

    expect(res.ok).toBe(true);
    expect(rows[0].status).toBe("published");
    expect((rows[0].post as { caption: string }).caption).toBe("Edited caption");
  });

  it("refuses a post that was never pending, with its real status", async () => {
    const { db } = fakeDb([pendingRow({ status: "draft" })]);
    const res = await approvePostForAgent(db, "ws-1", "post-1");

    expect(res.ok).toBe(false);
    expect(res.error).toContain("draft");
    expect(publishMock).not.toHaveBeenCalled();
  });
});

describe("rejectPostForAgent", () => {
  it("lets only one of two concurrent rejections change the post", async () => {
    const { db, rows } = fakeDb([pendingRow()]);
    const both = await Promise.all([
      rejectPostForAgent(db, "ws-1", "post-1"),
      rejectPostForAgent(db, "ws-1", "post-1"),
    ]);

    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(rows[0].status).toBe("rejected");
  });

  it("does not reject a post an approval already took, and says so", async () => {
    const { db, rows } = fakeDb([pendingRow()]);
    const [, rejected] = await Promise.all([
      approvePostForAgent(db, "ws-1", "post-1"),
      rejectPostForAgent(db, "ws-1", "post-1"),
    ]);

    expect(rejected.ok).toBe(false);
    expect(rows[0].status).not.toBe("rejected");
    expect((rejected as { error?: string }).error).toContain("already approved");
  });
});

// ---------------------------------------------------------------------------
// Three publish outcomes, three different things the agent is allowed to say.
//
// docs/bugs.md finding 54: a publish that timed out was recorded as
// `publish_failed` and reported as a failure, which asserts the channel was
// asked and refused. It was not — we stopped listening. An agent that repeats
// "it failed" sends the user to republish a post that may already be live.

describe("approvePostForAgent — recording an outcome we cannot account for", () => {
  const unknownOutcome = () =>
    publishMock.mockResolvedValueOnce({
      ok: false,
      outcomeUnknown: true,
      error: "We cannot tell whether this post went out. Check publish.buffer.com…",
    });

  it("writes publish_unknown, not publish_failed", async () => {
    const { db, rows } = fakeDb([pendingRow()]);
    unknownOutcome();
    const res = await approvePostForAgent(db, "ws-1", "post-1");

    expect(res.ok).toBe(true);
    expect(rows[0].status).toBe("publish_unknown");
    expect((res as { status?: string }).status).toBe("publish_unknown");
  });

  it("tells the agent we do not know, and never that it failed or published", async () => {
    const { db } = fakeDb([pendingRow()]);
    unknownOutcome();
    const res = (await approvePostForAgent(db, "ws-1", "post-1")) as {
      publishNote?: string;
      bufferPublished?: boolean;
      outcomeUnknown?: boolean;
    };

    expect(res.outcomeUnknown).toBe(true);
    expect(res.bufferPublished).toBe(false);
    expect(res.publishNote).toContain("WE DO NOT KNOW whether this went out");
    expect(res.publishNote).toContain("do NOT say it published and do NOT say it failed");
    // Where to look, and why looking comes before republishing.
    expect(res.publishNote).toContain("publish.buffer.com");
    expect(res.publishNote).toContain("second copy on a live channel");
    // The two claims this state exists to prevent.
    expect(res.publishNote).not.toContain("is NOT live on social networks");
    expect(res.publishNote).not.toMatch(/publishing failed/i);
  });

  it("still calls a definite refusal a failure, and still says the post is not live", async () => {
    const { db, rows } = fakeDb([pendingRow()]);
    publishMock.mockResolvedValueOnce({ ok: false, error: "Buffer rejected the post." });
    const res = (await approvePostForAgent(db, "ws-1", "post-1")) as {
      publishNote?: string;
      outcomeUnknown?: boolean;
    };

    expect(rows[0].status).toBe("publish_failed");
    expect(res.outcomeUnknown).toBe(false);
    // The earlier wave's instruction has to survive the new branch.
    expect(res.publishNote).toContain("NOT live on social networks");
  });

  it("still writes nothing at all when nothing was sent", async () => {
    const { db, rows } = fakeDb([pendingRow()]);
    publishMock.mockResolvedValueOnce({
      ok: false,
      notAttempted: true,
      error: "A publish for this post is already running…",
    });
    await approvePostForAgent(db, "ws-1", "post-1");

    // The attempt holding the claim may be seconds from succeeding.
    expect(rows[0].status).toBe("scheduled");
  });
});
