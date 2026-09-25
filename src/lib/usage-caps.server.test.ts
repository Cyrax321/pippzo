// Characterisation tests for monthStart — the start of the billing window the
// monthly AI token cap is measured over. A one-day drift here silently shifts
// every workspace's cap, so the UTC semantics are pinned hard.

import { describe, it, expect, afterEach, vi } from "vitest";
import { monthStart, UsageCapError, getMonthlyUsage } from "./usage-caps.server";

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("monthStart", () => {
  it("returns UTC midnight on the 1st of the month", () => {
    const d = monthStart(new Date("2026-03-17T13:45:12.345Z"));
    expect(d.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(d.getUTCDate()).toBe(1);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
    expect(d.getUTCMilliseconds()).toBe(0);
  });

  it("defaults to the current time and still lands on the 1st at UTC midnight", () => {
    const d = monthStart();
    expect(d.getUTCDate()).toBe(1);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("handles a month boundary: the last millisecond of March stays in March", () => {
    expect(monthStart(new Date("2026-03-31T23:59:59.999Z")).toISOString()).toBe(
      "2026-03-01T00:00:00.000Z",
    );
    expect(monthStart(new Date("2026-04-01T00:00:00.000Z")).toISOString()).toBe(
      "2026-04-01T00:00:00.000Z",
    );
  });

  it("handles a year boundary", () => {
    expect(monthStart(new Date("2026-12-31T23:59:59.999Z")).toISOString()).toBe(
      "2026-12-01T00:00:00.000Z",
    );
    expect(monthStart(new Date("2027-01-01T00:00:30.000Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("handles a leap year: Feb 29 rolls back to Feb 1", () => {
    expect(monthStart(new Date("2024-02-29T12:00:00.000Z")).toISOString()).toBe(
      "2024-02-01T00:00:00.000Z",
    );
    expect(monthStart(new Date("2024-03-01T00:00:00.000Z")).toISOString()).toBe(
      "2024-03-01T00:00:00.000Z",
    );
    // 2026 is not a leap year — Feb 28 is the last day.
    expect(monthStart(new Date("2026-02-28T23:00:00.000Z")).toISOString()).toBe(
      "2026-02-01T00:00:00.000Z",
    );
  });

  it("is timezone-independent near midnight UTC on the 1st", () => {
    // Node re-reads process.env.TZ, so this genuinely exercises the machine
    // timezone. 00:30 UTC on Jun 1 is Jun 1 14:30 in Kiritimati (UTC+14) and
    // May 31 13:30 in Midway (UTC-11) — monthStart must say June either way.
    const justAfterMidnight = new Date("2026-06-01T00:30:00.000Z");
    const justBeforeMidnight = new Date("2026-05-31T23:30:00.000Z");

    for (const tz of ["UTC", "Pacific/Kiritimati", "Pacific/Midway", "America/New_York"]) {
      process.env.TZ = tz;
      expect(monthStart(justAfterMidnight).toISOString()).toBe("2026-06-01T00:00:00.000Z");
      expect(monthStart(justBeforeMidnight).toISOString()).toBe("2026-05-01T00:00:00.000Z");
    }
  });

  it("does not mutate the date it is given", () => {
    const now = new Date("2026-03-17T13:45:12.345Z");
    monthStart(now);
    expect(now.toISOString()).toBe("2026-03-17T13:45:12.345Z");
  });
});

// A minimal stand-in for the Supabase client, just enough to drive
// getMonthlyUsage's RPC-less fallback path: no `rpc` method at all (so the
// primary path is skipped exactly as it would be against a project whose
// migration for ai_usage_month_total has not run yet), and an
// activity_log table that actually honours `.range()` like PostgREST does.
function makeUsageClient(opts: {
  cap?: number;
  rows: Array<{ details: { totalTokens: number } }>;
}) {
  const { cap = 0, rows } = opts;
  return {
    from: (table: string) => {
      if (table === "workspaces") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { monthly_token_cap: cap }, error: null }),
            }),
          }),
        };
      }
      // activity_log: a chainable query object whose only real behaviour is
      // `.range(start, end)` slicing the fixture rows, mirroring the server's
      // own `max_rows = 1000` ceiling on every individual request.
      let start = 0;
      let end = 0;
      const self = {
        select: () => self,
        eq: () => self,
        gte: () => self,
        order: () => self,
        range: (s: number, e: number) => {
          start = s;
          end = e;
          return self;
        },
        then: (
          resolve: (v: { data: unknown; error: null }) => unknown,
          reject?: (e: unknown) => unknown,
        ) =>
          Promise.resolve({ data: rows.slice(start, end + 1), error: null }).then(resolve, reject),
      };
      return self;
    },
  };
}

describe("getMonthlyUsage — fallback pagination past the row cap (finding 19)", () => {
  it("sums correctly when everything fits in a single page", async () => {
    const rows = Array.from({ length: 3 }, () => ({ details: { totalTokens: 100 } }));
    const snap = await getMonthlyUsage(makeUsageClient({ rows }) as never, "ws1");
    expect(snap.used).toBe(300);
  });

  it("pages past the 1000-row server cap instead of truncating", async () => {
    // The old single `.limit(5000)` request was itself capped server-side at
    // 1000 rows (supabase/config.toml's max_rows), so this would have summed
    // only 10,000 of the true 25,000 tokens. Paginating recovers the full
    // total instead of silently under-counting a busy workspace's spend.
    const rows = Array.from({ length: 2500 }, () => ({ details: { totalTokens: 10 } }));
    const snap = await getMonthlyUsage(makeUsageClient({ rows }) as never, "ws1");
    expect(snap.used).toBe(25_000);
  });

  it("sums correctly right at a page boundary", async () => {
    const rows = Array.from({ length: 2000 }, () => ({ details: { totalTokens: 1 } }));
    const snap = await getMonthlyUsage(makeUsageClient({ rows }) as never, "ws1");
    expect(snap.used).toBe(2000);
  });

  it("stops at its safety ceiling and warns instead of looping forever or under-counting silently", async () => {
    const rows = Array.from({ length: 50_005 }, () => ({ details: { totalTokens: 2 } }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const snap = await getMonthlyUsage(makeUsageClient({ rows }) as never, "ws1");
    // 50 pages * 1000 rows * 2 tokens — the ceiling, not the true 100,010.
    expect(snap.used).toBe(100_000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("safety ceiling"));
    warn.mockRestore();
  });

  it("treats rows with no totalTokens as zero rather than throwing", async () => {
    const rows = [{ details: { totalTokens: 50 } }, { details: {} as { totalTokens: number } }];
    const snap = await getMonthlyUsage(makeUsageClient({ rows }) as never, "ws1");
    expect(snap.used).toBe(50);
  });
});

describe("UsageCapError", () => {
  it("carries used/cap and a message naming both, thousands-separated", () => {
    const err = new UsageCapError(1_250_000, 1_000_000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("UsageCapError");
    expect(err.used).toBe(1_250_000);
    expect(err.cap).toBe(1_000_000);
    expect(err.message).toContain("1,250,000 / 1,000,000 tokens");
    expect(err.message).toContain("/automations");
  });
});
