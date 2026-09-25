// Tests for the cron-expression validator (audit finding 48).
//
// validateCronExpression is pure once `now` is injected, so every case here is
// an exact input/output pair. The three expressions quoted in the finding get
// their own block: they are the behaviour this module exists to change.

import { describe, it, expect } from "vitest";
import {
  validateCronExpression,
  isValidTimezone,
  CRON_FIELD_COUNT,
  DEFAULT_MIN_INTERVAL_MINUTES,
} from "./cron-schedule";

const NOW = new Date("2026-09-12T12:00:00.000Z");

function accept(expr: string, tz = "UTC") {
  const r = validateCronExpression(expr, { tz, now: NOW });
  if (!r.ok) throw new Error(`expected ${JSON.stringify(expr)} to be accepted: ${r.error}`);
  return r;
}

function reject(expr: string | null | undefined, tz = "UTC") {
  const r = validateCronExpression(expr, { tz, now: NOW });
  if (r.ok) {
    throw new Error(
      `expected ${JSON.stringify(expr)} to be rejected, but it was accepted (next fire ${r.nextFire.toISOString()})`,
    );
  }
  return r.error;
}

describe("validateCronExpression — the three cases from the finding", () => {
  it('rejects "" instead of quietly scheduling a job every minute', () => {
    // Today nextFireFromCron("") returns now + 1 minute: cron-parser reads a
    // blank expression as every-minute and never throws, so the scheduler's
    // 24-hour fallback never runs. This is the runaway-cost case.
    const err = reject("");
    expect(err).toMatch(/schedule is required/i);
    expect(err).toContain("0 9 * * *");
  });

  it('rejects the four-field typo "0 9 * *" instead of reinterpreting it', () => {
    // Today this parses cleanly into a completely different schedule
    // (2026-10-09T00:00:00Z rather than 09:00 daily).
    const err = reject("0 9 * *");
    expect(err).toContain("exactly 5 fields");
    expect(err).toContain("has 4");
  });

  it('accepts "0 9 * * *" and reports the same next fire as today', () => {
    const r = accept("0 9 * * *");
    expect(r.nextFire.toISOString()).toBe("2026-09-13T09:00:00.000Z");
    expect(r.expression).toBe("0 9 * * *");
  });
});

describe("validateCronExpression — blank and missing input", () => {
  it("rejects whitespace, null and undefined the same way", () => {
    expect(reject("   ")).toMatch(/schedule is required/i);
    expect(reject("\t\n ")).toMatch(/schedule is required/i);
    expect(reject(null)).toMatch(/schedule is required/i);
    expect(reject(undefined)).toMatch(/schedule is required/i);
  });
});

describe("validateCronExpression — field count", () => {
  it("rejects anything that is not five fields", () => {
    expect(reject("*")).toContain("has 1");
    expect(reject("0 9")).toContain("has 2");
    expect(reject("0 9 *")).toContain("has 3");
    expect(reject("0 9 * *")).toContain("has 4");
    expect(reject("0 0 9 * * *")).toContain("has 6");
    expect(reject("0 0 9 * * * *")).toContain("has 7");
  });

  it("explains what the sixth field would have meant", () => {
    // cron-parser accepts a 6-field expression as "with seconds". This
    // scheduler ticks about once a minute, so a seconds column is a lie.
    expect(reject("0 0 9 * * *")).toMatch(/seconds column/);
  });

  it("names the five fields so the message is actionable", () => {
    expect(reject("0 9 * *")).toContain("minute hour day-of-month month day-of-week");
    expect(CRON_FIELD_COUNT).toBe(5);
  });

  it("normalises runs of whitespace before counting", () => {
    // "0   9 * * *" is five fields, not eight. Tabs and newlines too.
    expect(accept("0   9  *  *  *").expression).toBe("0 9 * * *");
    expect(accept("\t0 9 * * *\n").expression).toBe("0 9 * * *");
  });
});

describe("validateCronExpression — expressions that cannot parse", () => {
  it("rejects prose", () => {
    expect(reject("a b c d e")).toMatch(/not a valid cron expression/);
    // Prose with the wrong word count is caught one step earlier, by the field
    // count, which is the more specific message of the two.
    expect(reject("every morning please now")).toContain("has 4");
  });

  it("rejects out-of-range values", () => {
    expect(reject("99 99 * * *")).toMatch(/not a valid cron expression/);
    expect(reject("0 25 * * *")).toMatch(/not a valid cron expression/);
    expect(reject("0 9 32 * *")).toMatch(/not a valid cron expression/);
    expect(reject("0 9 * 13 *")).toMatch(/not a valid cron expression/);
  });
});

