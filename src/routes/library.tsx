import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { brandStore, useBrandImages, useBrandGuideline } from "@/lib/brand-store";
import { analyzeImage } from "@/lib/ai.functions";
import { uploadLibraryVideo } from "@/lib/buffer.functions";
import { parseStorageObjectUrl, uploadLibraryImage } from "@/lib/media-upload.functions";
import { parseImageDataUrl } from "@/lib/media-validate";
import { capturePosterFromUrl } from "@/lib/video-poster";
import { listVideoProviders } from "@/lib/video-providers.functions";
import {
  startVideoGeneration,
  pollVideoGeneration,
  enhanceVideoPrompt,
} from "@/lib/video-gen.functions";
import type { VideoProvider } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { streamImage } from "@/lib/stream-image";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2,
  Trash2,
  Star,
  Sparkles,
  Download,
  Film,
  Image as ImageIcon,
  Play,
  RefreshCw,
  Wand2,
  X,
  Upload,
} from "lucide-react";

export const Route = createFileRoute("/library")({
  head: () => ({
    meta: [
      { title: "Library · Social Studio" },
      {
        name: "description",
        content: "Visual library — upload, generate, and manage images and videos.",
      },
    ],
  }),
  component: LibraryPage,
});

type FilterKind = "all" | "image" | "video";

/**
 * Turns a stored library asset URL back into a data URL for use as a generation
 * reference. Data URLs (legacy rows, freshly generated output) pass through
 * untouched; a signed storage URL is fetched. Returns null on any failure so
 * one unreachable reference cannot fail the whole generation.
 */
async function toReferenceDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("read_failed"));
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn("[library] reference could not be loaded", e);
    return null;
  }
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

