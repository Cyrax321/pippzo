// Scheduler & Publisher runner for due scheduled_posts.
// Server-only. Called by cron-tick every minute to ensure scheduled posts
// actually go out to X or Buffer when their scheduled_at instant arrives.

import { publishTweet, getXConnection } from "./x.server";
import {
  publishScheduledPostToBuffer,
  publishOutcomeStatus,
} from "@/lib/buffer-publish.server";
import { logActivity } from "@/lib/activity-log";

type Client = { from: (t: string) => any; storage?: any };

type ScheduledPostRow = {
  id: string;
  workspace_id: string;
  post: {
    platform?: string;
    caption?: string;
    cta?: string;
    hashtags?: string[];
  };
  image_url: string | null;
  scheduled_at: string | null;
  status: string;
  buffer_id: string | null;
  buffer_channel_id: string | null;
  x_post_id: string | null;
};

export async function findAndPublishDueScheduledPosts(
  admin: Client,
  now = new Date(),
): Promise<{ checked: number; published: number; failed: number }> {
  const nowIso = now.toISOString();

  // Find posts scheduled for now or in the past that have not yet been published
  const { data, error } = await admin
    .from("scheduled_posts")
    .select("id,workspace_id,post,image_url,scheduled_at,status,buffer_id,buffer_channel_id,x_post_id")
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso)
    .is("buffer_id", null)
    .is("x_post_id", null)
    .limit(20);

  if (error || !data || data.length === 0) {
    return { checked: 0, published: 0, failed: 0 };
  }

  const duePosts = data as ScheduledPostRow[];
  let publishedCount = 0;
  let failedCount = 0;

  for (const post of duePosts) {
    const platform = (post.post?.platform || "").toLowerCase();
    const caption = post.post?.caption || "";
    const tags = (post.post?.hashtags || []).map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
    const fullText = [caption.trim(), post.post?.cta?.trim(), tags].filter(Boolean).join("\n\n");

    // 1. Direct X handling: If the platform is "x" (or "twitter") and X is connected directly
    if (platform === "x" || platform === "twitter") {
      const xConn = await getXConnection(admin, post.workspace_id);
      if (xConn.row && xConn.row.status === "connected") {
        // Claim the post so concurrent ticks don't double-publish
        const { data: claimed } = await admin
          .from("scheduled_posts")
          .update({ publish_claimed_at: nowIso })
          .eq("id", post.id)
          .eq("status", "scheduled")
          .is("x_post_id", null)
          .select("id")
          .maybeSingle();

        if (!claimed) continue; // Claimed by another worker

        const mediaUrls = post.image_url ? [post.image_url] : [];
        const res = await publishTweet(admin, post.workspace_id, {
          text: fullText,
          mediaUrls,
        });

        if (res.ok && res.tweetId) {
          await admin
            .from("scheduled_posts")
            .update({
              status: "published",
              x_post_id: res.tweetId,
              x_posted_at: nowIso,
              buffer_id: res.tweetId, // mirror id
            })
            .eq("id", post.id);

          await logActivity({
            workspaceId: post.workspace_id,
            actorType: "cron",
            action: "post.published_x",
            summary: `Scheduled post published to X: "${caption.slice(0, 60)}"`,
            details: { postId: post.id, tweetId: res.tweetId, url: res.url },
          }, admin);

          publishedCount++;
          continue;
        } else {
          await admin
            .from("scheduled_posts")
            .update({
              status: "publish_failed",
              note: res.error || "Failed to publish to X",
              publish_claimed_at: null,
            })
            .eq("id", post.id);

          failedCount++;
          continue;
        }
      }
    }

    // 2. Buffer handling: For LinkedIn, Instagram, Facebook, TikTok (or X via Buffer)
    try {
      const pub = await publishScheduledPostToBuffer(admin, post.workspace_id, {
        id: post.id,
        platform,
        caption: fullText,
        imageUrl: post.image_url,
        scheduledAtISO: post.scheduled_at,
        channelId: post.buffer_channel_id,
      });

      const outcome = publishOutcomeStatus(pub);
      if (outcome) {
        await admin
          .from("scheduled_posts")
          .update({ status: outcome })
          .eq("id", post.id);

        if (outcome === "published") {
          publishedCount++;
          await logActivity({
            workspaceId: post.workspace_id,
            actorType: "cron",
            action: "post.published_buffer",
            summary: `Scheduled post published via Buffer to ${platform}: "${caption.slice(0, 60)}"`,
            details: { postId: post.id, bufferId: pub.bufferId, channelId: pub.channelId },
          }, admin);
        } else {
          failedCount++;
        }
      }
    } catch (err) {
      console.error("[scheduler] publish error", { postId: post.id, err });
      failedCount++;
    }
  }

  return { checked: duePosts.length, published: publishedCount, failed: failedCount };
}
