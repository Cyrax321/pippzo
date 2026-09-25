// Validation for the cron expressions stored in `cron_jobs.schedule`.
//
// Pure: expression + timezone in, verdict out. No I/O, no database, no React —
// safe to import from the browser form, from the chat agent's server tools and
// from the scheduler itself.
//
// Why this exists (audit finding 48): `cron-parser` is permissive. It does not
// throw on the two mistakes users actually make, so the scheduler's
// "fall back to now + 24h when parsing throws" safety net never fires:
//
//   ""          -> parsed as every-minute  (a blank column becomes a 60s job)
//   "0 9 * *"   -> a four-field typo, silently reinterpreted as a different
//                  schedule entirely rather than rejected
//
// Every cron job in this app makes at least one model call, and `daily_post`
// also generates an image and publishes. A schedule that is wrong by an order
// of magnitude is a cost incident, not a cosmetic bug, so the rule here is to
// refuse anything that is not unambiguously what the user asked for.

import { CronExpressionParser } from "cron-parser";

/** minute hour day-of-month month day-of-week. Seconds are not supported. */
export const CRON_FIELD_COUNT = 5;

/**
 * Refuse anything that fires more often than this.
 *
 * Every task type (`daily_post`, `competitor_scan`, `weekly_report`,
 * `metrics_sync`, `performance_reflection`) is a paid, multi-second operation:
 * at minimum a model call, at most a model call plus an image generation plus a
 * publish. The scheduler ticks about once a minute and does not claim a job row
 * before running it (finding 4), and no outbound request has a timeout
 * (finding 9) — so a fast schedule does not merely run often, it overlaps
 * itself. None of the five tasks has a plausible sub-quarter-hour use, so the
 * floor is set where the cheapest one (`metrics_sync`, a single Buffer read)
 * stops being defensible. Callers that genuinely need a faster job can pass
 * `minIntervalMinutes` explicitly; passing 0 disables the check.
 */
export const DEFAULT_MIN_INTERVAL_MINUTES = 15;

/** Shorthand macros cron-parser accepts, with the five-field form to suggest. */
const MACRO_EQUIVALENT: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

export type CronValidation =
  | {
      ok: true;
      /** The expression with surrounding and repeated whitespace normalised. */
      expression: string;
      /** First fire strictly after `now`, in the supplied timezone. */
      nextFire: Date;
      /** Smallest gap between consecutive fires, in minutes. */
      minIntervalMinutes: number;
    }
  | { ok: false; error: string };

export type CronValidationOptions = {
  /** IANA zone the expression is written in. Defaults to UTC. */
  tz?: string;
  /** Refuse schedules faster than this. 0 disables the check. */
  minIntervalMinutes?: number;
  /** Injectable clock, for tests. */
  now?: Date;
};

/**
 * Checks an IANA zone the only reliable way in a worker runtime: try to build a
 * formatter with it. A typo ("Sydney", "GMT+25") throws; a real zone does not.
 */
