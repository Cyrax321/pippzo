import { createFileRoute, Link } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { useServerFn } from "@tanstack/react-start";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  brandContextSummary,
  brandContextMeta,
  brandStore,
  useBrandImages,
} from "@/lib/brand-store";
import { scheduleStore, useScheduledPosts, type ScheduledPost } from "@/lib/schedule-store";
import {
  bufferAssembleCarousel,
  bufferCreatePost,
  bufferDeletePost,
  bufferGetStatus,
  type BufferStatus,
} from "@/lib/buffer.functions";
import { competitorsStore } from "@/lib/competitors-store";
import { scanCompetitorV2 } from "@/lib/scrapecreators.functions";
import { streamImage } from "@/lib/stream-image";
import { listVideoProviders } from "@/lib/video-providers.functions";
import { startVideoGeneration, pollVideoGeneration } from "@/lib/video-gen.functions";
import { capturePosterFromUrl } from "@/lib/video-poster";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Send,
  Loader2,
  CalendarCheck2,
  CalendarClock,
  CalendarX2,
  ListChecks,
  Share2,
  ImageIcon,
  Star,
  Paperclip,
  X,
  FileText,
  Search,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import type { Platform, BrandImage } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { logActivityFn } from "@/lib/activity-log";
import { safeHttpUrl } from "@/lib/safe-url";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Chat · Social Studio" },
      { name: "description", content: "Talk to your social agent." },
    ],
  }),
  component: ChatPage,
});

type ScheduleArgs = {
  platform: Platform;
  caption: string;
  hashtags?: string[];
  cta?: string;
  visualConcept?: string;
  scheduledAt?: string;
  note?: string;
  imageId?: string;
};
type RescheduleArgs = { id: string; scheduledAt?: string };
type DeleteArgs = { id: string };
type ListArgs = { fromISO?: string; toISO?: string };
type GenImageArgs = {
  prompt: string;
  referenceImageIds?: string[];
  aspect?: "square" | "portrait" | "landscape";
  ignoreBrandReferences?: boolean;
};
type GenVideoArgs = {
  prompt: string;
  aspectRatio?: "9:16" | "16:9";
  durationSec?: number;
  providerKind?: string;
  referenceImageId?: string;
};
type ShowLibraryArgs = { onlyApproved?: boolean };
type BufferScheduleArgs = {
  channelIds?: string[];
  channelId?: string;
  text: string;
  scheduledAtISO?: string;
  publishNow?: boolean;
  imageId?: string;
  platform?: Platform;
  instagramType?: "post" | "reel" | "story";
  shouldShareToFeed?: boolean;
  firstComment?: string;
  carouselImageIds?: string[];
  carouselTitle?: string;
};

function snapshot(items: ScheduledPost[]) {
  if (!items.length) return "(empty)";
  return items
    .slice(0, 30)
    .map((i) => {
      const when = i.scheduledAt ? new Date(i.scheduledAt).toISOString() : "draft";
      return `- id=${i.id} | ${i.post.platform} | ${when} | ${i.post.caption.slice(0, 60)}`;
    })
    .join("\n");
}

type LibraryItem = { id: string; name: string; approved: boolean; analysis?: string };

