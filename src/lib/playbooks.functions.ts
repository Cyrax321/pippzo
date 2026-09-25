import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PlaybookPublic = {
  slug: string;
  name: string;
  description: string;
  body: string;
  defaultBody: string;
  overridden: boolean;
  enabled: boolean;
};

export const listPlaybooks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ playbooks: PlaybookPublic[] }> => {
    const { bundledPlaybooks } = await import("./playbooks.server");
    const base = bundledPlaybooks();
    const { data: rows } = await (context.supabase as any)
      .from("workspace_playbooks")
      .select("slug,body,enabled")
      .eq("workspace_id", data.workspaceId);
    const map = new Map<string, { body: string; enabled: boolean }>(
      ((rows ?? []) as Array<{ slug: string; body: string; enabled: boolean }>).map((r) => [
        r.slug,
        { body: r.body, enabled: r.enabled },
      ]),
    );
    return {
      playbooks: base.map((p) => {
        const o = map.get(p.slug);
        const custom = o?.body?.trim();
        return {
          slug: p.slug,
          name: p.name,
          description: p.description,
          body: custom || p.body,
          defaultBody: p.body,
          overridden: !!custom,
          enabled: o?.enabled !== false,
        };
      }),
    };
  });

export const savePlaybook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        slug: z.string().min(1).max(60),
        body: z.string().max(12000),
        enabled: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { bundledPlaybook } = await import("./playbooks.server");
    if (!bundledPlaybook(data.slug)) throw new Error("Unknown playbook.");
    const { error } = await (context.supabase as any).from("workspace_playbooks").upsert(
      {
        workspace_id: data.workspaceId,
        slug: data.slug,
        body: data.body.trim(),
        enabled: data.enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,slug" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetPlaybook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ workspaceId: z.string().uuid(), slug: z.string().min(1).max(60) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await (context.supabase as any)
      .from("workspace_playbooks")
      .delete()
      .eq("workspace_id", data.workspaceId)
      .eq("slug", data.slug);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
