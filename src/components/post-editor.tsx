import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { scheduleStore, type ScheduledPost } from "@/lib/schedule-store";
import { brandStore, useBrandImages, useBrandGuideline } from "@/lib/brand-store";
import { streamImage } from "@/lib/stream-image";
import {
  bufferGetStatus,
  bufferCreatePost,
  bufferDeletePost,
  type BufferStatus,
  type ChannelPostOptions,
} from "@/lib/buffer.functions";
import { BufferChannelOptions, channelOptionWarning } from "@/components/buffer-channel-options";
import { useWorkspace } from "@/lib/workspace";
import { uploadLibraryImage } from "@/lib/media-upload.functions";
import { parseImageDataUrl } from "@/lib/media-validate";
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
import { toast } from "sonner";
import {
  Upload,
  Image as ImageIcon,
  Sparkles,
  Loader2,
  Trash2,
  Save,
  Copy,
  CheckCircle2,
  X,
  Star,
  Share2,
} from "lucide-react";

function toLocalInput(ts: number | null) {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PostEditor({ item, onClose }: { item: ScheduledPost; onClose: () => void }) {
  const guideline = useBrandGuideline();
  const library = useBrandImages();

  const [caption, setCaption] = useState(item.post.caption);
  const [hashtags, setHashtags] = useState(item.post.hashtags.join(" "));
  const [cta, setCta] = useState(item.post.cta);
  const [visualConcept, setVisualConcept] = useState(item.post.visualConcept);
  const [note, setNote] = useState(item.note ?? "");
  const [imageDataUrl, setImageDataUrl] = useState<string | undefined>(item.imageDataUrl);
  const [videoUrl, setVideoUrl] = useState<string | undefined>(item.videoUrl);
  const [scheduledAtInput, setScheduledAtInput] = useState(toLocalInput(item.scheduledAt));

  const fileRef = useRef<HTMLInputElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genPrompt, setGenPrompt] = useState(item.post.visualConcept || "");
  const [genBusy, setGenBusy] = useState(false);
  const [genFrame, setGenFrame] = useState<{ src: string; final: boolean } | null>(null);

  // Buffer push
  const { activeWorkspaceId } = useWorkspace();
  const getStatus = useServerFn(bufferGetStatus);
  const pushToBuffer = useServerFn(bufferCreatePost);
  const removeFromBuffer = useServerFn(bufferDeletePost);
  const uploadImage = useServerFn(uploadLibraryImage);
  const [bufferStatus, setBufferStatus] = useState<BufferStatus | null>(null);
  const [bufferOpen, setBufferOpen] = useState(false);
  const [bufferChannelIds, setBufferChannelIds] = useState<string[]>([]);
  const [bufferAtInput, setBufferAtInput] = useState("");
  const [bufferPerChannel, setBufferPerChannel] = useState<Record<string, ChannelPostOptions>>({});
  const [bufferBusy, setBufferBusy] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [imageUploadBusy, setImageUploadBusy] = useState(false);

  // A post with a buffer_id is queued (or already out) on a real channel, so
  // deleting it means two deletes, not one. The confirmation has to say which.
  const isLive = Boolean(item.bufferId);
  // Name the channel when we know it, otherwise fall back to the platform the
  // post was written for. Never show a bare "this post will be removed".
  const liveChannel = item.bufferChannelId
    ? bufferStatus?.channels.find((c) => c.id === item.bufferChannelId)
    : undefined;
  const channelLabel = liveChannel
    ? `${liveChannel.name} (${liveChannel.service})`
    : item.post.platform;

  useEffect(() => {
    if (!activeWorkspaceId) return;
    void getStatus({ data: { workspaceId: activeWorkspaceId } })
      .then(setBufferStatus)
      .catch(() => setBufferStatus(null));
  }, [getStatus, activeWorkspaceId]);

  useEffect(() => {
    setBufferAtInput(scheduledAtInput);
    // default to all channels
    if (bufferStatus?.connected) setBufferChannelIds(bufferStatus.channels.map((c) => c.id));
  }, [bufferOpen, bufferStatus, scheduledAtInput]);

  useEffect(() => {
    setCaption(item.post.caption);
    setHashtags(item.post.hashtags.join(" "));
    setCta(item.post.cta);
    setVisualConcept(item.post.visualConcept);
    setNote(item.note ?? "");
    setImageDataUrl(item.imageDataUrl);
    setVideoUrl(item.videoUrl);
    setScheduledAtInput(toLocalInput(item.scheduledAt));
  }, [item.id]);

  const dirty =
    caption !== item.post.caption ||
    hashtags !== item.post.hashtags.join(" ") ||
    cta !== item.post.cta ||
    visualConcept !== item.post.visualConcept ||
    note !== (item.note ?? "") ||
    imageDataUrl !== item.imageDataUrl ||
    videoUrl !== item.videoUrl ||
    scheduledAtInput !== toLocalInput(item.scheduledAt);

  const save = () => {
    const tags = hashtags
      .split(/\s+/)
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);
    let scheduledAt: number | null = null;
    let status = item.status;
    if (scheduledAtInput) {
      const ts = new Date(scheduledAtInput).getTime();
      if (!Number.isFinite(ts)) {
        toast.error("Invalid date.");
        return;
      }
      scheduledAt = ts;
      if (status === "draft") status = "scheduled";
    } else {
      status = item.status === "published" ? "published" : "draft";
    }
    const dateMoved = scheduledAt !== item.scheduledAt;
    scheduleStore.update(item.id, {
      post: { ...item.post, caption, hashtags: tags, cta, visualConcept },
      note: note.trim() || undefined,
      imageDataUrl,
      videoUrl,
      scheduledAt,
      status,
    });
    toast.success("Changes saved.");
    // Editing a live post only edits the calendar copy. Buffer already holds
    // the text and the time it was given, and nothing here goes back to update
    // it — so say what did not change instead of implying it did.
    if (item.bufferId) {
      toast.warning(
        dateMoved
          ? `Calendar only — the post already queued on ${channelLabel} keeps its original time and text. Unpublish and publish again to change it there.`
          : `Calendar only — the post already queued on ${channelLabel} keeps its original text. Unpublish and publish again to change it there.`,
      );
    }
  };

  const readAsDataUrl = (f: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
      reader.readAsDataURL(f);
    });

  // Routes through the same server function the library page uses
  // (docs/bugs.md finding 8): the file is sniffed by its real leading bytes,
  // capped at the same size, checked against workspace membership, and stored
  // in the `media` bucket rather than inlined as base64. This has always also
  // saved the upload to the brand library (not just attached it to the post),
  // so that behaviour is kept — only the storage mechanism changes.
  const handleFile = async (f: File) => {
    if (!activeWorkspaceId) {
      toast.error("No active workspace.");
      return;
    }

    let dataUrl: string;
    try {
      dataUrl = await readAsDataUrl(f);
    } catch {
      toast.error(`Could not read ${f.name}.`);
      return;
    }

    // Same validator the server runs, for an immediate and specific error
    // before the file is even sent — the picker's accept="image/*" is
    // advisory and a renamed file walks straight past it.
    const check = parseImageDataUrl(dataUrl);
    if (!check.ok) {
      toast.error(`${f.name}: ${check.error}`);
      return;
    }

    setImageUploadBusy(true);
    try {
      const uploaded = await uploadImage({
        data: { workspaceId: activeWorkspaceId, dataUrl, name: f.name },
      });
      // The signed storage URL, never the base64 — matches what the post
      // sends to Buffer at publish time and what the library stores.
      setImageDataUrl(uploaded.url);
      await brandStore.addImage(
        {
          id: crypto.randomUUID(),
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
      toast.success("Image uploaded and saved to the library.");
    } catch (e) {
      console.error("[post-editor] image upload failed", e);
      toast.error(`Could not upload ${f.name}: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setImageUploadBusy(false);
    }
  };

  const generate = async () => {
    if (!genPrompt.trim()) {
      toast.error("Describe the image.");
      return;
    }
    setGenBusy(true);
    setGenFrame(null);
    try {
      // Do not auto-include approved references — they bias the model toward
      // whatever happens to be in the library.
      // The user can pick references explicitly in /imagenes.
      await streamImage(
        "/api/generate-image",
        {
          prompt: genPrompt,
          references: [],
          styleNotes: guideline?.visualDirection ?? "",
          workspaceId: activeWorkspaceId ?? undefined,
        },
        (src, final) => setGenFrame({ src, final }),
      );
    } catch (e) {
      console.error(e);
      toast.error("Generation failed. Try again.");
    } finally {
      setGenBusy(false);
    }
  };

  const useGenerated = () => {
    if (!genFrame?.final) return;
    setImageDataUrl(genFrame.src);
    brandStore.addImage({
      id: crypto.randomUUID(),
      dataUrl: genFrame.src,
      name: `generated-${Date.now()}.png`,
      approved: true,
      addedAt: Date.now(),
    });
    toast.success("Image added to the post and saved to the library.");
    setGenOpen(false);
    setGenFrame(null);
    setGenPrompt("");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="capitalize">
          {item.post.platform}
        </Badge>
        <Badge variant="outline">{item.status}</Badge>
      </div>

      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          {videoUrl ? "Video" : "Image"}
        </Label>
        {videoUrl ? (
          <div className="relative rounded-md overflow-hidden border border-border">
            <video
              src={videoUrl}
              poster={imageDataUrl}
              controls
              playsInline
              preload="metadata"
              className="block mx-auto w-auto max-w-full max-h-[60vh] bg-black"
            />
            <button
              type="button"
              onClick={() => {
                setVideoUrl(undefined);
                setImageDataUrl(undefined);
              }}
              className="absolute top-2 right-2 rounded-full bg-background/90 p-1.5 hover:bg-background"
              aria-label="Remove video"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : imageDataUrl ? (
          <div className="relative rounded-md overflow-hidden border border-border">
            <img src={imageDataUrl} alt="" className="w-full aspect-square object-cover" />
            <button
              type="button"
              onClick={() => setImageDataUrl(undefined)}
              className="absolute top-2 right-2 rounded-full bg-background/90 p-1.5 hover:bg-background"
              aria-label="Remove image"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            No image. Upload one, pick from the library, or generate with AI.
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={imageUploadBusy}
            onClick={() => fileRef.current?.click()}
          >
            {imageUploadBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Upload
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setLibraryOpen(true)}
          >
            <ImageIcon className="h-3.5 w-3.5" /> Library
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setGenOpen(true)}>
            <Sparkles className="h-3.5 w-3.5" /> Generate
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          disabled={imageUploadBusy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Caption</Label>
        <Textarea rows={7} value={caption} onChange={(e) => setCaption(e.target.value)} />
        <p className="text-[11px] text-muted-foreground text-right">{caption.length} characters</p>
      </div>

      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Hashtags</Label>
        <Input
          value={hashtags}
          onChange={(e) => setHashtags(e.target.value)}
          placeholder="#brand #topic"
        />
      </div>

      <div className="grid grid-cols-1 gap-2">
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">CTA</Label>
          <Input value={cta} onChange={(e) => setCta(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Visual concept
          </Label>
          <Textarea
            rows={2}
            value={visualConcept}
            onChange={(e) => setVisualConcept(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Date and time
        </Label>
        <Input
          type="datetime-local"
          value={scheduledAtInput}
          onChange={(e) => setScheduledAtInput(e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">Leave empty to save as draft.</p>
      </div>

      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Note</Label>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
        <Button size="sm" onClick={save} disabled={!dirty} className="gap-2">
          <Save className="h-3.5 w-3.5" /> Save changes
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          onClick={() => {
            const full = `${caption}${hashtags ? `\n\n${hashtags}` : ""}`;
            navigator.clipboard.writeText(full);
            toast.success("Copied.");
          }}
        >
          <Copy className="h-3.5 w-3.5" /> Copy
        </Button>
        {item.status !== "published" && (
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => {
              scheduleStore.update(item.id, { status: "published" });
              toast.success("Marked as published.");
            }}
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Mark published
          </Button>
        )}
        {item.bufferId ? (
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={async () => {
              if (!activeWorkspaceId || !item.bufferId) return;
              try {
                await removeFromBuffer({
                  data: { workspaceId: activeWorkspaceId, id: item.bufferId },
                });
                scheduleStore.update(item.id, { bufferId: undefined, bufferChannelId: undefined });
                toast.success("Unpublished.");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Publishing error");
              }
            }}
          >
            <Share2 className="h-3.5 w-3.5" /> Unpublish
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            disabled={!bufferStatus?.connected}
            title={
              bufferStatus?.connected
                ? "Publish this post to your channels"
                : "Link your channels at /conexiones"
            }
            onClick={() => setBufferOpen(true)}
          >
            <Share2 className="h-3.5 w-3.5" /> Publish
          </Button>
        )}
        <Button
          size="sm"
          variant="destructive"
          className="gap-2 ml-auto"
          onClick={() => setConfirmDeleteOpen(true)}
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
      </div>

      <AlertDialog
        open={confirmDeleteOpen}
        onOpenChange={(o) => {
          if (!deleteBusy) setConfirmDeleteOpen(o);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isLive
                ? `Delete this post and remove it from ${channelLabel}?`
                : "Delete this post?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isLive ? (
                <>
                  This post is live on {channelLabel}. It will be removed from {channelLabel} first,
                  so it will not go out, and only then deleted from your calendar. Its stored image
                  is deleted too. If {channelLabel} cannot be reached, nothing is deleted. This
                  cannot be undone.
                </>
              ) : (
                <>
                  This post has not been sent to any channel, so nothing is published or unpublished
                  anywhere. It is removed from your calendar and its stored image is deleted. This
                  cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Keep the post</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteBusy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                // Keep the dialog open while the two deletes run; a failure has
                // to leave the user looking at the post that still exists.
                e.preventDefault();
                setDeleteBusy(true);
                const res = await scheduleStore.remove(item.id, {
                  removeFromBuffer: async ({ bufferId }) => {
                    if (!activeWorkspaceId) {
                      throw new Error("No active workspace — cannot reach the channel");
                    }
                    await removeFromBuffer({
                      data: { workspaceId: activeWorkspaceId, id: bufferId },
                    });
                  },
                });
                setDeleteBusy(false);
                if (!res.ok) return;
                setConfirmDeleteOpen(false);
                toast.success(
                  res.bufferRemoved ? `Deleted, and removed from ${channelLabel}.` : "Deleted.",
                );
                onClose();
              }}
            >
              {deleteBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isLive ? (
                "Remove and delete"
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={bufferOpen} onOpenChange={setBufferOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Publish</DialogTitle>
          </DialogHeader>
          {!bufferStatus?.connected ? (
            <p className="text-sm text-muted-foreground">
              Publishing is not connected. Link your account in /conexiones.
            </p>
          ) : bufferStatus.channels.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Connected, but no channels are linked yet. Add one from the Connections page.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Channels
                </Label>
                <div className="space-y-1.5 max-h-72 overflow-y-auto rounded-md border border-border p-2">
                  {bufferStatus.channels.map((c) => {
                    const checked = bufferChannelIds.includes(c.id);
                    return (
                      <div key={c.id}>
                        <label className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted cursor-pointer text-sm">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) =>
                              setBufferChannelIds((cur) =>
                                v ? [...cur, c.id] : cur.filter((id) => id !== c.id),
                              )
                            }
                          />
                          <span className="capitalize text-muted-foreground w-20">{c.service}</span>
                          <span>{c.name}</span>
                        </label>
                        {checked && (
                          <BufferChannelOptions
                            channel={c}
                            value={bufferPerChannel[c.id]}
                            onChange={(next) =>
                              setBufferPerChannel((p) => ({ ...p, [c.id]: next }))
                            }
                            media={{ hasImage: !!item.imageDataUrl, hasVideo: !!item.videoUrl }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Date and time
                </Label>
                <Input
                  type="datetime-local"
                  value={bufferAtInput}
                  onChange={(e) => setBufferAtInput(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Leave empty to use the next open queue slot.
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Publishes as text. Any image stays on the internal calendar only.
              </p>
              <Button
                className="w-full gap-2"
                disabled={bufferBusy || bufferChannelIds.length === 0 || !activeWorkspaceId}
                onClick={async () => {
                  if (!activeWorkspaceId) return;
                  const media = { hasImage: !!item.imageDataUrl, hasVideo: !!item.videoUrl };
                  for (const id of bufferChannelIds) {
                    const ch = bufferStatus.channels.find((c) => c.id === id);
                    const warn = ch
                      ? channelOptionWarning(ch.service, bufferPerChannel[id], media)
                      : null;
                    if (warn) {
                      toast.error(`${ch?.name}: ${warn}`);
                      return;
                    }
                  }
                  setBufferBusy(true);
                  try {
                    let iso: string | undefined;
                    if (bufferAtInput) {
                      const d = new Date(bufferAtInput);
                      if (!Number.isFinite(d.getTime())) throw new Error("Invalid date");
                      iso = d.toISOString();
                    }
                    const text = `${caption}${hashtags.trim() ? `\n\n${hashtags.trim()}` : ""}`;
                    const sel: Record<string, ChannelPostOptions> = {};
                    for (const id of bufferChannelIds)
                      if (bufferPerChannel[id]) sel[id] = bufferPerChannel[id];
                    const res = await pushToBuffer({
                      data: {
                        workspaceId: activeWorkspaceId,
                        channelIds: bufferChannelIds,
                        text,
                        scheduledAtISO: iso,
                        imageDataUrl: item.imageDataUrl,
                        videoUrl: item.videoUrl,
                        ...(Object.keys(sel).length ? { perChannel: sel } : {}),
                      },
                    });
                    const first = res.results.find((r) => r.ok);
                    if (first?.postId) {
                      scheduleStore.update(item.id, {
                        bufferId: first.postId,
                        bufferChannelId: first.channelId,
                        status: iso ? "scheduled" : item.status,
                        scheduledAt: iso ? new Date(iso).getTime() : item.scheduledAt,
                      });
                    }
                    const okCount = res.results.filter((r) => r.ok).length;
                    const failCount = res.results.length - okCount;
                    toast.success(
                      `Sent to ${okCount} channel${okCount === 1 ? "" : "s"}${failCount ? ` · ${failCount} failed` : ""}`,
                    );
                    setBufferOpen(false);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Publishing error");
                  } finally {
                    setBufferBusy(false);
                  }
                }}
              >
                {bufferBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Share2 className="h-4 w-4" />
                )}
                Publish
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Visual library</DialogTitle>
          </DialogHeader>
          {library.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No images yet. Upload or generate from here or in /images.
            </p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto">
              {library.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => {
                    setImageDataUrl(img.dataUrl);
                    setVideoUrl(img.kind === "video" ? (img.videoUrl ?? undefined) : undefined);
                    setLibraryOpen(false);
                    toast.success(`${img.kind === "video" ? "Video" : "Image"} selected.`);
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

      <Dialog
        open={genOpen}
        onOpenChange={(o) => {
          setGenOpen(o);
          if (!o) {
            setGenFrame(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Generate image</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Prompt</Label>
            <Textarea
              rows={3}
              value={genPrompt}
              onChange={(e) => setGenPrompt(e.target.value)}
              placeholder="Describe the image. It will use your brand style and approved references."
            />
            <Button onClick={generate} disabled={genBusy} className="gap-2 w-full">
              {genBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Generate
            </Button>
            {genFrame && (
              <div className="space-y-2">
                <div className="rounded-md overflow-hidden border border-border relative">
                  <img
                    src={genFrame.src}
                    alt=""
                    className={`w-full ${genFrame.final ? "" : "blur-md"} transition-all duration-300`}
                  />
                </div>
                {genFrame.final && (
                  <Button onClick={useGenerated} className="w-full gap-2">
                    <Star className="h-3.5 w-3.5" /> Use in this post
                  </Button>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
