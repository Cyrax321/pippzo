import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import { useServerFn } from "@tanstack/react-start";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { brandContextSummary, brandStore, useBrandImages } from "@/lib/brand-store";
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
import { toast } from "sonner";
import type { Platform, BrandImage } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import {
  loadChatMessages,
  saveChatMessages,
  listChatSessions,
  getActiveSessionId,
  setActiveSessionId,
  createChatSession,
  deleteChatSession,
  deleteAllChatSessions,
  renameChatSession,
  type ChatSessionMeta,
} from "@/lib/chat-history";
import { logActivityFn } from "@/lib/activity-log";

export type ScheduleArgs = {
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
export type GenImageArgs = {
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

export type ChatSessionValue = Pick<
  UseChatHelpers<UIMessage>,
  "messages" | "setMessages" | "sendMessage" | "status" | "stop"
> & {
  imageFrames: Record<string, { dataUrl: string; final: boolean }>;
  videoJobs: Record<string, { label: string; progress?: number }>;
  imageStashRef: { current: Map<string, string> };
  videoStashRef: { current: Map<string, string> };
  buffer: BufferStatus | null;
  activeSessionId: string;
  sessions: ChatSessionMeta[];
  createSession: (title?: string) => string;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  deleteAllSessions: () => void;
  renameSession: (sessionId: string, title: string) => void;
  reloadSessions: () => void;
};

/** Internal context shared between the outer shell and ChatCore. */
type ShellContext = {
  activeWorkspaceId: string | null;
  activeSessionId: string;
  sessions: ChatSessionMeta[];
  setSessions: (s: ChatSessionMeta[]) => void;
  setActiveSessionId: (id: string) => void;
  buffer: BufferStatus | null;
  imageStashRef: { current: Map<string, string> };
  videoStashRef: { current: Map<string, string> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transport: any;
  itemsRef: { current: ReturnType<typeof useScheduledPosts> };
  bufferRef: { current: BufferStatus | null };
  wsRef: { current: string | null };
  libraryRef: { current: BrandImage[] };
  bufferCreate: ReturnType<typeof useServerFn<typeof bufferCreatePost>>;
  bufferDelete: ReturnType<typeof useServerFn<typeof bufferDeletePost>>;
  analyzeCompetitorFn: ReturnType<typeof useServerFn<typeof scanCompetitorV2>>;
  videoProvidersFn: ReturnType<typeof useServerFn<typeof listVideoProviders>>;
  startVideoFn: ReturnType<typeof useServerFn<typeof startVideoGeneration>>;
  pollVideoFn: ReturnType<typeof useServerFn<typeof pollVideoGeneration>>;
  assembleCarouselFn: ReturnType<typeof useServerFn<typeof bufferAssembleCarousel>>;
};

const ShellCtx = createContext<ShellContext | null>(null);
const ChatSessionContext = createContext<ChatSessionValue | null>(null);

export function useChatSession(): ChatSessionValue {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) throw new Error("useChatSession must be used inside <ChatSessionProvider>");
  return ctx;
}

// The chat session lives here — above the router Outlet — so navigating to
// another page does not unmount the useChat instance. When it lived in the
// /chat route component, leaving the page destroyed the hook: an in-flight
// stream aborted, client tool calls (image/video generation, scheduling)
// died mid-run, and the unsaved turn vanished from localStorage history.
//
// ARCHITECTURE: ChatSessionProvider is split into two layers:
//   1. ChatSessionProvider (outer) — owns session list, active id, buffer, refs.
//      This stays mounted across the entire app lifetime.
//   2. ChatCore (inner) — owns useChat, keyed by activeSessionId.
//      The `key` forces a clean useChat remount when the user switches sessions,
//      which is the only reliable way to load a different session's messages
//      because useChat only reads its `messages` prop on initial mount.
export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const { activeWorkspaceId } = useWorkspace();
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

  const [activeSessionId, setActiveSessionIdState] = useState<string>(() =>
    getActiveSessionId(activeWorkspaceId),
  );
  const [sessions, setSessions] = useState<ChatSessionMeta[]>(() =>
    listChatSessions(activeWorkspaceId),
  );

  useEffect(() => {
    const curActive = getActiveSessionId(activeWorkspaceId);
    setActiveSessionIdState(curActive);
    setSessions(listChatSessions(activeWorkspaceId));
  }, [activeWorkspaceId]);

  const handleSetActiveSessionId = (id: string) => {
    setActiveSessionId(activeWorkspaceId, id);
    setActiveSessionIdState(id);
  };

  const shellValue = useMemo<ShellContext>(
    () => ({
      activeWorkspaceId,
      activeSessionId,
      sessions,
      setSessions,
      setActiveSessionId: handleSetActiveSessionId,
      buffer,
      imageStashRef,
      videoStashRef,
      transport,
      itemsRef,
      bufferRef,
      wsRef,
      libraryRef,
      bufferCreate,
      bufferDelete,
      analyzeCompetitorFn,
      videoProvidersFn,
      startVideoFn,
      pollVideoFn,
      assembleCarouselFn,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeWorkspaceId, activeSessionId, sessions, buffer],
  );

  return (
    <ShellCtx.Provider value={shellValue}>
      <ChatCore key={activeWorkspaceId ?? "anon"}>{children}</ChatCore>
    </ShellCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// ChatCore — keyed by activeSessionId so useChat remounts fresh per session.
// All heavy tool-call logic lives here (unchanged from before).
// ---------------------------------------------------------------------------
function ChatCore({ children }: { children: ReactNode }) {
  const shell = useContext(ShellCtx)!;
  const {
    activeWorkspaceId,
    activeSessionId,
    sessions,
    setSessions,
    setActiveSessionId: shellSetActive,
    buffer,
    imageStashRef,
    videoStashRef,
    transport,
    itemsRef,
    bufferRef,
    wsRef,
    libraryRef,
    bufferCreate,
    bufferDelete,
    analyzeCompetitorFn,
    videoProvidersFn,
    startVideoFn,
    pollVideoFn,
    assembleCarouselFn,
  } = shell;

  // For UI: re-render image previews as partial frames arrive.
  const [imageFrames, setImageFrames] = useState<
    Record<string, { dataUrl: string; final: boolean }>
  >({});
  // Per-toolCall video render progress
  const [videoJobs, setVideoJobs] = useState<Record<string, { label: string; progress?: number }>>(
    {},
  );

  const sessionMessages = useMemo(
    () => loadChatMessages(activeWorkspaceId, activeSessionId),
    [activeWorkspaceId, activeSessionId],
  );

  const { messages, setMessages, sendMessage, status, addToolResult, stop } = useChat({
    id: `pippzo-${activeWorkspaceId ?? "anon"}-${activeSessionId}`,
    messages: sessionMessages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
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
              referencesUsed: meta.referencesUsed,
              referencedIds: usableIds.filter((id) => !!imageStashRef.current.get(id)),
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
            const poster = await capturePosterFromUrl(done.signedUrl);
            const videoId = crypto.randomUUID();
            await brandStore.addImage({
              id: videoId,
              dataUrl: poster.posterDataUrl,
              name: `Generated video · ${a.prompt.slice(0, 48)}`,
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
          const list = itemsRef.current
            .filter((i) => i.scheduledAt === null || (i.scheduledAt >= from && i.scheduledAt <= to))
            .sort((a, b) => (a.scheduledAt ?? Infinity) - (b.scheduledAt ?? Infinity))
            .map((i) => ({
              id: i.id,
              platform: i.post.platform,
              scheduledAt: i.scheduledAt ? new Date(i.scheduledAt).toISOString() : null,
              status: i.status,
              caption: i.post.caption.slice(0, 100),
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
          if (!conn?.connected) {
            addToolResult({
              tool: "bufferSchedulePost",
              toolCallId: toolCall.toolCallId,
              output: { ok: false, error: conn?.error ?? "buffer_not_connected" },
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
                available: conn.channels.map((c) => ({ id: c.id, service: c.service, name: c.name })),
              },
            });
            return;
          }
          const imageDataUrl = a.imageId ? imageStashRef.current.get(a.imageId) : undefined;
          const videoUrl = a.imageId ? videoStashRef.current.get(a.imageId) : undefined;
          const carouselIds = (a.carouselImageIds ?? []).filter(Boolean);

          let documentUrl: string | undefined;
          let documentThumbnailUrl: string | undefined;
          if (carouselIds.length > 0) {
            const slides: string[] = [];
            for (const id of carouselIds) {
              const d = imageStashRef.current.get(id);
              if (d && d.startsWith("data:") && !videoStashRef.current.has(id)) slides.push(d);
            }
            if (slides.length >= 2) {
              const carRes = await assembleCarouselFn({
                data: {
                  workspaceId: ws,
                  images: slides,
                  title: a.carouselTitle ?? a.text.slice(0, 80),
                },
              });
              documentUrl = carRes.url;
              documentThumbnailUrl = carRes.thumbnailUrl;
            }
          }

          try {
            const res = await bufferCreate({
              data: {
                workspaceId: ws,
                channelIds: wantedIds,
                text: a.text,
                scheduledAtISO: a.scheduledAtISO,
                publishNow: a.publishNow,
                imageDataUrl: documentUrl ? undefined : imageDataUrl,
                videoUrl: documentUrl ? undefined : videoUrl,
                documentUrl,
                documentThumbnailUrl,
                // Platform-specific options go in perChannel keyed by channelId
                ...(a.instagramType || a.shouldShareToFeed !== undefined || a.firstComment
                  ? {
                      perChannel: Object.fromEntries(
                        wantedIds.map((id) => [
                          id,
                          {
                            ...(a.instagramType ? { instagramType: a.instagramType } : {}),
                            ...(a.shouldShareToFeed !== undefined ? { shouldShareToFeed: a.shouldShareToFeed } : {}),
                            ...(a.firstComment ? { firstComment: a.firstComment } : {}),
                          },
                        ]),
                      ),
                    }
                  : {}),
              },
            });
            const allOk = res.results.every((r) => r.ok);
            toast[allOk ? "success" : "warning"](allOk ? "Posted to Buffer" : "Some channels failed");
            addToolResult({
              tool: "bufferSchedulePost",
              toolCallId: toolCall.toolCallId,
              output: { ok: allOk, results: res.results },
            });
          } catch (err) {
            addToolResult({
              tool: "bufferSchedulePost",
              toolCallId: toolCall.toolCallId,
              output: { ok: false, error: err instanceof Error ? err.message : "buffer_failed" },
            });
          }
          return;
        }
        if (toolCall.toolName === "analyzeCompetitor") {
          const a = toolCall.input as { name: string; handle?: string; website?: string; platforms?: string[] };
          try {
            const snap = await analyzeCompetitorFn({ data: { name: a.name, handle: a.handle, website: a.website, platforms: a.platforms } });
            const ws = wsRef.current;
            if (!ws) {
              addToolResult({
                tool: "analyzeCompetitor",
                toolCallId: toolCall.toolCallId,
                output: { ok: false, error: "no_workspace" },
              });
              return;
            }
            const created = await competitorsStore.add({
              name: a.name,
              website: a.website,
              socials: {},
              snapshot: snap,
            });
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
    onFinish({ message, isAbort, isError, isDisconnect }) {
      const ws = wsRef.current;
      if (!ws || message.role !== "assistant") return;
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

  // Track the session id for the messages currently loaded in useChat
  // Save messages to localStorage whenever they settle or on update
  useEffect(() => {
    if (status === "submitted" || status === "streaming") return;
    if (messages.length > 0) {
      saveChatMessages(activeWorkspaceId, messages, activeSessionId);
      setSessions(listChatSessions(activeWorkspaceId));
    }
  }, [messages, status, activeWorkspaceId, activeSessionId]);

  // Save current messages when unmounting or switching
  useEffect(() => {
    return () => {
      if (messages.length > 0) {
        saveChatMessages(activeWorkspaceId, messages, activeSessionId);
      }
    };
  }, [messages, activeWorkspaceId, activeSessionId]);

  // Refresh brand store when agent edits brand data
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

  // Session management functions
  const switchSession = (targetSessionId: string) => {
    if (targetSessionId === activeSessionId) return;
    try {
      stop();
    } catch {
      /* ignore */
    }
    // 1. Save current conversation messages before switching
    if (messages.length > 0) {
      saveChatMessages(activeWorkspaceId, messages, activeSessionId);
    }
    // 2. Set new active session in shell
    shellSetActive(targetSessionId);
    // 3. Update session list
    setSessions(listChatSessions(activeWorkspaceId));
  };

  const createSession = (title = "New Chat") => {
    try {
      stop();
    } catch {
      /* ignore */
    }
    // 1. Save current conversation first if it has messages
    if (messages.length > 0) {
      saveChatMessages(activeWorkspaceId, messages, activeSessionId);
    }
    // 2. Create fresh session in storage
    const fresh = createChatSession(activeWorkspaceId, title);
    // 3. Set fresh session as active
    shellSetActive(fresh.id);
    // 4. Update session list
    setSessions(listChatSessions(activeWorkspaceId));
    return fresh.id;
  };

  const deleteSession = (sessionId: string) => {
    try {
      stop();
    } catch {
      /* ignore */
    }
    const isCurrent = sessionId === activeSessionId;
    const { remaining, activeId } = deleteChatSession(activeWorkspaceId, sessionId);
    setSessions(remaining);
    if (isCurrent) {
      shellSetActive(activeId);
    }
  };

  const deleteAllSessions = () => {
    try {
      stop();
    } catch {
      /* ignore */
    }
    const { remaining, activeId } = deleteAllChatSessions(activeWorkspaceId);
    shellSetActive(activeId);
    setSessions(remaining);
  };

  const renameSession = (sessionId: string, title: string) => {
    renameChatSession(activeWorkspaceId, sessionId, title);
    setSessions(listChatSessions(activeWorkspaceId));
  };

  const value = useMemo<ChatSessionValue>(
    () => ({
      messages,
      setMessages,
      sendMessage,
      status,
      stop,
      imageFrames,
      videoJobs,
      imageStashRef,
      videoStashRef,
      buffer,
      activeSessionId,
      sessions,
      createSession,
      switchSession,
      deleteSession,
      deleteAllSessions,
      renameSession,
      reloadSessions: () => setSessions(listChatSessions(activeWorkspaceId)),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, setMessages, sendMessage, status, stop, imageFrames, videoJobs, buffer, activeSessionId, sessions, activeWorkspaceId],
  );

  return <ChatSessionContext.Provider value={value}>{children}</ChatSessionContext.Provider>;
}