// Uploads route through the shared URL-based capture: an object URL is
// same-origin, so the canvas never taints and the helper's tolerant failure
// path (empty poster instead of a rejection) applies here too.
async function extractVideoPoster(
  file: File,
): Promise<{ posterDataUrl: string; durationSec: number }> {
  const url = URL.createObjectURL(file);
  try {
    return await capturePosterFromUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function LibraryPage() {
  const images = useBrandImages();
  const guideline = useBrandGuideline();
  const { activeWorkspaceId } = useWorkspace();
  const imgFileRef = useRef<HTMLInputElement>(null);
  const vidFileRef = useRef<HTMLInputElement>(null);
  const analyze = useServerFn(analyzeImage);
  const uploadVideo = useServerFn(uploadLibraryVideo);
  const uploadImage = useServerFn(uploadLibraryImage);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [filter, setFilter] = useState<FilterKind>("all");
  // Which video card is currently playing in place (one at a time).
  const [playingId, setPlayingId] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [refIds, setRefIds] = useState<string[]>([]);
  const [gen, setGen] = useState<{ src: string; final: boolean } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [savingGen, setSavingGen] = useState(false);

  // Video generation state
  const listProviders = useServerFn(listVideoProviders);
  const startVideo = useServerFn(startVideoGeneration);
  const pollVideo = useServerFn(pollVideoGeneration);
  const enhancePrompt = useServerFn(enhanceVideoPrompt);
  const [providers, setProviders] = useState<VideoProvider[]>([]);
  const [providerId, setProviderId] = useState<string>("");
  const [vPrompt, setVPrompt] = useState("");
  const [aspect, setAspect] = useState<"16:9" | "9:16">("9:16");
  const [duration, setDuration] = useState<number>(8);
  const [vGen, setVGen] = useState<{
    status: "idle" | "starting" | "polling" | "done" | "error";
    message?: string;
    progress?: number;
    signedUrl?: string;
    mimeType?: string;
  }>({ status: "idle" });
  // Reference image for image-to-video
  const [refImage, setRefImage] = useState<{
    source: "library" | "upload";
    dataUrl?: string;
    url?: string;
    name?: string;
  } | null>(null);
  const [refPickerOpen, setRefPickerOpen] = useState(false);
  const refUploadRef = useRef<HTMLInputElement>(null);
  const [enhancing, setEnhancing] = useState(false);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    (async () => {
      try {
        const { providers } = await listProviders({ data: { workspaceId: activeWorkspaceId } });
        setProviders(providers);
        if (providers.length && !providerId) setProviderId(providers[0].id);
      } catch (e) {
        console.error("[library] load providers", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  // Style analysis runs off the copy already in the browser, so it costs no
  // extra download of the file we just uploaded. Failures are silent by design:
  // an asset without an analysis is still a usable asset.
  const analyzeInBackground = async (id: string, dataUrl: string) => {
    setAnalyzingIds((s) => new Set(s).add(id));
    try {
      const { analysis } = await analyze({ data: { dataUrl, purpose: "style" } });
      brandStore.updateImage(id, { analysis });
    } catch {
      /* ignore */
    } finally {
      setAnalyzingIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  const handleImageFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!activeWorkspaceId) {
      toast.error("No active workspace.");
      return;
    }
    setUploadingImage(true);
    try {
      for (const f of Array.from(files)) {
        let dataUrl: string;
        try {
          dataUrl = await fileToDataUrl(f);
        } catch {
          toast.error(`Could not read ${f.name}.`);
          continue;
        }

        // Same validator the server runs, for an immediate and specific error.
        // The picker's accept="image/*" is advisory — drag-and-drop or a renamed
        // file walks straight past it — and the server check is the real one;
        // this one just saves a pointless round trip with the file attached.
        const check = parseImageDataUrl(dataUrl);
        if (!check.ok) {
          toast.error(`${f.name}: ${check.error}`);
          continue;
        }

        const id = crypto.randomUUID();
        try {
          const uploaded = await uploadImage({
            data: { workspaceId: activeWorkspaceId, dataUrl, name: f.name },
          });
          await brandStore.addImage(
            {
              id,
              // The signed storage URL, never the base64 — the row is a pointer
              // now, so the library no longer drags every blob back on load.
              dataUrl: uploaded.url,
              name: f.name,
              approved: false,
              addedAt: Date.now(),
              kind: "image",
              mimeType: uploaded.mimeType,
              sizeBytes: uploaded.sizeBytes,
            },
            { path: uploaded.storagePath },
          );
        } catch (e) {
          console.error("[library] image upload failed", e);
          toast.error(`Could not upload ${f.name}: ${e instanceof Error ? e.message : "unknown"}`);
          continue;
        }

        void analyzeInBackground(id, dataUrl);
      }
    } finally {
      setUploadingImage(false);
    }
  };

  const handleVideoFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!activeWorkspaceId) {
      toast.error("No active workspace.");
      return;
    }
    setUploadingVideo(true);
    try {
      for (const f of Array.from(files)) {
        if (f.size > 100 * 1024 * 1024) {
          toast.error(`${f.name}: over 100MB. Please compress first.`);
          continue;
        }
        try {
          const [dataUrl, poster] = await Promise.all([
            fileToDataUrl(f),
            extractVideoPoster(f).catch(() => ({ posterDataUrl: "", durationSec: 0 })),
          ]);
          const res = await uploadVideo({
            data: {
              workspaceId: activeWorkspaceId,
              name: f.name,
              dataUrl,
              contentType: f.type || "video/mp4",
            },
          });
          await brandStore.addImage(
            {
              id: crypto.randomUUID(),
              dataUrl: poster.posterDataUrl || "",
              name: f.name,
              approved: false,
              addedAt: Date.now(),
              kind: "video",
              videoUrl: res.signedUrl,
              durationSec: poster.durationSec,
              mimeType: f.type || "video/mp4",
              sizeBytes: f.size,
            },
            // The upload function returns only a URL, so the object path is
            // recovered from it. Recording it means the file can be deleted
            // later even if the signed URL is ever rewritten or expires.
            { videoPath: parseStorageObjectUrl(res.signedUrl)?.path ?? null },
          );
          toast.success(`Uploaded ${f.name}`);
        } catch (e) {
          console.error("[library] video upload failed", e);
          toast.error(`Could not upload ${f.name}: ${e instanceof Error ? e.message : "unknown"}`);
        }
      }
    } finally {
      setUploadingVideo(false);
    }
  };

  const toggleApprove = (id: string, approved: boolean) => brandStore.updateImage(id, { approved });
  const toggleRef = (id: string) =>
    setRefIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-4)));

  const generate = async () => {
    if (!prompt.trim()) {
      toast.error("Describe the image.");
      return;
    }
    setGenerating(true);
    setGen(null);
    try {
      const picked = images
        .filter((i) => refIds.includes(i.id) && (i.kind ?? "image") === "image")
        .map((i) => i.dataUrl);
      // Image providers only ingest base64 references (see image-gen.server.ts),
      // and library images are stored URLs now, so fetch each one back into a
      // data URL here. A reference that cannot be fetched is dropped with a
      // warning rather than silently ignored — a "reference" the model never
      // saw is worse than none.
      const finalRefs = (await Promise.all(picked.map(toReferenceDataUrl))).filter(
        (r): r is string => !!r,
      );
      if (finalRefs.length < picked.length)
        toast.warning(
          `${picked.length - finalRefs.length} reference(s) could not be loaded and were skipped.`,
        );
      await streamImage(
        "/api/generate-image",
        {
          prompt,
          references: finalRefs,
          styleNotes: guideline?.visualDirection ?? "",
          workspaceId: activeWorkspaceId ?? undefined,
        },
        (src, final) => setGen({ src, final }),
      );
    } catch (e) {
      console.error(e);
      toast.error("Generation failed. Try again.");
    } finally {
      setGenerating(false);
    }
  };

  const saveGenerated = async () => {
    if (!gen || savingGen) return;
    if (!activeWorkspaceId) {
      toast.error("No active workspace.");
      return;
    }
    setSavingGen(true);
    try {
      // Generated output goes through the same upload path as a file the user
      // picked: a freshly generated PNG is a megabyte-plus of base64 otherwise,
      // and the library row would carry all of it.
      const uploaded = await uploadImage({
        data: { workspaceId: activeWorkspaceId, dataUrl: gen.src, name: "generated.png" },
      });
      await brandStore.addImage(
        {
          id: crypto.randomUUID(),
          dataUrl: uploaded.url,
          name: `generated-${Date.now()}.png`,
          approved: true,
          addedAt: Date.now(),
          kind: "image",
          mimeType: uploaded.mimeType,
          sizeBytes: uploaded.sizeBytes,
        },
        { path: uploaded.storagePath },
      );
      toast.success("Saved to library.");
    } catch (e) {
      console.error("[library] save generated failed", e);
      toast.error(`Could not save image: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setSavingGen(false);
    }
  };

  const generateVideo = async () => {
    if (!activeWorkspaceId) return;
    if (!providerId) {
      toast.error("Connect a video provider in Connections first.");
      return;
    }
    if (vPrompt.trim().length < 5) {
      toast.error("Describe the video (a few words minimum).");
      return;
    }
    setVGen({ status: "starting" });
    try {
      const libraryUrl = refImage?.source === "library" ? refImage.url : undefined;
      const libraryIsDataUrl = libraryUrl?.startsWith("data:") ?? false;
      const { operationName } = await startVideo({
        data: {
          workspaceId: activeWorkspaceId,
          providerId,
          prompt: vPrompt.trim(),
          aspectRatio: aspect,
          durationSec: duration,
          referenceImageDataUrl:
            refImage?.source === "upload"
              ? refImage.dataUrl
              : libraryIsDataUrl
                ? libraryUrl
                : undefined,
          referenceImageUrl:
            refImage?.source === "library" && !libraryIsDataUrl ? libraryUrl : undefined,
        },
      });
      setVGen({ status: "polling", progress: 0 });

      const started = Date.now();
      const maxMs = 6 * 60 * 1000; // 6 minutes
      // Poll every 8s

      while (true) {
        await new Promise((r) => setTimeout(r, 8000));
        if (Date.now() - started > maxMs) {
          setVGen({
            status: "error",
            message: "Timed out after 6 minutes. Try again — the operation may still complete.",
          });
          return;
        }
        let res;
        try {
          res = await pollVideo({
            data: { workspaceId: activeWorkspaceId, providerId, operationName },
          });
        } catch (e) {
          setVGen({ status: "error", message: e instanceof Error ? e.message : "Poll failed" });
          return;
        }
        if (res.status === "pending") {
          setVGen({ status: "polling", progress: res.progress });
          continue;
        }
        if (res.status === "error") {
          setVGen({ status: "error", message: res.message });
          return;
        }
        // done — save to library
        const provider = providers.find((p) => p.id === providerId);
        // Capture a poster frame from the finished clip so the grid shows a
        // real preview instead of the "no preview" film icon. Tolerates an
        // empty poster (CORS/decode failure) — the video itself still saves.
        const poster = await capturePosterFromUrl(res.signedUrl);
        brandStore.addImage({
          id: crypto.randomUUID(),
          dataUrl: poster.posterDataUrl,
          name: `${provider?.provider ?? "video"}-${Date.now()}.mp4`,
          // WHY false: generated output stays pending until a human approves —
          // approved assets are the brand's publishable/reference material,
          // same rule as generated images.
          approved: false,
          addedAt: Date.now(),
          kind: "video",
          videoUrl: res.signedUrl,
          durationSec: poster.durationSec || duration,
          mimeType: res.mimeType,
          sizeBytes: res.sizeBytes,
        });
        setVGen({ status: "done", signedUrl: res.signedUrl, mimeType: res.mimeType });
        toast.success("Video generated — saved to library, pending approval.");
        setVPrompt("");
        return;
      }
    } catch (e) {
      console.error(e);
      setVGen({ status: "error", message: e instanceof Error ? e.message : "Generation failed" });
    }
  };

  const handleEnhance = async () => {
    if (vPrompt.trim().length < 5) {
      toast.error("Write a short brief first, then I'll expand it.");
      return;
    }
    setEnhancing(true);
    try {
      const brandCtx = [
        guideline?.toneOfVoice && `Voice: ${guideline.toneOfVoice}.`,
        guideline?.writingStyle && `Style: ${guideline.writingStyle}.`,
        guideline?.visualDirection && `Visual: ${guideline.visualDirection}.`,
        guideline?.emotionalTone && `Mood: ${guideline.emotionalTone}.`,
      ]
        .filter(Boolean)
        .join(" ");
      const { prompt } = await enhancePrompt({
        data: {
          prompt: vPrompt.trim(),
          aspectRatio: aspect,
          durationSec: duration,
          hasReference: !!refImage,
          brandContext: brandCtx || undefined,
        },
      });
      setVPrompt(prompt);
      toast.success("Prompt enhanced.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enhance failed");
    } finally {
      setEnhancing(false);
    }
  };

  const handleRefUpload = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Reference image must be under 8 MB.");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(new Error("Could not read file"));
      r.readAsDataURL(file);
    });
    setRefImage({ source: "upload", dataUrl, name: file.name });
  };

  const filtered = filter === "all" ? images : images.filter((i) => (i.kind ?? "image") === filter);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12 space-y-12">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Library</p>
        <h1 className="mt-2 font-serif text-4xl">Visual library</h1>
        <p className="mt-2 text-muted-foreground">
          Upload approved images and short videos. Generate new on-brand images. Use any asset to
          attach to a scheduled post.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <ImageIcon className="h-6 w-6 mx-auto text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Upload images</p>
          <p className="text-xs text-muted-foreground mt-1">
            PNG, JPG, WebP or GIF, up to 15 MB. Auto-analyzed for style.
          </p>
          <Button
            variant="outline"
            onClick={() => imgFileRef.current?.click()}
            disabled={uploadingImage || !activeWorkspaceId}
            className="mt-4 gap-2"
          >
            {uploadingImage && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Choose images
          </Button>
          <input
            ref={imgFileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleImageFiles(e.target.files)}
          />
        </div>
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <Film className="h-6 w-6 mx-auto text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Upload videos</p>
          <p className="text-xs text-muted-foreground mt-1">
            MP4/MOV/WebM, up to 100 MB. Hosted ready to publish.
          </p>
          <Button
            variant="outline"
            onClick={() => vidFileRef.current?.click()}
            disabled={uploadingVideo || !activeWorkspaceId}
            className="mt-4 gap-2"
          >
            {uploadingVideo && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Choose videos
          </Button>
          <input
            ref={vidFileRef}
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={(e) => handleVideoFiles(e.target.files)}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        {(["all", "image", "video"] as FilterKind[]).map((k) => (
          <Button
            key={k}
            size="sm"
            variant={filter === k ? "default" : "outline"}
            onClick={() => setFilter(k)}
            className="capitalize"
          >
            {k === "all" ? "All" : k === "image" ? "Images" : "Videos"}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {filtered.length} asset{filtered.length === 1 ? "" : "s"}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 h-7"
            onClick={() => {
              brandStore.refresh();
              toast.success("Refreshed");
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {filtered.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((img) => {
            const analyzing = analyzingIds.has(img.id);
            const isRef = refIds.includes(img.id);
            const isVideo = (img.kind ?? "image") === "video";
            return (
              <div
                key={img.id}
                className={`group relative rounded-lg overflow-hidden border ${isRef ? "border-accent ring-2 ring-accent" : "border-border"} bg-card`}
              >
                <div className="relative">
                  {isVideo && img.videoUrl && playingId === img.id ? (
                    <video
                      src={img.videoUrl}
                      poster={img.dataUrl || undefined}
                      controls
                      autoPlay
                      playsInline
                      className="w-full aspect-square object-contain bg-black"
                      onEnded={() => setPlayingId(null)}
                    />
                  ) : img.dataUrl ? (
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      className="w-full aspect-square object-cover"
                    />
                  ) : (
                    <div className="w-full aspect-square bg-muted grid place-items-center text-muted-foreground">
                      {isVideo ? <Film className="h-8 w-8" /> : <ImageIcon className="h-8 w-8" />}
                    </div>
                  )}
                  {isVideo && img.videoUrl && playingId !== img.id && (
                    <button
                      type="button"
                      onClick={() => setPlayingId(img.id)}
                      className="absolute inset-0 grid place-items-center"
                      aria-label="Play video"
                    >
                      <div className="rounded-full bg-background/80 p-2 hover:bg-background">
                        <Play className="h-4 w-4" />
                      </div>
                    </button>
                  )}
                  {isVideo && img.durationSec && playingId !== img.id ? (
                    <span className="absolute bottom-1 right-1 rounded bg-background/85 font-mono text-[10px] px-1.5 py-0.5">
                      {Math.round(img.durationSec)}s
                    </span>
                  ) : null}
                </div>
                <div className="absolute top-2 left-2 flex gap-1">
                  {img.approved && (
                    <Badge className="bg-accent text-accent-foreground">
                      <Star className="h-3 w-3" />
                    </Badge>
                  )}
                  <Badge variant="outline" className="bg-background/85 text-[10px] uppercase">
                    {isVideo ? "Video" : "Image"}
                  </Badge>
                </div>
                <div className="absolute top-2 right-2 flex gap-1">
                  {isVideo && img.videoUrl && (
                    <a
                      href={img.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full bg-background/90 p-1.5 opacity-0 group-hover:opacity-100"
                    >
                      <Play className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <button
                    onClick={() => brandStore.removeImage(img.id)}
                    className="rounded-full bg-background/90 p-1.5 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="p-3 space-y-2">
                  <p className="text-xs truncate text-muted-foreground">{img.name}</p>
                  {analyzing ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> Analyzing…
                    </p>
                  ) : img.analysis ? (
                    <p className="text-xs text-muted-foreground line-clamp-2">{img.analysis}</p>
                  ) : null}
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant={img.approved ? "secondary" : "outline"}
                      className="h-7 text-xs flex-1"
                      onClick={() => toggleApprove(img.id, !img.approved)}
                    >
                      {img.approved ? "Approved" : "Approve"}
                    </Button>
                    <Button
                      size="sm"
                      variant={isRef ? "default" : "outline"}
                      className="h-7 text-xs flex-1"
                      onClick={() => toggleRef(img.id)}
                      disabled={isVideo}
                    >
                      {isRef ? "Reference" : isVideo ? "—" : "Use"}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div>
          <h2 className="font-serif text-2xl">Generate on-brand image</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Pick up to 4 images as visual references. Videos can't be used as references yet.
          </p>
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Prompt</Label>
          <Textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='E.g. "Carousel cover announcing our new framework, same editorial style as image 2."'
          />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Button onClick={generate} disabled={generating} className="gap-2">
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Generate
          </Button>
          {refIds.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {refIds.length} reference(s) selected
            </span>
          )}
        </div>

        {gen && (
          <div className="space-y-3">
            <div className="rounded-lg overflow-hidden border border-border bg-muted relative">
              <img
                src={gen.src}
                alt="Generated"
                className={`w-full ${gen.final ? "" : "blur-md"} transition-all duration-300`}
              />
              {!gen.final && (
                <div className="absolute bottom-2 right-2 text-xs bg-background/80 rounded px-2 py-1">
                  Refining…
                </div>
              )}
            </div>
            {gen.final && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={saveGenerated}
                  disabled={savingGen}
                  variant="default"
                  className="gap-2"
                >
                  {savingGen ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Star className="h-3.5 w-3.5" />
                  )}{" "}
                  Save as approved
                </Button>
                <a
                  href={gen.src}
                  download="generated.png"
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl flex items-center gap-2">
              <Film className="h-5 w-5" /> Generate video
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Text-to-video via your connected provider. Google Veo is the adapter shipped so far —
              other providers are stored and coming soon.
            </p>
          </div>
          {providers.length === 0 && (
            <Link to="/conexiones" className="text-xs underline shrink-0">
              Connect a provider →
            </Link>
          )}
        </div>

        {providers.length > 0 ? (
          <>
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="space-y-1.5 sm:col-span-3">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Provider
                </Label>
                <Select value={providerId} onValueChange={setProviderId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label} — {p.provider}
                        {p.defaultModel ? ` · ${p.defaultModel}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Aspect
                </Label>
                <Select value={aspect} onValueChange={(v) => setAspect(v as typeof aspect)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="9:16">9:16 (vertical / Reels)</SelectItem>
                    <SelectItem value="16:9">16:9 (landscape)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Duration
                </Label>
                <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4">4 seconds</SelectItem>
                    <SelectItem value="6">6 seconds</SelectItem>
                    <SelectItem value="8">8 seconds</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 flex items-end">
                <p className="text-[11px] text-muted-foreground">
                  Veo currently supports 16:9 or 9:16 clips at 4, 6, or 8 seconds.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Reference image (optional)
                </Label>
                {refImage && (
                  <button
                    onClick={() => setRefImage(null)}
                    className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  >
                    <X className="h-3 w-3" /> Remove
                  </button>
                )}
              </div>
              {refImage ? (
                <div className="flex items-center gap-3 p-2 rounded-lg border border-border bg-muted/40">
                  <img
                    src={refImage.dataUrl || refImage.url}
                    alt="Reference"
                    className="h-16 w-16 object-cover rounded"
                  />
                  <div className="text-xs flex-1">
                    <div className="font-medium">{refImage.name || "Library asset"}</div>
                    <div className="text-muted-foreground">
                      Used as the subject/style source. Describe the action, camera, and mood in the
                      prompt.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    onClick={() => setRefPickerOpen((v) => !v)}
                  >
                    <ImageIcon className="h-3.5 w-3.5" /> Pick from library
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    onClick={() => refUploadRef.current?.click()}
                  >
                    <Upload className="h-3.5 w-3.5" /> Upload image
                  </Button>
                  <input
                    ref={refUploadRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleRefUpload(f);
                      e.currentTarget.value = "";
                    }}
                  />
                </div>
              )}
              {refPickerOpen && !refImage && (
                <div className="rounded-lg border border-border p-2 max-h-56 overflow-auto">
                  {images.filter((i) => (i.kind ?? "image") === "image").length === 0 ? (
                    <p className="text-xs text-muted-foreground p-2">
                      No images in your library yet.
                    </p>
                  ) : (
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                      {images
                        .filter((i) => (i.kind ?? "image") === "image")
                        .map((img) => (
                          <button
                            key={img.id}
                            onClick={() => {
                              setRefImage({
                                source: "library",
                                url: img.dataUrl,
                                dataUrl: img.dataUrl,
                                name: img.name,
                              });
                              setRefPickerOpen(false);
                            }}
                            className="aspect-square rounded overflow-hidden border border-border hover:ring-2 hover:ring-primary"
                          >
                            <img
                              src={img.dataUrl}
                              alt={img.name}
                              className="w-full h-full object-cover"
                            />
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Prompt
                </Label>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 h-7"
                  onClick={handleEnhance}
                  disabled={enhancing || vPrompt.trim().length < 5}
                >
                  {enhancing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="h-3.5 w-3.5" />
                  )}
                  Enhance with AI
                </Button>
              </div>
              <Textarea
                rows={4}
                value={vPrompt}
                onChange={(e) => setVPrompt(e.target.value)}
                placeholder={
                  refImage
                    ? 'E.g. "A person holds and describes this product to camera, natural window light, subtle handheld motion, UGC feel."'
                    : 'E.g. "Slow cinematic dolly across a minimalist workspace, warm morning light, subtle steam from coffee, editorial tone."'
                }
              />
              <p className="text-[11px] text-muted-foreground">
                Tip: describe subject → action → camera → light → mood. "Enhance with AI" rewrites
                your brief into a cinematic prompt.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <Button
                onClick={generateVideo}
                disabled={vGen.status === "starting" || vGen.status === "polling" || !providerId}
                className="gap-2"
              >
                {vGen.status === "starting" || vGen.status === "polling" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Generate video
              </Button>
              {vGen.status === "starting" && (
                <span className="text-xs text-muted-foreground">Starting…</span>
              )}
              {vGen.status === "polling" && (
                <span className="text-xs text-muted-foreground">
                  Rendering…{" "}
                  {typeof vGen.progress === "number"
                    ? `${vGen.progress}%`
                    : "this usually takes 1–3 minutes"}
                </span>
              )}
              {vGen.status === "error" && (
                <span className="text-xs text-destructive">{vGen.message}</span>
              )}
            </div>

            {vGen.status === "done" && vGen.signedUrl && (
              <div className="space-y-3">
                <div className="rounded-lg overflow-hidden border border-border bg-muted">
                  <video src={vGen.signedUrl} controls className="w-full max-h-[420px] bg-black" />
                </div>
                <div className="flex gap-2">
                  <a
                    href={vGen.signedUrl}
                    download
                    className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                  <span className="text-xs text-muted-foreground self-center">
                    Saved to your library pending approval — approve it above to make it usable.
                  </span>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No video provider connected yet. Go to{" "}
            <Link to="/conexiones" className="underline">
              Connections
            </Link>{" "}
            and add a Google Veo key (or another provider) to generate short videos directly into
            your library.
          </p>
        )}
      </div>
    </div>
  );
}
