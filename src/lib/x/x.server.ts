// X (Twitter) API v2 Integration & Operator Module — Server-only.
// Supports both OAuth 2.0 PKCE and API Key/Secret + Access Token/Secret (OAuth 1.0a)
// All secrets are encrypted at rest with AES-GCM via crypto.server.ts.

import crypto from "node:crypto";
import { encryptSecret, decryptSecret } from "@/lib/crypto.server";
import { fetchWithTimeout, FETCH_TIMEOUT } from "@/lib/fetch-timeout";
import { logActivity } from "@/lib/activity-log";

type Client = { from: (t: string) => any };

export type XAuthMode = "oauth2" | "api_keys";

export type XCredentialsInput = {
  authMode: XAuthMode;
  // OAuth 2.0 fields
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresInSec?: number;
  scope?: string;
  // OAuth 1.0a / API Key fields
  apiKey?: string;
  apiSecret?: string;
  oauthToken?: string;
  oauthTokenSecret?: string;
  bearerToken?: string;
};

export type XConnectionStatus = {
  connected: boolean;
  authMode?: XAuthMode;
  username?: string;
  name?: string;
  accountId?: string;
  profileImageUrl?: string;
  status: string;
  rateLimitInfo?: Record<string, { limit: number; remaining: number; resetAt: string }>;
  lastSyncedAt?: string | null;
  error?: string;
};

const X_API_BASE = "https://api.x.com/2";
const X_UPLOAD_BASE = "https://upload.twitter.com/1.1";

// ------------------------------------------------------------------ PKCE Helpers

export function generatePKCE(): { codeVerifier: string; codeChallenge: string; state: string } {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const state = crypto.randomBytes(16).toString("hex");
  return { codeVerifier, codeChallenge, state };
}

export const generateOAuth2Pkce = generatePKCE;

export function buildOAuth2AuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: string[];
}): string {
  const defaultScopes = [
    "tweet.read",
    "tweet.write",
    "users.read",
    "offline.access",
  ];
  const scopes = args.scopes || defaultScopes;
  const url = new URL("https://twitter.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", args.state);
  url.searchParams.set("code_challenge", args.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeOAuth2Code(args: {
  clientId: string;
  clientSecret?: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: string;
  scope: string;
}> {
  const body = new URLSearchParams({
    code: args.code,
    grant_type: "authorization_code",
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    code_verifier: args.codeVerifier,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (args.clientSecret) {
    const creds = Buffer.from(`${args.clientId}:${args.clientSecret}`).toString("base64");
    headers["Authorization"] = `Basic ${creds}`;
  }

  const res = await fetchWithTimeout(
    `${X_API_BASE.replace("/2", "")}/2/oauth2/token`,
    {
      method: "POST",
      headers,
      body: body.toString(),
    },
    { timeoutMs: FETCH_TIMEOUT.api, label: "X OAuth2 Token Exchange" },
  );

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`X OAuth2 token exchange failed [${res.status}]: ${text.slice(0, 300)}`);
  }

  const data = JSON.parse(text);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in || 7200,
    tokenType: data.token_type || "bearer",
    scope: data.scope || "",
  };
}

export async function refreshOAuth2Token(args: {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
}): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}> {
  const body = new URLSearchParams({
    refresh_token: args.refreshToken,
    grant_type: "refresh_token",
    client_id: args.clientId,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (args.clientSecret) {
    const creds = Buffer.from(`${args.clientId}:${args.clientSecret}`).toString("base64");
    headers["Authorization"] = `Basic ${creds}`;
  }

  const res = await fetchWithTimeout(
    `${X_API_BASE.replace("/2", "")}/2/oauth2/token`,
    {
      method: "POST",
      headers,
      body: body.toString(),
    },
    { timeoutMs: FETCH_TIMEOUT.api, label: "X OAuth2 Token Refresh" },
  );

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`X OAuth2 token refresh failed [${res.status}]: ${text.slice(0, 300)}`);
  }

  const data = JSON.parse(text);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || args.refreshToken,
    expiresIn: data.expires_in || 7200,
  };
}

