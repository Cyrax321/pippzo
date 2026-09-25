// Detects legacy localStorage data left over from the pre-Supabase build and
// imports it into the current workspace. After a successful import, the legacy
// keys are wiped from the browser.
import { brandStore } from "./brand-store";
import { scheduleStore, type ScheduledPost } from "./schedule-store";
import { competitorsStore, type Competitor } from "./competitors-store";
import type { BrandProfile, BrandGuideline, BrandImage } from "./types";

const KEYS = {
  profile: "sm.brand.profile",
  guideline: "sm.brand.guideline",
  images: "sm.brand.images",
  schedule: "sm.schedule.posts",
  competitors: "sm.competitors",
  seedFlags: ["sm.brand.seeded.v2", "sm.competitors.seeded.v1"],
};

function read<T>(k: string): T | null {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

export function hasLegacyData(): boolean {
  if (typeof window === "undefined") return false;
  return !!(
    read(KEYS.profile) ||
    read(KEYS.guideline) ||
    (read<unknown[]>(KEYS.images)?.length ?? 0) > 0 ||
    (read<unknown[]>(KEYS.schedule)?.length ?? 0) > 0 ||
    (read<unknown[]>(KEYS.competitors)?.length ?? 0) > 0
  );
}

export type ImportSummary = {
  profile: boolean;
  guideline: boolean;
  images: number;
  posts: number;
  competitors: number;
};

export async function importLegacyData(): Promise<ImportSummary> {
  const summary: ImportSummary = {
    profile: false,
    guideline: false,
    images: 0,
    posts: 0,
    competitors: 0,
  };

  const profile = read<BrandProfile>(KEYS.profile);
  if (profile) {
    brandStore.setProfile(profile);
    summary.profile = true;
  }

  const guideline = read<BrandGuideline>(KEYS.guideline);
  if (guideline) {
    brandStore.setGuideline(guideline);
    summary.guideline = true;
  }

  const images = read<BrandImage[]>(KEYS.images) ?? [];
  for (const img of images) {
    await brandStore.addImage(img);
    summary.images += 1;
  }

  const posts = read<ScheduledPost[]>(KEYS.schedule) ?? [];
  for (const p of posts) {
    const { id: _omit, createdAt: _omit2, ...rest } = p;
    void _omit;
    void _omit2;
    scheduleStore.add({ ...rest, id: p.id });
    summary.posts += 1;
  }

  const competitors = read<Competitor[]>(KEYS.competitors) ?? [];
  for (const c of competitors) {
    competitorsStore.add({
      name: c.name,
      website: c.website,
      socials: c.socials,
      snapshot: c.snapshot,
    });
    summary.competitors += 1;
  }

  // wipe
  try {
    for (const k of [
      KEYS.profile,
      KEYS.guideline,
      KEYS.images,
      KEYS.schedule,
      KEYS.competitors,
      ...KEYS.seedFlags,
    ]) {
      localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }

  return summary;
}
