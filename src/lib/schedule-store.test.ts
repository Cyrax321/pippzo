// Tests for deleting a scheduled post — the point where one user action has to
// fan out to three places: the channel the post is queued on, the database row,
// and the image object in storage.
//
// The bugs these pin down (docs/bugs.md findings 6 and 16) were both about the
// row going first: the row vanished while the post stayed live on Buffer, and
// the row vanished while its image stayed in the bucket forever. So the
// assertions here are mostly about ORDER and about what survives a failure.
//
// Supabase is stubbed by a small in-memory fake covering exactly the calls this
// store makes: a table read, a row delete, a row update, a `brand_images`
// lookup, and `storage.remove`.

import { describe, it, expect, vi, beforeEach } from "vitest";

type StoredRow = {
  id: string;
  workspace_id: string;
  post: {
    platform: string;
    caption: string;
    hashtags: string[];
    cta: string;
    visualConcept: string;
  };
  image_url: string | null;
  video_url: string | null;
  scheduled_at: string | null;
  status: string;
  note: string | null;
  buffer_id: string | null;
  buffer_channel_id: string | null;
  image_storage_path: string | null;
  created_at: string;
};

type FakeState = {
  rows: StoredRow[];
  brandImages: { id: string; storage_path: string }[];
  deleteError: string | null;
  storageError: string | null;
  brandImagesError: string | null;
  events: string[];
  deleted: string[];
  updates: { id: string; patch: Record<string, unknown> }[];
  storageRemoved: { bucket: string; paths: string[] }[];
};

const hoisted = vi.hoisted(() => ({ client: null as unknown as Record<string, never> }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) =>
      (hoisted.client as unknown as { from: (...a: unknown[]) => unknown }).from(...args),
    get storage() {
      return (hoisted.client as unknown as { storage: unknown }).storage;
    },
  },
}));

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  logActivity: vi.fn(),
}));
const { toastError } = mocks;
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess, warning: mocks.toastWarning },
}));
vi.mock("./activity-log", () => ({ logActivityFn: mocks.logActivity }));

import { scheduleStore, isLive, publishState, type ScheduledPost } from "./schedule-store";

function makeRow(over: Partial<StoredRow> = {}): StoredRow {
  return {
    id: over.id ?? "post-1",
    workspace_id: "ws-1",
    post: {
      platform: "linkedin",
      caption: "Hello world",
      hashtags: [],
      cta: "",
      visualConcept: "",
    },
    image_url: null,
    video_url: null,
    scheduled_at: "2026-10-01T09:00:00.000Z",
    status: "scheduled",
    note: null,
    buffer_id: null,
    buffer_channel_id: null,
    image_storage_path: null,
    created_at: "2026-09-01T09:00:00.000Z",
    ...over,
  };
}

function makeClient(state: FakeState) {
  return {
    from(table: string) {
      if (table === "brand_images") {
        return {
          select: () => ({
            eq: (_col: string, value: string) => ({
              limit: async () =>
                state.brandImagesError
                  ? { data: null, error: { message: state.brandImagesError } }
                  : {
                      data: state.brandImages.filter((b) => b.storage_path === value),
                      error: null,
                    },
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            order: async () => ({ data: state.rows.slice(), error: null }),
          }),
        }),
        delete: () => ({
          eq: async (_col: string, id: string) => {
            if (state.deleteError) return { error: { message: state.deleteError } };
            state.events.push("row-delete");
            state.deleted.push(id);
            state.rows = state.rows.filter((r) => r.id !== id);
            return { error: null };
          },
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            state.events.push("row-update");
            state.updates.push({ id, patch });
            return { error: null };
          },
        }),
        insert: async () => ({ error: null }),
      };
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          if (state.storageError) return { error: { message: state.storageError } };
          state.events.push("storage-remove");
          state.storageRemoved.push({ bucket, paths });
          return { error: null };
        },
      }),
    },
  };
}

let state: FakeState;
let workspaceCounter = 0;