// ------------------------------------------------------------------ OAuth 1.0a Signature Helper

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function buildOAuth1Header(args: {
  method: string;
  url: string;
  apiKey: string;
  apiSecret: string;
  oauthToken: string;
  oauthTokenSecret: string;
  queryParams?: Record<string, string>;
}): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: args.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: args.oauthToken,
    oauth_version: "1.0",
  };

  const allParams: Record<string, string> = { ...oauthParams, ...(args.queryParams || {}) };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join("&");

  // Base URL without query params
  const baseUrl = args.url.split("?")[0];
  const signatureBase = `${args.method.toUpperCase()}&${percentEncode(baseUrl)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(args.apiSecret)}&${percentEncode(args.oauthTokenSecret)}`;

  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(signatureBase)
    .digest("base64");

  oauthParams["oauth_signature"] = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`);

  return `OAuth ${headerParts.join(", ")}`;
}

// ------------------------------------------------------------------ Connection Persistence

type RawXRow = {
  workspace_id: string;
  account_id: string;
  username: string;
  name: string;
  profile_image_url: string | null;
  access_token: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: string | null;
  api_key_enc: string | null;
  api_secret_enc: string | null;
  oauth_token_enc: string | null;
  oauth_token_secret_enc: string | null;
  bearer_token_enc: string | null;
  client_id_enc: string | null;
  client_secret_enc: string | null;
  auth_mode: string;
  status: string;
  rate_limit_info: Record<string, { limit: number; remaining: number; resetAt: string }> | null;
  last_synced_at: string | null;
};

export async function getXConnection(
  db: Client,
  workspaceId: string,
): Promise<{
  row: RawXRow | null;
  accessToken?: string;
  apiKey?: string;
  apiSecret?: string;
  oauthToken?: string;
  oauthTokenSecret?: string;
  bearerToken?: string;
  clientId?: string;
  clientSecret?: string;
}> {
  const { data } = await db
    .from("x_connection")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!data) return { row: null };

  const row = data as RawXRow;

  // Decrypt credentials
  const [
    accessToken,
    apiKey,
    apiSecret,
    oauthToken,
    oauthTokenSecret,
    bearerToken,
    clientId,
    clientSecret,
    refreshToken,
  ] = await Promise.all([
    row.access_token_enc ? decryptSecret(row.access_token_enc) : Promise.resolve(row.access_token || undefined),
    row.api_key_enc ? decryptSecret(row.api_key_enc) : Promise.resolve(undefined),
    row.api_secret_enc ? decryptSecret(row.api_secret_enc) : Promise.resolve(undefined),
    row.oauth_token_enc ? decryptSecret(row.oauth_token_enc) : Promise.resolve(undefined),
    row.oauth_token_secret_enc ? decryptSecret(row.oauth_token_secret_enc) : Promise.resolve(undefined),
    row.bearer_token_enc ? decryptSecret(row.bearer_token_enc) : Promise.resolve(undefined),
    row.client_id_enc ? decryptSecret(row.client_id_enc) : Promise.resolve(undefined),
    row.client_secret_enc ? decryptSecret(row.client_secret_enc) : Promise.resolve(undefined),
    row.refresh_token_enc ? decryptSecret(row.refresh_token_enc) : Promise.resolve(undefined),
  ]);

  // Check if OAuth 2.0 token expired and refresh if possible
  if (
    row.auth_mode === "oauth2" &&
    row.expires_at &&
    new Date(row.expires_at).getTime() < Date.now() + 60000 &&
    refreshToken &&
    clientId
  ) {
    try {
      const refreshed = await refreshOAuth2Token({
        clientId,
        clientSecret: clientSecret ?? undefined,
        refreshToken,
      });

      const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
      const encAccess = await encryptSecret(refreshed.accessToken);
      const encRefresh = refreshed.refreshToken ? await encryptSecret(refreshed.refreshToken) : row.refresh_token_enc;

      await db
        .from("x_connection")
        .update({
          access_token: refreshed.accessToken,
          access_token_enc: encAccess,
          refresh_token_enc: encRefresh,
          expires_at: newExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", workspaceId);

      return {
        row: { ...row, expires_at: newExpiresAt },
        accessToken: refreshed.accessToken,
        clientId,
        clientSecret: clientSecret ?? undefined,
      };
    } catch (err) {
      console.warn("[x-connection] token refresh failed", err);
    }
  }

  return {
    row,
    accessToken: accessToken || undefined,
    apiKey: apiKey || undefined,
    apiSecret: apiSecret || undefined,
    oauthToken: oauthToken || undefined,
    oauthTokenSecret: oauthTokenSecret || undefined,
    bearerToken: bearerToken || undefined,
    clientId: clientId || undefined,
    clientSecret: clientSecret || undefined,
  };
}

export async function saveXCredentials(
  db: Client,
  workspaceId: string,
  creds: XCredentialsInput,
): Promise<XConnectionStatus> {
  let userProfile: { id: string; username: string; name: string; profile_image_url?: string } | null = null;

  // Validate the credentials by fetching current user info
  if (creds.authMode === "api_keys" && creds.apiKey && creds.apiSecret && creds.oauthToken && creds.oauthTokenSecret) {
    const authHeader = buildOAuth1Header({
      method: "GET",
      url: `${X_API_BASE}/users/me`,
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      oauthToken: creds.oauthToken,
      oauthTokenSecret: creds.oauthTokenSecret,
    });

    const res = await fetchWithTimeout(
      `${X_API_BASE}/users/me?user.fields=profile_image_url`,
      { headers: { Authorization: authHeader } },
      { timeoutMs: FETCH_TIMEOUT.api, label: "Verify X OAuth1 Credentials" },
    );

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`X API verification failed [${res.status}]: ${txt.slice(0, 300)}`);
    }

    const json = await res.json();
    userProfile = json.data;
  } else if (creds.accessToken) {
    const res = await fetchWithTimeout(
      `${X_API_BASE}/users/me?user.fields=profile_image_url`,
      { headers: { Authorization: `Bearer ${creds.accessToken}` } },
      { timeoutMs: FETCH_TIMEOUT.api, label: "Verify X Bearer/OAuth2 Token" },
    );

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`X API verification failed [${res.status}]: ${txt.slice(0, 300)}`);
    }

    const json = await res.json();
    userProfile = json.data;
  } else {
    throw new Error("Missing required credentials for X connection.");
  }

  if (!userProfile) throw new Error("Could not retrieve X user profile.");

  // Encrypt secrets for storage
  const [
    encAccess,
    encRefresh,
    encApiKey,
    encApiSecret,
    encOAuthToken,
    encOAuthTokenSecret,
    encBearer,
    encClientId,
    encClientSecret,
  ] = await Promise.all([
    creds.accessToken ? encryptSecret(creds.accessToken) : Promise.resolve(null),
    creds.refreshToken ? encryptSecret(creds.refreshToken) : Promise.resolve(null),
    creds.apiKey ? encryptSecret(creds.apiKey) : Promise.resolve(null),
    creds.apiSecret ? encryptSecret(creds.apiSecret) : Promise.resolve(null),
    creds.oauthToken ? encryptSecret(creds.oauthToken) : Promise.resolve(null),
    creds.oauthTokenSecret ? encryptSecret(creds.oauthTokenSecret) : Promise.resolve(null),
    creds.bearerToken ? encryptSecret(creds.bearerToken) : Promise.resolve(null),
    creds.clientId ? encryptSecret(creds.clientId) : Promise.resolve(null),
    creds.clientSecret ? encryptSecret(creds.clientSecret) : Promise.resolve(null),
  ]);

  const expiresAt = creds.expiresInSec
    ? new Date(Date.now() + creds.expiresInSec * 1000).toISOString()
    : null;

  const row = {
    workspace_id: workspaceId,
    account_id: userProfile.id,
    username: userProfile.username,
    name: userProfile.name,
    profile_image_url: userProfile.profile_image_url || null,
    access_token: creds.accessToken || "",
    access_token_enc: encAccess,
    refresh_token_enc: encRefresh,
    expires_at: expiresAt,
    api_key_enc: encApiKey,
    api_secret_enc: encApiSecret,
    oauth_token_enc: encOAuthToken,
    oauth_token_secret_enc: encOAuthTokenSecret,
    bearer_token_enc: encBearer,
    client_id_enc: encClientId,
    client_secret_enc: encClientSecret,
    auth_mode: creds.authMode,
    status: "connected",
    scope: creds.scope || "",
    updated_at: new Date().toISOString(),
  };

  await db.from("x_connection").upsert(row, { onConflict: "workspace_id" });

  // Sync entry to engagement_accounts so Engagement Inbox knows about this account
  await db.from("engagement_accounts").upsert(
    {
      workspace_id: workspaceId,
      provider: "x",
      external_account_id: userProfile.id,
      network: "x",
      name: `@${userProfile.username}`,
      status: "ok",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,provider,external_account_id" },
  );

  await logActivity({
    workspaceId,
    actorType: "user",
    action: "x.connected",
    summary: `Connected X account @${userProfile.username}`,
    details: { accountId: userProfile.id, username: userProfile.username, authMode: creds.authMode },
  }, db);

  return {
    connected: true,
    authMode: creds.authMode,
    username: userProfile.username,
    name: userProfile.name,
    accountId: userProfile.id,
    profileImageUrl: userProfile.profile_image_url,
    status: "connected",
  };
}

export async function disconnectX(db: Client, workspaceId: string): Promise<{ ok: boolean }> {
  await db.from("x_connection").delete().eq("workspace_id", workspaceId);
  await db.from("engagement_accounts").delete().eq("workspace_id", workspaceId).eq("provider", "x");

  await logActivity({
    workspaceId,
    actorType: "user",
    action: "x.disconnected",
    summary: "Disconnected X account",
  }, db);

  return { ok: true };
}

export async function getXStatus(db: Client, workspaceId: string): Promise<XConnectionStatus> {
  const { row } = await getXConnection(db, workspaceId);
  if (!row) return { connected: false, status: "disconnected" };

  return {
    connected: row.status === "connected",
    authMode: row.auth_mode as XAuthMode,
    username: row.username,
    name: row.name,
    accountId: row.account_id,
    profileImageUrl: row.profile_image_url ?? undefined,
    status: row.status,
    rateLimitInfo: row.rate_limit_info ?? undefined,
    lastSyncedAt: row.last_synced_at,
  };
}

// ------------------------------------------------------------------ Media Upload

async function uploadMediaToX(
  connection: Awaited<ReturnType<typeof getXConnection>>,
  mediaData: { bytes: Uint8Array; mimeType: string },
): Promise<string> {
  const { apiKey, apiSecret, oauthToken, oauthTokenSecret, accessToken } = connection;

  const url = `${X_UPLOAD_BASE}/media/upload.json`;
  const base64Content = Buffer.from(mediaData.bytes).toString("base64");

  // If OAuth 1.0a is available, use standard media/upload
  if (apiKey && apiSecret && oauthToken && oauthTokenSecret) {
    const queryParams: Record<string, string> = {};
    const authHeader = buildOAuth1Header({
      method: "POST",
      url,
      apiKey,
      apiSecret,
      oauthToken,
      oauthTokenSecret,
    });

    const form = new URLSearchParams();
    form.append("media_data", base64Content);

    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
      { timeoutMs: FETCH_TIMEOUT.download, label: "X Media Upload (OAuth 1.0a)" },
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`X Media Upload failed [${res.status}]: ${err.slice(0, 300)}`);
    }

    const data = await res.json();
    return String(data.media_id_string || data.media_id);
  }

  // Fallback: If only OAuth 2.0 Bearer token is available
  if (accessToken) {
    const form = new URLSearchParams();
    form.append("media_data", base64Content);

    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
      { timeoutMs: FETCH_TIMEOUT.download, label: "X Media Upload (OAuth 2.0)" },
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`X Media Upload (OAuth 2.0) failed [${res.status}]: ${err.slice(0, 300)}`);
    }

    const data = await res.json();
    return String(data.media_id_string || data.media_id);
  }

  throw new Error("No usable X credentials available to upload media.");
}

async function resolveMediaBytes(mediaUrl: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (mediaUrl.startsWith("data:")) {
    const m = /^data:([^;,]+);base64,(.+)$/.exec(mediaUrl);
    if (!m) throw new Error("Invalid base64 data URL");
    return {
      mimeType: m[1],
      bytes: Buffer.from(m[2], "base64"),
    };
  }

  const res = await fetchWithTimeout(mediaUrl, {}, { timeoutMs: FETCH_TIMEOUT.api, label: "Fetch media" });
  if (!res.ok) throw new Error(`Could not fetch media from ${mediaUrl}: ${res.status}`);
  const ab = await res.arrayBuffer();
  const mimeType = res.headers.get("content-type") || "image/png";
  return { bytes: new Uint8Array(ab), mimeType };
}

// ------------------------------------------------------------------ Rate Limits & Headers

function parseRateLimitHeaders(res: Response): { limit: number; remaining: number; resetAt: string } | null {
  const limitStr = res.headers.get("x-rate-limit-limit");
  const remainingStr = res.headers.get("x-rate-limit-remaining");
  const resetStr = res.headers.get("x-rate-limit-reset");

  if (!limitStr || !remainingStr || !resetStr) return null;

  const limit = parseInt(limitStr, 10);
  const remaining = parseInt(remainingStr, 10);
  const resetEpoch = parseInt(resetStr, 10);
  const resetAt = new Date(resetEpoch * 1000).toISOString();

  return { limit, remaining, resetAt };
}

// ------------------------------------------------------------------ X API Core Operations

export type PublishTweetArgs = {
  text: string;
  mediaUrls?: string[];
  inReplyToTweetId?: string;
  quoteTweetId?: string;
};

export type PublishTweetResult = {
  ok: boolean;
  tweetId?: string;
  url?: string;
  text?: string;
  rateLimit?: { limit: number; remaining: number; resetAt: string };
  error?: string;
};

export async function publishTweet(
  db: Client,
  workspaceId: string,
  args: PublishTweetArgs,
): Promise<PublishTweetResult> {
  const conn = await getXConnection(db, workspaceId);
  if (!conn.row) {
    return { ok: false, error: "X is not connected for this workspace. Connect X in Settings → Connections." };
  }

  // 1. Text length validation according to X character limits (280 max)
  const trimmed = args.text.trim();
  if (!trimmed && (!args.mediaUrls || args.mediaUrls.length === 0)) {
    return { ok: false, error: "Tweet text or media is required." };
  }

  // URLs count as 23 characters on X (t.co)
  const normalizedLength = trimmed.replace(/https?:\/\/\S+/g, "12345678901234567890123").length;
  if (normalizedLength > 280) {
    return {
      ok: false,
      error: `Tweet exceeds X's 280-character limit (current length: ${normalizedLength}). Please shorten it.`,
    };
  }

  // 2. Upload media if provided
  const mediaIds: string[] = [];
  if (args.mediaUrls && args.mediaUrls.length > 0) {
    for (const mUrl of args.mediaUrls.slice(0, 4)) {
      try {
        const resolved = await resolveMediaBytes(mUrl);
        const mediaId = await uploadMediaToX(conn, resolved);
        mediaIds.push(mediaId);
      } catch (err) {
        console.warn("[x-publish] media upload failed", err);
        return {
          ok: false,
          error: `Failed to upload media to X: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  }

  // 3. Construct payload for POST /2/tweets
  const payload: Record<string, unknown> = { text: trimmed };
  if (mediaIds.length > 0) {
    payload.media = { media_ids: mediaIds };
  }
  if (args.inReplyToTweetId) {
    payload.reply = { in_reply_to_tweet_id: args.inReplyToTweetId };
  }
  if (args.quoteTweetId) {
    payload.quote_tweet_id = args.quoteTweetId;
  }

  // 4. Send request with retry handling for transient errors (5xx / 429)
  const postUrl = `${X_API_BASE}/tweets`;
  let res: Response | null = null;
  let lastErr = "";

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let authHeader = "";
      if (conn.row.auth_mode === "api_keys" && conn.apiKey && conn.apiSecret && conn.oauthToken && conn.oauthTokenSecret) {
        authHeader = buildOAuth1Header({
          method: "POST",
          url: postUrl,
          apiKey: conn.apiKey,
          apiSecret: conn.apiSecret,
          oauthToken: conn.oauthToken,
          oauthTokenSecret: conn.oauthTokenSecret,
        });
      } else if (conn.accessToken) {
        authHeader = `Bearer ${conn.accessToken}`;
      } else {
        throw new Error("Missing auth credentials for X API call.");
      }

      res = await fetchWithTimeout(
        postUrl,
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
        { timeoutMs: FETCH_TIMEOUT.api, label: "X POST /2/tweets" },
      );

      // Handle Rate Limit (429)
      if (res.status === 429) {
        const rateInfo = parseRateLimitHeaders(res);
        if (rateInfo) {
          await db
            .from("x_connection")
            .update({
              rate_limit_info: { ...(conn.row.rate_limit_info || {}), tweets: rateInfo },
            })
            .eq("workspace_id", workspaceId);
        }
        const retryAfter = res.headers.get("retry-after");
        if (retryAfter && parseInt(retryAfter, 10) <= 5 && attempt < 2) {
          await new Promise((r) => setTimeout(r, (parseInt(retryAfter, 10) + 1) * 1000));
          continue;
        }
        return {
          ok: false,
          error: `X rate limit reached. Resets at ${rateInfo?.resetAt || "a few minutes"}.`,
          rateLimit: rateInfo || undefined,
        };
      }

      if (res.ok) break;

      // 5xx transient server errors retry with exponential backoff
      if (res.status >= 500 && attempt < 2) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 1500));
        continue;
      }

      const bodyText = await res.text();
      lastErr = `X API error [${res.status}]: ${bodyText.slice(0, 300)}`;
      break;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
    }
  }

  if (!res || !res.ok) {
    return { ok: false, error: lastErr || "Failed to publish tweet to X." };
  }

  const rateLimit = parseRateLimitHeaders(res) || undefined;
  const json = await res.json();
  const tweetId = String(json.data?.id);
  const username = conn.row.username;
  const tweetUrl = `https://x.com/${username}/status/${tweetId}`;

  // Log successful activity
  await logActivity({
    workspaceId,
    actorType: "agent",
    action: "x.tweet_published",
    summary: `Published post to X: "${trimmed.slice(0, 80)}"`,
    details: { tweetId, tweetUrl, inReplyTo: args.inReplyToTweetId, hasMedia: mediaIds.length > 0 },
  }, db);

  return {
    ok: true,
    tweetId,
    url: tweetUrl,
    text: trimmed,
    rateLimit,
  };
}

export async function deleteTweet(
  db: Client,
  workspaceId: string,
  tweetId: string,
): Promise<{ ok: boolean; error?: string }> {
  const conn = await getXConnection(db, workspaceId);
  if (!conn.row) return { ok: false, error: "X is not connected." };

  const url = `${X_API_BASE}/tweets/${tweetId}`;

  let authHeader = "";
  if (conn.row.auth_mode === "api_keys" && conn.apiKey && conn.apiSecret && conn.oauthToken && conn.oauthTokenSecret) {
    authHeader = buildOAuth1Header({
      method: "DELETE",
      url,
      apiKey: conn.apiKey,
      apiSecret: conn.apiSecret,
      oauthToken: conn.oauthToken,
      oauthTokenSecret: conn.oauthTokenSecret,
    });
  } else if (conn.accessToken) {
    authHeader = `Bearer ${conn.accessToken}`;
  }

  const res = await fetchWithTimeout(
    url,
    { method: "DELETE", headers: { Authorization: authHeader } },
    { timeoutMs: FETCH_TIMEOUT.api, label: "X DELETE /2/tweets/:id" },
  );

  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, error: `Failed to delete tweet [${res.status}]: ${txt.slice(0, 200)}` };
  }

  await logActivity({
    workspaceId,
    actorType: "agent",
    action: "x.tweet_deleted",
    summary: `Deleted tweet ${tweetId} from X`,
    details: { tweetId },
  }, db);

  return { ok: true };
}

export async function likeTweet(
  db: Client,
  workspaceId: string,
  tweetId: string,
): Promise<{ ok: boolean; error?: string }> {
  const conn = await getXConnection(db, workspaceId);
  if (!conn.row) return { ok: false, error: "X is not connected." };

  const userId = conn.row.account_id;
  const url = `${X_API_BASE}/users/${userId}/likes`;

  let authHeader = "";
  if (conn.row.auth_mode === "api_keys" && conn.apiKey && conn.apiSecret && conn.oauthToken && conn.oauthTokenSecret) {
    authHeader = buildOAuth1Header({
      method: "POST",
      url,
      apiKey: conn.apiKey,
      apiSecret: conn.apiSecret,
      oauthToken: conn.oauthToken,
      oauthTokenSecret: conn.oauthTokenSecret,
    });
  } else if (conn.accessToken) {
    authHeader = `Bearer ${conn.accessToken}`;
  }

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tweet_id: tweetId }),
    },
    { timeoutMs: FETCH_TIMEOUT.api, label: "X POST /2/users/:id/likes" },
  );

  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, error: `Failed to like tweet [${res.status}]: ${txt.slice(0, 200)}` };
  }

  return { ok: true };
}

