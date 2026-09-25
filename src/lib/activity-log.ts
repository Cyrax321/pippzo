// Activity log helper — writes to Supabase `activity_log`.
// Can be called from the browser (RLS enforces workspace membership) or
// from server code by passing a Supabase client explicitly.
import { supabase as browserClient } from "@/integrations/supabase/client";

export type ActorType = "user" | "agent" | "cron" | "system";
export type LogStatus = "ok" | "error" | "warning";

export type LogInput = {
  workspaceId: string;
  actorType?: ActorType;
  actorId?: string | null;
  action: string; // dot.notation, e.g. 'post.scheduled', 'buffer.published'
  summary: string; // human sentence for the log view
  status?: LogStatus;
  error?: string | null;
  details?: Record<string, unknown>;
  relatedType?: string | null;
  relatedId?: string | null;
};

type MinimalClient = {
  from: (t: string) => { insert: (row: Record<string, unknown>) => Promise<{ error: unknown }> };
};

export async function logActivity(input: LogInput, client?: MinimalClient) {
  const c = (client ?? browserClient) as unknown as MinimalClient;
  try {
    const { error } = await c.from("activity_log").insert({
      workspace_id: input.workspaceId,
      actor_type: input.actorType ?? "user",
      actor_id: input.actorId ?? null,
      action: input.action,
      summary: input.summary,
      status: input.status ?? "ok",
      error: input.error ?? null,
      details: input.details ?? {},
      related_type: input.relatedType ?? null,
      related_id: input.relatedId ?? null,
    });
    if (error) console.warn("[activity-log]", (error as { message?: string }).message ?? error);
  } catch (e) {
    console.warn("[activity-log] threw", e);
  }
}

// Fire-and-forget wrapper that never awaits, for hot paths.
export function logActivityFn(input: LogInput) {
  void logActivity(input);
}
