// Agent heartbeat — a periodic, cheap "check in on the account" pass.
// Runs on the same cron tick as automations, at a per-workspace interval the
// owner chooses (30m … 24h, or off). It never publishes anything: it inspects
// the current state, writes a short first-person status note to the activity
// log, and flags anything that needs a human.
// Server-only, best effort: it must never break the cron tick.

import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveChatModel } from "./llm-resolver.server";
import { loadBrandBrain } from "./agent-memory.server";
import { logAiUsage } from "./ai-usage.server";
import { assertWithinCap } from "./usage-caps.server";

type Client = { from: (t: string) => any };

export const HEARTBEAT_INTERVALS = {
  off: 0,
  "30m": 30,
  "1h": 60,
  "3h": 180,
  "6h": 360,
  "12h": 720,
  "24h": 1440,
} as const;

export type HeartbeatInterval = keyof typeof HEARTBEAT_INTERVALS;

// Every field required: strict structured outputs (OpenAI) reject schemas
// where a property is missing from `required`, which .default()/.optional()
// would produce.
const Schema = z.object({
  status: z.string(),
  needsAttention: z.array(z.string()),
});

const DAY = 86400000;

async function snapshot(admin: Client, workspaceId: string) {
  const now = Date.now();
  const [upcoming, recentErrors, lastMetric, jobs] = await Promise.all([
    admin
      .from("scheduled_posts")
      .select("id,scheduled_at,status")
      .eq("workspace_id", workspaceId)
      .gte("scheduled_at", new Date(now).toISOString())
      .lte("scheduled_at", new Date(now + DAY).toISOString())
      .limit(20),
    admin
      .from("activity_log")
      .select("action,summary,error,created_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "error")
      .gte("created_at", new Date(now - DAY).toISOString())
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("post_metrics")
      .select("sent_at,engagement_rate")
      .eq("workspace_id", workspaceId)
      .order("sent_at", { ascending: false })
      .limit(1),
    admin
      .from("cron_jobs")
      .select("name,task_type,enabled,next_run_at")
      .eq("workspace_id", workspaceId)
      .limit(20),
  ]);

  return {
    upcoming: (upcoming.data ?? []) as Array<{ scheduled_at: string; status: string }>,
    errors: (recentErrors.data ?? []) as Array<{
      action: string;
      summary: string;
      error: string | null;
    }>,
    lastMetricAt: ((lastMetric.data ?? [])[0] as { sent_at?: string } | undefined)?.sent_at ?? null,
    jobs: (jobs.data ?? []) as Array<{
      name: string;
      task_type: string;
      enabled: boolean;
      next_run_at: string | null;
    }>,
  };
}

export async function runHeartbeat(admin: Client, workspaceId: string) {
  // Sweep the engagement inbox first so the check-in sees what just came in.
  let inbox = "";
  try {
    const eng = await import("./engagement/engagement.server");
    // autoSend: false — a routine check-in must never take the autonomous-send
    // branch, whatever the workspace reply mode says. (`as never` until the
    // engagement.server change that adds this option lands.)
    await eng.runEngagementSweep(admin as never, workspaceId, { autoSend: false });
    inbox = await eng.loadInboxDigest(admin as never, workspaceId);
  } catch (e) {
    console.warn("[heartbeat] engagement sweep skipped:", e instanceof Error ? e.message : e);
  }
  const state = await snapshot(admin, workspaceId);
  const brain = await loadBrandBrain(admin, workspaceId, 8);

  const { model: resolvedModel, modelId } = await resolveChatModel(admin as never, workspaceId);
  const started = Date.now();

  const result = await generateText({
    maxOutputTokens: 1000,
    model: resolvedModel,
    system:
      "You are the always-on operator of a brand's social media account. You are doing a routine check-in. " +
      "Write two or three sentences, first person, plain English, about the current state of the account and what " +
      "you are watching. Then list anything that genuinely needs the human's attention (empty list if all is well). " +
      "Do not invent numbers. Do not suggest work that is already scheduled.",
    prompt: `Upcoming posts in the next 24h: ${
      state.upcoming.length
        ? state.upcoming.map((p) => `${p.scheduled_at} (${p.status})`).join(", ")
        : "none"
    }
Automations: ${
      state.jobs.length
        ? state.jobs
            .map(
              (j) =>
                `${j.name} [${j.task_type}] ${j.enabled ? "on" : "paused"} next ${j.next_run_at ?? "?"}`,
            )
            .join(" | ")
        : "none configured"
    }
Errors in the last 24h: ${
      state.errors.length
        ? state.errors.map((e) => `${e.action}: ${e.error ?? e.summary}`).join(" | ")
        : "none"
    }
Most recent synced post metric: ${state.lastMetricAt ?? "never synced"}
Engagement inbox: ${inbox || "nothing waiting"}

${brain}`,

    output: Output.object({ schema: Schema }),
  });

  // `.output` is a throwing getter in ai@6: it raises when the model stopped
  // for any reason other than "stop" (e.g. truncation) or produced
  // unparseable JSON — so it must be read inside try/catch, not destructured.
  let output: z.infer<typeof Schema> | null = null;
  try {
    output = result.output;
  } catch {
    // fall through to the descriptive error below
  }
  if (!output) {
    throw new Error(
      result.finishReason === "length"
        ? "heartbeat analysis was cut off (raise token budget)"
        : "model returned an unusable heartbeat",
    );
  }
  const { usage } = result;

  const status = (output.status ?? "").trim() || "Checked in — nothing to report.";
  const needsAttention = (output.needsAttention ?? []).slice(0, 5);

  const { error: logError } = await admin.from("activity_log").insert({
    workspace_id: workspaceId,
    actor_type: "agent",
    action: "agent.heartbeat",
    summary: status.slice(0, 1200),
    status: needsAttention.length ? "warning" : "ok",
    details: {
      needsAttention,
      upcoming: state.upcoming.length,
      errors24h: state.errors.length,
      lastMetricAt: state.lastMetricAt,
      model: modelId,
    },
    related_type: "workspace",
    related_id: workspaceId,
  });
  // Logging is best-effort, but a dropped entry should at least leave a trace.
  if (logError) {
    console.warn(
      "[heartbeat] activity log insert failed:",
      (logError as { message?: string }).message ?? logError,
    );
  }

  if (usage) {
    await logAiUsage(admin, {
      workspaceId,
      model: modelId,
      operation: "agent.heartbeat",
      usage,
      actorType: "agent",
      durationMs: Date.now() - started,
      relatedType: "workspace",
      relatedId: workspaceId,
    });
  }

  return { status, needsAttention };
}

/** Finds workspaces whose heartbeat is due and runs one check-in for each. */
export async function runDueHeartbeats(admin: Client, now = new Date()) {
  const { data } = await admin
    .from("workspaces")
    .select("id,heartbeat_interval,heartbeat_last_run_at,automations_enabled")
    .neq("heartbeat_interval", "off")
    .limit(50);

  const rows = (data ?? []) as Array<{
    id: string;
    heartbeat_interval: HeartbeatInterval;
    heartbeat_last_run_at: string | null;
    automations_enabled: boolean;
  }>;

  const ran: Array<{ workspaceId: string; ok: boolean; error?: string }> = [];
  for (const w of rows) {
    if (w.automations_enabled === false) continue;
    const minutes = HEARTBEAT_INTERVALS[w.heartbeat_interval] ?? 0;
    if (!minutes) continue;
    const last = w.heartbeat_last_run_at ? new Date(w.heartbeat_last_run_at).getTime() : 0;
    if (now.getTime() - last < minutes * 60000) continue;

    try {
      // Cap check before claiming the slot — a cap-blocked heartbeat must not
      // pretend it just checked in ("Last check-in: now" with no run behind it).
      await assertWithinCap(admin, w.id);
      // Claim the slot so a slow run cannot be double-fired by the next tick.
      await admin
        .from("workspaces")
        .update({ heartbeat_last_run_at: now.toISOString() })
        .eq("id", w.id);
      await runHeartbeat(admin, w.id);
      ran.push({ workspaceId: w.id, ok: true });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      console.warn("[heartbeat] failed", w.id, err);
      ran.push({ workspaceId: w.id, ok: false, error: err });
    }
  }
  return { heartbeats: ran.length, results: ran };
}
