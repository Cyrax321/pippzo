// Library asset detail lookup for the chat agent (server-only).
type Client = { from: (t: string) => any };

export async function getLibraryAssetForAgent(
  db: Client,
  workspaceId: string,
  args: { assetId?: string; name?: string },
) {
  let q = db
    .from("brand_images")
    .select(
      "id,kind,name,url,video_url,poster_url,approved,analysis,duration_sec,mime_type,created_at",
    )
    .eq("workspace_id", workspaceId)
    .limit(1);
  if (args.assetId) q = q.eq("id", args.assetId);
  else if (args.name?.trim()) q = q.ilike("name", `%${args.name.trim()}%`);
  else return { ok: false as const, error: "Provide an assetId or a name." };
  const { data, error } = await q;
  if (error) return { ok: false as const, error: "Could not read the library." };
  const asset = (data ?? [])[0];
  if (!asset) return { ok: false as const, error: "No matching asset in the library." };
  return {
    ok: true as const,
    asset,
    note:
      asset.kind === "video"
        ? "This is a video: pass its id as imageId to schedulePost or bufferSchedulePost and the chat resolves it to the native video attachment. Video ids canNOT be used as generateImage reference ids."
        : "Pass this id as imageId to schedulePost, or as a reference id to generateImage to preserve its look.",
  };
}
