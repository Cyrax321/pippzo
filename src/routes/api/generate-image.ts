import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { playbookBlock } from "@/lib/playbooks.server";
import { requireAuthFromRequest, userClientFromRequest } from "@/lib/require-auth.server";
import { parseImageDataUrl, type MediaError } from "@/lib/media-validate";
// Type-only: erased at build time, so the server-only module is never bundled.
import type { Aspect, ImageProviderRow } from "@/lib/image-gen.server";

/** How many approved assets to attach when the caller passes none. */
const AUTO_REFERENCE_COUNT = 3;

const NO_PROVIDER =
  "No image provider connected. Add your own OpenAI, Gemini or Azure image key in Settings → Connections.";

// This route used to read the body as `(await request.json()) as Body` — no
// runtime check on anything, so prompt/styleNotes length and the number and
// size of references were all unbounded (docs/bugs.md finding 25). Real
// limits, chosen from what the codebase actually asks of this route:
//
// - MAX_PROMPT_CHARS matches the cap video-gen.functions.ts already puts on
//   its own model prompt (z.string().min(3).max(4000)) — same shape of input,
//   same ceiling, rather than inventing a second number.
// - MAX_STYLE_NOTES_CHARS is generous because this field is brand-authored
//   prose (a guideline's visualDirection), not free user text, but it still
//   needs a real ceiling rather than none.
// - MAX_REFERENCES: both callers already cap the user-facing choice at 4
//   (library.tsx's `.slice(-4)`, chat.tsx's `.slice(0, 4)`), and only the
//   first 4 are ever used downstream (image-gen.server.ts:68,212). 6 leaves
//   a little headroom for programmatic callers without accepting an
//   unbounded array.
// - Each reference is validated as an image via media-validate.ts
//   (parseImageDataUrl) rather than a new size/type check: 15MB decoded,
//   sniffed from content rather than trusting the declared type, string
//   length checked before it is ever decoded.
const MAX_PROMPT_CHARS = 4000;
const MAX_STYLE_NOTES_CHARS = 6000;
const MAX_REFERENCES = 6;

const BodySchema = z.object({
  prompt: z
    .string()
    .min(1, "Describe the image you want.")
    .max(MAX_PROMPT_CHARS, `The prompt is longer than the ${MAX_PROMPT_CHARS}-character limit.`),
  references: z
    .array(z.string())
    .max(
      MAX_REFERENCES,
      `Send at most ${MAX_REFERENCES} reference images — send fewer and try again.`,
    )
    .optional(),
  styleNotes: z
    .string()
    .max(
      MAX_STYLE_NOTES_CHARS,
      `Style notes are longer than the ${MAX_STYLE_NOTES_CHARS}-character limit.`,
    )
    .optional(),
  workspaceId: z.string().uuid().optional(),
  providerId: z.string().uuid().optional(),
  aspect: z.enum(["square", "portrait", "landscape"]).optional(),
  /**
   * Set true only when the result should deliberately NOT look like the brand's
   * approved work (a one-off, an experiment). Otherwise approved library assets
   * are attached automatically — see loadApprovedReferences.
   */
  ignoreBrandReferences: z.boolean().optional(),
});

type Body = z.infer<typeof BodySchema>;

/**
 * Validates a raw request body against BodySchema, then validates each
 * reference as a real image (media-validate.ts). Pulled out as its own pure
 * function — no request, no auth, no network — so the limits above are unit
 * testable without a live model or database, and so the route handler is a
 * thin wrapper around it.
 */
export function parseGenerateImageBody(json: unknown): { ok: true; body: Body } | MediaError {
  const parsedBody = BodySchema.safeParse(json);
  if (!parsedBody.success) {
    return { ok: false, error: parsedBody.error.issues[0]?.message ?? "Invalid request body." };
  }
  const body = parsedBody.data;
  for (const [i, ref] of (body.references ?? []).entries()) {
    const parsedRef = parseImageDataUrl(ref);
    if (!parsedRef.ok) {
      return { ok: false, error: `Reference image ${i + 1}: ${parsedRef.error}` };
    }
  }
  return { ok: true, body };
}

