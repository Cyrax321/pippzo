import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchWithTimeout, FetchTimeoutError } from "@/lib/fetch-timeout";
import {
  BUFFER_RECONNECT_HINT,
  BUFFER_TIMEOUT,
  BufferApiError,
  bufferHttpFailure,
  bufferPublishFailureMessage,
  bufferUnreadableResponse,
  checkCaptionLength,
  classifyBufferFailure,
} from "@/lib/buffer-shared";

const ENDPOINT = "https://api.buffer.com";

type Ctx = { supabase: { from: (t: string) => any }; userId: string };

/**
 * Narrow shape for the one status write below. Typed structurally rather than
 * cast to `any` so the update payload and the filter chain are still checked.
 */
type StatusUpdateClient = {
  from: (table: string) => {
    update: (patch: { status: string }) => {
      eq: (
        column: string,
        value: string,
      ) => {
        eq: (column: string, value: string) => PromiseLike<{ error: { message: string } | null }>;
      };
    };
  };
};

// Reads the usable token from a buffer_connection row: the encrypted column
// wins when it decrypts, with the legacy plaintext column as fallback.
// TODO: blank the plaintext access_token column once every reader (see
// cron-executors.server.ts) has migrated to the encrypted column — until then
// both are written on save so cron keeps working during the transition.
async function readBufferTokenRow(
  row: { access_token?: string | null; access_token_enc?: string | null } | null,
): Promise<string | null> {
  if (!row) return null;
  const { decryptSecret, isEncrypted } = await import("./crypto.server");
  const enc = row.access_token_enc;
  if (enc && isEncrypted(enc)) {
    const plain = await decryptSecret(enc);
    if (plain) return plain;
  }
  return row.access_token?.trim() || null;
}

async function getWorkspaceToken(ctx: Ctx, workspaceId: string): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("buffer_connection")
    .select("access_token,access_token_enc")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`Could not read Buffer connection: ${error.message}`);
  const token = await readBufferTokenRow(data);
  if (!token)
    throw new Error(
      "Buffer is not connected for this workspace. Go to Connections and paste your Buffer access token.",
    );
  return token;
}

// Channel id -> service (instagram, linkedin, twitter, ...), read from the
// cached channel list on the connection row so we know which network-specific
// `metadata` block Buffer expects.
async function getChannelServices(ctx: Ctx, workspaceId: string): Promise<Record<string, string>> {
  const { data } = await ctx.supabase
    .from("buffer_connection")
    .select("channels")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const list = (data?.channels as Array<{ id?: string; service?: string }> | null) ?? [];
  const map: Record<string, string> = {};
  for (const c of list) if (c?.id && c?.service) map[c.id] = String(c.service).toLowerCase();
  return map;
}

