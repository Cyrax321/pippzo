import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/oauth/x/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");

        if (error) {
          const dest = new URL("/conexiones", url.origin);
          dest.searchParams.set("error", errorDescription || error);
          return Response.redirect(dest.toString(), 302);
        }

        if (!code || !state) {
          const dest = new URL("/conexiones", url.origin);
          dest.searchParams.set("error", "Missing OAuth code or state parameter.");
          return Response.redirect(dest.toString(), 302);
        }

        try {
          const { handleXOAuthCallback } = await import("@/lib/oauth-flow.server");
          const { redirectUrl } = await handleXOAuthCallback({ code, state });
          return Response.redirect(redirectUrl, 302);
        } catch (err) {
          const dest = new URL("/conexiones", url.origin);
          dest.searchParams.set("error", err instanceof Error ? err.message : "X authentication failed");
          return Response.redirect(dest.toString(), 302);
        }
      },
    },
  },
});
