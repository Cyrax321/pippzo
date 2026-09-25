// Schedule store — Supabase-backed per workspace, sync read API for components.
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logActivityFn } from "./activity-log";
import type { GeneratedPost } from "./types";

// Mirrors the scheduled_posts status CHECK constraint.
//
// "publish_failed" means the post was approved/scheduled and the channel never
// accepted it, so it is not live anywhere — it exists so a failed publish stops
// looking like a healthy queued post.
//
// "publish_unknown" is the one next to it: the publish request went out and no
// usable answer came back (the deadline fired, the socket dropped, a 5xx, an
// unreadable reply), so the post may be live and may not. Recording that as
// "publish_failed" asserted something we do not know, and a user who acted on
// it by republishing could end up with two live posts (docs/bugs.md finding
// 54). Only `publishOutcomeStatus` in buffer-publish.server.ts writes either.
export type ScheduleStatus =
  | "draft"
  | "scheduled"
  | "published"
  | "pending_approval"
  | "rejected"
  | "publish_failed"
  | "publish_unknown";

export type ScheduledPost = {
  id: string;
  post: GeneratedPost;
  imageDataUrl?: string;
  videoUrl?: string;
  scheduledAt: number | null;
  status: ScheduleStatus;
  note?: string;
  createdAt: number;
  bufferId?: string;
  bufferChannelId?: string;
  /**
   * Object key in the `media` bucket behind `imageDataUrl`, when the image was
   * uploaded rather than inlined. Legacy rows store the image as a base64
   * `data:` URL and have no path — there is no object to clean up for those.
   */
  imageStoragePath?: string;
};

// ===========================================================================
// What state a post is actually in
// ===========================================================================

/**
 * True when the post reached the channel: it has a Buffer id (the reliable
 * signal — docs/bugs.md finding 22) or somebody marked it published by hand.
 *
 * Careful about what this does and does not say. It answers "did the channel
 * take it", which has never meant "it is out": `publishScheduledPostToBuffer`
 * asks Buffer for `customScheduled` whenever the due time is in the future, so
 * Buffer accepts the post, hands back an id, and holds it in the channel queue
 * until then. `publishState` below is what splits those two apart.
 */
export function isLive(post: ScheduledPost): boolean {
  return Boolean(post.bufferId) || post.status === "published";
}

/**
 * A publish was attempted and we know nothing went out — the channel was asked
 * and refused, or could not be asked at all. The post is saved but not live, so
 * this is the state most in need of the user's attention, and it is safe to fix
 * and publish again.
 */
export function isPublishFailed(post: ScheduledPost): boolean {
  return post.status === "publish_failed";
}

/**
 * The five things that can actually be true of a post, as opposed to the six
 * values the status column holds.
 *
 *   sent       the channel took it and the time it was given has passed.
 *   queued     the channel took it, for a time still ahead of us.
 *   scheduled  on our calendar only; nothing has been sent to any channel.
 *   failed     the channel was asked and refused. Nothing went out.
 *   unknown    the request went out and no answer came back. We cannot say.
 *
 * The first two used to be one state, which is finding 53: a post queued at the
 * channel for tomorrow read as already published today, because both `buffer_id`
 * and the `published` status are written the moment Buffer accepts it. The last
 * two used to be one state as well, which is finding 54.
 *
 * Derived rather than stored, deliberately: `published` still means exactly what
 * it meant before (the channel accepted it), and the due time we already have is
 * enough to say whether that moment has arrived. No column, no migration, and
 * nothing to keep in sync.
 */
export type PublishState = "sent" | "queued" | "scheduled" | "failed" | "unknown";

export function publishState(post: ScheduledPost, now: number = Date.now()): PublishState {
  if (post.status === "publish_unknown") return "unknown";
  // Wave 4's treatment: a failed publish outranks everything else on the
  // calendar, because it is the state that needs somebody to do something.
  if (isPublishFailed(post)) return "failed";
  if (!isLive(post)) return "scheduled";
  // The channel has it. It is only *out* once the time it was given has passed.
  // A post with no time at all went into the next free queue slot, which is by
  // definition still ahead of us — so it counts as queued too. Claiming "sent"
  // is the one mistake here that cannot be walked back.
  return post.scheduledAt !== null && post.scheduledAt <= now ? "sent" : "queued";
}

/** Bucket the scheduled-post images live in (see `cron-executors.server.ts`). */
const MEDIA_BUCKET = "media";

/**
 * Outcome of the best-effort storage cleanup that runs after a post row is
 * deleted. Only "failed" is a problem, and even then the delete itself stood.
 */
export type StorageCleanup =
  | "deleted" // the object is gone
  | "none" // there was never an object (legacy base64 row, or no image)
  | "shared" // the visual library still points at it, so it was left alone
  | "skipped" // could not establish whether it is shared; left alone
  | "failed"; // remove() was attempted and refused

