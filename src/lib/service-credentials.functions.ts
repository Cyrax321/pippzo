import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ServiceNamePublic = "firecrawl" | "scrapecreators";

export type ServiceCredentialPublic = {
  id: string;
  service: ServiceNamePublic;
  label: string;
  hasKey: boolean;
  createdAt: number;
};

type Row = {
  id: string;
  service: string;
  label: string;
  api_key: string | null;
  api_key_enc: string | null;
  created_at: string;
};

const toPublic = (r: Row): ServiceCredentialPublic => ({
  id: r.id,
  service: r.service as ServiceNamePublic,
  label: r.label,
  hasKey: !!(r.api_key || r.api_key_enc),
  createdAt: new Date(r.created_at).getTime(),
});

const ServiceEnum = z.enum(["firecrawl", "scrapecreators"]);

export const listServiceCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ credentials: ServiceCredentialPublic[] }> => {
    const { data: rows, error } = await (context.supabase as any)
      .from("service_credentials")
      .select("*")
      .eq("workspace_id", data.workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { credentials: ((rows ?? []) as Row[]).map(toPublic) };
  });

export const saveServiceCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        service: ServiceEnum,
        label: z.string().min(1).max(100),
        apiKey: z.string().min(8).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ServiceCredentialPublic> => {
    const supabase = context.supabase as any;
    const { writeProviderKey } = await import("./crypto.server");
    const keyCols = await writeProviderKey(data.apiKey);

    // One credential per service per workspace.
    await supabase
      .from("service_credentials")
      .delete()
      .eq("workspace_id", data.workspaceId)
      .eq("service", data.service);

    const { data: row, error } = await supabase
      .from("service_credentials")
      .insert({
        workspace_id: data.workspaceId,
        service: data.service,
        label: data.label,
        ...keyCols,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return toPublic(row as Row);
  });

export const deleteServiceCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await (context.supabase as any)
      .from("service_credentials")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testServiceCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ workspaceId: z.string().uuid(), service: ServiceEnum }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    try {
      const { requireServiceKey } = await import("./service-credentials.server");
      const key = await requireServiceKey(
        context.supabase as never,
        data.workspaceId,
        data.service,
      );
      if (data.service === "firecrawl") {
        const { firecrawlWebSearch } = await import("./websearch.server");
        await firecrawlWebSearch({ query: "hello world", limit: 1, recency: "any", apiKey: key });
        return { ok: true };
      }
      // A person is sitting in Settings waiting on this, so it gets the plain
      // api deadline rather than being allowed to hang. Verifying a key is a
      // read with no side effects, so giving up early costs nothing.
      const { fetchWithTimeout, FETCH_TIMEOUT } = await import("./fetch-timeout");
      const res = await fetchWithTimeout(
        "https://api.scrapecreators.com/v1/twitter/profile?handle=x",
        { headers: { "x-api-key": key, accept: "application/json" } },
        { timeoutMs: FETCH_TIMEOUT.api, label: "ScrapeCreators" },
      );
      if (res.status === 401 || res.status === 403)
        return { ok: false, error: "Key rejected by ScrapeCreators." };
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return { ok: false, error: msg.slice(0, 200) };
    }
  });
