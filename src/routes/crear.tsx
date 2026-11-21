import { createFileRoute, useBlocker, Link } from "@tanstack/react-router";
import { useCallback, useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { brandContextSummary, useBrandGuideline, useBrandImages } from "@/lib/brand-store";
import { useWorkspace } from "@/lib/workspace";
import { generatePost, refinePost, qualityCheck, analyzeImage } from "@/lib/ai.functions";
import { getSocialAccountsStatusFn } from "@/lib/social/social-publisher.functions";
import type { SocialPlatformKey, SocialStatusMap } from "@/lib/social/social-types";
import { SOCIAL_PLATFORM_CONFIG } from "@/lib/social/social-types";
import { MultiPlatformPublishDialog } from "@/components/multi-platform-publish-dialog";
import { MultiPlatformScheduleDialog } from "@/components/multi-platform-schedule-dialog";
import { MediaUploader, type AttachedMedia } from "@/components/media-uploader";
import { SocialMediaPreviewGallery } from "@/components/social-media-preview-gallery";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  Send,
  Share2,
  CheckCircle2,
  AlertTriangle,
  Heart,
  MessageCircle,
  Repeat2,
  ThumbsUp,
  Bookmark,
  MoreHorizontal,
} from "lucide-react";
import type { GeneratedPost, Platform, QualityCheck } from "@/lib/types";

export const Route = createFileRoute("/crear")({
  head: () => ({
    meta: [
      { title: "Multi-Platform Composer · Pippzo" },
      { name: "description", content: "Write once, publish and schedule everywhere simultaneously." },
    ],
  }),
  component: CrearPage,
});

const SUGGESTIONS = [
  "Three lessons from our latest product launch.",
  "A behind-the-scenes look at how we build and scale.",
  "A high-impact framework our clients use every day.",
  "The most common mistake we see in our industry and how to avoid it.",
  "How we measure what actually matters, without vanity metrics.",
];

const DEFAULT_PLATFORMS: SocialPlatformKey[] = ["x", "linkedin", "instagram", "facebook"];

