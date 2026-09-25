// Video generation adapters — one per provider kind. Server-only.
//
// Every adapter speaks the same tiny contract so the server functions in
// video-gen.functions.ts can stay provider-agnostic:
//   start(row, apiKey, args)  -> { operationName, model }   (kick off a job)
//   poll(row, apiKey, opName) -> pending | error | done+bytes (one poll step)
//
// `operationName` is an opaque string owned by the adapter (a Google operation
// path, an interaction id, a task id…). The poll step downloads the finished
// video itself because auth for the download differs per provider.

import { fetchWithTimeout, FETCH_TIMEOUT } from "@/lib/fetch-timeout";

export type RefImage = { bytesBase64Encoded: string; mimeType: string };

export type ProviderRow = {
  id: string;
  workspace_id: string;
  provider: string;
  label: string;
  api_key: string;
  api_key_enc: string | null;
  base_url: string | null;
  default_model: string | null;
};

export type StartArgs = {
  prompt: string;
  aspectRatio: "16:9" | "9:16";
  durationSec: number;
  refImage?: RefImage;
};

export type PollOutcome =
  | { status: "pending"; progress?: number }
  | { status: "error"; message: string }
  | { status: "done"; bytes: Uint8Array; mimeType: string };

export type VideoAdapter = {
  start(
    row: ProviderRow,
    apiKey: string,
    args: StartArgs,
  ): Promise<{ operationName: string; model: string }>;
  poll(row: ProviderRow, apiKey: string, operationName: string): Promise<PollOutcome>;
};

// A poll is a quick status check made repeatedly while a job runs. It must
// stay short: a hung poll blocks the loop that is supposed to be watching
// progress, and the caller just tries again shortly after. This is
// deliberately much tighter than FETCH_TIMEOUT.api, which is sized for
// one-shot calls, not a loop.
const POLL_TIMEOUT_MS = 15_000;

async function fetchJson(
  url: string,
  init: RequestInit,
  label: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; text: string; json: any }> {
  const res = await fetchWithTimeout(url, init, { timeoutMs, label });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body kept in text */
  }
  if (!res.ok && (res.status === 401 || res.status === 403)) {
    throw new Error(`${label} rejected the API key [${res.status}]: ${text.slice(0, 300)}`);
  }
  return { ok: res.ok, status: res.status, text, json };
}

// Provider poll responses hand back a URL to fetch the finished clip. A
// malicious or compromised provider endpoint could point that at an internal
// address (cloud metadata 169.254.169.254, localhost service ports) to make
// the server fetch it — and for Veo we attach the Google API key to that
// request. Require https to a public host before fetching.
function assertSafeDownloadUrl(url: string, label: string): void {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") throw new Error(`${label} returned a non-https download URL.`);
    host = u.hostname.toLowerCase();
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : `${label} returned an invalid download URL.`);
  }
  const isPrivate =
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host === "169.254.169.254" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^(0\.|::$|fc|fd)/.test(host);
  if (isPrivate)
    throw new Error(`${label} tried to serve media from a private address (${host}); refused.`);
}

