// Server-only wrapper for the ScrapeCreators API.
// Base URL + auth: https://docs.scrapecreators.com — pass x-api-key header.
// All functions in this file MUST be called from server code only.

import { fetchWithTimeout, FETCH_TIMEOUT } from "@/lib/fetch-timeout";

const BASE = "https://api.scrapecreators.com";

function key(apiKey?: string) {
  const k = apiKey?.trim() || process.env.SCRAPECREATORS_API_KEY;
  if (!k)
    throw new Error(
      "ScrapeCreators is not connected. Add your own API key in Settings → Connections.",
    );
  return k;
}

async function scFetch<T = unknown>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  apiKey?: string,
): Promise<T> {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetchWithTimeout(
    url.toString(),
    { headers: { "x-api-key": key(apiKey), accept: "application/json" } },
    { timeoutMs: FETCH_TIMEOUT.api, label: "ScrapeCreators" },
  );
  const text = await res.text();
  if (!res.ok) {
    // Keep upstream body short — never forward raw provider errors to end users
    const short = text.slice(0, 200).replace(/\s+/g, " ");
    throw new Error(`ScrapeCreators ${res.status} on ${path}: ${short}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`ScrapeCreators returned non-JSON for ${path}`);
  }
}

// ---------- Normalized post shape stored in `social_posts.metrics` ----------
export type NormalizedPost = {
  external_id: string;
  url?: string;
  published_at?: string; // ISO
  caption?: string;
  media_type?: "image" | "video" | "text" | "carousel";
  metrics: Record<string, number>;
};

// ---------- Network fetchers ------------------------------------------------
// Each fetcher returns { profile, posts }. Profile is a compact JSON.

type SC = Record<string, unknown>;

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))
      ? Number(v)
      : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v : undefined;

// --- Instagram -----------------------------------------------------------
export async function scInstagram(handle: string, apiKey?: string) {
  const cleanHandle = handle.replace(/^@/, "").trim();
  const profile = await scFetch<SC>("/v1/instagram/profile", { handle: cleanHandle }, apiKey);
  let posts: SC[] = [];
  try {
    const p = await scFetch<SC>("/v2/instagram/user/posts", { handle: cleanHandle }, apiKey);
    posts = (p.items ?? p.data ?? p.posts ?? []) as SC[];
  } catch (e) {
    console.warn("[sc] instagram posts fallback", e);
  }
  const normalized: NormalizedPost[] = posts.slice(0, 30).map((raw) => {
    const p = raw as SC;
    return {
      external_id: str(p.id) ?? str(p.shortcode) ?? str(p.pk) ?? crypto.randomUUID(),
      url:
        str(p.url) ??
        (str(p.shortcode) ? `https://www.instagram.com/p/${p.shortcode}/` : undefined),
      published_at: toISO(p.taken_at ?? p.timestamp ?? p.created_at),
      caption: extractCaption(p),
      media_type:
        p.media_type === 2 || str(p.media_type) === "video"
          ? "video"
          : Array.isArray(p.carousel_media)
            ? "carousel"
            : "image",
      metrics: pickMetrics(p, {
        likes: ["like_count", "likes"],
        comments: ["comment_count", "comments"],
        views: ["play_count", "video_view_count", "views"],
      }),
    };
  });
  return { profile, posts: normalized };
}

// --- TikTok --------------------------------------------------------------
export async function scTikTok(handle: string, apiKey?: string) {
  const cleanHandle = handle.replace(/^@/, "").trim();
  const profile = await scFetch<SC>("/v1/tiktok/profile", { handle: cleanHandle }, apiKey);
  let items: SC[] = [];
  try {
    const p = await scFetch<SC>("/v3/tiktok/profile/videos", { handle: cleanHandle }, apiKey);
    items = (p.aweme_list ?? p.videos ?? p.items ?? []) as SC[];
  } catch (e) {
    console.warn("[sc] tiktok videos fallback", e);
  }
  const normalized: NormalizedPost[] = items.slice(0, 30).map((raw) => {
    const p = raw as SC;
    const stats = (p.statistics ?? p.stats ?? {}) as SC;
    return {
      external_id: str(p.aweme_id) ?? str(p.id) ?? crypto.randomUUID(),
      url: str(p.share_url) ?? str(p.url),
      published_at: toISO(p.create_time ?? p.createTime),
      caption: str(p.desc) ?? str(p.description),
      media_type: "video",
      metrics: pickMetrics(stats, {
        likes: ["digg_count", "likes"],
        comments: ["comment_count", "comments"],
        shares: ["share_count", "shares"],
        views: ["play_count", "views"],
      }),
    };
  });
  return { profile, posts: normalized };
}