/**
 * Takes a live post down from Buffer. Injected by the caller rather than
 * imported here so this store stays free of server functions (and so the
 * removal is trivially observable in tests).
 */
export type RemoveBufferHandler = (args: {
  bufferId: string;
  post: ScheduledPost;
}) => Promise<void>;

export type RemoveOptions = {
  removeFromBuffer?: RemoveBufferHandler;
  /**
   * The caller has already taken this post down from Buffer and is only asking
   * for the internal row to follow. Used by the chat `bufferDeletePost` tool,
   * which deletes upstream first and then clears the mirrored calendar row.
   */
  alreadyRemovedFromBuffer?: boolean;
};

export type RemoveResult = {
  ok: boolean;
  error?: string;
  /** True when a live channel post was taken down as part of this delete. */
  bufferRemoved: boolean;
  storage: StorageCleanup;
};

export type RescheduleResult = {
  ok: boolean;
  error?: string;
  /**
   * True when the post is live on Buffer: the internal date moved, the queued
   * channel post kept the time it was originally given. Callers must say so.
   */
  bufferTimeUnchanged: boolean;
};

type Listener = () => void;
const listeners = new Set<Listener>();
let workspaceId: string | null = null;
let cache: ScheduledPost[] = [];
let hydratedForWorkspace: string | null = null;
let inflight: Promise<void> | null = null;
const EMPTY: ScheduledPost[] = [];

const emit = () => listeners.forEach((l) => l());

