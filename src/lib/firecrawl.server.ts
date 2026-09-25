// Firecrawl helper (server-only). Uses direct REST API with FIRECRAWL_API_KEY.
import { fetchWithTimeout, FETCH_TIMEOUT } from "@/lib/fetch-timeout";

type ScrapeFormat = "markdown" | "html" | "links" | "summary";

export async function firecrawlScrape(
  url: string,
  opts?: { formats?: ScrapeFormat[]; onlyMainContent?: boolean; apiKey?: string },
) {
  const key = opts?.apiKey?.trim() || process.env.FIRECRAWL_API_KEY;
  if (!key)
    throw new Error(
      "Firecrawl is not connected. Add your own Firecrawl API key in Settings → Connections.",
    );
  const res = await fetchWithTimeout(
    "https://api.firecrawl.dev/v2/scrape",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: opts?.formats ?? ["markdown"],
        onlyMainContent: opts?.onlyMainContent ?? true,
      }),
    },
    { timeoutMs: FETCH_TIMEOUT.api, label: "Firecrawl" },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    success: boolean;
    data?: {
      markdown?: string;
      html?: string;
      links?: string[];
      summary?: string;
      metadata?: Record<string, unknown>;
    };
    error?: string;
  };
  if (!json.success) throw new Error(json.error ?? "Firecrawl falló");
  return json.data ?? {};
}
