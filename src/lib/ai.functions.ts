import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  generateText,
  Output,
  NoObjectGeneratedError,
  extractJsonMiddleware,
  wrapLanguageModel,
} from "ai";
import { z } from "zod";
import { resolveChatModel, currentWorkspaceId } from "./llm-resolver.server";
import { BASE_STYLE_RULES, AGENT_PERSONA } from "./system-prompts";

/**
 * Best-effort usage logging so /crear generation and PDF extraction count
 * toward the monthly cap like every other AI call. Never fatal: a logging
 * failure must not fail the generation the user is waiting on.
 */
async function logUsage(
  client: unknown,
  workspaceId: string | null,
  modelId: string,
  operation: string,
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined,
) {
  if (!workspaceId) return;
  try {
    const { logAiUsage } = await import("./ai-usage.server");
    await logAiUsage(client as never, { workspaceId, model: modelId, operation, usage });
  } catch {
    /* best-effort */
  }
}

/**
 * Resolves the caller's workspace and model together. The workspace id is
 * needed anyway for usage logging, and modelId is the REAL resolved model —
 * logging a hardcoded constant would misattribute every call.
 */
async function resolveForCall(client: unknown) {
  const wsId = await currentWorkspaceId(client as never);
  const { model, modelId } = await resolveChatModel(client as never, wsId);
  return { wsId, model, modelId };
}

const GuidelineSchema = z.object({
  personality: z.string(),
  toneOfVoice: z.string(),
  writingStyle: z.string(),
  vocabularyUse: z.array(z.string()),
  vocabularyAvoid: z.array(z.string()),
  contentPillars: z.array(z.string()),
  audienceProfile: z.string(),
  recurringThemes: z.array(z.string()),
  preferredCTAs: z.array(z.string()),
  doExamples: z.array(z.string()),
  dontExamples: z.array(z.string()),
  visualDirection: z.string(),
  hashtagStyle: z.string(),
  platformGuidance: z.string(),
  emotionalTone: z.string(),
  customInstructions: z.string(),
});

export const generateGuideline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        profile: z.object({
          name: z.string(),
          website: z.string().optional(),
          socials: z.string().optional(),
          industry: z.string().optional(),
          audience: z.string().optional(),
          productsServices: z.string().optional(),
          toneNotes: z.string().optional(),
        }),
        sourceText: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { wsId, model: resolvedModel, modelId } = await resolveForCall(context.supabase);
    const result = await generateText({
      maxOutputTokens: 8192,
      model: resolvedModel,
      system: `${AGENT_PERSONA}\n\n${BASE_STYLE_RULES}\n\nYou produce practical, executive-grade social media guides. Useful, concrete, never theoretical. English.`,
      prompt: `Based on this brand, create a complete and practical social media guide.

PROFILE:
${JSON.stringify(data.profile, null, 2)}

${data.sourceText ? `\nPROVIDED BRAND DOCUMENT:\n${data.sourceText.slice(0, 8000)}` : ""}

Be concrete. Give real copy examples. Lists with at least 4-6 items where applicable. English.`,
      output: Output.object({ schema: GuidelineSchema }),
    });
    await logUsage(context.supabase, wsId, modelId, "brand.generate_guideline", result.usage);
    // `result.output` throws when the generation did not finish cleanly —
    // name truncation for what it is instead of surfacing a parse error.
    if (result.finishReason === "length") {
      throw new Error(
        "The guide was cut off by the model's output limit. Try again with a shorter source document.",
      );
    }
    return result.output;
  });

const PostSchema = z.object({
  platform: z.enum(["linkedin", "instagram", "tiktok", "x", "facebook"]),
  caption: z.string(),
  alternativeHooks: z.array(z.string()),
  shortVersion: z.string(),
  longVersion: z.string(),
  hashtags: z.array(z.string()),
  visualConcept: z.string(),
  cta: z.string(),
  angle: z.string(),
});

function postPrompt(data: {
  platform: "linkedin" | "instagram" | "tiktok" | "x" | "facebook";
  brief: string;
  brandContext: string;
  imageDescription?: string;
}) {
  return `Platform: ${data.platform}
User brief: ${data.brief}
${data.imageDescription ? `\nAttached image: ${data.imageDescription}` : ""}

BRAND CONTEXT:
${data.brandContext || "(no approved guide yet, use professional judgment)"}

Return a single valid JSON object that exactly matches this contract:
- platform: one of linkedin, instagram, tiktok, x, facebook
- caption: string
- alternativeHooks: array of 3 to 5 strings
- shortVersion: string
- longVersion: string
- hashtags: array of 4 to 8 strings, no extra text
- visualConcept: string
- cta: string
- angle: string

Do not add markdown, comments, code fences, or text before/after the JSON.
Adapt tone, length, and format to ${data.platform}. Relevant, specific hashtags, not generic. "visualConcept" describes the image that would accompany the post. "angle" is the strategic angle (educational, narrative, announcement, etc.). Write in English.`;
}

