import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Runs an outcome-based review of Buffer performance and saves what it learns. */
export const learnFromPerformance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ workspaceId: z.string().uuid(), days: z.number().int().min(7).max(365).optional() })
      .parse(d),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: boolean; summary?: string; learned: number; reason?: string }> => {
      // Same cap gate as every other AI path; UsageCapError's message is user-facing.
      const { assertWithinCap } = await import("./usage-caps.server");
      await assertWithinCap(context.supabase as never, data.workspaceId);
      const { reflectOnPerformance } = await import("./performance-reflection.server");
      return reflectOnPerformance(context.supabase as any, data.workspaceId, data.days ?? 90);
    },
  );

export const updateLearning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        content: z.string().min(4).max(600).optional(),
        weight: z.number().min(0).max(5).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const patch: Record<string, unknown> = {};
    if (data.content !== undefined) patch.content = data.content;
    if (data.weight !== undefined) patch.weight = data.weight;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await (context.supabase as any)
      .from("agent_memory")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteLearning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await (context.supabase as any)
      .from("agent_memory")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