describe("validateCronExpression — shorthand macros", () => {
  it("rejects @daily and suggests the five-field form", () => {
    // Nothing in this app writes a macro: the UI presets and the chat agent
    // both produce five fields. Accepting a second syntax widens the surface
    // for no gain, so the message converts it instead.
    expect(reject("@daily")).toContain('"0 0 * * *"');
    expect(reject("@hourly")).toContain('"0 * * * *"');
    expect(reject("@weekly")).toContain('"0 0 * * 0"');
    expect(reject("@monthly")).toContain('"0 0 1 * *"');
    expect(reject("@yearly")).toContain('"0 0 1 1 *"');
    expect(reject("@midnight")).toContain('"0 0 * * *"');
  });

  it("rejects an unknown macro without pretending to know the equivalent", () => {
    const err = reject("@reboot");
    expect(err).toMatch(/not supported/);
    expect(err).toContain("0 9 * * *");
  });
});

describe("validateCronExpression — schedules that are too frequent", () => {
  it("rejects every-minute, which is what a blank column silently becomes", () => {
    const err = reject("* * * * *");
    expect(err).toMatch(/every 1 minute/);
    expect(err).toMatch(/more frequent than every 15 minutes is refused/);
  });

  it("rejects a five-valid-field expression that still means sixty runs", () => {
    // The case a field-count check misses entirely: "* 9 * * *" parses, has
    // five fields, and fires sixty times every morning.
    expect(reject("* 9 * * *")).toMatch(/every 1 minute/);
  });

  it("rejects step values under the floor", () => {
    expect(reject("*/1 * * * *")).toMatch(/refused/);
    expect(reject("*/5 * * * *")).toMatch(/every 5 minutes/);
  });

  it("measures the real smallest gap, not the step value", () => {
    // "*/14" fires at :00 :14 :28 :42 :56 and then wraps to :00 of the next
    // hour — a four-minute gap. Reading the step as the cadence would have let
    // this through. Measuring actual fires is why it does not.
    expect(reject("*/14 * * * *")).toMatch(/every 4 minutes/);
    // "*/45" wraps the same way — :00 :45 :00 — so its real cadence is 15
    // minutes, exactly the floor, and it is allowed.
    expect(accept("*/45 * * * *").minIntervalMinutes).toBe(15);
  });

  it("rejects a list of minutes that bunches up", () => {
    expect(reject("0,1,2 * * * *")).toMatch(/every 1 minute/);
    expect(reject("0,10,20,30,40,50 * * * *")).toMatch(/every 10 minutes/);
  });

  it("accepts exactly the floor and anything slower", () => {
    expect(accept("*/15 * * * *").minIntervalMinutes).toBe(15);
    expect(accept("*/30 * * * *").minIntervalMinutes).toBe(30);
    expect(accept("0 * * * *").minIntervalMinutes).toBe(60);
    expect(accept("0 9 * * *").minIntervalMinutes).toBe(1440);
    expect(DEFAULT_MIN_INTERVAL_MINUTES).toBe(15);
  });

  it("honours a caller-supplied floor", () => {
    const fast = validateCronExpression("*/5 * * * *", {
      tz: "UTC",
      now: NOW,
      minIntervalMinutes: 5,
    });
    expect(fast.ok).toBe(true);
    const tooFast = validateCronExpression("*/5 * * * *", {
      tz: "UTC",
      now: NOW,
      minIntervalMinutes: 60,
    });
    expect(tooFast.ok).toBe(false);
  });

  it("skips the check entirely when the floor is 0", () => {
    const r = validateCronExpression("* * * * *", { tz: "UTC", now: NOW, minIntervalMinutes: 0 });
    expect(r.ok).toBe(true);
  });

  it("quotes the offending expression and offers a working alternative", () => {
    const err = reject("* * * * *");
    expect(err).toContain('"* * * * *"');
    expect(err).toContain('"0 9 * * *"');
  });
});