async function downloadBytes(
  url: string,
  headers: Record<string, string>,
  label: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  assertSafeDownloadUrl(url, label);
  // Finished clips can be large; give the download real headroom, distinct
  // from the short deadline used for status polling above.
  const res = await fetchWithTimeout(
    url,
    { headers },
    { timeoutMs: FETCH_TIMEOUT.download, label },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${label} download failed [${res.status}]: ${text.slice(0, 300)}`);
  }
  const mimeType = res.headers.get("content-type") || "video/mp4";
  return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType };
}

// ============================================================ Google Veo 3.1

const GOOGLE_BASE = "https://generativelanguage.googleapis.com";
const VEO_DEFAULT_MODEL = "veo-3.1-generate-preview";
// Veo 3.0 was shut down by Google on 2026-06-30 — silently upgrade old configs.
const VEO_DEAD_MODELS = new Set([
  "veo-3.0-generate-001",
  "veo-3.0-generate-preview",
  "veo-2.0-generate-001",
]);

function veoModelCandidates(defaultModel: string | null): string[] {
  const configured = (defaultModel || "").trim();
  if (!configured || VEO_DEAD_MODELS.has(configured)) return [VEO_DEFAULT_MODEL];
  return configured === VEO_DEFAULT_MODEL ? [VEO_DEFAULT_MODEL] : [configured, VEO_DEFAULT_MODEL];
}

export const veoAdapter: VideoAdapter = {
  async start(row, apiKey, args) {
    const base = (row.base_url || GOOGLE_BASE).replace(/\/+$/, "");
    const instance: Record<string, unknown> = { prompt: args.prompt };
    if (args.refImage) {
      instance.image = {
        inlineData: { mimeType: args.refImage.mimeType, data: args.refImage.bytesBase64Encoded },
      };
    }
    // Veo only accepts 4, 6 or 8 — snap anything else to the nearest step.
    const veoSec = [4, 6, 8].reduce((best, s) =>
      Math.abs(s - args.durationSec) < Math.abs(best - args.durationSec) ? s : best,
    );
    const body = {
      instances: [instance],
      parameters: { aspectRatio: args.aspectRatio, durationSeconds: String(veoSec) },
    };
    const errors: string[] = [];
    for (const model of veoModelCandidates(row.default_model)) {
      const out = await fetchJson(
        `${base}/v1beta/models/${encodeURIComponent(model)}:predictLongRunning`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(body),
        },
        "Veo",
        FETCH_TIMEOUT.api,
      );
      if (out.ok) {
        if (!out.json?.name)
          throw new Error(
            `Veo did not return an operation name. Response: ${out.text.slice(0, 300)}`,
          );
        return { operationName: out.json.name as string, model };
      }
      errors.push(`${model}: [${out.status}] ${out.text.slice(0, 300)}`);
    }
    throw new Error(
      `Veo could not start ("${VEO_DEFAULT_MODEL}"). A 404 usually means the Gemini API key does not have Veo access for that account/region. Details: ${errors.join(" | ")}`,
    );
  },

  async poll(row, apiKey, operationName) {
    const base = (row.base_url || GOOGLE_BASE).replace(/\/+$/, "");
    const out = await fetchJson(
      `${base}/v1beta/${operationName.replace(/^\/+/, "")}`,
      { headers: { "x-goog-api-key": apiKey } },
      "Veo",
      POLL_TIMEOUT_MS,
    );
    if (!out.ok) throw new Error(`Veo poll failed [${out.status}]: ${out.text.slice(0, 500)}`);
    const json = out.json ?? {};
    if (!json.done) return { status: "pending", progress: json.metadata?.progressPercentage };
    if (json.error)
      return { status: "error", message: json.error.message ?? "Veo returned an error." };
    const sample = json.response?.generateVideoResponse?.generatedSamples?.[0]?.video;
    if (!sample?.uri) return { status: "error", message: "Veo returned no video sample." };
    // Only attach the API key when the file actually lives on Google — a
    // sample.uri pointing elsewhere must never receive the caller's key.
    const sampleHost = (() => {
      try {
        return new URL(sample.uri).hostname.toLowerCase();
      } catch {
        return "";
      }
    })();
    const veoHeaders: Record<string, string> = /(^|\.)(googleapis\.com|google\.com)$/.test(
      sampleHost,
    )
      ? { "x-goog-api-key": apiKey }
      : {};
    const dl = await downloadBytes(sample.uri, veoHeaders, "Veo");
    return { status: "done", bytes: dl.bytes, mimeType: sample.mimeType || dl.mimeType };
  },
};

// ================================================== Gemini Omni Flash (2026)

// Conversational video model on the Interactions API — a different pipeline
// from Veo: POST /v1beta/interactions with background execution, poll the
// interaction, then fetch the finished clip through the Files API.
const OMNI_DEFAULT_MODEL = "gemini-omni-flash-preview";

// Deep-search an interaction response for the model's video output. The docs
// show it under steps[] -> model_output -> content[] -> {type:"video"}, but we
// stay tolerant of wrapper differences ("output_video" convenience field etc.).
function findVideoContent(
  node: unknown,
): { data?: string; uri?: string; mimeType?: string } | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findVideoContent(item);
      if (hit) return hit;
    }
    return null;
  }
  const obj = node as Record<string, any>;
  if (obj.type === "video" && (obj.data || obj.uri)) {
    return { data: obj.data, uri: obj.uri, mimeType: obj.mime_type || obj.mimeType };
  }
  if (obj.output_video && (obj.output_video.data || obj.output_video.uri)) {
    const v = obj.output_video;
    return { data: v.data, uri: v.uri, mimeType: v.mime_type || v.mimeType };
  }
  for (const key of ["steps", "content", "output", "response"]) {
    if (obj[key]) {
      const hit = findVideoContent(obj[key]);
      if (hit) return hit;
    }
  }
  return null;
}

export const omniAdapter: VideoAdapter = {
  async start(row, apiKey, args) {
    const base = (row.base_url || GOOGLE_BASE).replace(/\/+$/, "");
    const model = (row.default_model || "").trim() || OMNI_DEFAULT_MODEL;
    // No documented duration parameter in the preview REST surface — the model
    // works a 3-10s envelope steered by the prompt, so we fold it in there.
    const prompt = `${args.prompt}\n\nTarget clip length: about ${args.durationSec} seconds.`;
    const body: Record<string, unknown> = {
      model,
      background: true,
      response_format: { type: "video", aspect_ratio: args.aspectRatio, delivery: "uri" },
      input: args.refImage
        ? [
            {
              type: "image",
              data: args.refImage.bytesBase64Encoded,
              mime_type: args.refImage.mimeType,
            },
            { type: "text", text: prompt },
          ]
        : prompt,
      ...(args.refImage ? { generation_config: { video_config: { task: "image_to_video" } } } : {}),
    };
    const out = await fetchJson(
      `${base}/v1beta/interactions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      },
      "Gemini Omni Flash",
      FETCH_TIMEOUT.api,
    );
    if (!out.ok) {
      throw new Error(
        `Gemini Omni Flash could not start [${out.status}]. A 404 usually means the key's account does not have the Interactions API / "${model}" enabled. Raw: ${out.text.slice(0, 300)}`,
      );
    }
    const id = out.json?.id;
    if (!id)
      throw new Error(
        `Gemini Omni Flash did not return an interaction id. Response: ${out.text.slice(0, 300)}`,
      );
    return { operationName: String(id), model };
  },

  async poll(row, apiKey, operationName) {
    const base = (row.base_url || GOOGLE_BASE).replace(/\/+$/, "");
    const headers = { "x-goog-api-key": apiKey };
    const out = await fetchJson(
      `${base}/v1beta/interactions/${encodeURIComponent(operationName)}`,
      { headers },
      "Gemini Omni Flash",
      POLL_TIMEOUT_MS,
    );
    if (!out.ok)
      throw new Error(`Gemini Omni Flash poll failed [${out.status}]: ${out.text.slice(0, 500)}`);
    const json = out.json ?? {};
    const status = String(json.status ?? "");
    if (status === "queued" || status === "in_progress" || status === "")
      return { status: "pending" };
    if (status !== "completed") {
      const detail = json.error?.message || json.incomplete_details?.reason || "";
      return {
        status: "error",
        message: `Gemini Omni Flash ended with status "${status}"${detail ? `: ${detail}` : "."}`,
      };
    }
    const video = findVideoContent(json);
    if (!video)
      return {
        status: "error",
        message: "Gemini Omni Flash completed but returned no video output.",
      };
    if (video.data) {
      return {
        status: "done",
        bytes: new Uint8Array(Buffer.from(video.data, "base64")),
        mimeType: video.mimeType || "video/mp4",
      };
    }
    // delivery:"uri" hands back a Files API reference — it may still be
    // processing right after completion, in which case we stay pending.
    const uri = String(video.uri);
    const fileUrl = uri.startsWith("http") ? uri : `${base}/v1beta/${uri.replace(/^\/+/, "")}`;
    const meta = await fetchJson(fileUrl, { headers }, "Gemini Omni Flash", POLL_TIMEOUT_MS);
    const state = String(meta.json?.state ?? "");
    if (meta.ok && state && state !== "ACTIVE") {
      if (state === "FAILED")
        return {
          status: "error",
          message: "The finished clip failed to process in the Files API.",
        };
      return { status: "pending", progress: 99 };
    }
    const dl = await downloadBytes(
      `${fileUrl}${fileUrl.includes("?") ? "&" : "?"}alt=media`,
      headers,
      "Gemini Omni Flash",
    );
    return { status: "done", bytes: dl.bytes, mimeType: video.mimeType || dl.mimeType };
  },
};

