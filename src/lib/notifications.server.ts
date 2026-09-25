// Per-workspace notifications. Each workspace brings its own Slack Incoming
// Webhook URL (stored encrypted) — nothing is routed through a shared Slack.
// Server-only.

import { decryptSecret, isEncrypted } from "./crypto.server";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

// Slack is the least important call on the automation path — nothing else
// depends on it, and it must never be what stalls a tick (docs/bugs.md
// finding 9). Slack's own webhook endpoint responds in well under a second
// when healthy, so this is deliberately far tighter than FETCH_TIMEOUT.api.
const SLACK_TIMEOUT_MS = 8_000;

export type NotificationEvent =
  "approval" | "failure" | "cap" | "digest" | "dm" | "negative" | "opportunity" | "support";

type Client = { from: (t: string) => any };

type SettingsRow = {
  slack_webhook_enc: string | null;
  on_approval: boolean;
  on_failure: boolean;
  on_cap: boolean;
  on_digest: boolean;
  on_dm?: boolean;
  on_negative?: boolean;
  on_opportunity?: boolean;
  on_support?: boolean;
};

const FLAG: Record<NotificationEvent, keyof SettingsRow> = {
  approval: "on_approval",
  failure: "on_failure",
  cap: "on_cap",
  digest: "on_digest",
  dm: "on_dm",
  negative: "on_negative",
  opportunity: "on_opportunity",
  support: "on_support",
};

const EMOJI: Record<NotificationEvent, string> = {
  approval: ":hourglass_flowing_sand:",
  failure: ":rotating_light:",
  cap: ":no_entry:",
  digest: ":bar_chart:",
  dm: ":envelope:",
  negative: ":warning:",
  opportunity: ":handshake:",
  support: ":sos:",
};

export function isSlackWebhookUrl(url: string): boolean {
  return /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(url.trim());
}

async function readWebhook(row: SettingsRow): Promise<string | null> {
  const stored = row.slack_webhook_enc;
  if (!stored) return null;
  if (isEncrypted(stored)) return await decryptSecret(stored);
  return stored;
}

export async function postToSlackWebhook(
  webhookUrl: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout(
      webhookUrl,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      },
      { timeoutMs: SLACK_TIMEOUT_MS, label: "Slack" },
    );
    const body = (await res.text()).slice(0, 200);
    if (!res.ok || body.trim() !== "ok") {
      return {
        ok: false,
        error: `Slack rejected the message (${res.status}): ${body || "no body"}`,
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

/**
 * Sends a notification for a workspace event. Silently no-ops when the
 * workspace has no webhook configured or has muted the event.
 *
 * `force` skips the per-event mute check (never the webhook requirement) —
 * used by the "Send test" button so a muted event can't make the test lie
 * about whether the webhook itself works.
 */
export async function notify(
  client: Client,
  workspaceId: string,
  event: NotificationEvent,
  message: { title: string; body?: string; url?: string },
  options?: { force?: boolean },
): Promise<{ sent: boolean; error?: string }> {
  try {
    const { data } = await client
      .from("notification_settings")
      .select(
        "slack_webhook_enc,on_approval,on_failure,on_cap,on_digest,on_dm,on_negative,on_opportunity,on_support",
      )
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const row = data as SettingsRow | null;
    // A missing row means the workspace never touched its settings — every
    // event defaults to ON (matching the column defaults), so only the mute
    // check needs a row. The webhook lives on that same row, so a missing row
    // still ends up unsent below — but for the right reason (no webhook), not
    // because the event was treated as muted.
    if (row && !options?.force && row[FLAG[event]] === false) return { sent: false };

    const webhook = row ? await readWebhook(row) : null;
    if (!webhook) return { sent: false };

    const lines = [`${EMOJI[event]} *${message.title}*`];
    if (message.body) lines.push(message.body);
    if (message.url) lines.push(message.url);
    const res = await postToSlackWebhook(webhook, lines.join("\n"));
    if (!res.ok) console.warn("[notifications] slack send failed:", res.error);
    return { sent: res.ok, ...(res.error ? { error: res.error } : {}) };
  } catch (e) {
    console.warn("[notifications] failed", e instanceof Error ? e.message : e);
    return { sent: false };
  }
}