export async function getTweet(
  db: Client,
  workspaceId: string,
  tweetId: string,
): Promise<{ ok: boolean; tweet?: Record<string, unknown>; error?: string }> {
  const conn = await getXConnection(db, workspaceId);
  if (!conn.row) return { ok: false, error: "X is not connected." };

  const url = `${X_API_BASE}/tweets/${tweetId}?tweet.fields=created_at,public_metrics,author_id,conversation_id&expansions=author_id&user.fields=name,username,profile_image_url`;

  let authHeader = "";
  if (conn.row.auth_mode === "api_keys" && conn.apiKey && conn.apiSecret && conn.oauthToken && conn.oauthTokenSecret) {
    authHeader = buildOAuth1Header({
      method: "GET",
      url,
      apiKey: conn.apiKey,
      apiSecret: conn.apiSecret,
      oauthToken: conn.oauthToken,
      oauthTokenSecret: conn.oauthTokenSecret,
    });
  } else if (conn.accessToken) {
    authHeader = `Bearer ${conn.accessToken}`;
  } else if (conn.bearerToken) {
    authHeader = `Bearer ${conn.bearerToken}`;
  }

  const res = await fetchWithTimeout(
    url,
    { headers: { Authorization: authHeader } },
    { timeoutMs: FETCH_TIMEOUT.api, label: "X GET /2/tweets/:id" },
  );

  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, error: `Failed to fetch tweet [${res.status}]: ${txt.slice(0, 200)}` };
  }

  const json = await res.json();
  return { ok: true, tweet: json.data };
}

