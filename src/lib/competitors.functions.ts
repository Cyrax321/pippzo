import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveChatModelForCaller, currentWorkspaceId } from "./llm-resolver.server";
import { requireServiceKey } from "./service-credentials.server";
import { playbookBlock } from "./playbooks.server";
import { firecrawlScrape } from "./firecrawl.server";
import { BASE_STYLE_RULES, AGENT_PERSONA } from "./system-prompts";

const SnapshotSchema = z.object({
  postingFrequency: z.string(),
  dominantFormats: z.array(z.string()),
  recurringThemes: z.array(z.string()),
  tone: z.string(),
  recentPosts: z.array(z.string()),
  estimatedAudience: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  opportunitiesForUs: z.array(z.string()),
});

export const scanCompetitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().min(1).max(200),
        ourBrandContext: z.string(),
        website: z.string().url().optional(),
        socials: z.object({
          linkedin: z.string().url().optional(),
          instagram: z.string().url().optional(),
          tiktok: z.string().url().optional(),
          x: z.string().url().optional(),
          facebook: z.string().url().optional(),
        }),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const urls = [data.website, ...Object.values(data.socials)].filter((u): u is string => !!u);
    if (urls.length === 0) throw new Error("Provide at least one URL.");

    const wsId = await currentWorkspaceId(context.supabase as never);
    const fcKey = await requireServiceKey(context.supabase as never, wsId, "firecrawl");

    const scrapes: { url: string; markdown: string }[] = [];
    for (const url of urls.slice(0, 5)) {
      try {
        const r = await firecrawlScrape(url, {
          formats: ["markdown"],
          onlyMainContent: true,
          apiKey: fcKey,
        });
        const md = (r.markdown ?? "").slice(0, 6000);
        if (md) scrapes.push({ url, markdown: md });
      } catch (e) {
        console.warn("Firecrawl failed on", url, e);
      }
    }
    if (scrapes.length === 0)
      throw new Error("Could not scrape any URL. Make sure they are public.");

    const corpus = scrapes
      .map((s) => `### ${s.url}\n\n${s.markdown}`)
      .join("\n\n---\n\n")
      .slice(0, 20000);

    const { model: resolvedModel, modelId } = await resolveChatModelForCaller(
      context.supabase as never,
    );
    // wsId (resolved above) rather than null: null skipped any workspace
    // playbook overrides/disables. Exact mode keeps the always-playbooks out
    // of this single-purpose research prompt.
    const researchRules = await playbookBlock(
      context.supabase as never,
      wsId,
      ["research"],
      undefined,
      {
        exact: true,
      },
    );

    const result = await generateText({
      maxOutputTokens: 8192,
      model: resolvedModel,
      system: `${researchRules ? researchRules + "\n\n" : ""}${AGENT_PERSONA}\n\n${BASE_STYLE_RULES}\n\nYou analyze the online presence of competitors for a client brand. Concrete, factual, actionable. English.`,
      prompt: `CLIENT BRAND (for context on opportunities):
${data.ourBrandContext}

COMPETITOR TO ANALYZE: ${data.name}

SCRAPED CONTENT FROM THEIR PUBLIC PROPERTIES:
${corpus}

Return a structured analysis following the schema. Be specific: no empty generalities. If there is not enough data for a field, say so clearly in that field (e.g., "Limited data: posting frequency could not be measured"). English.`,
      output: Output.object({ schema: SnapshotSchema }),
    });

    // Count this spend toward the workspace cap — best effort, never fatal.
    if (wsId) {
      try {
        const { logAiUsage } = await import("./ai-usage.server");
        await logAiUsage(context.supabase as never, {
          workspaceId: wsId,
          model: modelId,
          operation: "competitors.scan",
          usage: result.usage,
        });
      } catch {
        /* best-effort */
      }
    }

    // `result.output` is a throwing getter when the generation did not finish
    // cleanly — report truncation as truncation, not as a parse failure.
    if (result.finishReason === "length") {
      throw new Error(
        "The competitor analysis was cut off by the model's output limit. Try again, or reduce the number of URLs.",
      );
    }
    const output = result.output;

    return { ...output, scannedAt: Date.now() };
  });
