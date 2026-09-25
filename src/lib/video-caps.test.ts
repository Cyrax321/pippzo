// Characterisation tests for the video capability matrix.
// Ceilings asserted here are read straight off PROVIDER_VIDEO_CAPS; if a later
// wave changes a provider's range these tests are the reminder to re-check the
// prompt block and the provider picker at the same time.

import { describe, it, expect } from "vitest";
import {
  PROVIDER_VIDEO_CAPS,
  PLATFORM_VIDEO_SPECS,
  clampDurationForProvider,
  bestProviderKind,
  videoCapsPromptBlock,
} from "./video-caps";

describe("PROVIDER_VIDEO_CAPS (declared ceilings)", () => {
  it("declares the five providers the app knows about", () => {
    expect(Object.keys(PROVIDER_VIDEO_CAPS).sort()).toEqual([
      "gemini-omni",
      "kling",
      "runway",
      "seedance",
      "veo",
    ]);
  });

  it.each([
    ["veo", 4, 8, "1080p"],
    ["gemini-omni", 3, 10, "720p"],
    ["seedance", 4, 15, "4K"],
    ["kling", 3, 15, "4K"],
    ["runway", 4, 15, "1080p"],
  ])("%s declares %d-%ds up to %s", (kind, minSec, maxSec, maxResolution) => {
    const caps = PROVIDER_VIDEO_CAPS[kind as string];
    expect(caps.minSec).toBe(minSec);
    expect(caps.maxSec).toBe(maxSec);
    expect(caps.maxResolution).toBe(maxResolution);
    expect(caps.audio).toBe(true);
    expect(caps.aspectRatios).toContain("16:9");
    expect(caps.aspectRatios).toContain("9:16");
    expect(caps.minSec).toBeLessThanOrEqual(caps.maxSec);
  });
});

describe("clampDurationForProvider", () => {
  it("clamps above a provider ceiling", () => {
    expect(clampDurationForProvider("veo", 30)).toBe(8);
    expect(clampDurationForProvider("gemini-omni", 30)).toBe(10);
    expect(clampDurationForProvider("seedance", 30)).toBe(15);
    expect(clampDurationForProvider("kling", 60)).toBe(15);
    expect(clampDurationForProvider("runway", 60)).toBe(15);
  });

  it("clamps below a provider floor", () => {
    expect(clampDurationForProvider("veo", 1)).toBe(4);
    expect(clampDurationForProvider("veo", 0)).toBe(4);
    expect(clampDurationForProvider("gemini-omni", 1)).toBe(3);
    expect(clampDurationForProvider("kling", 2)).toBe(3);
  });

  it("leaves an in-range duration alone, boundaries included", () => {
    expect(clampDurationForProvider("veo", 4)).toBe(4);
    expect(clampDurationForProvider("veo", 6)).toBe(6);
    expect(clampDurationForProvider("veo", 8)).toBe(8);
    expect(clampDurationForProvider("seedance", 12)).toBe(12);
  });

  it("passes an unknown provider kind straight through, unclamped", () => {
    expect(clampDurationForProvider("sora", 120)).toBe(120);
    expect(clampDurationForProvider("", 120)).toBe(120);
  });

  it("does NOT snap Veo to its documented 4/6/8 second steps", () => {
    // KNOWN GAP (audit finding): the veo notes say "Durations are fixed steps
    // (4, 6 or 8s)", but the clamp is a plain min/max — 5s and 7s pass through
    // and the provider call will then be rejected or silently rounded upstream.
    expect(clampDurationForProvider("veo", 5)).toBe(5);
    expect(clampDurationForProvider("veo", 7)).toBe(7);
  });

  it("does NOT round a fractional duration", () => {
    // KNOWN GAP (audit finding): no integer coercion, so 6.5 reaches the
    // provider adapter as-is.
    expect(clampDurationForProvider("kling", 6.5)).toBe(6.5);
  });

  it("passes NaN through as NaN", () => {
    // KNOWN GAP (audit finding): Math.min/Math.max propagate NaN rather than
    // falling back to the provider's minSec.
    expect(Number.isNaN(clampDurationForProvider("veo", Number.NaN))).toBe(true);
  });
});

