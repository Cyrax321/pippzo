import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { useCallback, useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { brandContextSummary, useBrandGuideline, useBrandImages } from "@/lib/brand-store";
import { useWorkspace } from "@/lib/workspace";
import { generatePost, refinePost, qualityCheck, analyzeImage } from "@/lib/ai.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScheduleDialog } from "@/components/schedule-dialog";
import { toast } from "sonner";
import {
  Sparkles,
  Loader2,
  Copy,
  RefreshCw,
  ShieldCheck,
  Image as ImageIcon,
  X,
  Check,
  AlertCircle,
  CalendarClock,
  Library,
  Star,
} from "lucide-react";
import type { GeneratedPost, Platform, QualityCheck } from "@/lib/types";
import { NETWORKS } from "@/lib/buffer-shared";

export const Route = createFileRoute("/crear")({
  head: () => ({
    meta: [
      { title: "Create · Social Studio" },
      { name: "description", content: "Create posts with AI." },
    ],
  }),
  component: CrearPage,
});

// The caption limits are not this page's to own: the server refuses an
// oversized caption per channel before it ever reaches Buffer, and a counter
// that disagreed with that refusal would be worse than no counter at all. Both
// read the same table (docs/bugs.md finding 30).
const PLATFORMS: { v: Platform; label: string; limit: number }[] = NETWORKS.map((n) => ({
  v: n.key,
  label: n.label,
  limit: n.captionLimit,
}));

const SUGGESTIONS = [
  "Three lessons from our latest product launch.",
  "A behind-the-scenes look at how we work.",
  "A framework our customers use to get more from the product.",
  "The most common mistake we see new customers make.",
  "How we measure what actually matters, without vanity metrics.",
];

const LAST_PLATFORM_KEY = "sm.crear.lastPlatform";

function CrearPage() {
  const guideline = useBrandGuideline();
  const library = useBrandImages();
  const { activeWorkspaceId } = useWorkspace();
  const [libOpen, setLibOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [platform, setPlatform] = useState<Platform>("linkedin");
  const [busy, setBusy] = useState(false);
  const [post, setPost] = useState<GeneratedPost | null>(null);
  const [refining, setRefining] = useState(false);
  const [refineInput, setRefineInput] = useState("");
  const [quality, setQuality] = useState<QualityCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [imgDesc, setImgDesc] = useState<string | null>(null);
  const [selectedVideoUrl, setSelectedVideoUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [generatedImg, setGeneratedImg] = useState<string | null>(null);
  const [generatingImg, setGeneratingImg] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Tracks whether the current generated post has been persisted (drafted or
  // scheduled) via the schedule dialog since it was generated.
  const [savedSinceGenerate, setSavedSinceGenerate] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(LAST_PLATFORM_KEY) : null;
    if (saved) setPlatform(saved as Platform);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(LAST_PLATFORM_KEY, platform);
  }, [platform]);

  // docs/bugs.md finding 44: navigating away from /crear silently threw away
  // whatever had been generated. A generated post is the thing worth
  // protecting — it cost a real model call and isn't cheap to reproduce
  // exactly. The brief textarea alone is not: warning while someone is still
  // mid-sentence composing a brief (before they've even generated anything)
  // would be the "worse than no warning" case, so this only arms once a post
  // exists, and disarms again the moment it's actually saved (draft or
  // schedule) rather than merely having its dialog closed.
  const hasUnsavedPost = post !== null && !savedSinceGenerate;
  const shouldBlockNav = useCallback(() => hasUnsavedPost, [hasUnsavedPost]);
  const blocker = useBlocker({
    shouldBlockFn: shouldBlockNav,
    enableBeforeUnload: shouldBlockNav,
    withResolver: true as const,
  });

  const generateImage = async () => {
    if (!post) return;
    setGeneratingImg(true);
    setGeneratedImg(null);
    try {
      const prompt = `${post.visualConcept}\n\nBrand context: ${brandContextSummary()}\n\nClean editorial composition. No text unless specified.`;
      const { streamImage } = await import("@/lib/stream-image");
      await streamImage(
        "/api/generate-image",
        { prompt, workspaceId: activeWorkspaceId ?? undefined },
        (dataUrl) => setGeneratedImg(dataUrl),
      );
    } catch (e) {
      console.error(e);
      // Surface the real reason (e.g. "No image provider connected") instead of
      // a generic failure the user cannot act on.
      toast.error(e instanceof Error ? e.message : "Could not generate the image.");
    } finally {
      setGeneratingImg(false);
    }
  };

  const genFn = useServerFn(generatePost);
  const refFn = useServerFn(refinePost);
  const qcFn = useServerFn(qualityCheck);
  const anFn = useServerFn(analyzeImage);

  const onFile = async (file?: File) => {
    if (!file) return;
    setSelectedVideoUrl(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setImgPreview(dataUrl);
      setAnalyzing(true);
      try {
        const { analysis } = await anFn({ data: { dataUrl, purpose: "post" } });
        setImgDesc(analysis);
      } catch {
        toast.error("Could not analyze the image.");
      } finally {
        setAnalyzing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const generate = async () => {
    if (!brief.trim() && !imgDesc) {
      toast.error("Tell me what you need.");
      return;
    }
    setBusy(true);
    setPost(null);
    setQuality(null);
    setGeneratedImg(null);
    try {
      const out = await genFn({
        data: {
          brief: brief.trim() || "Create a post based on the attached image.",
          platform,
          brandContext: brandContextSummary(),
          imageDescription: imgDesc ?? undefined,
        },
      });
      setPost(out);
      setSavedSinceGenerate(false);
      if (imgPreview) setGeneratedImg(imgPreview);
    } catch (e) {
      console.error(e);
      toast.error("Could not generate.");
    } finally {
      setBusy(false);
    }
  };

  const refine = async () => {
    if (!post || !refineInput.trim()) return;
    setRefining(true);
    try {
      const { caption } = await refFn({
        data: {
          currentCaption: post.caption,
          instruction: refineInput,
          brandContext: brandContextSummary(),
          platform,
        },
      });
      setPost({ ...post, caption });
      setRefineInput("");
      setQuality(null);
    } catch {
      toast.error("Could not refine.");
    } finally {
      setRefining(false);
    }
  };

  const check = async () => {
    if (!post) return;
    setChecking(true);
    try {
      const q = await qcFn({
        data: { caption: post.caption, platform, brandContext: brandContextSummary() },
      });
      setQuality(q);
    } catch {
      toast.error("Quality check failed.");
    } finally {
      setChecking(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied.");
  };

  const handleBriefKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (!busy) generate();
    }
  };

  const platformLimit = PLATFORMS.find((p) => p.v === platform)?.limit ?? 3000;
  const platformLabel = PLATFORMS.find((p) => p.v === platform)?.label ?? platform;
  const captionLen = post?.caption.length ?? 0;
  const userHasImage = !!imgPreview;

  return (
    <div className="mx-auto max-w-5xl px-6 py-12 grid lg:grid-cols-[1fr_1.2fr] gap-10">
      <div className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Create</p>
          <h1 className="mt-2 font-serif text-4xl">New post</h1>
          <p className="mt-2 text-muted-foreground">
            {guideline
              ? "Write what you want in plain English."
              : "No approved guide yet. The agent will improvise with judgment."}
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label
              htmlFor="crear-brief"
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              Brief
            </Label>
            <span className="text-[10px] text-muted-foreground hidden sm:block">
              ⌘/Ctrl + Enter to generate
            </span>
          </div>
          <Textarea
            id="crear-brief"
            rows={5}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            onKeyDown={handleBriefKey}
            placeholder="E.g. Announce next week\u2019s launch."
          />
          {!brief && !post && (
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setBrief(s)}
                  className="text-[11px] text-muted-foreground hover:text-foreground border border-border rounded-full px-2.5 py-1 hover:bg-muted transition-colors"
                >
                  {s.length > 60 ? s.slice(0, 57) + "…" : s}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <Label
            htmlFor="crear-platform"
            className="text-xs uppercase tracking-wider text-muted-foreground"
          >
            Platform
          </Label>
          <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
            <SelectTrigger id="crear-platform">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLATFORMS.map((p) => (
                <SelectItem key={p.v} value={p.v}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Image (optional)
          </Label>
          {imgPreview ? (
            <div className="relative rounded-lg overflow-hidden border border-border">
              <img
                src={imgPreview}
                alt={
                  imgDesc
                    ? `Image selected for the post: ${imgDesc}`
                    : `Image selected for the ${platformLabel} post`
                }
                className="w-full max-h-64 object-cover"
              />
              <button
                onClick={() => {
                  setImgPreview(null);
                  setImgDesc(null);
                  setSelectedVideoUrl(null);
                }}
                className="absolute top-2 right-2 rounded-full bg-background/90 p-1.5"
                aria-label="Remove image"
              >
                <X className="h-4 w-4" />
              </button>
              {analyzing && (
                <div className="absolute inset-0 grid place-items-center bg-background/60">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              )}
              {imgDesc && (
                <div className="p-3 text-xs text-muted-foreground border-t border-border bg-card">
                  {imgDesc}
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => fileRef.current?.click()}
                className="justify-start gap-2"
              >
                <ImageIcon className="h-4 w-4" /> Upload
              </Button>
              <Button
                variant="outline"
                onClick={() => setLibOpen(true)}
                className="justify-start gap-2"
              >
                <Library className="h-4 w-4" /> From library
              </Button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>

        <Dialog open={libOpen} onOpenChange={setLibOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">Visual library</DialogTitle>
            </DialogHeader>
            {library.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No images yet. Upload some in /imagenes.
              </p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto">
                {library.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => {
                      setImgPreview(img.dataUrl);
                      setImgDesc(img.analysis ?? null);
                      setSelectedVideoUrl(img.kind === "video" ? (img.videoUrl ?? null) : null);
                      setLibOpen(false);
                      toast.success(
                        `${img.kind === "video" ? "Video" : "Image"} selected from library.`,
                      );
                    }}
                    className="group relative rounded-md overflow-hidden border border-border hover:ring-2 hover:ring-accent transition"
                  >
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      className="w-full aspect-square object-cover"
                    />
                    {img.approved && (
                      <Badge className="absolute top-1 left-1 bg-accent text-accent-foreground">
                        <Star className="h-3 w-3" />
                      </Badge>
                    )}
                  </button>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Button onClick={generate} disabled={busy} size="lg" className="w-full gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Generate post
        </Button>
      </div>

      <div className="space-y-5">
        {!post && !busy && (
          <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
            Your post will appear here.
          </div>
        )}
        {busy && (
          <div className="space-y-3 animate-pulse">
            <div className="rounded-lg border border-border bg-card p-5 space-y-3">
              <div className="h-5 w-32 bg-muted rounded" />
              <div className="h-4 w-full bg-muted rounded" />
              <div className="h-4 w-5/6 bg-muted rounded" />
              <div className="h-4 w-2/3 bg-muted rounded" />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="h-24 rounded-lg border border-border bg-card" />
              <div className="h-24 rounded-lg border border-border bg-card" />
            </div>
          </div>
        )}
        {post && (
          <>
            <div className="rounded-lg border border-border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <Badge variant="secondary">{post.platform}</Badge>
                  <Badge variant="outline">{post.angle}</Badge>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copy(post.caption)}
                  className="gap-1"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy
                </Button>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed">{post.caption}</p>
              {post.hashtags?.length > 0 && (
                <p className="text-sm text-accent">
                  {post.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}
                </p>
              )}
              <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border pt-2">
                <span>
                  {captionLen} / {platformLimit} characters
                </span>
                <span className={captionLen > platformLimit ? "text-destructive font-medium" : ""}>
                  {captionLen > platformLimit ? `Over by ${captionLen - platformLimit}` : "OK"}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Post image
                </Label>
                {userHasImage && generatedImg === imgPreview ? (
                  <Badge variant="secondary" className="text-[10px]">
                    Uploaded image
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    onClick={generateImage}
                    disabled={generatingImg}
                    className="gap-2"
                  >
                    {generatingImg ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ImageIcon className="h-4 w-4" />
                    )}
                    {generatedImg ? "Regenerate" : "Generate image"}
                  </Button>
                )}
              </div>
              {generatedImg && (
                <div className="rounded-md overflow-hidden border border-border">
                  <img
                    src={generatedImg}
                    alt={
                      userHasImage && generatedImg === imgPreview
                        ? imgDesc
                          ? `Uploaded image for the ${post.platform} post: ${imgDesc}`
                          : `Uploaded image for the ${post.platform} post`
                        : `AI-generated image for the ${post.platform} post: ${post.visualConcept}`
                    }
                    className="w-full"
                  />
                  <div className="flex justify-end p-2 bg-card border-t border-border">
                    <a
                      href={generatedImg}
                      download="post.png"
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Download
                    </a>
                  </div>
                </div>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <Card title="Short version" text={post.shortVersion} onCopy={copy} />
              <Card title="Long version" text={post.longVersion} onCopy={copy} />
              <Card title="CTA" text={post.cta} onCopy={copy} />
              <Card title="Visual concept" text={post.visualConcept} onCopy={copy} />
            </div>

            {post.alternativeHooks?.length > 0 && (
              <div className="rounded-lg border border-border p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Alternative hooks
                </p>
                <ul className="space-y-2 text-sm">
                  {post.alternativeHooks.map((h, i) => (
                    <li key={i} className="flex gap-2 group">
                      <span className="text-accent">·</span>
                      <span className="flex-1">{h}</span>
                      <button
                        onClick={() => copy(h)}
                        className="opacity-0 group-hover:opacity-100 text-xs text-muted-foreground"
                        aria-label={`Copy hook: ${h}`}
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-lg border border-border p-4 space-y-3">
              <Label
                htmlFor="crear-refine"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Refine conversationally
              </Label>
              <div className="flex gap-2">
                <Input
                  id="crear-refine"
                  value={refineInput}
                  onChange={(e) => setRefineInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && refine()}
                  placeholder='"Less corporate", "sharper hook", "no emojis"...'
                />
                <Button
                  onClick={refine}
                  disabled={refining || !refineInput.trim()}
                  aria-label="Refine caption"
                >
                  {refining ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={check}
                disabled={checking}
                variant="outline"
                className="flex-1 gap-2"
              >
                {checking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                Quality check
              </Button>
              <Button onClick={() => setScheduleOpen(true)} className="flex-1 gap-2">
                <CalendarClock className="h-4 w-4" /> Schedule
              </Button>
            </div>

            {quality && (
              <div className="rounded-lg border border-border p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-serif text-2xl">
                    {quality.score}
                    <span className="text-sm text-muted-foreground">/100</span>
                  </p>
                  <Badge
                    variant={
                      quality.score >= 80
                        ? "default"
                        : quality.score >= 60
                          ? "secondary"
                          : "destructive"
                    }
                  >
                    {quality.score >= 80
                      ? "On-brand"
                      : quality.score >= 60
                        ? "Improvable"
                        : "Review"}
                  </Badge>
                </div>
                <ul className="space-y-2 text-sm">
                  {(
                    [
                      ["Brand voice", quality.brandVoice],
                      ["Language quality", quality.spanishSpain],
                      ["Doesn't sound like AI", quality.notAiSounding],
                      ["No banned words", quality.bannedWords],
                      ["Clear purpose", quality.clearPurpose],
                      ["Strong hook", quality.strongHook],
                      ["Appropriate CTA", quality.appropriateCta],
                      ["Platform format", quality.platformFormat],
                    ] as const
                  ).map(([label, c]) => (
                    <li key={label} className="flex gap-2">
                      {c.pass ? (
                        <Check className="h-4 w-4 text-green-700 mt-0.5 shrink-0" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                      )}
                      <div>
                        <span className="font-medium">{label}.</span>{" "}
                        <span className="text-muted-foreground">{c.note}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <ScheduleDialog
              open={scheduleOpen}
              onOpenChange={setScheduleOpen}
              post={post}
              imageDataUrl={generatedImg}
              videoUrl={selectedVideoUrl}
              onSaved={() => setSavedSinceGenerate(true)}
            />
          </>
        )}
      </div>

      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving this post?</AlertDialogTitle>
            <AlertDialogDescription>
              This generated post hasn&rsquo;t been saved as a draft or scheduled yet. Leaving now
              will lose it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={() => blocker.proceed?.()}>Leave anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Card({
  title,
  text,
  onCopy,
}: {
  title: string;
  text: string;
  onCopy: (t: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border p-4 bg-card group">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
        <button
          onClick={() => onCopy(text)}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground"
          aria-label={`Copy ${title}`}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-sm whitespace-pre-wrap">{text}</p>
    </div>
  );
}
