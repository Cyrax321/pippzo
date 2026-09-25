// Brand profile + brand guide read/write for the chat agent (server-only).
import { logActivity } from "@/lib/activity-log";

type Client = { from: (t: string) => any };

const PROFILE_FIELDS = [
  "name",
  "website",
  "socials",
  "industry",
  "audience",
  "products_services",
  "tone_notes",
] as const;

const GUIDE_TEXT_FIELDS = [
  "personality",
  "tone_of_voice",
  "writing_style",
  "audience_profile",
  "visual_direction",
  "hashtag_style",
  "platform_guidance",
  "emotional_tone",
  "custom_instructions",
] as const;

const GUIDE_LIST_FIELDS = [
  "vocabulary_use",
  "vocabulary_avoid",
  "content_pillars",
  "recurring_themes",
  "preferred_ctas",
  "do_examples",
  "dont_examples",
] as const;

export async function getBrandProfileForAgent(db: Client, workspaceId: string) {
  const { data, error } = await db
    .from("brand_profile")
    .select(PROFILE_FIELDS.join(","))
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) return { ok: false as const, error: "Could not read the brand profile." };
  if (!data) return { ok: true as const, empty: true, profile: null };
  return { ok: true as const, profile: data };
}

export async function updateBrandProfileForAgent(
  db: Client,
  workspaceId: string,
  patch: Record<string, unknown>,
) {
  const clean: Record<string, unknown> = {};
  for (const f of PROFILE_FIELDS) {
    const v = patch[f];
    if (typeof v === "string" && v.trim()) clean[f] = v.trim();
  }
  if (Object.keys(clean).length === 0)
    return { ok: false as const, error: "Nothing to update. Provide at least one field." };
  clean.workspace_id = workspaceId;
  clean.updated_at = new Date().toISOString();
  const { error } = await db.from("brand_profile").upsert(clean, { onConflict: "workspace_id" });
  if (error) return { ok: false as const, error: "Could not save the brand profile." };
  await logActivity(
    {
      workspaceId,
      actorType: "agent",
      action: "brand.profile.updated",
      summary: `Agent updated the brand profile (${Object.keys(clean)
        .filter((k) => k !== "workspace_id" && k !== "updated_at")
        .join(", ")}).`,
      details: clean,
    },
    db as never,
  );
  return {
    ok: true as const,
    updated: Object.keys(clean).filter((k) => k !== "workspace_id" && k !== "updated_at"),
  };
}

export async function getBrandGuideForAgent(db: Client, workspaceId: string) {
  const { data, error } = await db
    .from("brand_guideline")
    .select([...GUIDE_TEXT_FIELDS, ...GUIDE_LIST_FIELDS].join(","))
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) return { ok: false as const, error: "Could not read the brand guide." };
  if (!data) return { ok: true as const, empty: true, guide: null };
  return { ok: true as const, guide: data };
}

export async function updateBrandGuideForAgent(
  db: Client,
  workspaceId: string,
  patch: Record<string, unknown>,
) {
  const clean: Record<string, unknown> = {};
  for (const f of GUIDE_TEXT_FIELDS) {
    const v = patch[f];
    if (typeof v === "string" && v.trim()) clean[f] = v.trim();
  }
  for (const f of GUIDE_LIST_FIELDS) {
    const v = patch[f];
    if (Array.isArray(v) && v.length > 0) clean[f] = v.map(String).filter(Boolean);
  }
  if (Object.keys(clean).length === 0)
    return { ok: false as const, error: "Nothing to update. Provide at least one field." };
  clean.workspace_id = workspaceId;
  clean.updated_at = new Date().toISOString();
  const { error } = await db.from("brand_guideline").upsert(clean, { onConflict: "workspace_id" });
  if (error) return { ok: false as const, error: "Could not save the brand guide." };
  await logActivity(
    {
      workspaceId,
      actorType: "agent",
      action: "brand.guide.updated",
      summary: `Agent updated the brand guide (${Object.keys(clean)
        .filter((k) => k !== "workspace_id" && k !== "updated_at")
        .join(", ")}).`,
      details: clean,
    },
    db as never,
  );
  return {
    ok: true as const,
    updated: Object.keys(clean).filter((k) => k !== "workspace_id" && k !== "updated_at"),
  };
}
