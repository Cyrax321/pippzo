import crypto from "node:crypto";
import {
  generatePKCE as generateOAuth2Pkce,
  buildOAuth2AuthorizeUrl,
  exchangeOAuth2Code,
  saveXCredentials,
} from "./x/x.server";
import { fetchWithTimeout, FETCH_TIMEOUT } from "./fetch-timeout";
import { bufferSaveToken } from "./buffer.functions";

type OAuthStateEntry = {
  provider: "x" | "buffer";
  workspaceId: string;
  origin: string;
  codeVerifier?: string;
  clientId?: string;
  clientSecret?: string;
  createdAt: number;
};

// In-memory state store with 15-minute TTL
const stateStore = new Map<string, OAuthStateEntry>();

function cleanExpiredStates() {
  const now = Date.now();
  for (const [k, v] of stateStore.entries()) {
    if (now - v.createdAt > 15 * 60 * 1000) {
      stateStore.delete(k);
    }
  }
}

// -----------------------------------------------------------------------------
// X (Twitter) OAuth 2.0 PKCE Flow
// -----------------------------------------------------------------------------

export async function initiateXOAuth(args: {
  workspaceId: string;
  origin: string;
  clientId?: string;
  clientSecret?: string;
}): Promise<{ authorizeUrl: string }> {
  cleanExpiredStates();

  const clientId =
    args.clientId?.trim() ||
    process.env.X_CLIENT_ID?.trim() ||
    process.env.TWITTER_CLIENT_ID?.trim();

  if (!clientId) {
    throw new Error(
      "X Client ID is required. Please provide your Twitter App Client ID (OAuth 2.0) from developer.x.com.",
    );
  }

  const { codeVerifier, codeChallenge, state } = generateOAuth2Pkce();
  const redirectUri = `${args.origin}/api/oauth/x/callback`;

  stateStore.set(state, {
    provider: "x",
    workspaceId: args.workspaceId,
    origin: args.origin,
    codeVerifier,
    clientId,
    clientSecret: args.clientSecret?.trim(),
    createdAt: Date.now(),
  });

  const authorizeUrl = buildOAuth2AuthorizeUrl({
    clientId,
    redirectUri,
    state,
    codeChallenge,
    scopes: [
      "tweet.read",
      "tweet.write",
      "users.read",
      "offline.access",
    ],
  });

  return { authorizeUrl };
}

export async function handleXOAuthCallback(args: {
  code: string;
  state: string;
}): Promise<{ redirectUrl: string }> {
  cleanExpiredStates();

  const entry = stateStore.get(args.state);
  if (!entry || entry.provider !== "x") {
    throw new Error("Invalid or expired OAuth state session. Please try logging in again.");
  }
  stateStore.delete(args.state);

  const redirectUri = `${entry.origin}/api/oauth/x/callback`;

  const tokens = await exchangeOAuth2Code({
    clientId: entry.clientId!,
    clientSecret: entry.clientSecret,
    code: args.code,
    redirectUri,
    codeVerifier: entry.codeVerifier!,
  });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  await saveXCredentials(supabaseAdmin, entry.workspaceId, {
    authMode: "oauth2",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresInSec: tokens.expiresIn,
    clientId: entry.clientId,
    clientSecret: entry.clientSecret,
  });

  return { redirectUrl: `${entry.origin}/conexiones?success=x_connected` };
}

// -----------------------------------------------------------------------------
// Buffer OAuth 2.0 Flow
// -----------------------------------------------------------------------------

export async function initiateBufferOAuth(args: {
  workspaceId: string;
  origin: string;
  clientId?: string;
  clientSecret?: string;
}): Promise<{ authorizeUrl: string }> {
  cleanExpiredStates();

  const clientId =
    args.clientId?.trim() ||
    process.env.BUFFER_CLIENT_ID?.trim();

  if (!clientId) {
    throw new Error(
      "Buffer Client ID is required. Please provide your Buffer App Client ID from buffer.com/manage/apps.",
    );
  }

  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${args.origin}/api/oauth/buffer/callback`;

  stateStore.set(state, {
    provider: "buffer",
    workspaceId: args.workspaceId,
    origin: args.origin,
    clientId,
    clientSecret: args.clientSecret?.trim() || process.env.BUFFER_CLIENT_SECRET?.trim(),
    createdAt: Date.now(),
  });

  const url = new URL("https://buffer.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);

  return { authorizeUrl: url.toString() };
}

export async function handleBufferOAuthCallback(args: {
  code: string;
  state: string;
}): Promise<{ redirectUrl: string }> {
  cleanExpiredStates();

  const entry = stateStore.get(args.state);
  if (!entry || entry.provider !== "buffer") {
    throw new Error("Invalid or expired OAuth state session. Please try logging in again.");
  }
  stateStore.delete(args.state);

  const redirectUri = `${entry.origin}/api/oauth/buffer/callback`;

  const body = new URLSearchParams({
    client_id: entry.clientId!,
    client_secret: entry.clientSecret || "",
    redirect_uri: redirectUri,
    code: args.code,
    grant_type: "authorization_code",
  });

  const tokenRes = await fetchWithTimeout(
    "https://api.bufferapp.com/1/oauth2/token.json",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    { timeoutMs: FETCH_TIMEOUT.api, label: "Buffer OAuth Token Exchange" },
  );

  const data = (await tokenRes.json()) as { access_token?: string; message?: string };
  if (!tokenRes.ok || !data.access_token) {
    throw new Error(data.message || `Buffer token exchange failed with HTTP ${tokenRes.status}`);
  }

  // Save token for the workspace
  await bufferSaveToken({
    data: { workspaceId: entry.workspaceId, accessToken: data.access_token },
  } as never);

  return { redirectUrl: `${entry.origin}/conexiones?success=buffer_connected` };
}
