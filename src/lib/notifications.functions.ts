import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Slack is the only notification transport (see notifications.server.ts).
// The legacy email_to column still exists in the table but is deliberately
// not exposed here — nothing ever sends email.
export type NotificationSettingsPublic = {
  hasSlackWebhook: boolean;
  onApproval: boolean;
  onFailure: boolean;
  onCap: boolean;
  onDigest: boolean;
  onDm: boolean;
  onNegative: boolean;
  onOpportunity: boolean;
  onSupport: boolean;
};

// Note: the table also has on_engagement_digest — currently unused (no code
// emits an "engagement digest" event), so it is not surfaced here yet.
type Row = {
  slack_webhook_enc: string | null;
  on_approval: boolean;
  on_failure: boolean;
  on_cap: boolean;
  on_digest: boolean;
  on_dm: boolean;
  on_negative: boolean;
  on_opportunity: boolean;
  on_support: boolean;
};

const COLUMNS =
  "slack_webhook_enc,on_approval,on_failure,on_cap,on_digest,on_dm,on_negative,on_opportunity,on_support";

const DEFAULTS: NotificationSettingsPublic = {
  hasSlackWebhook: false,
  onApproval: true,
  onFailure: true,
  onCap: true,
  onDigest: true,
  onDm: true,
  onNegative: true,
  onOpportunity: true,
  onSupport: true,
};

const toPublic = (r: Row): NotificationSettingsPublic => ({
  hasSlackWebhook: !!r.slack_webhook_enc,
  onApproval: r.on_approval,
  onFailure: r.on_failure,
  onCap: r.on_cap,
  onDigest: r.on_digest,
  onDm: r.on_dm,
  onNegative: r.on_negative,
  onOpportunity: r.on_opportunity,
  onSupport: r.on_support,
});

export const getNotificationSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<NotificationSettingsPublic> => {
    const { data: row, error } = await (context.supabase as any)
      .from("notification_settings")
      .select(COLUMNS)
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row ? toPublic(row as Row) : DEFAULTS;
  });

export const saveNotificationSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        slackWebhookUrl: z.string().trim().max(500).optional(),
        clearSlackWebhook: z.boolean().optional(),
        onApproval: z.boolean().optional(),
        onFailure: z.boolean().optional(),
        onCap: z.boolean().optional(),
        onDigest: z.boolean().optional(),
        onDm: z.boolean().optional(),
        onNegative: z.boolean().optional(),
        onOpportunity: z.boolean().optional(),
        onSupport: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<NotificationSettingsPublic> => {
    const supabase = context.supabase as any;
    const { encryptSecret, isEncrypted } = await import("./crypto.server");
    const { isSlackWebhookUrl } = await import("./notifications.server");

    const patch: Record<string, unknown> = {
      workspace_id: data.workspaceId,
      updated_at: new Date().toISOString(),
    };

    if (data.clearSlackWebhook) {
      patch.slack_webhook_enc = null;
    } else if (data.slackWebhookUrl) {
      const url = data.slackWebhookUrl.trim();
      if (!isSlackWebhookUrl(url)) {
        throw new Error(
          "That doesn't look like a Slack Incoming Webhook URL (https://hooks.slack.com/services/...).",
        );
      }
      const enc = await encryptSecret(url);
      patch.slack_webhook_enc = enc && isEncrypted(enc) ? enc : url;
    }

    if (data.onApproval !== undefined) patch.on_approval = data.onApproval;
    if (data.onFailure !== undefined) patch.on_failure = data.onFailure;
    if (data.onCap !== undefined) patch.on_cap = data.onCap;
    if (data.onDigest !== undefined) patch.on_digest = data.onDigest;
    if (data.onDm !== undefined) patch.on_dm = data.onDm;
    if (data.onNegative !== undefined) patch.on_negative = data.onNegative;
    if (data.onOpportunity !== undefined) patch.on_opportunity = data.onOpportunity;
    if (data.onSupport !== undefined) patch.on_support = data.onSupport;

    const { data: row, error } = await supabase
      .from("notification_settings")
      .upsert(patch, { onConflict: "workspace_id" })
      .select(COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return toPublic(row as Row);
  });

export const testSlackNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    const { notify } = await import("./notifications.server");
    // force: the test exists to verify the webhook, so it must go through even
    // when the user has muted the event it happens to ride on.
    const res = await notify(
      context.supabase as never,
      data.workspaceId,
      "approval",
      {
        title: "Test notification",
        body: "Your workspace is connected to Slack. Agent alerts will arrive here.",
      },
      { force: true },
    );
    if (res.sent) return { ok: true };
    return {
      ok: false,
      error: res.error ?? "No Slack webhook saved for this workspace.",
    };
  });