export async function getUserTweets(
  db: Client,
  workspaceId: string,
  options: { limit?: number; sinceId?: string } = {},
): Promise<{ ok: boolean; tweets?: Array<Record<string, unknown>>; error?: string }> {
  const conn = await getXConnection(db, workspaceId);
  if (!conn.row) return { ok: false, error: "X is not connected." };

  const userId = conn.row.account_id;
  const limit = Math.max(5, Math.min(options.limit || 10, 50));
  const url = new URL(`${X_API_BASE}/users/${userId}/tweets`);
  url.searchParams.set("max_results", String(limit));
  url.searchParams.set("tweet.fields", "created_at,public_metrics,conversation_id");
  if (options.sinceId) url.searchParams.set("since_id", options.sinceId);

  let authHeader = "";
  if (conn.row.auth_mode === "api_keys" && conn.apiKey && conn.apiSecret && conn.oauthToken && conn.oauthTokenSecret) {
    authHeader = buildOAuth1Header({
      method: "GET",
      url: url.toString(),
      apiKey: conn.apiKey,
      apiSecret: conn.apiSecret,
      oauthToken: conn.oauthToken,
      oauthTokenSecret: conn.oauthTokenSecret,
    });
  } else if (conn.accessToken) {
    authHeader = `Bearer ${conn.accessToken}`;
  }

  const res = await fetchWithTimeout(
    url.toString(),
    { headers: { Authorization: authHeader } },
    { timeoutMs: FETCH_TIMEOUT.api, label: "X GET /2/users/:id/tweets" },
  );

  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, error: `Failed to fetch user tweets [${res.status}]: ${txt.slice(0, 200)}` };
  }

  const json = await res.json();
  return { ok: true, tweets: json.data || [] };
}

