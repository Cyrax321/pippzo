// Browser-only MP4 exporter (Option A in the architecture brief):
//   composition at T -> serialised SVG (fonts + images inlined)
//   -> rasterise into a canvas -> VideoFrame -> WebCodecs H.264 -> mp4-muxer.
// Everything is frame-by-frame with backpressure; no frame buffer is retained.
import { ArrayBufferTarget, Muxer } from "mp4-muxer";

export type ExportProgress = {
  frame: number;
  totalFrames: number;
  phase: "preparing" | "rendering" | "finalising" | "done";
};

export type ExportResult = {
  blob: Blob;
  ms: number;
  frames: number;
  peakMemoryMB: number | null;
};

export function webCodecsSupported() {
  return (
    typeof window !== "undefined" &&
    typeof (window as never as { VideoEncoder?: unknown }).VideoEncoder === "function"
  );
}

/* ------------------------------------------------------------------ fonts */

const fontCache = new Map<string, string>();

async function toDataUrl(url: string): Promise<string | null> {
  if (fontCache.has(url)) return fontCache.get(url)!;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const mime = res.headers.get("content-type") ?? "application/octet-stream";
    const dataUrl = `data:${mime};base64,${btoa(bin)}`;
    fontCache.set(url, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

/**
 * Collects @font-face rules from the document and rewrites their src to data:
 * URLs so the serialised SVG is self-contained. Cross-origin stylesheets that
 * refuse cssRules access are skipped (and reported).
 */
export async function collectInlineFontCss(): Promise<{ css: string; skipped: string[] }> {
  const skipped: string[] = [];
  const rules: string[] = [];

  for (const sheet of Array.from(document.styleSheets)) {
    let cssRules: CSSRuleList;
    try {
      cssRules = sheet.cssRules;
    } catch {
      skipped.push(sheet.href ?? "inline stylesheet");
      continue;
    }
    for (const rule of Array.from(cssRules)) {
      if (
        rule.constructor.name !== "CSSFontFaceRule" &&
        !(rule as CSSRule).cssText.startsWith("@font-face")
      )
        continue;
      let text = (rule as CSSRule).cssText;
      const urls = Array.from(text.matchAll(/url\((["']?)(https?:\/\/[^)"']+)\1\)/g));
      for (const m of urls) {
        const dataUrl = await toDataUrl(m[2]);
        if (dataUrl) text = text.replace(m[0], `url(${dataUrl})`);
        else skipped.push(m[2]);
      }
      rules.push(text);
    }
  }
  return { css: rules.join("\n"), skipped };
}

/** Replaces <image href="http..."> with data URLs inside a cloned stage. */
async function inlineImages(clone: SVGSVGElement) {
  const imgs = Array.from(clone.querySelectorAll("image"));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute("href") ?? img.getAttribute("xlink:href");
      if (!src || src.startsWith("data:")) return;
      const dataUrl = await toDataUrl(new URL(src, window.location.href).href);
      if (dataUrl) img.setAttribute("href", dataUrl);
    }),
  );
}

/* ------------------------------------------------------- rasterisation */

export async function serialiseStage(stage: SVGSVGElement, fontCss: string): Promise<string> {
  const clone = stage.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  await inlineImages(clone);
  if (fontCss) {
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = fontCss;
    clone.insertBefore(style, clone.firstChild);
  }
  return new XMLSerializer().serializeToString(clone);
}

async function rasterise(svg: string, width: number, height: number): Promise<ImageBitmap> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "sync";
    img.width = width;
    img.height = height;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not rasterise the composition frame."));
      img.src = url;
    });
    return await createImageBitmap(img, { resizeWidth: width, resizeHeight: height });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ------------------------------------------------------------- exporter */

/** High profile first, then main, then baseline — whichever this browser can encode. */
export async function pickH264Codec(
  width: number,
  height: number,
  framerate: number,
  bitrate: number,
) {
  for (const codec of ["avc1.640033", "avc1.4d0032", "avc1.42001f"]) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width, height, framerate, bitrate });
      if (r.supported) return codec;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

export type ExportOptions = {
  stage: SVGSVGElement;
  width: number;
  height: number;
  fps: number;
  duration: number;
  /** Must synchronously commit the DOM for this time before resolving. */
  seek: (time: number) => Promise<void> | void;
  onProgress?: (p: ExportProgress) => void;
  bitrate?: number;
  signal?: AbortSignal;
};

export async function exportCompositionToMp4(opts: ExportOptions): Promise<ExportResult> {
  if (!webCodecsSupported())
    throw new Error("This browser has no WebCodecs VideoEncoder. Use Chrome or Edge.");

  const { stage, width, height, fps, duration, seek } = opts;
  // H.264 requires even dimensions.
  const w = width - (width % 2);
  const h = height - (height % 2);
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const started = performance.now();
  let peak = 0;

  opts.onProgress?.({ frame: 0, totalFrames, phase: "preparing" });
  const { css } = await collectInlineFontCss();
  if (document.fonts?.ready) await document.fonts.ready;

  const codec = await pickH264Codec(w, h, fps, opts.bitrate ?? 8_000_000);
  if (!codec)
    throw new Error(
      "This browser cannot encode H.264 video. Chrome or Edge on desktop is required for in-browser export.",
    );

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: w, height: h },
    fastStart: "in-memory",
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      throw e;
    },
  });
  encoder.configure({
    codec,
    width: w,
    height: h,
    bitrate: opts.bitrate ?? 8_000_000,
    framerate: fps,
    latencyMode: "quality",
  });

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false })!;

  try {
    for (let frame = 0; frame < totalFrames; frame++) {
      if (opts.signal?.aborted) throw new Error("Export cancelled.");
      const time = frame / fps;
      await seek(time);

      const svg = await serialiseStage(stage, css);
      const bitmap = await rasterise(svg, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();

      const videoFrame = new VideoFrame(canvas, {
        timestamp: Math.round(time * 1_000_000),
        duration: Math.round(1_000_000 / fps),
      });
      encoder.encode(videoFrame, { keyFrame: frame % (fps * 2) === 0 });
      videoFrame.close();

      // Backpressure: never let the encode queue balloon.
      while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));

      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      if (mem) peak = Math.max(peak, mem.usedJSHeapSize / 1024 / 1024);

      opts.onProgress?.({ frame: frame + 1, totalFrames, phase: "rendering" });
    }

    opts.onProgress?.({ frame: totalFrames, totalFrames, phase: "finalising" });
    await encoder.flush();
    muxer.finalize();
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }

  opts.onProgress?.({ frame: totalFrames, totalFrames, phase: "done" });
  return {
    blob: new Blob([target.buffer as ArrayBuffer], { type: "video/mp4" }),
    ms: performance.now() - started,
    frames: totalFrames,
    peakMemoryMB: peak || null,
  };
}
