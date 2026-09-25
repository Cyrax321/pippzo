// Timezone inheritance for automations created or edited by the chat agent.
//
// Before the workspace setting existed, a job created without an explicit zone
// was pinned to Madrid. It now inherits the workspace zone instead — but an
// explicit zone, on the call or already on the job, always wins.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CronExpressionParser } from "cron-parser";

// The activity log writes to a real table through its own client; the calls are
// irrelevant here and mocking it keeps the test off the network.
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn(async () => undefined) }));

const { createAutomationForAgent, updateAutomationForAgent, validTimezone } =
  await import("./automations.server");

type Row = Record<string, unknown>;

/** Captures what each call wrote, and answers reads from a fixed fixture. */
function fakeClient(opts: {
  workspaceTimezone?: string | null;
  existingJob?: Row | null;
  captured: { insert?: Row; update?: Row };
}) {
  const workspaceRow = {
    automations_enabled: true,
    timezone: opts.workspaceTimezone ?? null,
  };
  return {
    from(table: string) {
      const b: Record<string, unknown> = {};
      const self = () => b;
      for (const m of ["select", "eq", "order", "limit"]) b[m] = self;
      b.insert = (row: Row) => {
        opts.captured.insert = row;
        return b;
      };
      b.update = (row: Row) => {
        opts.captured.update = row;
        return b;
      };
      b.maybeSingle = async () => {
        if (table === "workspaces") return { data: workspaceRow, error: null };
        if (opts.captured.insert) return { data: { id: "job-new", name: "n" }, error: null };
        if (opts.captured.update) return { data: { id: "job-1", name: "n" }, error: null };
        return { data: opts.existingJob ?? null, error: null };
      };
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve);
      return b;
    },
  };
}

const SCHEDULE = "0 9 * * *";
const nextIn = (tz: string, from: Date) =>
  CronExpressionParser.parse(SCHEDULE, { currentDate: from, tz }).next().toDate().toISOString();

describe("validTimezone", () => {
  it("accepts Area/City and rejects a bare city or a typo", () => {
    expect(validTimezone("Australia/Sydney")).toBe("Australia/Sydney");
    expect(validTimezone("Sydney")).toBeNull();
    expect(validTimezone("")).toBeNull();
    expect(validTimezone(undefined)).toBeNull();
  });
});

describe("createAutomationForAgent", () => {
  let captured: { insert?: Row; update?: Row };
  beforeEach(() => {
    captured = {};
  });

  it("inherits the workspace zone when the caller names none", async () => {
    const db = fakeClient({ workspaceTimezone: "America/New_York", captured });
    const res = await createAutomationForAgent(db as never, "ws-1", {
      name: "Daily post",
      taskType: "daily_post",
      schedule: SCHEDULE,
    });
    expect(res.ok).toBe(true);
    expect((captured.insert?.config as Row).timezone).toBe("America/New_York");
  });

  it("lets an explicit zone beat the workspace zone", async () => {
    const db = fakeClient({ workspaceTimezone: "America/New_York", captured });
    await createAutomationForAgent(db as never, "ws-1", {
      name: "Daily post",
      taskType: "daily_post",
      schedule: SCHEDULE,
      timezone: "Australia/Sydney",
    });
    expect((captured.insert?.config as Row).timezone).toBe("Australia/Sydney");
  });

  it("computes next_run_at as wall-clock in the inherited zone", async () => {
    const before = new Date();
    const db = fakeClient({ workspaceTimezone: "America/New_York", captured });
    await createAutomationForAgent(db as never, "ws-1", {
      name: "Daily post",
      taskType: "metrics_sync",
      schedule: SCHEDULE,
    });
    const after = new Date();
    const written = captured.insert?.next_run_at as string;
    // 9am New York and 9am Madrid are different instants, and the computed one
    // must be the former. Bracketed because `nextRun` uses its own `new Date()`.
    expect([nextIn("America/New_York", before), nextIn("America/New_York", after)]).toContain(
      written,
    );
    expect(written).not.toBe(nextIn("Europe/Madrid", before));
  });

  it("still rejects a typo with the readable Area/City message", async () => {
    const db = fakeClient({ workspaceTimezone: "America/New_York", captured });
    const res = await createAutomationForAgent(db as never, "ws-1", {
      name: "Daily post",
      taskType: "daily_post",
      schedule: SCHEDULE,
      timezone: "Sydney",
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain("not a valid IANA timezone");
    expect(captured.insert).toBeUndefined();
  });
});

describe("updateAutomationForAgent — rescheduling keeps the job's own zone", () => {
  let captured: { insert?: Row; update?: Row };
  beforeEach(() => {
    captured = {};
  });

  it("reschedules a pinned job in its own zone, not the workspace's", async () => {
    const before = new Date();
    const db = fakeClient({
      workspaceTimezone: "America/New_York",
      existingJob: { schedule: "0 6 * * *", config: { timezone: "Australia/Sydney" } },
      captured,
    });
    await updateAutomationForAgent(db as never, "ws-1", { id: "job-1", schedule: SCHEDULE });
    const after = new Date();
    const written = captured.update?.next_run_at as string;
    expect([nextIn("Australia/Sydney", before), nextIn("Australia/Sydney", after)]).toContain(
      written,
    );
    // The job's config is untouched, so its zone survives the edit.
    expect(captured.update?.config).toBeUndefined();
  });

  it("reschedules a job with no zone of its own in the workspace zone", async () => {
    const before = new Date();
    const db = fakeClient({
      workspaceTimezone: "America/New_York",
      existingJob: { schedule: "0 6 * * *", config: { platform: "linkedin" } },
      captured,
    });
    await updateAutomationForAgent(db as never, "ws-1", { id: "job-1", schedule: SCHEDULE });
    const after = new Date();
    const written = captured.update?.next_run_at as string;
    expect([nextIn("America/New_York", before), nextIn("America/New_York", after)]).toContain(
      written,
    );
  });

  it("moves a job when the caller explicitly passes a new zone", async () => {
    const db = fakeClient({
      workspaceTimezone: "America/New_York",
      existingJob: { schedule: SCHEDULE, config: { timezone: "Australia/Sydney" } },
      captured,
    });
    await updateAutomationForAgent(db as never, "ws-1", {
      id: "job-1",
      timezone: "Europe/London",
    });
    expect((captured.update?.config as Row).timezone).toBe("Europe/London");
  });
});
