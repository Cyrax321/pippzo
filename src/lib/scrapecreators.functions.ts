// ScrapeCreators-powered server functions.
// Authenticated; scoped to the caller's workspace via RLS.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveChatModel } from "./llm-resolver.server";
import { playbookBlock } from "./playbooks.server";
import { AGENT_PERSONA, BASE_STYLE_RULES } from "./system-prompts";
import { scanNetwork, type NetworkKey, type NormalizedPost } from "./scrapecreators.server";
import { requireServiceKey } from "./service-credentials.server";

const HandlesSchema = z
  .object({
    instagram: z.string().max(200).optional(),
    tiktok: z.string().max(200).optional(),
    x: z.string().max(200).optional(),
    linkedin: z.string().max(500).optional(),
  })
  .partial();

export type ScHandles = z.infer<typeof HandlesSchema>;

function buildTargets(h: ScHandles): { network: NetworkKey; identifier: string }[] {
  const t: { network: NetworkKey; identifier: string }[] = [];
  if (h.instagram) t.push({ network: "instagram", identifier: h.instagram });
  if (h.tiktok) t.push({ network: "tiktok", identifier: h.tiktok });
  if (h.x) t.push({ network: "x", identifier: h.x });
  if (h.linkedin) t.push({ network: "linkedin", identifier: h.linkedin });
  return t;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function summarize(posts: NormalizedPost[]) {
  const engagements = posts.map(
    (p) => (p.metrics.likes ?? 0) + (p.metrics.comments ?? 0) + (p.metrics.shares ?? 0),
  );
  const withDate = posts
    .filter((p) => p.published_at)
    .map((p) => new Date(p.published_at!).getTime());
  let cadencePerWeek: number | undefined;
  if (withDate.length >= 2) {
    const span = (Math.max(...withDate) - Math.min(...withDate)) / (1000 * 60 * 60 * 24 * 7);
    cadencePerWeek = span > 0 ? Math.round((withDate.length / span) * 10) / 10 : undefined;
  }
  const formats = posts.reduce<Record<string, number>>((acc, p) => {
    const k = p.media_type ?? "unknown";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const topFormat = Object.entries(formats).sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    posts_scanned: posts.length,
    cadence_per_week: cadencePerWeek,
    engagement_median: median(engagements),
    top_format: topFormat as string | undefined,
    formats,
  };
}

// -------- scanOwnHandles ---------------------------------------------------
export const scanOwnHandles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        handles: HandlesSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const targets = buildTargets(data.handles);
    if (targets.length === 0) throw new Error("Provide at least one social handle.");
    const scKey = await requireServiceKey(
      context.supabase as never,
      data.workspaceId,
      "scrapecreators",
    );

    const perNetwork: Record<string, ReturnType<typeof summarize> & { error?: string }> = {};
    const rows: {
      workspace_id: string;
      source: "own";
      competitor_id: null;
      network: string;
      external_id: string;
      url: string | null;
      published_at: string | null;
      caption: string | null;
      media_type: string | null;
      metrics: Record<string, number>;
    }[] = [];

    for (const t of targets) {
      try {
        const { posts } = await scanNetwork(t.network, t.identifier, scKey);
        perNetwork[t.network] = summarize(posts);
        for (const p of posts) {
          rows.push({
            workspace_id: data.workspaceId,
            source: "own",
            competitor_id: null,
            network: t.network,
            external_id: p.external_id,
            url: p.url ?? null,
            published_at: p.published_at ?? null,
            caption: p.caption ?? null,
            media_type: p.media_type ?? null,
            metrics: p.metrics,
          });
        }
      } catch (e) {
        console.error("[sc] own scan failed", t.network, e);
        perNetwork[t.network] = {
          posts_scanned: 0,
          cadence_per_week: undefined,
          engagement_median: 0,
          top_format: undefined,
          formats: {},
          error: e instanceof Error ? e.message : "Scan failed",
        };
      }
    }

    if (rows.length > 0) {
      const { error } = await context.supabase
        .from("social_posts")
        .upsert(rows as never, { onConflict: "workspace_id,network,external_id" });
      if (error) console.error("[sc] own upsert error", error);
    }

    // Save handles onto brand_profile.
    await context.supabase
      .from("brand_profile")
      .update({ own_handles: data.handles as never })
      .eq("workspace_id", data.workspaceId);

    return { summary: perNetwork, scannedAt: Date.now() };
  });

// -------- scanCompetitorV2 -------------------------------------------------
const KV = z.object({ label: z.string(), value: z.string() });
const TitleBody = z.object({ title: z.string(), body: z.string() });
// Every property is required: OpenAI strict structured outputs reject any
// schema with non-required properties. Fields the model may legitimately not
// have are `.nullable()` instead — consumers already treat them as falsy.
const ActivityEntry = z.object({
  date: z.string(),
  network: z.string().nullable(),
  text: z.string(),
  highlight: z.string().nullable(),
  url: z.string().nullable(),
});

