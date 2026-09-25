import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { VideoProvider, VideoProviderKind } from "./types";

const wsInput = z.object({ workspaceId: z.string().uuid() });
type Row = {
  id: string;
  workspace_id: string;
  provider: string;
  label: string;
  api_key: string;
  api_key_enc: string | null;
  base_url: string | null;
  default_model: string | null;
  created_at: string;
};
const rowToProvider = (r: Row): VideoProvider => ({
  id: r.id,
  provider: r.provider as VideoProviderKind,
  label: r.label,
  // Rows written since encryption landed keep api_key blank and store the
  // secret in api_key_enc — either column counts as "has a key".
  hasKey: !!(r.api_key || r.api_key_enc),
  baseUrl: r.base_url ?? undefined,
  defaultModel: r.default_model ?? undefined,
  createdAt: new Date(r.created_at).getTime(),
});

export const listVideoProviders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspaceId: string }) => wsInput.parse(d))
  .handler(async ({ data, context }): Promise<{ providers: VideoProvider[] }> => {
    const { data: rows, error } = await (context.supabase as any)
      .from("video_providers")
      .select("*")
      .eq("workspace_id", data.workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { providers: (rows as Row[]).map(rowToProvider) };
  });

export const saveVideoProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        provider: z.enum(["veo", "gemini-omni", "seedance", "kling", "runway", "luma", "custom"]),
        label: z.string().min(1).max(100),
        apiKey: z.string().min(4).max(500),
        baseUrl: z.string().url().optional().or(z.literal("")),
        defaultModel: z.string().max(120).optional().or(z.literal("")),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<VideoProvider> => {
    // Encrypt at rest: writeProviderKey stores the secret in api_key_enc and
    // blanks the legacy plaintext column (unless no secret is configured).
    const { writeProviderKey } = await import("./crypto.server");
    const keyCols = await writeProviderKey(data.apiKey);
    const { data: row, error } = await (context.supabase as any)
      .from("video_providers")
      .insert({
        workspace_id: data.workspaceId,
        provider: data.provider,
        label: data.label,
        ...keyCols,
        base_url: data.baseUrl || null,
        default_model: data.defaultModel || null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return rowToProvider(row as Row);
  });

export const deleteVideoProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await (context.supabase as any)
      .from("video_providers")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