// ===================================== Dreamina Seedance (BytePlus ModelArk)

// API-key REST on ModelArk international (ap-southeast-1). One async task
// endpoint + one poll endpoint; the finished clip is a plain public TOS URL.
const SEEDANCE_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";
export const SEEDANCE_DEFAULT_MODEL = "dreamina-seedance-2-5-260628";
export const SEEDANCE_MODELS = [
  { id: "dreamina-seedance-2-5-260628", label: "Seedance 2.5 (flagship)" },
  { id: "dreamina-seedance-2-0-260128", label: "Seedance 2.0" },
  { id: "dreamina-seedance-2-0-mini-260615", label: "Seedance 2.0 mini (cheapest)" },
] as const;

export const seedanceAdapter: VideoAdapter = {
  async start(row, apiKey, args) {
    const base = (row.base_url || SEEDANCE_BASE).replace(/\/+$/, "");
    const model = (row.default_model || "").trim() || SEEDANCE_DEFAULT_MODEL;
    const content: Record<string, unknown>[] = [{ type: "text", text: args.prompt }];
    if (args.refImage) {
      // Data URLs are accepted directly; "first_frame" makes it image-to-video.
      // Heads-up encoded as an error below: Seedance 2.x rejects reference
      // images containing real human faces.
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${args.refImage.mimeType.toLowerCase()};base64,${args.refImage.bytesBase64Encoded}`,
        },
        role: "first_frame",
      });
    }
    const out = await fetchJson(
      `${base}/contents/generations/tasks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          content,
          ratio: args.aspectRatio,
          duration: args.durationSec,
        }),
      },
      "Seedance",
      FETCH_TIMEOUT.api,
    );
    if (!out.ok) {
      const msg = out.json?.error?.message || out.text.slice(0, 300);
      throw new Error(
        `Seedance could not start [${out.status}]: ${msg}${/face|portrait|human/i.test(String(msg)) ? " (Seedance 2.x rejects reference images that contain real human faces.)" : ""}`,
      );
    }
    const id = out.json?.id;
    if (!id)
      throw new Error(`Seedance did not return a task id. Response: ${out.text.slice(0, 300)}`);
    return { operationName: String(id), model };
  },

  async poll(row, apiKey, operationName) {
    const base = (row.base_url || SEEDANCE_BASE).replace(/\/+$/, "");
    const out = await fetchJson(
      `${base}/contents/generations/tasks/${encodeURIComponent(operationName)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
      "Seedance",
      POLL_TIMEOUT_MS,
    );
    if (!out.ok) throw new Error(`Seedance poll failed [${out.status}]: ${out.text.slice(0, 400)}`);
    const json = out.json ?? {};
    const status = String(json.status ?? "");
    if (status === "queued" || status === "running" || status === "") return { status: "pending" };
    if (status !== "succeeded") {
      return {
        status: "error",
        message: `Seedance task ${status || "failed"}${json.error?.message ? `: ${json.error.message}` : "."}`,
      };
    }
    const videoUrl = json.content?.video_url;
    if (!videoUrl)
      return { status: "error", message: "Seedance succeeded but returned no video URL." };
    // The result lives on TOS object storage for 7 days; we persist it to our
    // own storage immediately, so the expiry never bites.
    const dl = await downloadBytes(String(videoUrl), {}, "Seedance");
    return { status: "done", bytes: dl.bytes, mimeType: dl.mimeType };
  },
};

// ================================================== Kling 3.0 (Kuaishou)

// New-generation Kling API: plain API-key Bearer auth, model version in the
// URL path, unified /tasks polling. Global endpoint is api-singapore.
const KLING_BASE = "https://api-singapore.klingai.com";
export const KLING_DEFAULT_MODEL = "kling-3.0";
export const KLING_MODELS = [
  { id: "kling-3.0", label: "Kling 3.0 (flagship, audio, up to 4k)" },
  { id: "kling-3.0-turbo", label: "Kling 3.0 Turbo (faster/cheaper)" },
] as const;

export const klingAdapter: VideoAdapter = {
  async start(row, apiKey, args) {
    const base = (row.base_url || KLING_BASE).replace(/\/+$/, "");
    const model = (row.default_model || "").trim() || KLING_DEFAULT_MODEL;
    const settings: Record<string, unknown> = {
      duration: args.durationSec, // integer seconds, 3–15
      resolution: "720p",
    };
    let path: string;
    let body: Record<string, unknown>;
    if (args.refImage) {
      // Image-to-video: raw base64, no data-URI prefix; aspect follows the image.
      path = `/image-to-video/${encodeURIComponent(model)}`;
      body = {
        contents: [
          { type: "prompt", text: args.prompt },
          { type: "first_frame", url: args.refImage.bytesBase64Encoded },
        ],
        settings,
      };
    } else {
      path = `/text-to-video/${encodeURIComponent(model)}`;
      body = { prompt: args.prompt, settings: { ...settings, aspect_ratio: args.aspectRatio } };
    }
    const out = await fetchJson(
      `${base}${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      },
      "Kling",
      FETCH_TIMEOUT.api,
    );
    // Kling wraps everything in { code, message, data } — code 0 is success.
    if (!out.ok || (out.json && out.json.code !== 0)) {
      const msg = out.json?.message || out.text.slice(0, 300);
      throw new Error(
        `Kling could not start [${out.status}${out.json?.code != null ? ` / code ${out.json.code}` : ""}]: ${msg}`,
      );
    }
    const id = out.json?.data?.id;
    if (!id) throw new Error(`Kling did not return a task id. Response: ${out.text.slice(0, 300)}`);
    return { operationName: String(id), model };
  },

  async poll(row, apiKey, operationName) {
    const base = (row.base_url || KLING_BASE).replace(/\/+$/, "");
    const out = await fetchJson(
      `${base}/tasks?task_ids=${encodeURIComponent(operationName)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
      "Kling",
      POLL_TIMEOUT_MS,
    );
    if (!out.ok || (out.json && out.json.code !== 0)) {
      throw new Error(
        `Kling poll failed [${out.status}]: ${out.json?.message || out.text.slice(0, 400)}`,
      );
    }
    const task = Array.isArray(out.json?.data) ? out.json.data[0] : out.json?.data;
    if (!task) return { status: "error", message: "Kling returned no task for that id." };
    const status = String(task.status ?? "");
    if (status === "submitted" || status === "processing" || status === "")
      return { status: "pending" };
    if (status !== "succeeded" && status !== "succeed") {
      return {
        status: "error",
        message: `Kling task ${status || "failed"}${task.message ? `: ${task.message}` : "."}`,
      };
    }
    const outputs: Array<Record<string, unknown>> = Array.isArray(task.outputs) ? task.outputs : [];
    const video = outputs.find((o) => o.type === "video" && o.url);
    if (!video?.url)
      return { status: "error", message: "Kling succeeded but returned no video URL." };
    // Kling deletes generated files after 30 days; we persist to our own
    // storage immediately, so the expiry never bites.
    const dl = await downloadBytes(String(video.url), {}, "Kling");
    return { status: "done", bytes: dl.bytes, mimeType: dl.mimeType };
  },
};

// ========================================================== Runway (unified)

// Runway's developer API is a unified gateway: one Bearer key covers Runway's
// own models (Gen-4.5, Gen-4 Turbo) plus hosted third-party ones (Seedance
// family, Veo 3.x). Task-based: POST to start, GET /v1/tasks/{id} to poll.
const RUNWAY_BASE = "https://api.dev.runwayml.com";
const RUNWAY_VERSION = "2024-11-06"; // required X-Runway-Version header
export const RUNWAY_DEFAULT_MODEL = "gen4.5";
export const RUNWAY_MODELS = [
  { id: "gen4.5", label: "Gen-4.5 (Runway flagship)" },
  { id: "gen4_turbo", label: "Gen-4 Turbo (image-to-video only, cheaper)" },
  { id: "seedance2_5", label: "Seedance 2.5 (hosted on Runway)" },
  { id: "seedance2", label: "Seedance 2.0 (hosted on Runway)" },
  { id: "seedance2_mini", label: "Seedance 2.0 mini (cheapest)" },
  { id: "veo3.1", label: "Veo 3.1 (hosted on Runway)" },
  { id: "veo3.1_fast", label: "Veo 3.1 Fast (hosted on Runway)" },
] as const;

function runwayHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "X-Runway-Version": RUNWAY_VERSION,
  };
}

// Durations are model-specific integers: veo3.x accepts only 8, Gen-4.x accepts
// 5 or 10, Seedance accepts 4-15. Coerce our 4/6/8 to the nearest legal value.
function runwayDuration(model: string, durationSec: number): number {
  if (model.startsWith("veo")) return 8;
  if (model.startsWith("gen4")) return durationSec <= 6 ? 5 : 10;
  return durationSec;
}

export const runwayAdapter: VideoAdapter = {
  async start(row, apiKey, args) {
    const base = (row.base_url || RUNWAY_BASE).replace(/\/+$/, "");
    let model = (row.default_model || "").trim() || RUNWAY_DEFAULT_MODEL;
    const ratio = args.aspectRatio === "9:16" ? "720:1280" : "1280:720";
    let path: string;
    const body: Record<string, unknown> = {
      promptText: args.prompt,
      ratio,
    };
    if (args.refImage) {
      path = "/v1/image_to_video";
      body.promptImage = `data:${args.refImage.mimeType.toLowerCase()};base64,${args.refImage.bytesBase64Encoded}`;
    } else {
      // gen4_turbo is image-to-video only — upgrade text-only calls to gen4.5.
      if (model === "gen4_turbo") model = RUNWAY_DEFAULT_MODEL;
      path = "/v1/text_to_video";
    }
    body.model = model;
    body.duration = runwayDuration(model, args.durationSec);
    const out = await fetchJson(
      `${base}${path}`,
      { method: "POST", headers: runwayHeaders(apiKey), body: JSON.stringify(body) },
      "Runway",
      FETCH_TIMEOUT.api,
    );
    if (!out.ok) {
      const msg = out.json?.error || out.json?.message || out.text.slice(0, 300);
      throw new Error(`Runway could not start [${out.status}]: ${msg}`);
    }
    const id = out.json?.id;
    if (!id)
      throw new Error(`Runway did not return a task id. Response: ${out.text.slice(0, 300)}`);
    return { operationName: String(id), model };
  },

  async poll(row, apiKey, operationName) {
    const base = (row.base_url || RUNWAY_BASE).replace(/\/+$/, "");
    const out = await fetchJson(
      `${base}/v1/tasks/${encodeURIComponent(operationName)}`,
      { headers: runwayHeaders(apiKey) },
      "Runway",
      POLL_TIMEOUT_MS,
    );
    if (!out.ok) throw new Error(`Runway poll failed [${out.status}]: ${out.text.slice(0, 400)}`);
    const json = out.json ?? {};
    const status = String(json.status ?? "");
    if (status === "PENDING" || status === "RUNNING" || status === "THROTTLED" || status === "") {
      const progress =
        typeof json.progress === "number" ? Math.round(json.progress * 100) : undefined;
      return { status: "pending", progress };
    }
    if (status !== "SUCCEEDED") {
      const detail = json.failure || json.failureCode || "";
      return {
        status: "error",
        message: `Runway task ${status.toLowerCase() || "failed"}${detail ? `: ${detail}` : "."}`,
      };
    }
    const url = Array.isArray(json.output) ? json.output[0] : null;
    if (!url) return { status: "error", message: "Runway succeeded but returned no video URL." };
    // Output URLs are signed and expire within 24-48h; we persist to our own
    // storage immediately, so the expiry never bites.
    const dl = await downloadBytes(String(url), {}, "Runway");
    return { status: "done", bytes: dl.bytes, mimeType: dl.mimeType };
  },
};

// ------------------------------------------------------------------ registry

const ADAPTERS: Record<string, VideoAdapter> = {
  veo: veoAdapter,
  "gemini-omni": omniAdapter,
  seedance: seedanceAdapter,
  kling: klingAdapter,
  runway: runwayAdapter,
};

export function getVideoAdapter(kind: string): VideoAdapter | null {
  return ADAPTERS[kind] ?? null;
}

export function supportedVideoKinds(): string[] {
  return Object.keys(ADAPTERS);
}