describe("validateCronExpression — timezones", () => {
  it("interprets the expression as wall-clock in the given zone", () => {
    const madrid = accept("0 9 * * *", "Europe/Madrid");
    const sydney = accept("0 9 * * *", "Australia/Sydney");
    expect(madrid.nextFire.toISOString()).not.toBe(sydney.nextFire.toISOString());
    // 09:00 Madrid on 2026-09-13 is 07:00 UTC (CEST, UTC+2).
    expect(madrid.nextFire.toISOString()).toBe("2026-09-13T07:00:00.000Z");
  });

  it("rejects an invalid zone instead of silently falling back to now + 24h", () => {
    // nextFireFromCron today swallows the cron-parser throw for a bad zone and
    // returns tomorrow — a wrong time reported as a correct one.
    expect(reject("0 9 * * *", "Mars/Olympus")).toMatch(/not a valid IANA timezone/);
    expect(reject("0 9 * * *", "GMT+25")).toMatch(/not a valid IANA timezone/);
    expect(reject("0 9 * * *", "Sydney")).toMatch(/not a valid IANA timezone/);
  });

  it("defaults to UTC when no zone is given or the zone is blank", () => {
    expect(validateCronExpression("0 9 * * *", { now: NOW })).toMatchObject({ ok: true });
    const blank = validateCronExpression("0 9 * * *", { tz: "   ", now: NOW });
    expect(blank.ok).toBe(true);
    if (blank.ok) expect(blank.nextFire.toISOString()).toBe("2026-09-13T09:00:00.000Z");
  });

  it("measures cadence free of daylight saving, so an hourly job survives the clock change", () => {
    // 2026-10-25 03:00 CEST -> 02:00 CET in Madrid: the 02:00 wall-clock hour
    // happens twice. Measured in-zone that can look like a zero-length gap and
    // wrongly reject a perfectly good hourly schedule.
    const beforeFallBack = new Date("2026-10-25T00:30:00.000Z");
    const r = validateCronExpression("0 * * * *", {
      tz: "Europe/Madrid",
      now: beforeFallBack,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.minIntervalMinutes).toBe(60);
  });
});

describe("validateCronExpression — expressions that never fire", () => {
  it("rejects a date that does not occur", () => {
    // 30 February. cron-parser exhausts its search rather than throwing.
    const err = reject("0 9 30 2 *");
    expect(err).toMatch(/never fires|not a valid cron expression/);
  });
});

describe("validateCronExpression — the shapes this app actually writes", () => {
  // The UI presets and the chat agent's prompt both produce five-field
  // expressions in these shapes. None of them may regress.
  const supported = [
    "0 9 * * *", // daily at 09:00 — the default in the automations form
    "0 8 * * 1-5", // weekdays
    "0 9 * * 1", // Mondays — the weekly_report shape
    "30 7 * * *",
    "0 */6 * * *", // every six hours — the metrics_sync shape
    "0 0 1 * *", // monthly
    "15 14 1 * *",
    "0 22 * * 6",
  ];

  for (const expr of supported) {
    it(`accepts "${expr}"`, () => {
      const r = accept(expr, "Europe/Madrid");
      expect(r.expression).toBe(expr);
      expect(r.nextFire.getTime()).toBeGreaterThan(NOW.getTime());
    });
  }

  it("always returns a fire strictly in the future", () => {
    const exactlyOnTheMinute = new Date("2026-09-13T09:00:00.000Z");
    const r = validateCronExpression("0 9 * * *", { tz: "UTC", now: exactlyOnTheMinute });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.nextFire.toISOString()).toBe("2026-09-14T09:00:00.000Z");
  });

  it("is deterministic for the same expression and clock", () => {
    const a = validateCronExpression("0 9 * * *", { tz: "UTC", now: NOW });
    const b = validateCronExpression("0 9 * * *", { tz: "UTC", now: NOW });
    expect(a.ok && b.ok && a.nextFire.getTime() === b.nextFire.getTime()).toBe(true);
  });

  it("never throws, whatever it is handed", () => {
    const hostile = [
      "",
      "   ",
      "@reboot",
      "* * * * *",
      "0 9 * *",
      "0 9 * * * *",
      "99 99 99 99 99",
      "a b c d e",
      "0 9 30 2 *",
      "*/0 * * * *",
      "- - - - -",
      "0 9 * * 8",
      "0 9 L * *",
      "0 9 * * 1#2",
      "0 9 ? * *",
      "  9 * * *",
    ];
    for (const expr of hostile) {
      expect(() => validateCronExpression(expr, { tz: "Europe/Madrid", now: NOW })).not.toThrow();
    }
  });
});

describe("isValidTimezone", () => {
  it("accepts real IANA zones", () => {
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Europe/Madrid")).toBe(true);
    expect(isValidTimezone("Australia/Sydney")).toBe(true);
    expect(isValidTimezone("  America/New_York  ")).toBe(true);
  });

  it("rejects typos, blanks and nullish input", () => {
    expect(isValidTimezone("Sydney")).toBe(false);
    expect(isValidTimezone("GMT+25")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("   ")).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
    expect(isValidTimezone(undefined)).toBe(false);
  });
});
