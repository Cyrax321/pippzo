import { safeHttpUrl } from "@/lib/safe-url";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useWorkspace } from "@/lib/workspace";
import {
  getEngagementConfig,
  listEngagementItems,
  syncEngagement,
  draftEngagementReply,
  sendEngagementReply,
  likeEngagementItem,
  setEngagementStatus,
  saveEngagementPolicy,
} from "@/lib/engagement/engagement.functions";
import {
  networkLabel,
  REPLY_MODES,
  SAFE_CATEGORIES,
  type EngagementIntent,
  type EngagementItemPublic,
  type ReplyMode,
} from "@/lib/engagement/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Inbox,
  RefreshCw,
  Loader2,
  Send,
  Sparkles,
  ThumbsUp,
  Check,
  AlertTriangle,
  ExternalLink,
  Settings2,
} from "lucide-react";

export const Route = createFileRoute("/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox · Comments and DMs" },
      {
        name: "description",
        content:
          "One place for every comment and DM across your social accounts, classified and answered by your agent.",
      },
      { property: "og:title", content: "Inbox · Comments and DMs" },
      {
        property: "og:description",
        content:
          "One place for every comment and DM across your social accounts, classified and answered by your agent.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InboxPage,
});

type Filter = "all" | "needs_reply" | "escalated" | "done";
// No "mention" chip: nothing ingests mentions yet (see EngagementKind in types.ts).
type Kind = "all" | "comment" | "dm";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "needs_reply", label: "Needs reply" },
  { value: "escalated", label: "Escalated" },
  { value: "done", label: "Done" },
];

