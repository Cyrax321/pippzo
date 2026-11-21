import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/oauth/buffer/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          const dest = new URL("/conexiones", url.origin);
          dest.searchParams.set("error", error);
          return Response.redirect(dest.toString(), 302);
        }

        if (!code || !state) {
          const dest = new URL("/conexiones", url.origin);
          dest.searchParams.set("error", "Missing Buffer OAuth code or state parameter.");
          return Response.redirect(dest.toString(), 302);
        }

        try {
          const { handleBufferOAuthCallback } = await import("@/lib/oauth-flow.server");
          const { redirectUrl } = await handleBufferOAuthCallback({ code, state });
          return Response.redirect(redirectUrl, 302);
        } catch (err) {
          const dest = new URL("/conexiones", url.origin);
          dest.searchParams.set("error", err instanceof Error ? err.message : "Buffer authentication failed");
          return Response.redirect(dest.toString(), 302);
        }
      },
    },
  },
});
