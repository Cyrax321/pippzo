// Bring-your-own-key image generation adapters (server only).
// Supported: OpenAI Images API (gpt-image-2.5-sunburst / gpt-image-1), Google
// Gemini "Nano Banana" image models via generateContent, and Azure OpenAI image
// deployments (same request shape as OpenAI, different auth header and a
// required api-version query parameter).

import { fetchWithTimeout, FetchTimeoutError, FETCH_TIMEOUT } from "@/lib/fetch-timeout";

export type ImageProviderRow = {
  id: string;
  provider: string;
  label: string;
  api_key: string;
  base_url: string | null;
  default_model: string | null;
};

const AZURE_IMAGE_API_VERSION = "2024-02-01";

export type GenResult = { b64?: string; error?: string; referencesUsed?: number };

/**
 * Aspect ratios the OpenAI/Azure image endpoints actually accept. There is no
 * exact 4:5 — `portrait` is 2:3, the closest tall format available, so a prompt
 * asking for 4:5 gets portrait rather than being silently squared off.
 */
export type Aspect = "square" | "portrait" | "landscape";

const SIZE_BY_ASPECT: Record<Aspect, string> = {
  square: "1024x1024",
  portrait: "1024x1536",
  landscape: "1536x1024",
};

export type GenOptions = { aspect?: Aspect };

const DEFAULTS = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-image-2.5-sunburst" },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com",
    model: "gemini-3.1-flash-image",
  },
} as const;

function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

async function generateOpenAI(
  row: ImageProviderRow,
  prompt: string,
  references: string[],
  opts?: GenOptions,
): Promise<GenResult> {
  const base = (row.base_url || DEFAULTS.openai.baseUrl).replace(/\/+$/, "");
  const model = row.default_model || DEFAULTS.openai.model;
  const size = SIZE_BY_ASPECT[opts?.aspect ?? "square"];

  // With reference images, use the edits endpoint (multipart); otherwise generations.
  if (references.length) {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("size", size);
    let attached = 0;
    for (const ref of references.slice(0, 4)) {
      const parsed = parseDataUrl(ref);
      if (!parsed) {
        // Silently skipping a reference is how "I passed your references" ends
        // up being false. Say so.
        console.warn("[byo-image] reference skipped — not a base64 data URL");
        continue;
      }
      // Same hand-rolled-decode issue as the encode sites below (docs/bugs.md
      // finding 20): `Uint8Array.from(atob(...), c => c.charCodeAt(0))` maps
      // one JS function call per byte. Reference images are capped at 4 per
      // call and are typically small, but there is no reason to pay the same
      // per-byte cost here when Buffer.from(..., "base64") decodes natively.
      const bytes = Buffer.from(parsed.data, "base64");
      // Extension must match the actual mime type, or the API can reject the part.
      const ext = parsed.mimeType.split("/")[1]?.split("+")[0] || "png";
      form.append(
        "image[]",
        new Blob([bytes], { type: parsed.mimeType }),
        `reference-${attached}.${ext}`,
      );
      attached++;
    }
    if (attached === 0) {
      return {
        error:
          "None of the reference images could be read, so the result would ignore them. Re-upload them in the library.",
      };
    }
    const res = await fetchWithTimeout(
      `${base}/images/edits`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${row.api_key}` },
        body: form,
      },
      { timeoutMs: FETCH_TIMEOUT.inference, label: "OpenAI" },
    );
    if (!res.ok) {
      console.error("[byo-image] openai edits error", res.status, await res.text().catch(() => ""));
      return { error: `OpenAI image edit failed (${res.status}).` };
    }
    const json = (await res.json()) as {
      data?: Array<{ b64_json?: string }>;
      usage?: { input_tokens_details?: { image_tokens?: number } };
    };
    const b64 = json.data?.[0]?.b64_json;
    // image_tokens > 0 proves the references were actually ingested, not just posted.
    console.info(
      `[byo-image] openai edits ok · model=${model} size=${size} references=${attached} imageTokensIn=${json.usage?.input_tokens_details?.image_tokens ?? "?"}`,
    );
    return b64 ? { b64, referencesUsed: attached } : { error: "OpenAI returned no image." };
  }

  const res = await fetchWithTimeout(
    `${base}/images/generations`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${row.api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, size, n: 1 }),
    },
    { timeoutMs: FETCH_TIMEOUT.inference, label: "OpenAI" },
  );
  if (!res.ok) {
    console.error("[byo-image] openai error", res.status, await res.text().catch(() => ""));
    return { error: `OpenAI image generation failed (${res.status}).` };
  }
  const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const item = json.data?.[0];
  if (item?.b64_json) return { b64: item.b64_json };
  if (item?.url) {
    const img = await fetchWithTimeout(
      item.url,
      {},
      { timeoutMs: FETCH_TIMEOUT.download, label: "OpenAI (image download)" },
    );
    const buf = new Uint8Array(await img.arrayBuffer());
    // Buffer.from(...).toString("base64") instead of the byte-at-a-time
    // String.fromCharCode(...) + btoa() loop this used to be: measured at
    // roughly 300-450x faster and, unlike the loop, does not run synchronously
    // on Node's single thread for the ~1.4s a 32MB image took (docs/bugs.md
    // finding 20) — this sits on the daily_post automation path, so that was
    // 1.4s of the whole cron tick blocked on one image download.
    return { b64: Buffer.from(buf).toString("base64") };
  }
  return { error: "OpenAI returned no image." };
}

/**
 * Azure OpenAI image deployments. The body matches OpenAI's images API, but the
 * key travels in an `api-key` header and the endpoint needs an explicit
 * api-version. base_url is the deployment root, e.g.
 * https://<resource>.cognitiveservices.azure.com/openai/deployments/gpt-image-2-2
 */
async function generateAzure(
  row: ImageProviderRow,
  prompt: string,
  opts?: GenOptions,
): Promise<GenResult> {
  const base = (row.base_url || "").replace(/\/+$/, "");
  if (!base) {
    return { error: `"${row.label}" needs its Azure endpoint before it can generate images.` };
  }
  const url = `${base}/images/generations?api-version=${AZURE_IMAGE_API_VERSION}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": row.api_key },
      body: JSON.stringify({
        prompt,
        size: SIZE_BY_ASPECT[opts?.aspect ?? "square"],
        quality: "medium",
        output_format: "png",
        n: 1,
      }),
    },
    { timeoutMs: FETCH_TIMEOUT.inference, label: "Azure" },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[byo-image] azure error", res.status, detail);
    return { error: `Azure image generation failed (${res.status}).` };
  }
  const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const item = json.data?.[0];
  if (item?.b64_json) return { b64: item.b64_json };
  if (item?.url) {
    const img = await fetchWithTimeout(
      item.url,
      {},
      { timeoutMs: FETCH_TIMEOUT.download, label: "Azure (image download)" },
    );
    const buf = new Uint8Array(await img.arrayBuffer());
    // Buffer.from(...).toString("base64") instead of the byte-at-a-time
    // String.fromCharCode(...) + btoa() loop this used to be: measured at
    // roughly 300-450x faster and, unlike the loop, does not run synchronously
    // on Node's single thread for the ~1.4s a 32MB image took (docs/bugs.md
    // finding 20) — this sits on the daily_post automation path, so that was
    // 1.4s of the whole cron tick blocked on one image download.
    return { b64: Buffer.from(buf).toString("base64") };
  }
  return { error: "Azure returned no image." };
}

