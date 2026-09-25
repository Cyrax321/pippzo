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
import { loadChatMessages, saveChatMessages } from "@/lib/chat-history";
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
  "messages" | "setMessages" | "sendMessage" | "status"
> & {
  imageFrames: Record<string, { dataUrl: string; final: boolean }>;
  videoJobs: Record<string, { label: string; progress?: number }>;
  imageStashRef: { current: Map<string, string> };
  videoStashRef: { current: Map<string, string> };
  buffer: BufferStatus | null;
};

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

  const restoredMessages = useMemo(() => loadChatMessages(activeWorkspaceId), [activeWorkspaceId]);

  const { messages, setMessages, sendMessage, status, addToolResult } = useChat({
    ...(activeWorkspaceId ? { id: `pippzo-${activeWorkspaceId}` } : {}),
    messages: restoredMessages,
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

  useEffect(() => {
    if (status === "submitted" || status === "streaming") return;
    saveChatMessages(activeWorkspaceId, messages);
  }, [messages, status, activeWorkspaceId]);

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

  const value = useMemo<ChatSessionValue>(
    () => ({
      messages,
      setMessages,
      sendMessage,
      status,
      imageFrames,
      videoJobs,
      imageStashRef,
      videoStashRef,
      buffer,
    }),
    [messages, setMessages, sendMessage, status, imageFrames, videoJobs, buffer],
  );

  return <ChatSessionContext.Provider value={value}>{children}</ChatSessionContext.Provider>;
}
