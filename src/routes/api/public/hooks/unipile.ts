// Unipile webhook receiver. Unipile posts here when a new message or comment
// arrives. The payload only triggers a sweep for the workspace named in the
// hosted-link `name` field — we never trust content from the body.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Constant-time comparison so the shared secret can't be recovered by timing.
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const Payload = z.object({
  name: z.string().uuid().optional(),
  account_id: z.string().optional(),
  status: z.string().optional(),
  event: z.string().optional(),
});

// Unipile can retry a delivery, and a burst of comments/DMs on one workspace
// arrives as several deliveries seconds apart. Each delivery used to trigger
// its own full engagement sweep (ingest + classify + draft/send) with no
// dedup, which is how overlapping sweeps for the same workspace happen even
// before any database race between them (see engagement.server.ts).
//
// This collapses a burst into one trailing sweep per workspace: a delivery
// that finds no sweep running and none recently finished for this workspace
// runs immediately, so a lone delivery is not delayed. Any delivery that
// lands while a sweep is running, or within the debounce window after one
// finished, resets a short timer instead of starting a second sweep — the
// timer always fires on the LAST delivery seen, never an earlier one, so
// whatever the newest delivery signalled is still covered once the sweep
// (which reads live state from Unipile, not the webhook body) actually runs.
// A hard cap forces a sweep periodically even under a continuous stream, so
// a workspace that never goes quiet still gets swept.
//
// This is in-process debounce only — it does nothing across multiple server
// instances. That is an accepted, documented limit, not a claim of a
// distributed lock.
const DEBOUNCE_MS = 4_000;
const MAX_DEFER_MS = 20_000;

type SweepState = {
  running: boolean;
  lastRunAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  pendingSince: number;
};
const sweepState = new Map<string, SweepState>();

function stateFor(workspaceId: string): SweepState {
  let s = sweepState.get(workspaceId);
  if (!s) {
    s = { running: false, lastRunAt: 0, timer: null, pendingSince: 0 };
    sweepState.set(workspaceId, s);
  }
  return s;
}

async function runSweepNow(workspaceId: string, admin: unknown) {
  const state = stateFor(workspaceId);
  state.running = true;
  state.lastRunAt = Date.now();
  try {
    const { runEngagementSweep } = await import("@/lib/engagement/engagement.server");
    return await runEngagementSweep(admin as never, workspaceId);
  } finally {
    state.running = false;
  }
}

/** Schedules (or reschedules) the trailing sweep for a debounced burst. */
function deferSweep(workspaceId: string, admin: unknown) {
  const state = stateFor(workspaceId);
  const now = Date.now();
  if (state.pendingSince === 0) state.pendingSince = now;
  const overdue = now - state.pendingSince >= MAX_DEFER_MS;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(
    () => {
      state.timer = null;
      state.pendingSince = 0;
      void runSweepNow(workspaceId, admin).catch((e) => {
        console.error(
          "[unipile webhook] debounced sweep failed",
          e instanceof Error ? e.message : e,
        );
      });
    },
    overdue ? 0 : DEBOUNCE_MS,
  );
}

export const Route = createFileRoute("/api/public/hooks/unipile")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Fails closed like cron-tick: an unset secret disables the endpoint
        // instead of leaving it unauthenticated on fresh clones.
        const secret = process.env["UNIPILE_WEBHOOK_SECRET"];
        if (!secret)
          return new Response("Webhook disabled: UNIPILE_WEBHOOK_SECRET is not set.", {
            status: 503,
          });
        if (!timingSafeEqualStr(request.headers.get("x-webhook-secret") ?? "", secret)) {
          return new Response("Unauthorized", { status: 401 });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        const parsed = Payload.safeParse(body);
        const workspaceId = parsed.success ? parsed.data.name : undefined;
        if (!workspaceId) return Response.json({ ok: true, skipped: "no workspace" });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: ws } = await supabaseAdmin
          .from("workspaces")
          .select("id")
          .eq("id", workspaceId)
          .maybeSingle();
        if (!ws) return Response.json({ ok: true, skipped: "unknown workspace" });

        const state = stateFor(workspaceId);
        if (state.running || Date.now() - state.lastRunAt < DEBOUNCE_MS) {
          deferSweep(workspaceId, supabaseAdmin);
          return Response.json({ ok: true, debounced: true });
        }

        try {
          const out = await runSweepNow(workspaceId, supabaseAdmin);
          return Response.json({ ok: true, inserted: out.inserted, handled: out.handled });
        } catch (e) {
          console.error("[unipile webhook] sweep failed", e instanceof Error ? e.message : e);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