const SnapshotSchema = z.object({
  // Legacy (kept for backward compat / cards)
  postingFrequency: z.string(),
  dominantFormats: z.array(z.string()),
  recurringThemes: z.array(z.string()),
  tone: z.string(),
  recentPosts: z.array(z.string()),
  estimatedAudience: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  opportunitiesForUs: z.array(z.string()),

  // Rich analyst layer
  subtitle: z.string().describe("Short italic subtitle capturing who they are"),
  dek: z.string().describe("2-3 sentence editorial intro"),
  profileNote: z.string().describe("Paragraph on who the competitor is"),
  stats: z.array(KV).describe("3-4 headline stats"),
  positioning: z
    .array(KV)
    .describe(
      "5 rows: Institutional base, Flagship proof, Owned audience, Signature idea, Third-party validation",
    ),
  contentStrategy: z.object({
    cadence: z.string(),
    format: z.string(),
    voice: z.string(),
    recurringDevice: z.string(),
  }),
  activityLog: z.array(ActivityEntry).describe("6-10 recent posts paraphrased"),
  strengthsDetailed: z.array(TitleBody),
  vulnerabilities: z.array(TitleBody),
  keyTakeaways: z.array(TitleBody),
  closingQuote: z.string(),

  topPosts: z
    .array(
      z.object({
        url: z.string().nullable(),
        caption: z.string().nullable(),
        engagement: z.number().nullable(),
        network: z.string().nullable(),
      }),
    )
    .nullable(),
});

