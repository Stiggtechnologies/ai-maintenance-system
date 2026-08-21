/**
 * The reachability gate on the capability register.
 *
 * `capability-register.test.ts` guards the DOCUMENT: row count, unique IDs,
 * derived tally, no silent downgrade. This file guards the CLAIM. For every
 * row whose evidence cites something greppable, it asks whether the cited
 * thing is reachable from code a customer can actually run — and fails the
 * build when a row marked ✅ cites something that is not.
 *
 * The triage that motivated it found, among the 399 rows:
 *
 *   * dozens of capabilities across C2/E2/E5–E12/U3/U7 shipped as SELECT-only
 *     RLS + a demo seed + a read panel — no customer can create a threat
 *     scenario, record an emission, or declare an operating mode;
 *   * `record_verification_result`, defined AND granted, called by nothing, so
 *     loop closure is structurally 0% and a panel renders that zero as a KPI;
 *   * `decide_lifecycle_evaluation`, present in the app only inside a comment.
 *
 * Every one of those passed all five existing assertions, because not one of
 * them ever left the markdown file.
 *
 * ── Why coverage is measured over ALL rows, not just ✅ ─────────────────────
 *
 * The first version of this gate analysed only ✅ rows. Reclassifying the 68
 * rows it caught then dropped its own coverage from 93 rows to 25 — the gate
 * shrank as a direct consequence of being obeyed, and marking a row 🟡 became
 * a way to leave it. So citations are now resolved for EVERY row and the
 * coverage floor is asserted over all of them; only the FAILURE is scoped to
 * ✅, because 🟡 already means "partial" and is the honest state for a row
 * with a gap. A 🟡 row that gets its write path back can be promoted, and the
 * gate will then hold it to the promise.
 *
 * ── What this gate does NOT claim ──────────────────────────────────────────
 *
 * It proves a module is imported and a symbol is referenced. It does not prove
 * a human can reach it in three clicks, and it cannot: that is an end-to-end
 * question. It is a floor, and the floor is what was missing.
 */
import { describe, expect, it } from "vitest";
import {
  EXEMPTIONS,
  extractCitations,
  indexTsSymbols,
  judgeSqlFunction,
  judgeSqlTable,
  judgeTsSymbol,
  loadCorpus,
  loadSql,
  parseRegister,
  type Citation,
  type SkippedCitation,
  type Verdict,
} from "./support/capabilityEvidence";
import { resolveChainPolicies } from "./support/migrationPolicies";

const rows = parseRegister();
const code = loadCorpus();
const sql = loadSql();
const defs = indexTsSymbols(code);
const policies = resolveChainPolicies();

const statusOf = new Map(rows.map((r) => [r.id, r.status]));

const citations: Citation[] = [];
const skipped: SkippedCitation[] = [];
for (const row of rows) {
  const found = extractCitations(row, code, sql, defs);
  citations.push(...found.enforceable);
  skipped.push(...found.skipped);
}

const exempt = new Set(EXEMPTIONS.map((e) => e.key));
const keyOf = (c: Citation) => `${c.id}:${c.name}`;

const judge = (c: Citation): Verdict => {
  switch (c.kind) {
    case "ts-symbol":
      return judgeTsSymbol(c, code, defs);
    case "sql-function":
      return judgeSqlFunction(c, code, sql);
    case "sql-table":
      return judgeSqlTable(c, code, sql, policies);
    case "file":
      return {
        citation: c,
        ok: !code.files.has(c.name) || code.reachable.has(c.name),
        detail: code.reachable.has(c.name)
          ? "imported from an entry point"
          : "file exists but no entry point imports it",
      };
  }
};

const verdicts = citations.filter((c) => !exempt.has(keyOf(c))).map(judge);
const broken = verdicts.filter((v) => !v.ok);
/** Only a ✅ is a promise. A 🟡 already admits the gap. */
const failures = broken.filter((v) => statusOf.get(v.citation.id) === "✅");

const report = (list: Verdict[]) =>
  list
    .map(
      (v) =>
        `  ${v.citation.id}  ${v.citation.kind.padEnd(12)} \`${v.citation.raw}\`\n      ${v.detail}`,
    )
    .join("\n");

describe("capability register reachability gate", () => {
  it("reports how much of the register it can actually enforce", () => {
    // A gate that silently checks four rows is worse than no gate: it
    // certifies the other 395 by implication. So the coverage is asserted and
    // printed, and a change that shrinks it fails here rather than passing.
    const analysedRows = new Set(citations.map((c) => c.id));
    const claimed = rows.filter((r) => r.status === "✅");
    const summary = {
      registerRows: rows.length,
      claimedRows: claimed.length,
      rowsWithAnEnforceableCitation: analysedRows.size,
      claimedRowsEnforced: claimed.filter((r) => analysedRows.has(r.id)).length,
      citationsEnforced: citations.length,
      citationsSkipped: skipped.length,
      rowsCitingNothingCheckable: rows.filter((r) => !analysedRows.has(r.id))
        .length,
      knownGapsOnPartialRows: broken.length - failures.length,
    };
    console.log("[reachability gate] " + JSON.stringify(summary, null, 2));

    // Floors sit just below today's numbers: honest register growth must not
    // break the build, but a COLLAPSE in reach must.
    expect(summary.rowsWithAnEnforceableCitation).toBeGreaterThanOrEqual(90);
    expect(summary.citationsEnforced).toBeGreaterThanOrEqual(125);
  });

  it("every ✅ row citing a symbol has a non-test caller", () => {
    const dead = failures.filter((v) => v.citation.kind !== "sql-table");
    expect(dead.length === 0 ? "" : "\n" + report(dead)).toBe("");
  });

  it("every ✅ row citing a table has a customer-reachable write path", () => {
    const readOnly = failures.filter((v) => v.citation.kind === "sql-table");
    expect(readOnly.length === 0 ? "" : "\n" + report(readOnly)).toBe("");
  });

  /**
   * Once the 68 caught rows were reclassified, every real row passed — which
   * is exactly the state in which a broken gate is indistinguishable from a
   * working one. So the machinery is exercised against known-dead code that
   * the register does not cite: `poolEstimates` and `selectWeibullMethod` are
   * both finished and unit-tested with zero non-test callers, and
   * `record_verification_result` is defined and granted with none at all. If
   * any of these three starts passing, either somebody wired it up (delete the
   * case) or the detector broke (fix it) — silence is not an option.
   */
  it("still detects a dead citation — the gate proves itself", () => {
    const dead = [
      { name: "poolEstimates", kind: "ts-symbol" as const },
      { name: "selectWeibullMethod", kind: "ts-symbol" as const },
      { name: "record_verification_result", kind: "sql-function" as const },
    ];
    for (const { name, kind } of dead) {
      const probe: Citation = { id: "Z9.99", raw: name, name, kind };
      const verdict = judge(probe);
      expect(verdict.ok, `${name}: ${verdict.detail}`).toBe(false);
    }

    // …and does not simply fail everything: a live citation must pass.
    const live = judge({
      id: "Z9.98",
      raw: "get_resilience_posture",
      name: "get_resilience_posture",
      kind: "sql-function",
    });
    expect(live.ok, live.detail).toBe(true);
  });

  it("exempts nothing without a reason and a date", () => {
    for (const e of EXEMPTIONS) {
      expect(e.key, "exemption key must be <ID>:<citation>").toMatch(
        /^[A-Z]\d+\.\d+:.+/,
      );
      expect(
        e.reason.trim().length,
        `${e.key} needs a real reason`,
      ).toBeGreaterThan(30);
      expect(e.granted, `${e.key} needs an ISO date`).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
    }
  });
});
