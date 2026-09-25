// Outcome-based learning: looks at what actually performed on Buffer and
// distills durable insights/failures into agent_memory.
// Server-only. Never throws — learning is best effort.

import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveChatModel } from "./llm-resolver.server";
import { playbookBlock } from "./playbooks.server";
import { rememberFacts, type MemoryKind } from "./agent-memory.server";
import { logAiUsage } from "./ai-usage.server";
import { loadMetrics, summarize, rankPosts, channelKey } from "./metrics-context.server";

// Every field required: strict structured outputs (OpenAI) reject schemas
// where a property is missing from `required`, which .default()/.optional()
// would produce.
const Schema = z.object({
  summary: z.string(),
  takeaways: z.array(
    z.object({
      kind: z.enum(["insight", "failure", "lesson"]),
      content: z.string(),
      confidence: z.enum(["low", "medium", "high"]),
      channel: z.string(),
    }),
  ),
});

type Client = { from: (t: string) => any };

const WEIGHT: Record<string, number> = { low: 1, medium: 2, high: 3.5 };

export async function reflectOnPerformance(
  client: Client,
  workspaceId: string,
  days = 90,
): Promise<{ ok: boolean; summary?: string; learned: number; reason?: string }> {
  try {
    let rows = await loadMetrics(client, workspaceId, { days });
    if (rows.length < 4) rows = await loadMetrics(client, workspaceId, { limit: 60 });
    if (rows.length < 4) {
      return {
        ok: false,
        learned: 0,
        reason: "Not enough synced posts yet — hit Sync performance first.",
      };
    }

    // Bucket in the workspace's own zone, not the fallback: this reflection tells
    // the agent which hours and days perform, and those numbers are meaningless
    // — worse, quietly wrong by several hours — if they are computed in a zone
    // the brand's audience does not live in.
    const { loadWorkspaceTimezone } = await import("./workspace-context.server");
    const tz = await loadWorkspaceTimezone(client as never, workspaceId);
    const s = summarize(rows, tz);
    const top = rankPosts(rows, 6, false);
    const bottom = rankPosts(rows, 6, true);
    const fmt = (p: (typeof top)[number]) =>
      `[${p.channel}/${p.mediaType}] ER ${p.engagementRate}% · ${p.impressions} impressions · ${p.likes}L/${p.comments}C/${p.shares}S · ${p.sentAt ?? "?"} — "${p.text}"`;

    const { model: resolvedModel, modelId } = await resolveChatModel(client as never, workspaceId);
    const learningRules = await playbookBlock(client as never, workspaceId, ["learning"]);
    const started = Date.now();

    const result = await generateText({
      maxOutputTokens: 3000,
      model: resolvedModel,
      system:
        (learningRules ? learningRules + "\n\n" : "") +
        "You are the performance analyst of an autonomous social media agent. You are given the account's own " +
        "sent posts with real engagement numbers. Identify what actually distinguishes the over-performers from " +
        "the under-performers: hook style, caption length, format/media type, topic, posting time, CTA, tone. " +
        "Be specific and testable — 'first-person stories about client work beat generic industry commentary on LinkedIn' " +
        "is useful; 'post engaging content' is not. Only claim a pattern when at least two posts support it, and say so " +
        "through the confidence field. Return at most 5 takeaways. If the data shows no repeatable pattern, return none.",
      prompt: `Window: last ${days} days (${s.posts} sent posts, account avg ER ${s.avgEngagementRate}%).
Per channel: ${s.channels.map((c) => `${c.channel}: ${c.posts} posts, avg ER ${c.avgEngagementRate}%, best ${c.bestEngagementRate}%`).join(" | ")}
By format: ${s.byMediaType.map((m) => `${m.key} ${m.avgEngagementRate}% (${m.posts})`).join(" | ")}
By length: ${s.byLength.map((m) => `${m.key} ${m.avgEngagementRate}% (${m.posts})`).join(" | ")}
Best hour: ${s.bestHour ?? "n/a"} · Best weekday: ${s.bestWeekday ?? "n/a"}

OVER-PERFORMERS:
${top.map(fmt).join("\n")}

UNDER-PERFORMERS:
${bottom.map(fmt).join("\n")}`,
      output: Output.object({ schema: Schema }),
    });

    // `.output` is a throwing getter in ai@6: it raises when the model stopped
    // for any reason other than "stop" (e.g. truncation) or produced
    // unparseable JSON — so it must be read inside try/catch, not destructured.
    let output: z.infer<typeof Schema> | null = null;
    try {
      output = result.output;
    } catch (e) {
      console.warn(
        "[performance-reflection] no structured output:",
        e instanceof Error ? e.message : e,
      );
    }
    const { usage } = result;

    if (!output) {
      return {
        ok: false,
        learned: 0,
        reason:
          result.finishReason === "length"
            ? "The analysis was cut off before finishing (raise the token budget)."
            : "The model returned an unusable analysis.",
      };
    }

    const takeaways = (output.takeaways ?? []).slice(0, 5);
    const learned = takeaways.length
      ? await rememberFacts(
          client,
          workspaceId,
          takeaways.map((t) => ({
            kind: (t.kind === "failure"
              ? "failure"
              : t.kind === "lesson"
                ? "lesson"
                : "insight") as MemoryKind,
            content: t.content,
            weight: WEIGHT[t.confidence] ?? 1,
            tags: ["performance", (t.channel || "all").toLowerCase()],
          })),
          "buffer.performance",
        )
      : 0;

    const summary = (output.summary ?? "").trim();
    const { error: logError } = await client.from("activity_log").insert({
      workspace_id: workspaceId,
      actor_type: "agent",
      action: "agent.reflection",
      summary: (summary || "Reviewed own-account performance.").slice(0, 1200),
      status: "ok",
      details: {
        task: "performance review",
        window_days: days,
        posts_analysed: rows.length,
        channels: s.channels.map((c) => c.channel),
        takeaways,
        model: modelId,
      },
      related_type: "post_metrics",
      related_id: null,
    });
    // Logging is best-effort, but a dropped entry should at least leave a trace.
    if (logError) {
      console.warn(
        "[performance-reflection] activity log insert failed:",
        (logError as { message?: string }).message ?? logError,
      );
    }

    if (usage) {
      await logAiUsage(client, {
        workspaceId,
        model: modelId,
        operation: "agent.performance_reflection",
        usage,
        actorType: "agent",
        durationMs: Date.now() - started,
        relatedType: "post_metrics",
      });
    }

    return { ok: true, summary, learned };
  } catch (e) {
    console.warn("[performance-reflection] skipped:", e instanceof Error ? e.message : e);
    // Surface the real message (NoProviderError, cap errors, provider 4xx…)
    // instead of a generic shrug; keep the shrug only for non-Error throws.
    const reason =
      e instanceof Error && e.message.trim()
        ? e.message.trim().slice(0, 200)
        : "Could not analyse performance right now.";
    return { ok: false, learned: 0, reason };
  }
}

/** Distinct channels present in the workspace metrics (for UI pickers). */
export async function listMetricChannels(client: Client, workspaceId: string): Promise<string[]> {
  const rows = await loadMetrics(client, workspaceId, { limit: 500 });
  return Array.from(new Set(rows.map(channelKey))).sort();
}
