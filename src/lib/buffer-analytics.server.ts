// Own-account performance ingestion via Buffer's GraphQL API.
// Server-only. Pulls already-sent posts + their engagement numbers and upserts
// them into `post_metrics` so the agent can learn from what actually worked.
//
// Uses Buffer's documented cursor-paginated `posts` query and normalized
// `PostMetric` shape. Anything unparseable is stored raw.

import { fetchWithTimeout, FetchTimeoutError } from "./fetch-timeout";
import {
  BUFFER_TIMEOUT,
  BufferApiError,
  bufferHttpFailure,
  bufferUnreadableResponse,
  classifyBufferFailure,
} from "./buffer-shared";

const ENDPOINT = "https://api.buffer.com";

type AnyRec = Record<string, unknown>;

async function gql<T>(
  token: string,
  query: string,
  variables?: AnyRec,
  // A metrics pull is many serial round trips on the automation tick, so the
  // ceiling that matters is the product, not the single call — hence the
  // shorter per-page budget. Callers making a single small query pass
  // BUFFER_TIMEOUT.read instead.
  timeoutMs: number = BUFFER_TIMEOUT.metricsPage,
): Promise<T> {
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
    if (e instanceof FetchTimeoutError) throw e;
    throw new BufferApiError(
      `Buffer network error: ${e instanceof Error ? e.message : String(e)}`,
      { kind: "unreachable", outcomeUnknown: true },
    );
  }
  const json = (await res.json().catch(() => null)) as {
    data?: T;
    errors?: Array<{ message: string }>;
  } | null;
  if (!res.ok || json?.errors?.length) {
    throw bufferHttpFailure(
      res.status,
      json?.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`,
    );
  }
  // `json!.data as T` used to hand back `undefined` here and let the caller
  // throw a TypeError three lines later. This is a read path, so nothing is at
  // stake beyond the message, but the message should still be true.
  if (!json || json.data == null) throw bufferUnreadableResponse(res.status, !!json);
  return json.data as T;
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
};

/** Flattens whatever metric shape Buffer returns into a flat key -> number map. */
function flattenMetrics(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (Array.isArray(raw)) {
    for (const m of raw as AnyRec[]) {
      const key = String(m?.key ?? m?.name ?? m?.type ?? m?.label ?? "").toLowerCase();
      const value = m?.value ?? m?.count ?? m?.total ?? m?.amount;
      if (key && value !== undefined) out[key] = num(value);
      else if (m && typeof m === "object") {
        // Unknown shape: absorb every numeric field on the entry.
        for (const [k, v] of Object.entries(m)) {
          if (
            typeof v === "number" ||
            (typeof v === "string" && v !== "" && Number.isFinite(Number(v)))
          ) {
            out[k.toLowerCase()] = num(v);
          }
        }
      }
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as AnyRec)) {
      if (typeof v === "number" || typeof v === "string") out[k.toLowerCase()] = num(v);
    }
  }
  return out;
}

const pick = (m: Record<string, number>, ...keys: string[]) => {
  for (const k of keys) if (typeof m[k] === "number" && m[k] > 0) return m[k];
  return 0;
};

export type SentPost = {
  bufferPostId: string;
  channelId: string | null;
  service: string | null;
  text: string;
  mediaType: string | null;
  mediaUrl: string | null;
  postType: string | null;
  sentAt: string | null;
  metrics: Record<string, number>;
};

// `Asset` is an interface with scalar `source`/`thumbnail`; the fallbacks cover
// older schema variants and, last of all, no media at all.
const MEDIA_SELECTIONS = [
  "assets { __typename type mimeType source thumbnail }",
  "assets { __typename source thumbnail }",
  "",
];

// Per-network metadata carries the post type (post / reel / story / thread …).
const METADATA_SEL = `metadata { __typename
  ... on InstagramPostMetadata { type }
  ... on FacebookPostMetadata { type }
  ... on LinkedInPostMetadata { type }
  ... on TwitterPostMetadata { type }
}`;

function sentPostsQuery(first: number, mediaSel: string, metaSel: string): string {
  return `query SentPosts($input: PostsInput!, $after: String) {
    posts(first: ${first}, after: $after, input: $input) {
      edges { node {
        id
        text
        dueAt
        sentAt
        channelId
        channelService
        ${metaSel}
        ${mediaSel}
        metrics { type name value unit }
        metricsUpdatedAt
      } }
      pageInfo { endCursor hasNextPage }
    }
  }`;
}

/** Picks the best display URL from Buffer's asset list (thumbnail beats source). */
function pickMedia(assets: unknown): { url: string | null; type: string | null } {
  if (!Array.isArray(assets) || assets.length === 0) return { url: null, type: null };
  const first = assets[0] as AnyRec;
  const http = (v: unknown) => (typeof v === "string" && /^https?:\/\//i.test(v) ? v : null);
  const typeName = String(first?.__typename ?? "").toLowerCase();
  const type =
    (typeof first?.type === "string" ? String(first.type) : null) ??
    (typeName.includes("video") ? "video" : typeName.includes("image") ? "image" : null);
  return { url: http(first?.thumbnail) ?? http(first?.source) ?? null, type };
}

function normalize(node: AnyRec): SentPost {
  const media = pickMedia(node.assets ?? node.media ?? null);
  const meta = (node.metadata ?? null) as AnyRec | null;
  return {
    bufferPostId: String(node.id ?? ""),
    channelId: node.channelId ? String(node.channelId) : null,
    service: node.channelService ? String(node.channelService) : null,
    text: String(node.text ?? ""),
    mediaType: media.type,
    mediaUrl: media.url,
    postType: meta && typeof meta.type === "string" ? meta.type : null,
    sentAt: node.sentAt ? String(node.sentAt) : node.dueAt ? String(node.dueAt) : null,
    metrics: flattenMetrics(node.metrics),
  };
}

const isSelectionError = (msg: string) =>
  /Cannot query field|Unknown type|Unknown argument|must not have a selection|must have a selection|Fragment cannot be spread/i.test(
    msg,
  );

/**
 * Fetches sent posts newest-first, paginating until `limit` is reached, so a
 * channel that last posted months ago still surfaces its most recent work.
 */
export async function fetchSentPosts(
  token: string,
  organizationId: string,
  limit = 50,
  channelId?: string,
): Promise<SentPost[]> {
  const target = Math.max(1, Math.min(500, Math.floor(limit)));
  const pageSize = Math.min(100, target);
  const input: AnyRec = {
    organizationId,
    filter: { status: ["sent"], ...(channelId ? { channelIds: [channelId] } : {}) },
    sort: [{ field: "dueAt", direction: "desc" }],
  };

  let mediaSel: string | null = null;
  let metaSel: string = METADATA_SEL;
  const out: SentPost[] = [];
  let after: string | null = null;

  while (out.length < target) {
    let data: { posts?: AnyRec } | null = null;
    const candidates: string[] = mediaSel === null ? MEDIA_SELECTIONS : [mediaSel];
    for (const sel of candidates) {
      try {
        data = await gql<{ posts?: AnyRec }>(token, sentPostsQuery(pageSize, sel, metaSel), {
          input,
          after,
        });
        mediaSel = sel;
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (metaSel && isSelectionError(msg)) {
          // Retry the same media selection without the metadata block.
          metaSel = "";
          try {
            data = await gql<{ posts?: AnyRec }>(token, sentPostsQuery(pageSize, sel, ""), {
              input,
              after,
            });
            mediaSel = sel;
            break;
          } catch {
            metaSel = "";
          }
        }
        if (sel && isSelectionError(msg)) continue;
        throw e;
      }
    }
    const posts = data?.posts;
    const edges = Array.isArray(posts?.edges) ? (posts.edges as AnyRec[]) : [];
    for (const edge of edges) {
      const node = (edge.node ?? edge) as AnyRec;
      if (node?.id) out.push(normalize(node));
    }
    const pageInfo = (posts?.pageInfo ?? null) as AnyRec | null;
    after = pageInfo?.hasNextPage && pageInfo?.endCursor ? String(pageInfo.endCursor) : null;
    if (!after || edges.length === 0) break;
  }

  return out.slice(0, target);
}

type Client = { from: (t: string) => any };

export type SyncResult = { fetched: number; upserted: number; organizationId: string };

export async function syncBufferMetrics(
  client: Client,
  token: string,
  workspaceId: string,
  limit = 50,
): Promise<SyncResult> {
  type Acct = { account: { organizations: Array<{ id: string }> } };
  // One tiny query, not a page of history — the short read budget, so a dead
  // Buffer does not eat 20 seconds of the tick before we even start.
  const acct = await gql<Acct>(
    token,
    `query { account { organizations { id } } }`,
    undefined,
    BUFFER_TIMEOUT.read,
  );
  const orgId = acct.account.organizations?.[0]?.id;
  if (!orgId) throw new Error("No Buffer organization found for this token.");

  // Map channel id -> readable service (instagram, linkedin, …) so reports don't show raw IDs.
  const channelService = new Map<string, string>();
  try {
    type ChResp = { channels: Array<{ id: string; name: string; service: string }> };
    const ch = await gql<ChResp>(
      token,
      `query GetChannels($input: ChannelsInput!) { channels(input: $input) { id name service } }`,
      { input: { organizationId: orgId } },
      BUFFER_TIMEOUT.read,
    );
    for (const c of ch.channels ?? []) {
      if (c?.id) channelService.set(String(c.id), String(c.service || c.name || ""));
    }
  } catch (e) {
    // Non-fatal: metrics still sync without friendly channel names — unless the
    // token itself is dead, which no amount of continuing will fix.
    if (classifyBufferFailure(e).kind === "auth") throw e;
  }

  // Buffer's org-wide `posts` query tends to return only the first channel's
  // history, so pull each connected channel separately and merge.
  const seen = new Map<string, SentPost>();
  const channelIds = Array.from(channelService.keys());
  let perChannelWorked = false;
  for (const cid of channelIds) {
    try {
      const batch = await fetchSentPosts(token, orgId, limit, cid);
      perChannelWorked = true;
      for (const p of batch) seen.set(p.bufferPostId, { ...p, channelId: p.channelId ?? cid });
    } catch (e) {
      // A revoked token fails identically for every channel, and then again for
      // the org-wide fallback below. Stop at the first one and say why, instead
      // of spending N+1 timed-out round trips of the automation tick proving it.
      if (classifyBufferFailure(e).kind === "auth") throw e;
      console.error("[buffer:metrics] per-channel fetch failed", cid, e);
    }
  }
  if (!perChannelWorked || seen.size === 0) {
    for (const p of await fetchSentPosts(token, orgId, limit)) seen.set(p.bufferPostId, p);
  }
  const posts = Array.from(seen.values());
  if (posts.length === 0) return { fetched: 0, upserted: 0, organizationId: orgId };

  const rows = posts.map((p) => {
    const m = p.metrics;
    const impressions = pick(m, "impressions", "impression", "views", "video_views");
    const reach = pick(m, "reach", "unique_impressions");
    const likes = pick(m, "likes", "favorites", "reactions");
    const comments = pick(m, "comments", "replies");
    const shares = pick(m, "shares", "retweets", "reshares");
    const clicks = pick(m, "clicks", "url_clicks", "link_clicks");
    const engagements = likes + comments + shares + clicks;
    const base = impressions || reach;
    return {
      workspace_id: workspaceId,
      buffer_post_id: p.bufferPostId,
      channel_id: p.channelId,
      service: p.service ?? (p.channelId ? (channelService.get(p.channelId) ?? null) : null),
      text: p.text.slice(0, 4000),
      media_type: p.postType && p.postType !== "post" ? p.postType : p.mediaType,
      media_url: p.mediaUrl,
      sent_at: p.sentAt,
      impressions,
      reach,
      likes,
      comments,
      shares,
      clicks,
      engagement_rate: base > 0 ? Number(((engagements / base) * 100).toFixed(3)) : 0,
      raw: m as unknown as AnyRec,
      fetched_at: new Date().toISOString(),
    };
  });

  const { error } = await client
    .from("post_metrics")
    .upsert(rows, { onConflict: "workspace_id,buffer_post_id" });
  if (error) throw new Error(`Could not store metrics: ${error.message}`);

  return { fetched: posts.length, upserted: rows.length, organizationId: orgId };
}

/** Prompt block describing the account's best and worst recent posts. */
export async function loadPerformanceContext(
  client: Client,
  workspaceId: string,
  limit = 5,
): Promise<string> {
  const { data, error } = await client
    .from("post_metrics")
    .select("text,service,media_type,impressions,likes,comments,shares,engagement_rate,sent_at")
    .eq("workspace_id", workspaceId)
    .order("engagement_rate", { ascending: false })
    .limit(limit * 3);
  if (error || !data || data.length === 0) return "";
  const rows = data as Array<AnyRec>;
  const line = (r: AnyRec) =>
    `- [${r.service ?? "?"}${r.media_type ? `/${r.media_type}` : ""}] ER ${num(r.engagement_rate)}% · ${num(r.likes)} likes · ${num(r.comments)} comments — "${String(
      r.text ?? "",
    )
      .slice(0, 180)
      .replace(/\s+/g, " ")}"`;
  const top = rows.slice(0, limit).map(line);
  const bottom = rows.slice(-limit).reverse().map(line);
  const parts = [`## Own-account performance (Buffer)`];
  if (top.length) parts.push(`Best performing recent posts:\n${top.join("\n")}`);
  if (bottom.length && rows.length > limit)
    parts.push(`Weakest recent posts (avoid these patterns):\n${bottom.join("\n")}`);
  return parts.join("\n\n");
}
