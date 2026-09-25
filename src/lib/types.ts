export type BrandProfile = {
  name: string;
  website: string;
  socials: string;
  industry: string;
  audience: string;
  productsServices: string;
  toneNotes: string;
};

export type ColorSwatch = { name: string; hex: string };
export type Typography = {
  headingFont?: string;
  bodyFont?: string;
  monoFont?: string;
  notes?: string;
};

export type BrandGuideline = {
  personality: string;
  toneOfVoice: string;
  writingStyle: string;
  vocabularyUse: string[];
  vocabularyAvoid: string[];
  contentPillars: string[];
  audienceProfile: string;
  recurringThemes: string[];
  preferredCTAs: string[];
  doExamples: string[];
  dontExamples: string[];
  visualDirection: string;
  hashtagStyle: string;
  platformGuidance: string;
  emotionalTone: string;
  customInstructions: string;
  // Visual identity (optional so legacy guideline objects still satisfy the type)
  colorPalette?: ColorSwatch[];
  typography?: Typography;
  logoAssetId?: string | null;
};

// Library asset — image or video. Kept the `BrandImage` name for backwards
// compatibility with existing components, but a single asset can now be a
// video with `kind === "video"`, in which case `dataUrl` holds the poster
// (thumbnail) and `videoUrl` holds the playable video (signed URL).
export type BrandImage = {
  id: string;
  dataUrl: string; // image src OR poster/thumbnail for video
  name: string;
  approved: boolean;
  analysis?: string;
  addedAt: number;
  kind?: "image" | "video"; // defaults to "image" if omitted
  videoUrl?: string; // set when kind === "video"
  durationSec?: number;
  mimeType?: string;
  sizeBytes?: number;
};

export type LibraryAsset = BrandImage; // alias for clarity

export type Platform = "linkedin" | "instagram" | "tiktok" | "x" | "facebook";

export type GeneratedPost = {
  platform: Platform;
  caption: string;
  alternativeHooks: string[];
  shortVersion: string;
  longVersion: string;
  hashtags: string[];
  visualConcept: string;
  cta: string;
  angle: string;
};

export type QualityCheck = {
  brandVoice: { pass: boolean; note: string };
  spanishSpain: { pass: boolean; note: string };
  notAiSounding: { pass: boolean; note: string };
  bannedWords: { pass: boolean; note: string };
  clearPurpose: { pass: boolean; note: string };
  strongHook: { pass: boolean; note: string };
  appropriateCta: { pass: boolean; note: string };
  platformFormat: { pass: boolean; note: string };
  score: number;
};

export type VideoProviderKind =
  "veo" | "gemini-omni" | "seedance" | "kling" | "runway" | "luma" | "custom";
export type VideoProvider = {
  id: string;
  provider: VideoProviderKind;
  label: string;
  hasKey: boolean;
  baseUrl?: string;
  defaultModel?: string;
  createdAt: number;
};

export type ImageProviderKind = "openai" | "gemini" | "azure";
export type ImageProvider = {
  id: string;
  provider: ImageProviderKind;
  label: string;
  hasKey: boolean;
  baseUrl?: string;
  defaultModel?: string;
  isDefault: boolean;
  createdAt: number;
};
