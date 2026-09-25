// Monthly AI usage caps.
// Token spend is already recorded in activity_log (action = 'ai.usage') by
// logAiUsage, so the cap is derived from that same source — no extra table.
// A cap of 0 means unlimited.

type Client = {
  from: (t: string) => any;
  rpc?: (fn: string, args?: Record<string, unknown>) => any;
};

export class UsageCapError extends Error {
  used: number;
  cap: number;
  constructor(used: number, cap: number) {
    super(
      `Monthly AI usage cap reached (${used.toLocaleString("en-US")} / ${cap.toLocaleString("en-US")} tokens). ` +
        `Raise or remove the cap in the Automations page (/automations).`,
    );
    this.name = "UsageCapError";
    this.used = used;
    this.cap = cap;
  }
}

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export type UsageSnapshot = {
  used: number;
  cap: number;
  exceeded: boolean;
  remaining: number | null;
  periodStart: string;
};

export async function getMonthlyUsage(client: Client, workspaceId: string): Promise<UsageSnapshot> {
  const since = monthStart().toISOString();
  const { data: ws } = await client
    .from("workspaces")
    .select("monthly_token_cap")
    .eq("id", workspaceId)
    .maybeSingle();
  const cap = Number((ws as { monthly_token_cap?: number } | null)?.monthly_token_cap ?? 0) || 0;

  // Sum in the database. The old approach fetched up to 5000 activity_log rows
  // and summed client-side — busy months past that limit silently under-counted
  // and stopped enforcing the cap.
  let used: number | null = null;
  if (typeof client.rpc === "function") {
    const { data, error } = await client.rpc("ai_usage_month_total", { ws: workspaceId });
    if (!error && data !== null && data !== undefined) used = Number(data) || 0;
  }

  if (used === null) {
    // Fallback (RPC missing or errored, e.g. migration not applied yet).
    //
    // This used to be a single `.limit(5000)` fetch summed client-side, which
    // silently under-counted past 1000 qualifying rows because PostgREST's own
    // `max_rows = 1000` (supabase/config.toml) caps every request regardless
    // of what is asked for (docs/bugs.md finding 19) — a busy workspace could
    // keep spending past its cap without this ever noticing. We cannot add a
    // migration here, so instead of trusting one capped request, page through
    // in 1000-row slices (the real per-request ceiling) until a short page
    // proves nothing is left, making the sum genuinely complete rather than
    // truncated. `MAX_PAGES` is a safety valve, not the intended bound: it
    // only bites if a single workspace logged 50,000+ qualifying rows in one
    // month, and hitting it is logged loudly rather than silently swallowed.
    const PAGE_SIZE = 1000;
    const MAX_PAGES = 50;
    used = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data: rows, error } = await client
        .from("activity_log")
        .select("details")
        .eq("workspace_id", workspaceId)
        .eq("action", "ai.usage")
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) break;
      const batch = (rows ?? []) as Array<{ details: { totalTokens?: number } | null }>;
      used += batch.reduce((sum, r) => sum + (Number(r.details?.totalTokens) || 0), 0);
      if (batch.length < PAGE_SIZE) break;
      if (page === MAX_PAGES - 1) {
        console.warn(
          `[usage-caps] fallback sum hit its ${MAX_PAGES * PAGE_SIZE}-row safety ceiling for workspace ${workspaceId}; usage may be under-counted this month`,
        );
      }
    }
  }

  return {
    used,
    cap,
    exceeded: cap > 0 && used >= cap,
    remaining: cap > 0 ? Math.max(0, cap - used) : null,
    periodStart: since,
  };
}

/** Throws UsageCapError when the workspace is over its monthly token cap. */
export async function assertWithinCap(client: Client, workspaceId: string): Promise<void> {
  let snap: UsageSnapshot;
  try {
    snap = await getMonthlyUsage(client, workspaceId);
  } catch (e) {
    // Never block work because the meter itself failed.
    console.warn("[usage-caps] check failed", e instanceof Error ? e.message : e);
    return;
  }
  if (snap.exceeded) throw new UsageCapError(snap.used, snap.cap);
}
