// Automation (cron job) management for the chat agent (server-only).
import { validateCronExpression } from "@/lib/cron-schedule";
import { logActivity } from "@/lib/activity-log";
import { loadWorkspaceTimezone } from "@/lib/workspace-context.server";

type Client = { from: (t: string) => any };

export const TASK_TYPES = [
  "daily_post",
  "competitor_scan",
  "weekly_report",
  "metrics_sync",
  "performance_reflection",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/**
 * Validates an IANA zone name the only reliable way in a worker runtime:
 * try to build a formatter with it. "Sydney" or a typo throws; a valid zone
 * ("Australia/Sydney") doesn't. Returns the canonical input or null.
 */
export function validTimezone(tz: string | undefined): string | null {
  if (!tz?.trim()) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() });
    return tz.trim();
  } catch {
    return null;
  }
}

// The workspace-level master switch trumps per-job enabled flags: when it is
// off the scheduler skips everything, so promising a run would be a lie.
async function automationsMasterOn(db: Client, workspaceId: string) {
  const { data } = await db
    .from("workspaces")
    .select("automations_enabled")
    .eq("id", workspaceId)
    .maybeSingle();
  return data?.automations_enabled !== false;
}

export async function createAutomationForAgent(
  db: Client,
  workspaceId: string,
  args: {
    name: string;
    taskType: TaskType;
    schedule: string;
    timezone?: string;
    platform?: string;
    brief?: string;
  },
) {
  // An explicit zone from the user always wins; otherwise inherit the
  // workspace's own zone, so a job created with no zone runs on the same clock
  // the rest of the workspace is reasoning in.
  const tz = args.timezone?.trim()
    ? validTimezone(args.timezone)
    : await loadWorkspaceTimezone(db, workspaceId);
  if (!tz) {
    return {
      ok: false as const,
      error: `"${args.timezone}" is not a valid IANA timezone. Use the Area/City form, e.g. "Australia/Sydney" or "Europe/Madrid".`,
    };
  }
  // Validate before writing. The model composes these expressions, and a
  // plausible-looking typo like "0 9 * *" parses into a completely different
  // schedule rather than failing — so the error has to come back to the model
  // in a form it can correct, not silently become a wrong job.
  const checked = validateCronExpression(args.schedule, { tz });
  if (!checked.ok) return { ok: false as const, error: checked.error };
  const next = checked.nextFire.toISOString();
  const config =
    args.taskType === "daily_post"
      ? { platform: args.platform || "linkedin", brief: args.brief || "", timezone: tz }
      : args.taskType === "performance_reflection"
        ? { days: 90, syncFirst: true, timezone: tz }
        : { timezone: tz };

  const { data, error } = await db
    .from("cron_jobs")
    .insert({
      workspace_id: workspaceId,
      name: args.name.trim(),
      task_type: args.taskType,
      schedule: args.schedule.trim(),
      config,
      next_run_at: next,
    })
    .select("id,name,schedule,next_run_at")
    .maybeSingle();
  if (error) return { ok: false as const, error: "Could not create the automation." };
  await logActivity(
    {
      workspaceId,
      actorType: "agent",
      action: "automation.created",
      summary: `Agent created the automation "${args.name}" (${args.schedule}).`,
      relatedType: "cron_job",
      relatedId: data?.id ?? null,
      details: { taskType: args.taskType, config },
    },
    db as never,
  );
  const masterOn = await automationsMasterOn(db, workspaceId);
  return {
    ok: true as const,
    automation: data,
    nextRun: next,
    ...(masterOn
      ? {}
      : {
          note: "Created, but the automations master switch is OFF (see /automations) — the job will not run until it is turned on. Tell the user.",
        }),
  };
}