function normalizePost(
  raw: unknown,
  platform: "linkedin" | "instagram" | "tiktok" | "x" | "facebook",
) {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const coerceString = (value: unknown, fallback = "") =>
    typeof value === "string" ? value.trim() : fallback;
  const coerceStringArray = (value: unknown) =>
    Array.isArray(value)
      ? value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
      : [];

  return PostSchema.parse({
    platform,
    caption: coerceString(record.caption) || coerceString(record.copy) || coerceString(record.post),
    alternativeHooks: coerceStringArray(record.alternativeHooks ?? record.hooks).slice(0, 5),
    shortVersion: coerceString(record.shortVersion ?? record.short),
    longVersion: coerceString(record.longVersion ?? record.long),
    hashtags: coerceStringArray(record.hashtags)
      .map((tag) => tag.replace(/^#+/, ""))
      .slice(0, 8),
    visualConcept: coerceString(record.visualConcept ?? record.visual ?? record.imageConcept),
    cta: coerceString(record.cta),
    angle: coerceString(record.angle),
  });
}

export const generatePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        brief: z.string(),
        platform: z.enum(["linkedin", "instagram", "tiktok", "x", "facebook"]),
        brandContext: z.string(),
        imageDescription: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { wsId, model: resolvedModel, modelId } = await resolveForCall(context.supabase);
    const robustModel = wrapLanguageModel({
      model: resolvedModel,
      middleware: extractJsonMiddleware(),
    });

    // The result is captured before the (throwing) `output` getter is read so
    // usage is logged even when the object fails to parse, and so truncation
    // can be told apart from a formatting failure.
    const result = await generateText({
      maxOutputTokens: 8192,
      model: robustModel,
      system: `${AGENT_PERSONA}\n\n${BASE_STYLE_RULES}\n\nYou generate ready-to-publish posts, adapted to each platform.`,
      prompt: postPrompt(data),
      output: Output.object({ schema: PostSchema }),
    });
    await logUsage(context.supabase, wsId, modelId, "create.generate_post", result.usage);

    try {
      return result.output;
    } catch (error) {
      if (!NoObjectGeneratedError.isInstance(error)) {
        throw error;
      }

      const repairedSource = error.text?.trim();
      if (repairedSource) {
        try {
          return normalizePost(JSON.parse(repairedSource), data.platform);
        } catch {
          /* best-effort */
        }
      }

      // The raw text could not be salvaged. If the model simply ran out of
      // output tokens, a same-parameters retry will truncate again — say what
      // happened instead of burning a second call.
      if (result.finishReason === "length") {
        throw new Error(
          "The post generation was cut off by the model's output limit before valid JSON was produced. Try a shorter brief.",
        );
      }

      const retry = await generateText({
        maxOutputTokens: 8192,
        model: robustModel,
        system: `${AGENT_PERSONA}\n\n${BASE_STYLE_RULES}\n\nYou generate ready-to-publish posts, adapted to each platform. You return strict JSON, no additional text.`,
        prompt: `${postPrompt(data)}\n\nIf the first output failed, fix the format and reply only with valid JSON.`,
      });
      await logUsage(context.supabase, wsId, modelId, "create.generate_post", retry.usage);

      return normalizePost(JSON.parse(retry.text), data.platform);
    }
  });

export const refinePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        currentCaption: z.string(),
        instruction: z.string(),
        brandContext: z.string(),
        platform: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { wsId, model: resolvedModel, modelId } = await resolveForCall(context.supabase);
    const result = await generateText({
      maxOutputTokens: 8192,
      model: resolvedModel,
      system: `${AGENT_PERSONA}\n\n${BASE_STYLE_RULES}`,
      prompt: `BRAND CONTEXT:\n${data.brandContext}\n\nPlatform: ${data.platform}\n\nCURRENT POST:\n${data.currentCaption}\n\nUSER INSTRUCTION: ${data.instruction}\n\nReturn only the new copy, with no explanations, no quotes around it.`,
    });
    await logUsage(context.supabase, wsId, modelId, "create.refine_post", result.usage);
    return { caption: result.text.trim() };
  });

