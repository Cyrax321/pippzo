// Competitors store — Supabase-backed per workspace.
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logActivityFn } from "./activity-log";
import { normalizeWebsiteUrl } from "./website-url";

export type KV = { label: string; value: string };
export type TitleBody = { title: string; body: string };
export type ActivityEntry = {
  date: string;
  network?: string;
  text: string;
  highlight?: string;
  url?: string;
};

export type CompetitorSnapshot = {
  postingFrequency: string;
  dominantFormats: string[];
  recurringThemes: string[];
  tone: string;
  recentPosts: string[];
  estimatedAudience: string;
  strengths: string[];
  weaknesses: string[];
  opportunitiesForUs: string[];
  scannedAt: number;

  // Rich analyst layer (optional for legacy snapshots)
  subtitle?: string;
  dek?: string;
  profileNote?: string;
  stats?: KV[];
  positioning?: KV[];
  contentStrategy?: { cadence: string; format: string; voice: string; recurringDevice: string };
  activityLog?: ActivityEntry[];
  strengthsDetailed?: TitleBody[];
  vulnerabilities?: TitleBody[];
  keyTakeaways?: TitleBody[];
  closingQuote?: string;
  networks?: Record<
    string,
    {
      posts_scanned: number;
      cadence_per_week?: number;
      engagement_median: number;
      top_format?: string;
      error?: string;
    }
  >;
};

export type Competitor = {
  id: string;
  name: string;
  website?: string;
  socials: {
    linkedin?: string;
    instagram?: string;
    tiktok?: string;
    x?: string;
    facebook?: string;
  };
  snapshot?: CompetitorSnapshot;
  createdAt: number;
};

type Row = {
  id: string;
  workspace_id: string;
  name: string;
  website: string | null;
  socials: Competitor["socials"];
  snapshot: CompetitorSnapshot | null;
  created_at: string;
};
const rowToCompetitor = (r: Row): Competitor => ({
  id: r.id,
  name: r.name,
  website: r.website ?? undefined,
  socials: r.socials ?? {},
  snapshot: r.snapshot ?? undefined,
  createdAt: new Date(r.created_at).getTime(),
});

type Listener = () => void;
const listeners = new Set<Listener>();
let workspaceId: string | null = null;
let cache: Competitor[] = [];
let hydratedForWorkspace: string | null = null;
const EMPTY: Competitor[] = [];

const emit = () => listeners.forEach((l) => l());

/**
 * Last line of defence for the competitor `website` column (finding 52).
 *
 * `example.com` is how most people write a website, and stored raw it is not a
 * URL — it cannot become a link, and the read side degrades it to plain text.
 * Every write through this store is normalised here so a bare domain becomes
 * `https://example.com` and something that is not an address at all never
 * reaches the database.
 *
 * The store DROPS an unusable value and says so, rather than throwing: the
 * add-competitor form validates first and refuses to submit (the user gets to
 * fix their typo), but the other callers — the chat flow and the legacy
 * importer — create the competitor in the middle of a longer sequence, and
 * aborting that over an optional field would lose more than it saves.
 */
function normalizeWebsiteForWrite(website: string | undefined): string | undefined {
  const result = normalizeWebsiteUrl(website);
  if (result.ok) return result.url;
  console.warn("[competitors] dropping unusable website", website, result.error);
  toast.error(`${result.error} Saved without a website.`);
  return undefined;
}

async function hydrate() {
  if (!workspaceId || hydratedForWorkspace === workspaceId) return;
  const ws = workspaceId;
  const { data, error } = await supabase
    .from("competitors")
    .select("*")
    .eq("workspace_id", ws)
    .order("created_at", { ascending: false });
  if (workspaceId !== ws) return;
  if (error) {
    console.error("[competitors] hydrate failed", error);
    return;
  }
  cache = (data as unknown as Row[]).map(rowToCompetitor);
  hydratedForWorkspace = ws;
  emit();
}

