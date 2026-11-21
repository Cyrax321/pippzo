// Brand store — Supabase-backed (per workspace) with a synchronous read API
// kept compatible with existing components. Hydrates async after a workspace
// is set via `brandStore.setWorkspace(id)`.
//
// Mutations are optimistic: cache is updated immediately and emitted; the
// async write is fire-and-forget but logs failures.

import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  groupTargetsByBucket,
  libraryAssetStorageTargets,
  type LibraryAssetPaths,
  type StorageObjectRef,
} from "./media-upload.functions";
import type { BrandProfile, BrandGuideline, BrandImage, ColorSwatch, Typography } from "./types";

type Listener = () => void;
const listeners = new Set<Listener>();

let workspaceId: string | null = null;
let cacheProfile: BrandProfile | null = null;
let cacheGuideline: BrandGuideline | null = null;
let cacheImages: BrandImage[] = [];
let hydratedForWorkspace: string | null = null;
let inflight: Promise<void> | null = null;
const EMPTY_IMAGES: BrandImage[] = [];

const emit = () => listeners.forEach((l) => l());

// ---- Row <-> domain mapping --------------------------------------------------
type ProfileRow = {
  workspace_id: string;
  name: string;
  website: string;
  socials: string;
  industry: string;
  audience: string;
  products_services: string;
  tone_notes: string;
};
const rowToProfile = (r: ProfileRow): BrandProfile => ({
  name: r.name,
  website: r.website,
  socials: r.socials,
  industry: r.industry,
  audience: r.audience,
  productsServices: r.products_services,
  toneNotes: r.tone_notes,
});
const profileToRow = (workspace_id: string, p: BrandProfile): ProfileRow => ({
  workspace_id,
  name: p.name,
  website: p.website,
  socials: p.socials,
  industry: p.industry,
  audience: p.audience,
  products_services: p.productsServices,
  tone_notes: p.toneNotes,
});

type GuidelineRow = {
  workspace_id: string;
  personality: string;
  tone_of_voice: string;
  writing_style: string;
  vocabulary_use: string[];
  vocabulary_avoid: string[];
  content_pillars: string[];
  audience_profile: string;
  recurring_themes: string[];
  preferred_ctas: string[];
  do_examples: string[];
  dont_examples: string[];
  visual_direction: string;
  hashtag_style: string;
  platform_guidance: string;
  emotional_tone: string;
  custom_instructions: string;
  color_palette?: ColorSwatch[] | null;
  typography?: Typography | null;
  logo_asset_id?: string | null;
};
const rowToGuideline = (r: GuidelineRow): BrandGuideline => ({
  personality: r.personality,
  toneOfVoice: r.tone_of_voice,
  writingStyle: r.writing_style,
  vocabularyUse: r.vocabulary_use ?? [],
  vocabularyAvoid: r.vocabulary_avoid ?? [],
  contentPillars: r.content_pillars ?? [],
  audienceProfile: r.audience_profile,
  recurringThemes: r.recurring_themes ?? [],
  preferredCTAs: r.preferred_ctas ?? [],
  doExamples: r.do_examples ?? [],
  dontExamples: r.dont_examples ?? [],
  visualDirection: r.visual_direction,
  hashtagStyle: r.hashtag_style,
  platformGuidance: r.platform_guidance,
  emotionalTone: r.emotional_tone,
  customInstructions: r.custom_instructions,
  colorPalette: Array.isArray(r.color_palette) ? r.color_palette : [],
  typography: r.typography && typeof r.typography === "object" ? r.typography : {},
  logoAssetId: r.logo_asset_id ?? null,
});
const guidelineToRow = (workspace_id: string, g: BrandGuideline): GuidelineRow => ({
  workspace_id,
  personality: g.personality,
  tone_of_voice: g.toneOfVoice,
  writing_style: g.writingStyle,
  vocabulary_use: g.vocabularyUse,
  vocabulary_avoid: g.vocabularyAvoid,
  content_pillars: g.contentPillars,
  audience_profile: g.audienceProfile,
  recurring_themes: g.recurringThemes,
  preferred_ctas: g.preferredCTAs,
  do_examples: g.doExamples,
  dont_examples: g.dontExamples,
  visual_direction: g.visualDirection,
  hashtag_style: g.hashtagStyle,
  platform_guidance: g.platformGuidance,
  emotional_tone: g.emotionalTone,
  custom_instructions: g.customInstructions,
  color_palette: g.colorPalette ?? [],
  typography: g.typography ?? {},
  logo_asset_id: g.logoAssetId ?? null,
});

