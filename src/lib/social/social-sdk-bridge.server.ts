// Integration bridge between Pippzo and @opencoredev/social-sdk
// Enables normalized multi-platform publishing across Bluesky, X, and managed backends.

import { createSocial, connectedAccountRef } from "@opencoredev/social-sdk";
import { mockBackend } from "@opencoredev/social-sdk/testing";
import { bluesky } from "@opencoredev/social-sdk/bluesky";
import { x } from "@opencoredev/social-sdk/x";
import { fetchWithTimeout, FETCH_TIMEOUT } from "@/lib/fetch-timeout";
import type { PublishPlatformResult } from "./social-types";

export interface SocialSdkPublishOptions {
  text: string;
  imageUrl?: string;
  videoUrl?: string;
  idempotencyKey?: string;
}

export interface BlueskyCredentials {
  handle: string;
  appPassword?: string;
  did?: string;
  accessJwt?: string;
  service?: string;
}

export interface XBridgeCredentials {
  userId: string;
  accessToken: string;
  handle?: string;
  appBearerToken?: string;
}

// -----------------------------------------------------------------------------
// Bluesky AT Protocol Session Resolver
// -----------------------------------------------------------------------------

export async function resolveBlueskySession(
  creds: BlueskyCredentials,
): Promise<{ did: string; accessJwt: string; service: string; handle: string }> {
  const service = creds.service?.replace(/\/+$/, "") || "https://bsky.social";

  // If already have a valid accessJwt and did
  if (creds.did && creds.accessJwt) {
    return {
      did: creds.did,
      accessJwt: creds.accessJwt,
      service,
      handle: creds.handle,
    };
  }

  if (!creds.appPassword) {
    throw new Error("Bluesky credentials missing App Password or Access JWT.");
  }

  // Create session using AT Protocol XRPC
  const res = await fetchWithTimeout(
    `${service}/xrpc/com.atproto.server.createSession`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: creds.handle.trim(),
        password: creds.appPassword.trim(),
      }),
    },
    { timeoutMs: FETCH_TIMEOUT.api, label: "Bluesky createSession" },
  );

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(
      errorBody.message || `Bluesky authentication failed with status ${res.status}`,
    );
  }

  const data = (await res.json()) as {
    did: string;
    accessJwt: string;
    handle: string;
  };

  return {
    did: data.did,
    accessJwt: data.accessJwt,
    service,
    handle: data.handle || creds.handle,
  };
}

// -----------------------------------------------------------------------------
// Direct Bluesky Publisher via Social SDK
// -----------------------------------------------------------------------------

export async function publishToBlueskyViaSdk(
  creds: BlueskyCredentials,
  content: SocialSdkPublishOptions,
): Promise<PublishPlatformResult> {
  try {
    const session = await resolveBlueskySession(creds);

    const bskyAdapter = bluesky({
      auth: {
        service: session.service,
        did: session.did,
        accessJwt: session.accessJwt,
        handle: session.handle,
      },
    });

    const social = createSocial({
      backends: {
        bluesky: bskyAdapter,
      },
    });

    const idempotencyKey =
      content.idempotencyKey || `pipzo-bsky-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const result = await social.posts.publish({
      targets: [
        {
          account: connectedAccountRef({
            backend: "bluesky",
            platform: "bluesky",
            accountId: session.did,
          }),
        },
      ],
      content: { text: content.text },
      idempotencyKey,
    });

    const outcome = result.outcomes[0];
    if (outcome && outcome.state === "published") {
      const postRef = outcome.post;
      const url = outcome.url || `https://bsky.app/profile/${session.handle}`;
      return {
        platform: "bluesky",
        ok: true,
        postId: postRef?.postId || `bsky-${Date.now()}`,
        url,
      };
    }

    const errorMsg =
      outcome && "message" in outcome && typeof outcome.message === "string"
        ? outcome.message
        : "Failed to publish to Bluesky";

    return {
      platform: "bluesky",
      ok: false,
      error: errorMsg,
    };
  } catch (err) {
    return {
      platform: "bluesky",
      ok: false,
      error: err instanceof Error ? err.message : "Bluesky publish failed",
    };
  }
}

// -----------------------------------------------------------------------------
// Direct X Publisher via Social SDK
// -----------------------------------------------------------------------------

export async function publishToXViaSdk(
  creds: XBridgeCredentials,
  content: SocialSdkPublishOptions,
): Promise<PublishPlatformResult> {
  try {
    const xAdapter = x({
      auth: {
        userId: creds.userId,
        accessToken: creds.accessToken,
        handle: creds.handle,
      },
      appBearerToken: creds.appBearerToken,
    });

    const social = createSocial({
      backends: {
        x: xAdapter,
      },
    });

    const idempotencyKey =
      content.idempotencyKey || `pipzo-x-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const result = await social.posts.publish({
      targets: [
        {
          account: connectedAccountRef({
            backend: "x",
            platform: "x",
            accountId: creds.userId,
          }),
        },
      ],
      content: { text: content.text },
      idempotencyKey,
    });

    const outcome = result.outcomes[0];
    if (outcome && outcome.state === "published") {
      return {
        platform: "x",
        ok: true,
        postId: outcome.post?.postId,
        url: outcome.url,
      };
    }

    const errorMsg =
      outcome && "message" in outcome && typeof outcome.message === "string"
        ? outcome.message
        : "Failed to publish to X";

    return {
      platform: "x",
      ok: false,
      error: errorMsg,
    };
  } catch (err) {
    return {
      platform: "x",
      ok: false,
      error: err instanceof Error ? err.message : "X publish via Social SDK failed",
    };
  }
}

// -----------------------------------------------------------------------------
// Test / Mock Execution via Social SDK
// -----------------------------------------------------------------------------

export async function publishMockViaSdk(
  platform: string,
  content: SocialSdkPublishOptions,
): Promise<PublishPlatformResult> {
  const social = createSocial({
    backends: {
      mock: mockBackend({ scenario: "immediate-text-success" }),
    },
  });

  const result = await social.posts.publish({
    targets: [
      {
        account: connectedAccountRef({
          backend: "mock",
          platform: "x",
          accountId: "mock-account",
        }),
      },
    ],
    content: { text: content.text },
    idempotencyKey: content.idempotencyKey || `mock-${Date.now()}`,
  });

  const outcome = result.outcomes[0];
  const post = outcome && outcome.state === "published" ? outcome.post : undefined;
  const url = outcome && outcome.state === "published" ? (outcome as any).url : undefined;
  return {
    platform,
    ok: outcome?.state === "published",
    postId: post?.postId,
    url,
  };
}
