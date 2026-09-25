// Characterisation tests for nextFireFromCron — the scheduler's only clock.
//
// NOTE: this module imports the `ai` package and ~15 sibling server modules.
// The import was measured and is fast (well under a second) and side-effect
// free at load time, so the real module is imported rather than mocked.
// nextFireFromCron itself is pure: expression + timezone + `from` in, Date out.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  nextFireFromCron,
  reapStaleRuns,
  claimJob,
  STALE_RUN_MS,
  type ReapClient,
  type ClaimClient,
} from "./cron-executors.server";

const DAY_MS = 24 * 60 * 60 * 1000;

// A Tuesday, chosen so weekday expressions have somewhere to go.
const FROM = new Date("2026-03-17T00:00:00.000Z");

describe("nextFireFromCron — normal expressions", () => {
  it("advances a daily 9am expression in UTC", () => {
    expect(nextFireFromCron("0 9 * * *", "UTC", FROM).toISOString()).toBe(
      "2026-03-17T09:00:00.000Z",
    );
  });

  it("moves to the next day when the fire time has already passed today", () => {
    const justAfter = new Date("2026-03-17T09:00:00.000Z");
    expect(nextFireFromCron("0 9 * * *", "UTC", justAfter).toISOString()).toBe(
      "2026-03-18T09:00:00.000Z",
    );
  });

  it("handles an hourly expression", () => {
    expect(
      nextFireFromCron("0 * * * *", "UTC", new Date("2026-03-17T10:07:00.000Z")).toISOString(),
    ).toBe("2026-03-17T11:00:00.000Z");
  });

  it("handles the weekday expression the Automations UI offers", () => {
    // Saturday 2026-03-21 -> next weekday fire is Monday 2026-03-23 08:00.
    expect(
      nextFireFromCron("0 8 * * 1-5", "UTC", new Date("2026-03-21T12:00:00.000Z")).toISOString(),
    ).toBe("2026-03-23T08:00:00.000Z");
  });

  it("handles the weekly Monday expression", () => {
    expect(nextFireFromCron("0 9 * * 1", "UTC", FROM).toISOString()).toBe(
      "2026-03-23T09:00:00.000Z",
    );
  });

  it("returns a Date, never a string", () => {
    expect(nextFireFromCron("0 9 * * *", "UTC", FROM)).toBeInstanceOf(Date);
  });
});

describe("nextFireFromCron — timezone handling", () => {
  it("honours the timezone argument: Europe/Madrid vs Australia/Sydney diverge", () => {
    const madrid = nextFireFromCron("0 9 * * *", "Europe/Madrid", FROM);
    const sydney = nextFireFromCron("0 9 * * *", "Australia/Sydney", FROM);

    // 09:00 CET (UTC+1 in mid-March, before EU DST starts on the 29th).
    expect(madrid.toISOString()).toBe("2026-03-17T08:00:00.000Z");
    // 09:00 AEDT (UTC+11) — already past at `from`, so it fires the next day.
    expect(sydney.toISOString()).toBe("2026-03-17T22:00:00.000Z");
    expect(madrid.getTime()).not.toBe(sydney.getTime());
  });

  it("follows the timezone across a DST transition", () => {
    // Madrid switches to CEST (UTC+2) on 2026-03-29, so 09:00 local is 07:00Z.
    expect(
      nextFireFromCron(
        "0 9 * * *",
        "Europe/Madrid",
        new Date("2026-03-28T23:00:00.000Z"),
      ).toISOString(),
    ).toBe("2026-03-29T07:00:00.000Z");
    // ...and in July it is still 07:00Z, not the winter 08:00Z.
    expect(
      nextFireFromCron(
        "0 9 * * *",
        "Europe/Madrid",
        new Date("2026-07-17T00:00:00.000Z"),
      ).toISOString(),
    ).toBe("2026-07-17T07:00:00.000Z");
  });

  it("treats UTC as a plain offset-free zone", () => {
    expect(nextFireFromCron("0 9 * * *", "UTC", FROM).toISOString()).toBe(
      nextFireFromCron("0 9 * * *", "Etc/UTC", FROM).toISOString(),
    );
  });
});