type Row = {
  id: string;
  workspace_id: string;
  post: GeneratedPost;
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
const rowToPost = (r: Row): ScheduledPost => ({
  id: r.id,
  post: r.post,
  imageDataUrl: r.image_url ?? undefined,
  videoUrl: r.video_url ?? undefined,
  scheduledAt: r.scheduled_at ? new Date(r.scheduled_at).getTime() : null,
  status: (r.status as ScheduleStatus) ?? "draft",
  note: r.note ?? undefined,
  createdAt: new Date(r.created_at).getTime(),
  bufferId: r.buffer_id ?? undefined,
  bufferChannelId: r.buffer_channel_id ?? undefined,
  imageStoragePath: r.image_storage_path ?? undefined,
});

/**
 * Deletes the storage object behind a post's image. Best effort by design:
 * a bucket that will not let go of a file must never block the user's delete,
 * so every failure is logged and swallowed (docs/bugs.md finding 16).
 */
async function deletePostImageObject(post: ScheduledPost): Promise<StorageCleanup> {
  const path = post.imageStoragePath;
  // Rows that predate storage keep the image inline as a base64 data URL.
  // There is no object behind those, so there is nothing to clean up.
  if (!path) return "none";
  try {
    // The cron autopost files one upload in two places: the post row and the
    // visual library. Deleting the object here would leave the library with a
    // broken thumbnail, so a still-referenced object is left to the library's
    // own delete. An orphaned file is a smaller problem than a dead image.
    const { data: shared, error: lookupError } = await supabase
      .from("brand_images")
      .select("id")
      .eq("storage_path", path)
      .limit(1);
    if (lookupError) {
      console.warn("[schedule] storage cleanup skipped — could not check library references", {
        path,
        error: lookupError.message,
      });
      return "skipped";
    }
    if (shared && shared.length > 0) return "shared";
    const { error } = await supabase.storage.from(MEDIA_BUCKET).remove([path]);
    if (error) {
      console.warn("[schedule] storage cleanup failed — object left behind", {
        path,
        error: error.message,
      });
      return "failed";
    }
    return "deleted";
  } catch (e) {
    console.warn("[schedule] storage cleanup threw — object left behind", {
      path,
      error: e instanceof Error ? e.message : String(e),
    });
    return "failed";
  }
}

async function hydrate(force = false) {
  if (!workspaceId) return;
  if (!force && hydratedForWorkspace === workspaceId) return;
  if (inflight) return inflight;
  const ws = workspaceId;
  inflight = (async () => {
    try {
      const { data, error } = await supabase
        .from("scheduled_posts")
        .select("*")
        .eq("workspace_id", ws)
        .order("created_at", { ascending: false });
      if (workspaceId !== ws) return;
      if (error) {
        // Transient (e.g. statement timeout) — don't mark hydrated so we retry.
        console.error("[schedule] hydrate failed", error);
        return;
      }
      cache = (data as unknown as Row[]).map(rowToPost);
      hydratedForWorkspace = ws;
      emit();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export const scheduleStore = {
  setWorkspace(id: string | null) {
    if (id === workspaceId) return;
    workspaceId = id;
    hydratedForWorkspace = null;
    cache = [];
    emit();
    if (id) void hydrate();
  },
  subscribe(l: Listener) {
    void hydrate();
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  refresh: () => hydrate(true),
  getAll(): ScheduledPost[] {
    return cache;
  },
  // add/update/remove resolve AFTER the DB write so callers (the chat tool
  // handlers above all) can report the real outcome instead of an optimistic
  // ok. They resolve — never reject — with { ok } so legacy fire-and-forget
  // call sites cannot leak unhandled rejections; on failure the optimistic
  // cache change is reverted and a toast still fires.
  async add(
    item: Omit<ScheduledPost, "id" | "createdAt"> & { id?: string },
  ): Promise<{ ok: boolean; error?: string; post: ScheduledPost }> {
    const full: ScheduledPost = {
      id: item.id ?? crypto.randomUUID(),
      createdAt: Date.now(),
      ...item,
    } as ScheduledPost;
    cache = [full, ...cache];
    emit();
    if (!workspaceId) return { ok: true, post: full };
    const ws = workspaceId;
    const { error } = await supabase.from("scheduled_posts").insert({
      id: full.id,
      workspace_id: ws,
      post: full.post as unknown as never,
      image_url: full.imageDataUrl ?? null,
      video_url: full.videoUrl ?? null,
      scheduled_at: full.scheduledAt ? new Date(full.scheduledAt).toISOString() : null,
      status: full.status,
      note: full.note ?? null,
      buffer_id: full.bufferId ?? null,
      buffer_channel_id: full.bufferChannelId ?? null,
      image_storage_path: full.imageStoragePath ?? null,
    });
    if (error) {
      console.error("[schedule] add failed", error);
      toast.error("Could not save post");
      cache = cache.filter((p) => p.id !== full.id);
      emit();
      return { ok: false, error: error.message, post: full };
    }
    const when = full.scheduledAt ? new Date(full.scheduledAt).toLocaleString("en-US") : "draft";
    logActivityFn({
      workspaceId: ws,
      action: full.bufferId ? "buffer.published" : "post.scheduled",
      summary: `${full.bufferId ? "Published on Buffer" : "Scheduled"} ${full.post.platform} post for ${when}: "${full.post.caption.slice(0, 80)}"`,
      details: {
        platform: full.post.platform,
        hasImage: !!full.imageDataUrl,
        hasVideo: !!full.videoUrl,
        bufferId: full.bufferId ?? null,
      },
      relatedType: "scheduled_post",
      relatedId: full.id,
    });
    return { ok: true, post: full };
  },
  async update(
    id: string,
    patch: Partial<ScheduledPost>,
  ): Promise<{ ok: boolean; error?: string }> {
    const before = cache.find((p) => p.id === id);
    cache = cache.map((p) => (p.id === id ? { ...p, ...patch } : p));
    emit();
    if (!workspaceId) return { ok: true };
    const ws = workspaceId;
    type PostUpdate = {
      post?: unknown;
      image_url?: string | null;
      video_url?: string | null;
      scheduled_at?: string | null;
      status?: string;
      note?: string | null;
      buffer_id?: string | null;
      buffer_channel_id?: string | null;
      image_storage_path?: string | null;
    };
    const dbPatch: PostUpdate = {};
    // The nullable columns test for the KEY being present, not for a defined
    // value. Clearing one is expressed as `{ bufferId: undefined }` — the
    // Unpublish button and the image-removal in the editor both do exactly
    // that — and a `!== undefined` test silently dropped those, so the local
    // cache cleared while the database kept the old value until the next
    // hydrate brought it back.
    if ("imageDataUrl" in patch) dbPatch.image_url = patch.imageDataUrl ?? null;
    if ("videoUrl" in patch) dbPatch.video_url = patch.videoUrl ?? null;
    if ("scheduledAt" in patch)
      dbPatch.scheduled_at = patch.scheduledAt ? new Date(patch.scheduledAt).toISOString() : null;
    if ("note" in patch) dbPatch.note = patch.note ?? null;
    if ("bufferId" in patch) dbPatch.buffer_id = patch.bufferId ?? null;
    if ("bufferChannelId" in patch) dbPatch.buffer_channel_id = patch.bufferChannelId ?? null;
    if ("imageStoragePath" in patch) dbPatch.image_storage_path = patch.imageStoragePath ?? null;
    // `post` and `status` are NOT NULL, so an undefined value is never a
    // clear — it is a caller mistake, and writing it would break the row.
    if (patch.post !== undefined) dbPatch.post = patch.post;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (Object.keys(dbPatch).length === 0) return { ok: true };
    const { error } = await supabase
      .from("scheduled_posts")
      .update(dbPatch as never)
      .eq("id", id);
    if (error) {
      console.error("[schedule] update failed", error);
      toast.error("Could not update post");
      if (before) {
        cache = cache.map((p) => (p.id === id ? before : p));
        emit();
      }
      return { ok: false, error: error.message };
    }
    if (patch.scheduledAt !== undefined) {
      const when = patch.scheduledAt
        ? new Date(patch.scheduledAt).toLocaleString("en-US")
        : "drafts";
      logActivityFn({
        workspaceId: ws,
        action: "post.rescheduled",
        summary: `Moved post to ${when}.`,
        relatedType: "scheduled_post",
        relatedId: id,
      });
    }
    return { ok: true };
  },
  /**
   * Deletes a post. When the post is live on Buffer it is taken down from the
   * channel FIRST, and a failure there aborts the whole delete — deleting the
   * row while the post is still queued upstream is the orphan bug in
   * docs/bugs.md finding 6. Callers that can reach Buffer pass
   * `removeFromBuffer`; a caller that already took it down passes
   * `alreadyRemovedFromBuffer`. A caller that does neither cannot delete a
   * live post, by design, and gets an error saying why.
   *
   * After the row is gone the image object is removed from storage, best
   * effort (finding 16). Storage runs last on purpose: an object deleted
   * before a row delete that then fails would strip the image off a post that
   * still exists.
   */
  async remove(id: string, opts: RemoveOptions = {}): Promise<RemoveResult> {
    const existing = cache.find((p) => p.id === id);
    let bufferRemoved = false;
    if (existing?.bufferId && !opts.alreadyRemovedFromBuffer) {
      if (!opts.removeFromBuffer) {
        const error =
          "This post is live on your channel. Delete it from the post editor so it can be removed from the channel first.";
        console.error("[schedule] refused to delete a live post — no Buffer removal available", {
          id,
          bufferId: existing.bufferId,
        });
        toast.error(error);
        return { ok: false, error, bufferRemoved: false, storage: "none" };
      }
      try {
        await opts.removeFromBuffer({ bufferId: existing.bufferId, post: existing });
        bufferRemoved = true;
      } catch (e) {
        const error = e instanceof Error ? e.message : "Could not reach the channel";
        console.error("[schedule] Buffer removal failed — keeping the post", {
          id,
          bufferId: existing.bufferId,
          error,
        });
        toast.error(`Not deleted — the post is still live on the channel: ${error}`);
        return { ok: false, error, bufferRemoved: false, storage: "none" };
      }
    }
    cache = cache.filter((p) => p.id !== id);
    emit();
    const ws = workspaceId;
    const { error } = await supabase.from("scheduled_posts").delete().eq("id", id);
    if (error) {
      console.error("[schedule] remove failed", error);
      if (existing) {
        cache = [existing, ...cache];
        emit();
      }
      if (bufferRemoved) {
        // The post is off the channel but the row survived. Leaving buffer_id
        // on it would make the calendar keep claiming it is live, so clear it.
        toast.error(
          "Removed from the channel, but the calendar entry could not be deleted. It is no longer live — delete it again.",
        );
        await scheduleStore.update(id, { bufferId: undefined, bufferChannelId: undefined });
      } else {
        toast.error("Could not delete post");
      }
      return { ok: false, error: error.message, bufferRemoved, storage: "none" };
    }
    const storage = existing ? await deletePostImageObject(existing) : "none";
    if (ws && existing) {
      logActivityFn({
        workspaceId: ws,
        action: "post.deleted",
        summary: `Deleted ${existing.post.platform} post${bufferRemoved ? " (and removed it from the channel)" : ""}: "${existing.post.caption.slice(0, 80)}"`,
        details: {
          bufferRemoved,
          bufferId: existing.bufferId ?? null,
          imageStorage: storage,
        },
        relatedType: "scheduled_post",
        relatedId: id,
      });
    }
    return { ok: true, bufferRemoved, storage };
  },
  /**
   * Moves a post's internal date. Nothing here moves the Buffer post: this app
   * only creates and deletes upstream posts, there is no reschedule call. So a
   * live post's queued time is unchanged and `bufferTimeUnchanged` says so —
   * callers must surface it rather than let the calendar imply otherwise.
   */
  async reschedule(id: string, newDate: number | null): Promise<RescheduleResult> {
    const existing = cache.find((p) => p.id === id);
    const res = await scheduleStore.update(id, {
      scheduledAt: newDate,
      status: newDate ? "scheduled" : "draft",
    });
    return { ...res, bufferTimeUnchanged: Boolean(res.ok && existing?.bufferId) };
  },
};

function useHydrated() {
  const [h, setH] = useState(false);
  useEffect(() => setH(true), []);
  return h;
}

export function useScheduledPosts() {
  const h = useHydrated();
  const v = useSyncExternalStore(
    scheduleStore.subscribe,
    () => cache,
    () => EMPTY,
  );
  return h ? v : EMPTY;
}
