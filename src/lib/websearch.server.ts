// Firecrawl-backed web search helper (server-only).
// Returns compact results with title, url, snippet, and (when available) a published date.

import { fetchWithTimeout, FETCH_TIMEOUT } from "@/lib/fetch-timeout";

export type WebSearchRecency = "day" | "week" | "month" | "year" | "any";

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  date?: string;
};

const RECENCY_TO_TBS: Record<Exclude<WebSearchRecency, "any">, string> = {
  day: "qdr:d",
  week: "qdr:w",
  month: "qdr:m",
  year: "qdr:y",
};

type FirecrawlWebItem = {
  url?: string;
  title?: string;
  description?: string;
  markdown?: string;
  metadata?: { publishedDate?: string; published_time?: string; date?: string } | null;
};

type FirecrawlSearchResponse = {
  success?: boolean;
  data?: { web?: FirecrawlWebItem[] } | FirecrawlWebItem[];
  error?: string;
};

function firstString(...vals: Array<string | undefined | null>) {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

function normalize(item: FirecrawlWebItem): WebSearchResult | null {
  const url = firstString(item.url);
  if (!url) return null;
  const title = firstString(item.title) ?? url;
  const raw = firstString(item.description, item.markdown) ?? "";
  const snippet = raw.replace(/\s+/g, " ").trim().slice(0, 500);
  const date = firstString(
    item.metadata?.publishedDate,
    item.metadata?.published_time,
    item.metadata?.date,
  );
  return { title, url, snippet, date };
}

export async function firecrawlWebSearch(opts: {
  query: string;
  limit?: number;
  recency?: WebSearchRecency;
  apiKey?: string;
}): Promise<{ results: WebSearchResult[] }> {
  const key = opts.apiKey?.trim() || process.env.FIRECRAWL_API_KEY;
  if (!key)
    throw new Error(
      "Firecrawl is not connected. Add your own Firecrawl API key in Settings → Connections.",
    );

  const query = opts.query.trim();
  if (!query) return { results: [] };
  const limit = Math.max(1, Math.min(opts.limit ?? 6, 10));
  const recency = opts.recency ?? "week";

  const body: Record<string, unknown> = {
    query,
    limit,
    scrapeOptions: { formats: ["markdown"] },
  };
  if (recency !== "any") body.tbs = RECENCY_TO_TBS[recency];

  const res = await fetchWithTimeout(
    "https://api.firecrawl.dev/v2/search",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { timeoutMs: FETCH_TIMEOUT.api, label: "Firecrawl search" },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl search ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as FirecrawlSearchResponse;
  if (json.success === false) throw new Error(json.error ?? "Firecrawl search failed");

  const items: FirecrawlWebItem[] = Array.isArray(json.data) ? json.data : (json.data?.web ?? []);
  const results = items
    .map(normalize)
    .filter((r): r is WebSearchResult => !!r)
    .slice(0, limit);
  return { results };
}
