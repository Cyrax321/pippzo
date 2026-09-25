// Per-workspace credentials for non-LLM data services (Firecrawl,
// ScrapeCreators). Falls back to the shared platform secret when the
// workspace has not connected its own key. Server-only.

import { readProviderKey } from "./crypto.server";

export type ServiceName = "firecrawl" | "scrapecreators";

type Client = { from: (t: string) => any };

const PLATFORM_ENV: Record<ServiceName, string> = {
  firecrawl: "FIRECRAWL_API_KEY",
  scrapecreators: "SCRAPECREATORS_API_KEY",
};

const LABEL: Record<ServiceName, string> = {
  firecrawl: "Firecrawl",
  scrapecreators: "ScrapeCreators",
};

/**
 * Workspace key first, shared platform key second.
 * Returns null when neither is available.
 */
export async function resolveServiceKey(
  client: Client | null,
  workspaceId: string | null,
  service: ServiceName,
): Promise<string | null> {
  if (client && workspaceId) {
    try {
      const { data } = await client
        .from("service_credentials")
        .select("api_key,api_key_enc")
        .eq("workspace_id", workspaceId)
        .eq("service", service)
        .maybeSingle();
      if (data) {
        const key = await readProviderKey(data as { api_key?: string; api_key_enc?: string });
        if (key) return key;
      }
    } catch (e) {
      console.warn(
        `[service-credentials] ${service} lookup failed`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return process.env[PLATFORM_ENV[service]] ?? null;
}

export async function requireServiceKey(
  client: Client | null,
  workspaceId: string | null,
  service: ServiceName,
): Promise<string> {
  const key = await resolveServiceKey(client, workspaceId, service);
  if (!key) {
    throw new Error(
      `${LABEL[service]} is not connected. Add your own ${LABEL[service]} API key in Settings → Connections.`,
    );
  }
  return key;
}
