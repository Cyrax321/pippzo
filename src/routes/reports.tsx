import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import { bufferSyncMetrics } from "@/lib/buffer.functions";
import { learnFromPerformance, deleteLearning, updateLearning } from "@/lib/learning.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Sparkles,
  ArrowRight,
  Brain,
  Trash2,
  Pencil,
} from "lucide-react";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports · Performance & AI learnings" },
      {
        name: "description",
        content: "How your published posts performed and what the agent has learned from them.",
      },
      { property: "og:title", content: "Reports · Performance & AI learnings" },
      {
        property: "og:description",
        content: "How your published posts performed and what the agent has learned from them.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportsPage,
});

type Metric = {
  id: string;
  text: string;
  service: string | null;
  channel_id: string | null;
  sent_at: string | null;
  media_url: string | null;
  media_type: string | null;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  engagement_rate: number;
};

type Memory = {
  id: string;
  kind: string;
  content: string;
  weight: number;
  source: string | null;
  created_at: string;
};

type Reflection = { id: string; summary: string; created_at: string; status: string };

const TABS = [
  { id: "performance", label: "Performance" },
  { id: "learnings", label: "AI learnings" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const num = (n: number) => n.toLocaleString("en-US");
// engagement_rate is stored as an already-percent number (e.g. 0.5 = 0.5%).
const pct = (n: number) => `${n.toFixed(1)}%`;

const RANGES = [
  { id: "7", label: "Last 7 days", days: 7 },
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
  { id: "all", label: "All time", days: 0 },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

// Lowercased so it lines up with the server side (learning tags), which
// lowercases the service name before writing.
const channelKey = (r: Metric) => (r.service ?? r.channel_id ?? "unknown").toLowerCase();

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-lg p-4">
      <p className="label-eyebrow !text-[0.625rem]">{label}</p>
      <p className="mt-1 font-serif text-2xl tabular-nums">{value}</p>
    </div>
  );
}

function PostList({ rows, tone }: { rows: Metric[]; tone: "up" | "down" }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No data yet.</p>;
  return (
    <ul className="border border-border rounded-lg divide-y divide-border overflow-hidden">
      {rows.map((r) => (
        <li key={r.id} className="px-4 py-3 flex items-start gap-3">
          {tone === "up" ? (
            <TrendingUp className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" />
          ) : (
            <TrendingDown className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          )}
          {r.media_url ? (
            <img
              src={r.media_url}
              alt=""
              loading="lazy"
              className="h-14 w-14 rounded-md object-cover border border-border shrink-0"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="h-14 w-14 rounded-md border border-dashed border-border shrink-0 grid place-items-center text-[9px] uppercase tracking-wider text-muted-foreground">
              {r.media_type ?? "text"}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm line-clamp-2">{r.text || "(no text)"}</p>
            <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
              {r.service ?? "channel"} · {num(r.impressions)} impressions ·{" "}
              {num(r.likes + r.comments + r.shares)} engagements
              {r.sent_at
                ? ` · ${new Date(r.sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                : ""}
            </p>
          </div>
          <span className="text-xs tabular-nums shrink-0">{pct(r.engagement_rate)}</span>
        </li>
      ))}
    </ul>
  );
}

function ReportsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [tab, setTab] = useState<Tab>("performance");
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [learning, setLearning] = useState(false);
  const [range, setRange] = useState<RangeId>("30");
  const [channel, setChannel] = useState<string>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const load = async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    const [m, mem, ref] = await Promise.all([
      supabase
        .from("post_metrics")
        .select("*")
        .eq("workspace_id", activeWorkspaceId)
        .order("sent_at", { ascending: false })
        .limit(200),
      supabase
        .from("agent_memory")
        .select("id,kind,content,weight,source,created_at")
        .eq("workspace_id", activeWorkspaceId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("activity_log")
        .select("id,summary,created_at,status")
        .eq("workspace_id", activeWorkspaceId)
        .eq("action", "agent.reflection")
        .order("created_at", { ascending: false })
        .limit(15),
    ]);
    if (m.error) console.error("[reports] metrics", m.error);
    if (mem.error) console.error("[reports] memory", mem.error);
    setMetrics((m.data as Metric[] | null) ?? []);
    setMemories((mem.data as Memory[] | null) ?? []);
    setReflections((ref.data as Reflection[] | null) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [activeWorkspaceId]); // eslint-disable-line

  const dateFiltered = useMemo(() => {
    const from = customFrom ? new Date(`${customFrom}T00:00:00`).getTime() : null;
    const to = customTo ? new Date(`${customTo}T23:59:59`).getTime() : null;
    const days = RANGES.find((r) => r.id === range)?.days ?? 0;
    const since = !from && !to && days > 0 ? Date.now() - days * 86400000 : null;
    return metrics.filter((r) => {
      if (!since && !from && !to) return true;
      if (!r.sent_at) return false;
      const t = new Date(r.sent_at).getTime();
      if (since && t < since) return false;
      if (from && t < from) return false;
      if (to && t > to) return false;
      return true;
    });
  }, [metrics, range, customFrom, customTo]);

  // Options come from ALL synced posts, not just the current range — otherwise a
  // channel with no recent activity silently disappears from the picker.
  const channels = useMemo(() => {
    const inRange = new Map<string, number>();
    for (const r of dateFiltered) inRange.set(channelKey(r), (inRange.get(channelKey(r)) ?? 0) + 1);
    return Array.from(new Set(metrics.map(channelKey)))
      .sort()
      .map((c) => ({ id: c, count: inRange.get(c) ?? 0 }));
  }, [metrics, dateFiltered]);

  const filtered = useMemo(
    () =>
      channel === "all" ? dateFiltered : dateFiltered.filter((r) => channelKey(r) === channel),
    [dateFiltered, channel],
  );

  const totals = useMemo(() => {
    const t = filtered.reduce(
      (a, r) => ({
        impressions: a.impressions + r.impressions,
        reach: a.reach + r.reach,
        engagements: a.engagements + r.likes + r.comments + r.shares + r.clicks,
        er: a.er + r.engagement_rate,
      }),
      { impressions: 0, reach: 0, engagements: 0, er: 0 },
    );
    return { ...t, avgEr: filtered.length ? t.er / filtered.length : 0 };
  }, [filtered]);

  const byRate = useMemo(
    () => [...filtered].sort((a, b) => b.engagement_rate - a.engagement_rate),
    [filtered],
  );
  const byChannel = useMemo(() => {
    const map = new Map<string, { posts: number; impressions: number; er: number }>();
    for (const r of filtered) {
      const k = channelKey(r);
      const cur = map.get(k) ?? { posts: 0, impressions: 0, er: 0 };
      map.set(k, {
        posts: cur.posts + 1,
        impressions: cur.impressions + r.impressions,
        er: cur.er + r.engagement_rate,
      });
    }
    return Array.from(map.entries()).map(([k, v]) => ({ channel: k, ...v, avgEr: v.er / v.posts }));
  }, [filtered]);

  const memoryGroups = useMemo(() => {
    const map = new Map<string, Memory[]>();
    for (const m of memories) {
      const arr = map.get(m.kind) ?? [];
      arr.push(m);
      map.set(m.kind, arr);
    }
    return Array.from(map.entries());
  }, [memories]);

  const sync = async () => {
    if (!activeWorkspaceId) return;
    setSyncing(true);
    try {
      const res = await bufferSyncMetrics({ data: { workspaceId: activeWorkspaceId, limit: 50 } });
      toast.success(`Synced ${res.upserted} published posts`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const learn = async () => {
    if (!activeWorkspaceId) return;
    setLearning(true);
    try {
      // Learn over the same window the page is showing, instead of a hardcoded
      // 90 days that ignored the range selector above.
      const spanDays = (() => {
        if (customFrom || customTo) {
          const from = customFrom ? new Date(`${customFrom}T00:00:00`).getTime() : null;
          const to = customTo ? new Date(`${customTo}T23:59:59`).getTime() : Date.now();
          // Only an end date gives no span — fall back to the widest window.
          if (!from) return 365;
          return Math.ceil((to - from) / 86400000);
        }
        const d = RANGES.find((r) => r.id === range)?.days ?? 0;
        return d === 0 ? 365 : d; // "All time" → server maximum
      })();
      const days = Math.min(365, Math.max(7, spanDays)); // server accepts 7–365
      const res = await learnFromPerformance({ data: { workspaceId: activeWorkspaceId, days } });
      toast[res.ok ? "success" : "info"](
        res.ok
          ? `Saved ${res.learned} new learning${res.learned === 1 ? "" : "s"}`
          : (res.reason ?? "Nothing to learn yet"),
      );
      setTab("learnings");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Learning failed");
    } finally {
      setLearning(false);
    }
  };

  const forget = async (id: string) => {
    try {
      await deleteLearning({ data: { id } });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete");
    }
  };

  // Inline editing of a learning's content and weight (0–5). Weight is how
  // strongly the learning is injected into prompts, so exposing it lets the
  // user promote or soften a learning without deleting it.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editWeight, setEditWeight] = useState("1");
  const [savingEdit, setSavingEdit] = useState(false);

  const startEdit = (m: Memory) => {
    setEditingId(m.id);
    setEditContent(m.content);
    setEditWeight(String(m.weight ?? 1));
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const content = editContent.trim();
    if (content.length < 4) {
      toast.error("A learning needs at least a few words.");
      return;
    }
    const weight = Math.min(5, Math.max(0, Number(editWeight) || 0));
    setSavingEdit(true);
    try {
      await updateLearning({ data: { id: editingId, content, weight } });
      setEditingId(null);
      await load();
      toast.success("Learning updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="pb-4 border-b border-border flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Studio</p>
          <h1 className="mt-1 font-serif text-3xl">Reports</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            What worked, what didn't, and what the agent learned from it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" onClick={sync} disabled={syncing || !activeWorkspaceId}>
            {syncing ? "Syncing…" : "Sync performance"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={learn}
            disabled={learning || !activeWorkspaceId}
          >
            <Brain className={`h-3.5 w-3.5 mr-2 ${learning ? "animate-pulse" : ""}`} />
            {learning ? "Learning…" : "Learn from results"}
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`text-xs px-3 py-1.5 rounded-full border ${tab === t.id ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
        <Link
          to="/logs"
          className="ml-auto text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          Full activity log <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {tab === "performance" ? (
        <div className="mt-6 space-y-8">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    setRange(r.id);
                    setCustomFrom("");
                    setCustomTo("");
                  }}
                  className={`text-xs px-3 py-1.5 rounded-md border ${!customFrom && !customTo && range === r.id ? "bg-muted border-foreground/30 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <input
                type="date"
                aria-label="From date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="bg-background border border-border rounded-md px-2 py-1.5 text-xs"
              />
              <span>→</span>
              <input
                type="date"
                aria-label="To date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="bg-background border border-border rounded-md px-2 py-1.5 text-xs"
              />
            </div>
            <select
              aria-label="Channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="ml-auto bg-background border border-border rounded-md px-2 py-1.5 text-xs"
            >
              <option value="all">All channels</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id}
                  {c.count === 0 ? " (0 in range)" : ` (${c.count})`}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Impressions" value={num(totals.impressions)} />
            <Stat label="Reach" value={num(totals.reach)} />
            <Stat label="Engagements" value={num(totals.engagements)} />
            <Stat label="Avg engagement rate" value={filtered.length ? pct(totals.avgEr) : "—"} />
          </div>

          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-8 text-center">
              {loading
                ? "Loading…"
                : metrics.length === 0
                  ? "No performance data yet. Link your channels and hit “Sync performance”."
                  : "No posts in this date range. Try “All time” — some channels last posted a while ago."}
            </p>
          )}

          {filtered.length > 0 && (
            <>
              <div>
                <p className="label-eyebrow !text-[0.625rem] mb-2">Top posts</p>
                <PostList rows={byRate.slice(0, 5)} tone="up" />
              </div>
              <div>
                <p className="label-eyebrow !text-[0.625rem] mb-2">Weakest posts</p>
                <PostList rows={byRate.slice(-5).reverse()} tone="down" />
              </div>
              <div>
                <p className="label-eyebrow !text-[0.625rem] mb-2">By channel</p>
                <ul className="border border-border rounded-lg divide-y divide-border overflow-hidden">
                  {byChannel.map((c) => (
                    <li key={c.channel} className="px-4 py-3 flex items-center gap-3 text-sm">
                      <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-border rounded">
                        {c.channel}
                      </span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {c.posts} posts · {num(c.impressions)} impressions
                      </span>
                      <span className="ml-auto text-xs tabular-nums">{pct(c.avgEr)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          <div className="border border-border rounded-lg p-4 bg-muted/40 text-sm text-muted-foreground leading-relaxed">
            <p className="text-foreground text-xs uppercase tracking-[0.16em] mb-2">
              How learning works
            </p>
            <p>
              After every autonomous run the agent reflects on what it did, and “Learn from results”
              compares your synced numbers against your own averages. Whatever holds up becomes a
              durable learning below. Those learnings are injected into the chat agent and into
              every automated post, so it repeats what worked and avoids what flopped. You can also
              just tell the agent in chat — “always post carousels on LinkedIn” — and it saves that
              too. Delete anything that is wrong; unused learnings fade in relevance after 90 days.
            </p>
          </div>
          {memoryGroups.length === 0 && reflections.length === 0 && (
            <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-8 text-center">
              {loading
                ? "Loading…"
                : "The agent hasn't recorded any learnings yet. They appear after autonomous runs."}
            </p>
          )}
          {memoryGroups.map(([kind, rows]) => (
            <div key={kind}>
              <p className="label-eyebrow !text-[0.625rem] mb-2">{kind}</p>
              <ul className="border border-border rounded-lg divide-y divide-border overflow-hidden">
                {rows.map((m) => (
                  <li key={m.id} className="px-4 py-3 text-sm flex items-start gap-3">
                    {editingId === m.id ? (
                      <div className="min-w-0 flex-1 space-y-2">
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={3}
                          className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm"
                        />
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <label htmlFor={`weight-${m.id}`}>Weight (0–5)</label>
                          <input
                            id={`weight-${m.id}`}
                            type="number"
                            min={0}
                            max={5}
                            step={0.5}
                            value={editWeight}
                            onChange={(e) => setEditWeight(e.target.value)}
                            className="w-20 bg-background border border-border rounded-md px-2 py-1 text-xs tabular-nums"
                          />
                          <Button
                            size="sm"
                            onClick={saveEdit}
                            disabled={savingEdit}
                            className="ml-auto"
                          >
                            {savingEdit ? "Saving…" : "Save"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                            disabled={savingEdit}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="min-w-0">
                          <p>{m.content}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {m.source ?? "agent"} · weight {Number(m.weight ?? 1)} ·{" "}
                            {new Date(m.created_at).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </p>
                        </div>
                        <button
                          onClick={() => startEdit(m)}
                          aria-label="Edit learning"
                          className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => forget(m.id)}
                          aria-label="Delete learning"
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {reflections.length > 0 && (
            <div>
              <p className="label-eyebrow !text-[0.625rem] mb-2">Recent reflections</p>
              <ul className="space-y-3">
                {reflections.map((r) => (
                  <li key={r.id} className="border border-border rounded-lg p-4 bg-muted/40">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-foreground/60" />
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {new Date(r.created_at).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <blockquote className="mt-1.5 border-l-2 border-foreground/25 pl-3 font-serif italic text-foreground/90 leading-relaxed">
                      {r.summary}
                    </blockquote>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
