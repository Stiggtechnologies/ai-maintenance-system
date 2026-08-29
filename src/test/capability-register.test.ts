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
import {
  claimLines,
  readRegister,
  regressions,
} from "../../scripts/register-baseline.mjs";
import {
  DEVELOP_REGISTER,
  ENTERPRISE_REGISTER,
  parseRegister,
  registerClaimLines,
} from "./support/capabilityEvidence";

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

/**
 * The sync-develop register is the program of record for the Develop build,
 * and it carried the SAME headline sentence with none of the machinery: the
 * tally above is derived and CI-checked, that one was hand-typed. Slice 3B
 * moved ten rows to ✅ while the line still read the slice-3A figures
 * (✅ 40 · 🟡 126 · ❌ 68 against a true ✅ 50 · 🟡 117 · ❌ 67) — the register
 * telling its reader "the tally is derived, never hand-typed" while it was
 * neither. These assertions are that mechanism, so the claim and the practice
 * are the same thing.
 */
const DEVELOP_SOURCE = readFileSync("docs/sync-develop/register.md", "utf8");
// | <ID> | <capability> | <spec ref> | <status> | <evidence> |
const DEVELOP_ROW = /^\|\s*([A-Z]\d+\.\d+)\s*\|[^|]*\|[^|]*\|\s*(✅|🟡|❌)/u;

const developRows = DEVELOP_SOURCE.split("\n")
  .map((line) => DEVELOP_ROW.exec(line))
  .filter((m): m is RegExpExecArray => m !== null)
  .map((m) => ({ id: m[1], status: m[2] }));

describe("sync-develop register", () => {
  it("enumerates every Develop spec item", () => {
    // May only grow. A drop means a merge ate an obligation.
    expect(developRows.length).toBeGreaterThanOrEqual(234);
  });

  it("assigns each ID exactly once", () => {
    const seen = new Map<string, number>();
    for (const r of developRows) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1)).toEqual([]);
  });

  it("states a tally that matches the tables", () => {
    const counts = { "✅": 0, "🟡": 0, "❌": 0 } as Record<string, number>;
    for (const r of developRows) counts[r.status] += 1;
    const expected = `Current tally: ✅ ${counts["✅"]} · 🟡 ${counts["🟡"]} · ❌ ${counts["❌"]} (${developRows.length} items).`;
    expect(DEVELOP_SOURCE).toContain(expected);
  });

  it("keeps the tally honest — a ✅ majority would mean the Develop program is done", () => {
    const done = developRows.filter((r) => r.status === "✅").length;
    expect(done).toBeLessThan(developRows.length);
  });
});

/**
 * The same ratchet, on the same terms, for the Develop register.
 *
 * `npm run register:check` is not a CI step in this repo — the three
 * enterprise assertions above ARE how the baseline reaches CI, through the
 * vitest job. So the Develop baseline had to arrive the same way or it would
 * have been a file nothing read.
 *
 * Until 2026-08-28 this register was the one place a ✅ could become a ❌ with
 * nothing in the diff to show for it: four slices moved rows in it, the tally
 * was generalized to cover it on 2026-08-27, and the per-row ratchet was not.
 * The first run of the generalized ratchet caught seven honest demotions
 * (D2.04, D3.02, D3.03, D3.14, D3.19, D3.24, D3.35) that the reachability gate
 * had just forced — which is the mechanism working on the day it was armed,
 * not a hypothetical.
 *
 * The evidence cell is read with the FULL-CELL pattern, not the status-prefix
 * pattern above: nine rows quote a grep alternation (`grep 'ncr\|nonconformance'`)
 * and a pipe-free cell pattern truncates there, silently under-counting the
 * citations it is supposed to be ratcheting.
 */
const DEVELOP_BASELINE = JSON.parse(
  readFileSync("docs/sync-develop/register-baseline.json", "utf8"),
) as Record<string, { status: string; evidence: boolean }>;

const DEVELOP_EVIDENCED =
  /^\|\s*(?<id>[A-Z]\d+\.\d+)\s*\|(?<capability>[^|]*)\|(?<specRef>[^|]*)\|\s*(?<status>✅|🟡|❌)\s*\|(?<evidence>.*?)\|?\s*$/u;

const developDetailed = new Map<
  string,
  { status: string; evidence: boolean }
>();
for (const line of DEVELOP_SOURCE.split("\n")) {
  const m = DEVELOP_EVIDENCED.exec(line);
  if (m?.groups) {
    developDetailed.set(m.groups.id, {
      status: m.groups.status,
      evidence: m.groups.evidence.trim().length >= 12,
    });
  }
}