function sseImage(
  b64: string,
  meta?: { referencesUsed?: number; autoAttached?: number },
): Response {
  const body = `event: image_generation.completed\ndata: ${JSON.stringify({ b64_json: b64 })}\n\ndata: [DONE]\n\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      // How many references the provider actually ingested, and how many of those
      // the server attached on the caller's behalf. Lets the caller report the
      // truth instead of assuming its own request was honoured.
      "X-References-Used": String(meta?.referencesUsed ?? 0),
      "X-References-Auto-Attached": String(meta?.autoAttached ?? 0),
      "Access-Control-Expose-Headers": "X-References-Used, X-References-Auto-Attached",
    },
  });
}

/**
 * Loads the workspace's approved library assets to use as style references.
 *
 * Approved images outrank the written visual direction. A workspace's approved
 * assets are the work their own designer produced and they signed off on; the
 * guide is only a prose description of that work, and prose drifts. When the two
 * disagree, the images are right — so they are attached by default rather than
 * only when someone remembers to ask.
 *
 * Newest first, on the assumption the most recent approvals reflect the current
 * look. Only base64 data URLs are usable as references.
 */
async function loadApprovedReferences(
  // Structurally typed rather than SupabaseClient<...>: the generated Database
  // types make the concrete client type awkward to name at this call site.
  supabase: { from: (table: string) => any },
  workspaceId: string,
  limit: number,
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("brand_images")
      .select("url,kind,created_at")
      .eq("workspace_id", workspaceId)
      .eq("approved", true)
      .order("created_at", { ascending: false })
      .limit(limit * 3);
    if (error) {
      console.warn("[generate-image] approved-reference lookup failed:", error.message);
      return [];
    }
    // Both shapes have to work: rows written before wave 4 hold the image
    // inline as a data URL, rows written since point at Supabase Storage
    // (finding 8). Filtering for a data URL — as this did — silently matched
    // nothing for every newly uploaded image, so auto-attached references
    // quietly stopped working rather than failing visibly.
    const { resolveReferenceDataUrls } = await import("@/lib/media-reference.server");
    return await resolveReferenceDataUrls(
      supabase as never,
      (data ?? []) as Array<{ url: string | null; kind: string | null }>,
      limit,
    );
  } catch (e) {
    console.warn(
      "[generate-image] approved-reference lookup threw",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}

/**
 * Generates through the workspace's own image provider. This is the only path:
 * there is no shared platform account to fall back to.
 */
async function generate(
  request: Request,
  prompt: string,
  references: string[],
  workspaceId?: string,
  providerId?: string,
  aspect?: Aspect,
  autoReferences?: boolean,
): Promise<{ b64: string; referencesUsed?: number; autoAttached?: number } | { error: string }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const token = request.headers.get("authorization")?.slice("Bearer ".length).trim();
  if (!url || !key || !token) return { error: "Server misconfigured." };

  let rows: unknown[] | null = null;
  let autoAttached = 0;
  let effectiveRefs = references;
  // The provider row is looked up BEFORE auto-attaching approved references:
  // Azure deployments hard-fail on any reference, so attaching them on the
  // caller's behalf would make the default path un-generatable for an Azure
  // workspace with approved assets. Explicit references still flow through and
  // produce the clear "Azure cannot use references" error — the user asked for
  // something the provider cannot do; the automatic path must not self-destruct.
  try {
    const supabase = createClient(url, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    let q = supabase.from("image_providers").select("*");
    if (providerId) q = q.eq("id", providerId);
    else if (workspaceId) q = q.eq("workspace_id", workspaceId);
    const { data, error } = await q
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) {
      console.error("[generate-image] provider lookup failed:", error.message);
      return { error: "Could not read your image provider settings." };
    }
    rows = data;

    const provider = (rows?.[0] as ImageProviderRow | undefined)?.provider;
    // No explicit references and the caller did not opt out: fall back to the
    // brand's own approved work so "on brand" is the default, not something the
    // agent has to remember to ask for.
    if (effectiveRefs.length === 0 && autoReferences && workspaceId) {
      if (provider === "azure") {
        console.info(
          "[generate-image] skipping auto-attach: references not supported on this provider (azure)",
        );
      } else {
        effectiveRefs = await loadApprovedReferences(supabase, workspaceId, AUTO_REFERENCE_COUNT);
        autoAttached = effectiveRefs.length;
        if (autoAttached)
          console.info(`[generate-image] auto-attached ${autoAttached} approved reference(s)`);
      }
    }
  } catch (e) {
    console.error("[generate-image] provider lookup threw", e instanceof Error ? e.message : e);
    return { error: "Could not read your image provider settings." };
  }

  if (!rows?.length) return { error: NO_PROVIDER };

  const { readProviderKey } = await import("@/lib/crypto.server");
  const { generateWithProvider } = await import("@/lib/image-gen.server");

  const row = rows[0] as ImageProviderRow & { api_key_enc?: string | null };
  // Rows may hold the key encrypted (api_key_enc) or as legacy plaintext.
  const apiKey = await readProviderKey(row);
  if (!apiKey) {
    return {
      error: `"${row.label}" has no usable API key saved. Re-enter it in Settings → Connections.`,
    };
  }

  const res = await generateWithProvider({ ...row, api_key: apiKey }, prompt, effectiveRefs, {
    aspect,
  });
  if (res.b64) return { b64: res.b64, referencesUsed: res.referencesUsed, autoAttached };
  console.error("[generate-image] provider failed:", res.error);
  return { error: res.error ?? "Image generation failed." };
}

export const Route = createFileRoute("/api/generate-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireAuthFromRequest(request);
        if ("response" in auth) return auth.response;

        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return new Response("Request body must be valid JSON.", { status: 400 });
        }
        const validated = parseGenerateImageBody(json);
        if (!validated.ok) {
          // 400 with the real reason, same as the generation-failure path
          // below: the UI shows this verbatim.
          return new Response(validated.error, { status: 400 });
        }
        const body = validated.body;

        // Exact-topic mode: this prompt is fed raw to an image model, so only
        // the image playbook belongs in it. Without `exact` the always-loaded
        // operator manifest and writing rules would be concatenated into the
        // image prompt. Caps: this route IS the image capability.
        const imageRules = await playbookBlock(
          userClientFromRequest(request) as never,
          body.workspaceId ?? null,
          ["image"],
          { image: true },
          { exact: true },
        );
        const autoReferences = body.ignoreBrandReferences !== true;
        const willHaveReferences = (body.references?.length ?? 0) > 0 || autoReferences;

        // Precedence matters here, and it is deliberate.
        //
        // When reference images are attached they are the authority: they are the
        // brand's own approved work, usually made by their designer. The written
        // visual direction is only a prose description of that work, and prose
        // drifts — it is demoted to supporting notes that apply where they do not
        // contradict the images. Getting this the wrong way round is what made
        // generated visuals ignore approved assets.
        //
        // "Avoid text" is deliberately absent: it used to be appended to every
        // prompt and fought brands whose identity is a large typographic headline.
        //
        // The tech-product clause guards against image models drifting toward
        // generic gadget photography when the brand is not a hardware brand.
        const referenceNote = willHaveReferences
          ? "\n\nSOURCE OF TRUTH: the attached reference images. They are this brand's approved work. Replicate their visual language closely — subject matter (including whether people appear, and how they are framed), crop, lighting, colour palette, typographic treatment and overall finish. Where the written notes below disagree with the reference images, the images win. Change only what this prompt explicitly asks to change."
          : "";
        const styleNote = body.styleNotes
          ? `\n\n${willHaveReferences ? "Supporting brand notes (apply only where they do not contradict the reference images)" : "Brand visual direction"}: ${body.styleNotes}`
          : "";
        const fullPrompt = `${body.prompt}${referenceNote}${styleNote}${imageRules ? `\n\n${imageRules}` : ""}\n\nDo NOT include gaming PCs, RGB lighting, computer cases, keyboards, or any tech-product photography unless the prompt explicitly asks for them.`;

        const result = await generate(
          request,
          fullPrompt,
          body.references ?? [],
          body.workspaceId,
          body.providerId,
          body.aspect,
          autoReferences,
        );

        if ("error" in result) {
          // 400 with the real reason: the UI shows this verbatim, so "why did
          // nothing happen" is answerable without opening the server logs.
          return new Response(result.error, { status: 400 });
        }
        return sseImage(result.b64, {
          referencesUsed: result.referencesUsed,
          autoAttached: result.autoAttached,
        });
      },
    },
  },
});
