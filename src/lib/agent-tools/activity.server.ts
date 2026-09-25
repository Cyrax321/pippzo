// Activity log reading for the chat agent (server-only).
type Client = { from: (t: string) => any };

export async function readActivityLogForAgent(
  db: Client,
  workspaceId: string,
  args: {
    limit?: number;
    actorType?: string;
    status?: "ok" | "error" | "all";
    action?: string;
    days?: number;
  } = {},
) {
  const days = Math.min(args.days ?? 14, 180);
  let q = db
    .from("activity_log")
    .select("created_at,actor_type,action,summary,status,error,related_type,related_id")
    .eq("workspace_id", workspaceId)
    .gte("created_at", new Date(Date.now() - days * 86400000).toISOString())
    .order("created_at", { ascending: false })
    .limit(Math.min(args.limit ?? 25, 100));
  if (args.actorType && args.actorType !== "all") q = q.eq("actor_type", args.actorType);
  if (args.status && args.status !== "all") q = q.eq("status", args.status);
  if (args.action?.trim()) q = q.ilike("action", `${args.action.trim()}%`);
  const { data, error } = await q;
  if (error) return { ok: false as const, error: "Could not read the activity log." };
  const rows = data ?? [];
  return {
    ok: true as const,
    window: `${days} days`,
    count: rows.length,
    errors: rows.filter((r: { status: string }) => r.status === "error").length,
    entries: rows,
  };
}
