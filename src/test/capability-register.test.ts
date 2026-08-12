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

/**
 * The tally catches the COUNT drifting; it does not catch a single row quietly
 * losing its status or its evidence. That happened during a merge — C8.07 went
 * from "✅ all ten modelled (job_plans…)" back to a bare "❌" while the totals
 * still added up, because another row had moved the other way.
 *
 * The baseline is a ratchet. A deliberate downgrade stays possible — slice 10
 * honestly demoted five decision rights — but it requires regenerating the
 * baseline in the same commit, which puts the downgrade in the diff where a
 * reviewer sees it rather than in a merge nobody reads.
 */
const BASELINE = JSON.parse(
  readFileSync("docs/enterprise-readiness/capability-baseline.json", "utf8"),
) as Record<string, { status: string; evidence: boolean }>;

const EVIDENCED = /^\|\s*([A-Z]\d+\.\d+)\s*\|([^|]*)\|\s*(✅|🟡|❌)([^|]*)\|/u;
const RANK: Record<string, number> = { "❌": 0, "🟡": 1, "✅": 2 };

const detailed = new Map<string, { status: string; evidence: boolean }>();
for (const line of SOURCE.split("\n")) {
  const m = EVIDENCED.exec(line);
  if (m) {
    detailed.set(m[1], { status: m[3], evidence: m[4].trim().length >= 12 });
  }
}

describe("capability register ratchet", () => {
  it("never regresses an item's status without an updated baseline", () => {
    const regressed = Object.entries(BASELINE)
      .filter(([id, was]) => {
        const now = detailed.get(id);
        return now && RANK[now.status] < RANK[was.status];
      })
      .map(([id]) => id);
    expect(regressed).toEqual([]);
  });

  it("never strips the evidence from a claim that had it", () => {
    const stripped = Object.entries(BASELINE)
      .filter(
        ([id, was]) => was.evidence && detailed.get(id)?.evidence === false,
      )
      .map(([id]) => id);
    expect(stripped).toEqual([]);
  });

  it("never drops an item the baseline knows about", () => {
    const missing = Object.keys(BASELINE).filter((id) => !detailed.has(id));
    expect(missing).toEqual([]);
  });
});
