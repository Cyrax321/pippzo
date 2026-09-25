import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchWithTimeout, FETCH_TIMEOUT } from "@/lib/fetch-timeout";
import { parseImageDataUrl } from "@/lib/media-validate";

// ============================================================================
// Video generation server functions.
//
// Provider-specific API logic lives in video-adapters.server.ts (Veo, Gemini
// Omni Flash, Seedance, Kling, Runway…). These functions only resolve the provider
// row + key, dispatch to the matching adapter, and persist the result.
// ============================================================================

import type { ProviderRow } from "./video-adapters.server";

// Keys can live in api_key_enc (encrypted at rest) with the legacy api_key
// column blanked, so the row's api_key must never be used verbatim. We resolve
// the usable plaintext key exactly once here and hand it to the adapter.
async function loadProvider(
  ctx: { supabase: any },
  providerId: string,
): Promise<{ row: ProviderRow; apiKey: string }> {
  const { data, error } = await ctx.supabase
    .from("video_providers")
    .select("*")
    .eq("id", providerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Video provider not found (or not in your workspace).");
  const { readProviderKey } = await import("./crypto.server");
  const apiKey = await readProviderKey(data as ProviderRow);
  if (!apiKey)
    throw new Error("Video provider has no usable API key. Re-save the provider in Connections.");
  return { row: data as ProviderRow, apiKey };
}

// Reference image is image-shaped input, so it is validated the same way a
// library upload is (media-validate.ts): capped at 15MB, checked as a string
// before it is ever decoded, and sniffed from its actual bytes rather than
// whatever mime segment the data URL claims — a real, server-enforced limit
// in place of the old regex that accepted any size or declared type.
export function parseReferenceImageDataUrl(dataUrl: string): {
  bytesBase64Encoded: string;
  mimeType: string;
} {
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed.ok) throw new Error(parsed.error);
  return {
    mimeType: parsed.mime,
    bytesBase64Encoded: Buffer.from(parsed.bytes).toString("base64"),
  };
}

function assertSameOriginSupabaseUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Reference image URL is invalid.");
  }
  if (parsed.protocol !== "https:") throw new Error("Reference image URL must use https.");
  const supaUrl = process.env.SUPABASE_URL;
  if (!supaUrl) throw new Error("Server misconfigured: SUPABASE_URL missing.");
  const supaHost = new URL(supaUrl).host;
  // Only allow URLs pointing at this project's Supabase storage host. This
  // prevents SSRF against internal/metadata endpoints or arbitrary third
  // parties via a client-controlled URL.
  if (parsed.host !== supaHost) {
    throw new Error("Reference image URL must be a Supabase storage URL for this project.");
  }
  if (!parsed.pathname.startsWith("/storage/v1/")) {
    throw new Error("Reference image URL must be a Supabase storage object URL.");
  }
  return parsed;
}

async function fetchAsBase64(
  url: string,
): Promise<{ bytesBase64Encoded: string; mimeType: string }> {
  const safe = assertSameOriginSupabaseUrl(url);
  // This is a reference image (a photo, not a finished video) coming from our
  // own Supabase storage, but a "download" deadline is still the right shape:
  // give it real headroom rather than the tighter API ceiling.
  const res = await fetchWithTimeout(
    safe.toString(),
    {},
    { timeoutMs: FETCH_TIMEOUT.download, label: "Supabase storage (reference image)" },
  );
  if (!res.ok) throw new Error(`Could not fetch reference image [${res.status}]`);
  const mimeType = res.headers.get("content-type") || "image/jpeg";
  const buf = new Uint8Array(await res.arrayBuffer());
  return { bytesBase64Encoded: Buffer.from(buf).toString("base64"), mimeType };
}

