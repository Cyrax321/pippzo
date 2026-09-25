// Post-run reflection — a short second LLM pass after every agent action.
// Writes a human-readable note to activity_log (action = 'agent.reflection')
// and distilled take-aways to agent_memory so future prompts get smarter.

import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveChatModel, currentWorkspaceId } from "./llm-resolver.server";
import { playbookBlock } from "./playbooks.server";
import { rememberFacts, type MemoryKind } from "./agent-memory.server";
import { logAiUsage } from "./ai-usage.server";

// Every field required: strict structured outputs (OpenAI) reject schemas
// where a property is missing from `required`, which .default()/.optional()
// would produce.
const ReflectionSchema = z.object({
  reflection: z.string(),
  takeaways: z.array(
    z.object({
      kind: z.enum(["lesson", "insight", "preference", "failure"]),
      content: z.string(),
    }),
  ),
});

type Client = { from: (t: string) => any };

export type ReflectInput = {
  workspaceId: string;
  /** What the agent was trying to do, e.g. 'cron: daily LinkedIn post' */
  task: string;
  /** Did it succeed? */
  ok: boolean;
  /** One-line outcome or error message */
  outcome: string;
  /** Any structured context worth reasoning about */
  context?: Record<string, unknown>;
  relatedType?: string | null;
  relatedId?: string | null;
};

/**
 * Never throws — reflection is best-effort commentary, it must not break the
 * action it is reflecting on.
 */
export async function reflectOnRun(client: Client, input: ReflectInput): Promise<string | null> {
  try {
    const workspaceId = input.workspaceId ?? (await currentWorkspaceId(client as never));
    const { model: resolvedModel, modelId } = await resolveChatModel(client as never, workspaceId);
    const learningRules = await playbookBlock(client as never, workspaceId, ["learning"]);
    const started = Date.now();

    const result = await generateText({
      maxOutputTokens: 1500,
      model: resolvedModel,
      system:
        (learningRules ? learningRules + "\n\n" : "") +
        "You are the reflective layer of an autonomous social media agent. " +
        "After each action you write a short, honest, first-person note about what just happened " +
        "and what you would do differently next time. Two or three sentences maximum. " +
        "No preamble, no bullet points inside the reflection, no praise for yourself. " +
        "Then extract at most three durable take-aways worth remembering for future runs. " +
        "Only extract take-aways that are genuinely reusable — if there is nothing new to learn, return an empty list.",
      prompt: `Task: ${input.task}
Result: ${input.ok ? "succeeded" : "failed"}
Outcome: ${input.outcome}
${input.context ? `Context: ${JSON.stringify(input.context).slice(0, 2000)}` : ""}`,
      output: Output.object({ schema: ReflectionSchema }),
    });

    // `.output` is a throwing getter in ai@6: it raises when the model stopped
    // for any reason other than "stop" (e.g. truncation) or produced
    // unparseable JSON — so it must be read inside try/catch, not destructured.
    let output: z.infer<typeof ReflectionSchema> | null = null;
    try {
      output = result.output;
    } catch (e) {
      console.warn(
        "[reflection] no structured output:",
        result.finishReason === "length"
          ? "reflection was cut off (raise token budget)"
          : e instanceof Error
            ? e.message
            : e,
      );
    }
    if (!output) return null;
    const { usage } = result;

    const reflection = (output.reflection ?? "").trim();
    if (!reflection) return null;

    const { error: logError } = await client.from("activity_log").insert({
      workspace_id: input.workspaceId,
      actor_type: "agent",
      action: "agent.reflection",
      summary: reflection.slice(0, 1200),
      status: input.ok ? "ok" : "error",
      details: {
        task: input.task,
        takeaways: output.takeaways ?? [],
        model: modelId,
      },
      related_type: input.relatedType ?? null,
      related_id: input.relatedId ?? null,
    });
    // Logging is best-effort, but a dropped entry should at least leave a trace.
    if (logError) {
      console.warn(
        "[reflection] activity log insert failed:",
        (logError as { message?: string }).message ?? logError,
      );
    }

    if (output.takeaways?.length) {
      await rememberFacts(
        client,
        input.workspaceId,
        output.takeaways.map((t) => ({ kind: t.kind as MemoryKind, content: t.content })),
        input.task,
        { type: input.relatedType ?? undefined, id: input.relatedId ?? undefined },
      );
    }

    await logAiUsage(client, {
      workspaceId: input.workspaceId,
      model: modelId,
      operation: "agent.reflection",
      usage,
      actorType: "agent",
      durationMs: Date.now() - started,
      relatedType: input.relatedType,
      relatedId: input.relatedId,
    });

    return reflection;
  } catch (e) {
    console.warn("[reflection] skipped:", e instanceof Error ? e.message : e);
    return null;
  }
}