/**
 * Four parsers read these two files: the two simple patterns above, the
 * TypeScript one the reachability gate uses, and the Node one the ratchet
 * script uses. Four copies of a rule drift, and every drift has the same
 * consequence — a row inside one mechanism's scope and outside another's, so
 * whichever mechanism a contributor happens to run reports a clean bill of
 * health for a row nothing checked.
 *
 * That is not hypothetical. `| **D1.99** | … | ✅ | via `add_framework_gate`. |`
 * — a ✅ row citing a function this branch demoted seven rows over — was
 * invisible to ALL FOUR at once, because all four asked "does the first cell
 * look like an ID?" before asking "does this row parse?". Two asterisks and
 * the row was outside the program of record while sitting inside it.
 *
 * So agreement is asserted, on the real files, in both directions.
 */
describe("every register parser reads the same register", () => {
  for (const [register, localIds] of [
    [ENTERPRISE_REGISTER, rows.map((r) => r.id)],
    [DEVELOP_REGISTER, developRows.map((r) => r.id)],
  ] as const) {
    const source = readFileSync(register.path, "utf8");

    it(`${register.name}: the gate, the ratchet and the tally see one row set`, () => {
      const fromGate = parseRegister(register, source).map((r) => r.id);
      const fromRatchet = Object.keys(
        readRegister({ ...register, baseline: "" }, source),
      );
      expect(fromGate).toEqual([...localIds]);
      expect(fromRatchet.sort()).toEqual([...fromGate].sort());
    });

    it(`${register.name}: no table line sits outside every parser`, () => {
      // Structural, not pattern-based: a register's table lines are claims,
      // save the `|---|` rule and the header above it. If the count of claim
      // lines exceeds the count of parsed rows, the difference is rows that
      // are in the document and in nothing else.
      const claims = registerClaimLines(source);
      expect(claims.length).toBe(localIds.length);
      // And the Node copy of that rule must agree with the TypeScript one, or
      // the CI lint job and the CI test job are policing different documents.
      expect(claimLines(source).map((c) => c.line)).toEqual(
        claims.map((c) => c.line),
      );
    });
  }
});

/**
 * The CITATION half of the ratchet, reaching the test job.
 *
 * The assertions in this file cover status, evidence and removal. They do not
 * cover the cheapest evasion there is: deleting two backticks keeps the
 * sentence, keeps the evidence flag true, satisfies everything above, and
 * silently removes the row from the reachability gate's scope. That half lives
 * in `scripts/register-baseline.mjs`, and until 2026-08-28 it reached no CI
 * job at all — `npm run register:check` was in package.json and in nobody's
 * workflow. It is a lint-job step now, and this is the other half of the
 * repo's standing bargain that deleting one leaves the other running.
 */
describe("both registers, per-row citation ratchet", () => {
  for (const register of [ENTERPRISE_REGISTER, DEVELOP_REGISTER] as const) {
    const baselinePath =
      register === ENTERPRISE_REGISTER
        ? "docs/enterprise-readiness/capability-baseline.json"
        : "docs/sync-develop/register-baseline.json";

    it(`${register.name}: no row loses status, evidence or citations`, () => {
      const base = JSON.parse(readFileSync(baselinePath, "utf8"));
      const current = readRegister(
        { ...register, baseline: baselinePath },
        readFileSync(register.path, "utf8"),
      );
      expect(regressions(base, current)).toEqual([]);
    });
  }
});

describe("sync-develop register ratchet", () => {
  it("reads every row the tally reads — no row escapes the ratchet by shape", () => {
    // The two patterns must agree on scope. If the detailed one understands
    // fewer rows than the counting one, the difference is a set of rows that
    // are tallied but never ratcheted, and nothing else would report it.
    expect(developDetailed.size).toBe(developRows.length);
  });

  it("never regresses an item's status without an updated baseline", () => {
    const regressed = Object.entries(DEVELOP_BASELINE)
      .filter(([id, was]) => {
        const now = developDetailed.get(id);
        return now && RANK[now.status] < RANK[was.status];
      })
      .map(([id]) => id);
    expect(regressed).toEqual([]);
  });

  it("never strips the evidence from a claim that had it", () => {
    const stripped = Object.entries(DEVELOP_BASELINE)
      .filter(
        ([id, was]) =>
          was.evidence && developDetailed.get(id)?.evidence === false,
      )
      .map(([id]) => id);
    expect(stripped).toEqual([]);
  });

  it("never drops an item the baseline knows about", () => {
    const missing = Object.keys(DEVELOP_BASELINE).filter(
      (id) => !developDetailed.has(id),
    );
    expect(missing).toEqual([]);
  });
});
