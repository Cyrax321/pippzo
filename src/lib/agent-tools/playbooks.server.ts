// Playbook introspection + editing for the chat agent (server-only).
import { bundledPlaybooks, loadPlaybooks } from "@/lib/playbooks.server";
import { logActivity } from "@/lib/activity-log";

type Client = { from: (t: string) => any };

export async function listPlaybooksForAgent(db: Client | null, workspaceId: string | null) {
  const all = await loadPlaybooks(db, workspaceId);
  return {
    ok: true as const,
    playbooks: all.map((p) => ({
      slug: p.slug,
      name: p.name,
      description: p.description,
      loadWhen: p.loadWhen,
      requires: p.requires,
      enabled: p.enabled !== false,
      overridden: !!p.overridden,
      body: p.body,
    })),
  };
}

export async function updatePlaybookForAgent(
  db: Client,
  workspaceId: string,
  args: { slug: string; body?: string; enabled?: boolean },
) {
  const known = bundledPlaybooks().some((p) => p.slug === args.slug);
  if (!known) return { ok: false as const, error: `No playbook named "${args.slug}".` };
  const row: Record<string, unknown> = {
    workspace_id: workspaceId,
    slug: args.slug,
    updated_at: new Date().toISOString(),
  };
  if (typeof args.body === "string") row.body = args.body.trim();
  if (typeof args.enabled === "boolean") row.enabled = args.enabled;
  if (row.body === undefined && row.enabled === undefined)
    return { ok: false as const, error: "Provide a new body or an enabled flag." };
  const { error } = await db
    .from("workspace_playbooks")
    .upsert(row, { onConflict: "workspace_id,slug" });
  if (error) return { ok: false as const, error: "Could not save that playbook." };
  await logActivity(
    {
      workspaceId,
      actorType: "agent",
      action: "playbook.updated",
      summary: `Agent updated the "${args.slug}" playbook.`,
      details: { slug: args.slug, enabled: args.enabled },
    },
    db as never,
  );
  return { ok: true as const, slug: args.slug };
}