/** Loads the given rows into the store's cache under a fresh workspace id. */
async function load(rows: StoredRow[]) {
  state.rows = rows;
  hoisted.client = makeClient(state) as unknown as Record<string, never>;
  // A fresh id every time: setWorkspace short-circuits when the id is unchanged,
  // which would leave the previous test's cache in place.
  scheduleStore.setWorkspace(null);
  scheduleStore.setWorkspace(`ws-${++workspaceCounter}`);
  await scheduleStore.refresh();
}

const ids = () => scheduleStore.getAll().map((p) => p.id);

beforeEach(() => {
  vi.clearAllMocks();
  state = {
    rows: [],
    brandImages: [],
    deleteError: null,
    storageError: null,
    brandImagesError: null,
    events: [],
    deleted: [],
    updates: [],
    storageRemoved: [],
  };
  hoisted.client = makeClient(state) as unknown as Record<string, never>;
});

describe("remove — a post that is not live", () => {
  it("deletes the row without asking anyone to touch a channel", async () => {
    await load([makeRow()]);
    const removeFromBuffer = vi.fn(async () => {});

    const res = await scheduleStore.remove("post-1", { removeFromBuffer });

    expect(res.ok).toBe(true);
    expect(res.bufferRemoved).toBe(false);
    expect(removeFromBuffer).not.toHaveBeenCalled();
    expect(state.deleted).toEqual(["post-1"]);
    expect(ids()).toEqual([]);
  });
});

describe("remove — a post that is live on Buffer", () => {
  it("removes it from the channel BEFORE deleting the row", async () => {
    await load([makeRow({ buffer_id: "buf-9", buffer_channel_id: "chan-1" })]);
    const removeFromBuffer = vi.fn(async () => {
      state.events.push("buffer-delete");
    });

    const res = await scheduleStore.remove("post-1", { removeFromBuffer });

    expect(res.ok).toBe(true);
    expect(res.bufferRemoved).toBe(true);
    expect(removeFromBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ bufferId: "buf-9" }) as unknown as {
        bufferId: string;
        post: ScheduledPost;
      },
    );
    expect(state.events).toEqual(["buffer-delete", "row-delete"]);
  });

  it("keeps the post when the channel refuses, and says why", async () => {
    await load([makeRow({ buffer_id: "buf-9" })]);
    const removeFromBuffer = vi.fn(async () => {
      throw new Error("Buffer token expired");
    });

    const res = await scheduleStore.remove("post-1", { removeFromBuffer });

    expect(res.ok).toBe(false);
    expect(res.error).toBe("Buffer token expired");
    expect(res.bufferRemoved).toBe(false);
    // The row is the whole point: a failed upstream delete must not orphan it.
    expect(state.deleted).toEqual([]);
    expect(ids()).toEqual(["post-1"]);
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("still live") as string);
  });

  it("refuses outright when the caller cannot reach the channel at all", async () => {
    await load([makeRow({ buffer_id: "buf-9" })]);

    const res = await scheduleStore.remove("post-1");

    expect(res.ok).toBe(false);
    expect(state.deleted).toEqual([]);
    expect(ids()).toEqual(["post-1"]);
  });

  it("skips the upstream delete when the caller already did it", async () => {
    await load([makeRow({ buffer_id: "buf-9" })]);
    const removeFromBuffer = vi.fn(async () => {});

    const res = await scheduleStore.remove("post-1", {
      alreadyRemovedFromBuffer: true,
      removeFromBuffer,
    });

    expect(res.ok).toBe(true);
    expect(removeFromBuffer).not.toHaveBeenCalled();
    expect(state.deleted).toEqual(["post-1"]);
  });

  it("clears buffer_id when the channel delete worked but the row delete did not", async () => {
    await load([makeRow({ buffer_id: "buf-9", buffer_channel_id: "chan-1" })]);
    state.deleteError = "statement timeout";

    const res = await scheduleStore.remove("post-1", { removeFromBuffer: async () => {} });

    expect(res.ok).toBe(false);
    expect(res.bufferRemoved).toBe(true);
    // The post survived but is no longer live, so the calendar must stop
    // claiming it is.
    expect(ids()).toEqual(["post-1"]);
    expect(state.updates).toEqual([
      { id: "post-1", patch: { buffer_id: null, buffer_channel_id: null } },
    ]);
  });
});

