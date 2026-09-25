// Phase 1 spike: deterministic animation engine + preview/scrubber + WebCodecs MP4 export.
// Hidden route (not linked in the sidebar) used to benchmark the architecture.
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { CompositionStage } from "@/lib/animation/render";
import { demoComposition } from "@/lib/animation/demo-composition";
import { parseComposition } from "@/lib/animation/schema";
import {
  collectInlineFontCss,
  exportCompositionToMp4,
  webCodecsSupported,
  type ExportProgress,
} from "@/lib/animation/export";
import { Pause, Play, Download, Loader2 } from "lucide-react";

export const Route = createFileRoute("/animation")({
  head: () => ({
    meta: [
      { title: "Animation spike — deterministic motion + MP4 export" },
      {
        name: "description",
        content:
          "Internal proof of concept: an AI-authorable animation composition rendered as a pure function of time, with frame-accurate preview and browser MP4 export.",
      },
      { property: "og:title", content: "Animation spike — deterministic motion + MP4 export" },
      {
        property: "og:description",
        content:
          "Deterministic composition engine, scene timeline, and WebCodecs MP4 export benchmark.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AnimationSpike,
});

const FONT_CSS = `@font-face{font-family:'Space Grotesk';font-style:normal;font-weight:700;font-display:block;src:url(https://fonts.gstatic.com/s/spacegrotesk/v16/V8mDoQDjQSkFtoMM3T6r8E7mPb54C-s.woff2) format('woff2');}
@font-face{font-family:'Space Grotesk';font-style:normal;font-weight:500;font-display:block;src:url(https://fonts.gstatic.com/s/spacegrotesk/v16/V8mDoQDjQSkFtoMM3T6r8E7mPb54C-s.woff2) format('woff2');}`;

function fmt(t: number) {
  const s = Math.floor(t);
  const cs = Math.floor((t - s) * 100);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function AnimationSpike() {
  const composition = useMemo(() => parseComposition(demoComposition), []);
  const stageRef = useRef<SVGSVGElement | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [findings, setFindings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const supported = typeof window !== "undefined" && webCodecsSupported();

  // Real-time playback for the editor only. Export never uses this path.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => {
        const next = t + dt;
        if (next >= composition.duration) {
          setPlaying(false);
          return composition.duration;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, composition.duration]);

  /** Frame-accurate synchronous seek: the DOM reflects T before this resolves. */
  const seek = useCallback((t: number) => {
    flushSync(() => setTime(t));
  }, []);

  const runExport = useCallback(async () => {
    if (!stageRef.current) return;
    setError(null);
    setResult(null);
    setPlaying(false);
    const notes: string[] = [];
    try {
      const { skipped } = await collectInlineFontCss();
      if (skipped.length)
        notes.push(`Fonts/stylesheets not inlinable: ${skipped.slice(0, 3).join(", ")}`);
      const out = await exportCompositionToMp4({
        stage: stageRef.current,
        width: composition.width,
        height: composition.height,
        fps: composition.fps,
        duration: composition.duration,
        seek,
        onProgress: setProgress,
      });
      setResult(URL.createObjectURL(out.blob));
      notes.push(
        `${out.frames} frames at ${composition.width}x${composition.height} in ${(out.ms / 1000).toFixed(1)}s (${(out.ms / out.frames).toFixed(0)} ms/frame, ${(out.frames / composition.fps / (out.ms / 1000)).toFixed(2)}x realtime)`,
        `MP4 size: ${(out.blob.size / 1024 / 1024).toFixed(2)} MB`,
        out.peakMemoryMB
          ? `Peak JS heap: ${out.peakMemoryMB.toFixed(0)} MB`
          : "Peak heap: not reported by this browser",
      );
      setFindings(notes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
      setFindings(notes);
    } finally {
      setProgress(null);
    }
  }, [composition, seek]);

  const scenes = composition.scenes;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-6">
      <style dangerouslySetInnerHTML={{ __html: FONT_CSS }} />

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Animation spike</h1>
          <p className="text-muted-foreground text-sm">
            One clock, pure functions of T, same composition for preview and export.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={supported ? "secondary" : "destructive"}>
            {supported ? "WebCodecs available" : "No WebCodecs in this browser"}
          </Badge>
          <Button onClick={runExport} disabled={!supported || !!progress}>
            {progress ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Download className="mr-2 size-4" />
            )}
            {progress
              ? progress.phase === "rendering"
                ? `Rendering ${progress.frame}/${progress.totalFrames}`
                : progress.phase
              : "Export MP4"}
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="bg-muted/30 flex items-center justify-center overflow-hidden p-4">
          <div className="w-full max-w-[340px]">
            <CompositionStage composition={composition} time={time} stageRef={stageRef} />
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="space-y-2 p-4 text-sm">
            <h2 className="font-medium">Composition</h2>
            <dl className="text-muted-foreground grid grid-cols-2 gap-y-1">
              <dt>Size</dt>
              <dd className="text-foreground text-right">
                {composition.width}x{composition.height}
              </dd>
              <dt>Duration</dt>
              <dd className="text-foreground text-right">{composition.duration}s</dd>
              <dt>FPS</dt>
              <dd className="text-foreground text-right">{composition.fps}</dd>
              <dt>Layers</dt>
              <dd className="text-foreground text-right">{composition.layers.length}</dd>
            </dl>
          </Card>

          <Card className="space-y-2 p-4 text-sm">
            <h2 className="font-medium">Benchmark findings</h2>
            {error && <p className="text-destructive">{error}</p>}
            {findings.length === 0 && !error ? (
              <p className="text-muted-foreground">Run an export to measure.</p>
            ) : (
              <ul className="text-muted-foreground list-disc space-y-1 pl-4">
                {findings.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
            {result && (
              <div className="space-y-2 pt-2">
                <video src={result} controls className="w-full rounded-md" />
                <a
                  className="text-primary text-xs underline"
                  href={result}
                  download="animation-spike.mp4"
                >
                  Download MP4
                </a>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <Button size="icon" variant="secondary" onClick={() => setPlaying((p) => !p)}>
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <span className="font-mono text-sm tabular-nums">
            {fmt(time)} / {fmt(composition.duration)}
          </span>
          <div className="flex-1">
            <Slider
              value={[time]}
              min={0}
              max={composition.duration}
              step={1 / composition.fps}
              onValueChange={([v]) => {
                setPlaying(false);
                seek(v);
              }}
            />
          </div>
        </div>

        <div className="flex gap-1">
          {scenes.map((s) => {
            const active = time >= s.start && time < s.start + s.duration;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setPlaying(false);
                  seek(s.start);
                }}
                style={{ flexGrow: s.duration }}
                className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "bg-muted/40 text-muted-foreground"
                }`}
              >
                <span className="block font-medium">{s.name}</span>
                <span className="tabular-nums">
                  {s.start.toFixed(1)}s – {(s.start + s.duration).toFixed(1)}s
                </span>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