const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "comment", label: "Comments" },
  { value: "dm", label: "DMs" },
];

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.round(diff / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function InboxPage() {
  const { activeWorkspaceId } = useWorkspace();
  const getConfig = useServerFn(getEngagementConfig);
  const listItems = useServerFn(listEngagementItems);
  const sync = useServerFn(syncEngagement);
  const draftFn = useServerFn(draftEngagementReply);
  const sendFn = useServerFn(sendEngagementReply);
  const likeFn = useServerFn(likeEngagementItem);
  const statusFn = useServerFn(setEngagementStatus);
  const savePolicyFn = useServerFn(saveEngagementPolicy);

  const [connected, setConnected] = useState<boolean | null>(null);
  const [mode, setMode] = useState<ReplyMode>("draft");
  const [safeCategories, setSafeCategories] = useState<EngagementIntent[]>(["praise"]);
  const [dailyLimit, setDailyLimit] = useState(10);
  const [showSettings, setShowSettings] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [items, setItems] = useState<EngagementItemPublic[]>([]);
  const [filter, setFilter] = useState<Filter>("needs_reply");
  const [kind, setKind] = useState<Kind>("all");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    try {
      const [cfg, res] = await Promise.all([
        getConfig({ data: { workspaceId: activeWorkspaceId } }),
        listItems({ data: { workspaceId: activeWorkspaceId, filter, kind, limit: 60 } }),
      ]);
      setConnected(cfg.connected && cfg.accounts.length > 0);
      setMode(cfg.policy.mode);
      setSafeCategories(cfg.policy.safeCategories);
      setDailyLimit(cfg.policy.dailyLimit);
      setItems(res.items);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the inbox");
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, filter, kind, getConfig, listItems]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSync = async () => {
    if (!activeWorkspaceId) return;
    setSyncing(true);
    try {
      const res = await sync({ data: { workspaceId: activeWorkspaceId, autoDraft: true } });
      if (!res.ok) throw new Error(res.error);
      toast.success(
        `${res.inserted} new · ${res.handled} handled${res.reconciled ? ` · ${res.reconciled} already answered` : ""}`,
      );
      // Partial failures (one account, one post, a bad insert) come back in
      // errors — without showing them a broken sync looks like a quiet inbox.
      if (res.errors?.length) {
        toast.warning(`${res.errors.length} sync issue(s): ${res.errors[0]}`, { duration: 10000 });
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const textFor = (it: EngagementItemPublic) => drafts[it.id] ?? it.draft?.text ?? "";

  const onDraft = async (it: EngagementItemPublic) => {
    if (!activeWorkspaceId) return;
    setBusy(it.id);
    try {
      const res = await draftFn({ data: { workspaceId: activeWorkspaceId, itemId: it.id } });
      if (!res.ok || !res.text) throw new Error(res.error);
      setDrafts((d) => ({ ...d, [it.id]: res.text as string }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not draft a reply");
    } finally {
      setBusy(null);
    }
  };

  const onSend = async (it: EngagementItemPublic) => {
    if (!activeWorkspaceId) return;
    const text = textFor(it).trim();
    if (!text) return;
    setBusy(it.id);
    try {
      const res = await sendFn({
        data: {
          workspaceId: activeWorkspaceId,
          itemId: it.id,
          text,
          ...(it.draft ? { replyId: it.draft.id } : {}),
        },
      });
      if (!res.ok) throw new Error(res.error);
      toast.success("Reply sent");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the reply");
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (it: EngagementItemPublic, status: "escalated" | "done" | "ignored") => {
    if (!activeWorkspaceId) return;
    await statusFn({ data: { workspaceId: activeWorkspaceId, itemId: it.id, status } });
    setItems((cur) => cur.map((x) => (x.id === it.id ? { ...x, status } : x)));
  };

  const modeHint = useMemo(() => REPLY_MODES.find((m) => m.value === mode)?.label ?? "", [mode]);

  const onSavePolicy = async () => {
    if (!activeWorkspaceId) return;
    setSavingPolicy(true);
    try {
      await savePolicyFn({
        data: { workspaceId: activeWorkspaceId, mode, safeCategories, dailyLimit },
      });
      toast.success("Reply settings saved");
      setShowSettings(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the reply settings");
    } finally {
      setSavingPolicy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="pb-4 border-b border-border flex items-start gap-4">
        <div className="flex-1">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Agent</p>
          <h1 className="mt-1 font-serif text-3xl flex items-center gap-2">
            <Inbox className="h-6 w-6" /> Inbox
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Comments and DMs from your linked accounts. Reply mode: <strong>{modeHint}</strong>.
          </p>
        </div>
        <Button variant="outline" onClick={() => setShowSettings((s) => !s)}>
          <Settings2 className="h-4 w-4" /> Reply settings
        </Button>
        <Button variant="outline" onClick={onSync} disabled={syncing || !activeWorkspaceId}>
          {syncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}{" "}
          Sync
        </Button>
      </div>

      {showSettings ? (
        <div className="mt-4 border border-border p-4 space-y-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Reply mode</p>
            <div className="mt-2 space-y-2">
              {REPLY_MODES.map((m) => (
                <label key={m.value} className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="reply-mode"
                    className="mt-1"
                    checked={mode === m.value}
                    onChange={() => setMode(m.value)}
                  />
                  <span>
                    <span className="font-medium">{m.label}</span>
                    <span className="block text-xs text-muted-foreground">{m.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {mode === "autonomous" ? (
              <p className="mt-2 text-xs text-destructive">
                Replies in safe categories are sent publicly without review.
              </p>
            ) : null}
          </div>

          {mode === "autonomous" ? (
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Safe categories
              </p>
              <div className="mt-2 space-y-2">
                {SAFE_CATEGORIES.map((c) => (
                  <label key={c.value} className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={safeCategories.includes(c.value)}
                      onChange={(e) =>
                        setSafeCategories((cur) =>
                          e.target.checked ? [...cur, c.value] : cur.filter((x) => x !== c.value),
                        )
                      }
                    />
                    <span>
                      <span className="font-medium">{c.label}</span>
                      <span className="block text-xs text-muted-foreground">{c.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Daily autonomous reply limit
            </p>
            <input
              type="number"
              min={0}
              max={200}
              value={dailyLimit}
              onChange={(e) =>
                setDailyLimit(Math.max(0, Math.min(200, Number(e.target.value) || 0)))
              }
              className="mt-2 w-24 rounded border border-border bg-transparent px-2 py-1 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">0 means no limit.</p>
          </div>

          <Button size="sm" onClick={onSavePolicy} disabled={savingPolicy || !activeWorkspaceId}>
            {savingPolicy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}{" "}
            Save settings
          </Button>
        </div>
      ) : null}

      {connected === false ? (
        <p className="mt-6 text-sm text-muted-foreground border border-border p-4">
          No engagement accounts linked yet. Go to{" "}
          <strong>Settings → Connections → Engagement</strong>, add your Unipile key, then link a
          LinkedIn or Instagram account.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`text-xs px-3 py-1.5 rounded border ${filter === f.value ? "border-foreground text-foreground" : "border-border text-muted-foreground"}`}
          >
            {f.label}
          </button>
        ))}
        <span className="w-px bg-border mx-1" />
        {KINDS.map((k) => (
          <button
            key={k.value}
            onClick={() => setKind(k.value)}
            className={`text-xs px-3 py-1.5 rounded border ${kind === k.value ? "border-foreground text-foreground" : "border-border text-muted-foreground"}`}
          >
            {k.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          Nothing here. Hit Sync to pull the latest.
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {items.map((it) => (
            <li key={it.id} className="border border-border p-4">
              <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                <Badge variant="outline">{networkLabel(it.network)}</Badge>
                <Badge variant="outline">{it.kind}</Badge>
                {it.sentiment ? (
                  <Badge variant={it.sentiment === "negative" ? "destructive" : "secondary"}>
                    {it.sentiment}
                  </Badge>
                ) : null}
                {it.intent ? <Badge variant="secondary">{it.intent}</Badge> : null}
                <span>· {timeAgo(it.occurredAt ?? it.createdAt)}</span>
                <span className="ml-auto uppercase tracking-widest">
                  {it.status.replace("_", " ")}
                </span>
              </div>

              <p className="mt-3 text-sm">
                <strong>{it.authorName}</strong>
                {it.authorHandle ? (
                  <span className="text-muted-foreground"> @{it.authorHandle}</span>
                ) : null}
              </p>
              <p className="mt-1 text-sm whitespace-pre-wrap">{it.text}</p>

              {it.postExcerpt ? (
                <p className="mt-2 text-xs text-muted-foreground border-l-2 border-border pl-3">
                  On: {it.postExcerpt.slice(0, 160)}
                </p>
              ) : null}
              {it.reason ? (
                <p className="mt-2 text-xs text-muted-foreground">Agent: {it.reason}</p>
              ) : null}

              <Textarea
                className="mt-3"
                rows={3}
                placeholder="Write a reply, or let the agent draft one…"
                value={textFor(it)}
                onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: e.target.value }))}
              />

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => onSend(it)}
                  disabled={busy === it.id || !textFor(it).trim()}
                >
                  {busy === it.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}{" "}
                  Send
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onDraft(it)}
                  disabled={busy === it.id}
                >
                  <Sparkles className="h-4 w-4" /> Draft with agent
                </Button>
                {it.kind !== "dm" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      if (!activeWorkspaceId) return;
                      const res = await likeFn({
                        data: { workspaceId: activeWorkspaceId, itemId: it.id },
                      });
                      if (res.ok) toast.success("Liked");
                      else toast.error(res.error ?? "Could not like");
                    }}
                  >
                    <ThumbsUp className="h-4 w-4" /> Like
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => setStatus(it, "escalated")}>
                  <AlertTriangle className="h-4 w-4" /> Escalate
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setStatus(it, "done")}>
                  <Check className="h-4 w-4" /> Done
                </Button>
                {safeHttpUrl(it.permalink) ? (
                  <a
                    href={safeHttpUrl(it.permalink)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-muted-foreground inline-flex items-center gap-1 self-center"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Open
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
