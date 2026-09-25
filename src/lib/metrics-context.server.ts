// Own-account performance context derived from `post_metrics`.
// Server-only. Callers pass a Supabase client (authenticated user or admin).

import { FALLBACK_TIMEZONE, loadWorkspaceTimezone } from "./workspace-context.server";

type Client = { from: (t: string) => any };

export type MetricRow = {
  buffer_post_id: string;
  text: string;
  service: string | null;
  channel_id: string | null;
  media_type: string | null;
  media_url: string | null;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  engagement_rate: number;
  sent_at: string | null;
};

const SELECT =
  "buffer_post_id,text,service,channel_id,media_type,media_url,impressions,reach,likes,comments,shares,clicks,engagement_rate,sent_at";

const DAY = 86400000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The server runs in UTC, so bare getHours()/getDay() shifted every timing
// bucket by the offset (and by DST, off-by-one across midnight). Bucket in the
// workspace's own timezone instead, and say so in the labels — an hour-of-day
// number without its zone is not an insight, it is a guess.
//
// The zone used to be a module constant and the two formatters were built once
// at module load. It is a workspace setting now, so that is no longer possible.
// The obvious rewrite — build a formatter inside the bucketing function — would
// be a real regression: constructing an Intl.DateTimeFormat is the expensive
// part (locale resolution plus loading the zone), while format() on an existing
// one is cheap, and the bucketer is called once per metric row, twice over
// (hour and weekday), across up to 500 rows per digest. So formatters are built
// once per zone and cached for the life of the process. The key space is the
// IANA zone list, and in practice one entry per workspace this process serves,
// so a server handling N workspaces pays N constructions in total rather than
// N x rows x 2.
type Zoned = {
  /** The zone actually used — what the labels must say. */
  zone: string;
  hour: (d: Date) => number;
  weekday: (d: Date) => number;
};
const zoneCache = new Map<string, Zoned>();

/**
 * Resolves a zone name to its cached bucketers. Validity is decided by whether
 * the formatters can be built, and the answer — good or bad — is cached under
 * the requested name, so even a zone this runtime cannot load costs one failed
 * construction for the life of the process rather than one per call.
 */
function zoned(tz: string | null | undefined): Zoned {
  const key = tz?.trim() || FALLBACK_TIMEZONE;
  const cached = zoneCache.get(key);
  if (cached) return cached;
  let made: Zoned;
  try {
    const hourFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: key,
      hour: "numeric",
      hour12: false,
    });
    const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: key, weekday: "long" });
    made = {
      zone: key,
      hour: (d) => Number(hourFmt.format(d)) % 24, // "24" at midnight → 0
      weekday: (d) => WEEKDAYS.indexOf(weekdayFmt.format(d)),
    };
  } catch {
    // A name Postgres accepted that this ICU build cannot load. Degrade to the
    // fallback — and label it as the fallback, so the output never claims a
    // zone it did not use. FALLBACK_TIMEZONE always resolves, so this recurses
    // exactly once.
    made = zoned(FALLBACK_TIMEZONE);
  }
  zoneCache.set(key, made);
  return made;
}

/** Hour of day (0-23) at which an instant fell, in the given zone. */
export const hourInZone = (d: Date, tz: string): number => zoned(tz).hour(d);
/** Day of week (0 = Sunday) on which an instant fell, in the given zone. */
export const weekdayInZone = (d: Date, tz: string): number => zoned(tz).weekday(d);

export const channelKey = (r: { service: string | null; channel_id: string | null }) =>
  (r.service ?? r.channel_id ?? "unknown").toLowerCase();

const round = (n: number, d = 2) => Number(n.toFixed(d));
const engagements = (r: MetricRow) => r.likes + r.comments + r.shares + r.clicks;
const excerpt = (t: string, n = 220) => t.replace(/\s+/g, " ").trim().slice(0, n);

/** Loads rows for a workspace, optionally filtered by recency and channel. */
export async function loadMetrics(
  client: Client,
  workspaceId: string,
  opts: { days?: number; channel?: string; limit?: number } = {},
): Promise<MetricRow[]> {
  let q = client
    .from("post_metrics")
    .select(SELECT)
    .eq("workspace_id", workspaceId)
    .order("sent_at", { ascending: false })
    .limit(Math.min(500, opts.limit ?? 300));
  if (opts.days && opts.days > 0) {
    q = q.gte("sent_at", new Date(Date.now() - opts.days * DAY).toISOString());
  }
  const { data, error } = await q;
  if (error || !data) return [];
  const rows = data as MetricRow[];
  const channel = opts.channel?.trim().toLowerCase();
  if (!channel || channel === "all") return rows;
  return rows.filter((r) => channelKey(r) === channel);
}

