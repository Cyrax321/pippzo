// Swipe file — posts the user pastes into chat as creative references.
// Read through Unipile (the user's own connected LinkedIn session), persisted
// into social_posts with source = 'reference' so the agent can recall them
// later. LinkedIn only for now; Unipile's GET /posts also supports Instagram
// once an IG account is connected, so that is the natural v2.

import { requireUnipileCreds, getPost, type UnipilePostDetail } from "./unipile.server";
import { fetchWithTimeout, FETCH_TIMEOUT } from "../fetch-timeout";

type Client = { from: (t: string) => any };

// String.slice can cut an emoji or styled-unicode character in half, leaving a
// lone high surrogate that Postgres rejects as invalid JSON. Always truncate
// with this instead of .slice (same guard as the engagement sync).
const cut = (s: string, n: number) => s.slice(0, n).replace(/[\uD800-\uDBFF]$/, "");

// Unipile id rules, verified against their docs:
//   .../posts/slug-activity-{digits}-xyz  -> the numeric id
//   .../feed/update/urn:li:activity:{id}  -> the numeric id
//   ugcPost urls                          -> urn:li:ugcPost:{id}
//   share urls                            -> urn:li:share:{id}
// Newer /posts/ slugs may omit the "-activity-" token entirely (author +
// headline words + 19-digit id + short suffix), so after the specific
// patterns miss we take the last 15-20 digit run in the path — activity ids
// are 19 digits, and slug/author digits never get that long.
export function parseLinkedInPostUrl(input: string): string | null {
  const s = input.trim();
  let m = /-activity-(\d{6,})/.exec(s);
  if (m) return m[1];
  m = /urn:li:activity:(\d{6,})/.exec(s);
  if (m) return m[1];
  m = /urn:li:(ugcPost|share):(\d{6,})/.exec(s);
  if (m) return `urn:li:${m[1]}:${m[2]}`;
  m = /linkedin\.com\/.*ugcPost[:-](\d{6,})/.exec(s);
  if (m) return `urn:li:ugcPost:${m[1]}`;
  if (/linkedin\.com\//i.test(s)) {
    // Query/hash stripped so tracking params can never feed the fallback.
    const path = s.split(/[?#]/)[0];
    const runs = path.match(/\d{15,20}/g);
    if (runs?.length) return runs[runs.length - 1];
  }
  return null;
}

// Share flows (especially mobile) hand out lnkd.in short links. Resolve one
// redirect hop server-side and parse the target; anything unexpected falls
// through to the normal unsupported-URL error.
async function resolveShortLink(url: string): Promise<string> {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)lnkd\.in$/i.test(parsed.hostname)) return url;
    // Deadlined like every other outbound call: a short-link host that never
    // answers must not hold a request open indefinitely. A timeout here falls
    // through to the original URL, which then fails with the normal
    // unsupported-URL message.
    const res = await fetchWithTimeout(
      url,
      { redirect: "manual" },
      { timeoutMs: FETCH_TIMEOUT.api, label: "the LinkedIn short link" },
    );
    const location = res.headers.get("location");
    if (location && /linkedin\.com\//i.test(location)) return location;
  } catch {
    /* fall through with the original url */
  }
  return url;
}

export type ReferencePost = {
  id: string;
  url: string | null;
  author: string;
  authorHeadline: string | null;
  text: string;
  postedAt: string | null;
  metrics: { reactions: number; comments: number; reposts: number; impressions: number | null };
  media: string[];
  note: string | null;
  savedAt?: string;
};

export async function readReferencePost(
  client: Client,
  workspaceId: string,
  url: string,
  note?: string,
): Promise<ReferencePost> {
  if (/instagram\.com/i.test(url)) {
    throw new Error(
      "Instagram references are not supported yet — it needs an Instagram account connected through Unipile in /conexiones. LinkedIn post URLs work today.",
    );
  }
  const resolved = await resolveShortLink(url);
  const postId = parseLinkedInPostUrl(resolved);
  if (!postId) {
    throw new Error(
      "Only LinkedIn post URLs are supported for now. Paste a linkedin.com/posts/... or feed/update/urn:li:activity:... link. If a LinkedIn link still fails, open the post, use ⋯ → Copy link to post, and paste that URL.",
    );
  }
  const creds = await requireUnipileCreds(client, workspaceId);
  const { data: account } = await client
    .from("engagement_accounts")
    .select("external_account_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "unipile")
    .eq("network", "LINKEDIN")
    .limit(1)
    .maybeSingle();
  if (!account?.external_account_id) {
    throw new Error("No LinkedIn account is linked via Unipile. Connect one in /conexiones first.");
  }

  // A numeric id from a /posts/ slug can back an activity, a share, or a
  // ugcPost — the URL doesn't say which, and Unipile 404s on the wrong kind.
  // Try the numeric id first (works for activities), then the URN variants.
  const candidates = /^\d+$/.test(postId)
    ? [postId, `urn:li:share:${postId}`, `urn:li:ugcPost:${postId}`]
    : [postId];
  let post: UnipilePostDetail | null = null;
  let lastError: Error | null = null;
  for (const candidate of candidates) {
    try {
      post = await getPost(creds, String(account.external_account_id), candidate);
      break;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (!/\(404\)/.test(lastError.message)) throw lastError;
    }
  }
  if (!post) {
    throw new Error(
      `LinkedIn did not return that post (it may be deleted or restricted). ${lastError?.message ?? ""}`.trim(),
    );
  }
  const row = {
    workspace_id: workspaceId,
    source: "reference",
    competitor_id: null,
    network: "linkedin",
    external_id: post.postId || postId,
    url: post.shareUrl || url,
    published_at: post.postedAt,
    caption: cut(post.text, 8000),
    media_type: post.mediaKinds[0] ?? null,
    metrics: {
      reactions: post.reactions,
      comments: post.comments,
      reposts: post.reposts,
      impressions: post.impressions,
    },
    author: cut(post.authorName, 300),
    note: note ? cut(note, 1000) : null,
    fetched_at: new Date().toISOString(),
  };
  const { error } = await client
    .from("social_posts")
    .upsert(row, { onConflict: "workspace_id,network,external_id" });
  if (error) console.warn("[references] save failed:", error.message);

  return {
    id: row.external_id,
    url: row.url,
    author: post.authorName,
    authorHeadline: post.authorHeadline,
    text: row.caption,
    postedAt: post.postedAt,
    metrics: row.metrics,
    media: post.mediaKinds,
    note: row.note,
  };
}

export async function listReferencePosts(
  client: Client,
  workspaceId: string,
  limit = 20,
): Promise<ReferencePost[]> {
  const { data, error } = await client
    .from("social_posts")
    .select("external_id,url,author,caption,published_at,metrics,media_type,note,fetched_at")
    .eq("workspace_id", workspaceId)
    .eq("source", "reference")
    .order("fetched_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not list references: ${error.message}`);
  return (data ?? []).map((r: any) => ({
    id: String(r.external_id),
    url: r.url ?? null,
    author: String(r.author ?? "Unknown author"),
    authorHeadline: null,
    text: String(r.caption ?? ""),
    postedAt: r.published_at ?? null,
    metrics: {
      reactions: Number(r.metrics?.reactions ?? 0),
      comments: Number(r.metrics?.comments ?? 0),
      reposts: Number(r.metrics?.reposts ?? 0),
      impressions: r.metrics?.impressions ?? null,
    },
    media: r.media_type ? [String(r.media_type)] : [],
    note: r.note ?? null,
    savedAt: r.fetched_at ?? undefined,
  }));
}