// --- LinkedIn ------------------------------------------------------------
export async function scLinkedIn(input: string, apiKey?: string) {
  // Accept: full URL, "linkedin.com/…", "in/handle", "company/handle", or bare handle.
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) {
    if (/^(in|company|school)\//i.test(url)) url = `https://www.linkedin.com/${url}`;
    else if (/^linkedin\.com/i.test(url)) url = `https://www.${url.replace(/^www\./, "")}`;
    else url = `https://www.linkedin.com/in/${url.replace(/^@/, "")}`;
  }
  const isCompany = /linkedin\.com\/company\//i.test(url);
  const path = isCompany ? "/v1/linkedin/company" : "/v1/linkedin/profile";
  const profile = await scFetch<SC>(path, { url }, apiKey);
  // Personal profile responses use `recentPosts`; company responses vary.
  const raw = ((profile.recentPosts ?? profile.posts ?? profile.recent_posts ?? []) as SC[]).slice(
    0,
    30,
  );
  const normalized: NormalizedPost[] = raw.map((p) => ({
    external_id: str(p.id) ?? str(p.urn) ?? str(p.link) ?? str(p.url) ?? crypto.randomUUID(),
    url: str(p.link) ?? str(p.url) ?? str(p.share_url),
    published_at: toISO(p.datePublished ?? p.posted_at ?? p.published_at ?? p.date),
    caption: str(p.title) ?? str(p.text) ?? str(p.commentary) ?? str(p.description),
    media_type:
      str(p.media_type) === "video" ? "video" : str(p.media_type) === "image" ? "image" : "text",
    metrics: pickMetrics(p, {
      likes: ["likes", "reactions", "num_likes", "numLikes", "reactionsCount"],
      comments: ["comments", "num_comments", "numComments", "commentsCount"],
      shares: ["shares", "reposts", "sharesCount", "repostsCount"],
      views: ["views", "impressions", "viewsCount"],
    }),
  }));
  return {
    profile: { ...profile, recentPosts: undefined, posts: undefined },
    posts: normalized,
    kind: isCompany ? "company" : ("person" as const),
  };
}

// --- X / Twitter ---------------------------------------------------------
export async function scTwitter(handle: string, apiKey?: string) {
  const cleanHandle = handle.replace(/^@/, "").trim();
  const profile = await scFetch<SC>("/v1/twitter/profile", { handle: cleanHandle }, apiKey);
  let items: SC[] = [];
  try {
    const p = await scFetch<SC>("/v1/twitter/user-tweets", { handle: cleanHandle }, apiKey);
    items = (p.tweets ?? p.data ?? p.items ?? []) as SC[];
  } catch (e) {
    console.warn("[sc] twitter tweets fallback", e);
  }
  const normalized: NormalizedPost[] = items.slice(0, 30).map((raw) => {
    const p = raw as SC;
    // ScrapeCreators tweet objects nest metrics under `legacy` and views under `views.count`.
    const legacy = (p.legacy ?? {}) as SC;
    const views = (p.views ?? {}) as SC;
    const idStr = str(legacy.id_str) ?? str(p.rest_id) ?? str(p.id_str) ?? str(p.id);
    return {
      external_id: idStr ?? crypto.randomUUID(),
      url: str(p.url) ?? (idStr ? `https://x.com/${cleanHandle}/status/${idStr}` : undefined),
      published_at: toISO(legacy.created_at ?? p.created_at),
      caption: str(legacy.full_text) ?? str(legacy.text) ?? str(p.full_text) ?? str(p.text),
      media_type: "text",
      metrics: pickMetrics({ ...legacy, view_count: num(views.count) } as SC, {
        likes: ["favorite_count", "likes"],
        comments: ["reply_count", "replies"],
        shares: ["retweet_count", "quote_count", "retweets"],
        views: ["view_count", "views"],
      }),
    };
  });
  return { profile, posts: normalized };
}

// ---------- Helpers ------------------------------------------------------
function toISO(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "number") {
    // seconds vs ms
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
}

function extractCaption(p: SC): string | undefined {
  const c = p.caption;
  if (typeof c === "string") return c;
  if (c && typeof c === "object" && "text" in (c as SC)) return str((c as SC).text);
  return str(p.text) ?? str(p.description);
}

function pickMetrics(src: SC, map: Record<string, string[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, candidates] of Object.entries(map)) {
    for (const c of candidates) {
      const n = num(src[c]);
      if (n !== undefined) {
        out[key] = n;
        break;
      }
    }
  }
  return out;
}

// ---------- Public dispatcher used by server functions -------------------
export type NetworkKey = "instagram" | "tiktok" | "linkedin" | "x";

export async function scanNetwork(
  network: NetworkKey,
  identifier: string,
  apiKey?: string,
): Promise<{ profile: unknown; posts: NormalizedPost[] }> {
  switch (network) {
    case "instagram":
      return scInstagram(identifier, apiKey);
    case "tiktok":
      return scTikTok(identifier, apiKey);
    case "x":
      return scTwitter(identifier, apiKey);
    case "linkedin":
      return scLinkedIn(identifier, apiKey);
  }
}