describe("remove — the stored image", () => {
  it("deletes the object from the media bucket after the row is gone", async () => {
    await load([makeRow({ image_storage_path: "ws-1/daily-abc.png" })]);

    const res = await scheduleStore.remove("post-1");

    expect(res.storage).toBe("deleted");
    expect(state.storageRemoved).toEqual([{ bucket: "media", paths: ["ws-1/daily-abc.png"] }]);
    // Storage last: an object deleted before a row delete that then failed
    // would strip the image off a post that still exists.
    expect(state.events).toEqual(["row-delete", "storage-remove"]);
  });

  it("does nothing for a legacy base64 row with no object behind it", async () => {
    await load([makeRow({ image_url: "data:image/png;base64,AAAA", image_storage_path: null })]);

    const res = await scheduleStore.remove("post-1");

    expect(res.ok).toBe(true);
    expect(res.storage).toBe("none");
    expect(state.storageRemoved).toEqual([]);
  });

  it("leaves the object alone when the visual library still points at it", async () => {
    await load([makeRow({ image_storage_path: "ws-1/daily-abc.png" })]);
    state.brandImages = [{ id: "img-1", storage_path: "ws-1/daily-abc.png" }];

    const res = await scheduleStore.remove("post-1");

    expect(res.ok).toBe(true);
    expect(res.storage).toBe("shared");
    expect(state.storageRemoved).toEqual([]);
  });

  it("leaves the object alone when the shared-reference check itself fails", async () => {
    await load([makeRow({ image_storage_path: "ws-1/daily-abc.png" })]);
    state.brandImagesError = "permission denied";

    const res = await scheduleStore.remove("post-1");

    expect(res.ok).toBe(true);
    expect(res.storage).toBe("skipped");
    expect(state.storageRemoved).toEqual([]);
  });

  it("still counts the delete as done when storage refuses", async () => {
    await load([makeRow({ image_storage_path: "ws-1/daily-abc.png" })]);
    state.storageError = "object not found";

    const res = await scheduleStore.remove("post-1");

    // Non-fatal by design: a bucket that will not let go of a file must never
    // block the user's delete.
    expect(res.ok).toBe(true);
    expect(res.storage).toBe("failed");
    expect(state.deleted).toEqual(["post-1"]);
  });
});

describe("update — clearing a nullable field", () => {
  it("writes NULL when a field is explicitly cleared", async () => {
    await load([
      makeRow({
        buffer_id: "buf-9",
        buffer_channel_id: "chan-1",
        image_url: "data:image/png;base64,AAAA",
      }),
    ]);

    // This is the shape the Unpublish button and the editor's image-remove
    // both send. A `!== undefined` test used to drop them, so the row kept
    // claiming the post was live until the next hydrate proved it.
    await scheduleStore.update("post-1", {
      bufferId: undefined,
      bufferChannelId: undefined,
      imageDataUrl: undefined,
    });

    expect(state.updates).toEqual([
      {
        id: "post-1",
        patch: { buffer_id: null, buffer_channel_id: null, image_url: null },
      },
    ]);
  });

  it("does not write a column the caller never mentioned", async () => {
    await load([makeRow({ buffer_id: "buf-9" })]);

    await scheduleStore.update("post-1", { status: "published" });

    expect(state.updates).toEqual([{ id: "post-1", patch: { status: "published" } }]);
  });
});