export async function getUserMentions(
  db: Client,
  workspaceId: string,
  options: { limit?: number; sinceId?: string } = {},
): Promise<{ ok: boolean; mentions?: Array<Record<string, unknown>>; error?: string }> {
  const conn = await getXConnection(db, workspaceId);
  if (!conn.row) return { ok: false, error: "X is not connected." };

  const userId = conn.row.account_id;
  const limit = Math.max(5, Math.min(options.limit || 10, 50));
  const url = new URL(`${X_API_BASE}/users/${userId}/mentions`);
  url.searchParams.set("max_results", String(limit));
  url.searchParams.set("tweet.fields", "created_at,author_id,conversation_id,in_reply_to_user_id");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "name,username,profile_image_url");
  if (options.sinceId) url.searchParams.set("since_id", options.sinceId);

  let authHeader = "";
  if (conn.row.auth_mode === "api_keys" && conn.apiKey && conn.apiSecret && conn.oauthToken && conn.oauthTokenSecret) {
    authHeader = buildOAuth1Header({
      method: "GET",
      url: url.toString(),
      apiKey: conn.apiKey,
      apiSecret: conn.apiSecret,
      oauthToken: conn.oauthToken,
      oauthTokenSecret: conn.oauthTokenSecret,
    });
  } else if (conn.accessToken) {
    authHeader = `Bearer ${conn.accessToken}`;
  }

  const res = await fetchWithTimeout(
    url.toString(),
    { headers: { Authorization: authHeader } },
    { timeoutMs: FETCH_TIMEOUT.api, label: "X GET /2/users/:id/mentions" },
  );

  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, error: `Failed to fetch X mentions [${res.status}]: ${txt.slice(0, 200)}` };
  }

  const json = await res.json();
  const tweets = json.data || [];
  const users = (json.includes?.users || []) as Array<{ id: string; name: string; username: string; profile_image_url?: string }>;
  const userMap = new Map(users.map((u) => [u.id, u]));

  const enriched = tweets.map((t: any) => {
    const author = userMap.get(t.author_id);
    return {
      ...t,
      author_name: author?.name || "X User",
      author_handle: author?.username || "",
      author_avatar_url: author?.profile_image_url,
      permalink: `https://x.com/${author?.username || "i"}/status/${t.id}`,
    };
  });

  return { ok: true, mentions: enriched };
}

