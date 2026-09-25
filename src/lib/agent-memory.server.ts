// Agent memory — the "brand brain" the agent accumulates over time.
// Server-only. Callers pass a Supabase client (service-role from cron, or an
// authenticated client from a server fn).

export type MemoryKind = "lesson" | "insight" | "preference" | "failure";

export type MemoryRow = {
  id: string;
  kind: MemoryKind;
  content: string;
  weight: number;
  source: string | null;
  tags: string[];
  created_at: string;
  last_used_at?: string | null;
};

type Client = {
  from: (t: string) => any;
};

/** Loose fingerprint used to detect a memory we already hold. */
function fingerprint(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 12)
    .sort()
    .join(" ");
}

function similar(a: string, b: string) {
  const A = new Set(fingerprint(a).split(" ").filter(Boolean));
  const B = new Set(fingerprint(b).split(" ").filter(Boolean));
  if (A.size === 0 || B.size === 0) return false;
  let hits = 0;
  for (const w of A) if (B.has(w)) hits++;
  return hits / Math.max(A.size, B.size) >= 0.7;
}

export async function rememberFacts(
  client: Client,
  workspaceId: string,
  facts: Array<{ kind?: MemoryKind; content: string; weight?: number; tags?: string[] }>,
  source: string,
  related?: { type?: string; id?: string },
) {
  const candidates = facts
    .map((f) => ({ ...f, content: (f.content ?? "").trim() }))
    .filter((f) => f.content.length > 3)
    .slice(0, 5);
  if (candidates.length === 0) return 0;

  // Dedup against what we already believe: bump the weight instead of piling up
  // near-identical rows.
  const { data: existing } = await client
    .from("agent_memory")
    .select("id,content,weight")
    .eq("workspace_id", workspaceId)
    // Strongest memories first, so past 300 rows the dedup window degrades
    // toward dropping weak memories rather than arbitrary ones.
    .order("weight", { ascending: false })
    .limit(300);
  const known = (existing ?? []) as Array<{ id: string; content: string; weight: number }>;

  const rows: Array<Record<string, unknown>> = [];
  for (const f of candidates) {
    const dupe = known.find((k) => similar(k.content, f.content));
    if (dupe) {
      await client
        .from("agent_memory")
        .update({
          weight: Math.min(5, Number(dupe.weight ?? 1) + 0.5),
          last_used_at: new Date().toISOString(),
        })
        .eq("id", dupe.id);
      continue;
    }
    rows.push({
      workspace_id: workspaceId,
      kind: f.kind ?? "lesson",
      content: f.content.slice(0, 600),
      weight: typeof f.weight === "number" ? Math.max(0, Math.min(5, f.weight)) : 1,
      source,
      tags: (f.tags ?? []).slice(0, 6),
      related_type: related?.type ?? null,
      related_id: related?.id ?? null,
    });
    known.push({ id: "new", content: f.content, weight: 1 });
  }
  if (rows.length === 0) return 0;
  const { error } = await client.from("agent_memory").insert(rows);
  if (error) {
    console.warn("[agent-memory] insert failed", (error as { message?: string }).message);
    return 0;
  }
  return rows.length;
}

const DECAY_AFTER_DAYS = 90;

/** Compact block of the highest-signal memories, ready to paste into a prompt. */
export async function loadBrandBrain(
  client: Client,
  workspaceId: string,
  limit = 18,
): Promise<string> {
  const { data, error } = await client
    .from("agent_memory")
    .select("id,kind,content,weight,created_at,last_used_at")
    .eq("workspace_id", workspaceId)
    .order("weight", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit * 3);
  if (error || !data || (data as MemoryRow[]).length === 0) return "";

  const now = Date.now();
  const stale = (r: MemoryRow) => {
    const last = r.last_used_at ?? r.created_at;
    return (now - new Date(last).getTime()) / 86400000 > DECAY_AFTER_DAYS;
  };
  // Effective weight decays for memories that have not been used in a long time,
  // so the brain drifts towards what stays relevant.
  const scored = (data as MemoryRow[])
    .map((r) => ({ r, score: Number(r.weight ?? 1) * (stale(r) ? 0.4 : 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.r);
  if (scored.length === 0) return "";

  // Mark them as used so freshly-relevant memories keep their weight.
  const ids = scored.map((r) => r.id).filter(Boolean);
  if (ids.length) {
    void client
      .from("agent_memory")
      .update({ last_used_at: new Date().toISOString() })
      .in("id", ids)
      .then?.(
        () => undefined,
        () => undefined,
      );
  }

  const byKind = (k: MemoryKind) => scored.filter((r) => r.kind === k).map((r) => `- ${r.content}`);
  const sections: string[] = [];
  const push = (label: string, lines: string[]) => {
    if (lines.length) sections.push(`${label}\n${lines.join("\n")}`);
  };
  push("What has worked:", byKind("insight"));
  push("Lessons learned:", byKind("lesson"));
  push("Standing preferences:", byKind("preference"));
  push("Avoid (previously failed):", byKind("failure"));
  if (!sections.length) return "";
  return `## Brand brain (learned from past runs)\n${sections.join("\n\n")}`;
}