export async function updateAutomationForAgent(
  db: Client,
  workspaceId: string,
  args: { id: string; enabled?: boolean; schedule?: string; name?: string; timezone?: string },
) {
  const patch: Record<string, unknown> = {};
  if (typeof args.enabled === "boolean") patch.enabled = args.enabled;
  if (args.name?.trim()) patch.name = args.name.trim();

  // A schedule or timezone change both move next_run_at, and the cron string is
  // wall-clock in the JOB's zone — so recompute against the effective zone, not
  // a hard-coded one. A job that already carries config.timezone keeps it; only
  // a job without one falls back to the workspace zone. The existing config must
  // be merged, never replaced: daily_post keeps its platform/brief.
  let newTz: string | null | undefined;
  if (args.timezone !== undefined) {
    newTz = validTimezone(args.timezone);
    if (!newTz) {
      return {
        ok: false as const,
        error: `"${args.timezone}" is not a valid IANA timezone. Use the Area/City form, e.g. "Australia/Sydney".`,
      };
    }
  }
  if (args.schedule?.trim() || newTz) {
    const { data: existing } = await db
      .from("cron_jobs")
      .select("schedule,config")
      .eq("id", args.id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!existing) return { ok: false as const, error: "Could not find that automation." };
    const effectiveSchedule = args.schedule?.trim() || (existing.schedule as string);
    const existingTz = (existing.config as { timezone?: string } | null)?.timezone;
    const effectiveTz = newTz ?? existingTz ?? (await loadWorkspaceTimezone(db, workspaceId));
    // effectiveSchedule may be the STORED expression when only the zone is
    // changing, so this also catches a bad value already in the row.
    const checkedUpdate = validateCronExpression(effectiveSchedule, { tz: effectiveTz });
    if (!checkedUpdate.ok) return { ok: false as const, error: checkedUpdate.error };
    patch.next_run_at = checkedUpdate.nextFire.toISOString();
    if (args.schedule?.trim()) patch.schedule = args.schedule.trim();
    if (newTz) patch.config = { ...(existing.config as Record<string, unknown>), timezone: newTz };
  }
  if (Object.keys(patch).length === 0) return { ok: false as const, error: "Nothing to change." };
  const { data, error } = await db
    .from("cron_jobs")
    .update(patch)
    .eq("id", args.id)
    .eq("workspace_id", workspaceId)
    .select("id,name,schedule,enabled,next_run_at")
    .maybeSingle();
  if (error || !data) return { ok: false as const, error: "Could not update that automation." };
  await logActivity(
    {
      workspaceId,
      actorType: "agent",
      action: "automation.updated",
      summary: `Agent updated the automation "${data.name}".`,
      relatedType: "cron_job",
      relatedId: data.id,
      details: patch,
    },
    db as never,
  );
  return { ok: true as const, automation: data };
}

export async function deleteAutomationForAgent(db: Client, workspaceId: string, id: string) {
  const { data, error } = await db
    .from("cron_jobs")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select("id,name")
    .maybeSingle();
  if (error || !data) return { ok: false as const, error: "Could not delete that automation." };
  await logActivity(
    {
      workspaceId,
      actorType: "agent",
      action: "automation.deleted",
      summary: `Agent deleted the automation "${data.name}".`,
      relatedType: "cron_job",
      relatedId: id,
    },
    db as never,
  );
  return { ok: true as const, deleted: data.name };
}

// Queues the job to fire on the next scheduler tick (within ~1 minute),
// exactly like the "Run now" button in the Automations screen.
// A paused job that the user explicitly runs should run, so it is re-enabled —
// but that side-effect is disclosed in the result instead of happening silently.
export async function runAutomationNowForAgent(db: Client, workspaceId: string, id: string) {
  if (!(await automationsMasterOn(db, workspaceId))) {
    return { ok: false as const, blocked: "automations master switch is off (see /automations)" };
  }
  const { data: existing } = await db
    .from("cron_jobs")
    .select("id,name,enabled")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!existing) return { ok: false as const, error: "Could not queue that automation." };
  const wasPaused = !existing.enabled;
  const { data, error } = await db
    .from("cron_jobs")
    .update({ next_run_at: new Date(Date.now() - 1000).toISOString(), enabled: true })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select("id,name")
    .maybeSingle();
  if (error || !data) return { ok: false as const, error: "Could not queue that automation." };
  await logActivity(
    {
      workspaceId,
      actorType: "agent",
      action: "automation.run_requested",
      summary: wasPaused
        ? `Agent re-enabled the paused automation "${data.name}" and queued it to run on the next tick.`
        : `Agent queued "${data.name}" to run on the next tick.`,
      relatedType: "cron_job",
      relatedId: id,
      details: { wasPaused },
    },
    db as never,
  );
  return {
    ok: true as const,
    queued: data.name,
    ...(wasPaused
      ? {
          wasPaused: true,
          note: "The job was paused — it has been re-enabled and queued. It will run within about a minute; tell the user it is now enabled.",
        }
      : {
          note: "It will run within about a minute. Check readActivityLog or listAutomations for the result.",
        }),
  };
}