function CrearPage() {
  const guideline = useBrandGuideline();
  const library = useBrandImages();
  const { activeWorkspaceId } = useWorkspace();

  const getStatus = useServerFn(getStatusFnWrapper);
  const [statusMap, setStatusMap] = useState<SocialStatusMap | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Available platforms: Core networks + all custom connected providers
  const availablePlatforms: SocialPlatformKey[] = statusMap
    ? Array.from(new Set([...DEFAULT_PLATFORMS, ...Object.keys(statusMap)]))
    : DEFAULT_PLATFORMS;

  // Multi-platform selection: default all selected
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<SocialPlatformKey>>(
    new Set(["x", "linkedin", "instagram", "facebook"]),
  );

  // Active preview tab
  const [previewTab, setPreviewTab] = useState<SocialPlatformKey>("x");

  const [libOpen, setLibOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [post, setPost] = useState<GeneratedPost | null>(null);
  const [editableCaption, setEditableCaption] = useState("");
  const [refining, setRefining] = useState(false);
  const [refineInput, setRefineInput] = useState("");
  const [quality, setQuality] = useState<QualityCheck | null>(null);
  const [checking, setChecking] = useState(false);

  // Media & Multi-Media Tray (Postiz-inspired)
  const [attachedMedia, setAttachedMedia] = useState<AttachedMedia[]>([]);
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [imgDesc, setImgDesc] = useState<string | null>(null);
  const [selectedVideoUrl, setSelectedVideoUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [generatedImg, setGeneratedImg] = useState<string | null>(null);
  const [generatingImg, setGeneratingImg] = useState(false);

  // Dialogs
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [savedSinceGenerate, setSavedSinceGenerate] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  // Load connected accounts status
  const loadStatus = useCallback(() => {
    if (!activeWorkspaceId) return;
    setLoadingStatus(true);
    getStatus({ data: { workspaceId: activeWorkspaceId } })
      .then((st) => {
        setStatusMap(st);
      })
      .catch((e) => console.warn("Failed to load status", e))
      .finally(() => setLoadingStatus(false));
  }, [activeWorkspaceId, getStatus]);

  useEffect(loadStatus, [loadStatus]);

  // Unsaved navigation protection
  const hasUnsavedPost = (post !== null || editableCaption.trim().length > 0) && !savedSinceGenerate;
  const shouldBlockNav = useCallback(() => hasUnsavedPost, [hasUnsavedPost]);
  const blocker = useBlocker({
    shouldBlockFn: shouldBlockNav,
    enableBeforeUnload: shouldBlockNav,
    withResolver: true as const,
  });

  const togglePlatform = (p: SocialPlatformKey) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) {
        if (next.size > 1) next.delete(p);
        else toast.info("Keep at least one platform selected.");
      } else {
        next.add(p);
      }
      return next;
    });
  };

  const selectAllPlatforms = () => {
    setSelectedPlatforms(new Set(availablePlatforms));
  };

  const selectConnectedPlatforms = () => {
    if (!statusMap) return;
    const connected = availablePlatforms.filter((p) => statusMap[p]?.connected);
    if (connected.length === 0) {
      toast.info("No accounts connected yet. Connect them in Settings → Connections.");
      return;
    }
    setSelectedPlatforms(new Set(connected));
  };

  const genFn = useServerFn(generatePost);
  const refFn = useServerFn(refinePost);
  const qcFn = useServerFn(qualityCheck);
  const anFn = useServerFn(analyzeImage);

  const generateImage = async () => {
    if (!post && !editableCaption) return;
    setGeneratingImg(true);
    setGeneratedImg(null);
    try {
      const prompt = `${post?.visualConcept || editableCaption}\n\nBrand context: ${brandContextSummary()}\n\nClean editorial composition. No text unless specified.`;
      const { streamImage } = await import("@/lib/stream-image");
      await streamImage(
        "/api/generate-image",
        { prompt, workspaceId: activeWorkspaceId ?? undefined },
        (dataUrl) => {
          setGeneratedImg(dataUrl);
          setImgPreview(dataUrl);
          setAttachedMedia((prev) => {
            const nonAi = prev.filter((m) => !m.id.startsWith("ai-"));
            return [
              ...nonAi,
              {
                id: `ai-${Date.now()}`,
                url: dataUrl,
                type: "image",
                name: "AI Generated Visual",
                altText: post?.visualConcept || editableCaption.slice(0, 80),
              },
            ];
          });
        },
      );
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Could not generate the image.");
    } finally {
      setGeneratingImg(false);
    }
  };

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
      // Generate optimized copy
      const out = await genFn({
        data: {
          brief: brief.trim() || "Create a post based on the attached image.",
          platform: (previewTab as Platform) || "linkedin",
          brandContext: brandContextSummary(),
          imageDescription: imgDesc ?? undefined,
        },
      });
      setPost(out);
      setEditableCaption(out.caption);
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
    if (!editableCaption.trim() || !refineInput.trim()) return;
    setRefining(true);
    try {
      const { caption } = await refFn({
        data: {
          currentCaption: editableCaption,
          instruction: refineInput,
          brandContext: brandContextSummary(),
          platform: (previewTab as Platform) || "linkedin",
        },
      });
      setEditableCaption(caption);
      if (post) setPost({ ...post, caption });
      setRefineInput("");
      setQuality(null);
      toast.success("Refined.");
    } catch {
      toast.error("Could not refine.");
    } finally {
      setRefining(false);
    }
  };

  const check = async () => {
    if (!editableCaption) return;
    setChecking(true);
    try {
      const q = await qcFn({
        data: { caption: editableCaption, platform: (previewTab as Platform) || "linkedin", brandContext: brandContextSummary() },
      });
      setQuality(q);
    } catch {
      toast.error("Quality check failed.");
    } finally {
      setChecking(false);
    }
  };

  const shortenForX = async () => {
    if (!editableCaption.trim()) return;
    setRefining(true);
    try {
      const { caption } = await refFn({
        data: {
          currentCaption: editableCaption,
          instruction: "Condense this to under 280 characters for X (Twitter). Punchy hook, essential takeaway only.",
          brandContext: brandContextSummary(),
          platform: "x",
        },
      });
      setEditableCaption(caption);
      if (post) setPost({ ...post, caption });
      toast.success("Shortened for X!");
    } catch {
      toast.error("Could not shorten.");
    } finally {
      setRefining(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard.");
  };

  const currentCaption = editableCaption;
  const captionLen = currentCaption.length;
  const activeVideo = attachedMedia.find((m) => m.type === "video");
  const activeImages = attachedMedia.filter((m) => m.type === "image");
  const activeMedia = activeVideo?.thumbnailUrl || activeVideo?.url || activeImages[0]?.url || generatedImg || imgPreview;
  const activeVideoUrl = activeVideo?.url || selectedVideoUrl;

  // Selected array
  const selectedList = Array.from(selectedPlatforms);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="label-eyebrow">Multi-Platform Composer</span>
            <Badge variant="outline" className="text-[10px] font-mono uppercase tracking-wider">
              Simultaneous
            </Badge>
          </div>
          <h1 className="mt-1 font-serif text-3xl sm:text-4xl">Write once, publish everywhere</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compose and dispatch to <strong>X (Twitter)</strong>, <strong>LinkedIn</strong>, <strong>Instagram</strong>, and <strong>Facebook</strong> at the exact same time.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link to="/conexiones">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <Share2 className="h-3.5 w-3.5" />
              Manage Social Accounts
            </Button>
          </Link>
        </div>
      </div>

      {/* Target Platforms Selector Card */}
      <div className="border border-border rounded-xl p-4 sm:p-5 bg-card/60 backdrop-blur-sm space-y-3.5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <Label className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
              Target Networks ({selectedPlatforms.size} of 4 selected)
            </Label>
            <p className="text-xs text-muted-foreground">
              Posts will be submitted simultaneously to all checked platforms.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={selectAllPlatforms}
              className="text-xs h-7 px-2"
            >
              Select All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={selectConnectedPlatforms}
              className="text-xs h-7 px-2 text-primary"
            >
              Only Connected
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {availablePlatforms.map((p) => {
            const cfg = SOCIAL_PLATFORM_CONFIG[p] || {
              key: p,
              label: statusMap?.[p]?.label || p.toUpperCase(),
              charLimit: statusMap?.[p]?.charLimit || 5000,
              color: "bg-neutral-800 text-white",
              icon: statusMap?.[p]?.icon || "🌐",
              docsHint: "Custom API key provider",
            };
            const isSelected = selectedPlatforms.has(p);
            const acc = statusMap?.[p];
            const isConnected = acc?.connected;

            return (
              <div
                key={p}
                onClick={() => togglePlatform(p)}
                className={`relative flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                  isSelected
                    ? "border-foreground bg-accent/30 shadow-sm"
                    : "border-border/70 opacity-60 hover:opacity-100 hover:bg-muted/30"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-7 h-7 rounded flex items-center justify-center font-bold text-xs shrink-0 ${cfg.color || "bg-neutral-800 text-white"}`}
                  >
                    {cfg.icon || statusMap?.[p]?.icon || "🌐"}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate leading-tight">{cfg.label}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isConnected ? "bg-emerald-500" : "bg-neutral-400"
                        }`}
                      />
                      <span className="text-[10px] text-muted-foreground truncate">
                        {loadingStatus ? (
                          "Checking..."
                        ) : isConnected ? (
                          acc?.username || acc?.name || "Connected"
                        ) : (
                          <Link
                            to="/conexiones"
                            onClick={(e) => e.stopPropagation()}
                            className="text-primary hover:underline font-medium inline-flex items-center gap-0.5"
                          >
                            Get Key &amp; Connect →
                          </Link>
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => togglePlatform(p)}
                  className="ml-2 shrink-0 pointer-events-none"
                />
              </div>
            );
          })}
        </div>

        {/* Live Multi-Platform Constraint Bar */}
        <div className="pt-2 border-t border-border/60 flex flex-wrap items-center gap-4 text-xs">
          <span className="text-[11px] uppercase font-mono tracking-wider text-muted-foreground">
            Platform Limits:
          </span>
          {selectedList.map((p) => {
            const cfg = SOCIAL_PLATFORM_CONFIG[p] || {
              label: statusMap?.[p]?.label || p.toUpperCase(),
              charLimit: statusMap?.[p]?.charLimit || 5000,
              icon: statusMap?.[p]?.icon || "🌐",
            };
            const isOver = captionLen > cfg.charLimit;
            return (
              <div
                key={p}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-mono ${
                  isOver
                    ? "border-destructive text-destructive bg-destructive/10 font-bold"
                    : "border-border text-muted-foreground bg-muted/20"
                }`}
              >
                <span>{cfg.icon}</span>
                <span>
                  {captionLen} / {cfg.charLimit.toLocaleString()}
                </span>
                {isOver && <span className="text-destructive font-bold">⚠️ EXCEEDED</span>}
              </div>
            );
          })}

          {selectedPlatforms.has("x") && captionLen > 280 && (
            <Button
              variant="outline"
              size="sm"
              onClick={shortenForX}
              disabled={refining}
              className="h-6 px-2 text-[10px] gap-1 text-primary border-primary/50"
            >
              <Sparkles className="h-2.5 w-2.5" /> Auto-shorten for X
            </Button>
          )}
        </div>
      </div>

      {/* Main 2-Column Composer */}
      <div className="grid lg:grid-cols-[1fr_1.1fr] gap-8 items-start">
        {/* Left Column: Input, AI Brief & Media */}
        <div className="space-y-6">
          {/* Post Text & Direct Writing */}
          <div className="space-y-2 border border-border p-4 rounded-xl bg-card">
            <div className="flex items-center justify-between">
              <Label htmlFor="post-caption" className="text-xs uppercase tracking-wider font-semibold">
                Post Copy / Caption
              </Label>
              <span className="text-[10px] text-muted-foreground">
                Edit directly or generate below with AI
              </span>
            </div>
            <Textarea
              id="post-caption"
              rows={7}
              value={editableCaption}
              onChange={(e) => {
                setEditableCaption(e.target.value);
                if (post) setPost({ ...post, caption: e.target.value });
              }}
              placeholder="Write your post here... It will be sent to all selected platforms simultaneously."
              className="text-sm leading-relaxed"
            />
          </div>

          {/* AI Generation Box */}
          <div className="space-y-3 border border-border p-4 rounded-xl bg-muted/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-primary" />
                <Label htmlFor="crear-brief" className="text-xs uppercase tracking-wider font-semibold">
                  AI Generator &amp; Brief
                </Label>
              </div>
              <span className="text-[10px] text-muted-foreground hidden sm:block">
                ⌘/Ctrl + Enter
              </span>
            </div>
            <Textarea
              id="crear-brief"
              rows={3}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  if (!busy) generate();
                }
              }}
              placeholder="E.g. Announce our new enterprise analytics feature launching this Thursday..."
              className="text-xs"
            />
            {!brief && !post && (
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setBrief(s)}
                    className="text-[11px] text-muted-foreground hover:text-foreground border border-border rounded-full px-2.5 py-0.5 hover:bg-muted transition-colors text-left"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <Button
              onClick={generate}
              disabled={busy}
              className="w-full gap-2 text-xs h-9"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Generate Post with AI
            </Button>
          </div>

          {/* Media Attachment & Multi-Media Tray (Postiz-inspired) */}
          <div className="space-y-3 border border-border p-4 rounded-xl bg-card">
            <MediaUploader
              media={attachedMedia}
              onChange={(newMedia) => {
                setAttachedMedia(newMedia);
                if (newMedia.length === 0) {
                  setImgPreview(null);
                  setGeneratedImg(null);
                  setImgDesc(null);
                  setSelectedVideoUrl(null);
                } else {
                  const firstImg = newMedia.find((m) => m.type === "image");
                  if (firstImg) {
                    setImgPreview(firstImg.url);
                    // Automatically trigger image analysis if not analyzed yet
                    if (!imgDesc) {
                      setAnalyzing(true);
                      anFn({ data: { dataUrl: firstImg.url, purpose: "post" } })
                        .then(({ analysis }) => setImgDesc(analysis))
                        .catch(() => {})
                        .finally(() => setAnalyzing(false));
                    }
                  }
                  const firstVid = newMedia.find((m) => m.type === "video");
                  if (firstVid) setSelectedVideoUrl(firstVid.url);
                }
              }}
              onOpenLibrary={() => setLibOpen(true)}
              onGenerateAiImage={generateImage}
              generatingAiImage={generatingImg}
              canGenerateAiImage={Boolean(editableCaption || post)}
              activePlatform={previewTab}
            />
          </div>

          {/* Refine conversationally */}
          {editableCaption && (
            <div className="space-y-2 border border-border p-4 rounded-xl bg-card">
              <Label className="text-xs uppercase tracking-wider font-semibold">
                Refine with AI
              </Label>
              <div className="flex gap-2">
                <Input
                  value={refineInput}
                  onChange={(e) => setRefineInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && refine()}
                  placeholder='"More energetic", "add punchy hook", "cleaner bullets"...'
                  className="text-xs h-9"
                />
                <Button
                  onClick={refine}
                  disabled={refining || !refineInput.trim()}
                  size="sm"
                  className="h-9 px-3"
                >
                  {refining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Multi-Platform Previews & Simultaneous Action Controls */}
        <div className="space-y-6">
          {/* Action Bar (Publish Now to All / Schedule to All) */}
          <div className="border border-border p-4 sm:p-5 rounded-xl bg-card/90 shadow-md space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-serif text-lg leading-tight">Simultaneous Dispatch</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Action applies to all {selectedPlatforms.size} selected networks.
                </p>
              </div>
              <Badge variant="secondary" className="font-mono text-xs">
                {selectedPlatforms.size} Platforms
              </Badge>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <Button
                onClick={() => setPublishDialogOpen(true)}
                disabled={!editableCaption.trim() || selectedPlatforms.size === 0}
                className="gap-2 h-11 text-sm bg-primary font-semibold shadow-sm"
              >
                <Send className="h-4 w-4" />
                Publish to All Now (×{selectedPlatforms.size})
              </Button>

              <Button
                variant="outline"
                onClick={() => setScheduleDialogOpen(true)}
                disabled={!editableCaption.trim() || selectedPlatforms.size === 0}
                className="gap-2 h-11 text-sm font-semibold border-primary/40 hover:bg-muted"
              >
                <CalendarClock className="h-4 w-4 text-primary" />
                Schedule to All (×{selectedPlatforms.size})
              </Button>
            </div>
          </div>

          {/* Interactive Live Previews */}
          <div className="border border-border rounded-xl p-5 bg-card space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <Label className="text-xs uppercase tracking-wider font-semibold">
                Live Platform Previews
              </Label>
              <div className="flex items-center gap-1 flex-wrap">
                {availablePlatforms.map((p) => {
                  const cfg = SOCIAL_PLATFORM_CONFIG[p] || {
                    label: statusMap?.[p]?.label || p,
                    icon: statusMap?.[p]?.icon || "🌐",
                  };
                  return (
                    <button
                      key={p}
                      onClick={() => setPreviewTab(p)}
                      className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors flex items-center gap-1.5 ${
                        previewTab === p
                          ? "bg-foreground text-background font-semibold"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <span>{cfg.icon}</span>
                      <span className="hidden sm:inline">{cfg.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Platform Preview Box */}
            <div className="pt-1">
              {previewTab === "x" && (
                <div className="border border-neutral-300 dark:border-neutral-800 rounded-xl p-4 bg-background max-w-lg mx-auto shadow-sm space-y-3 font-sans">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-full bg-neutral-800 text-white flex items-center justify-center font-bold text-sm">
                        {statusMap?.x?.name?.[0] || "P"}
                      </div>
                      <div>
                        <div className="flex items-center gap-1">
                          <span className="font-bold text-sm text-foreground">
                            {statusMap?.x?.name || "Your Brand"}
                          </span>
                          <span className="text-neutral-500 text-xs">
                            @{statusMap?.x?.username || "handle"}
                          </span>
                        </div>
                        <span className="text-neutral-400 text-[11px]">Just now</span>
                      </div>
                    </div>
                    <span className="font-bold text-lg text-neutral-400">𝕏</span>
                  </div>

                  <p className="text-sm whitespace-pre-wrap leading-normal text-foreground">
                    {editableCaption || "Your tweet text will appear here..."}
                  </p>

                  <SocialMediaPreviewGallery media={attachedMedia} fallbackUrl={activeMedia} platform="x" />

                  <div className="flex items-center justify-between text-neutral-500 pt-2 border-t border-neutral-100 dark:border-neutral-900 text-xs">
                    <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> 12</span>
                    <span className="flex items-center gap-1"><Repeat2 className="h-3.5 w-3.5" /> 5</span>
                    <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" /> 48</span>
                    <span className="flex items-center gap-1"><Bookmark className="h-3.5 w-3.5" /></span>
                  </div>
                </div>
              )}

              {previewTab === "linkedin" && (
                <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 bg-background max-w-lg mx-auto shadow-sm space-y-3 font-sans">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-full bg-[#0A66C2] text-white flex items-center justify-center font-bold text-sm">
                        {statusMap?.linkedin?.name?.[0] || "L"}
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-foreground leading-tight">
                          {statusMap?.linkedin?.name || "Your Company / Brand"}
                        </p>
                        <p className="text-neutral-500 text-[11px]">Official Social Profile · Now</p>
                      </div>
                    </div>
                    <MoreHorizontal className="h-4 w-4 text-neutral-400" />
                  </div>

                  <p className="text-sm whitespace-pre-wrap leading-relaxed text-foreground">
                    {editableCaption || "Your LinkedIn post copy will appear here..."}
                  </p>

                  <SocialMediaPreviewGallery media={attachedMedia} fallbackUrl={activeMedia} platform="linkedin" />

                  <div className="flex items-center justify-between text-neutral-500 pt-2 border-t border-neutral-100 dark:border-neutral-900 text-xs">
                    <span className="flex items-center gap-1"><ThumbsUp className="h-3.5 w-3.5 text-[#0A66C2]" /> Like</span>
                    <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> Comment</span>
                    <span className="flex items-center gap-1"><Repeat2 className="h-3.5 w-3.5" /> Repost</span>
                    <span className="flex items-center gap-1"><Send className="h-3.5 w-3.5" /> Send</span>
                  </div>
                </div>
              )}

              {previewTab === "instagram" && (
                <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden bg-background max-w-lg mx-auto shadow-sm font-sans">
                  <div className="flex items-center justify-between p-3 border-b border-border/60">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 text-white flex items-center justify-center font-bold text-xs p-0.5">
                        <div className="w-full h-full bg-background rounded-full flex items-center justify-center text-foreground">
                          {statusMap?.instagram?.name?.[0] || "I"}
                        </div>
                      </div>
                      <span className="font-semibold text-xs text-foreground">
                        {statusMap?.instagram?.name || "yourbrand"}
                      </span>
                    </div>
                    <MoreHorizontal className="h-4 w-4 text-neutral-400" />
                  </div>

                  {attachedMedia.length > 0 || activeMedia ? (
                    <div className="p-3">
                      <SocialMediaPreviewGallery media={attachedMedia} fallbackUrl={activeMedia} platform="instagram" />
                    </div>
                  ) : (
                    <div className="aspect-video sm:aspect-square bg-muted flex items-center justify-center overflow-hidden">
                      <div className="text-center p-6 text-muted-foreground text-xs">
                        <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <span>Instagram requires an image or video</span>
                      </div>
                    </div>
                  )}

                  <div className="p-3 space-y-2">
                    <div className="flex items-center justify-between text-neutral-600 dark:text-neutral-400">
                      <div className="flex items-center gap-3">
                        <Heart className="h-4 w-4" />
                        <MessageCircle className="h-4 w-4" />
                        <Send className="h-4 w-4" />
                      </div>
                      <Bookmark className="h-4 w-4" />
                    </div>
                    <p className="text-xs text-foreground leading-normal line-clamp-3">
                      <strong className="mr-1">{statusMap?.instagram?.name || "yourbrand"}</strong>
                      {editableCaption || "Your Instagram caption will appear here..."}
                    </p>
                  </div>
                </div>
              )}

              {previewTab === "facebook" && (
                <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 bg-background max-w-lg mx-auto shadow-sm space-y-3 font-sans">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-full bg-[#1877F2] text-white flex items-center justify-center font-bold text-sm">
                        {statusMap?.facebook?.name?.[0] || "F"}
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-foreground leading-tight">
                          {statusMap?.facebook?.name || "Your Facebook Page"}
                        </p>
                        <p className="text-neutral-500 text-[11px]">Sponsored / Public · Just now</p>
                      </div>
                    </div>
                    <MoreHorizontal className="h-4 w-4 text-neutral-400" />
                  </div>

                  <p className="text-sm whitespace-pre-wrap leading-relaxed text-foreground">
                    {editableCaption || "Your Facebook post copy will appear here..."}
                  </p>

                  <SocialMediaPreviewGallery media={attachedMedia} fallbackUrl={activeMedia} platform="facebook" />

                  <div className="flex items-center justify-between text-neutral-500 pt-2 border-t border-neutral-100 dark:border-neutral-900 text-xs">
                    <span className="flex items-center gap-1.5"><ThumbsUp className="h-4 w-4 text-[#1877F2]" /> Like</span>
                    <span className="flex items-center gap-1.5"><MessageCircle className="h-4 w-4" /> Comment</span>
                    <span className="flex items-center gap-1.5"><Repeat2 className="h-4 w-4" /> Share</span>
                  </div>
                </div>
              )}

              {!["x", "linkedin", "instagram", "facebook"].includes(previewTab) && (
                <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 bg-background max-w-lg mx-auto shadow-sm space-y-3 font-sans">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-full bg-neutral-800 text-white flex items-center justify-center font-bold text-lg">
                        {statusMap?.[previewTab]?.icon || SOCIAL_PLATFORM_CONFIG[previewTab]?.icon || "🌐"}
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-foreground leading-tight">
                          {statusMap?.[previewTab]?.label || SOCIAL_PLATFORM_CONFIG[previewTab]?.label || previewTab}
                        </p>
                        <p className="text-neutral-500 text-[11px]">
                          {statusMap?.[previewTab]?.username || statusMap?.[previewTab]?.baseUrl || "Custom Provider / Webhook"}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {statusMap?.[previewTab]?.connected ? "Connected" : "Custom"}
                    </Badge>
                  </div>

                  <p className="text-sm whitespace-pre-wrap leading-relaxed text-foreground">
                    {editableCaption || "Your custom payload or post content will appear here..."}
                  </p>

                  <SocialMediaPreviewGallery media={attachedMedia} fallbackUrl={activeMedia} platform={previewTab} />

                  <div className="flex items-center justify-between text-neutral-500 pt-2 border-t border-neutral-100 dark:border-neutral-900 text-xs">
                    <span className="text-[11px] font-mono">Limit: {(statusMap?.[previewTab]?.charLimit || 5000).toLocaleString()} chars</span>
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Ready for simultaneous dispatch</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Library Dialog */}
      <Dialog open={libOpen} onOpenChange={setLibOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Brand Visual Library</DialogTitle>
          </DialogHeader>
          {library.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No images yet. Upload media in /library.
            </p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto">
              {library.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => {
                    const vidUrl = img.kind === "video" ? (img.videoUrl ?? null) : null;
                    setImgPreview(img.dataUrl);
                    setImgDesc(img.analysis ?? null);
                    setSelectedVideoUrl(vidUrl);
                    setAttachedMedia((prev) => [
                      ...prev,
                      {
                        id: `lib-${img.id}-${Date.now()}`,
                        url: vidUrl || img.dataUrl,
                        type: img.kind === "video" ? "video" : "image",
                        name: img.name || "Library Media",
                        thumbnailUrl: img.kind === "video" ? img.dataUrl : undefined,
                        altText: img.analysis || undefined,
                      },
                    ]);
                    setLibOpen(false);
                    toast.success("Added to post attachments.");
                  }}
                  className="group relative rounded-md overflow-hidden border border-border hover:ring-2 hover:ring-accent transition"
                >
                  <img src={img.dataUrl} alt={img.name} className="w-full aspect-square object-cover" />
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

      {/* Multi-Platform Instant Publish Dialog */}
      <MultiPlatformPublishDialog
        open={publishDialogOpen}
        onOpenChange={setPublishDialogOpen}
        workspaceId={activeWorkspaceId}
        platforms={selectedList}
        statusMap={statusMap}
        text={editableCaption}
        imageDataUrl={activeMedia}
        videoUrl={activeVideoUrl}
        onPublished={() => setSavedSinceGenerate(true)}
      />

      {/* Multi-Platform Schedule Dialog */}
      <MultiPlatformScheduleDialog
        open={scheduleDialogOpen}
        onOpenChange={setScheduleDialogOpen}
        workspaceId={activeWorkspaceId}
        platforms={selectedList}
        statusMap={statusMap}
        text={editableCaption}
        imageDataUrl={activeMedia}
        videoUrl={activeVideoUrl}
        onScheduled={() => setSavedSinceGenerate(true)}
      />

      {/* Unsaved navigation alert */}
      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without publishing or scheduling?</AlertDialogTitle>
            <AlertDialogDescription>
              You have composed post content that hasn’t been published or scheduled yet. Leaving now will discard your changes.
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

// Wrapper for server function call
const getStatusFnWrapper = getSocialAccountsStatusFn;
