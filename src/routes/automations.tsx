import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { validateCronExpression } from "@/lib/cron-schedule";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import { bufferPublishApprovedPost } from "@/lib/buffer.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, Plus, PlayCircle, Bot, HeartPulse, ShieldCheck, Gauge, Globe } from "lucide-react";
import { toast } from "sonner";

// Only a last-resort fallback now: the real default is workspaces.timezone,
// whose column default is this same value, so nothing moves for a workspace
// that never opens the setting.
const FALLBACK_TZ = "Europe/Madrid";
// The cron string is wall-clock in the JOB's zone; the executor honours
// config.timezone, so a Sydney job stays at Sydney wall-clock across DST.
const COMMON_TZS = [
  "Europe/Madrid",
  "Australia/Sydney",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/Santiago",
  "Asia/Singapore",
  "UTC",
];

// The nine-entry list above was fine when it only picked a cron's wall clock —
// you can always express a schedule in a neighbouring zone. The workspace zone
// is different: it is the clock the agent reasons in and the bucket every
// "best time to post" number is computed in, so it has to be the user's actual
// zone or the setting is useless for most of the world. Hence the full IANA
// list from the runtime, with the common zones pinned on top so the frequent
// choices stay one click away. No dependency: `Intl.supportedValuesOf` ships
// with the engine, and the list is built once at module load, not per render.
// The same list backs the per-job picker so the two settings cannot disagree
// about which zones exist.
const ALL_TZS: string[] = (() => {
  try {
    const all = Intl.supportedValuesOf("timeZone");
    return all.length ? all : COMMON_TZS;
  } catch {
    // Pre-ES2022 engine, or a build with a trimmed ICU.
    return COMMON_TZS;
  }
})();

/** Common zones first, then everything else — used by both pickers. */
function TimezoneOptions({ current }: { current: string }) {
  // A zone already stored but absent from the runtime list (renamed zone, or a
  // trimmed ICU build) still has to be selectable, or opening the page would
  // silently rewrite the setting to whatever the browser picked first.
  const extra = ALL_TZS.includes(current) || COMMON_TZS.includes(current) ? [] : [current];
  return (
    <>
      <optgroup label="Common">
        {[...extra, ...COMMON_TZS].map((tz) => (
          <option key={`common-${tz}`} value={tz}>
            {tz}
          </option>
        ))}
      </optgroup>
      <optgroup label="All time zones">
        {ALL_TZS.map((tz) => (
          <option key={tz} value={tz}>
            {tz}
          </option>
        ))}
      </optgroup>
    </>
  );
}

/** Formats an ISO instant as wall-clock in the job's own zone, labelled. */
function inZone(iso: string, tz: string): string {
  try {
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(iso)) + ` (${tz})`
    );
  } catch {
    return new Date(iso).toLocaleString("en-US");
  }
}
/**
 * A job's effective zone. An explicit config.timezone always wins — changing
 * the workspace setting must never move a job someone deliberately pinned to
 * Sydney. Only a job without one follows the workspace.
 */
function jobTz(j: { config?: Record<string, unknown> | null }, workspaceTz: string): string {
  return (j.config as { timezone?: string } | null)?.timezone || workspaceTz;
}

export const Route = createFileRoute("/automations")({
  head: () => ({
    meta: [
      { title: "Automations · Social Studio" },
      { name: "description", content: "Autonomous crons that run in the background." },
    ],
  }),
  component: AutomationsPage,
});

type TaskType =
  "daily_post" | "competitor_scan" | "weekly_report" | "metrics_sync" | "performance_reflection";
type Job = {
  id: string;
  workspace_id: string;
  name: string;
  task_type: TaskType;
  schedule: string;
  enabled: boolean;
  config: Record<string, unknown>;
  next_run_at: string | null;
  last_run_at: string | null;
};

const TASK_LABEL: Record<TaskType, string> = {
  daily_post: "Generate & schedule a post",
  competitor_scan: "Review competitors",
  weekly_report: "Weekly performance report",
  metrics_sync: "Sync post performance",
  performance_reflection: "Learn from performance (reflection)",
};