describe("bestProviderKind", () => {
  it("returns null when nothing is connected", () => {
    expect(bestProviderKind([], 8)).toBeNull();
  });

  it("returns null when no connected provider is a known video provider", () => {
    expect(bestProviderKind(["openai", "midjourney"], 8)).toBeNull();
  });

  it("ignores unknown kinds alongside known ones", () => {
    expect(bestProviderKind(["midjourney", "veo"], 6)).toBe("veo");
  });

  it("prefers the highest resolution among providers that cover the duration", () => {
    // Both cover 6s; kling is 4K, veo is 1080p.
    expect(bestProviderKind(["veo", "kling"], 6)).toBe("kling");
    // Both cover 6s; veo is 1080p, gemini-omni is 720p.
    expect(bestProviderKind(["gemini-omni", "veo"], 6)).toBe("veo");
    // runway (1080p) loses to seedance (4K).
    expect(bestProviderKind(["runway", "seedance"], 10)).toBe("seedance");
  });

  it("keeps the caller's order when resolutions tie (sort is stable)", () => {
    expect(bestProviderKind(["seedance", "kling"], 10)).toBe("seedance");
    expect(bestProviderKind(["kling", "seedance"], 10)).toBe("kling");
  });

  it("excludes a provider whose ceiling is below the ask", () => {
    // 12s: veo (8s max) is out, so the 720p gemini-omni... is also out (10s).
    expect(bestProviderKind(["veo", "gemini-omni", "runway"], 12)).toBe("runway");
    // 9s: veo is out, gemini-omni (10s) is the only fit.
    expect(bestProviderKind(["veo", "gemini-omni"], 9)).toBe("gemini-omni");
  });

  it("falls back to the longest ceiling when nothing covers the ask", () => {
    expect(bestProviderKind(["veo", "kling"], 30)).toBe("kling");
    expect(bestProviderKind(["veo"], 30)).toBe("veo");
    expect(bestProviderKind(["veo", "gemini-omni"], 30)).toBe("gemini-omni");
  });

  it("treats the ceiling as inclusive", () => {
    expect(bestProviderKind(["veo"], 8)).toBe("veo");
    expect(bestProviderKind(["veo"], 8.0001)).toBe("veo"); // fallback path, same answer
  });

  it("does NOT consider the provider's minSec when picking", () => {
    // KNOWN GAP (audit finding): a 3s brief picks seedance (min 4s) over
    // gemini-omni (min 3s) purely on resolution, and the duration is then
    // clamped up to 4s. Only maxSec is consulted.
    expect(bestProviderKind(["gemini-omni", "seedance"], 3)).toBe("seedance");
    expect(clampDurationForProvider("seedance", 3)).toBe(4);
  });
});

describe("videoCapsPromptBlock", () => {
  it("lists connected providers with their real ranges", () => {
    const block = videoCapsPromptBlock(["veo", "kling"]);
    expect(block).toContain("CONNECTED VIDEO PROVIDERS");
    expect(block).toContain("- veo: Google Veo 3.1 — 4-8s, up to 1080p, ratios 16:9/9:16");
    expect(block).toContain("- kling: Kling 3.0 — 3-15s, up to 4K, ratios 16:9/9:16/1:1");
    expect(block).toContain("Durations are fixed steps (4, 6 or 8s)");
  });

  it("omits the provider header entirely when nothing is connected", () => {
    const block = videoCapsPromptBlock([]);
    expect(block).not.toContain("CONNECTED VIDEO PROVIDERS");
    expect(block).toContain("PLATFORM VIDEO RULES");
  });

  it("drops unknown kinds rather than inventing caps for them", () => {
    const block = videoCapsPromptBlock(["sora", "veo"]);
    expect(block).toContain("- veo: Google Veo 3.1");
    expect(block).not.toContain("- sora:");
  });

  it("always appends every platform rule", () => {
    const block = videoCapsPromptBlock(["veo"]);
    for (const p of PLATFORM_VIDEO_SPECS) {
      expect(block).toContain(`- ${p.platform}: ${p.rule}`);
    }
    expect(PLATFORM_VIDEO_SPECS).toHaveLength(10);
    expect(block).toContain("TikTok");
    expect(block).toContain("Max 140 seconds");
  });
});
