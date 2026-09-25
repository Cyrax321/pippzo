// Approval queue access for the chat agent (server-only).
// Reads and resolves posts sitting in `scheduled_posts` with status
// `pending_approval`. Every write is mirrored into the activity log.

import { logActivity } from "@/lib/activity-log";

type Client = { from: (t: string) => any };

type PostRow = {
  id: string;
  post: { platform?: string; caption?: string; hashtags?: string[] } | null;
  scheduled_at: string | null;
  status: string;
  note: string | null;
  image_url: string | null;
};

const shape = (r: PostRow) => ({
  id: r.id,
  platform: r.post?.platform ?? "unknown",
  caption: (r.post?.caption ?? "").slice(0, 800),
  hashtags: r.post?.hashtags ?? [],
  proposedFor: r.scheduled_at,
  note: r.note,
  hasImage: !!r.image_url,
  status: r.status,
});

export async function listApprovalsForAgent(
  db: Client,
  workspaceId: string,
  args: { status?: "pending" | "rejected" | "all"; limit?: number } = {},
) {
  const status = args.status ?? "pending";
  let q = db
    .from("scheduled_posts")
    .select("id,post,scheduled_at,status,note,image_url")
    .eq("workspace_id", workspaceId)
    .order("scheduled_at", { ascending: true })
    .limit(Math.min(args.limit ?? 20, 50));
  if (status === "pending") q = q.eq("status", "pending_approval");
  else if (status === "rejected") q = q.eq("status", "rejected");
  else q = q.in("status", ["pending_approval", "rejected"]);
  const { data, error } = await q;
  if (error) return { ok: false as const, error: "Could not read the approval queue." };
  const items = ((data ?? []) as PostRow[]).map(shape);
  return { ok: true as const, status, count: items.length, items };
}

// The row a conditional transition hands back, i.e. the post as it stood at the
// moment this call — and no other — moved it out of `pending_approval`.
export type ClaimedPost = {
  id: string;
  post: { platform?: string; caption?: string; hashtags?: string[] } | null;
  scheduled_at: string | null;
  status: string;
  image_url: string | null;
  buffer_channel_id: string | null;
};

export type ApprovalTransition =
  | { outcome: "changed"; row: ClaimedPost }
  | { outcome: "taken"; status: string | null }
  | { outcome: "error"; message: string };

/**
 * Moves a post out of `pending_approval` in one round trip.
 *
 * Reading the status and then writing it are two trips, and between them a
 * second approval — a double click, a second tab, the user and the agent at
 * once — can slip through: both read "pending_approval", both write, both go on
 * to publish. So the `pending_approval` check rides along with the write as a
 * filter, and the updated row is asked for back. Postgres applies that filter
 * once, to one writer: whoever gets a row returned is the one that made the
 * transition, and everybody else gets nothing back and must not publish.
 *
 * `taken` carries the status the row actually has now, so the caller can tell
 * the difference between "already approved" and "already rejected".
 */
