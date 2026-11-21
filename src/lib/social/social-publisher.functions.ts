// TanStack Start Server Functions for Multi-Platform Social Publishing & Scheduling
// Supports standard social networks + unlimited custom API key providers & webhooks

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getSocialAccountsStatus,
  publishNowToAllPlatforms,
  scheduleToAllPlatforms,
  saveCustomSocialProvider,
  deleteCustomSocialProvider,
  saveDirectSocialToken,
  disconnectDirectSocial,
} from "./social-publisher.server";
import type {
  SocialStatusMap,
  MultiPlatformPublishResult,
  SocialPlatformKey,
} from "./social-types";

// 1. Get status of all connected social accounts (standard + custom)
export const getSocialAccountsStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<SocialStatusMap> => {
    return getSocialAccountsStatus(context.supabase as any, data.workspaceId);
  });

// 2. Publish now to all selected platforms simultaneously
export const publishNowMultiPlatformFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        platforms: z.array(z.string()).min(1),
        text: z.string().min(1),
        imageDataUrl: z.string().optional(),
        videoUrl: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<MultiPlatformPublishResult> => {
    return publishNowToAllPlatforms(context.supabase as any, data.workspaceId, {
      platforms: data.platforms as SocialPlatformKey[],
      text: data.text,
      imageUrl: data.imageDataUrl,
      videoUrl: data.videoUrl,
    });
  });

// 3. Schedule to all selected platforms
export const scheduleMultiPlatformFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        platforms: z.array(z.string()).min(1),
        text: z.string().min(1),
        scheduledAtISO: z.string().min(1),
        imageDataUrl: z.string().optional(),
        videoUrl: z.string().optional(),
        note: z.string().optional(),
      })
      .parse(d),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: boolean; scheduledCount: number; errors: string[] }> => {
      return scheduleToAllPlatforms(context.supabase as any, data.workspaceId, {
        platforms: data.platforms as SocialPlatformKey[],
        text: data.text,
        scheduledAtISO: data.scheduledAtISO,
        imageUrl: data.imageDataUrl,
        videoUrl: data.videoUrl,
        note: data.note,
      });
    },
  );

// 4. Save Custom API Key Provider or Webhook
export const saveCustomSocialProviderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        key: z.string().min(1).max(100),
        label: z.string().min(1).max(100),
        apiKey: z.string().min(1),
        baseUrl: z.string().optional(),
        charLimit: z.number().int().positive().optional(),
        icon: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    return saveCustomSocialProvider(context.supabase as any, data.workspaceId, data);
  });

// 5. Delete Custom API Key Provider
export const deleteCustomSocialProviderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        key: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    return deleteCustomSocialProvider(context.supabase as any, data.workspaceId, data.key);
  });

// 6. Save direct token credential (LinkedIn, Facebook, Instagram)
export const saveDirectSocialTokenFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        service: z.string().min(1),
        token: z.string().min(1),
        label: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    return saveDirectSocialToken(context.supabase as any, data.workspaceId, {
      service: data.service,
      token: data.token,
      label: data.label,
    });
  });

// 7. Disconnect direct social credential
export const disconnectDirectSocialFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        service: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    return disconnectDirectSocial(context.supabase as any, data.workspaceId, data.service);
  });