const PRESETS: { label: string; expression: string }[] = [
  { label: "Every day 9:00", expression: "0 9 * * *" },
  { label: "Mon-Fri 8:00", expression: "0 8 * * 1-5" },
  { label: "Every Monday 9:00", expression: "0 9 * * 1" },
  { label: "Every hour", expression: "0 * * * *" },
];

const HEARTBEAT_OPTIONS: { value: string; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "30m", label: "Every 30 minutes" },
  { value: "1h", label: "Every hour" },
  { value: "3h", label: "Every 3 hours" },
  { value: "6h", label: "Every 6 hours" },
  { value: "12h", label: "Every 12 hours" },
  { value: "24h", label: "Once a day" },
];

function AutomationsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [heartbeat, setHeartbeat] = useState("off");
  const [heartbeatLast, setHeartbeatLast] = useState<string | null>(null);
  const [requireApproval, setRequireApproval] = useState(true);
  // Ids of the posts the confirmation dialog is currently asking about. null =
  // no dialog. The switch is NOT flipped while this is open — nothing has
  // changed yet at that point.
  const [pendingPrompt, setPendingPrompt] = useState<string[] | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [tokenCap, setTokenCap] = useState("0");
  const [tokensUsed, setTokensUsed] = useState(0);
  const [workspaceTz, setWorkspaceTz] = useState(FALLBACK_TZ);
  const [tzBusy, setTzBusy] = useState(false);

  // Form state
  const [name, setName] = useState("Daily LinkedIn post");
  const [taskType, setTaskType] = useState<TaskType>("daily_post");
  const [schedule, setSchedule] = useState("0 9 * * *");
  // New jobs default to the workspace zone; load() syncs this once the setting
  // is known. A user can still override it per job.
  const [timezone, setTimezone] = useState(FALLBACK_TZ);
  const [platform, setPlatform] = useState("linkedin");
  const [brief, setBrief] = useState("Share one practical insight for our audience.");

  const load = async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    const { data } = await supabase
      .from("cron_jobs")
      .select("*")
      .eq("workspace_id", activeWorkspaceId)
      .order("created_at", { ascending: false });
    setJobs((data as Job[] | null) ?? []);
    const wsRow = await supabase
      .from("workspaces")
      .select(
        "automations_enabled,heartbeat_interval,heartbeat_last_run_at,require_approval,monthly_token_cap,timezone",
      )
      .eq("id", activeWorkspaceId)
      .maybeSingle();
    const ws = wsRow.data;
    setAutoEnabled(ws?.automations_enabled ?? true);
    setHeartbeat(ws?.heartbeat_interval ?? "off");
    setHeartbeatLast(ws?.heartbeat_last_run_at ?? null);
    setRequireApproval(ws?.require_approval ?? true);
    setTokenCap(String(ws?.monthly_token_cap ?? 0));
    const tz = (ws as { timezone?: string | null } | null)?.timezone || FALLBACK_TZ;
    setWorkspaceTz(tz);
    setTimezone(tz);

    // Month-to-date AI token spend. Summed in the database (same RPC the cap
    // enforcement uses) so the meter stays honest past the row-fetch limit the
    // old client-side sum silently capped out at.
    const rpc = await supabase.rpc("ai_usage_month_total", { ws: activeWorkspaceId });
    if (!rpc.error && rpc.data !== null && rpc.data !== undefined) {
      setTokensUsed(Number(rpc.data) || 0);
    } else {
      // Fallback (e.g. migration not applied yet): the old client-side sum.
      const since = new Date(
        Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
      ).toISOString();
      const usage = await supabase
        .from("activity_log")
        .select("details")
        .eq("workspace_id", activeWorkspaceId)
        .eq("action", "ai.usage")
        .gte("created_at", since)
        .limit(5000);
      const rows = (usage.data as Array<{ details: { totalTokens?: number } | null }> | null) ?? [];
      setTokensUsed(rows.reduce((sum, r) => sum + (Number(r.details?.totalTokens) || 0), 0));
    }
    setLoading(false);
  };
  useEffect(() => {
    void load();
  }, [activeWorkspaceId]); // eslint-disable-line

  const create = async () => {
    if (!activeWorkspaceId) return;
    if (!name.trim() || !schedule.trim()) {
      toast.error("Name and schedule required");
      return;
    }
    const config =
      taskType === "daily_post"
        ? { platform, brief, timezone }
        : taskType === "performance_reflection"
          ? { days: 90, syncFirst: true, timezone }
          : { timezone };
    // Validated rather than just parsed: a four-field typo and a blank schedule
    // both PARSE, into an entirely different job and a once-a-minute one
    // respectively, so catching a throw was never enough.
    const checked = validateCronExpression(schedule, { tz: timezone });
    if (!checked.ok) {
      toast.error(checked.error);
      return;
    }
    const nextRunAt = checked.nextFire.toISOString();
    const { error } = await supabase.from("cron_jobs").insert({
      workspace_id: activeWorkspaceId,
      name: name.trim(),
      task_type: taskType,
      schedule: checked.expression,
      config: config as never,
      next_run_at: nextRunAt,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Automation created. Next run: ${inZone(nextRunAt, timezone)}`);
    setName("");
    await load();
  };

  const toggle = async (j: Job) => {
    await supabase.from("cron_jobs").update({ enabled: !j.enabled }).eq("id", j.id);
    await load();
  };
  const remove = async (j: Job) => {
    if (!confirm(`Delete "${j.name}"?`)) return;
    await supabase.from("cron_jobs").delete().eq("id", j.id);
    await load();
  };
  const runNow = async (j: Job) => {
    // Backdating next_run_at only works for enabled jobs — the tick skips
    // disabled ones, so "Run now" on a paused job used to toast success while
    // nothing ever ran. Re-enable it as part of the queueing.
    const wasPaused = !j.enabled;
    const patch: { next_run_at: string; enabled?: boolean } = {
      next_run_at: new Date(Date.now() - 1000).toISOString(),
    };
    if (wasPaused) patch.enabled = true;
    const { error } = await supabase.from("cron_jobs").update(patch).eq("id", j.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!autoEnabled) {
      // Same trap at the workspace level: with the master switch off the tick
      // runs nothing, so a success toast here would be a lie.
      toast.warning(
        `"${j.name}" is queued, but the master switch is off — nothing will run until you turn it on.`,
      );
    } else if (wasPaused) {
      toast.success(
        `"${j.name}" was paused — re-enabled and queued to run on next tick (within 1 minute).`,
      );
    } else {
      toast.success(`"${j.name}" queued to run on next tick (within 1 minute).`);
    }
    await load();
  };
  const toggleGlobal = async (v: boolean) => {
    if (!activeWorkspaceId) return;
    setAutoEnabled(v);
    await supabase
      .from("workspaces")
      .update({ automations_enabled: v })
      .eq("id", activeWorkspaceId);
    toast.success(v ? "Automations resumed" : "All automations paused");
  };
  const saveHeartbeat = async (v: string) => {
    if (!activeWorkspaceId) return;
    setHeartbeat(v);
    const { error } = await supabase
      .from("workspaces")
      .update({ heartbeat_interval: v })
      .eq("id", activeWorkspaceId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      v === "off"
        ? "Heartbeat turned off"
        : `Heartbeat set to ${HEARTBEAT_OPTIONS.find((o) => o.value === v)?.label.toLowerCase()}`,
    );
  };

  /**
   * Writes workspaces.timezone. The database validates the name against
   * pg_timezone_names in a trigger, so nothing is re-validated here — but if it
   * ever fires (a zone this browser's ICU knows and the Postgres host does not),
   * its message is already written for a human, so it is shown verbatim rather
   * than replaced with a generic failure. The optimistic change is rolled back
   * so the picker never shows a zone the database refused.
   */
  const saveTimezone = async (v: string) => {
    if (!activeWorkspaceId) return;
    const previous = workspaceTz;
    if (v === previous) return;
    setWorkspaceTz(v);
    setTzBusy(true);
    const { error } = await supabase
      .from("workspaces")
      .update({ timezone: v })
      .eq("id", activeWorkspaceId);
    setTzBusy(false);
    if (error) {
      setWorkspaceTz(previous);
      toast.error(`Could not change the time zone: ${error.message}`);
      return;
    }
    // Jobs that never pinned a zone of their own now read in the new one, and
    // the new-automation form should offer it too.
    if (timezone === previous) setTimezone(v);
    toast.success(
      `Workspace time zone set to ${v}. The agent's "today" and every timing insight now use it.`,
    );
    await load();
  };

  /**
   * Writes require_approval and keeps the switch honest. The optimistic flip is
   * rolled back when the write fails, so the UI never shows a setting the
   * database did not accept.
   */
  const writeApproval = async (ws: string, v: boolean): Promise<boolean> => {
    const previous = requireApproval;
    setRequireApproval(v);
    const { error } = await supabase
      .from("workspaces")
      .update({ require_approval: v })
      .eq("id", ws);
    if (error) {
      setRequireApproval(previous);
      toast.error(`Could not change the setting: ${error.message}`);
      return false;
    }
    return true;
  };

  /**
   * Publishes the backlog one post at a time through the same server fn the
   * Approvals screen uses. A post is flipped to 'scheduled' only immediately
   * before its own publish attempt, and only if it is still pending — marking
   * the whole queue approved up front is what stranded these posts before:
   * nothing anywhere scans for 'scheduled' and publishes it.
   */
  const publishPendingPosts = async (ws: string, ids: string[]) => {
    let published = 0;
    let failed = 0;
    let skipped = 0;
    let firstError = "";
    for (const id of ids) {
      const { data: claimed, error: claimErr } = await supabase
        .from("scheduled_posts")
        .update({ status: "scheduled" })
        .eq("id", id)
        .eq("workspace_id", ws)
        .eq("status", "pending_approval")
        .select("id");
      if (claimErr) {
        failed++;
        if (!firstError) firstError = claimErr.message;
        continue;
      }
      if (!claimed?.length) {
        // Approved, rejected or deleted elsewhere between the prompt and now.
        skipped++;
        continue;
      }
      try {
        const res = await bufferPublishApprovedPost({ data: { workspaceId: ws, postId: id } });
        if (res.ok) {
          published++;
        } else {
          failed++;
          if (!firstError) firstError = res.error ?? "publishing failed";
        }
      } catch (e) {
        failed++;
        if (!firstError) firstError = e instanceof Error ? e.message : "publishing failed";
      }
    }

    const total = ids.length;
    if (published === total) {
      toast.success(
        `Approval off — all ${total} post${total === 1 ? "" : "s"} published to your channels.`,
      );
      return;
    }
    const bits = [`${published} of ${total} published`];
    if (failed > 0) bits.push(`${failed} failed`);
    if (skipped > 0) bits.push(`${skipped} no longer waiting for approval`);
    const message = `Approval off — ${bits.join(", ")}.${firstError ? ` First error: ${firstError}` : ""}`;
    if (published === 0 && failed > 0) toast.error(message);
    else toast.warning(message);
  };

  const saveApproval = async (v: boolean) => {
    if (!activeWorkspaceId) return;
    const ws = activeWorkspaceId;
    if (v) {
      if (await writeApproval(ws, true)) {
        toast.success("Autonomous posts will wait for your approval");
      }
      return;
    }
    // Turning approval off can send real posts to real channels, so find out
    // what is already waiting BEFORE changing anything, and ask about it.
    const { data: pending, error: pErr } = await supabase
      .from("scheduled_posts")
      .select("id")
      .eq("workspace_id", ws)
      .eq("status", "pending_approval");
    if (pErr) {
      toast.error(`Could not check the approval queue: ${pErr.message}`);
      return;
    }
    const ids = ((pending as { id: string }[] | null) ?? []).map((r) => r.id);
    if (ids.length === 0) {
      // Nothing to publish, so nothing to confirm.
      if (await writeApproval(ws, false)) {
        toast.success("Approval off — new autonomous posts go straight to your channels.");
      }
      return;
    }
    setPendingPrompt(ids);
  };

  const confirmPublishPending = async () => {
    const ids = pendingPrompt;
    if (!activeWorkspaceId || !ids) return;
    const ws = activeWorkspaceId;
    setApprovalBusy(true);
    try {
      // Don't publish anything if the setting itself did not save.
      if (!(await writeApproval(ws, false))) return;
      await publishPendingPosts(ws, ids);
    } finally {
      setApprovalBusy(false);
      setPendingPrompt(null);
    }
  };

  const declinePublishPending = async () => {
    if (!activeWorkspaceId) return;
    const ws = activeWorkspaceId;
    const n = pendingPrompt?.length ?? 0;
    setApprovalBusy(true);
    try {
      if (await writeApproval(ws, false)) {
        toast.success(
          `Approval off — nothing published. The ${n} post${n === 1 ? "" : "s"} already waiting ${n === 1 ? "stays" : "stay"} in Approvals until you decide.`,
        );
      }
    } finally {
      setApprovalBusy(false);
      setPendingPrompt(null);
    }
  };

  const saveCap = async () => {
    if (!activeWorkspaceId) return;
    const n = Math.max(0, Math.round(Number(tokenCap) || 0));
    const { error } = await supabase
      .from("workspaces")
      .update({ monthly_token_cap: n })
      .eq("id", activeWorkspaceId);
    if (error) {
      toast.error(error.message);
      return;
    }
    setTokenCap(String(n));
    toast.success(
      n === 0 ? "Spend limit removed" : `Monthly limit set to ${n.toLocaleString("en-US")} tokens`,
    );
  };

  const promptCount = pendingPrompt?.length ?? 0;
  const capNumber = Math.max(0, Math.round(Number(tokenCap) || 0));
  const capPct = capNumber > 0 ? Math.min(100, Math.round((tokensUsed / capNumber) * 100)) : 0;

  const weeklyReflectionExists = jobs.some((j) => j.task_type === "performance_reflection");
  const addWeeklyReflection = async () => {
    setName("Weekly performance reflection");
    setTaskType("performance_reflection");
    setSchedule("0 9 * * 1");
    toast.info("Form pre-filled — press Create automation to confirm.");
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="pb-4 border-b border-border flex items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Studio</p>
          <h1 className="mt-1 font-serif text-3xl">Automations</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Cron jobs that run autonomously in the background. Everything they do lands in{" "}
            <span className="italic">Log</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="auto-toggle" className="text-xs text-muted-foreground">
            Master switch
          </Label>
          <Switch id="auto-toggle" checked={autoEnabled} onCheckedChange={toggleGlobal} />
        </div>
      </div>

      <section className="mt-6 border border-border rounded-lg p-5 bg-background">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="max-w-xl">
            <h2 className="font-serif text-xl flex items-center gap-2">
              <HeartPulse className="h-4 w-4" /> Agent heartbeat
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              A recurring check-in where the agent reviews upcoming posts, recent failures and
              metric freshness, then writes a short status note to the Log and flags anything that
              needs you. It never publishes on its own.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              More frequent means faster reaction to problems, but each check-in costs tokens on
              your model key. Hourly or 3-hourly is a good balance; once a day is the cheapest
              useful setting.
            </p>
            {heartbeatLast && (
              <p className="mt-2 text-xs text-muted-foreground">
                Last check-in: {new Date(heartbeatLast).toLocaleString("en-US")}
              </p>
            )}
          </div>
          <div className="min-w-48">
            <Label className="text-xs">Frequency</Label>
            <select
              value={heartbeat}
              onChange={(e) => saveHeartbeat(e.target.value)}
              disabled={!activeWorkspaceId}
              className="mt-1 w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              {HEARTBEAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="mt-4 border border-border rounded-lg p-5 bg-background">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="max-w-xl">
            <h2 className="font-serif text-xl flex items-center gap-2">
              <Globe className="h-4 w-4" /> Time zone
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The clock this workspace runs on. The agent resolves &ldquo;today&rdquo;,
              &ldquo;tomorrow&rdquo; and &ldquo;next Tuesday&rdquo; in it, every &ldquo;best time to
              post&rdquo; number on <span className="italic">Reports</span> is bucketed by it, and a
              new automation starts in it.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Existing automations are not moved: a job with its own time zone keeps it. Only jobs
              that never set one follow this setting.
            </p>
          </div>
          <div className="min-w-56">
            <Label className="text-xs">Workspace time zone</Label>
            <select
              value={workspaceTz}
              onChange={(e) => void saveTimezone(e.target.value)}
              disabled={!activeWorkspaceId || tzBusy}
              className="mt-1 w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <TimezoneOptions current={workspaceTz} />
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Now: {inZone(new Date().toISOString(), workspaceTz)}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-4 border border-border rounded-lg p-5 bg-background">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="max-w-xl">
            <h2 className="font-serif text-xl flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Approval queue
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              When this is on, everything the agent writes on its own lands in{" "}
              <span className="italic">Calendar → Approvals</span> instead of the calendar. You
              review, edit and approve before anything can go out.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="approval-toggle" className="text-xs text-muted-foreground">
              Require approval
            </Label>
            <Switch
              id="approval-toggle"
              checked={requireApproval}
              onCheckedChange={saveApproval}
              disabled={!activeWorkspaceId || approvalBusy}
            />
          </div>
        </div>
      </section>

      {/* Turning approval off with a backlog sends real posts to real channels,
          so it is confirmed explicitly rather than happening as a side effect of
          flipping the switch. Declining still turns the setting off. */}
      <AlertDialog
        open={pendingPrompt !== null}
        onOpenChange={(open) => {
          if (!open && !approvalBusy) setPendingPrompt(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Publish {promptCount} post{promptCount === 1 ? "" : "s"} to your channels now?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {promptCount} post{promptCount === 1 ? " is" : "s are"} waiting for your approval.
              Turning approval off can publish {promptCount === 1 ? "it" : "them"} to your connected
              social channels right away — that is a real post going out, and it cannot be undone
              from here. You can also turn approval off and leave{" "}
              {promptCount === 1 ? "it" : "them"} waiting in Approvals.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approvalBusy}>Keep approval on</AlertDialogCancel>
            <Button
              variant="outline"
              disabled={approvalBusy}
              onClick={() => void declinePublishPending()}
            >
              Turn off without publishing
            </Button>
            <AlertDialogAction
              disabled={approvalBusy}
              onClick={(e) => {
                // Keep the dialog up while the batch runs so the button can
                // report progress instead of vanishing mid-publish.
                e.preventDefault();
                void confirmPublishPending();
              }}
            >
              {approvalBusy
                ? "Publishing…"
                : `Publish ${promptCount} post${promptCount === 1 ? "" : "s"} now`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section className="mt-4 border border-border rounded-lg p-5 bg-background">
        <h2 className="font-serif text-xl flex items-center gap-2">
          <Gauge className="h-4 w-4" /> Usage cap
        </h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-xl">
          A monthly ceiling on AI tokens across chat, automations, heartbeats and reflections. When
          the cap is hit, autonomous work pauses and the chat replies with a clear message until
          next month or until you raise it. Set 0 for no limit.
        </p>
        <div className="mt-4 flex items-end gap-3 flex-wrap">
          <div>
            <Label className="text-xs">Monthly token cap</Label>
            <Input
              type="number"
              min={0}
              step={10000}
              value={tokenCap}
              onChange={(e) => setTokenCap(e.target.value)}
              className="mt-1 w-48 font-mono"
            />
          </div>
          <Button variant="outline" onClick={saveCap} disabled={!activeWorkspaceId}>
            Save limit
          </Button>
        </div>
        <div className="mt-4">
          <p className="text-xs text-muted-foreground">
            This month:{" "}
            <span className="text-foreground font-medium">
              {tokensUsed.toLocaleString("en-US")}
            </span>{" "}
            tokens
            {capNumber > 0
              ? ` of ${capNumber.toLocaleString("en-US")} (${capPct}%)`
              : " · no limit set"}
          </p>
          {capNumber > 0 && (
            <div className="mt-2 h-1.5 w-full max-w-md rounded bg-muted overflow-hidden">
              <div
                className={`h-full ${capPct >= 100 ? "bg-destructive" : "bg-foreground"}`}
                style={{ width: `${capPct}%` }}
              />
            </div>
          )}
        </div>
      </section>

      {!weeklyReflectionExists && (
        <section className="mt-4 border border-dashed border-border rounded-lg p-4 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">Weekly automatic reflection</span> — every
            Monday the agent syncs post performance, compares winners and losers, and saves what it
            learned to its memory.
          </p>
          <Button size="sm" variant="outline" onClick={addWeeklyReflection}>
            Set it up
          </Button>
        </section>
      )}

      <section className="mt-6 border border-border rounded-lg p-5 space-y-4 bg-muted/30">
        <h2 className="font-serif text-xl flex items-center gap-2">
          <Bot className="h-4 w-4" /> New automation
        </h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Task</Label>
            <select
              value={taskType}
              onChange={(e) => setTaskType(e.target.value as TaskType)}
              className="mt-1 w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              {Object.entries(TASK_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Schedule (cron, 5 fields)</Label>
            <Input
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              className="mt-1 font-mono"
              placeholder="0 9 * * *"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.expression}
                  onClick={() => setSchedule(p.expression)}
                  className="text-[11px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs">Timezone</Label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="mt-1 w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <TimezoneOptions current={timezone} />
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              The cron is wall-clock in this zone — DST is handled for you. Defaults to the
              workspace zone ({workspaceTz}); pin a different one to keep this job on its own clock.
            </p>
          </div>
          {taskType === "daily_post" && (
            <>
              <div>
                <Label className="text-xs">Platform</Label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="mt-1 w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
                >
                  {["linkedin", "instagram", "tiktok", "x", "facebook"].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Brief for the agent</Label>
                <Textarea
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  rows={3}
                  className="mt-1"
                />
              </div>
            </>
          )}
        </div>
        <Button onClick={create} disabled={!activeWorkspaceId}>
          <Plus className="h-4 w-4 mr-2" /> Create automation
        </Button>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-xl mb-3">Active automations</h2>
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && jobs.length === 0 && (
          <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-8 text-center">
            No automations yet. Create one above.
          </p>
        )}
        <ul className="space-y-2">
          {jobs.map((j) => (
            <li key={j.id} className="border border-border rounded-lg p-4 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{j.name}</span>
                  <span className="text-[10px] font-mono uppercase tracking-wider border border-border px-1.5 py-0.5 rounded">
                    {j.task_type}
                  </span>
                  {!j.enabled && (
                    <span className="text-[10px] font-mono uppercase tracking-wider bg-muted px-1.5 py-0.5 rounded">
                      paused
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 font-mono">
                  {j.schedule} · {jobTz(j, workspaceTz)}
                </p>
                {/* Next run rendered in the JOB's zone, labelled — the browser's
                    locale time for a Sydney job reads like a bug. */}
                <p className="text-xs text-muted-foreground mt-1">
                  Next run: {j.next_run_at ? inZone(j.next_run_at, jobTz(j, workspaceTz)) : "—"}
                  {j.last_run_at && <> · Last: {inZone(j.last_run_at, jobTz(j, workspaceTz))}</>}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => runNow(j)} title="Run now">
                  <PlayCircle className="h-4 w-4" />
                </Button>
                <Switch checked={j.enabled} onCheckedChange={() => toggle(j)} />
                <Button size="sm" variant="ghost" onClick={() => remove(j)} title="Delete">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