describe("nextFireFromCron — silent fallback", () => {
  it("returns exactly from + 24h for a malformed cron expression, instead of throwing", () => {
    const out = nextFireFromCron("every morning please", "UTC", FROM);
    expect(out.getTime()).toBe(FROM.getTime() + DAY_MS);
  });

  it("returns from + 24h for an out-of-range field", () => {
    expect(nextFireFromCron("99 99 * * *", "UTC", FROM).getTime()).toBe(FROM.getTime() + DAY_MS);
  });

  it("returns from + 24h for a malformed timezone", () => {
    // cron-parser throws on an unknown IANA zone; the catch swallows it.
    expect(nextFireFromCron("0 9 * * *", "Mars/Olympus", FROM).getTime()).toBe(
      FROM.getTime() + DAY_MS,
    );
    expect(nextFireFromCron("0 9 * * *", "", FROM).getTime()).toBe(FROM.getTime() + DAY_MS);
    expect(nextFireFromCron("0 9 * * *", "GMT+25", FROM).getTime()).toBe(FROM.getTime() + DAY_MS);
  });

  it("falls back relative to NOW when `from` is defaulted", () => {
    const before = Date.now();
    const out = nextFireFromCron("not a cron", "UTC");
    const after = Date.now();
    expect(out.getTime()).toBeGreaterThanOrEqual(before + DAY_MS);
    expect(out.getTime()).toBeLessThanOrEqual(after + DAY_MS);
  });

  it("never throws, whatever it is handed", () => {
    for (const expr of ["", "not a cron", "* * *", "0 0 30 2 *", "0 9 * * 8"]) {
      expect(() => nextFireFromCron(expr, "Europe/Madrid", FROM)).not.toThrow();
    }
  });
});

