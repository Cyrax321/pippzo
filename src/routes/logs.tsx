import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Sparkles,
  Gauge,
} from "lucide-react";

export const Route = createFileRoute("/logs")({
  head: () => ({
    meta: [
      { title: "Activity log · Social Studio" },
      { name: "description", content: "Everything the studio and its agents do." },
    ],
  }),
  component: LogsPage,
});

type LogRow = {
  id: string;
  workspace_id: string;
  actor_type: "user" | "agent" | "cron" | "system";
  action: string;
  summary: string;
  status: "ok" | "error" | "warning";
  error: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

const ACTORS: Array<LogRow["actor_type"] | "all"> = ["all", "user", "agent", "cron", "system"];

const KINDS = [
  { id: "all", label: "Everything" },
  { id: "reflections", label: "Reflections" },
  { id: "usage", label: "AI usage" },
  { id: "actions", label: "Actions only" },
] as const;
type Kind = (typeof KINDS)[number]["id"];

type Takeaway = { kind: string; content: string };

function LogsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [actor, setActor] = useState<(typeof ACTORS)[number]>("all");
  const [kind, setKind] = useState<Kind>("all");
  const [q, setQ] = useState("");

  const load = async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    let query = supabase
      .from("activity_log")
      .select("*")
      .eq("workspace_id", activeWorkspaceId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (actor !== "all") query = query.eq("actor_type", actor);
    const { data, error } = await query;
    if (error) console.error("[logs] load", error);
    setRows((data as LogRow[] | null) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [activeWorkspaceId, actor]); // eslint-disable-line

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    let out = rows;
    if (kind === "reflections") out = out.filter((r) => r.action === "agent.reflection");
    else if (kind === "usage") out = out.filter((r) => r.action === "ai.usage");
    else if (kind === "actions")
      out = out.filter((r) => r.action !== "agent.reflection" && r.action !== "ai.usage");
    if (!t) return out;
    return out.filter(
      (r) =>
        r.summary.toLowerCase().includes(t) ||
        r.action.toLowerCase().includes(t) ||
        (r.error ?? "").toLowerCase().includes(t),
    );
  }, [rows, q, kind]);

  const tokenTotal = useMemo(
    () =>
      rows
        .filter((r) => r.action === "ai.usage")
        .reduce(
          (s, r) => s + (Number((r.details as { totalTokens?: number }).totalTokens) || 0),
          0,
        ),
    [rows],
  );

  const groups = useMemo(() => {
    const byDay = new Map<string, LogRow[]>();
    for (const r of filtered) {
      const d = new Date(r.created_at);
      const key = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      const arr = byDay.get(key) ?? [];
      arr.push(r);
      byDay.set(key, arr);
    }
    return Array.from(byDay.entries());
  }, [filtered]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="pb-4 border-b border-border flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Studio</p>
          <h1 className="mt-1 font-serif text-3xl">Activity log</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Every action taken by you, the chat agent, and the autonomous crons.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {ACTORS.map((a) => (
          <button
            key={a}
            onClick={() => setActor(a)}
            className={`text-xs px-3 py-1.5 rounded-full border ${actor === a ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {a}
          </button>
        ))}
        <div className="ml-auto relative">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="text-xs pl-8 pr-3 py-1.5 rounded-md border border-border bg-background w-56"
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {KINDS.map((k) => (
          <button
            key={k.id}
            onClick={() => setKind(k.id)}
            className={`text-xs px-3 py-1.5 rounded-full border ${kind === k.id ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {k.id === "reflections" && (
              <Sparkles className="h-3 w-3 mr-1.5 inline-block align-[-1px]" />
            )}
            {k.id === "usage" && <Gauge className="h-3 w-3 mr-1.5 inline-block align-[-1px]" />}
            {k.label}
          </button>
        ))}
        {tokenTotal > 0 && (
          <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
            {tokenTotal.toLocaleString("en-US")} tokens in the last 200 events
          </span>
        )}
      </div>

      <div className="mt-6 space-y-8">
        {groups.length === 0 && (
          <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-8 text-center">
            {loading
              ? "Loading…"
              : "Nothing logged yet. Actions in Chat, Calendar, Publishing, Competitors and Automations will show up here."}
          </p>
        )}
        {groups.map(([day, items]) => (
          <div key={day}>
            <p className="label-eyebrow !text-[0.625rem] mb-2">{day}</p>
            <ul className="border border-border rounded-lg divide-y divide-border overflow-hidden">
              {items.map((r) => {
                const isReflection = r.action === "agent.reflection";
                const takeaways = (r.details as { takeaways?: Takeaway[] }).takeaways ?? [];
                return (
                  <li
                    key={r.id}
                    className={`px-4 py-3 flex items-start gap-3 text-sm ${isReflection ? "bg-muted/40" : "bg-background"}`}
                  >
                    <div className="mt-0.5">
                      {/* 'warning' is the heartbeat's needs-attention note — amber, not a failure. */}
                      {isReflection ? (
                        <Sparkles className="h-4 w-4 text-foreground/60" />
                      ) : r.status === "ok" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : r.status === "warning" ? (
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-border rounded">
                          {isReflection ? "reflection" : r.actor_type}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {r.action}
                        </span>
                        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                          {new Date(r.created_at).toLocaleTimeString("en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      {isReflection ? (
                        <blockquote className="mt-1.5 border-l-2 border-foreground/25 pl-3 font-serif italic text-foreground/90 leading-relaxed">
                          {r.summary}
                        </blockquote>
                      ) : (
                        <p className="mt-1 text-foreground">{r.summary}</p>
                      )}
                      {isReflection && takeaways.length > 0 && (
                        <ul className="mt-2 pl-3 space-y-1">
                          {takeaways.map((t, i) => (
                            <li key={i} className="text-xs text-muted-foreground">
                              <span className="font-mono text-[10px] uppercase tracking-wider mr-1.5">
                                {t.kind}
                              </span>
                              {t.content}
                            </li>
                          ))}
                        </ul>
                      )}
                      {r.error && <p className="mt-1 text-xs text-red-600">{r.error}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
