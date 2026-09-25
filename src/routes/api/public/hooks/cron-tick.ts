// Public cron-tick endpoint. Called by pg_cron every minute.
// Authenticates against a server-only secret (CRON_TICK_SECRET) — NEVER the
// publishable/anon key, which is shipped to every browser.
import { createFileRoute } from "@tanstack/react-router";

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/hooks/cron-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.CRON_TICK_SECRET;
        if (!expected) {
          console.error("[cron-tick] CRON_TICK_SECRET not configured");
          return new Response("Server misconfigured", { status: 500 });
        }
        const provided = request.headers.get("x-cron-secret") ?? "";
        if (!provided || !timingSafeEqualStr(provided, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { findAndRunDueJobs } = await import("@/lib/cron-executors.server");
          const { runDueHeartbeats } = await import("@/lib/heartbeat.server");
          const out = await findAndRunDueJobs(supabaseAdmin);
          let beats: { heartbeats: number } = { heartbeats: 0 };
          try {
            beats = await runDueHeartbeats(supabaseAdmin);
          } catch (e) {
            console.warn("[cron-tick] heartbeats failed", e);
          }
          return Response.json({ ...out, ...beats });
        } catch (e) {
          console.error("[cron-tick] failed", e);
          return new Response(JSON.stringify({ error: "cron_tick_failed" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      },
      GET: async () => Response.json({ ok: true }),
    },
  },
});
