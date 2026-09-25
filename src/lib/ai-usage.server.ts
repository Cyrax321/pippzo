// Portable AI usage logging.
// Every provider (OpenAI, Anthropic, Google, Azure) returns token
// usage on the response, so this is provider-agnostic.
// We log tokens + model, never a cost estimate — cost depends on the provider
// the operator plugged in and any number we invented would be wrong.

type Client = { from: (t: string) => any };

export type AiUsageInput = {
  workspaceId: string;
  model: string;
  operation: string; // e.g. 'cron.daily_post', 'chat.reply', 'reflection'
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  } | null;
  actorType?: "user" | "agent" | "cron" | "system";
  durationMs?: number;
  relatedType?: string | null;
  relatedId?: string | null;
};

export async function logAiUsage(client: Client, input: AiUsageInput) {
  const u = input.usage ?? {};
  const inTok = u.inputTokens ?? 0;
  const outTok = u.outputTokens ?? 0;
  const total = u.totalTokens ?? inTok + outTok;
  try {
    await client.from("activity_log").insert({
      workspace_id: input.workspaceId,
      actor_type: input.actorType ?? "agent",
      action: "ai.usage",
      summary: `${input.operation} · ${input.model} · ${total.toLocaleString("en-US")} tokens`,
      status: "ok",
      details: {
        model: input.model,
        operation: input.operation,
        inputTokens: inTok,
        outputTokens: outTok,
        totalTokens: total,
        ...(input.durationMs ? { durationMs: input.durationMs } : {}),
      },
      related_type: input.relatedType ?? null,
      related_id: input.relatedId ?? null,
    });
  } catch (e) {
    console.warn("[ai-usage] log failed", e);
  }
}
