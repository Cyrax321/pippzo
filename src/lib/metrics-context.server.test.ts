// Timezone bucketing in the performance analytics.
//
// The whole point of finding 21 is that an hour-of-day or day-of-week number is
// meaningless without the zone it was computed in, and that the zone used to be
// a module constant pinned to Madrid. These tests hold the new behaviour: the
// same instant must bucket differently under two zones, the labels must name
// the zone, and the formatters must not be rebuilt per row.
//
// `summarize` and the two bucketers are pure — rows in, numbers out, no client
// — so they are exercised directly.

import { describe, it, expect } from "vitest";
import {
  hourInZone,
  weekdayInZone,
  summarize,
  compareDraft,
  type MetricRow,
} from "./metrics-context.server";

const MADRID = "Europe/Madrid";
const NEW_YORK = "America/New_York";

// 01:30 UTC on a Wednesday in June: 03:30 Wednesday in Madrid (UTC+2, summer),
// 21:30 the PREVIOUS Tuesday in New York (UTC-4). Different hour AND different
// weekday from one instant — exactly the skew the bug describes.
const ACROSS_MIDNIGHT = new Date("2026-06-10T01:30:00.000Z");

function row(sentAt: string, engagementRate: number): MetricRow {
  return {
    buffer_post_id: `p-${sentAt}-${engagementRate}`,
    text: "a short caption",
    service: "linkedin",
    channel_id: "chan-1",
    media_type: "image",
    media_url: null,
    impressions: 1000,
    reach: 900,
    likes: 10,
    comments: 2,
    shares: 1,
    clicks: 3,
    engagement_rate: engagementRate,
    sent_at: sentAt,
  };
}

// Four Wednesdays at 01:30 UTC. timingInsights needs >= 4 dated rows overall
// and >= 2 samples in a bucket before it will name a winner.
const WEDNESDAYS_0130Z = [
  row("2026-06-10T01:30:00.000Z", 4),
  row("2026-06-17T01:30:00.000Z", 4),
  row("2026-06-24T01:30:00.000Z", 4),
  row("2026-07-01T01:30:00.000Z", 4),
];

describe("hourInZone / weekdayInZone", () => {
  it("buckets the same instant into a different hour in two zones", () => {
    expect(hourInZone(ACROSS_MIDNIGHT, MADRID)).toBe(3);
    expect(hourInZone(ACROSS_MIDNIGHT, NEW_YORK)).toBe(21);
  });

  it("buckets the same instant into a different weekday in two zones", () => {
    expect(weekdayInZone(ACROSS_MIDNIGHT, MADRID)).toBe(3); // Wednesday
    expect(weekdayInZone(ACROSS_MIDNIGHT, NEW_YORK)).toBe(2); // Tuesday
  });

  it("returns 0 rather than 24 at local midnight", () => {
    // 22:00 UTC in June is 00:00 the next day in Madrid.
    expect(hourInZone(new Date("2026-06-09T22:00:00.000Z"), MADRID)).toBe(0);
  });

  it("follows DST rather than a fixed offset", () => {
    // Same 01:30 UTC, six months apart: UTC+1 in January, UTC+2 in June.
    expect(hourInZone(new Date("2026-01-10T01:30:00.000Z"), MADRID)).toBe(2);
    expect(hourInZone(new Date("2026-06-10T01:30:00.000Z"), MADRID)).toBe(3);
  });

  it("falls back instead of throwing on a zone the runtime cannot load", () => {
    expect(() => hourInZone(ACROSS_MIDNIGHT, "Mars/Olympus_Mons")).not.toThrow();
    expect(hourInZone(ACROSS_MIDNIGHT, "Mars/Olympus_Mons")).toBe(
      hourInZone(ACROSS_MIDNIGHT, MADRID),
    );
  });
});