export const competitorsStore = {
  setWorkspace(id: string | null) {
    if (id === workspaceId) return;
    workspaceId = id;
    hydratedForWorkspace = null;
    cache = [];
    emit();
    if (id) void hydrate();
  },
  subscribe(l: Listener) {
    void hydrate();
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  getAll(): Competitor[] {
    return cache;
  },
  add(c: Omit<Competitor, "id" | "createdAt"> & { handles?: Record<string, string | undefined> }) {
    const { handles, ...rest } = c;
    const full: Competitor = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      ...rest,
      website: normalizeWebsiteForWrite(rest.website),
    };
    cache = [full, ...cache];
    emit();
    if (workspaceId) {
      const ws = workspaceId;
      return supabase
        .from("competitors")
        .insert({
          id: full.id,
          workspace_id: ws,
          name: full.name,
          website: full.website ?? null,
          socials: full.socials,
          snapshot: full.snapshot ?? null,
          ...(handles ? { handles: handles as never } : {}),
        })
        .then(({ error }) => {
          if (error) {
            console.error("[competitors] add failed", error);
            toast.error("Could not save competitor");
          } else
            logActivityFn({
              workspaceId: ws,
              action: "competitor.added",
              summary: `Added competitor "${full.name}"`,
              relatedType: "competitor",
              relatedId: full.id,
            });
          return full;
        });
    }
    return Promise.resolve(full);
  },
  update(
    id: string,
    patch: Partial<Competitor> & { handles?: Record<string, string | undefined> },
  ) {
    const { handles, ...patched } = patch;
    // Same normalisation as `add`: a patch is a write path too, and a bare
    // domain arriving through it would be just as unusable.
    const rest =
      patched.website !== undefined
        ? { ...patched, website: normalizeWebsiteForWrite(patched.website) }
        : patched;
    cache = cache.map((c) => (c.id === id ? { ...c, ...rest } : c));
    emit();
    if (!workspaceId) return;
    type CompUpdate = {
      name?: string;
      website?: string | null;
      socials?: Competitor["socials"];
      snapshot?: CompetitorSnapshot | null;
      handles?: Record<string, string | undefined>;
    };
    const dbPatch: CompUpdate = {};
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.website !== undefined) dbPatch.website = rest.website ?? null;
    if (patch.socials !== undefined) dbPatch.socials = patch.socials;
    if (patch.snapshot !== undefined) dbPatch.snapshot = patch.snapshot ?? null;
    // Both creation paths persist scan handles in `handles`; dropping it here
    // meant updating a competitor's handles silently never reached the DB.
    if (handles !== undefined) dbPatch.handles = handles;
    if (Object.keys(dbPatch).length === 0) return;
    const ws = workspaceId;
    void supabase
      .from("competitors")
      .update(dbPatch as never)
      .eq("id", id)
      .then(({ error }) => {
        if (error) {
          console.error("[competitors] update failed", error);
          toast.error("Could not update competitor");
        } else if (patch.snapshot) {
          const name = cache.find((c) => c.id === id)?.name ?? "competitor";
          logActivityFn({
            workspaceId: ws,
            action: "competitor.analyzed",
            summary: `Analyzed "${name}"`,
            relatedType: "competitor",
            relatedId: id,
          });
        }
      });
  },
  remove(id: string) {
    const existing = cache.find((c) => c.id === id);
    cache = cache.filter((c) => c.id !== id);
    emit();
    const ws = workspaceId;
    void supabase
      .from("competitors")
      .delete()
      .eq("id", id)
      .then(({ error }) => {
        if (error) console.error("[competitors] remove failed", error);
        else if (ws && existing)
          logActivityFn({
            workspaceId: ws,
            action: "competitor.removed",
            summary: `Removed "${existing.name}"`,
            relatedType: "competitor",
            relatedId: id,
          });
      });
  },
};

function useHydrated() {
  const [h, setH] = useState(false);
  useEffect(() => setH(true), []);
  return h;
}
export function useCompetitors() {
  const h = useHydrated();
  const v = useSyncExternalStore(
    competitorsStore.subscribe,
    () => cache,
    () => EMPTY,
  );
  return h ? v : EMPTY;
}
