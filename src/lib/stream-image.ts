// Lightweight SSE parser for image generation streaming.
import { authHeaders } from "./auth-headers";

/** What the server did with references, so callers can report it honestly. */
export type StreamImageMeta = { referencesUsed: number; autoAttached: number };

export async function streamImage(
  endpoint: string,
  body: Record<string, unknown>,
  onFrame: (dataUrl: string, isFinal: boolean) => void,
  signal?: AbortSignal,
): Promise<StreamImageMeta> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    // The server sends a plain-language reason (no provider connected, no usable
    // key, references unreadable). Surface it instead of the status code alone.
    const detail = await res.text().catch(() => "");
    throw new Error(detail.trim() || `Image generation failed (${res.status})`);
  }
  const meta: StreamImageMeta = {
    referencesUsed: Number(res.headers.get("X-References-Used") ?? 0) || 0,
    autoAttached: Number(res.headers.get("X-References-Auto-Attached") ?? 0) || 0,
  };
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let sawCompleted = false;

  const processEvent = (raw: string) => {
    const lines = raw.split("\n");
    let event = "";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!event || !data || data === "[DONE]") return;
    if (event !== "image_generation.partial_image" && event !== "image_generation.completed")
      return;
    try {
      const payload = JSON.parse(data) as { b64_json?: string };
      if (!payload.b64_json) return;
      const isFinal = event === "image_generation.completed";
      onFrame(`data:image/png;base64,${payload.b64_json}`, isFinal);
      if (isFinal) sawCompleted = true;
    } catch {
      // ignore
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        processEvent(raw);
      }
    }
    if (buffer.trim()) processEvent(buffer);
  } finally {
    reader.cancel().catch(() => {});
  }
  if (!sawCompleted) {
    // ok if we received at least a partial frame; throw only if nothing arrived
  }
  return meta;
}