async function generateGemini(
  row: ImageProviderRow,
  prompt: string,
  references: string[],
): Promise<GenResult> {
  const base = (row.base_url || DEFAULTS.gemini.baseUrl).replace(/\/+$/, "");
  const model = row.default_model || DEFAULTS.gemini.model;
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  // Count the reference parts actually appended: the caller reports this
  // number to the user, and a reference that failed to parse must not be
  // claimed as applied.
  let attached = 0;
  for (const ref of references.slice(0, 4)) {
    const parsed = parseDataUrl(ref);
    if (!parsed) {
      console.warn("[byo-image] gemini reference skipped — not a base64 data URL");
      continue;
    }
    parts.push({ inline_data: { mime_type: parsed.mimeType, data: parsed.data } });
    attached++;
  }

  const res = await fetchWithTimeout(
    `${base}/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": row.api_key, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] }),
    },
    { timeoutMs: FETCH_TIMEOUT.inference, label: "Gemini" },
  );
  if (!res.ok) {
    console.error("[byo-image] gemini error", res.status, await res.text().catch(() => ""));
    return { error: `Gemini image generation failed (${res.status}).` };
  }
  const json = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ inlineData?: { data?: string }; inline_data?: { data?: string } }>;
      };
    }>;
  };
  for (const p of json.candidates?.[0]?.content?.parts ?? []) {
    const b64 = p.inlineData?.data ?? p.inline_data?.data;
    if (b64) return { b64, referencesUsed: attached };
  }
  return { error: "Gemini returned no image." };
}

export async function generateWithProvider(
  row: ImageProviderRow,
  prompt: string,
  references: string[],
  opts?: GenOptions,
): Promise<GenResult> {
  try {
    if (row.provider === "openai") return await generateOpenAI(row, prompt, references, opts);
    if (row.provider === "gemini") return await generateGemini(row, prompt, references);
    if (row.provider === "azure") {
      // Azure image deployments have no image-to-image endpoint here. Say so
      // rather than returning a reference-free image as if it honoured them.
      if (references.length) {
        return {
          error:
            "This Azure image deployment cannot use reference images. Connect an OpenAI or Gemini image provider for image-to-image, or generate without references.",
        };
      }
      return await generateAzure(row, prompt, opts);
    }
    return { error: `Unsupported provider "${row.provider}".` };
  } catch (e) {
    if (e instanceof FetchTimeoutError) {
      // Image generation is paid work; do not collapse the timeout into a
      // generic message. The caller needs to know which service stalled and
      // that the render may have started anyway.
      console.error("[byo-image] provider call timed out", e.message);
      return { error: e.message };
    }
    console.error("[byo-image] provider call failed", e instanceof Error ? e.message : e);
    return { error: "Provider request failed." };
  }
}