async function gql<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
  op = "graphql",
  // Most calls through this file are reads a person is waiting on; the one
  // write that matters (createPost) asks for the publish budget explicitly.
  timeoutMs: number = BUFFER_TIMEOUT.read,
): Promise<T> {
  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      ENDPOINT,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query, variables }),
      },
      { timeoutMs, label: "Buffer" },
    );
  } catch (e) {
    console.error(`[buffer:${op}] network error`, e);
    // A timeout keeps its own identity: it is the only failure here where the
    // request may have been carried out anyway, and createPost needs to know.
    if (e instanceof FetchTimeoutError) throw e;
    throw new BufferApiError(
      `Buffer network error: ${e instanceof Error ? e.message : String(e)}`,
      { kind: "unreachable", outcomeUnknown: true },
    );
  }
  const ms = Date.now() - startedAt;
  let json: { data?: T; errors?: Array<{ message: string; path?: unknown }> } | null = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok || json?.errors?.length) {
    const msg = json?.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`;
    console.error(`[buffer:${op}] failed in ${ms}ms`, { status: res.status, errors: json?.errors });
    // Carries the HTTP status, so a revoked token can be told apart from a blip.
    throw bufferHttpFailure(res.status, msg);
  }
  if (!json || json.data == null) {
    console.error(`[buffer:${op}] unreadable success response in ${ms}ms`, {
      status: res.status,
      hasJson: !!json,
    });
    throw bufferUnreadableResponse(res.status, !!json);
  }
  console.info(`[buffer:${op}] ok in ${ms}ms`);
  return json.data as T;
}

export type BufferChannel = { id: string; name: string; service: string; organizationId: string };
export type BufferStatus = {
  connected: boolean;
  organization?: { id: string; name: string };
  account?: { id: string; email: string };
  channels: BufferChannel[];
  error?: string;
  /**
   * The token itself was refused (401/403), as opposed to Buffer being
   * unreachable. `error` already says so in words — the Connections page prints
   * it verbatim — but callers that want to render a Reconnect affordance rather
   * than a retry one can branch on this instead of matching on prose.
   */
  needsReconnect?: boolean;
};

async function fetchStatus(token: string): Promise<BufferStatus> {
  try {
    type Resp = {
      account: { id: string; email: string; organizations: Array<{ id: string; name: string }> };
    };
    const out = await gql<Resp>(
      token,
      `query { account { id email organizations { id name } } }`,
      undefined,
      "account",
    );
    const org = out.account.organizations?.[0];
    if (!org)
      return {
        connected: false,
        channels: [],
        error: "No organization found in the Buffer account.",
      };
    type ChResp = { channels: Array<{ id: string; name: string; service: string }> };
    const ch = await gql<ChResp>(
      token,
      `query GetChannels($input: ChannelsInput!) { channels(input: $input) { id name service } }`,
      { input: { organizationId: org.id } },
      "channels",
    );
    return {
      connected: true,
      organization: org,
      account: { id: out.account.id, email: out.account.email },
      channels: ch.channels.map((c) => ({ ...c, organizationId: org.id })),
    };
  } catch (e) {
    // This catch used to flatten every cause into one string, so a revoked
    // token and a dropped packet produced the same "not connected" and nothing
    // ever told anyone to reconnect (finding 29). The classification carries
    // the HTTP status through, and the message it comes with already says
    // either "reconnect it" or "this will be retried".
    const failure = classifyBufferFailure(e);
    console.error("[buffer:status] could not read Buffer status", {
      kind: failure.kind,
      status: failure.status,
    });
    return {
      connected: false,
      channels: [],
      error: failure.message,
      ...(failure.kind === "auth" ? { needsReconnect: true } : {}),
    };
  }
}

const wsInput = z.object({ workspaceId: z.string().uuid() });

export const bufferGetStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspaceId: string }) => wsInput.parse(d))
  .handler(async ({ data, context }): Promise<BufferStatus> => {
    const { data: row, error } = await (context.supabase as any)
      .from("buffer_connection")
      .select("access_token,access_token_enc,channels")
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();
    if (error) return { connected: false, channels: [], error: error.message };
    const token = await readBufferTokenRow(row);
    if (!token)
      return { connected: false, channels: [], error: "No Buffer token saved for this workspace." };
    const status = await fetchStatus(token);
    if (status.connected) {
      await (context.supabase as any)
        .from("buffer_connection")
        .update({ channels: status.channels })
        .eq("workspace_id", data.workspaceId);
    }
    return status;
  });

export const bufferListChannels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspaceId: string }) => wsInput.parse(d))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ channels: BufferChannel[]; error?: string; needsReconnect?: boolean }> => {
      const s = await bufferGetStatus({ data: { workspaceId: data.workspaceId } } as never).catch(
        (e: Error) => ({ connected: false, channels: [], error: e.message }) as BufferStatus,
      );
      void context;
      return {
        channels: s.channels,
        error: s.error,
        ...(s.needsReconnect ? { needsReconnect: true } : {}),
      };
    },
  );

export const bufferSaveToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspaceId: string; accessToken: string }) =>
    z.object({ workspaceId: z.string().uuid(), accessToken: z.string().min(10).max(500) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<BufferStatus> => {
    const status = await fetchStatus(data.accessToken);
    if (!status.connected) {
      // "Reconnect in Settings → Connections" is the right advice everywhere
      // except here, where the user is standing in Settings → Connections
      // pasting the token. Say the useful thing instead.
      if (status.needsReconnect)
        throw new Error(
          `Buffer would not accept this token — ${(status.error ?? "").replace(BUFFER_RECONNECT_HINT, "").trim()} ` +
            `Check you pasted the whole token, and that it has not been revoked at publish.buffer.com/settings/api.`,
        );
      throw new Error(status.error ?? "Buffer rejected this token.");
    }
    // Store the token encrypted at rest (same AES-GCM scheme as provider keys)
    // with the plaintext column blanked — every reader now decrypts first via
    // readBufferToken, so the raw token never lands in the table.
    const { writeBufferToken } = await import("./crypto.server");
    const tokenCols = await writeBufferToken(data.accessToken);
    const { error } = await (context.supabase as any).from("buffer_connection").upsert(
      {
        workspace_id: data.workspaceId,
        ...tokenCols,
        channels: status.channels,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" },
    );
    if (error) throw new Error(`Could not save token: ${error.message}`);
    return status;
  });

export const bufferDisconnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspaceId: string }) => wsInput.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await (context.supabase as any)
      .from("buffer_connection")
      .delete()
      .eq("workspace_id", data.workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Pulls own-account performance numbers for already-sent posts into
// `post_metrics`, so the agent can learn from what actually worked.
export const bufferSyncMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspaceId: string; limit?: number }) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ fetched: number; upserted: number }> => {
    const token = await getWorkspaceToken(context as unknown as Ctx, data.workspaceId);
    const { syncBufferMetrics } = await import("./buffer-analytics.server");
    const res = await syncBufferMetrics(
      context.supabase as any,
      token,
      data.workspaceId,
      data.limit ?? 50,
    );
    return { fetched: res.fetched, upserted: res.upserted };
  });

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

const DATA_URL_RE = /^data:([\w./+-]+);base64,(.+)$/;

async function uploadDataUrlToPublicHost(
  workspaceId: string,
  dataUrl: string,
  kindHint: "image" | "video",
): Promise<string> {
  const match = DATA_URL_RE.exec(dataUrl.trim());
  if (!match) {
    if (/^https:\/\//i.test(dataUrl)) return dataUrl;
    throw new Error(
      `${kindHint === "video" ? "Video" : "Image"} must be a data:${kindHint}/...;base64,... URL or an https URL.`,
    );
  }
  const mime = match[1];
  const base64 = match[2];
  const ext =
    mime.split("/")[1]?.split("+")[0]?.toLowerCase() || (kindHint === "video" ? "mp4" : "png");
  const bytes = Buffer.from(base64, "base64");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const path = `${workspaceId}/${crypto.randomUUID()}.${ext}`;
  const up = await supabaseAdmin.storage.from("buffer-media").upload(path, bytes, {
    contentType: mime,
    upsert: false,
  });
  if (up.error) throw new Error(`Storage upload failed: ${up.error.message}`);
  const signed = await supabaseAdmin.storage
    .from("buffer-media")
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  if (signed.error || !signed.data?.signedUrl)
    throw new Error(`Could not create public URL: ${signed.error?.message ?? "unknown"}`);

  // Buffer fetches media from its own servers, so the URL has to resolve
  // publicly — a locally-hosted storage endpoint never would.
  const { toPublicMediaUrl, assertPubliclyFetchable } = await import("./public-media.server");
  const publicUrl = toPublicMediaUrl(signed.data.signedUrl);
  assertPubliclyFetchable(publicUrl, kindHint === "video" ? "The video" : "The image");
  return publicUrl;
}

// Uploads a video (from a data: URL) to the buffer-media bucket and returns a
// long-lived signed URL usable by the /library UI (and by Buffer at publish time).
export const uploadLibraryVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { workspaceId: string; dataUrl: string; name: string; contentType?: string }) =>
      z
        .object({
          workspaceId: z.string().uuid(),
          // Server-side cap (client also limits to 100MB). base64 inflates
          // binary by 4/3, so ~140M chars ≈ a 100MB video; reject larger
          // rather than trusting the client's check.
          dataUrl: z
            .string()
            .min(20)
            .max(145 * 1024 * 1024),
          name: z.string().min(1).max(200),
          contentType: z.string().max(120).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ signedUrl: string }> => {
    // Verify the caller is a member of the target workspace before writing
    // through the service-role admin client. Without this check any signed-in
    // user could plant files into any workspace's storage path.
    const { data: member, error: memErr } = await (context.supabase as any)
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", data.workspaceId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (memErr) throw new Error(`Could not verify workspace membership: ${memErr.message}`);
    if (!member) throw new Error("You are not a member of this workspace.");
    const signedUrl = await uploadDataUrlToPublicHost(data.workspaceId, data.dataUrl, "video");
    return { signedUrl };
  });

// ~8MB of image bytes per page is plenty for a slide; base64 inflates binary
// by 4/3, so the string cap sits a little above that.
const MAX_CAROUSEL_IMAGE_CHARS = Math.ceil((8 * 1024 * 1024 * 4) / 3) + 1024;

// Builds a LinkedIn carousel: stitches 2–10 generated images into a PDF (one
// page per image), hosts it publicly, and returns the URL to pass to
// bufferCreatePost as documentUrl. Assembly is separate from posting so the
// heavy PDF work happens once even if the post is retried or rescheduled.
export const bufferAssembleCarousel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspaceId: string; images: string[]; title: string }) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        images: z
          .array(
            z
              .string()
              .regex(/^data:image\//, "Each carousel page must be a data:image/...;base64,... URL.")
              .max(MAX_CAROUSEL_IMAGE_CHARS, "Each carousel image must be under ~8MB."),
          )
          .min(2, "A carousel needs at least 2 pages.")
          .max(10, "A carousel can carry at most 10 pages."),
        title: z.string().min(1).max(100),
      })
      .parse(d),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ url: string; thumbnailUrl: string; pages: number; sizeBytes: number }> => {
      // Same guard as uploadLibraryVideo: membership must be proven before the
      // service-role client writes into the workspace's storage path.
      const { data: member, error: memErr } = await (context.supabase as any)
        .from("workspace_members")
        .select("workspace_id")
        .eq("workspace_id", data.workspaceId)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (memErr) throw new Error(`Could not verify workspace membership: ${memErr.message}`);
      if (!member) throw new Error("You are not a member of this workspace.");

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { assembleCarouselPdf } = await import("./carousel.server");
      return await assembleCarouselPdf(supabaseAdmin, data.workspaceId, data.images, data.title);
    },
  );

export type InstagramPostType = "post" | "reel" | "story";
export type ChannelPostOptions = {
  instagramType?: InstagramPostType;
  shouldShareToFeed?: boolean;
  firstComment?: string;
};

const channelOptions = z.object({
  instagramType: z.enum(["post", "reel", "story"]).optional(),
  shouldShareToFeed: z.boolean().optional(),
  firstComment: z.string().max(3000).optional(),
});

const createPostInput = z
  .object({
    workspaceId: z.string().uuid(),
    channelIds: z.array(z.string().min(1)).min(1, "Pick at least one Buffer channel.").max(20),
    // Deliberately NOT min(1): an Instagram story carries no caption, and
    // requiring one here used to reject the post outright — which pushed the
    // agent into inventing caption copy just to satisfy the schema. The real
    // rule is that a post must carry text or media, enforced below.
    text: z.string().max(10000),
    scheduledAtISO: z.string().optional(),
    /**
     * Publish immediately (Buffer ShareMode `shareNow`) instead of taking a
     * queue slot. Irreversible once it goes out, so callers must set it only on
     * an explicit request.
     */
    publishNow: z.boolean().optional(),
    saveAsDraft: z.boolean().optional(),
    imageDataUrl: z.string().optional(),
    imageUrl: z.string().url().optional(),
    videoUrl: z.string().url().optional(),
    // A LinkedIn document (carousel PDF), already hosted at a public URL —
    // typically the output of bufferAssembleCarousel.
    documentUrl: z.string().url().optional(),
    documentTitle: z.string().max(100).optional(),
    // Buffer's DocumentAssetInput requires thumbnailUrl (String!) — the live
    // API rejects a document without one. bufferAssembleCarousel supplies it.
    documentThumbnailUrl: z.string().url().optional(),
    // Per-channel network options, keyed by Buffer channel id.
    perChannel: z.record(z.string(), channelOptions).optional(),
  })
  .refine(
    (v) =>
      v.text.trim().length > 0 ||
      !!v.imageDataUrl ||
      !!v.imageUrl ||
      !!v.videoUrl ||
      !!v.documentUrl,
    {
      message:
        "A post needs a caption, an image, a video or a document. Instagram stories can go out with no caption, but they must carry media.",
      path: ["text"],
    },
  )
  .refine((v) => !v.documentUrl || !!v.documentThumbnailUrl, {
    message:
      "A document post needs documentThumbnailUrl — Buffer requires it. Use bufferAssembleCarousel, which returns one.",
    path: ["documentThumbnailUrl"],
  })
  .refine((v) => !(v.documentUrl && (v.imageDataUrl || v.imageUrl || v.videoUrl)), {
    message: "A post carries an image, a video, OR a document — not a mix.",
    path: ["documentUrl"],
  })
  .refine((v) => !(v.publishNow && v.scheduledAtISO), {
    message: "Choose one: publish now, or schedule for a specific time. Not both.",
    path: ["publishNow"],
  })
  .refine((v) => !(v.publishNow && v.saveAsDraft), {
    message: "A draft cannot also publish now.",
    path: ["publishNow"],
  });

export const bufferCreatePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      workspaceId: string;
      channelIds: string[];
      text: string;
      scheduledAtISO?: string;
      publishNow?: boolean;
      saveAsDraft?: boolean;
      imageDataUrl?: string;
      imageUrl?: string;
      videoUrl?: string;
      documentUrl?: string;
      documentTitle?: string;
      documentThumbnailUrl?: string;
      perChannel?: Record<string, ChannelPostOptions>;
    }) => {
      const parsed = createPostInput.parse(d);
      if (parsed.scheduledAtISO) {
        if (!ISO_WITH_OFFSET.test(parsed.scheduledAtISO))
          throw new Error(
            `scheduledAtISO must be ISO 8601 with timezone offset. Got: ${parsed.scheduledAtISO}`,
          );
        const ts = Date.parse(parsed.scheduledAtISO);
        if (!Number.isFinite(ts)) throw new Error(`Invalid date: ${parsed.scheduledAtISO}`);
        if (ts < Date.now() - 60_000)
          throw new Error(`scheduledAtISO is in the past: ${parsed.scheduledAtISO}`);
      }
      return parsed;
    },
  )
  .handler(async ({ data, context }) => {
    const token = await getWorkspaceToken(context as unknown as Ctx, data.workspaceId);

    // Buffer's ShareMode enum, confirmed by introspecting the live schema, is
    // exactly: addToQueue | customScheduled | shareNext | shareNow.
    //
    // This previously sent "scheduled" and "shareAt" for a timed post. Neither
    // is a real enum value, so both were rejected and the code silently fell
    // back to addToQueue — the post went into the next queue slot instead of the
    // time the user asked for, and still reported success. There is no fallback
    // now: if a specific time cannot be honoured, that is an error worth seeing.
    const mode = data.publishNow
      ? "shareNow"
      : data.scheduledAtISO
        ? "customScheduled"
        : "addToQueue";

    let publicImageUrl: string | undefined;
    if (data.imageUrl) publicImageUrl = data.imageUrl;
    else if (data.imageDataUrl) {
      try {
        publicImageUrl = await uploadDataUrlToPublicHost(
          data.workspaceId,
          data.imageDataUrl,
          "image",
        );
        console.info(`[buffer:createPost] image hosted for Buffer`);
      } catch (e) {
        console.error("[buffer:createPost] image upload failed", e);
        throw new Error(
          `Could not host image for Buffer: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // Video takes priority over image if both are provided (Buffer posts are
    // either photo or video, not both). A document (LinkedIn carousel PDF) is
    // mutually exclusive with both — the Zod refinement above guarantees it
    // arrives alone, so it simply takes the whole assets array.
    const assets = data.documentUrl
      ? [
          {
            document: {
              url: data.documentUrl,
              thumbnailUrl: data.documentThumbnailUrl,
              ...(data.documentTitle ? { title: data.documentTitle } : {}),
            },
          },
        ]
      : data.videoUrl
        ? [
            {
              video: {
                url: data.videoUrl,
                ...(publicImageUrl ? { thumbnail: { url: publicImageUrl } } : {}),
              },
            },
          ]
        : publicImageUrl
          ? [{ image: { url: publicImageUrl } }]
          : [];

    // Always read the service map now, not just for documents and per-channel
    // options: every channel has to be checked against its own network's
    // caption limit below, and we cannot know the limit without knowing the
    // network. One cached-column read per publish is a cheap price for not
    // discovering the limit from Buffer after a live round trip (finding 30).
    const services = await getChannelServices(context as unknown as Ctx, data.workspaceId);
    const hasVideo = !!data.videoUrl;
    const hasImage = !!publicImageUrl;

    // `mode` is echoed back so the caller can state plainly whether the post is
    // publishing now, at a set time, or in the next queue slot.
    const results: Array<{
      channelId: string;
      ok: boolean;
      postId?: string;
      dueAt?: string;
      mode?: string;
      error?: string;
    }> = [];
    for (const channelId of data.channelIds) {
      let lastError = "Buffer rejected the post.";
      let ok = false;

      // Build the network-specific metadata block for this channel.
      const opts = data.perChannel?.[channelId];
      const service = services[channelId];
      let metadata: Record<string, unknown> | undefined;
      let blocked: string | null = null;
      // Only LinkedIn renders document assets (as a swipeable carousel); every
      // other network would either reject the post or drop the attachment
      // silently, so refuse it per-channel instead of failing the whole call.
      if (data.documentUrl && service !== "linkedin") {
        blocked = `Documents/carousels are LinkedIn-only — ${service ?? "this channel"} doesn't accept them.`;
      }
      // One `text` can be addressed to channels on different networks, and the
      // schema only caps it at a cross-platform 10000. A LinkedIn-length caption
      // sent alongside an X channel used to publish to one and fail on the other
      // after a live round trip; check it here, per channel, before the request.
      //
      // Blocks only this channel, like every other per-channel refusal, so the
      // channels that can take the caption still go out. An unknown service, or
      // a channel not in the cached list, means we have no limit we can trust —
      // and an empty caption is never over one, so an Instagram story with no
      // text passes exactly as before.
      if (!blocked) {
        const tooLong = checkCaptionLength(service, data.text);
        if (tooLong) blocked = tooLong.message;
      }
      if (!blocked && opts) {
        const firstComment = opts.firstComment?.trim() || undefined;
        if (service === "instagram") {
          const type = opts.instagramType ?? "post";
          if (type === "reel" && !hasVideo) blocked = "Instagram reels need a video attached.";
          if (type === "story" && !hasVideo && !hasImage)
            blocked = "Instagram stories need an image or a video attached.";
          metadata = {
            instagram: {
              type,
              ...(type === "reel"
                ? { shouldShareToFeed: opts.shouldShareToFeed ?? true }
                : { shouldShareToFeed: type === "post" }),
              ...(type !== "story" && firstComment ? { firstComment } : {}),
            },
          };
        } else if (service === "linkedin" && firstComment) {
          metadata = { linkedin: { firstComment } };
        } else if (service === "facebook" && firstComment) {
          metadata = { facebook: { firstComment } };
        }
      }
      if (blocked) {
        results.push({ channelId, ok: false, error: blocked });
        continue;
      }

      try {
        type Resp = {
          createPost: { post?: { id: string; text: string; dueAt?: string }; message?: string };
        };
        const out = await gql<Resp>(
          token,
          `mutation Create($input: CreatePostInput!) {
              createPost(input: $input) {
                ... on PostActionSuccess { post { id text dueAt } }
                ... on MutationError { message }
              }
            }`,
          {
            input: {
              channelId,
              text: data.text,
              schedulingType: "automatic",
              mode,
              assets,
              // shareNow publishes immediately, so a due date is meaningless there.
              ...(data.scheduledAtISO && !data.publishNow ? { dueAt: data.scheduledAtISO } : {}),
              ...(data.saveAsDraft ? { saveToDraft: true } : {}),
              ...(metadata ? { metadata } : {}),
            },
          },
          "createPost",
          // The one write in this file. It gets the publish budget rather than
          // the read budget: giving up early on a slow publish does not make it
          // fail, it makes its outcome unknown, which is far more expensive.
          BUFFER_TIMEOUT.publish,
        );
        if (!out.createPost.post) {
          lastError = out.createPost.message ?? "Buffer rejected the post.";
        } else {
          results.push({
            channelId,
            ok: true,
            postId: out.createPost.post.id,
            dueAt: out.createPost.post.dueAt,
            mode,
          });
          ok = true;
        }
      } catch (e) {
        // Phrased for a publish: when the request timed out or the socket died
        // this must say the outcome is unknown and send the user to look, never
        // "it failed, try again" — a retry there is how a post goes out twice.
        lastError = bufferPublishFailureMessage(classifyBufferFailure(e));
      }
      if (!ok) results.push({ channelId, ok: false, error: lastError });
    }
    const anyOk = results.some((r) => r.ok);

    if (!anyOk) throw new Error(results.map((r) => `${r.channelId}: ${r.error}`).join(" | "));
    return {
      results,
      imageAttached: !!publicImageUrl,
      videoAttached: !!data.videoUrl,
      documentAttached: !!data.documentUrl,
    };
  });