export type ChannelStats = {
  channel: string;
  posts: number;
  impressions: number;
  reach: number;
  engagements: number;
  avgEngagementRate: number;
  bestEngagementRate: number;
};

/**
 * `tz` is the workspace timezone; every hour-of-day and day-of-week bucket below
 * is computed in it. It is optional so that callers with no workspace context
 * still compile, but a caller that has one should always pass it — the default
 * is the historical Madrid assumption, which is wrong for most audiences.
 */
export function summarize(rows: MetricRow[], tz: string = FALLBACK_TIMEZONE) {
  const clock = zoned(tz);
  const zone = clock.zone;
  const byChannel = new Map<string, MetricRow[]>();
  for (const r of rows) {
    const k = channelKey(r);
    const list = byChannel.get(k);
    if (list) list.push(r);
    else byChannel.set(k, [r]);
  }

  const channels: ChannelStats[] = Array.from(byChannel.entries())
    .map(([channel, list]) => ({
      channel,
      posts: list.length,
      impressions: list.reduce((s, r) => s + r.impressions, 0),
      reach: list.reduce((s, r) => s + r.reach, 0),
      engagements: list.reduce((s, r) => s + engagements(r), 0),
      avgEngagementRate: round(list.reduce((s, r) => s + r.engagement_rate, 0) / list.length),
      bestEngagementRate: round(Math.max(...list.map((r) => r.engagement_rate))),
    }))
    .sort((a, b) => b.posts - a.posts);

  return {
    posts: rows.length,
    impressions: rows.reduce((s, r) => s + r.impressions, 0),
    engagements: rows.reduce((s, r) => s + engagements(r), 0),
    avgEngagementRate: rows.length
      ? round(rows.reduce((s, r) => s + r.engagement_rate, 0) / rows.length)
      : 0,
    channels,
    timezone: zone,
    ...timingInsights(rows, clock),
    ...formatInsights(rows),
  };
}

/** Best posting hour / weekday by average engagement rate (needs >= 2 samples). */
function timingInsights(rows: MetricRow[], clock: Zoned) {
  const { zone, hour: tzHour, weekday: tzWeekday } = clock;
  const dated = rows.filter((r) => r.sent_at);
  if (dated.length < 4)
    return { bestHour: null as string | null, bestWeekday: null as string | null };
  const agg = (keyFn: (d: Date) => number) => {
    const map = new Map<number, { sum: number; n: number }>();
    for (const r of dated) {
      const k = keyFn(new Date(r.sent_at as string));
      const cur = map.get(k) ?? { sum: 0, n: 0 };
      map.set(k, { sum: cur.sum + r.engagement_rate, n: cur.n + 1 });
    }
    return Array.from(map.entries())
      .filter(([, v]) => v.n >= 2)
      .map(([k, v]) => ({ k, avg: v.sum / v.n, n: v.n }))
      .sort((a, b) => b.avg - a.avg)[0];
  };
  const hour = agg(tzHour);
  const weekday = agg(tzWeekday);
  return {
    bestHour: hour
      ? `${String(hour.k).padStart(2, "0")}:00 ${zone} (avg ER ${round(hour.avg)}%, ${hour.n} posts)`
      : null,
    bestWeekday: weekday
      ? `${WEEKDAYS[weekday.k]} (${zone}; avg ER ${round(weekday.avg)}%, ${weekday.n} posts)`
      : null,
  };
}

/** Average engagement rate per media type and per caption-length bucket. */
function formatInsights(rows: MetricRow[]) {
  const bucketOf = (r: MetricRow) => {
    const len = r.text.length;
    if (len < 200) return "short (<200 chars)";
    if (len < 700) return "medium (200-700)";
    return "long (700+)";
  };
  const group = (keyFn: (r: MetricRow) => string) => {
    const map = new Map<string, { sum: number; n: number }>();
    for (const r of rows) {
      const k = keyFn(r);
      const cur = map.get(k) ?? { sum: 0, n: 0 };
      map.set(k, { sum: cur.sum + r.engagement_rate, n: cur.n + 1 });
    }
    return Array.from(map.entries())
      .map(([key, v]) => ({ key, posts: v.n, avgEngagementRate: round(v.sum / v.n) }))
      .sort((a, b) => b.avgEngagementRate - a.avgEngagementRate);
  };
  return {
    byMediaType: group((r) => r.media_type || "text"),
    byLength: group(bucketOf),
  };
}