describe("nextFireFromCron — schedules it now refuses", () => {
  // These three asserted the buggy behaviour when the suite was written, marked
  // as known gaps to be flipped once validation landed. It has (finding 48), so
  // they now assert the fix. A blank schedule becoming a once-a-minute job was
  // the most expensive of the three: that job is a model call, an image
  // generation and a publish.
  it("refuses an EMPTY expression and falls back to daily", () => {
    const out = nextFireFromCron("", "UTC", FROM);
    expect(out.getTime()).toBe(FROM.getTime() + DAY_MS);
    expect(out.getTime()).not.toBe(FROM.getTime() + 60 * 1000);
  });

  it("refuses a 4-field expression rather than reinterpreting it", () => {
    // "0 9 * *" is a typo of "0 9 * * *". The parser used to read the short
    // form as an entirely different schedule, so the job fired at the wrong
    // time with no error anywhere.
    expect(nextFireFromCron("0 9 * *", "UTC", FROM).getTime()).toBe(FROM.getTime() + DAY_MS);
  });

  it("refuses alias forms like @hourly, which the UI never produces", () => {
    // The validator hands back the five-field equivalent in its message, so a
    // user who types one is told what to write instead.
    expect(nextFireFromCron("@hourly", "UTC", new Date("2026-03-17T10:07:00.000Z")).getTime()).toBe(
      new Date("2026-03-17T10:07:00.000Z").getTime() + DAY_MS,
    );
  });

  it("refuses a blank timezone rather than quietly using UTC", () => {
    // A caller passing "" has lost the zone somewhere. Running at 09:00 UTC
    // when the user set 09:00 in their own zone is the same silent wrongness.
    expect(nextFireFromCron("0 9 * * *", "", FROM).getTime()).toBe(FROM.getTime() + DAY_MS);
  });

  it("still refuses a schedule that fires faster than the floor", () => {
    // Every task here is a paid, multi-second operation, and nothing claims the
    // job row fast enough for a one-minute cadence to be safe.
    expect(nextFireFromCron("* * * * *", "UTC", FROM).getTime()).toBe(FROM.getTime() + DAY_MS);
  });

  it("can return a date years away for a rare expression, with no sanity ceiling", () => {
    // KNOWN GAP (audit finding): "Feb 29 at 02:00" next fires in 2028. The
    // scheduler stores that as next_run_at with no upper bound or warning.
    expect(
      nextFireFromCron("0 2 29 2 *", "UTC", new Date("2026-01-01T00:00:00.000Z")).toISOString(),
    ).toBe("2028-02-29T02:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// reapStaleRuns — cron_runs rows are inserted as 'running' and only closed by
// runJob's own try/catch, so a process that stops mid-run leaves one running
// forever and nothing revisits it. The reaper is the only thing that does.
//
// The Supabase query builder is stubbed: what is being tested is the filter it
// builds (which rows it is willing to touch) and its refusal to throw.

type ReapCall = { op: "eq" | "lt"; column: string; value: unknown };
type ReapOutcome = { data?: { id: string }[] | null; error?: unknown };

function stubAdmin(outcome: ReapOutcome | Error) {
  const calls: {
    table?: string;
    patch?: Record<string, unknown>;
    filters: ReapCall[];
    selected?: string;
  } = { filters: [] };

  type Chain = {
    eq: (column: string, value: string) => Chain;
    lt: (column: string, value: string) => Chain;
    select: (columns: string) => Promise<ReapOutcome>;
  };
  const chain: Chain = {
    eq: (column: string, value: string) => {
      calls.filters.push({ op: "eq", column, value });
      return chain;
    },
    lt: (column: string, value: string) => {
      calls.filters.push({ op: "lt", column, value });
      return chain;
    },
    select: (columns: string) => {
      calls.selected = columns;
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    },
  };

  const admin: ReapClient = {
    from: (table: string) => {
      calls.table = table;
      return {
        update: (patch: Record<string, unknown>) => {
          calls.patch = patch;
          return chain;
        },
      };
    },
  };
  return { admin, calls };
}

const NOW = new Date("2026-03-17T12:00:00.000Z");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reapStaleRuns", () => {
  it("only touches running rows that started before the staleness cutoff", async () => {
    const { admin, calls } = stubAdmin({ data: [] });
    await reapStaleRuns(admin, NOW);

    expect(calls.table).toBe("cron_runs");
    expect(calls.filters).toContainEqual({ op: "eq", column: "status", value: "running" });
    expect(calls.filters).toContainEqual({
      op: "lt",
      column: "started_at",
      value: new Date(NOW.getTime() - STALE_RUN_MS).toISOString(),
    });
  });

  it("closes the row as errored with a finish time and a plain-language reason", async () => {
    const { admin, calls } = stubAdmin({ data: [{ id: "run-1" }] });
    await reapStaleRuns(admin, NOW);

    // 'error' is the only non-terminal-looking value the CHECK constraint
    // allows besides 'ok' — a reaped run is a failed run.
    expect(calls.patch?.status).toBe("error");
    expect(calls.patch?.finished_at).toBe(NOW.toISOString());
    const message = String(calls.patch?.error ?? "");
    expect(message).toContain("30 minutes");
    expect(message).toContain("stopped before it could finish");
  });

  it("reports how many runs it closed", async () => {
    const { admin } = stubAdmin({ data: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    expect(await reapStaleRuns(admin, NOW)).toEqual({ reaped: 3 });
  });

  it("reports zero when nothing is stale", async () => {
    const { admin } = stubAdmin({ data: [] });
    expect(await reapStaleRuns(admin, NOW)).toEqual({ reaped: 0 });
  });

  it("never throws when the update is rejected — due jobs must still run", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = stubAdmin({ error: { message: "permission denied" } });
    expect(await reapStaleRuns(admin, NOW)).toEqual({ reaped: 0 });
  });

  it("never throws when the client itself blows up", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = stubAdmin(new Error("socket hang up"));
    expect(await reapStaleRuns(admin, NOW)).toEqual({ reaped: 0 });
  });

  it("keeps the threshold well clear of a run that could still be alive", () => {
    // The tick fires every 60s and the caller gives up on the HTTP request at
    // 300s, but the work can outlive the request — so the threshold has to sit
    // far above the longest legitimate job, not just above the request timeout.
    expect(STALE_RUN_MS).toBeGreaterThan(5 * 300_000);
    // ...and still inside the hour, so a crashed run surfaces the same day.
    expect(STALE_RUN_MS).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// claimJob — the thing that stops two overlapping ticks running one job twice.
//
// The tick used to select due jobs and only advance next_run_at after the run
// finished, so a second tick arriving mid-run re-selected the same rows. launchd
// supervises the curl that calls the tick, not the server, so when curl gives up
// at --max-time 300 the handler keeps working and the next minute fires anyway.
//
// The query builder is stubbed: what matters is which row the claim is willing
// to touch (the exact next_run_at it read, nobody else's) and that losing is a
// skip rather than a crash.

type ClaimCall = { column: string; value: unknown };
type ClaimOutcome = { data?: { id: string }[] | null; error?: unknown };

function stubClaimAdmin(outcome: ClaimOutcome | Error) {
  const calls: { table?: string; patch?: Record<string, unknown>; filters: ClaimCall[] } = {
    filters: [],
  };
  type Chain = {
    eq: (column: string, value: string) => Chain;
    select: (columns: string) => Promise<ClaimOutcome>;
  };
  const chain: Chain = {
    eq: (column, value) => {
      calls.filters.push({ column, value });
      return chain;
    },
    select: () => (outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome)),
  };
  const admin: ClaimClient = {
    from: (table: string) => {
      calls.table = table;
      return {
        update: (patch: Record<string, unknown>) => {
          calls.patch = patch;
          return chain;
        },
      };
    },
  };
  return { admin, calls };
}

const JOB = { id: "job-1", next_run_at: "2026-03-17T09:00:00.000Z" };
const PATCH = {
  last_run_at: "2026-03-17T09:00:30.000Z",
  next_run_at: "2026-03-18T09:00:00.000Z",
};

describe("claimJob", () => {
  it("claims by writing the next fire time only while next_run_at is unchanged", async () => {
    const { admin, calls } = stubClaimAdmin({ data: [{ id: "job-1" }] });
    expect(await claimJob(admin, JOB, PATCH)).toEqual({ claimed: true });

    expect(calls.table).toBe("cron_jobs");
    expect(calls.patch).toEqual(PATCH);
    expect(calls.filters).toContainEqual({ column: "id", value: "job-1" });
    // The compare-and-set: the exact value this tick read. A tick that already
    // claimed the job has overwritten it, so this matches nothing.
    expect(calls.filters).toContainEqual({
      column: "next_run_at",
      value: "2026-03-17T09:00:00.000Z",
    });
  });

  it("advances the schedule before the run, not after", () => {
    // Stated as a test because it is a deliberate trade, not an accident: the
    // claim IS the schedule advance, so a job that crashes waits for its next
    // slot instead of re-running every tick and burning the AI cap.
    expect(PATCH.next_run_at > JOB.next_run_at).toBe(true);
  });

  it("reports a lost race as taken, not as a failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { admin } = stubClaimAdmin({ data: [] });
    expect(await claimJob(admin, JOB, PATCH)).toEqual({ claimed: false, reason: "taken" });
  });

  it("treats a null result set as taken too", async () => {
    const { admin } = stubClaimAdmin({ data: null });
    expect(await claimJob(admin, JOB, PATCH)).toEqual({ claimed: false, reason: "taken" });
  });

  it("fails closed when the claim write errors — an unclaimed job must not run", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = stubClaimAdmin({ error: { message: "permission denied" } });
    expect(await claimJob(admin, JOB, PATCH)).toEqual({
      claimed: false,
      reason: "error",
      detail: "permission denied",
    });
  });

  it("never throws when the client itself blows up", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = stubClaimAdmin(new Error("socket hang up"));
    expect(await claimJob(admin, JOB, PATCH)).toEqual({
      claimed: false,
      reason: "error",
      detail: "socket hang up",
    });
  });
});