export function isValidTimezone(tz: string | null | undefined): boolean {
  const v = (tz ?? "").trim();
  if (!v) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

/**
 * Collects the next few fires of an expression. Stops once it has enough
 * samples to know the cadence — 25 fires, or as soon as they span more than a
 * day — so a yearly expression costs two iterations rather than 25 years.
 */
function upcomingFires(expression: string, tz: string, from: Date): Date[] {
  const it = CronExpressionParser.parse(expression, { currentDate: from, tz });
  const SPAN_MS = 25 * 60 * 60 * 1000;
  const MAX_SAMPLES = 25;
  const out: Date[] = [];
  while (out.length < MAX_SAMPLES) {
    let next: Date;
    try {
      next = it.next().toDate();
    } catch {
      // The iterator is exhausted (an expression with no further occurrence).
      // Whatever we already collected is the answer; if nothing, the caller
      // reports a never-firing schedule.
      break;
    }
    out.push(next);
    if (next.getTime() - out[0].getTime() > SPAN_MS) break;
  }
  return out;
}

/** Smallest gap between consecutive fires, in minutes. Infinity if unknown. */
function smallestGapMinutes(fires: Date[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 1; i < fires.length; i++) {
    min = Math.min(min, fires[i].getTime() - fires[i - 1].getTime());
  }
  return min === Number.POSITIVE_INFINITY ? min : min / 60_000;
}

function describeInterval(minutes: number): string {
  if (minutes < 1) return "more than once a minute";
  if (minutes < 60) {
    const m = Math.round(minutes);
    return `every ${m} minute${m === 1 ? "" : "s"}`;
  }
  const h = Math.round(minutes / 60);
  return `every ${h} hour${h === 1 ? "" : "s"}`;
}

/**
 * Validates a cron expression against what this app actually runs.
 *
 * Accepts exactly one shape: five whitespace-separated fields
 * (minute hour day-of-month month day-of-week) that `cron-parser` can parse in
 * the given timezone and that fire no more often than `minIntervalMinutes`.
 *
 * Rejects, each with a message naming the problem:
 *   - empty / whitespace-only        (today: silently an every-minute job)
 *   - a field count other than five  (today: silently a different schedule)
 *   - `@daily`-style macros          (nothing in this app writes them, and the
 *                                     five-field form is suggested instead)
 *   - an unparseable expression      (today: silently now + 24h)
 *   - an invalid timezone            (today: silently now + 24h)
 *   - an expression that never fires
 *   - a schedule that fires too often to be what the user meant — this is the
 *     case a field-count check misses: "* 9 * * *" has five valid fields and
 *     parses cleanly, but means sixty runs every morning.
 */
export function validateCronExpression(
  raw: string | null | undefined,
  opts: CronValidationOptions = {},
): CronValidation {
  const tz = (opts.tz ?? "UTC").trim() || "UTC";
  const floor = opts.minIntervalMinutes ?? DEFAULT_MIN_INTERVAL_MINUTES;
  const from = opts.now ?? new Date();

  const expression = (raw ?? "").trim().replace(/\s+/g, " ");

  if (!expression) {
    return {
      ok: false,
      error:
        'A schedule is required. Use a five-field cron expression, for example "0 9 * * *" for 09:00 every day.',
    };
  }

  if (expression.startsWith("@")) {
    const equivalent = MACRO_EQUIVALENT[expression.toLowerCase()];
    return {
      ok: false,
      error: equivalent
        ? `Shorthand schedules like "${expression}" are not supported. Write it as five fields instead: "${equivalent}".`
        : `Shorthand schedules like "${expression}" are not supported. Use a five-field cron expression, for example "0 9 * * *".`,
    };
  }

  const fields = expression.split(" ");
  if (fields.length !== CRON_FIELD_COUNT) {
    const extra =
      fields.length === CRON_FIELD_COUNT + 1
        ? " Six fields would add a seconds column, which this scheduler does not run."
        : "";
    return {
      ok: false,
      error:
        `A schedule needs exactly ${CRON_FIELD_COUNT} fields ` +
        `(minute hour day-of-month month day-of-week), but "${expression}" has ${fields.length}.${extra}` +
        ' Example: "0 9 * * *" for 09:00 every day.',
    };
  }

  if (!isValidTimezone(tz)) {
    return {
      ok: false,
      error: `"${tz}" is not a valid IANA timezone. Use the Area/City form, for example "Europe/Madrid" or "Australia/Sydney".`,
    };
  }

  let fires: Date[];
  try {
    fires = upcomingFires(expression, tz, from);
  } catch {
    return {
      ok: false,
      error: `"${expression}" is not a valid cron expression. Use five fields: minute hour day-of-month month day-of-week, for example "0 9 * * *".`,
    };
  }

  if (fires.length === 0) {
    return {
      ok: false,
      error: `"${expression}" never fires — it describes a date that does not occur. Pick a schedule that can actually come round, for example "0 9 * * *".`,
    };
  }

  // Cadence is measured in UTC on purpose. The expression's *frequency* is a
  // property of the expression, not of the zone, and measuring it in a zone
  // with daylight saving would show a phantom zero-length gap on the night the
  // clocks go back — rejecting a perfectly good hourly job once a year.
  let cadence = smallestGapMinutes(fires);
  if (tz !== "UTC") {
    try {
      cadence = smallestGapMinutes(upcomingFires(expression, "UTC", from));
    } catch {
      /* keep the in-zone measurement */
    }
  }

  if (floor > 0 && Number.isFinite(cadence) && cadence < floor) {
    return {
      ok: false,
      error:
        `"${expression}" fires ${describeInterval(cadence)}. Every automation run makes a model call, ` +
        `and some also generate an image and publish, so anything more frequent than every ${floor} minutes is refused. ` +
        'Use "0 9 * * *" for 09:00 daily, or "*/30 * * * *" for every half hour.',
    };
  }

  return { ok: true, expression, nextFire: fires[0], minIntervalMinutes: cadence };
}