// ------------------------------------------------------------------ Ingest X Mentions into Engagement Inbox

export async function syncXMentionsToEngagement(
  db: Client,
  workspaceId: string,
): Promise<{ ingested: number }> {
  const result = await getUserMentions(db, workspaceId, { limit: 20 });
  if (!result.ok || !result.mentions) return { ingested: 0 };

  let ingested = 0;
  for (const m of result.mentions) {
    const externalId = `tweet:${m.id}`;
    const { data: existing } = await db
      .from("engagement_items")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("provider", "x")
      .eq("external_id", externalId)
      .maybeSingle();

    if (existing) continue;

    const { error } = await db.from("engagement_items").insert({
      workspace_id: workspaceId,
      provider: "x",
      external_account_id: (m as any).in_reply_to_user_id || "",
      network: "x",
      kind: (m as any).in_reply_to_user_id ? "comment" : "mention",
      external_id: externalId,
      thread_id: (m as any).conversation_id || null,
      post_id: (m as any).in_reply_to_user_id ? String((m as any).conversation_id || m.id) : null,
      permalink: (m as any).permalink || `https://x.com/i/status/${m.id}`,
      author_name: (m as any).author_name || "X User",
      author_handle: (m as any).author_handle || null,
      author_url: (m as any).author_handle ? `https://x.com/${(m as any).author_handle}` : null,
      author_avatar_url: (m as any).author_avatar_url || null,
      text: (m as any).text || "",
      occurred_at: (m as any).created_at || new Date().toISOString(),
      status: "new",
      raw: m,
    });

    if (!error) ingested++;
  }

  if (ingested > 0) {
    await db
      .from("x_connection")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId);
  }

  return { ingested };
}
