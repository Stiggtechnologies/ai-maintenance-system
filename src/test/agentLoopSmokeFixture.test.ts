/**
 * The continuous-agent-loop smoke is a contract, not a coin flip.
 *
 * Seed inserts three alarm/warning sensors. supabase start then runs
 * simulate_telemetry_tick for minutes before CI can unschedule it, so
 * unscheduling-without-restore failed at flagged=2 created=0 (#283, #317).
 * The restore script writes those three breaches back; the smoke still
 * requires flagged >= 3 and now also created >= 3. Dropping either
 * assertion, or the restore that makes them deterministic, is the defect.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const seed = readFileSync(
  "supabase/migrations/00000000000004_demo_seed.sql",
  "utf8",
);
const restore = readFileSync(
  "scripts/ci-restore-agent-loop-fixture.sh",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

const SEEDED_FLAGS = [
  {
    name: "Vibration — Drive End",
    lastValue: "12.4",
    threshold: "10.0",
    status: "alarm",
  },
  {
    name: "Temperature — Drive End",
    lastValue: "78",
    threshold: "85",
    status: "warning",
  },
  {
    name: "Seal Chamber Pressure",
    lastValue: "3.1",
    threshold: "2.5",
    status: "warning",
  },
] as const;

function sensorsInsertBlock(sql: string): string {
  const start = sql.indexOf("insert into sensors");
  expect(start).toBeGreaterThan(-1);
  const next = sql.indexOf("insert into", start + 1);
  return sql.slice(start, next === -1 ? undefined : next);
}

describe("agent-loop smoke fixture", () => {
  it("seeds at least three alarm/warning sensors", () => {
    const block = sensorsInsertBlock(seed);
    const flagged = [...block.matchAll(/'(alarm|warning)'/g)];
    expect(flagged.length).toBeGreaterThanOrEqual(3);
    for (const row of SEEDED_FLAGS) {
      expect(block).toContain(`'${row.name}'`);
      expect(block).toContain(row.lastValue);
      expect(block).toContain(row.threshold);
      expect(block).toContain(`'${row.status}'`);
    }
  });

  it("the restore script writes those three breaches back after the walk", () => {
    expect(restore).toContain("cron.unschedule('syncai-telemetry-sim')");
    expect(restore).toContain("cron.unschedule('syncai-agent-loop')");
    expect(restore).toContain("[pre-smoke]");
    expect(restore).toContain("Investigate %");
    expect(restore).toMatch(/test "\$FLAGGED_NOW" -ge 3/);
    for (const row of SEEDED_FLAGS) {
      expect(restore).toContain(row.name);
      expect(restore).toContain(row.lastValue);
      expect(restore).toContain(row.threshold);
      expect(restore).toContain(`'${row.status}'`);
    }
  });

  it("CI restores the fixture and still requires flagged >= 3 and created >= 3", () => {
    const smokeJob = ci.slice(
      ci.indexOf("Start local Supabase (applies full migration chain)"),
      ci.indexOf("Start local Supabase (fresh migration chain + demo data)"),
    );
    expect(smokeJob).toContain(
      "bash scripts/ci-restore-agent-loop-fixture.sh",
    );
    expect(smokeJob).toContain('test "$FLAGGED" -ge 3');
    expect(smokeJob).toContain('test "$CREATED" -ge 3');
    expect(smokeJob).not.toContain('test "$CREATED" -ge 0');
    expect(smokeJob).toContain("rpc/run_agent_loop");
  });
});