export const scanCompetitorV2 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        competitorId: z.string().uuid(),
        ourBrandContext: z.string().default(""),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: comp, error } = await context.supabase
      .from("competitors")
      .select("id,name,workspace_id,handles,website")
      .eq("id", data.competitorId)
      .maybeSingle();
    if (error) throw error;
    if (!comp) throw new Error("Competitor not found.");

    const handles = HandlesSchema.parse(comp.handles ?? {});
    const targets = buildTargets(handles);
    if (targets.length === 0) {
      throw new Error(
        "Add per-network handles (Instagram / TikTok / X / LinkedIn) to run a deep scan.",
      );
    }
    const scKey = await requireServiceKey(
      context.supabase as never,
      (comp.workspace_id as string) ?? null,
      "scrapecreators",
    );

    const collected: (NormalizedPost & { network: NetworkKey })[] = [];
    const perNetwork: Record<string, ReturnType<typeof summarize> & { error?: string }> = {};
    const rows: {
      workspace_id: string;
      source: "competitor";
      competitor_id: string;
      network: string;
      external_id: string;
      url: string | null;
      published_at: string | null;
      caption: string | null;
      media_type: string | null;
      metrics: Record<string, number>;
    }[] = [];

    for (const t of targets) {
      try {
        const { posts } = await scanNetwork(t.network, t.identifier, scKey);
        perNetwork[t.network] = summarize(posts);
        for (const p of posts) {
          collected.push({ ...p, network: t.network });
          rows.push({
            workspace_id: comp.workspace_id as string,
            source: "competitor",
            competitor_id: comp.id as string,
            network: t.network,
            external_id: p.external_id,
            url: p.url ?? null,
            published_at: p.published_at ?? null,
            caption: p.caption ?? null,
            media_type: p.media_type ?? null,
            metrics: p.metrics,
          });
        }
      } catch (e) {
        console.error("[sc] competitor scan failed", t.network, e);
        perNetwork[t.network] = {
          posts_scanned: 0,
          cadence_per_week: undefined,
          engagement_median: 0,
          top_format: undefined,
          formats: {},
          error: e instanceof Error ? e.message : "Scan failed",
        };
      }
    }

    if (rows.length > 0) {
      const { error: upErr } = await context.supabase
        .from("social_posts")
        .upsert(rows as never, { onConflict: "workspace_id,network,external_id" });
      if (upErr) console.error("[sc] competitor upsert error", upErr);
    }

    if (collected.length === 0) {
      const diag = Object.entries(perNetwork)
        .map(([n, s]) => `${n}: ${s.error ?? `${s.posts_scanned} posts`}`)
        .join(" · ");
      throw new Error(
        `Could not fetch any public posts. ${diag || "Double-check the handles/URLs."}`,
      );
    }

    const scored = collected
      .map((p) => ({
        ...p,
        engagement:
          (p.metrics.likes ?? 0) +
          (p.metrics.comments ?? 0) +
          (p.metrics.shares ?? 0) +
          Math.round((p.metrics.views ?? 0) / 100),
      }))
      .sort((a, b) => b.engagement - a.engagement);

    const corpus = scored
      .slice(0, 30)
      .map(
        (p, i) =>
          `${i + 1}. [${p.network}/${p.media_type ?? "?"}] ${p.published_at ?? ""}\n   ${p.caption?.slice(0, 500)?.replace(/\s+/g, " ") ?? "(no caption)"}\n   likes:${p.metrics.likes ?? "?"} comments:${p.metrics.comments ?? "?"} shares:${p.metrics.shares ?? "?"} views:${p.metrics.views ?? "?"}${p.url ? `\n   ${p.url}` : ""}`,
      )
      .join("\n\n")
      .slice(0, 22000);

    const networkSummary = Object.entries(perNetwork)
      .map(
        ([n, s]) =>
          `${n}: ${s.posts_scanned} posts, cadence ~${s.cadence_per_week ?? "?"}/wk, median engagement ${s.engagement_median}, top format ${s.top_format ?? "?"}`,
      )
      .join("\n");

    const { model: resolvedModel, modelId } = await resolveChatModel(
      context.supabase as never,
      comp.workspace_id ?? null,
    );
    // Exact mode: this is a single-purpose research prompt — the research
    // playbook belongs here, the always-loaded operator manifest does not.
    const researchRules = await playbookBlock(
      context.supabase as never,
      comp.workspace_id ?? null,
      ["research"],
      undefined,
      { exact: true },
    );

    const result = await generateText({
      maxOutputTokens: 16000,
      model: resolvedModel,
      system: `${researchRules ? researchRules + "\n\n" : ""}${AGENT_PERSONA}\n\n${BASE_STYLE_RULES}\n\nYou are a senior competitive intelligence analyst producing an editorial-quality profile grounded strictly in the real posts and metrics provided. Concrete, factual, opinionated. Never invent follower counts or awards. If a signal is thin, say so. English.`,
      prompt: `CLIENT BRAND (for opportunities): ${data.ourBrandContext || "(not provided)"}

COMPETITOR: ${comp.name}
WEBSITE: ${comp.website ?? "(none)"}
NETWORKS SCANNED:
${networkSummary}

RECENT POSTS (highest engagement first, real captions and metrics):
${corpus}

Produce a rich analyst profile in the schema. Guidelines:
- subtitle: one short phrase capturing their archetype.
- dek: 2-3 sentences framing the profile.
- profileNote: paragraph on who they are (role, base, product) drawn from captions/URLs or common knowledge. Do not invent.
- stats: 3-4 concrete headline items YOU CAN SUPPORT from the scanned data (e.g. "${collected.length} posts scanned", median engagement, top network) or clearly notable public facts. Never fabricate follower counts.
- positioning: exactly 5 rows with labels: Institutional base, Flagship proof, Owned audience, Signature idea, Third-party validation. Each value = a short bold-worthy title followed by a sentence, separated by ". "
- contentStrategy: cadence/format/voice/recurringDevice, one crisp paragraph each, grounded on real posts.
- activityLog: 6-10 real recent posts paraphrased in analyst voice, with date and network. 'highlight' = 2-4 word phrase found inside 'text' to bold.
- strengthsDetailed and vulnerabilities: 3-5 items each, purely competitive presence lens.
- keyTakeaways: 4-5 strategic insights for our brand.
- closingQuote: a single sharp sentence.
- Also fill legacy flat fields (postingFrequency, dominantFormats, recurringThemes, tone, recentPosts, estimatedAudience, strengths, weaknesses, opportunitiesForUs) as short summaries derived from the rich fields.
English only. No em dashes.`,
      output: Output.object({ schema: SnapshotSchema }),
    });

    // Count this spend toward the workspace cap — best effort, never fatal.
    if (comp.workspace_id) {
      try {
        const { logAiUsage } = await import("./ai-usage.server");
        await logAiUsage(context.supabase as never, {
          workspaceId: comp.workspace_id as string,
          model: modelId,
          operation: "competitors.deep_scan",
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
        "The analyst profile was cut off by the model's output limit. Try again — a retry usually fits.",
      );
    }
    const output = result.output;

    // The schema uses null for "not available" (strict structured outputs
    // require every property), but the stored CompetitorSnapshot contract and
    // its consumers expect absent/undefined — normalise here.
    const normalized = {
      ...output,
      activityLog: output.activityLog.map((e) => ({
        date: e.date,
        text: e.text,
        network: e.network ?? undefined,
        highlight: e.highlight ?? undefined,
        url: e.url ?? undefined,
      })),
      topPosts: output.topPosts?.map((p) => ({
        url: p.url ?? undefined,
        caption: p.caption ?? undefined,
        engagement: p.engagement ?? undefined,
        network: p.network ?? undefined,
      })),
    };

    const snapshot = { ...normalized, scannedAt: Date.now(), networks: perNetwork };

    await context.supabase
      .from("competitors")
      .update({ snapshot: snapshot as never })
      .eq("id", comp.id);

    return snapshot;
  });
