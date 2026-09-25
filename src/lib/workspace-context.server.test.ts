// The workspace timezone setting and its precedence rule.
//
// The rule that matters: a cron job with an explicit `config.timezone` keeps it
// forever. The workspace setting replaces the hard-coded Madrid fallback for
// jobs that never set one — it does not override a job someone deliberately
// pinned to Sydney.
//
// The Supabase builder is stubbed by a tiny thenable so each table can be
// answered independently and the reads the code actually performs are visible.

import { describe, it, expect } from "vitest";
import {
  FALLBACK_TIMEZONE,
  isUsableTimezone,
  loadWorkspaceTimezone,
  listAutomationsForAgent,
} from "./workspace-context.server";

type Result = { data: unknown; error: { message: string } | null };

/**
 * A chainable, awaitable stand-in for the PostgREST builder. Every filter is a
 * no-op that returns `this`; awaiting it (or calling maybeSingle) resolves the
 * result registered for that table.
 */
function fakeClient(tables: Record<string, Result | (() => Result)>) {
  const resultFor = (t: string): Result => {
    const r = tables[t];
    if (!r) throw new Error(`unexpected table read: ${t}`);
    return typeof r === "function" ? r() : r;
  };
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        then: (resolve: (v: Result) => unknown) => Promise.resolve(resultFor(table)).then(resolve),
        maybeSingle: () => Promise.resolve(resultFor(table)),
      };
      for (const m of ["select", "eq", "ilike", "order", "limit", "gte", "lte"]) {
        builder[m] = () => builder;
      }
      return builder;
    },
  };
}

const job = (config: Record<string, unknown> | null) => ({
  id: "job-1",
  name: "Daily post",
  task_type: "daily_post",
  enabled: true,
  schedule: "0 9 * * *",
  next_run_at: "2026-09-15T07:00:00.000Z",
  last_run_at: null,
  config,
});

describe("isUsableTimezone", () => {
  it("accepts real IANA names and trims them", () => {
    expect(isUsableTimezone("Australia/Sydney")).toBe(true);
    expect(isUsableTimezone("  UTC  ")).toBe(true);
  });

  it("rejects empty, missing and unloadable names", () => {
    expect(isUsableTimezone("")).toBe(false);
    expect(isUsableTimezone("   ")).toBe(false);
    expect(isUsableTimezone(null)).toBe(false);
    expect(isUsableTimezone(undefined)).toBe(false);
    expect(isUsableTimezone("Sydney")).toBe(false);
    expect(isUsableTimezone("Mars/Olympus_Mons")).toBe(false);
  });
});

describe("loadWorkspaceTimezone", () => {
  it("returns the stored zone", async () => {
    const db = fakeClient({ workspaces: { data: { timezone: "America/New_York" }, error: null } });
    await expect(loadWorkspaceTimezone(db as never, "ws-1")).resolves.toBe("America/New_York");
  });

  it("falls back when the row is missing, empty or unreadable", async () => {
    for (const row of [null, { timezone: null }, { timezone: "" }, { timezone: "Nope/Nope" }]) {
      const db = fakeClient({ workspaces: { data: row, error: null } });
      await expect(loadWorkspaceTimezone(db as never, "ws-1")).resolves.toBe(FALLBACK_TIMEZONE);
    }
  });

  it("never throws when the query itself blows up", async () => {
    const db = {
      from() {
        throw new Error("RLS denied");
      },
    };
    await expect(loadWorkspaceTimezone(db as never, "ws-1")).resolves.toBe(FALLBACK_TIMEZONE);
  });

  it("still matches the pre-setting behaviour by default", () => {
    // The column default in 20260914120000 is this same value, so a workspace
    // that never opens the setting behaves exactly as the hard-coded code did.
    expect(FALLBACK_TIMEZONE).toBe("Europe/Madrid");
  });
});

describe("listAutomationsForAgent — job zone precedence", () => {
  const withJob = (config: Record<string, unknown> | null, workspaceTz: string) =>
    listAutomationsForAgent(
      fakeClient({
        workspaces: { data: { timezone: workspaceTz }, error: null },
        cron_jobs: { data: [job(config)], error: null },
        cron_runs: { data: [], error: null },
      }) as never,
      "ws-1",
    );

  it("uses the workspace zone for a job that never set one", async () => {
    const res = await withJob({ platform: "linkedin" }, "America/New_York");
    expect(res.ok && res.automations[0].timezone).toBe("America/New_York");
  });

  it("keeps an explicit per-job zone even when the workspace zone differs", async () => {
    const res = await withJob({ timezone: "Australia/Sydney" }, "America/New_York");
    expect(res.ok && res.automations[0].timezone).toBe("Australia/Sydney");
  });

  it("renders next run in the job's own zone, labelled", async () => {
    const sydney = await withJob({ timezone: "Australia/Sydney" }, "America/New_York");
    const inherited = await withJob(null, "America/New_York");
    // Same instant, two zones — the localized strings must not match.
    expect(sydney.ok && sydney.automations[0].nextRunLocal).toContain("Australia/Sydney");
    expect(inherited.ok && inherited.automations[0].nextRunLocal).toContain("America/New_York");
    expect(sydney.ok && sydney.automations[0].nextRunLocal).not.toBe(
      inherited.ok && inherited.automations[0].nextRunLocal,
    );
  });

  it("falls back to the default zone when the workspace row cannot be read", async () => {
    const res = await listAutomationsForAgent(
      fakeClient({
        workspaces: { data: null, error: null },
        cron_jobs: { data: [job(null)], error: null },
        cron_runs: { data: [], error: null },
      }) as never,
      "ws-1",
    );
    expect(res.ok && res.automations[0].timezone).toBe(FALLBACK_TIMEZONE);
  });
});
