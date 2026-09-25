// Connection / capability status for the chat agent (server-only).
// NEVER returns keys or secrets — only whether something is configured.
type Client = { from: (t: string) => any };

async function count(db: Client, table: string, workspaceId: string, select: string) {
  const { data } = await db.from(table).select(select).eq("workspace_id", workspaceId).limit(20);
  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function getConnectionStatusForAgent(db: Client, workspaceId: string) {
  const [llm, image, video, services, buffer, unipile, notif, ws] = await Promise.all([
    count(db, "llm_providers", workspaceId, "provider,label,default_model,is_default"),
    count(db, "image_providers", workspaceId, "provider,label,default_model,is_default"),
    count(db, "video_providers", workspaceId, "provider,label,default_model"),
    count(db, "service_credentials", workspaceId, "service,label"),
    db.from("buffer_connection").select("channels").eq("workspace_id", workspaceId).maybeSingle(),
    count(db, "engagement_accounts", workspaceId, "provider,network,name,status,last_synced_at"),
    db
      .from("notification_settings")
      .select("slack_webhook_enc,on_approval,on_failure,on_cap,on_digest")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    db
      .from("workspaces")
      .select("require_approval,automations_enabled")
      .eq("id", workspaceId)
      .maybeSingle(),
  ]);

  const channels = (
    (buffer?.data?.channels as Array<{ service?: string; name?: string }>) ?? []
  ).map((c) => ({
    service: c.service,
    name: c.name,
  }));
  const n = notif?.data as Record<string, unknown> | null;
  const wsRow = ws?.data as { require_approval?: boolean; automations_enabled?: boolean } | null;

  return {
    ok: true as const,
    // Workspace-level gates the agent must respect before promising a publish
    // or an automation run.
    requireApproval: !!wsRow?.require_approval,
    automationsEnabled: wsRow?.automations_enabled !== false,
    textModels: llm.map((p) => ({
      provider: p.provider,
      label: p.label,
      model: p.default_model,
      isDefault: p.is_default,
    })),
    imageProviders: image.map((p) => ({
      provider: p.provider,
      label: p.label,
      model: p.default_model,
      isDefault: p.is_default,
    })),
    videoProviders: video.map((p) => ({
      provider: p.provider,
      label: p.label,
      model: p.default_model,
    })),
    services: services.map((s) => ({ service: s.service, label: s.label })),
    buffer: { connected: channels.length > 0, channels },
    engagementAccounts: unipile.map((a) => ({
      provider: a.provider,
      network: a.network,
      name: a.name,
      status: a.status,
      lastSyncedAt: a.last_synced_at,
    })),
    // No email field on purpose: an email transport does not exist, so
    // reporting one here made the agent claim a channel that cannot send.
    notifications: n
      ? {
          slack: !!n.slack_webhook_enc,
          onApproval: n.on_approval,
          onFailure: n.on_failure,
          onCap: n.on_cap,
          onDigest: n.on_digest,
        }
      : { slack: false },
    note: "Secrets are never exposed. If something the user wants is missing, tell them to add it in Settings → Connections.",
  };
}