async function persistVideoToStorage(
  workspaceId: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ signedUrl: string; sizeBytes: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const ext = mimeType.split("/")[1]?.split(";")[0] || "mp4";
  const path = `${workspaceId}/videogen-${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const up = await supabaseAdmin.storage.from("buffer-media").upload(path, bytes, {
    contentType: mimeType,
    upsert: false,
  });
  if (up.error) throw new Error(`Storage upload failed: ${up.error.message}`);
  const signed = await supabaseAdmin.storage
    .from("buffer-media")
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  if (signed.error || !signed.data?.signedUrl)
    throw new Error(`Could not create signed URL: ${signed.error?.message ?? "unknown"}`);
  // Return the plain signed URL: it is what the library and chat render, and
  // the browser must reach it directly. Routing it through the public tunnel
  // here broke inline playback — ngrok's free tier answers browser requests
  // with an interstitial warning page, so <video> got HTML instead of MP4.
  // Publish paths rewrite through toPublicMediaUrl at publish time instead.
  return { signedUrl: signed.data.signedUrl, sizeBytes: bytes.byteLength };
}

// ---------- start ---------------------------------------------------------

const startInput = z.object({
  workspaceId: z.string().uuid(),
  providerId: z.string().uuid(),
  prompt: z.string().min(3).max(4000),
  aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
  durationSec: z.number().int().min(3).max(15).default(8),
  // Optional reference image — either an inline data URL (uploaded) or a URL to a stored image (library).
  // No length cap here: this is image-shaped input, so the real limit (size,
  // plus a magic-byte sniff of the content) is enforced by parseImageDataUrl
  // in the handler below rather than a second, separate number here.
  referenceImageDataUrl: z.string().optional(),
  referenceImageUrl: z.string().url().optional(),
});

export const startVideoGeneration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => startInput.parse(d))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ operationName: string; providerKind: string; model: string }> => {
      const { row, apiKey } = await loadProvider(context, data.providerId);
      if (row.workspace_id !== data.workspaceId)
        throw new Error("Provider does not belong to this workspace.");
      const { getVideoAdapter, supportedVideoKinds } = await import("./video-adapters.server");
      const adapter = getVideoAdapter(row.provider);
      if (!adapter) {
        throw new Error(
          `Video generation for "${row.provider}" isn't wired up yet. Supported providers: ${supportedVideoKinds().join(", ")} — connect one of those in Connections.`,
        );
      }
      let refImage: { bytesBase64Encoded: string; mimeType: string } | undefined;
      if (data.referenceImageDataUrl)
        refImage = parseReferenceImageDataUrl(data.referenceImageDataUrl);
      else if (data.referenceImageUrl) refImage = await fetchAsBase64(data.referenceImageUrl);
      // Each provider renders a different duration envelope (Veo tops out at
      // 8s, Kling/Seedance reach 15s); clamp instead of failing the request.
      const { clampDurationForProvider } = await import("./video-caps");
      const { operationName, model } = await adapter.start(row, apiKey, {
        prompt: data.prompt,
        aspectRatio: data.aspectRatio,
        durationSec: clampDurationForProvider(row.provider, data.durationSec),
        refImage,
      });
      return {
        operationName,
        providerKind: row.provider,
        model,
      };
    },
  );

// ---------- prompt enhancement (meta-prompting) --------------------------

const enhanceInput = z.object({
  prompt: z.string().min(3).max(4000),
  aspectRatio: z.enum(["16:9", "9:16"]).default("9:16"),
  durationSec: z.number().int().min(2).max(20).default(8),
  hasReference: z.boolean().default(false),
  brandContext: z.string().max(2000).optional(),
});