const QualitySchema = z.object({
  brandVoice: z.object({ pass: z.boolean(), note: z.string() }),
  spanishSpain: z.object({ pass: z.boolean(), note: z.string() }),
  notAiSounding: z.object({ pass: z.boolean(), note: z.string() }),
  bannedWords: z.object({ pass: z.boolean(), note: z.string() }),
  clearPurpose: z.object({ pass: z.boolean(), note: z.string() }),
  strongHook: z.object({ pass: z.boolean(), note: z.string() }),
  appropriateCta: z.object({ pass: z.boolean(), note: z.string() }),
  platformFormat: z.object({ pass: z.boolean(), note: z.string() }),
  score: z.number(),
});

export const qualityCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        caption: z.string(),
        platform: z.string(),
        brandContext: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { wsId, model: resolvedModel, modelId } = await resolveForCall(context.supabase);
    const result = await generateText({
      maxOutputTokens: 8192,
      model: resolvedModel,
      system: `${AGENT_PERSONA}\n\n${BASE_STYLE_RULES}\n\nYou review posts before publishing. Strict but fair. score 0 to 100. The "spanishSpain" field here means "language quality and consistency" — pass if the copy is in clean English matching the brand voice.`,
      prompt: `Platform: ${data.platform}\n\nGUIDE:\n${data.brandContext}\n\nPOST:\n${data.caption}\n\nEvaluate each criterion. "pass" is true only if it is clearly correct. "note" in one short sentence. "score" 0-100 overall.`,
      output: Output.object({ schema: QualitySchema }),
    });
    await logUsage(context.supabase, wsId, modelId, "create.quality_check", result.usage);
    if (result.finishReason === "length") {
      throw new Error("The quality check was cut off by the model's output limit. Try again.");
    }
    return result.output;
  });

export const analyzeImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ dataUrl: z.string(), purpose: z.enum(["style", "post"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { wsId, model: resolvedModel, modelId } = await resolveForCall(context.supabase);
    const prompt =
      data.purpose === "style"
        ? `Analyze this image as a visual brand reference. Describe in 4-6 sentences: color palette (with concrete tones), typography if any, composition/layout, mood, use of whitespace, logo presence, photographic treatment. Be concise, factual, useful to guide future generations. English.`
        : `Describe this image as a social media manager would: what is shown, the mood, possible marketing angles, post formats it could fit (product, behind-the-scenes, lifestyle, etc.). 3-5 sentences. English.`;
    const result = await generateText({
      maxOutputTokens: 8192,
      model: resolvedModel,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image", image: data.dataUrl },
          ],
        },
      ],
    });
    await logUsage(context.supabase, wsId, modelId, "library.analyze_image", result.usage);
    return { analysis: result.text.trim() };
  });

export const extractFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ text: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { wsId, model: resolvedModel, modelId } = await resolveForCall(context.supabase);
    const result = await generateText({
      maxOutputTokens: 8192,
      model: resolvedModel,
      system: BASE_STYLE_RULES,
      prompt: `Summarize this brand book document into the points useful for social media (tone, voice, values, audience, what to avoid, examples). English. Maximum 600 words.\n\n${data.text.slice(0, 12000)}`,
    });
    await logUsage(context.supabase, wsId, modelId, "brand.extract_text", result.usage);
    return { summary: result.text };
  });

// Extracts a full brand guideline (voice, palette, typography, do/don't examples,
// pillars) from an uploaded PDF brand book. Uses Gemini native PDF understanding.
// Every property is required: OpenAI strict structured outputs reject any
// schema with non-required properties, which is what `.default()` produced.
// Fields the model may legitimately not find are `.nullable()` instead, and
// nulls are normalised back to ""/[] at the use site so the client contract
// (always strings and arrays) is unchanged.
const ExtractedGuidelineSchema = z.object({
  personality: z.string().nullable(),
  toneOfVoice: z.string().nullable(),
  writingStyle: z.string().nullable(),
  vocabularyUse: z.array(z.string()).nullable(),
  vocabularyAvoid: z.array(z.string()).nullable(),
  contentPillars: z.array(z.string()).nullable(),
  audienceProfile: z.string().nullable(),
  recurringThemes: z.array(z.string()).nullable(),
  preferredCTAs: z.array(z.string()).nullable(),
  doExamples: z.array(z.string()).nullable(),
  dontExamples: z.array(z.string()).nullable(),
  visualDirection: z.string().nullable(),
  hashtagStyle: z.string().nullable(),
  platformGuidance: z.string().nullable(),
  emotionalTone: z.string().nullable(),
  customInstructions: z.string().nullable(),
  colorPalette: z.array(z.object({ name: z.string().nullable(), hex: z.string() })).nullable(),
  typography: z
    .object({
      headingFont: z.string().nullable(),
      bodyFont: z.string().nullable(),
      monoFont: z.string().nullable(),
      notes: z.string().nullable(),
    })
    .nullable(),
});

