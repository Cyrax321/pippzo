import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getNotificationSettings,
  saveNotificationSettings,
  testSlackNotification,
  type NotificationSettingsPublic,
} from "@/lib/notifications.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { SectionDisclosure } from "@/components/section-disclosure";
import { AlertTriangle, Bell, CheckCircle2, Loader2, RefreshCw, Trash2 } from "lucide-react";

const EVENTS: { key: keyof NotificationSettingsPublic; label: string; hint: string }[] = [
  {
    key: "onApproval",
    label: "Post awaiting approval",
    hint: "The agent drafted a post that needs your OK.",
  },
  { key: "onFailure", label: "Automation failed", hint: "A scheduled job errored out." },
  { key: "onCap", label: "Usage cap reached", hint: "The workspace hit its monthly AI token cap." },
  {
    key: "onDigest",
    label: "Weekly performance digest",
    hint: "Summary of what ran and how posts performed.",
  },
  {
    key: "onDm",
    label: "New DM",
    hint: "Someone sent a direct message to a connected inbox account.",
  },
  {
    key: "onNegative",
    label: "Negative comment",
    hint: "The agent flagged a comment as negative.",
  },
  {
    key: "onOpportunity",
    label: "Engagement opportunity",
    hint: "A comment or DM worth jumping on — a potential lead or collaboration.",
  },
  {
    key: "onSupport",
    label: "Support request",
    hint: "Someone is asking for help on your posts or DMs.",
  },
];

export function NotificationsSection({ workspaceId }: { workspaceId: string | null }) {
  const get = useServerFn(getNotificationSettings);
  const save = useServerFn(saveNotificationSettings);
  const test = useServerFn(testSlackNotification);

  const [settings, setSettings] = useState<NotificationSettingsPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [webhook, setWebhook] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(() => {
    if (!workspaceId) return;
    setLoading(true);
    setLoadError(null);
    get({ data: { workspaceId } })
      .then(setSettings)
      .catch((e) =>
        setLoadError(e instanceof Error ? e.message : "Could not load notification settings."),
      )
      .finally(() => setLoading(false));
  }, [workspaceId, get]);

  useEffect(load, [load]);

  const patch = async (input: Record<string, unknown>, okMsg?: string) => {
    if (!workspaceId) return;
    setBusy(true);
    try {
      const next = await save({ data: { workspaceId, ...input } as never });
      setSettings(next);
      if (okMsg) toast.success(okMsg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const onTest = async () => {
    if (!workspaceId) return;
    setTesting(true);
    try {
      const r = await test({ data: { workspaceId } });
      if (r.ok) toast.success("Sent — check your Slack channel.");
      else toast.error(r.error ?? "Test failed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  return (
    <SectionDisclosure
      icon={<Bell className="h-4 w-4" />}
      title={<>Notifications</>}
      subtitle="Your own Slack"
    >
      <div className="px-5 py-5 space-y-5">
        <p className="text-sm text-muted-foreground">
          Alerts go to <strong>your</strong> Slack workspace — nothing is routed through anyone
          else&rsquo;s. Create an Incoming Webhook in your Slack (Slack → Apps →{" "}
          <em>Incoming Webhooks</em> → Add to a channel), then paste the URL below. It&rsquo;s
          encrypted at rest and used only for this workspace.
        </p>

        {loading ? (
          <p className="text-xs text-muted-foreground inline-flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading
          </p>
        ) : loadError ? (
          <div className="flex items-start justify-between gap-3 text-xs border border-dashed border-destructive/50 px-4 py-3">
            <span className="flex items-start gap-2 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Couldn&rsquo;t load notification settings: {loadError}
            </span>
            <Button variant="ghost" size="sm" className="gap-1.5 shrink-0" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        ) : !settings ? null : (
          <>
            {settings.hasSlackWebhook ? (
              <div className="flex items-center justify-between gap-3 border border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Slack webhook connected</p>
                  <p className="text-[11px] text-muted-foreground font-mono truncate">
                    hooks.slack.com/services/•••
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    disabled={testing}
                    onClick={onTest}
                  >
                    {testing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    Send test
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Remove webhook"
                    disabled={busy}
                    onClick={() => patch({ clearSlackWebhook: true }, "Slack disconnected")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs">Slack Incoming Webhook URL</Label>
                <div className="flex gap-2">
                  <Input
                    value={webhook}
                    onChange={(e) => setWebhook(e.target.value)}
                    placeholder="https://hooks.slack.com/services/T000/B000/xxxx"
                  />
                  <Button
                    disabled={busy || webhook.trim().length < 20}
                    onClick={async () => {
                      await patch({ slackWebhookUrl: webhook.trim() }, "Slack connected");
                      setWebhook("");
                    }}
                  >
                    Connect
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Get one at api.slack.com/apps → your app → Incoming Webhooks → Add New Webhook to
                  Workspace.
                </p>
              </div>
            )}

            <div className="border-t border-border pt-5 space-y-3">
              <p className="label-eyebrow !text-[0.625rem]">Send me an alert when</p>
              {EVENTS.map((ev) => (
                <div key={ev.key} className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm">{ev.label}</p>
                    <p className="text-[11px] text-muted-foreground">{ev.hint}</p>
                  </div>
                  <Switch
                    checked={settings[ev.key] as boolean}
                    disabled={busy}
                    onCheckedChange={(v) => patch({ [ev.key]: v })}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </SectionDisclosure>
  );
}
