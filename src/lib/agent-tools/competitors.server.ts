// Competitor create/delete for the chat agent (server-only).
// The scan itself runs client-side via `analyzeCompetitor`; reading a saved
// report is `getCompetitorAnalysis` in workspace-context.server.
import { logActivity } from "@/lib/activity-log";

type Client = { from: (t: string) => any };

const clean = (v?: string) => (v ?? "").trim().replace(/^@/, "") || undefined;

export async function addCompetitorForAgent(
  db: Client,
  workspaceId: string,
  args: {
    name: string;
    website?: string;
    linkedin?: string;
    instagram?: string;
    tiktok?: string;
    x?: string;
  },
) {
  const name = args.name.trim();
  if (!name) return { ok: false as const, error: "A competitor name is required." };
  const handles = {
    linkedin: (args.linkedin ?? "").trim() || undefined,
    instagram: clean(args.instagram),
    tiktok: clean(args.tiktok),
    x: clean(args.x),
  };
  const { data: existing } = await db
    .from("competitors")
    .select("id,name")
    .eq("workspace_id", workspaceId)
    .ilike("name", name)
    .maybeSingle();
  if (existing)
    return {
      ok: true as const,
      competitorId: existing.id,
      name: existing.name,
      created: false,
      note: "Already saved. Run analyzeCompetitor with this competitorId to (re)scan it.",
    };

  // The model is told "Optional website URL" and routinely supplies a bare
  // domain, which is not a URL. Storing it raw used to crash the Competitors
  // page outright (finding 52) and now renders as unlinked text — so normalise
  // here and hand a correctable error back to the model rather than saving
  // something unusable.
  const { normalizeWebsiteUrl } = await import("@/lib/website-url");
  const website = normalizeWebsiteUrl(args.website);
  if (!website.ok) return { ok: false as const, error: website.error };

  const { data, error } = await db
    .from("competitors")
    .insert({
      workspace_id: workspaceId,
      name,
      website: website.url ?? null,
      socials: {},
      handles,
    })
    .select("id,name")
    .maybeSingle();
  if (error || !data) return { ok: false as const, error: "Could not save that competitor." };
  await logActivity(
    {
      workspaceId,
      actorType: "agent",
      action: "competitor.added",
      summary: `Agent added the competitor "${name}".`,
      relatedType: "competitor",
      relatedId: data.id,
      details: { handles },
    },
    db as never,
  );
  return {
    ok: true as const,
    competitorId: data.id,
    name: data.name,
    created: true,
    handles,
    note: Object.values(handles).some(Boolean)
      ? "Saved. Now call analyzeCompetitor with this competitorId to run the scan."
      : "Saved without handles — a scan needs at least one social handle.",
  };
}

export async function deleteCompetitorForAgent(
  db: Client,
  workspaceId: string,
  competitorId: string,
) {
  const { data, error } = await db
    .from("competitors")
    .delete()
    .eq("id", competitorId)
    .eq("workspace_id", workspaceId)
    .select("id,name")
    .maybeSingle();
  if (error || !data) return { ok: false as const, error: "Could not delete that competitor." };
  await logActivity(
    {
      workspaceId,
      actorType: "agent",
      action: "competitor.deleted",
      summary: `Agent deleted the competitor "${data.name}".`,
      relatedType: "competitor",
      relatedId: competitorId,
    },
    db as never,
  );
  return { ok: true as const, deleted: data.name };
}