// Publishes an already-approved scheduled_posts row to Buffer. Called from the
// Approvals page right after an approve: the approval itself is only a status
// flip, and this bridges it to an actual Buffer publish through the admin
// client (which the publish helper requires — it must never run client-side).
// A Buffer failure is reported back but never reverts the approval.
export const bufferPublishApprovedPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspaceId: string; postId: string }) =>
    z.object({ workspaceId: z.string().uuid(), postId: z.string().uuid() }).parse(d),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      ok: boolean;
      bufferId?: string;
      channelId?: string;
      channelName?: string;
      error?: string;
    }> => {
      // Membership check before touching the service-role admin client — same
      // guard as uploadLibraryVideo: without it any signed-in user could publish
      // another workspace's queue.
      const { data: member, error: memErr } = await (context.supabase as any)
        .from("workspace_members")
        .select("workspace_id")
        .eq("workspace_id", data.workspaceId)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (memErr) throw new Error(`Could not verify workspace membership: ${memErr.message}`);
      if (!member) throw new Error("You are not a member of this workspace.");

      const { data: row, error } = await (context.supabase as any)
        .from("scheduled_posts")
        // buffer_channel_id matters: when the post was scheduled against a
        // specific channel, publishing it to a different page of the same
        // network would be wrong, and a workspace with two LinkedIn pages
        // otherwise always gets whichever sorts first.
        .select("id,post,image_url,scheduled_at,status,buffer_channel_id")
        .eq("id", data.postId)
        .eq("workspace_id", data.workspaceId)
        .maybeSingle();
      if (error) return { ok: false, error: `Could not load the post: ${error.message}` };
      if (!row) return { ok: false, error: "Post not found in this workspace." };
      if (row.status !== "scheduled")
        return { ok: false, error: `Post is not approved yet (status: ${row.status}).` };

      const post = row.post as {
        platform?: string;
        caption?: string;
        cta?: string;
        hashtags?: string[];
      } | null;
      // Compose the full outgoing text the same way the schedule dialog does:
      // caption, then CTA, then hashtags.
      const tags = (post?.hashtags ?? []).map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
      const caption = [post?.caption?.trim(), post?.cta?.trim(), tags].filter(Boolean).join("\n\n");

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { publishScheduledPostToBuffer, publishOutcomeStatus } =
        await import("./buffer-publish.server");
      const result = await publishScheduledPostToBuffer(supabaseAdmin, data.workspaceId, {
        id: row.id as string,
        platform: String(post?.platform ?? ""),
        caption,
        imageUrl: (row.image_url as string | null) ?? undefined,
        scheduledAtISO: (row.scheduled_at as string | null) ?? undefined,
        channelId: (row.buffer_channel_id as string | null) ?? undefined,
      });

      // Record what actually happened. Without this the human approval path —
      // both the Approvals screen and the batch publish when approval is turned
      // off — leaves a post that Buffer refused sitting at 'scheduled', which
      // is indistinguishable from a healthy one. The approval itself is never
      // rolled back; this only writes down the outcome.
      //
      // Best effort on purpose: a failed status write must not turn a post that
      // DID publish into a reported failure. It is logged and the real result
      // is returned either way.
      // Which status that is, is not decided here: publishOutcomeStatus is the
      // single place the three writers share, so "a timeout" cannot mean
      // `publish_failed` in one of them and `publish_unknown` in another. null
      // back from it means nothing reached Buffer (another publish holds the
      // claim, or the row is gone) and the status must be left exactly as it
      // was — stamping that would contradict an attempt that may be seconds
      // from succeeding.
      const outcome = publishOutcomeStatus(result);
      const { error: statusErr } = outcome
        ? await (context.supabase as unknown as StatusUpdateClient)
            .from("scheduled_posts")
            .update({ status: outcome })
            .eq("id", data.postId)
            .eq("workspace_id", data.workspaceId)
        : { error: null as { message: string } | null };
      if (statusErr) {
        console.error("[buffer:publishApproved] could not record publish outcome", {
          postId: data.postId,
          ok: result.ok,
          outcome,
          error: statusErr.message,
        });
      }

      return result;
    },
  );

export const bufferDeletePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspaceId: string; id: string }) =>
    z.object({ workspaceId: z.string().uuid(), id: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const token = await getWorkspaceToken(context as unknown as Ctx, data.workspaceId);
    // DeletePostPayload is a DIFFERENT union from create's (DeletePostSuccess |
    // VoidMutationError, verified by live introspection). The old fragment used
    // create's PostActionSuccess, which fails GraphQL validation — so every
    // delete errored before reaching Buffer.
    type Resp = { deletePost: { __typename: string; id?: string; message?: string } };
    const out = await gql<Resp>(
      token,
      `mutation Delete($input: DeletePostInput!) {
        deletePost(input: $input) {
          __typename
          ... on DeletePostSuccess { id }
          ... on VoidMutationError { message }
        }
      }`,
      { input: { id: data.id } },
      "deletePost",
    );
    if (out.deletePost.__typename === "VoidMutationError") {
      throw new Error(`Buffer refused the delete: ${out.deletePost.message ?? "unknown reason"}`);
    }
    return { ok: true, deletedId: out.deletePost.id ?? data.id };
  });