function LibraryPicker({
  done,
  items,
  count,
  resolveSrc,
  onInsert,
}: {
  done: boolean;
  items: LibraryItem[];
  count: number;
  resolveSrc: (id: string) => string | undefined;
  onInsert: (ids: string[]) => void;
}) {
  const PAGE = 8;
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const pages = Math.max(1, Math.ceil(items.length / PAGE));
  const safePage = Math.min(page, pages - 1);
  const slice = items.slice(safePage * PAGE, safePage * PAGE + PAGE);
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ImageIcon className="h-4 w-4" />
        {done ? `Visual library · ${count} image${count === 1 ? "" : "s"}` : "Loading library…"}
      </div>
      {done && items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nothing saved yet. Upload some in{" "}
          <Link to="/library" className="underline">
            Library
          </Link>
          .
        </p>
      )}
      {items.length > 0 && (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {slice.map((it) => {
              const src = resolveSrc(it.id);
              const isSel = selected.includes(it.id);
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => toggle(it.id)}
                  className={`relative rounded-md overflow-hidden border bg-background text-left transition ${isSel ? "border-foreground ring-2 ring-foreground" : "border-border hover:border-foreground/50"}`}
                >
                  {src ? (
                    <img src={src} alt={it.name} className="w-full aspect-square object-cover" />
                  ) : (
                    <div className="w-full aspect-square grid place-items-center text-[10px] text-muted-foreground">
                      no preview
                    </div>
                  )}
                  {it.approved && (
                    <div className="absolute top-1 left-1 rounded-full bg-accent text-accent-foreground p-0.5">
                      <Star className="h-2.5 w-2.5" />
                    </div>
                  )}
                  {isSel && (
                    <div className="absolute top-1 right-1 rounded-full bg-foreground text-background text-[10px] font-semibold h-4 min-w-4 px-1 grid place-items-center">
                      {selected.indexOf(it.id) + 1}
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-background/85 backdrop-blur-sm px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground truncate">
                    {it.id.slice(0, 8)}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                Prev
              </Button>
              <span className="text-[11px] text-muted-foreground px-1">
                Page {safePage + 1} / {pages}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={safePage >= pages - 1}
                onClick={() => setPage(safePage + 1)}
              >
                Next
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {selected.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setSelected([])}
                >
                  Clear
                </Button>
              )}
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={selected.length === 0}
                onClick={() => {
                  onInsert(selected);
                  setSelected([]);
                }}
              >
                Use {selected.length || ""} selected
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ChatPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [brandContext, setBrandContext] = useState("");
  const [meta, setMeta] = useState({
    hasProfile: false,
    hasGuideline: false,
    approvedImages: 0,
    chars: 0,
  });
  const items = useScheduledPosts();
  const library = useBrandImages();

  const [buffer, setBuffer] = useState<BufferStatus | null>(null);
  const bufferCreate = useServerFn(bufferCreatePost);
  const bufferDelete = useServerFn(bufferDeletePost);
  const getStatus = useServerFn(bufferGetStatus);
  const analyzeCompetitorFn = useServerFn(scanCompetitorV2);
  const videoProvidersFn = useServerFn(listVideoProviders);
  const startVideoFn = useServerFn(startVideoGeneration);
  const pollVideoFn = useServerFn(pollVideoGeneration);
  const assembleCarouselFn = useServerFn(bufferAssembleCarousel);
  // Stash generated + library images by id so the agent can reference them by id.
  const imageStashRef = useRef<Map<string, string>>(new Map());
  // For library video assets, keep the signed video URL alongside the poster
  // so passing a library imageId can also carry a videoUrl to Buffer.
  const videoStashRef = useRef<Map<string, string>>(new Map());
  // For UI: re-render image previews as partial frames arrive.
  const [imageFrames, setImageFrames] = useState<
    Record<string, { dataUrl: string; final: boolean }>
  >({});
  // Per-toolCall video render progress, keyed by toolCallId so the chat card can
  // show "Rendering… N%" while the (minutes-long) client tool is still running.
  const [videoJobs, setVideoJobs] = useState<Record<string, { label: string; progress?: number }>>(
    {},
  );

  // Keep library images available in the stash so the agent can pass a
  // library id straight into schedulePost.imageId or generateImage.referenceImageIds.
  useEffect(() => {
    for (const img of library) {
      imageStashRef.current.set(img.id, img.dataUrl);
      if (img.kind === "video" && img.videoUrl) videoStashRef.current.set(img.id, img.videoUrl);
    }
  }, [library]);
  const libraryRef = useRef<BrandImage[]>(library);
  libraryRef.current = library;

  useEffect(() => {
    const refresh = () => {
      setBrandContext(brandContextSummary());
      setMeta(brandContextMeta());
    };
    refresh();
    const unsub = brandStore.subscribe(refresh);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Approval mode is deliberately NOT enforced on chat actions: the approval
  // queue gates AUTONOMOUS output (cron-created posts), while a post the user
  // asks for in this conversation is human-directed — the instruction itself is
  // the red button. The server injects the flag into the system prompt so the
  // agent can mention pending automation posts, but chat scheduling stays live.
  useEffect(() => {
    if (!activeWorkspaceId) {
      setBuffer(null);
      return;
    }
    void getStatus({ data: { workspaceId: activeWorkspaceId } })
      .then(setBuffer)
      .catch(() => setBuffer(null));
  }, [getStatus, activeWorkspaceId]);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const bufferRef = useRef(buffer);
  bufferRef.current = buffer;

  const wsRef = useRef(activeWorkspaceId);
  wsRef.current = activeWorkspaceId;
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: async () => {
          const { authHeaders } = await import("@/lib/auth-headers");
          return await authHeaders();
        },
        body: () => ({
          brandContext: brandContextSummary(),
          scheduledSnapshot: snapshot(itemsRef.current),
          workspaceId: wsRef.current,
          bufferSnapshot: bufferRef.current
            ? {
                connected: bufferRef.current.connected,
                error: bufferRef.current.error ?? null,
                channels: bufferRef.current.channels.map((c) => ({
                  id: c.id,
                  service: c.service,
                  name: c.name,
                })),
              }
            : { connected: false, error: "no_workspace", channels: [] },
          librarySnapshot: libraryRef.current
            .slice()
            .sort((a, b) => (b.approved ? 1 : 0) - (a.approved ? 1 : 0) || b.addedAt - a.addedAt)
            .slice(0, 40)
            .map((i) => ({
              id: i.id,
              name: i.name,
              approved: i.approved,
              analysis: i.analysis,
              kind: i.kind ?? "image",
            })),
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, addToolResult } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    // Without this, a failed request (e.g. no model key connected yet) ends the
    // stream silently and the user sees a blank reply instead of the fix.
    onError(error) {
      const msg = (error instanceof Error ? error.message : String(error)).trim();
      if (/no text model connected/i.test(msg)) {
        toast.error("No AI model is connected yet.", {
          description: "Add your own API key in Connections, then try again.",
          duration: 10000,
        });
      } else {
        toast.error("The chat request failed.", { description: msg.slice(0, 300), duration: 8000 });
      }
    },
    async onToolCall({ toolCall }) {
      try {
        if (toolCall.toolName === "generateImage") {
          const a = toolCall.input as GenImageArgs;
          const imageId = crypto.randomUUID();
          let lastFrame: string | null = null;
          setImageFrames((f) => ({ ...f, [imageId]: { dataUrl: "", final: false } }));
          const requestedIds = a.referenceImageIds ?? [];
          // Video assets stash their poster frame in imageStash, so without this
          // filter a video reference silently substituted the poster and the
          // agent claimed the video steered the image. Reject video ids instead.
          const videoIds = requestedIds.filter(
            (id) =>
              videoStashRef.current.has(id) ||
              libraryRef.current.find((x) => x.id === id)?.kind === "video",
          );
          const usableIds = requestedIds.filter((id) => !videoIds.includes(id));
          const refs = usableIds
            .map((id) => imageStashRef.current.get(id))
            .filter((v): v is string => !!v)
            .slice(0, 4);
          // Ids the agent asked for but that had no image data available (plus
          // rejected video ids). Reported back so it cannot claim references
          // were used when they were dropped.
          const unresolvedIds = [
            ...usableIds.filter((id) => !imageStashRef.current.get(id)),
            ...videoIds,
          ];
          let meta = { referencesUsed: 0, autoAttached: 0 };
          try {
            meta = await streamImage(
              "/api/generate-image",
              {
                prompt: a.prompt,
                references: refs,
                aspect: a.aspect ?? "square",
                ignoreBrandReferences: a.ignoreBrandReferences === true,
                workspaceId: activeWorkspaceId ?? undefined,
              },
              (dataUrl, isFinal) => {
                lastFrame = dataUrl;
                setImageFrames((f) => ({ ...f, [imageId]: { dataUrl, final: isFinal } }));
              },
            );
          } catch (err) {
            setImageFrames((f) => {
              const n = { ...f };
              delete n[imageId];
              return n;
            });
            addToolResult({
              tool: "generateImage",
              toolCallId: toolCall.toolCallId,
              output: { ok: false, error: err instanceof Error ? err.message : "image_failed" },
            });
            return;
          }
          if (!lastFrame) {
            addToolResult({
              tool: "generateImage",
              toolCallId: toolCall.toolCallId,
              output: { ok: false, error: "no_frame" },
            });
            return;
          }
          imageStashRef.current.set(imageId, lastFrame);

          // Persist to the library. Without this the image lived only in an
          // in-memory Map: the agent claimed it was "saved in the library" when
          // it was not, and a page reload orphaned the id so scheduling with it
          // silently attached nothing.
          //
          // approved: false is deliberate. Approved assets are the style source
          // of truth for future generations, so auto-approving AI output would
          // let the brand drift toward its own generated work. A human approves
          // in /library.
          let savedToLibrary = false;
          try {
            await brandStore.addImage({
              id: imageId,
              dataUrl: lastFrame,
              name: `Generated · ${a.prompt.slice(0, 48)}`,
              approved: false,
              addedAt: Date.now(),
              kind: "image",
              mimeType: "image/png",
            });
            savedToLibrary = true;
          } catch (e) {
            console.error("[chat] could not save generated image to the library", e);
          }

          if (activeWorkspaceId)
            logActivityFn({
              workspaceId: activeWorkspaceId,
              actorType: "agent",
              action: "image.generated",
              summary: `Generated an image: "${a.prompt.slice(0, 100)}"`,
              details: {
                imageId,
                referencedIds: a.referenceImageIds ?? [],
                referencesUsed: meta.referencesUsed,
                autoAttached: meta.autoAttached,
                savedToLibrary,
              },
            });
          addToolResult({
            tool: "generateImage",
            toolCallId: toolCall.toolCallId,
            output: {
              ok: true,
              imageId,
              prompt: a.prompt,
              aspect: a.aspect ?? "square",
              // Counts reported by the server — what the provider actually
              // ingested, not what this client hoped it would. Never claim more.
              referencesUsed: meta.referencesUsed,
              referencedIds: usableIds.filter((id) => !!imageStashRef.current.get(id)),
              // Report the real outcome so the reply can be accurate about it.
              savedToLibrary,
              libraryStatus: savedToLibrary
                ? "Saved to the library as PENDING approval — tell the user it is there and needs approving before it counts as an on-brand reference."
                : "NOT saved to the library — say so plainly; the image exists only for this conversation.",
              ...(meta.autoAttached
                ? {
                    autoAttachedApprovedAssets: meta.autoAttached,
                    note: `You passed no references, so the app automatically used ${meta.autoAttached} approved library asset(s) as the style source of truth.`,
                  }
                : {}),
              ...(unresolvedIds.length
                ? {
                    unresolvedReferenceIds: unresolvedIds,
                    warning: videoIds.length
                      ? "Some reference ids were NOT sent. Video assets cannot be image references (their poster frame is NOT substituted) — tell the user which ids were ignored and why."
                      : "Some reference ids had no image data and were NOT sent. Tell the user which ones were ignored.",
                  }
                : {}),
            },
          });
          return;
        }
        if (toolCall.toolName === "generateVideo") {
          const a = toolCall.input as GenVideoArgs;
          const tcId = toolCall.toolCallId;
          const setJob = (label: string, progress?: number) =>
            setVideoJobs((j) => ({ ...j, [tcId]: { label, progress } }));
          try {
            // Provider pick happens client-side (matches the library page):
            // first saved provider whose kind has a shipped server adapter and
            // whose key is usable. Keep this list in sync with
            // video-adapters.server.ts.
            const SUPPORTED_VIDEO_KINDS = ["veo", "gemini-omni", "seedance", "kling", "runway"];
            const ws = wsRef.current;
            if (!ws) {
              addToolResult({
                tool: "generateVideo",
                toolCallId: tcId,
                output: { ok: false, error: "no_workspace" },
              });
              return;
            }
            const { providers } = await videoProvidersFn({ data: { workspaceId: ws } });
            const usable = providers.filter(
              (pv) => SUPPORTED_VIDEO_KINDS.includes(pv.provider) && pv.hasKey,
            );
            // Honor the agent's provider choice when that kind is connected;
            // otherwise pick the best fit for the requested duration.
            const { bestProviderKind } = await import("@/lib/video-caps");
            const wantedKind =
              a.providerKind && usable.some((pv) => pv.provider === a.providerKind)
                ? a.providerKind
                : bestProviderKind(
                    usable.map((pv) => pv.provider),
                    a.durationSec ?? 8,
                  );
            const provider = usable.find((pv) => pv.provider === wantedKind) ?? usable[0];
            if (!provider) {
              addToolResult({
                tool: "generateVideo",
                toolCallId: tcId,
                output: {
                  ok: false,
                  error:
                    "No usable video provider. Connect one (Google Veo / Gemini Omni Flash, Seedance, or Kling) in Settings → Connections → Video generation.",
                },
              });
              return;
            }

            // Reference must be an image; videoStash membership means it is a video.
            let referenceImageDataUrl: string | undefined;
            let referenceImageUrl: string | undefined;
            if (a.referenceImageId) {
              if (videoStashRef.current.has(a.referenceImageId)) {
                addToolResult({
                  tool: "generateVideo",
                  toolCallId: tcId,
                  output: {
                    ok: false,
                    error:
                      "referenceImageId points at a VIDEO asset — frame one must be an image. Pick an image id or drop the reference.",
                  },
                });
                return;
              }
              const ref = imageStashRef.current.get(a.referenceImageId);
              if (!ref) {
                addToolResult({
                  tool: "generateVideo",
                  toolCallId: tcId,
                  output: {
                    ok: false,
                    error:
                      "referenceImageId not found in the library — nothing was generated. Tell the user which id was ignored.",
                  },
                });
                return;
              }
              if (ref.startsWith("data:")) referenceImageDataUrl = ref;
              else referenceImageUrl = ref;
            }

            setJob("Starting…");
            const durationSec = a.durationSec ?? 8;
            const started = await startVideoFn({
              data: {
                workspaceId: ws,
                providerId: provider.id,
                prompt: a.prompt,
                aspectRatio: a.aspectRatio ?? "9:16",
                durationSec,
                referenceImageDataUrl,
                referenceImageUrl,
              },
            });

            // Sleep-first 8s cadence with a 6-minute deadline — Veo never
            // finishes faster, and the done-poll is the expensive one (it
            // downloads + persists server-side), so exactly one is expected.
            const deadline = Date.now() + 6 * 60 * 1000;
            let done: { signedUrl: string; mimeType: string; sizeBytes: number } | null = null;
            setJob("Rendering…", 0);
            for (;;) {
              if (Date.now() > deadline) {
                addToolResult({
                  tool: "generateVideo",
                  toolCallId: tcId,
                  output: {
                    ok: false,
                    error:
                      "Timed out after 6 minutes. The render may still complete on Google's side, but nothing was saved — tell the user to try again.",
                  },
                });
                return;
              }
              await new Promise((r) => setTimeout(r, 8000));
              const res = await pollVideoFn({
                data: {
                  workspaceId: ws,
                  providerId: provider.id,
                  operationName: started.operationName,
                },
              });
              if (res.status === "pending") {
                setJob("Rendering…", res.progress);
                continue;
              }
              if (res.status === "error") {
                addToolResult({
                  tool: "generateVideo",
                  toolCallId: tcId,
                  output: { ok: false, error: res.message },
                });
                return;
              }
              done = res;
              break;
            }

            setJob("Saving to library…", 100);
            // Poster is best-effort — an empty poster must never lose the video.
            const poster = await capturePosterFromUrl(done.signedUrl);
            const videoId = crypto.randomUUID();
            await brandStore.addImage({
              id: videoId,
              dataUrl: poster.posterDataUrl,
              name: `Generated video · ${a.prompt.slice(0, 48)}`,
              // Pending like every other generated asset: approval is a human call.
              approved: false,
              addedAt: Date.now(),
              kind: "video",
              videoUrl: done.signedUrl,
              durationSec: poster.durationSec || durationSec,
              mimeType: done.mimeType,
              sizeBytes: done.sizeBytes,
            });
            videoStashRef.current.set(videoId, done.signedUrl);
            if (poster.posterDataUrl) imageStashRef.current.set(videoId, poster.posterDataUrl);

            addToolResult({
              tool: "generateVideo",
              toolCallId: tcId,
              output: {
                ok: true,
                videoId,
                durationSec: poster.durationSec || durationSec,
                aspectRatio: a.aspectRatio ?? "9:16",
                sizeBytes: done.sizeBytes,
                savedToLibrary: true,
                note: "Saved to the library as PENDING approval. Attach it to a post by passing this videoId as imageId in bufferSchedulePost — it publishes as native video.",
              },
            });
          } catch (err) {
            addToolResult({
              tool: "generateVideo",
              toolCallId: tcId,
              output: { ok: false, error: err instanceof Error ? err.message : "video_failed" },
            });
          } finally {
            setVideoJobs((j) => {
              const n = { ...j };
              delete n[tcId];
              return n;
            });
          }
          return;
        }
        if (toolCall.toolName === "showLibrary") {
          const a = toolCall.input as ShowLibraryArgs;
          const list = libraryRef.current
            .filter((i) => (a.onlyApproved ? i.approved : true))
            .slice()
            .sort((x, y) => (y.approved ? 1 : 0) - (x.approved ? 1 : 0) || y.addedAt - x.addedAt)
            .slice(0, 40)
            .map((i) => ({ id: i.id, name: i.name, approved: i.approved, analysis: i.analysis }));
          addToolResult({
            tool: "showLibrary",
            toolCallId: toolCall.toolCallId,
            output: { ok: true, count: list.length, items: list },
          });
          return;
        }
        if (toolCall.toolName === "schedulePost") {
          const a = toolCall.input as ScheduleArgs;
          const ts = a.scheduledAt ? Date.parse(a.scheduledAt) : NaN;
          const scheduledAt = Number.isFinite(ts) ? ts : null;
          const imageDataUrl = a.imageId ? imageStashRef.current.get(a.imageId) : undefined;
          const videoUrl = a.imageId ? videoStashRef.current.get(a.imageId) : undefined;
          // Deliberately NO approval gate here: the approval queue exists for
          // AUTONOMOUS output (cron-created posts). A post the user asks for in
          // chat is human-directed — the instruction is the red button — so a
          // second sign-off in /approvals would be redundant friction.
          const res = await scheduleStore.add({
            post: {
              platform: a.platform,
              caption: a.caption,
              alternativeHooks: [],
              shortVersion: a.caption,
              longVersion: a.caption,
              hashtags: a.hashtags ?? [],
              visualConcept: a.visualConcept ?? "",
              cta: a.cta ?? "",
              angle: "chat",
            },
            imageDataUrl,
            videoUrl,
            scheduledAt,
            status: scheduledAt ? "scheduled" : "draft",
            note: a.note,
          });
          if (!res.ok) {
            addToolResult({
              tool: "schedulePost",
              toolCallId: toolCall.toolCallId,
              output: {
                ok: false,
                error: `Could not save the post: ${res.error ?? "db_error"}. Nothing was scheduled — tell the user.`,
              },
            });
            return;
          }
          toast.success(scheduledAt ? "Scheduled" : "Saved as draft");
          addToolResult({
            tool: "schedulePost",
            toolCallId: toolCall.toolCallId,
            output: {
              ok: true,
              id: res.post.id,
              scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
              platform: a.platform,
              hasImage: !!imageDataUrl,
              hasVideo: !!videoUrl,
            },
          });
          return;
        }
        if (toolCall.toolName === "reschedulePost") {
          const a = toolCall.input as RescheduleArgs;
          const ts = a.scheduledAt ? Date.parse(a.scheduledAt) : NaN;
          const newAt = Number.isFinite(ts) ? ts : null;
          const exists = itemsRef.current.find((i) => i.id === a.id);
          if (!exists) {
            addToolResult({
              tool: "reschedulePost",
              toolCallId: toolCall.toolCallId,
              output: { ok: false, error: "not_found" },
            });
            return;
          }
          const moved = await scheduleStore.reschedule(a.id, newAt);
          if (!moved.ok) {
            addToolResult({
              tool: "reschedulePost",
              toolCallId: toolCall.toolCallId,
              output: {
                ok: false,
                error: `Could not reschedule: ${moved.error ?? "db_error"}. The post keeps its previous date.`,
              },
            });
            return;
          }
          toast.success(newAt ? "Rescheduled" : "Moved to drafts");
          if (moved.bufferTimeUnchanged) {
            toast.warning("Calendar only — the live channel post keeps its original time.");
          }
          addToolResult({
            tool: "reschedulePost",
            toolCallId: toolCall.toolCallId,
            output: {
              ok: true,
              id: a.id,
              scheduledAt: newAt ? new Date(newAt).toISOString() : null,
              platform: exists.post.platform,
              // Nothing in this app can move a post Buffer already holds, so a
              // live post's queued time is unchanged. Say so — reporting a
              // clean reschedule would be a lie (docs/bugs.md finding 6).
              channelTimeUnchanged: moved.bufferTimeUnchanged,
              ...(moved.bufferTimeUnchanged
                ? {
                    note: "This post is live on a channel. Only the internal calendar entry moved — the post already queued on the channel will still go out at its ORIGINAL time. Tell the user this plainly. To really move it, delete the post (which removes it from the channel) and publish it again at the new time.",
                  }
                : {}),
            },
          });
          return;
        }
        if (toolCall.toolName === "deletePost") {
          const a = toolCall.input as DeleteArgs;
          const exists = itemsRef.current.find((i) => i.id === a.id);
          if (!exists) {
            addToolResult({
              tool: "deletePost",
              toolCallId: toolCall.toolCallId,
              output: { ok: false, error: "not_found" },
            });
            return;
          }
          // A post with a bufferId is live on a channel. Take it down there
          // first; the store aborts the row delete if that fails, so the model
          // can never report a delete that left the post going out anyway
          // (docs/bugs.md finding 6).
          const ws = wsRef.current;
          const removed = await scheduleStore.remove(a.id, {
            removeFromBuffer: async ({ bufferId }) => {
              if (!ws) throw new Error("no active workspace — cannot reach the channel");
              await bufferDelete({ data: { workspaceId: ws, id: bufferId } });
            },
          });
          if (!removed.ok) {
            addToolResult({
              tool: "deletePost",
              toolCallId: toolCall.toolCallId,
              output: {
                ok: false,
                error: exists.bufferId
                  ? `Could not delete: ${removed.error ?? "db_error"}. The post is still on the calendar AND still live on its channel — nothing was removed. Tell the user it will still go out.`
                  : `Could not delete: ${removed.error ?? "db_error"}. The post is still on the calendar.`,
                wasLive: Boolean(exists.bufferId),
              },
            });
            return;
          }
          toast.success(removed.bufferRemoved ? "Deleted and unpublished" : "Deleted");
          addToolResult({
            tool: "deletePost",
            toolCallId: toolCall.toolCallId,
            output: {
              ok: true,
              id: a.id,
              platform: exists.post.platform,
              caption: exists.post.caption.slice(0, 80),
              wasLive: Boolean(exists.bufferId),
              removedFromChannel: removed.bufferRemoved,
              note: removed.bufferRemoved
                ? "The post was live: it was removed from the channel queue first and then deleted from the calendar. It will not go out."
                : "The post was a draft/queued calendar entry only — nothing was live on a channel, so nothing was unpublished.",
            },
          });
          return;
        }
        if (toolCall.toolName === "listScheduled") {
          const a = toolCall.input as ListArgs;
          const from = a.fromISO ? Date.parse(a.fromISO) : -Infinity;
          const to = a.toISO ? Date.parse(a.toISO) : Infinity;
          // Drafts (no date) are included and every item carries its status, so
          // pending_approval / rejected posts are never presented as live.
          const list = itemsRef.current
            .filter((i) => i.scheduledAt === null || (i.scheduledAt >= from && i.scheduledAt <= to))
            .sort((a, b) => (a.scheduledAt ?? Infinity) - (b.scheduledAt ?? Infinity))
            .map((i) => ({
              id: i.id,
              platform: i.post.platform,
              scheduledAt: i.scheduledAt ? new Date(i.scheduledAt).toISOString() : null,
              status: i.status,
              caption: i.post.caption.slice(0, 100),
              // bufferId used to be stripped here, which left the model unable
              // to tell a post that is really queued on a channel from a
              // calendar-only draft (docs/bugs.md finding 6).
              bufferId: i.bufferId ?? null,
              live: Boolean(i.bufferId),
            }));
          addToolResult({
            tool: "listScheduled",
            toolCallId: toolCall.toolCallId,
            output: {
              ok: true,
              items: list,
              note: "status meanings: scheduled/published = live calendar; pending_approval = waiting in /approvals, NOT live; rejected = will not go out; scheduledAt null = draft. Report the status, never present pending or rejected posts as live. live=true (bufferId set) means the post is really queued on a social channel: deleting it with deletePost also removes it from that channel, and reschedulePost moves the calendar entry only — the channel keeps the original time.",
            },
          });
          return;
        }
        if (toolCall.toolName === "bufferSchedulePost") {
          const a = toolCall.input as BufferScheduleArgs;
          const conn = bufferRef.current;
          const ws = wsRef.current;
          if (!ws) {
            addToolResult({
              tool: "bufferSchedulePost",
              toolCallId: toolCall.toolCallId,
              output: { ok: false, error: "no_workspace" },
            });
            return;
          }
          // Deliberately NO approval gate here: the approval queue is for
          // AUTONOMOUS output (cron-created posts). A Buffer publish the user
          // asks for in chat is human-directed — that instruction is the red
          // button — so it goes out as requested.
          if (!conn?.connected) {
            addToolResult({
              tool: "bufferSchedulePost",
              toolCallId: toolCall.toolCallId,
              output: { ok: false, error: "buffer_not_connected" },
            });
            return;
          }
          const wantedIds =
            a.channelIds && a.channelIds.length ? a.channelIds : a.channelId ? [a.channelId] : [];
          if (wantedIds.length === 0) {
            addToolResult({
              tool: "bufferSchedulePost",
              toolCallId: toolCall.toolCallId,
              output: {
                ok: false,
                error: "no_channel",
                available: conn.channels.map((c) => ({
                  id: c.id,
                  service: c.service,
                  name: c.name,
                })),
              },
            });
            return;
          }
          const matched = conn.channels.filter((c) => wantedIds.includes(c.id));
          if (matched.length === 0) {
            addToolResult({
              tool: "bufferSchedulePost",
              toolCallId: toolCall.toolCallId,
              output: {
                ok: false,
                error: "channel_not_found",
                available: conn.channels.map((c) => ({
                  id: c.id,
                  service: c.service,
                  name: c.name,
                })),
              },
            });
            return;
          }
          // Carousel path: assemble the slides into a LinkedIn document BEFORE
          // anything reaches Buffer. A carousel replaces image/video entirely.
          const carouselIds = (a.carouselImageIds ?? []).filter(Boolean);
          let documentUrl: string | undefined;
          let documentTitle: string | undefined;
          let documentThumbnailUrl: string | undefined;
          if (carouselIds.length > 0) {
            if (carouselIds.length < 2 || carouselIds.length > 10) {
              addToolResult({
                tool: "bufferSchedulePost",
                toolCallId: toolCall.toolCallId,
                output: {
                  ok: false,
                  error: `A carousel needs 2-10 slides; got ${carouselIds.length}.`,
                },
              });
              return;
            }
            if (!matched.some((c) => c.service.toLowerCase() === "linkedin")) {
              addToolResult({
                tool: "bufferSchedulePost",
                toolCallId: toolCall.toolCallId,
                output: {
                  ok: false,
                  error: "Carousels are LinkedIn-only and no LinkedIn channel is selected.",
                  available: conn.channels.map((c) => ({
                    id: c.id,
                    service: c.service,
                    name: c.name,
                  })),
                },
              });
              return;
            }
            // Reading order is meaning: resolve in the exact order given.
            const slides: string[] = [];
            const missing: string[] = [];
            for (const id of carouselIds) {
              const d = imageStashRef.current.get(id);
              if (d && d.startsWith("data:") && !videoStashRef.current.has(id)) slides.push(d);
              else missing.push(id);
            }
            if (missing.length) {
              addToolResult({
                tool: "bufferSchedulePost",
                toolCallId: toolCall.toolCallId,
                output: {
                  ok: false,
                  error: `These carousel ids are not usable images: ${missing.join(", ")}. Nothing was published.`,
                },
              });
              return;
            }
            documentTitle = a.carouselTitle?.trim() || a.text.slice(0, 60) || "Carousel";
            try {
              const pdf = await assembleCarouselFn({
                data: { workspaceId: ws, images: slides, title: documentTitle },
              });
              documentUrl = pdf.url;
              documentThumbnailUrl = pdf.thumbnailUrl;
            } catch (err) {
              addToolResult({
                tool: "bufferSchedulePost",
                toolCallId: toolCall.toolCallId,
                output: {
                  ok: false,
                  error: `Could not assemble the carousel PDF: ${err instanceof Error ? err.message : "unknown"}. Nothing was published.`,
                },
              });
              return;
            }
          }
          const imageDataUrl = documentUrl
            ? undefined
            : a.imageId
              ? imageStashRef.current.get(a.imageId)
              : undefined;
          const videoUrl = documentUrl
            ? undefined
            : a.imageId
              ? videoStashRef.current.get(a.imageId)
              : undefined;
          const firstComment = a.firstComment?.trim();
          const perChannel: Record<
            string,
            {
              instagramType?: "post" | "reel" | "story";
              shouldShareToFeed?: boolean;
              firstComment?: string;
            }
          > = {};
          for (const c of matched) {
            const svc = c.service.toLowerCase();
            if (svc === "instagram") {
              const type = a.instagramType ?? "post";
              perChannel[c.id] = {
                instagramType: type,
                ...(type === "reel" ? { shouldShareToFeed: a.shouldShareToFeed ?? true } : {}),
                ...(type !== "story" && firstComment ? { firstComment } : {}),
              };
            } else if ((svc === "linkedin" || svc === "facebook") && firstComment) {
              perChannel[c.id] = { firstComment };
            }
          }
          // publishNow and a due date are mutually exclusive; the server rejects
          // the combination, so never send both.
          const publishNow = a.publishNow === true;
          const res = await bufferCreate({
            data: {
              workspaceId: ws,
              channelIds: matched.map((c) => c.id),
              text: a.text,
              scheduledAtISO: publishNow ? undefined : a.scheduledAtISO || undefined,
              ...(publishNow ? { publishNow: true } : {}),
              imageDataUrl,
              videoUrl,
              ...(documentUrl ? { documentUrl, documentTitle, documentThumbnailUrl } : {}),
              ...(Object.keys(perChannel).length ? { perChannel } : {}),
            },
          });
          // An immediate publish is "now" on the mirrored calendar entry; a
          // queue slot has no known time until Buffer reports one back.
          const ts = publishNow
            ? Date.now()
            : a.scheduledAtISO
              ? Date.parse(a.scheduledAtISO)
              : NaN;
          const scheduledAt = Number.isFinite(ts) ? ts : null;
          let mirrorFailures = 0;
          for (const r of res.results) {
            if (!r.ok) continue;
            const ch = matched.find((c) => c.id === r.channelId)!;
            const platform: Platform = a.platform ?? (ch.service as Platform) ?? "linkedin";
            const mirror = await scheduleStore.add({
              post: {
                platform,
                caption: a.text,
                alternativeHooks: [],
                shortVersion: a.text,
                longVersion: a.text,
                hashtags: [],
                visualConcept: "",
                cta: "",
                angle: documentUrl ? "chat-buffer-carousel" : "chat-buffer",
              },
              // A carousel's Buffer post carries only the document; the internal
              // mirror gets the hook slide so the calendar stays visual.
              imageDataUrl: documentUrl ? imageStashRef.current.get(carouselIds[0]) : imageDataUrl,
              videoUrl,
              scheduledAt,
              status: scheduledAt ? "scheduled" : "draft",
              bufferId: r.postId,
              bufferChannelId: ch.id,
            });
            if (!mirror.ok) mirrorFailures++;
          }
          const okCount = res.results.filter((r) => r.ok).length;
          const failCount = res.results.length - okCount;
          const mediaNote = documentUrl
            ? " · carousel attached"
            : videoUrl
              ? " · video attached"
              : imageDataUrl
                ? " · image attached"
                : "";
          const verb = publishNow ? "Publishing now on" : "Queued on";
          toast.success(
            `${verb} ${okCount} channel${okCount === 1 ? "" : "s"}${failCount ? ` · ${failCount} failed` : ""}${mediaNote}`,
          );
          addToolResult({
            tool: "bufferSchedulePost",
            toolCallId: toolCall.toolCallId,
            output: {
              ok: okCount > 0,
              results: res.results,
              channels: matched.map((c) => ({ id: c.id, service: c.service, name: c.name })),
              hasImage: !!imageDataUrl,
              hasVideo: !!videoUrl,
              hasCarousel: !!documentUrl,
              ...(documentUrl ? { carouselPages: carouselIds.length, documentTitle } : {}),
              ...(mirrorFailures
                ? {
                    calendarMirrorFailures: mirrorFailures,
                    note: "The Buffer post(s) went out but the internal calendar mirror could not be saved for some — the calendar may be missing entries.",
                  }
                : {}),
            },
          });
          return;
        }
        if (toolCall.toolName === "bufferDeletePost") {
          const a = toolCall.input as { bufferId: string };
          const ws = wsRef.current;
          if (!ws) {
            addToolResult({
              tool: "bufferDeletePost",
              toolCallId: toolCall.toolCallId,
              output: { ok: false, error: "no_workspace" },
            });
            return;
          }
          await bufferDelete({ data: { workspaceId: ws, id: a.bufferId } });
          // Also remove the mirrored internal calendar row — leaving it made
          // the calendar show a post that no longer exists on Buffer.
          const mirrored = itemsRef.current.find((i) => i.bufferId === a.bufferId);
          let mirrorRemoved: boolean | null = null;
          // The upstream delete already happened above, so tell the store not
          // to try it again — otherwise it refuses to drop a row that still
          // carries a bufferId.
          if (mirrored)
            mirrorRemoved = (
              await scheduleStore.remove(mirrored.id, { alreadyRemovedFromBuffer: true })
            ).ok;
          toast.success("Post deleted");
          addToolResult({
            tool: "bufferDeletePost",
            toolCallId: toolCall.toolCallId,
            output: {
              ok: true,
              bufferId: a.bufferId,
              calendarMirrorRemoved: mirrorRemoved === true,
              note: mirrored
                ? mirrorRemoved
                  ? "Deleted from the channel queue and removed from the internal calendar."
                  : "Deleted from the channel queue, but the internal calendar mirror could not be removed — it may still show on /calendario."
                : "Deleted from the channel queue. No mirrored internal calendar entry was found.",
            },
          });
          return;
        }
        if (toolCall.toolName === "analyzeCompetitor") {
          const a = toolCall.input as {
            competitorId?: string;
            name?: string;
            website?: string;
            linkedin?: string;
            instagram?: string;
            tiktok?: string;
            x?: string;
          };
          const existingId = a.competitorId?.trim();
          if (!existingId && !a.name?.trim()) {
            addToolResult({
              tool: "analyzeCompetitor",
              toolCallId: toolCall.toolCallId,
              output: { ok: false, error: "missing_name" },
            });
            return;
          }
          const handles = {
            linkedin: a.linkedin?.trim() || undefined,
            instagram: a.instagram?.trim().replace(/^@/, "") || undefined,
            tiktok: a.tiktok?.trim().replace(/^@/, "") || undefined,
            x: a.x?.trim().replace(/^@/, "") || undefined,
          };
          if (!existingId && !Object.values(handles).some(Boolean)) {
            addToolResult({
              tool: "analyzeCompetitor",
              toolCallId: toolCall.toolCallId,
              output: {
                ok: false,
                error: "no_handles",
                hint: "Provide at least one handle: linkedin, instagram, tiktok, or x.",
              },
            });
            return;
          }
          toast.info(`Analyzing ${a.name || "competitor"}…`);
          let created: { id: string };
          if (existingId) {
            if (Object.values(handles).some(Boolean)) {
              competitorsStore.update(existingId, { handles });
            }
            created = { id: existingId };
          } else {
            created = await competitorsStore.add({
              name: (a.name ?? "").trim(),
              website: a.website?.trim() || undefined,
              socials: {},
              handles,
            });
          }
          try {
            const snap = await analyzeCompetitorFn({
              data: { competitorId: created.id, ourBrandContext: brandContextSummary() },
            });
            competitorsStore.update(created.id, { snapshot: snap });
            toast.success(`${a.name} analyzed and saved.`);
            addToolResult({
              tool: "analyzeCompetitor",
              toolCallId: toolCall.toolCallId,
              output: {
                ok: true,
                competitorId: created.id,
                name: a.name,
                subtitle: snap.subtitle,
                dek: snap.dek,
                positioning: snap.positioning,
                contentStrategy: snap.contentStrategy,
                strengthsDetailed: snap.strengthsDetailed?.slice(0, 3),
                vulnerabilities: snap.vulnerabilities?.slice(0, 3),
                keyTakeaways: snap.keyTakeaways?.slice(0, 4),
                networks: snap.networks,
              },
            });
          } catch (err) {
            addToolResult({
              tool: "analyzeCompetitor",
              toolCallId: toolCall.toolCallId,
              output: { ok: false, error: err instanceof Error ? err.message : "scan_failed" },
            });
          }
          return;
        }
      } catch (e) {
        addToolResult({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          output: { ok: false, error: e instanceof Error ? e.message : "error" },
        });
      }
    },
    // The activity log recorded only the user's side of the conversation, so
    // /logs showed questions with no answers. Log the agent's reply too, with
    // the tools it used — that is the part worth auditing later.
    onFinish({ message, isAbort, isError, isDisconnect }) {
      const ws = wsRef.current;
      if (!ws || message.role !== "assistant") return;
      // A cancelled or failed turn is not a reply; logging it as one would make
      // the activity log lie about what the agent actually said.
      if (isAbort || isError || isDisconnect) return;
      const text = message.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join(" ")
        .trim();
      const tools = [
        ...new Set(
          message.parts
            .map((p) => (p.type.startsWith("tool-") ? p.type.slice("tool-".length) : null))
            .filter((t): t is string => !!t),
        ),
      ];
      if (!text && tools.length === 0) return;
      logActivityFn({
        workspaceId: ws,
        actorType: "agent",
        action: "chat.reply.sent",
        summary: text
          ? `Agent: "${text.slice(0, 120)}"${tools.length ? ` · ${tools.length} tool${tools.length === 1 ? "" : "s"}` : ""}`
          : `Agent ran ${tools.join(", ")}`,
        details: { tools, chars: text.length },
      });
    },
  });

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Whether the transcript should keep pinning to the newest message. True
  // while the reader is at (or near) the bottom; a manual scroll away from
  // the bottom disengages it so a streaming reply doesn't yank them back
  // down. Scrolling back to the bottom re-engages it. A ref (not state)
  // because the scroll handler must not trigger a re-render on every event.
  const pinnedToBottomRef = useRef(true);
  const NEAR_BOTTOM_PX = 80;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      pinnedToBottomRef.current = distanceFromBottom <= NEAR_BOTTOM_PX;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinnedToBottomRef.current) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, [messages, status]);
  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const MAX_IMAGE = 10 * 1024 * 1024;
  const MAX_PDF = 20 * 1024 * 1024;
  const acceptFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const next: File[] = [];
    for (const f of Array.from(files)) {
      const isImage = f.type.startsWith("image/");
      const isPdf = f.type === "application/pdf";
      if (!isImage && !isPdf) {
        toast.error(`${f.name}: unsupported type`);
        continue;
      }
      if (isImage && f.size > MAX_IMAGE) {
        toast.error(`${f.name}: image over 10 MB`);
        continue;
      }
      if (isPdf && f.size > MAX_PDF) {
        toast.error(`${f.name}: PDF over 20 MB`);
        continue;
      }
      next.push(f);
    }
    if (next.length) setAttachments((cur) => [...cur, ...next].slice(0, 6));
  };

  // Server-executed tools can mutate brand data (updateBrandProfile /
  // updateBrandGuide) without touching the client cache, which hydrates once
  // per session — so /marca and the context chips kept showing stale data
  // after the agent said "done". Refresh the store when those results land.
  const refreshedBrandCalls = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const m of messages) {
      for (const part of m.parts ?? []) {
        const p = part as { type: string; state?: string; toolCallId?: string };
        if (
          (p.type === "tool-updateBrandProfile" || p.type === "tool-updateBrandGuide") &&
          p.state === "output-available" &&
          p.toolCallId &&
          !refreshedBrandCalls.current.has(p.toolCallId)
        ) {
          refreshedBrandCalls.current.add(p.toolCallId);
          void brandStore.refresh();
        }
      }
    }
  }, [messages]);

  const send = async () => {
    const v = input.trim();
    if ((!v && attachments.length === 0) || status === "submitted" || status === "streaming")
      return;
    const fileParts = await Promise.all(
      attachments.map(
        (f) =>
          new Promise<{ type: "file"; mediaType: string; url: string; filename: string }>(
            (resolve, reject) => {
              const r = new FileReader();
              r.onload = () =>
                resolve({
                  type: "file",
                  mediaType: f.type || "application/octet-stream",
                  url: r.result as string,
                  filename: f.name,
                });
              r.onerror = () => reject(r.error ?? new Error("read_failed"));
              r.readAsDataURL(f);
            },
          ),
      ),
    );
    // The user just took a deliberate action, so pin the transcript back to
    // the bottom even if they had scrolled up to read earlier messages.
    pinnedToBottomRef.current = true;
    sendMessage({
      text: v || "(see attachments)",
      files: fileParts.length ? fileParts : undefined,
    });
    if (activeWorkspaceId) {
      logActivityFn({
        workspaceId: activeWorkspaceId,
        actorType: "user",
        action: "chat.message.sent",
        summary: `Chat: "${v.slice(0, 120)}"${attachments.length ? ` · ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}` : ""}`,
      });
    }
    setInput("");
    setAttachments([]);
    setTimeout(() => taRef.current?.focus(), 0);
  };

  const copyToClipboard = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 flex flex-col h-[calc(100vh-3rem)]">
      <div className="pb-4 border-b border-border">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Chat</p>
        <h1 className="mt-1 font-serif text-3xl">Social agent</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Schedule, reschedule, or delete posts in natural language. E.g.{" "}
          <span className="italic">"move the LinkedIn one to Friday at 10am"</span>.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-muted-foreground uppercase tracking-wider mr-1">Context:</span>
          <span
            className={`rounded-full border px-2 py-0.5 ${meta.hasProfile ? "border-accent/40 bg-accent/10 text-foreground" : "border-border text-muted-foreground"}`}
          >
            Brand {meta.hasProfile ? "✓" : "—"}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 ${meta.hasGuideline ? "border-accent/40 bg-accent/10 text-foreground" : "border-border text-muted-foreground"}`}
          >
            Guide {meta.hasGuideline ? "✓" : "—"}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 ${meta.approvedImages ? "border-accent/40 bg-accent/10 text-foreground" : "border-border text-muted-foreground"}`}
          >
            {meta.approvedImages} visual ref{meta.approvedImages === 1 ? "" : "s"}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 inline-flex items-center gap-1 ${buffer?.connected ? "border-foreground text-foreground" : "border-border text-muted-foreground"}`}
          >
            <Share2 className="h-3 w-3" /> Channels{" "}
            {buffer?.connected ? `✓ ${buffer.channels.length}` : "—"}
          </span>
          <span className="text-muted-foreground">
            · {meta.chars.toLocaleString("en-US")} chars
          </span>
          {!meta.hasProfile && !meta.hasGuideline && (
            <Link
              to="/marca"
              className="ml-1 underline underline-offset-4 text-muted-foreground hover:text-foreground"
            >
              Configure brand
            </Link>
          )}
          {buffer && !buffer.connected && (
            <Link
              to="/conexiones"
              className="ml-1 underline underline-offset-4 text-muted-foreground hover:text-foreground"
            >
              Link channels
            </Link>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-6 space-y-6">
        {messages.length === 0 && (
          <div className="text-muted-foreground space-y-3">
            <div className="grid sm:grid-cols-2 gap-2">
              {[
                "Create an Instagram post and schedule it for tomorrow at 10am",
                "What's trending this week in our industry?",
                "Move the LinkedIn one to Thursday afternoon",
                "Search the web for latest news on OpenAI",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    pinnedToBottomRef.current = true;
                    sendMessage({ text: s });
                  }}
                  className="rounded-lg border border-border p-3 text-sm text-left hover:bg-muted transition"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => {
          const isUser = m.role === "user";
          return (
            <div key={m.id} className={isUser ? "flex justify-end" : "space-y-3"}>
              {isUser ? (
                <div className="max-w-[80%] space-y-2">
                  {m.parts.some((p) => p.type === "file") && (
                    <div className="flex flex-wrap gap-2 justify-end">
                      {m.parts.map((p, i) => {
                        if (p.type !== "file") return null;
                        const fp = p as {
                          type: "file";
                          mediaType?: string;
                          url: string;
                          filename?: string;
                        };
                        const isImg = fp.mediaType?.startsWith("image/");
                        return isImg ? (
                          <img
                            key={i}
                            src={fp.url}
                            alt={fp.filename ?? "attachment"}
                            className="rounded-lg max-h-48 border border-border"
                          />
                        ) : (
                          <div
                            key={i}
                            className="rounded-lg border border-border bg-muted px-3 py-2 text-xs flex items-center gap-2"
                          >
                            <FileText className="h-3.5 w-3.5" /> {fp.filename ?? "file"}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {m.parts.some((p) => p.type === "text") && (
                    <div className="rounded-2xl bg-foreground text-background px-4 py-2.5 whitespace-pre-wrap ml-auto w-fit">
                      {m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {m.parts.map((p, i) => {
                    if (p.type === "text") {
                      const copyId = `${m.id}-${i}`;
                      return (
                        <div key={i} className="group relative">
                          <div className="prose prose-sm max-w-none text-foreground prose-headings:font-serif prose-headings:text-foreground prose-strong:text-foreground">
                            <ReactMarkdown>{p.text}</ReactMarkdown>
                          </div>
                          <button
                            type="button"
                            aria-label="Copy message"
                            onClick={() => copyToClipboard(copyId, p.text)}
                            className="absolute -top-1 right-0 opacity-0 group-hover:opacity-100 transition rounded-md border border-border bg-background/95 p-1.5 text-muted-foreground hover:text-foreground"
                          >
                            {copiedId === copyId ? (
                              <Check className="h-3 w-3" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      );
                    }
                    if (p.type === "tool-webSearch") {
                      const input = p.input as { query?: string; recency?: string } | undefined;
                      const out = p.output as
                        | {
                            ok?: boolean;
                            results?: Array<{
                              title: string;
                              url: string;
                              snippet: string;
                              date?: string;
                            }>;
                            error?: string;
                          }
                        | undefined;
                      const done = p.state === "output-available";
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-border bg-muted/40 p-4 space-y-2"
                        >
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Search className="h-4 w-4" />
                            {done
                              ? out?.ok
                                ? `Sources · ${out.results?.length ?? 0}${input?.query ? ` · "${input.query}"` : ""}`
                                : `Search failed: ${out?.error ?? "unknown"}`
                              : `Searching the web${input?.query ? ` for "${input.query}"` : ""}…`}
                          </div>
                          {done && out?.ok && out.results && out.results.length > 0 && (
                            <ul className="space-y-2">
                              {out.results.map((r, k) => {
                                const safeUrl = safeHttpUrl(r.url);
                                return (
                                  <li key={k} className="text-sm">
                                    {safeUrl ? (
                                      <a
                                        href={safeUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 font-medium text-foreground hover:underline underline-offset-4"
                                      >
                                        {r.title} <ExternalLink className="h-3 w-3 opacity-60" />
                                      </a>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 font-medium text-foreground">
                                        {r.title}
                                      </span>
                                    )}
                                    <div className="text-[11px] text-muted-foreground truncate">
                                      {/* safeUrl is already proven parseable, so this cannot
                                          throw. Parsing r.url directly would: search results
                                          are third-party data, and new URL() throws on
                                          anything without a scheme, which would take the whole
                                          chat transcript down mid-render. */}
                                      {safeUrl ? new URL(safeUrl).hostname : r.url}
                                      {r.date
                                        ? ` · ${new Date(r.date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" })}`
                                        : ""}
                                    </div>
                                    {r.snippet && (
                                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                                        {r.snippet}
                                      </p>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      );
                    }
                    if (p.type === "tool-showLibrary") {
                      const out = p.output as
                        | {
                            ok?: boolean;
                            count?: number;
                            items?: Array<{
                              id: string;
                              name: string;
                              approved: boolean;
                              analysis?: string;
                            }>;
                          }
                        | undefined;
                      const done = p.state === "output-available";
                      return (
                        <LibraryPicker
                          key={i}
                          done={done}
                          items={out?.items ?? []}
                          count={out?.count ?? 0}
                          resolveSrc={(id) => imageStashRef.current.get(id)}
                          onInsert={(ids) => {
                            const ref = ids.map((x) => `\`${x}\``).join(", ");
                            setInput(
                              (cur) =>
                                (cur ? cur + " " : "") +
                                `Use image${ids.length > 1 ? "s" : ""} ${ref} and create a variation.`,
                            );
                            taRef.current?.focus();
                          }}
                        />
                      );
                    }
                    if (p.type === "tool-generateVideo") {
                      const out = p.output as
                        | {
                            ok?: boolean;
                            videoId?: string;
                            durationSec?: number;
                            error?: string;
                            note?: string;
                          }
                        | undefined;
                      const done = p.state === "output-available";
                      const job = videoJobs[p.toolCallId];
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-border bg-muted/40 p-4 space-y-2"
                        >
                          <div className="flex items-center gap-2 text-sm font-medium">
                            {done ? (
                              <ImageIcon className="h-4 w-4" />
                            ) : (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            )}
                            {!done
                              ? `${job?.label ?? "Rendering video…"}${typeof job?.progress === "number" ? ` ${job.progress}%` : ""} · usually 1–3 minutes`
                              : out?.ok
                                ? `Video ready · ${out.durationSec ?? "?"}s · saved to the library (pending approval)`
                                : `Video failed: ${out?.error ?? "unknown"}`}
                          </div>
                          {done && out?.ok && out.videoId && (
                            <>
                              {videoStashRef.current.get(out.videoId) && (
                                <video
                                  src={videoStashRef.current.get(out.videoId)}
                                  poster={imageStashRef.current.get(out.videoId)}
                                  controls
                                  playsInline
                                  preload="metadata"
                                  className="max-h-80 w-auto max-w-full rounded-md bg-black"
                                />
                              )}
                              <p className="font-mono text-[10px] text-muted-foreground">
                                id: {out.videoId}
                              </p>
                            </>
                          )}
                        </div>
                      );
                    }
                    if (p.type === "tool-generateImage") {
                      const input = p.input as GenImageArgs | undefined;
                      const out = p.output as
                        { ok?: boolean; imageId?: string; error?: string } | undefined;
                      const frame = out?.imageId ? imageFrames[out.imageId] : undefined;
                      const done = p.state === "output-available";
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-border bg-muted/40 p-4 space-y-2"
                        >
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <ImageIcon className="h-4 w-4" />
                            {done
                              ? out?.ok
                                ? "Image ready"
                                : `Image failed: ${out?.error ?? "unknown"}`
                              : "Generating image…"}
                          </div>
                          {input?.prompt && (
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {input.prompt}
                            </p>
                          )}
                          {frame?.dataUrl && (
                            <img
                              src={frame.dataUrl}
                              alt={input?.prompt ?? "generated"}
                              className={`rounded-lg w-full max-w-md transition-[filter] ${frame.final ? "blur-0" : "blur-xl"}`}
                            />
                          )}
                        </div>
                      );
                    }
                    if (p.type === "tool-schedulePost" || p.type === "tool-reschedulePost") {
                      const input = p.input as ScheduleArgs | undefined;
                      const out = p.output as
                        | { ok?: boolean; scheduledAt?: string | null; platform?: string }
                        | undefined;
                      const done = p.state === "output-available" && out?.ok;
                      const when = out?.scheduledAt ? new Date(out.scheduledAt) : null;
                      const isResched = p.type === "tool-reschedulePost";
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-border bg-muted/40 p-4 space-y-2"
                        >
                          <div className="flex items-center gap-2 text-sm font-medium">
                            {done ? (
                              <CalendarCheck2 className="h-4 w-4" />
                            ) : (
                              <CalendarClock className="h-4 w-4 animate-pulse" />
                            )}
                            {done
                              ? when
                                ? `${isResched ? "Rescheduled" : "Scheduled"} on ${out?.platform} · ${when.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`
                                : "Saved as draft"
                              : isResched
                                ? "Rescheduling…"
                                : "Scheduling…"}
                          </div>
                          {input?.caption && (
                            <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4">
                              {input.caption}
                            </p>
                          )}
                          {done && (
                            <Link
                              to="/calendario"
                              className="inline-block text-xs underline underline-offset-4"
                            >
                              View in calendar
                            </Link>
                          )}
                        </div>
                      );
                    }
                    if (p.type === "tool-deletePost") {
                      const out = p.output as
                        { ok?: boolean; platform?: string; caption?: string } | undefined;
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-border bg-muted/40 p-3 text-sm flex items-center gap-2"
                        >
                          <CalendarX2 className="h-4 w-4" />
                          {out?.ok ? `Deleted (${out.platform}): "${out.caption}"` : "Deleting…"}
                        </div>
                      );
                    }
                    if (p.type === "tool-listScheduled") {
                      const out = p.output as
                        | {
                            ok?: boolean;
                            items?: Array<{
                              id: string;
                              platform: string;
                              scheduledAt: string | null;
                              status?: string;
                              caption: string;
                            }>;
                          }
                        | undefined;
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-border bg-muted/40 p-4 space-y-2"
                        >
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <ListChecks className="h-4 w-4" /> Calendar
                          </div>
                          {out?.items?.length ? (
                            <ul className="space-y-1.5 text-sm">
                              {out.items.map((it) => (
                                <li key={it.id} className="flex gap-3">
                                  <span className="text-muted-foreground tabular-nums shrink-0">
                                    {it.scheduledAt
                                      ? new Date(it.scheduledAt).toLocaleString("en-US", {
                                          weekday: "short",
                                          day: "2-digit",
                                          month: "short",
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        })
                                      : "draft"}
                                  </span>
                                  <span className="capitalize text-foreground/70 shrink-0">
                                    {it.platform}
                                  </span>
                                  {it.status &&
                                    it.status !== "scheduled" &&
                                    it.status !== "published" && (
                                      <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] text-muted-foreground self-center">
                                        {it.status.replace("_", " ")}
                                      </span>
                                    )}
                                  <span className="truncate">{it.caption}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm text-muted-foreground">No posts in that range.</p>
                          )}
                        </div>
                      );
                    }
                    if (p.type === "tool-bufferSchedulePost") {
                      // Shape must match what the tool handler actually returns
                      // (results + channels, since one call fans out to many
                      // channels). Reading a single-channel shape here is what
                      // rendered "Published to Buffer · undefined · undefined".
                      const out = p.output as
                        | {
                            ok?: boolean;
                            error?: string;
                            hasImage?: boolean;
                            hasVideo?: boolean;
                            results?: Array<{
                              channelId: string;
                              ok: boolean;
                              postId?: string;
                              dueAt?: string;
                              mode?: string;
                              error?: string;
                            }>;
                            channels?: Array<{ id: string; service: string; name: string }>;
                          }
                        | undefined;
                      const done = p.state === "output-available";
                      const results = out?.results ?? [];
                      const nameFor = (channelId: string) => {
                        const ch = out?.channels?.find((c) => c.id === channelId);
                        return ch ? `${ch.name} (${ch.service})` : channelId;
                      };
                      const okResults = results.filter((r) => r.ok);
                      const failed = results.filter((r) => !r.ok);
                      const media = out?.hasVideo ? "video" : out?.hasImage ? "image" : null;
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-foreground bg-foreground/[0.03] p-4 space-y-2"
                        >
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Share2 className="h-4 w-4" />
                            {!done
                              ? "Publishing…"
                              : out?.ok
                                ? `Published · ${okResults.length} channel${okResults.length === 1 ? "" : "s"}${failed.length ? ` · ${failed.length} failed` : ""}${media ? ` · ${media} attached` : ""}`
                                : `Publish error: ${out?.error ?? failed[0]?.error ?? "unknown"}`}
                          </div>
                          {done &&
                            okResults.map((r) => (
                              <p key={r.channelId} className="text-[11px] text-muted-foreground">
                                {nameFor(r.channelId)} ·{" "}
                                {r.mode === "shareNow"
                                  ? "publishing now"
                                  : r.dueAt
                                    ? `${r.mode === "addToQueue" ? "queue slot " : ""}${new Date(r.dueAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`
                                    : "next queue slot"}
                                {r.postId ? <span className="font-mono"> · {r.postId}</span> : null}
                              </p>
                            ))}
                          {done &&
                            failed.map((r) => (
                              <p key={r.channelId} className="text-[11px] text-destructive">
                                {nameFor(r.channelId)} · {r.error ?? "rejected"}
                              </p>
                            ))}
                        </div>
                      );
                    }
                    if (p.type === "tool-bufferDeletePost") {
                      const out = p.output as
                        { ok?: boolean; bufferId?: string; error?: string } | undefined;
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-border bg-muted/40 p-3 text-sm flex items-center gap-2"
                        >
                          <Share2 className="h-4 w-4" />
                          {out?.ok
                            ? "Deleted from the channel queue"
                            : out?.error
                              ? `Error: ${out.error}`
                              : "Deleting…"}
                        </div>
                      );
                    }
                    return null;
                  })}
                </>
              )}
            </div>
          );
        })}

        {(status === "submitted" || status === "streaming") &&
          messages[messages.length - 1]?.role === "user" && (
            <div className="text-muted-foreground text-sm flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
            </div>
          )}
      </div>

      <div
        className={`relative border-t border-border pt-3 pb-2 ${isDragging ? "bg-accent/5" : ""}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setIsDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setIsDragging(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files?.length) return;
          e.preventDefault();
          setIsDragging(false);
          acceptFiles(e.dataTransfer.files);
        }}
      >
        {isDragging && (
          <div className="absolute inset-0 z-10 rounded-lg border-2 border-dashed border-foreground bg-background/90 grid place-items-center pointer-events-none">
            <p className="text-sm font-medium">Drop images or PDFs to attach</p>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-2">
            {attachments.map((f, idx) => {
              const isImage = f.type.startsWith("image/");
              const url = isImage ? URL.createObjectURL(f) : null;
              return (
                <div
                  key={idx}
                  className="relative group rounded-lg border border-border bg-muted overflow-hidden"
                >
                  {url ? (
                    <img
                      src={url}
                      alt={f.name}
                      className="h-16 w-16 object-cover"
                      onLoad={() => URL.revokeObjectURL(url)}
                    />
                  ) : (
                    <div className="h-16 px-3 flex items-center gap-2 text-xs">
                      <FileText className="h-4 w-4" />
                      <span className="max-w-[140px] truncate">{f.name}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setAttachments((cur) => cur.filter((_, i) => i !== idx))}
                    className="absolute top-0.5 right-0.5 rounded-full bg-background/95 p-0.5 opacity-90 hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              acceptFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Attach file"
            className="shrink-0 h-11 w-11 text-muted-foreground"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
              if (e.key === "Escape" && attachments.length) {
                e.preventDefault();
                setAttachments([]);
              }
            }}
            onPaste={(e) => {
              const files: File[] = [];
              for (const item of Array.from(e.clipboardData.items)) {
                if (item.kind === "file") {
                  const f = item.getAsFile();
                  if (f) files.push(f);
                }
              }
              if (files.length) {
                e.preventDefault();
                acceptFiles(files);
              }
            }}
            placeholder="Write, paste, or drop images / PDFs…"
            rows={1}
            className="resize-none min-h-[44px] max-h-40"
          />
          <Button
            onClick={() => {
              void send();
            }}
            disabled={
              (!input.trim() && attachments.length === 0) ||
              status === "submitted" ||
              status === "streaming"
            }
            size="icon"
            aria-label="Send message"
            className="shrink-0 h-11 w-11"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
