import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const startSocialLoginFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: unknown) =>
      z
        .object({
          workspaceId: z.string().uuid(),
          platform: z.enum([
            "x",
            "twitter",
            "buffer",
            "linkedin",
            "instagram",
            "whatsapp",
            "threads",
            "all",
          ]),
          origin: z.string().url(),
          clientId: z.string().optional(),
          clientSecret: z.string().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }): Promise<{ url: string; mode: "redirect" | "popup" }> => {
    if (data.platform === "x" || data.platform === "twitter") {
      const { initiateXOAuth } = await import("./oauth-flow.server");
      const { authorizeUrl } = await initiateXOAuth({
        workspaceId: data.workspaceId,
        origin: data.origin,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
      });
      return { url: authorizeUrl, mode: "redirect" };
    }

    if (data.platform === "buffer") {
      const { initiateBufferOAuth } = await import("./oauth-flow.server");
      const { authorizeUrl } = await initiateBufferOAuth({
        workspaceId: data.workspaceId,
        origin: data.origin,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
      });
      return { url: authorizeUrl, mode: "redirect" };
    }

    // Hosted account login via Unipile (LinkedIn, Instagram, WhatsApp, Threads)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requireUnipileCreds, createHostedAuthLink } = await import(
      "./engagement/unipile.server"
    );

    let creds;
    try {
      creds = await requireUnipileCreds(supabaseAdmin, data.workspaceId);
    } catch {
      throw new Error(
        "To enable 1-click hosted login for LinkedIn, Instagram & WhatsApp, please connect your Unipile DSN & API Key once below.",
      );
    }

    const providerMap: Record<string, string[]> = {
      linkedin: ["LINKEDIN"],
      instagram: ["INSTAGRAM"],
      whatsapp: ["WHATSAPP"],
      threads: ["INSTAGRAM"],
    };

    const providers = providerMap[data.platform] || "*";

    const url = await createHostedAuthLink(creds, {
      name: `${data.workspaceId}-${data.platform}`,
      successRedirectUrl: `${data.origin}/conexiones?success=${data.platform}_connected`,
      failureRedirectUrl: `${data.origin}/conexiones?error=${data.platform}_failed`,
    });

    return { url, mode: "popup" };
  });