export const enhanceVideoPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => enhanceInput.parse(d))
  .handler(async ({ data, context }): Promise<{ prompt: string }> => {
    const { resolveChatModelForCaller, currentWorkspaceId } =
      await import("@/lib/llm-resolver.server");
    const { playbookBlock } = await import("@/lib/playbooks.server");
    const { generateText } = await import("ai");

    // Resolve the caller's real workspace: passing null here ignored any
    // workspace playbook overrides or disables. Exact-topic mode keeps the
    // always-loaded operator manifest out of this raw prompt-engineering call.
    // Caps: this function IS the video capability.
    const wsId = await currentWorkspaceId(context.supabase as never);
    const videoRules = await playbookBlock(
      context.supabase as never,
      wsId,
      ["video"],
      { video: true },
      { exact: true },
    );
    const system = [
      videoRules,
      "You are a film director writing a shot for text-to-video models (Veo, Gemini Omni Flash, Seedance, Kling, Runway Gen-4.5).",
      "Rewrite the user's brief into ONE dense paragraph following the playbook above: first-frame occupancy (subject already in frame one, mid-action), measurable blocking with body orientation and gaze, action described as states not transitions, one lens character stated as its visible outcome (not lens metadata), a lighting lock (source, direction, camera side), one physics cause-and-effect detail, and a short palette line.",
      "Positive language only — describe what is wanted, never what to avoid. No aspect ratio, duration, or resolution inside the text; those are parameters.",
      "Keep it under 120 words, no headings, no lists, no quotes, no preambles. Return ONLY the enhanced prompt text.",
      data.hasReference
        ? "A reference image is attached; it is frame one — preserve identity, product, and framing, and describe how the scene moves from that image."
        : "",
      data.brandContext ? `Brand voice/visual notes to respect: ${data.brandContext}` : "",
      `Target: ${data.aspectRatio}, ~${data.durationSec}s (parameters only — do not write them into the prompt).`,
    ]
      .filter(Boolean)
      .join(" ");

    const { model } = await resolveChatModelForCaller(context.supabase as never);
    const { text } = await generateText({
      model,
      system,
      prompt: data.prompt,
      maxOutputTokens: 600,
    });
    const out = text.trim();
    if (!out) throw new Error("Enhancer returned an empty response.");
    return { prompt: out };
  });

// ---------- poll (and finalize) ------------------------------------------

const pollInput = z.object({
  workspaceId: z.string().uuid(),
  providerId: z.string().uuid(),
  operationName: z.string().min(4).max(1000),
});

export const pollVideoGeneration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => pollInput.parse(d))
  .handler(
    async ({
      data,
      context,
    }): Promise<
      | { status: "pending"; progress?: number }
      | { status: "error"; message: string }
      | { status: "done"; signedUrl: string; mimeType: string; sizeBytes: number }
    > => {
      const { row, apiKey } = await loadProvider(context, data.providerId);
      if (row.workspace_id !== data.workspaceId)
        throw new Error("Provider does not belong to this workspace.");
      const { getVideoAdapter } = await import("./video-adapters.server");
      const adapter = getVideoAdapter(row.provider);
      if (!adapter) throw new Error(`Polling for "${row.provider}" isn't implemented yet.`);
      const result = await adapter.poll(row, apiKey, data.operationName);
      if (result.status !== "done") return result;
      const { bytes, mimeType } = result;
      const { signedUrl, sizeBytes } = await persistVideoToStorage(
        data.workspaceId,
        bytes,
        mimeType,
      );
      // Activity trail: video generation is a paid, agent-visible action, so it
      // must leave a row in the workspace log. Best-effort — a logging failure
      // must never eat a finished (and paid-for) video.
      try {
        const { error: logError } = await (context.supabase as any).from("activity_log").insert({
          workspace_id: data.workspaceId,
          actor_type: "agent",
          action: "video.generated",
          status: "ok",
          summary: `Generated a video (${row.provider}, ${mimeType}, ${(sizeBytes / 1e6).toFixed(1)}MB)`,
          details: {
            operationName: data.operationName,
            provider: row.provider,
            model: row.default_model || row.provider,
            sizeBytes,
            mimeType,
          },
        });
        if (logError) console.warn("[video-gen] activity_log insert failed:", logError.message);
      } catch (e) {
        console.warn("[video-gen] activity_log insert failed:", e instanceof Error ? e.message : e);
      }
      return { status: "done", signedUrl, mimeType, sizeBytes };
    },
  );
