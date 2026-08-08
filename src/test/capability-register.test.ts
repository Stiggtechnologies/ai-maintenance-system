/**
 * The capability register is the program of record for the enterprise-OS
 * build. Two failure modes have actually bitten this repo:
 *
 *   * the headline tally drifting from the tables it summarizes (a hand-typed
 *     figure once under-counted the register by 90 items), and
 *   * parallel merges silently dropping or duplicating a row.
 *
 * These assertions make both a test failure rather than a discovery.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);
const ROW = /^\|\s*([A-Z]\d+\.\d+)\s*\|[^|]*\|\s*(✅|🟡|❌)/u;

const rows = SOURCE.split("\n")
  .map((line) => ROW.exec(line))
  .filter((m): m is RegExpExecArray => m !== null)
  .map((m) => ({ id: m[1], status: m[2] }));

describe("capability register", () => {
  it("enumerates every spec item", () => {
    // The register may only grow. A drop means a merge ate an obligation.
    expect(rows.length).toBeGreaterThanOrEqual(397);
  });

  it("assigns each ID exactly once", () => {
    const seen = new Map<string, number>();
    for (const r of rows) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1)).toEqual([]);
  });

  it("states a tally that matches the tables", () => {
    const counts = { "✅": 0, "🟡": 0, "❌": 0 } as Record<string, number>;
    for (const r of rows) counts[r.status] += 1;
    const expected = `Current tally: ✅ ${counts["✅"]} · 🟡 ${counts["🟡"]} · ❌ ${counts["❌"]}.`;
    expect(SOURCE).toContain(expected);
  });

  it("keeps the tally honest — a ✅ majority would mean the program is done", () => {
    const done = rows.filter((r) => r.status === "✅").length;
    expect(done).toBeLessThan(rows.length);
  });
});
