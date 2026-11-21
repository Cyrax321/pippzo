import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getXStatus,
  saveXCredentials,
  disconnectX,
  buildOAuth2AuthorizeUrl,
  generatePKCE,
  exchangeOAuth2Code,
  publishTweet,
  syncXMentionsToEngagement,
  type XConnectionStatus,
} from "./x.server";

export const getXStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<XConnectionStatus> => {
    return getXStatus(context.supabase as any, data.workspaceId);
  });

export const saveXCredentialsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        authMode: z.enum(["oauth2", "api_keys"]),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional(),
        oauthToken: z.string().optional(),
        oauthTokenSecret: z.string().optional(),
        accessToken: z.string().optional(),
        refreshToken: z.string().optional(),
        clientId: z.string().optional(),
        clientSecret: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<XConnectionStatus> => {
    return saveXCredentials(context.supabase as any, data.workspaceId, data);
  });

export const disconnectXFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    return disconnectX(context.supabase as any, data.workspaceId);
  });

export const startXOAuth2Fn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        clientId: z.string().min(1),
        redirectUri: z.string().url(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ url: string; codeVerifier: string; state: string }> => {
    const { codeVerifier, codeChallenge, state } = generatePKCE();
    const url = buildOAuth2AuthorizeUrl({
      clientId: data.clientId,
      redirectUri: data.redirectUri,
      state,
      codeChallenge,
    });
    return { url, codeVerifier, state };
  });

export const completeXOAuth2Fn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        clientId: z.string().min(1),
        clientSecret: z.string().optional(),
        code: z.string().min(1),
        redirectUri: z.string().url(),
        codeVerifier: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<XConnectionStatus> => {
    const tokens = await exchangeOAuth2Code({
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      code: data.code,
      redirectUri: data.redirectUri,
      codeVerifier: data.codeVerifier,
    });

    return saveXCredentials(context.supabase as any, data.workspaceId, {
      authMode: "oauth2",
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSec: tokens.expiresIn,
      scope: tokens.scope,
    });
  });

export const postTweetFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        text: z.string().min(1),
        mediaUrls: z.array(z.string()).optional(),
        inReplyToTweetId: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    return publishTweet(context.supabase as any, data.workspaceId, {
      text: data.text,
      mediaUrls: data.mediaUrls,
      inReplyToTweetId: data.inReplyToTweetId,
    });
  });

export const syncXMentionsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ingested: number }> => {
    return syncXMentionsToEngagement(context.supabase as any, data.workspaceId);
  });
