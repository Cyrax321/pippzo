// Read-only workspace lookups exposed to the chat agent so it can actually
// open what the user already has saved (competitor reports, automations)
// instead of guessing from the snapshot injected in the system prompt.

type Client = { from: (t: string) => any };

/**
 * Last-resort zone, used only when the workspace row cannot be read at all (no
 * workspace context, an RLS denial, a stored value this runtime cannot load).
 * It is the same value as the column default in migration 20260914120000, which
 * is in turn what the code hard-coded before the setting existed — so a
 * workspace that never touches the setting behaves exactly as it did.
 */
export const FALLBACK_TIMEZONE = "Europe/Madrid";

/**
 * Whether this runtime can actually build a formatter for a zone name. The
 * database trigger `workspaces_validate_timezone` already rejects typos at
 * write time against `pg_timezone_names`, so this only catches the narrow case
 * of a name Postgres knows and the JS ICU build does not. Worth checking once,
 * because an unusable zone throws inside `Intl` and would otherwise take out a
 * whole analytics digest or a system prompt.
 */
export function isUsableTimezone(tz: string | null | undefined): tz is string {
  if (!tz?.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * The workspace's IANA timezone: the agent's sense of "today", the wall-clock a
 * cron job falls back to, and the buckets behind every timing insight.
 * Never throws — a workspace that cannot be read is worth degrading for, not
 * failing a chat turn over.
 */
export async function loadWorkspaceTimezone(db: Client, workspaceId: string): Promise<string> {
  try {
    const { data } = await db
      .from("workspaces")
      .select("timezone")
      .eq("id", workspaceId)
      .maybeSingle();
    const tz = (data as { timezone?: string | null } | null)?.timezone;
    return isUsableTimezone(tz) ? tz.trim() : FALLBACK_TIMEZONE;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

const s = (v: unknown, n = 400) => {
  const t = typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// Both creation paths write scan handles to `handles` while `socials` is often
// left empty, so channel info must be read handles-first with socials as the
// fallback for legacy rows.
const mergedHandles = (c: {
  socials?: Record<string, string> | null;
  handles?: Record<string, string> | null;
}) => {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.socials ?? {})) if (v) merged[k] = v;
  for (const [k, v] of Object.entries(c.handles ?? {})) if (v) merged[k] = v;
  return merged;
};

export async function listCompetitorsForAgent(db: Client, workspaceId: string) {
  const { data, error } = await db
    .from("competitors")
    .select("id,name,website,socials,handles,snapshot,created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { ok: false as const, error: error.message };
  const competitors = (data ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    website: c.website ?? null,
    channels: Object.entries(mergedHandles(c)).map(([k, v]) => `${k}: ${v}`),
    hasAnalysis: !!c.snapshot,
    scannedAt: c.snapshot?.scannedAt ? new Date(c.snapshot.scannedAt).toISOString() : null,
    headline: c.snapshot?.subtitle || c.snapshot?.dek || s(c.snapshot?.tone, 160) || null,
  }));
  return { ok: true as const, count: competitors.length, competitors };
}

export async function getCompetitorAnalysisForAgent(
  db: Client,
  workspaceId: string,
  args: { competitorId?: string; name?: string },
) {
  let q = db
    .from("competitors")
    .select("id,name,website,socials,handles,snapshot")
    .eq("workspace_id", workspaceId)
    .limit(1);
  if (args.competitorId) q = q.eq("id", args.competitorId);
  else if (args.name) q = q.ilike("name", `%${args.name}%`);
  const { data, error } = await q;
  if (error) return { ok: false as const, error: error.message };
  const c = (data ?? [])[0];
  if (!c)
    return {
      ok: false as const,
      error: "No saved competitor matched. Call listCompetitors first.",
    };
  const snap = c.snapshot as any;
  if (!snap)
    return {
      ok: false as const,
      error: `"${c.name}" exists but has no saved analysis yet. Run analyzeCompetitor to create one.`,
    };
  return {
    ok: true as const,
    id: c.id,
    name: c.name,
    website: c.website ?? null,
    socials: mergedHandles(c),
    scannedAt: snap.scannedAt ? new Date(snap.scannedAt).toISOString() : null,
    analysis: {
      subtitle: snap.subtitle ?? null,
      dek: snap.dek ?? null,
      profileNote: s(snap.profileNote, 800),
      postingFrequency: snap.postingFrequency ?? null,
      tone: snap.tone ?? null,
      estimatedAudience: snap.estimatedAudience ?? null,
      dominantFormats: snap.dominantFormats ?? [],
      recurringThemes: snap.recurringThemes ?? [],
      recentPosts: (snap.recentPosts ?? []).slice(0, 8).map((p: string) => s(p, 300)),
      strengths: snap.strengths ?? [],
      weaknesses: snap.weaknesses ?? [],
      opportunitiesForUs: snap.opportunitiesForUs ?? [],
      stats: snap.stats ?? [],
      positioning: snap.positioning ?? [],
      contentStrategy: snap.contentStrategy ?? null,
      strengthsDetailed: snap.strengthsDetailed ?? [],
      vulnerabilities: snap.vulnerabilities ?? [],
      keyTakeaways: snap.keyTakeaways ?? [],
      activityLog: (snap.activityLog ?? []).slice(0, 12),
      networks: snap.networks ?? null,
    },
  };
}

export async function listAutomationsForAgent(db: Client, workspaceId: string) {
  const [workspaceTz, { data: jobs, error }, { data: runs }] = await Promise.all([
    loadWorkspaceTimezone(db, workspaceId),
    db
      .from("cron_jobs")
      .select("id,name,task_type,enabled,schedule,next_run_at,last_run_at,config")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .limit(50),
    db
      .from("cron_runs")
      .select("job_id,status,started_at,result,error")
      .eq("workspace_id", workspaceId)
      .order("started_at", { ascending: false })
      .limit(20),
  ]);
  if (error) return { ok: false as const, error: error.message };
  const lastByJob = new Map<string, any>();
  for (const r of runs ?? []) if (!lastByJob.has(r.job_id)) lastByJob.set(r.job_id, r);
  const automations = (jobs ?? []).map((j: any) => {
    const last = lastByJob.get(j.id);
    // The cron string is wall-clock in the job's own zone; surfacing the zone
    // and a localized next-run keeps the agent from reporting Madrid times for
    // a Sydney schedule. An explicit per-job zone always wins; only a job that
    // never set one falls back to the workspace setting.
    const timezone = (j.config as { timezone?: string } | null)?.timezone || workspaceTz;
    let nextRunLocal: string | null = null;
    try {
      if (j.next_run_at) {
        nextRunLocal =
          new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(j.next_run_at)) + ` (${timezone})`;
      }
    } catch {
      /* invalid stored zone — fall through with ISO only */
    }
    return {
      id: j.id,
      name: j.name,
      type: j.task_type,
      enabled: !!j.enabled,
      schedule: j.schedule ?? null,
      timezone,
      nextRunAt: j.next_run_at ?? null,
      nextRunLocal,
      lastRunAt: j.last_run_at ?? null,
      lastRun: last
        ? { status: last.status, at: last.started_at, summary: s(last.error ?? last.result, 300) }
        : null,
      config: j.config ?? null,
    };
  });
  return {
    ok: true as const,
    count: automations.length,
    active: automations.filter((a: { enabled: boolean }) => a.enabled).length,
    automations,
  };
}