describe("reschedule", () => {
  it("reports that a live post's channel time did not move", async () => {
    await load([makeRow({ buffer_id: "buf-9" })]);

    const res = await scheduleStore.reschedule("post-1", Date.parse("2026-10-05T09:00:00.000Z"));

    expect(res.ok).toBe(true);
    expect(res.bufferTimeUnchanged).toBe(true);
  });

  it("reports nothing extra for a post that is not live", async () => {
    await load([makeRow()]);

    const res = await scheduleStore.reschedule("post-1", Date.parse("2026-10-05T09:00:00.000Z"));

    expect(res.ok).toBe(true);
    expect(res.bufferTimeUnchanged).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// What state a post is actually in.
//
// Two pairs used to be collapsed into one state each. `published` and a
// `buffer_id` have always meant "the channel accepted it", never "it is out",
// so a post queued at the channel for tomorrow read as published today
// (docs/bugs.md finding 53). And a publish we could not account for was stamped
// `publish_failed`, which asserts the channel was asked and refused — something
// we do not know, and acting on it by republishing can put two copies on a live
// channel (finding 54).
//
// The split is derived, not stored: the due time we already have says whether
// the moment the channel was given has arrived. Nothing here touches Supabase.

const NOW = Date.parse("2026-03-17T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

const post = (over: Partial<ScheduledPost> = {}): ScheduledPost =>
  ({
    id: "p",
    post: {
      platform: "linkedin",
      caption: "hi",
      hashtags: [],
      cta: "",
      visualConcept: "",
    },
    scheduledAt: NOW - HOUR,
    status: "scheduled",
    createdAt: NOW,
    ...over,
  }) as ScheduledPost;

describe("publishState", () => {
  it("calls a post the channel took, whose time has passed, sent", () => {
    expect(publishState(post({ bufferId: "buf-1", scheduledAt: NOW - HOUR }), NOW)).toBe("sent");
  });

  it("calls a post the channel took, whose time is still ahead, queued — not published", () => {
    // The autopost schedules four hours out, so this is the ordinary case, not
    // an edge one: Buffer accepts it and holds it until then.
    expect(publishState(post({ bufferId: "buf-1", scheduledAt: NOW + 4 * HOUR }), NOW)).toBe(
      "queued",
    );
  });

  it("treats the hand-marked `published` status the same way as a buffer id", () => {
    expect(publishState(post({ status: "published", scheduledAt: NOW + HOUR }), NOW)).toBe(
      "queued",
    );
    expect(publishState(post({ status: "published", scheduledAt: NOW - HOUR }), NOW)).toBe("sent");
  });

  it("counts a live post with no time at all as queued", () => {
    // No due date means it went into the next free queue slot, which is by
    // definition still ahead of us. "Sent" is the claim that cannot be undone.
    expect(publishState(post({ bufferId: "buf-1", scheduledAt: null }), NOW)).toBe("queued");
  });

  it("calls the exact due moment sent rather than queued", () => {
    expect(publishState(post({ bufferId: "buf-1", scheduledAt: NOW }), NOW)).toBe("sent");
  });

  it("calls a post that has not reached a channel scheduled", () => {
    expect(publishState(post(), NOW)).toBe("scheduled");
  });

  it("calls a refused publish failed", () => {
    expect(publishState(post({ status: "publish_failed" }), NOW)).toBe("failed");
  });

  it("keeps an unaccounted-for publish its own state, separate from failed", () => {
    expect(publishState(post({ status: "publish_unknown" }), NOW)).toBe("unknown");
  });

  it("does not let an unknown outcome read as published", () => {
    const state = publishState(post({ status: "publish_unknown", bufferId: "buf-1" }), NOW);
    expect(state).toBe("unknown");
    expect(state).not.toBe("sent");
  });

  it("keeps wave 4's ordering: a failed publish outranks a buffer id", () => {
    expect(publishState(post({ status: "publish_failed", bufferId: "buf-1" }), NOW)).toBe("failed");
  });

  it("moves a post from queued to sent as its due time passes, with nothing written", () => {
    const p = post({ bufferId: "buf-1", scheduledAt: NOW + HOUR });
    expect(publishState(p, NOW)).toBe("queued");
    expect(publishState(p, NOW + HOUR + 1)).toBe("sent");
  });
});

describe("isLive — unchanged meaning, narrower claim", () => {
  it("still says yes for anything the channel took", () => {
    expect(isLive(post({ bufferId: "buf-1" }))).toBe(true);
    expect(isLive(post({ status: "published" }))).toBe(true);
  });

  it("still says no for a post that never reached a channel", () => {
    expect(isLive(post())).toBe(false);
    expect(isLive(post({ status: "publish_unknown" }))).toBe(false);
  });
});