// Brand-book PDF upload cap. Not an image, so media-validate.ts's checks don't
// apply — but the same reasoning does: base64 inflates bytes by 4/3, so the
// data-URL *string* is capped before any decoding happens, meaning an
// oversized upload is rejected without ever being expanded in memory. 20MB
// matches the client-side cap the uploader already enforces (guia.tsx:62);
// agreeing with it means a file the user was told is fine never bounces here.
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_DATA_URL_CHARS = Math.ceil((MAX_PDF_BYTES * 4) / 3) + 128;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

export const ExtractPdfInputSchema = z.object({
  dataUrl: z
    .string()
    .startsWith("data:")
    .max(
      MAX_PDF_DATA_URL_CHARS,
      `That PDF is larger than the ${Math.round(MAX_PDF_BYTES / (1024 * 1024))}MB limit. Export a smaller file and try again.`,
    ),
  fileName: z.string().default("brand.pdf"),
});

/**
 * Decodes a `data:...;base64,...` PDF and sniffs its magic bytes.
 *
 * Pulled out as a pure function — no server function, no model, no database —
 * so it is unit testable on its own. The declared mime segment of the data
 * URL is not trusted, same as media-validate.ts does for images: this file is
 * handed straight to the model, so a renamed non-PDF should fail fast and
 * cheaply rather than burn a model call. This checks only the 4-byte magic
 * number — not a real PDF parser, and it says nothing about whether the PDF
 * is well-formed beyond that header.
 */
export function decodePdfDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Expected a data:application/pdf;base64 URL.");
  const mime = match[1] || "application/pdf";
  const base64 = match[2];
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("That PDF could not be decoded — the file may be damaged.");
  }
  if (!PDF_MAGIC.every((b, i) => bytes[i] === b)) {
    throw new Error("That file is not a PDF. Upload a real PDF brand book.");
  }
  return { mime, bytes };
}

export const extractBrandGuidelineFromPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ExtractPdfInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { wsId, model: resolvedModel, modelId } = await resolveForCall(context.supabase);
    const { mime, bytes } = decodePdfDataUrl(data.dataUrl);
    const result = await generateText({
      maxOutputTokens: 8192,
      model: resolvedModel,
      system: `${AGENT_PERSONA}\n\n${BASE_STYLE_RULES}\n\nYou extract structured brand guidelines from brand books. Only include information explicitly stated in the document; return null for a field you cannot support.`,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract the brand guideline from this PDF into a structured JSON matching the given schema. For colorPalette include every named color with its hex value (guess a reasonable hex when only a color name is shown). For typography identify the heading and body fonts. Use short, concrete strings. English.",
            },
            { type: "file", data: bytes, mediaType: mime, filename: data.fileName },
          ],
        },
      ],
      output: Output.object({ schema: ExtractedGuidelineSchema }),
    });
    await logUsage(context.supabase, wsId, modelId, "brand.extract_pdf", result.usage);
    if (result.finishReason === "length") {
      throw new Error(
        "The extraction was cut off by the model's output limit. Try a shorter brand book, or split it.",
      );
    }
    const out = result.output;
    // Nulls mean "the document did not say" — the client expects the old
    // contract of empty strings and arrays, so normalise here.
    const s = (v: string | null) => v ?? "";
    const a = (v: string[] | null) => v ?? [];
    return {
      personality: s(out.personality),
      toneOfVoice: s(out.toneOfVoice),
      writingStyle: s(out.writingStyle),
      vocabularyUse: a(out.vocabularyUse),
      vocabularyAvoid: a(out.vocabularyAvoid),
      contentPillars: a(out.contentPillars),
      audienceProfile: s(out.audienceProfile),
      recurringThemes: a(out.recurringThemes),
      preferredCTAs: a(out.preferredCTAs),
      doExamples: a(out.doExamples),
      dontExamples: a(out.dontExamples),
      visualDirection: s(out.visualDirection),
      hashtagStyle: s(out.hashtagStyle),
      platformGuidance: s(out.platformGuidance),
      emotionalTone: s(out.emotionalTone),
      customInstructions: s(out.customInstructions),
      colorPalette: (out.colorPalette ?? []).map((c) => ({ name: s(c.name), hex: c.hex })),
      typography: {
        headingFont: s(out.typography?.headingFont ?? null),
        bodyFont: s(out.typography?.bodyFont ?? null),
        monoFont: s(out.typography?.monoFont ?? null),
        notes: s(out.typography?.notes ?? null),
      },
    };
  });
