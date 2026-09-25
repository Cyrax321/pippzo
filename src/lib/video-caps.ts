// Video format capability matrix — what each provider can generate vs. what
// each platform accepts at publish time. Shared by server (system prompt) and
// client (provider pick). Facts verified against provider API docs and
// Buffer's media requirements (Aug 2026).

export type VideoProviderCaps = {
  label: string;
  aspectRatios: string[]; // what the adapter can request (app exposes 16:9 / 9:16)
  minSec: number;
  maxSec: number;
  maxResolution: string;
  audio: boolean;
  notes?: string;
};

export const PROVIDER_VIDEO_CAPS: Record<string, VideoProviderCaps> = {
  veo: {
    label: "Google Veo 3.1",
    aspectRatios: ["16:9", "9:16"],
    minSec: 4,
    maxSec: 8,
    maxResolution: "1080p",
    audio: true,
    notes: "Durations are fixed steps (4, 6 or 8s) — longer briefs get clamped to 8s.",
  },
  "gemini-omni": {
    label: "Gemini Omni Flash",
    aspectRatios: ["16:9", "9:16"],
    minSec: 3,
    maxSec: 10,
    maxResolution: "720p",
    audio: true,
    notes: "Fast and conversational; 720p only, so avoid for placements that reward crispness.",
  },
  seedance: {
    label: "Seedance (BytePlus)",
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
    minSec: 4,
    maxSec: 15,
    maxResolution: "4K",
    audio: true,
    notes: "Seedance 2.5 reaches 30s. Rejects reference images containing real human faces.",
  },
  kling: {
    label: "Kling 3.0",
    aspectRatios: ["16:9", "9:16", "1:1"],
    minSec: 3,
    maxSec: 15,
    maxResolution: "4K",
    audio: true,
  },
  runway: {
    label: "Runway (multi-model)",
    aspectRatios: ["16:9", "9:16"],
    minSec: 4,
    maxSec: 15,
    maxResolution: "1080p",
    audio: true,
    notes:
      "Caps depend on the configured model: gen4.5 renders 5s or 10s; hosted veo3.x is fixed at 8s; hosted seedance2* covers 4-15s (2.5 up to 30s).",
  },
};

// What each Buffer-connected network actually accepts / does with video.
// Source: Buffer media requirements. Only the fields that change decisions.
export const PLATFORM_VIDEO_SPECS: { platform: string; rule: string }[] = [
  {
    platform: "Instagram (feed)",
    rule: "Every video publishes as a REEL (standard video posts no longer exist). 9:16 recommended, 3s-15min, <300MB.",
  },
  {
    platform: "Instagram (story)",
    rule: "9:16 strict for a clean full-screen story; video stories max 60s.",
  },
  {
    platform: "Facebook",
    rule: "A 9:16 video automatically publishes as a Reel (3-90s, min 540x960). Other ratios go to the feed.",
  },
  {
    platform: "LinkedIn",
    rule: "Accepts 9:16 through 16:9; transcoded to max 1280x720, so 720p+ sources are fine.",
  },
  { platform: "X / Twitter", rule: "Max 140 seconds. 16:9 or 1:1 read best in the timeline." },
  {
    platform: "TikTok",
    rule: "Video is REQUIRED (no video, no post). 9:16 recommended, 3s-10min.",
  },
  { platform: "YouTube (Shorts)", rule: "9:16, up to 3 minutes." },
  { platform: "Pinterest", rule: "1:1, 2:3, 4:5 or 9:16; minimum 4 seconds." },
  { platform: "Threads", rule: "Up to 5 minutes; keep 9:16 or 1:1 for mobile." },
  { platform: "Bluesky", rule: "Up to 3 minutes and 100MB." },
];

/** Clamp a requested duration into what a provider kind can actually render. */
export function clampDurationForProvider(kind: string, durationSec: number): number {
  const caps = PROVIDER_VIDEO_CAPS[kind];
  if (!caps) return durationSec;
  return Math.min(Math.max(durationSec, caps.minSec), caps.maxSec);
}

/**
 * Pick the connected provider best suited to a request. Preference order:
 * can render the requested duration without clamping, then higher resolution.
 */
export function bestProviderKind(connectedKinds: string[], durationSec: number): string | null {
  const known = connectedKinds.filter((k) => PROVIDER_VIDEO_CAPS[k]);
  if (!known.length) return null;
  const resRank = (r: string) => ({ "4K": 3, "1080p": 2, "720p": 1 })[r] ?? 0;
  const fits = known.filter((k) => durationSec <= PROVIDER_VIDEO_CAPS[k].maxSec);
  if (fits.length) {
    return fits.sort(
      (a, b) =>
        resRank(PROVIDER_VIDEO_CAPS[b].maxResolution) -
        resRank(PROVIDER_VIDEO_CAPS[a].maxResolution),
    )[0];
  }
  // Nothing covers the ask — take whoever gets closest (least clamping).
  return known.sort((a, b) => PROVIDER_VIDEO_CAPS[b].maxSec - PROVIDER_VIDEO_CAPS[a].maxSec)[0];
}

/** Compact prompt block: connected providers' caps + platform rules. */
export function videoCapsPromptBlock(connectedKinds: string[]): string {
  const lines: string[] = [];
  const known = connectedKinds.filter((k) => PROVIDER_VIDEO_CAPS[k]);
  if (known.length) {
    lines.push("CONNECTED VIDEO PROVIDERS (pick per format needs, pass as providerKind):");
    for (const k of known) {
      const c = PROVIDER_VIDEO_CAPS[k];
      lines.push(
        `- ${k}: ${c.label} — ${c.minSec}-${c.maxSec}s, up to ${c.maxResolution}, ratios ${c.aspectRatios.join("/")}${c.notes ? `. ${c.notes}` : ""}`,
      );
    }
  }
  lines.push("PLATFORM VIDEO RULES (what Buffer/the network accepts):");
  for (const p of PLATFORM_VIDEO_SPECS) lines.push(`- ${p.platform}: ${p.rule}`);
  lines.push(
    "When the user names a target platform, choose aspectRatio and durationSec to satisfy that platform FIRST, then pick the providerKind whose range covers it (e.g. clips longer than 8s need kling/seedance/runway, not veo). Say which provider you chose and why in one short clause.",
  );
  return lines.join("\n");
}