describe("summarize — timing insights follow the workspace zone", () => {
  it("names a different best hour and weekday for the same rows under two zones", () => {
    const madrid = summarize(WEDNESDAYS_0130Z, MADRID);
    const newYork = summarize(WEDNESDAYS_0130Z, NEW_YORK);

    expect(madrid.bestHour).toContain("03:00");
    expect(madrid.bestWeekday).toContain("Wednesday");

    expect(newYork.bestHour).toContain("21:00");
    expect(newYork.bestWeekday).toContain("Tuesday");

    expect(madrid.bestHour).not.toBe(newYork.bestHour);
    expect(madrid.bestWeekday).not.toBe(newYork.bestWeekday);
  });

  it("labels every timing insight with the zone it was computed in", () => {
    const s = summarize(WEDNESDAYS_0130Z, NEW_YORK);
    expect(s.timezone).toBe(NEW_YORK);
    expect(s.bestHour).toContain(NEW_YORK);
    expect(s.bestWeekday).toContain(NEW_YORK);
  });

  it("leaves zone-independent aggregates alone", () => {
    const madrid = summarize(WEDNESDAYS_0130Z, MADRID);
    const newYork = summarize(WEDNESDAYS_0130Z, NEW_YORK);
    expect(madrid.posts).toBe(newYork.posts);
    expect(madrid.impressions).toBe(newYork.impressions);
    expect(madrid.avgEngagementRate).toBe(newYork.avgEngagementRate);
    expect(madrid.channels).toEqual(newYork.channels);
  });

  it("defaults to the historical Madrid assumption when no zone is passed", () => {
    // Keeps callers that predate the setting behaving exactly as before.
    expect(summarize(WEDNESDAYS_0130Z).timezone).toBe(MADRID);
    expect(summarize(WEDNESDAYS_0130Z).bestHour).toBe(summarize(WEDNESDAYS_0130Z, MADRID).bestHour);
  });

  it("degrades to the fallback zone for an unusable stored value", () => {
    expect(summarize(WEDNESDAYS_0130Z, "Not/AZone").timezone).toBe(MADRID);
  });

  it("carries the zone through compareDraft", () => {
    const madrid = compareDraft(WEDNESDAYS_0130Z, "a draft", "linkedin", MADRID);
    const newYork = compareDraft(WEDNESDAYS_0130Z, "a draft", "linkedin", NEW_YORK);
    expect(madrid.enoughData && madrid.timezone).toBe(MADRID);
    expect(newYork.enoughData && newYork.timezone).toBe(NEW_YORK);
    expect(madrid.enoughData && madrid.bestHour).not.toBe(newYork.enoughData && newYork.bestHour);
  });
});

describe("summarize — formatter cost", () => {
  /** Counts DateTimeFormat constructions while `fn` runs. */
  function countingConstructions(fn: () => void): number {
    const Real = Intl.DateTimeFormat;
    let built = 0;
    class Counting extends (Real as unknown as { new (...a: unknown[]): object }) {
      constructor(...args: unknown[]) {
        built++;
        super(...args);
      }
    }
    Intl.DateTimeFormat = Counting as unknown as typeof Intl.DateTimeFormat;
    try {
      fn();
    } finally {
      Intl.DateTimeFormat = Real;
    }
    return built;
  }

  it("builds formatters once per zone, not once per row", () => {
    // The formatters used to be module-level constants. Making the zone a
    // setting could easily have turned them into per-row constructions, which
    // is the expensive half of Intl — 400 rows x 2 buckets would be 800 of
    // them per digest. A zone used nowhere else in this file, so the module
    // cache is guaranteed cold on first use.
    const cold = "Pacific/Chatham";
    const rows = Array.from({ length: 400 }, (_, i) =>
      row(new Date(Date.UTC(2026, 5, 1 + (i % 28), 1, 30)).toISOString(), 4),
    );

    // One hour formatter + one weekday formatter for a zone never seen before…
    expect(countingConstructions(() => void summarize(rows, cold))).toBe(2);
    // …and nothing at all once it is cached, over 400 more rows.
    expect(countingConstructions(() => void summarize(rows, cold))).toBe(0);
  });

  it("does not re-pay for a zone it already rejected", () => {
    const bad = "Nowhere/AtAll";
    expect(countingConstructions(() => void summarize(WEDNESDAYS_0130Z, bad))).toBeLessThanOrEqual(
      1,
    );
    expect(countingConstructions(() => void summarize(WEDNESDAYS_0130Z, bad))).toBe(0);
  });
});
