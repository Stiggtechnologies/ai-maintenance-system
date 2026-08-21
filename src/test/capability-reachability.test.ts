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
  judgeFile,
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
      return judgeFile(c, code);
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

    // Floors sit AT today's numbers, not below them.
    //
    // They used to sit below, and the slack was the hole: with 95 rows
    // enforceable against a floor of 90, five ✅ rows could be de-cited — two
    // characters each, indistinguishable from a formatting tidy in review —
    // and the suite stayed green while a fifth of the gate's ✅ scope
    // disappeared. `claimedRowsEnforced` was computed, logged, and never
    // asserted at all, so de-citing all 25 would have driven it to zero with
    // every other assertion still passing.
    //
    // Lowering one of these is therefore a deliberate act that shows up in the
    // diff, which is the same bargain `register:accept` strikes for a status
    // downgrade. Surgical de-citation of a single row is caught earlier and
    // more precisely, by the per-row citation ratchet in
    // `scripts/register-baseline.mjs`.
    expect(summary.rowsWithAnEnforceableCitation).toBeGreaterThanOrEqual(132);
    expect(summary.citationsEnforced).toBeGreaterThanOrEqual(191);
    expect(summary.claimedRowsEnforced).toBeGreaterThanOrEqual(33);
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

  /**
   * The three evasions a review actually found, pinned so they stay closed.
   *
   * Each was demonstrated against the first version of this gate: a one-line
   * comment made a dead symbol pass; a getter in the same migration vouched for
   * a table it does not write; and an existence check passed a file no entry
   * point imports. None of the three looks like an attack in a diff — two of
   * them look like documentation.
   */
  it("is not fooled by a comment, a getter, or a file that merely exists", () => {
    // 1. A COMMENT IS NOT A CALLER. `decide_lifecycle_evaluation` appears in
    //    the app only inside a comment at LifecycleDecisionsPage.tsx — the
    //    archetypal dead capability named in this gate's own header. The first
    //    version of the gate would have passed it on that comment.
    const commentOnly = judge({
      id: "Z9.97",
      raw: "decide_lifecycle_evaluation",
      name: "decide_lifecycle_evaluation",
      kind: "sql-function",
    });
    expect(commentOnly.ok, commentOnly.detail).toBe(false);
    expect(commentOnly.detail).toMatch(/prose or a comment only/);

    // 2. A GETTER DOES NOT VOUCH FOR A WRITER. `get_dependency_coverage()` is a
    //    read-only function declared in the same migration as the real writer;
    //    the file-scoped judge credited it for `asset_dependencies`. Body
    //    scoping must now attribute the write to the function that performs it.
    const written = judge({
      id: "Z9.96",
      raw: "asset_dependencies",
      name: "asset_dependencies",
      kind: "sql-table",
    });
    expect(written.ok, written.detail).toBe(true);
    expect(
      written.detail,
      "the write must be attributed to the function whose body performs it",
    ).toMatch(/review_dependency_candidate/);

    // 3. EXISTENCE IS NOT REACHABILITY. Twenty-one components under src/ are
    //    imported by nothing; a row citing one must not pass on `existsSync`.
    const orphan = judge({
      id: "Z9.95",
      raw: "src/components/CommandCenterDashboard.tsx",
      name: "src/components/CommandCenterDashboard.tsx",
      kind: "file",
    });
    expect(orphan.ok, orphan.detail).toBe(false);
  });

  /**
   * A pg_cron schedule is the ONLY caller of several loop producers by design —
   * `evaluate_ca_effectiveness` is explicitly revoked from `authenticated` and
   * driven at '15 * * * *'. Tightening the symbol judges briefly failed this
   * one closed, which is the failure mode that gets a gate deleted rather than
   * fixed, so the case is pinned.
   */
  it("counts a pg_cron schedule as a caller", () => {
    const cron = judge({
      id: "Z9.94",
      raw: "evaluate_ca_effectiveness",
      name: "evaluate_ca_effectiveness",
      kind: "sql-function",
    });
    expect(cron.ok, cron.detail).toBe(true);
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
      // The date was format-checked only, so `1999-01-01` passed and an
      // exemption could outlive the reason it was granted for. An exemption is
      // a deferral, not a decision: after a year it must be re-argued or the
      // underlying gap fixed.
      const ageDays =
        (Date.now() - Date.parse(e.granted)) / (1000 * 60 * 60 * 24);
      expect(
        ageDays,
        `${e.key} was exempted on ${e.granted} — re-argue it or fix the gap`,
      ).toBeLessThan(366);
      expect(ageDays, `${e.key} is dated in the future`).toBeGreaterThan(-1);
    }
  });
});