type ImageRow = {
  id: string;
  workspace_id: string;
  storage_path: string | null;
  storage_path_video?: string | null;
  url: string;
  name: string;
  approved: boolean;
  analysis: string | null;
  created_at: string;
  kind?: string | null;
  video_url?: string | null;
  poster_url?: string | null;
  duration_sec?: number | null;
  mime_type?: string | null;
  size_bytes?: number | null;
};
const rowToImage = (r: ImageRow): BrandImage => ({
  id: r.id,
  dataUrl: r.poster_url ?? r.url,
  name: r.name,
  approved: r.approved,
  analysis: r.analysis ?? undefined,
  addedAt: new Date(r.created_at).getTime(),
  kind: (r.kind as "image" | "video") ?? "image",
  videoUrl: r.video_url ?? undefined,
  durationSec: r.duration_sec ?? undefined,
  mimeType: r.mime_type ?? undefined,
  sizeBytes: r.size_bytes ?? undefined,
});

// ---- Hydration ---------------------------------------------------------------
async function hydrate(force = false) {
  if (!workspaceId) return;
  if (!force && hydratedForWorkspace === workspaceId) return;
  if (inflight) return inflight;
  const ws = workspaceId;
  inflight = (async () => {
    try {
      const [pRes, gRes, iRes] = await Promise.all([
        supabase.from("brand_profile").select("*").eq("workspace_id", ws).maybeSingle(),
        supabase.from("brand_guideline").select("*").eq("workspace_id", ws).maybeSingle(),
        supabase
          .from("brand_images")
          .select("*")
          .eq("workspace_id", ws)
          .order("created_at", { ascending: false }),
      ]);
      if (workspaceId !== ws) return; // workspace changed mid-flight
      if (pRes.error) console.error("[brand] profile hydrate failed", pRes.error);
      if (gRes.error) console.error("[brand] guideline hydrate failed", gRes.error);
      if (iRes.error) {
        // Transient error (e.g. statement timeout): DO NOT mark hydrated,
        // so subsequent subscribers retry. Also surface to the user.
        console.error("[brand] images hydrate failed", iRes.error);
        toast.error("Could not load library. Retrying…");
        return;
      }
      cacheProfile = pRes.data ? rowToProfile(pRes.data as ProfileRow) : null;
      cacheGuideline = gRes.data ? rowToGuideline(gRes.data as unknown as GuidelineRow) : null;
      cacheImages = (iRes.data as ImageRow[] | null)?.map(rowToImage) ?? [];
      hydratedForWorkspace = ws;
      emit();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// ---- Writes (optimistic) -----------------------------------------------------
async function persistProfile(p: BrandProfile) {
  if (!workspaceId) return;
  const { error } = await supabase
    .from("brand_profile")
    .upsert(profileToRow(workspaceId, p), { onConflict: "workspace_id" });
  if (error) {
    console.error("[brand] persist profile failed", error);
    toast.error("Could not save brand profile");
  }
}
async function persistGuideline(g: BrandGuideline) {
  if (!workspaceId) return;
  const { error } = await supabase
    .from("brand_guideline")
    .upsert(guidelineToRow(workspaceId, g) as any, { onConflict: "workspace_id" });
  if (error) {
    console.error("[brand] persist guideline failed", error);
    toast.error("Could not save guide");
  }
}

/**
 * Best-effort removal of the objects behind a library asset.
 *
 * Deliberately non-fatal (docs/bugs.md finding 16): a storage delete that fails
 * — a revoked policy, an object already gone, a network blip — must never stop
 * someone removing an asset from their library. It is logged rather than
 * toasted, because from the user's point of view the delete succeeded; what is
 * left behind is a file for the orphan sweep, not something they can act on.
 *
 * This goes through the *user's* client, not a service-role one: the `media`
 * and `buffer-media` delete policies already scope objects to workspace members
 * by the leading path segment, so no elevated key is needed to do it correctly.
 */
async function removeStorageObjects(targets: StorageObjectRef[]) {
  if (targets.length === 0) return;
  for (const [bucket, paths] of groupTargetsByBucket(targets)) {
    try {
      const { error } = await supabase.storage.from(bucket).remove(paths);
      if (error)
        console.warn(`[brand] storage cleanup failed (${bucket}: ${paths.join(", ")})`, error);
    } catch (e) {
      console.warn(`[brand] storage cleanup threw (${bucket}: ${paths.join(", ")})`, e);
    }
  }
}

/**
 * Where an uploaded asset's bytes already live, when the caller uploaded them
 * before writing the row (see `uploadLibraryImage`).
 */
export type AssetStorage = { path?: string | null; videoPath?: string | null };

export const brandStore = {
  setWorkspace(id: string | null) {
    if (id === workspaceId) return;
    workspaceId = id;
    hydratedForWorkspace = null;
    cacheProfile = null;
    cacheGuideline = null;
    cacheImages = EMPTY_IMAGES;
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
  refresh: () => hydrate(true),
  getProfile: (): BrandProfile | null => cacheProfile,
  setProfile: (p: BrandProfile) => {
    cacheProfile = p;
    emit();
    void persistProfile(p);
  },
  getGuideline: (): BrandGuideline | null => cacheGuideline,
  setGuideline: (g: BrandGuideline) => {
    cacheGuideline = g;
    emit();
    void persistGuideline(g);
  },
  getImages: (): BrandImage[] => cacheImages,
  setImages: (imgs: BrandImage[]) => {
    cacheImages = imgs;
    emit(); /* bulk set is local-only */
  },
  /**
   * Files an asset in the library.
   *
   * `storage` is optional and carries the object paths when the bytes were
   * already uploaded (the image and video upload server functions both return
   * them). Callers that still pass a data URL keep working unchanged — the
   * column simply stays null, and the row is the legacy base64 shape.
   */
  addImage: async (img: BrandImage, storage?: AssetStorage) => {
    if (!workspaceId) return;
    cacheImages = [img, ...cacheImages];
    emit();
    const kind = img.kind ?? "image";
    const { error } = await supabase.from("brand_images").insert({
      id: img.id,
      workspace_id: workspaceId,
      url: img.dataUrl,
      name: img.name,
      approved: img.approved,
      analysis: img.analysis ?? null,
      kind,
      storage_path: storage?.path ?? null,
      storage_path_video: storage?.videoPath ?? null,
      video_url: img.videoUrl ?? null,
      poster_url: kind === "video" ? img.dataUrl : null,
      duration_sec: img.durationSec ?? null,
      mime_type: img.mimeType ?? null,
      size_bytes: img.sizeBytes ?? null,
    });
    if (error) {
      console.error("[brand] add asset failed", error);
      toast.error("Could not save asset");
      // Ordering: bytes go to storage first, the row second. That way a row
      // never points at an object that does not exist — but it leaves this
      // case, where the object exists and no row will ever reference it. Undo
      // the upload rather than leak it, and take the optimistic entry back out
      // of the cache so the grid stops showing an asset that was not saved.
      cacheImages = cacheImages.filter((i) => i.id !== img.id);
      emit();
      if (storage?.path || storage?.videoPath)
        await removeStorageObjects(
          libraryAssetStorageTargets({
            storage_path: storage.path ?? null,
            storage_path_video: storage.videoPath ?? null,
            url: img.dataUrl,
            video_url: img.videoUrl ?? null,
          }),
        );
    }
  },
  updateImage: async (id: string, patch: Partial<BrandImage>) => {
    cacheImages = cacheImages.map((i) => (i.id === id ? { ...i, ...patch } : i));
    emit();
    if (!workspaceId) return;
    type ImgUpdate = {
      name?: string;
      approved?: boolean;
      analysis?: string | null;
      url?: string;
      poster_url?: string;
      video_url?: string;
      kind?: string;
    };
    const dbPatch: ImgUpdate = {};
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.approved !== undefined) dbPatch.approved = patch.approved;
    if (patch.analysis !== undefined) dbPatch.analysis = patch.analysis ?? null;
    if (patch.dataUrl !== undefined) dbPatch.url = patch.dataUrl;
    if (Object.keys(dbPatch).length === 0) return;
    const { error } = await supabase.from("brand_images").update(dbPatch).eq("id", id);
    if (error) {
      console.error("[brand] update asset failed", error);
      toast.error("Could not update asset");
    }
  },
  removeImage: async (id: string) => {
    cacheImages = cacheImages.filter((i) => i.id !== id);
    emit();
    // Delete the row and ask for it back in the same round trip: the returned
    // row carries the storage paths, and nothing is removed from storage unless
    // the row really went away (a delete blocked by RLS returns no rows). The
    // reverse order would risk deleting files for a row that survives.
    const { data, error } = await supabase
      .from("brand_images")
      .delete()
      .eq("id", id)
      .select("url,video_url,storage_path,storage_path_video");
    if (error) {
      console.error("[brand] remove asset failed", error);
      toast.error("Could not delete asset");
      return;
    }
    const row = (data as LibraryAssetPaths[] | null)?.[0];
    // No row (already deleted elsewhere) or a legacy base64 `url`: nothing to
    // clean up, `libraryAssetStorageTargets` returns an empty list for the
    // latter because a data URL has no object behind it.
    if (row) await removeStorageObjects(libraryAssetStorageTargets(row));
  },
};

function useHydrated() {
  const [h, setH] = useState(false);
  useEffect(() => setH(true), []);
  return h;
}

export function useBrandProfile() {
  const h = useHydrated();
  const p = useSyncExternalStore(
    brandStore.subscribe,
    () => cacheProfile,
    () => null,
  );
  return h ? p : null;
}
export function useBrandGuideline() {
  const h = useHydrated();
  const g = useSyncExternalStore(
    brandStore.subscribe,
    () => cacheGuideline,
    () => null,
  );
  return h ? g : null;
}
export function useBrandImages() {
  const h = useHydrated();
  const imgs = useSyncExternalStore(
    brandStore.subscribe,
    () => cacheImages,
    () => EMPTY_IMAGES,
  );
  return h ? imgs : EMPTY_IMAGES;
}

// ---- Brand context summary ---------------------------------------------------
//
// This block is the single highest-value context the agent receives: it is what
// makes a post sound like the brand instead of like a generic AI account. The
// per-field caps below used to be tight enough (220 chars for voice, 280 for
// custom instructions, 4 of N do/don't rules) that a properly written guide was
// cut mid-sentence and the rules that matter most never arrived.
//
// The caps are now sized so the voice-critical fields survive intact —
// personality, tone, style, the do/don't rules and the custom instructions —
// because a half-sentence of voice guidance is worse than none. Costs roughly
// 2.5k tokens per turn, which is the correct trade for the thing the product
// exists to get right.
const MAX_CONTEXT_CHARS = 12000;
const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

export type BrandContextMeta = {
  hasProfile: boolean;
  hasGuideline: boolean;
  approvedImages: number;
  chars: number;
};

export function brandContextSummary(): string {
  const p = brandStore.getProfile();
  const g = brandStore.getGuideline();
  const imgs = brandStore.getImages();
  const approved = imgs.filter((i) => i.approved);
  const parts: string[] = [];
  if (p) {
    parts.push(`BRAND: ${p.name}`);
    if (p.website) parts.push(`Website: ${p.website}`);
    if (p.industry) parts.push(`Industry: ${p.industry}`);
    if (p.audience) parts.push(`Audience: ${truncate(p.audience, 240)}`);
    if (p.productsServices) parts.push(`Products/services: ${truncate(p.productsServices, 240)}`);
    if (p.socials) parts.push(`Socials: ${p.socials}`);
    if (p.toneNotes) parts.push(`Tone notes: ${truncate(p.toneNotes, 240)}`);
  }
  if (g) {
    parts.push("\nSOCIAL MEDIA GUIDE:");
    // Voice fields are sent whole: these three decide whether the output sounds
    // like the brand at all.
    if (g.personality) parts.push(`Personality: ${truncate(g.personality, 900)}`);
    if (g.toneOfVoice) parts.push(`Tone: ${truncate(g.toneOfVoice, 900)}`);
    if (g.writingStyle) parts.push(`Style: ${truncate(g.writingStyle, 900)}`);
    if (g.emotionalTone) parts.push(`Emotion: ${truncate(g.emotionalTone, 400)}`);
    if (g.audienceProfile) parts.push(`Audience: ${truncate(g.audienceProfile, 500)}`);
    if (g.vocabularyUse?.length) parts.push(`Use: ${g.vocabularyUse.slice(0, 40).join(", ")}`);
    if (g.vocabularyAvoid?.length)
      parts.push(`Avoid: ${g.vocabularyAvoid.slice(0, 40).join(", ")}`);
    if (g.contentPillars?.length)
      parts.push(`Pillars: ${g.contentPillars.slice(0, 10).join("; ")}`);
    if (g.recurringThemes?.length)
      parts.push(`Recurring themes: ${g.recurringThemes.slice(0, 12).join("; ")}`);
    if (g.preferredCTAs?.length) parts.push(`CTAs: ${g.preferredCTAs.slice(0, 10).join(" / ")}`);
    // Newline-separated, not " | " — these are rules, and several of them are a
    // full sentence long. Every rule is sent: a don't-rule that never arrives is
    // a guardrail that does not exist.
    if (g.doExamples?.length)
      parts.push(
        `Do:\n- ${g.doExamples
          .slice(0, 12)
          .map((s) => truncate(s, 300))
          .join("\n- ")}`,
      );
    if (g.dontExamples?.length)
      parts.push(
        `Don't:\n- ${g.dontExamples
          .slice(0, 12)
          .map((s) => truncate(s, 400))
          .join("\n- ")}`,
      );
    if (g.hashtagStyle) parts.push(`Hashtags: ${truncate(g.hashtagStyle, 300)}`);
    if (g.platformGuidance) parts.push(`Platforms: ${truncate(g.platformGuidance, 800)}`);
    if (g.visualDirection) parts.push(`Visual direction: ${truncate(g.visualDirection, 800)}`);
    if (g.colorPalette?.length)
      parts.push(
        `Palette: ${g.colorPalette
          .slice(0, 8)
          .map((c) => `${c.name || "color"} ${c.hex}`)
          .join(", ")}`,
      );
    if (g.typography?.headingFont || g.typography?.bodyFont)
      parts.push(
        `Typography: heading ${g.typography.headingFont ?? "?"}, body ${g.typography.bodyFont ?? "?"}`,
      );
    // Where the brand's own frameworks and hard rules live. Previously capped at
    // 280 chars, which silently dropped almost all of it.
    if (g.customInstructions)
      parts.push(`Extra instructions:\n${truncate(g.customInstructions, 2500)}`);
  }
  if (approved.length) {
    parts.push(`\nApproved visual references: ${approved.length}.`);
    approved.slice(0, 4).forEach((i, idx) => {
      if (i.analysis)
        parts.push(`Asset ${idx + 1} (${i.kind ?? "image"}): ${truncate(i.analysis, 180)}`);
    });
  }
  return truncate(parts.join("\n"), MAX_CONTEXT_CHARS);
}

export function brandContextMeta(): BrandContextMeta {
  const p = brandStore.getProfile();
  const g = brandStore.getGuideline();
  const approved = brandStore.getImages().filter((i) => i.approved).length;
  return {
    hasProfile: !!p,
    hasGuideline: !!g,
    approvedImages: approved,
    chars: brandContextSummary().length,
  };
}