export async function transitionPendingApproval(
  db: Client,
  workspaceId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<ApprovalTransition> {
  const { data, error } = await db
    .from("scheduled_posts")
    .update(patch)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .eq("status", "pending_approval")
    // buffer_channel_id: when the post was scheduled against one specific
    // channel, publishing it to another page of the same network would be
    // wrong — the publish helper prefers it over matching by platform.
    .select("id,post,scheduled_at,status,image_url,buffer_channel_id")
    .maybeSingle();
  if (error) return { outcome: "error", message: error.message ?? "update failed" };
  if (data) return { outcome: "changed", row: data as ClaimedPost };
  // No row came back: either somebody else moved it first, or it is gone. Read
  // the current status so the answer can say which, instead of guessing.
  const { data: current } = await db
    .from("scheduled_posts")
    .select("status")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return { outcome: "taken", status: (current?.status as string | undefined) ?? null };
}

/** Plain-language account of a lost race, given the status the row holds now. */
export function describeTakenPost(status: string | null, decision: "approve" | "reject"): string {
  const verb = decision === "approve" ? "approve" : "reject";
  if (status === null)
    return `That post is no longer in this workspace — it was deleted before the ${verb} landed.`;
  if (status === "rejected")
    return `Someone already rejected that post, so this ${verb} changed nothing.`;
  if (status === "pending_approval")
    return `That post is still waiting for approval — the ${verb} did not go through. Try again.`;
  return `Someone already approved that post — it is now "${status}" — so this ${verb} changed nothing.`;
}

async function resolve(
  db: Client,
  workspaceId: string,
  id: string,
  decision: "approve" | "reject",
  caption?: string,
) {
  const { data: row, error: readErr } = await db
    .from("scheduled_posts")
    .select("id,post,status")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (readErr) return { ok: false as const, error: "Could not read that post." };
  if (!row) return { ok: false as const, error: "No post with that id in this workspace." };
  // A courtesy check only — it gives a better message for a post that was never
  // pending. The check that actually decides anything is the filter on the
  // write below; this one can go stale between here and there.
  if (row.status !== "pending_approval")
    return { ok: false as const, error: `That post is "${row.status}", not waiting for approval.` };

  const patch: Record<string, unknown> = {
    status: decision === "approve" ? "scheduled" : "rejected",
  };
  if (decision === "approve" && caption?.trim()) {
    patch.post = { ...(row.post ?? {}), caption: caption.trim() };
  }
  const transition = await transitionPendingApproval(db, workspaceId, id, patch);
  if (transition.outcome === "error")
    return { ok: false as const, error: "Could not update that post." };
  if (transition.outcome === "taken") {
    // Nothing was written and nothing will be published here. The post is not
    // broken — somebody else got there first.
    const message = describeTakenPost(transition.status, decision);
    return {
      ok: false as const,
      id,
      status: transition.status,
      alreadyHandled: true as const,
      error: message,
      ...(decision === "approve"
        ? {
            publishNote: `${message} This call did NOT publish anything. Do not tell the user you published it — check the queue if you need its real state.`,
          }
        : {}),
    };
  }
  // From here on this call, and only this call, owns the transition.
  const claimed = transition.row;

  // An approval used to stop at the internal calendar even though the user
  // expects an approved post to actually go out. Attempt the Buffer publish
  // here — with the admin client, because the publish helper needs service-role
  // access for storage and the Buffer token. The approval itself must survive a
  // publish failure: report the outcome, never roll back the status flip.
  let published: {
    ok: boolean;
    channelName?: string;
    error?: string;
  } | null = null;
  // The status this attempt should be written to the row, decided by the shared
  // publishOutcomeStatus so the cron autopost, bufferPublishApprovedPost and
  // this tool cannot disagree about what a timeout means (docs/bugs.md finding
  // 54). null means "write nothing".
  let outcome: "published" | "publish_failed" | "publish_unknown" | null = null;
  if (decision === "approve") {
    try {
      const [{ publishScheduledPostToBuffer, publishOutcomeStatus }, { supabaseAdmin }] =
        await Promise.all([
          import("@/lib/buffer-publish.server"),
          import("@/integrations/supabase/client.server"),
        ]);
      const post = (claimed.post ?? {}) as { platform?: string; caption?: string };
      const res = await publishScheduledPostToBuffer(supabaseAdmin as never, workspaceId, {
        id: claimed.id,
        platform: post.platform ?? "linkedin",
        caption: caption?.trim() || post.caption || "",
        imageUrl: claimed.image_url ?? undefined,
        scheduledAtISO: claimed.scheduled_at ?? undefined,
        channelId: claimed.buffer_channel_id ?? undefined,
      });
      published = {
        ok: res.ok,
        channelName: res.channelName ?? undefined,
        error: res.error ?? undefined,
      };
      outcome = publishOutcomeStatus(res);
    } catch (e) {
      // The publish helper never got as far as talking to Buffer, so nothing
      // went out — a definite failure, not an unknown one.
      published = { ok: false, error: e instanceof Error ? e.message : "buffer_publish_failed" };
      outcome = "publish_failed";
    }
  }

  // Record what actually happened to the post. This is NOT a rollback of the
  // approval — the decision stands — it is the difference between a row that
  // reached the channel and one that only looks like it did. Left at
  // 'scheduled', a failed publish was indistinguishable from a healthy queued
  // post and nothing ever revisited it.
  let finalStatus = patch.status as string;
  if (outcome) {
    const { error: outcomeErr } = await db
      .from("scheduled_posts")
      .update({ status: outcome })
      .eq("id", id);
    if (outcomeErr) console.error("[approvals] could not record publish outcome", outcomeErr);
    else finalStatus = outcome;
  }
  // A publish we cannot account for is its own answer, and the agent must not
  // round it to either neighbour: "failed" invites a republish that can put a
  // second copy on a live channel, and "published" claims something nobody
  // verified. Kept separate from `published.ok` for exactly that reason.
  const outcomeUnknown = outcome === "publish_unknown";

  await logActivity(
    {
      workspaceId,
      actorType: "agent",
      action: decision === "approve" ? "approval.approved" : "approval.rejected",
      summary:
        decision === "approve"
          ? published?.ok
            ? `Agent approved a pending post and published it to Buffer (${published.channelName ?? "channel"}).`
            : outcomeUnknown
              ? `Agent approved a pending post and sent it to Buffer, but no answer came back — whether it went out is unknown: ${published?.error ?? "the outcome is unknown"}`
              : `Agent approved a pending post, but publishing failed and it is on the internal calendar only: ${published?.error ?? "Buffer publish not available"}.`
          : `Agent rejected a pending post.`,
      relatedType: "scheduled_post",
      relatedId: id,
    },
    db as never,
  );
  if (decision === "approve") {
    return {
      ok: true as const,
      id,
      status: finalStatus,
      bufferPublished: published?.ok === true,
      // Three outcomes, three different things the agent is allowed to say. The
      // middle one is the whole point of finding 54: "failed" would send the
      // user to republish a post that may already be live, and "published"
      // would claim something nobody checked.
      outcomeUnknown,
      publishNote: published?.ok
        ? `Approved and published to Buffer (${published.channelName ?? "channel"}).`
        : outcomeUnknown
          ? `Approved, but WE DO NOT KNOW whether this went out: the publish request was sent and no answer came back (${published?.error ?? "the outcome is unknown"}). It is now marked "publish_unknown". Tell the user exactly that — do NOT say it published and do NOT say it failed. Tell them to check this channel at publish.buffer.com before republishing it, because if it did go out, publishing again puts a second copy on a live channel.`
          : `Approved — the post is on the internal calendar only${finalStatus === "publish_failed" ? ' and is now marked "publish_failed"' : ""}: ${published?.error ?? "Buffer publish not available"}. Tell the user it is NOT live on social networks, and that publishing it needs the Buffer connection fixed in Settings → Connections first.`,
    };
  }
  return { ok: true as const, id, status: finalStatus };
}

export const approvePostForAgent = (db: Client, ws: string, id: string, caption?: string) =>
  resolve(db, ws, id, "approve", caption);

export const rejectPostForAgent = (db: Client, ws: string, id: string) =>
  resolve(db, ws, id, "reject");