export function toPostSummary(r: MetricRow) {
  return {
    id: r.buffer_post_id,
    channel: channelKey(r),
    mediaType: r.media_type || "text",
    sentAt: r.sent_at,
    engagementRate: r.engagement_rate,
    impressions: r.impressions,
    likes: r.likes,
    comments: r.comments,
    shares: r.shares,
    text: excerpt(r.text),
  };
}

export function rankPosts(rows: MetricRow[], limit: number, worst: boolean) {
  const sorted = [...rows].sort((a, b) => a.engagement_rate - b.engagement_rate);
  const slice = worst ? sorted.slice(0, limit) : sorted.slice(-limit).reverse();
  return slice.map(toPostSummary);
}

/** Positions a draft against historical averages (length, media, channel). */
export function compareDraft(
  rows: MetricRow[],
  draft: string,
  channel?: string,
  tz: string = FALLBACK_TIMEZONE,
) {
  const scoped =
    channel && channel !== "all" ? rows.filter((r) => channelKey(r) === channel) : rows;
  if (scoped.length === 0) return { enoughData: false as const };
  const s = summarize(scoped, tz);
  const len = draft.trim().length;
  const bucket = len < 200 ? "short (<200 chars)" : len < 700 ? "medium (200-700)" : "long (700+)";
  const bucketStats = s.byLength.find((b) => b.key === bucket) ?? null;
  const best = s.byLength[0] ?? null;
  const withHashtags = /#\w/.test(draft);
  const withQuestion = /\?/.test(draft);
  return {
    enoughData: true as const,
    draftLength: len,
    lengthBucket: bucket,
    lengthBucketAvgEngagementRate: bucketStats?.avgEngagementRate ?? null,
    bestLengthBucket: best ? { bucket: best.key, avgEngagementRate: best.avgEngagementRate } : null,
    accountAvgEngagementRate: s.avgEngagementRate,
    bestMediaType: s.byMediaType[0] ?? null,
    timezone: s.timezone,
    bestHour: s.bestHour,
    bestWeekday: s.bestWeekday,
    draftHasHashtags: withHashtags,
    draftHasQuestion: withQuestion,
    reference: rankPosts(scoped, 3, false),
  };
}

/**
 * Compact digest injected into every chat turn so the agent is grounded in real
 * numbers even when it does not call a tool.
 */
export async function loadPerformanceDigest(
  client: Client,
  workspaceId: string,
  days = 30,
  tz?: string,
): Promise<string> {
  // The caller usually already knows the workspace zone (the chat handler reads
  // the settings row anyway) — pass it in and skip the extra read. Loading it
  // here is the fallback so no caller can accidentally produce Madrid buckets.
  const zone = zoned(tz ?? (await loadWorkspaceTimezone(client, workspaceId))).zone;
  let rows = await loadMetrics(client, workspaceId, { days });
  let windowLabel = `last ${days} days`;
  if (rows.length === 0) {
    rows = await loadMetrics(client, workspaceId, { limit: 60 });
    windowLabel = "all time (nothing sent in the last 30 days)";
  }
  if (rows.length === 0) {
    return 'PERFORMANCE DATA: none yet. Tell the user to hit "Sync performance" on the Reports page so you can learn from real numbers.';
  }
  const s = summarize(rows, zone);
  const line = (p: ReturnType<typeof toPostSummary>) =>
    `- [${p.channel}/${p.mediaType}] ER ${p.engagementRate}% · ${p.impressions} impressions · ${p.likes}L/${p.comments}C/${p.shares}S — "${p.text.slice(0, 140)}"`;
  const parts = [
    `PERFORMANCE (${windowLabel}, ${s.posts} sent posts, avg ER ${s.avgEngagementRate}%; timing buckets in ${zone})`,
    `Per channel: ${s.channels.map((c) => `${c.channel} ${c.posts} posts, avg ER ${c.avgEngagementRate}%`).join(" | ")}`,
  ];
  if (s.bestHour) parts.push(`Best hour: ${s.bestHour}. Best weekday: ${s.bestWeekday ?? "n/a"}.`);
  if (s.byMediaType.length)
    parts.push(
      `By format: ${s.byMediaType.map((m) => `${m.key} ${m.avgEngagementRate}%`).join(" | ")}`,
    );
  parts.push(`Top posts:\n${rankPosts(rows, 3, false).map(line).join("\n")}`);
  if (rows.length > 4)
    parts.push(
      `Weakest posts (avoid these patterns):\n${rankPosts(rows, 3, true).map(line).join("\n")}`,
    );
  parts.push(
    "Use these numbers when the user asks what works. For deeper slices call `getPerformanceSummary`, `getTopPosts` or `comparePost`.",
  );
  return parts.join("\n");
}
