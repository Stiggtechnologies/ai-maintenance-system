/**
 * The reachability gate on the capability registers.
 *
 * `capability-register.test.ts` guards the DOCUMENTS: row count, unique IDs,
 * derived tally, no silent downgrade. This file guards the CLAIM. For every
 * row whose evidence cites something greppable, it asks whether the cited
 * thing is reachable from code a customer can actually run — and fails the
 * build when a row marked ✅ cites something that is not.
 *
 * The triage that motivated it found, among the 399 enterprise rows:
 *
 *   * dozens of capabilities across C2/E2/E5–E12/U3/U7 shipped as SELECT-only
 *     RLS + a demo seed + a read panel — no customer can create a threat
 *     scenario, record an emission, or declare an operating mode;
 *   * `record_verification_result` was defined AND granted with no callers, so
 *     loop closure was structurally 0% and a panel rendered that zero as a KPI
 *     (wired 2026-08-30 via `recordVerificationResult` on Learning Loop);
 *   * `decide_lifecycle_evaluation`, present in the app only inside a comment.
 *
 * Every one of those passed all five existing assertions, because not one of
 * them ever left the markdown file.
 *
 * ── Why BOTH registers ─────────────────────────────────────────────────────
 *
 * For six weeks this gate had a hardcoded path, and the path was the enterprise
 * register. `docs/sync-develop/register.md` inherited the house RULE — its own
 * preamble says "✅ requires the full chain a customer can walk (surface →
 * caller → RPC → persisted → customer-visible), with evidence a reachability
 * gate would accept" — and inherited none of the MACHINERY. Four slices
 * promoted rows in it under a standard nothing measured.
 *
 * Running it found seven ✅ rows citing eleven dead symbols, and the shape of
 * the finding is the argument for the gate: five of the seven rows NAMED their
 * own gap in their own evidence and kept the ✅ anyway ("gate AUTHORING is
 * RPC-first (add_framework_gate, no page)"), and four of them cited a function
 * that a NEIGHBOURING 🟡 row cites as the reason it is only 🟡. The register
 * was already internally inconsistent; nothing could see it, because seeing it
 * required resolving prose to code.
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
  DEVELOP_REGISTER,
  ENTERPRISE_REGISTER,
  EXEMPTIONS,
  REGISTERS,
  extractCitations,
  indexTsSymbols,
  judgeFile,
  judgeSqlFunction,
  judgeSqlTable,
  judgeTsSymbol,
  isTestFile,
  loadCorpus,
  loadSql,
  modulesRunningPattern,
  parseRegister,
  type Citation,
  type RegisterSpec,
  type SkippedCitation,
  type Verdict,
} from "./support/capabilityEvidence";
import { resolveChainPolicies } from "./support/migrationPolicies";

const code = loadCorpus();
const sql = loadSql();
const defs = indexTsSymbols(code);
const policies = resolveChainPolicies();

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

/**
 * The three coverage floors, per register.
 *
 * Floors sit AT today's numbers, not below them.
 *
 * They used to sit below, and the slack was the hole: with 95 rows enforceable
 * against a floor of 90, five ✅ rows could be de-cited — two characters each,
 * indistinguishable from a formatting tidy in review — and the suite stayed
 * green while a fifth of the gate's ✅ scope disappeared. `claimedRowsEnforced`
 * was computed, logged, and never asserted at all, so de-citing all 25 would
 * have driven it to zero with every other assertion still passing.
 *
 * Lowering one of these is therefore a deliberate act that shows up in the
 * diff, which is the same bargain `register:accept` strikes for a status
 * downgrade.
 *
 * They must also be RE-DERIVED whenever a register moves, or the rule above
 * decays into the hole it was written to close. The enterprise floors were
 * first written at 132/191/33 and were still at 132/191/33 after the register
 * was rebased onto current main, by which point the live numbers were
 * 147/215/44. Re-derived 2026-08-24 to sit AT the live numbers again.
 *
 * Do not delegate this to the per-row citation ratchet in
 * `scripts/register-baseline.mjs`: it is finer-grained, but
 * `register-baseline.mjs --write` rewrites the whole baseline, and AGENTS.md
 * rule 2 requires `npm run register:accept` in the same commit as any status
 * change. Every status change therefore resets that ratchet. These floors are
 * the only backstop that survives it.
 */
interface Floors {
  rowsWithAnEnforceableCitation: number;
  citationsEnforced: number;
  claimedRowsEnforced: number;
  /**
   * A CEILING, not a floor: ✅ rows this gate cannot check at all.
   *
   * The three numbers above are all satisfiable by a register that grows. Add
   * a ✅ row whose evidence names nothing greppable and every floor still
   * holds — `claimedRows` goes up, `claimedRowsEnforced` does not move, and
   * the new claim is certified by the implication that the gate looked at it.
   * That is the exact failure the header calls out ("a gate that silently
   * checks four rows … certifies the other 395 by implication") measured from
   * the other end, and nothing measured it.
   *
   * So the unenforced ✅ population is capped where it stands. A new ✅ must
   * either cite something the gate can resolve, or move this number in the
   * diff with a reason — the same bargain the floors strike.
   */
  claimedRowsUnenforced: number;
}

const FLOORS: Record<string, Floors> = {
  [ENTERPRISE_REGISTER.name]: {
    // 147/206/44 -> 151/210/46 on 2026-08-28. The floors had drifted BELOW the
    // live numbers again — 4/4/2 of slack against a comment three lines up
    // saying they sit AT them — which is enough room to de-cite two ✅ rows
    // out of the gate's scope with the suite green. Re-derived to sit at the
    // live numbers, which is a tightening: nothing about what the gate checks
    // changed, only how much of it the gate is required to still be checking.
    // 151/210/46/185 -> 152/213/47/184 on 2026-08-31 (Slice 4D). The enterprise
    // register did not change in this slice; the numbers moved because the gate's
    // resolver now walks the new develop service functions and components, which
    // are shared symbols. Re-derived to sit AT the live numbers again, which is
    // a tightening on three counts and — the one that matters — a LOWER ceiling
    // on the unenforced ✅ population.
    // 152/213/47/184 -> 153/217/49/184 on 2026-09-03 (Slice 7B). The
    // enterprise register did not change in this slice either; the numbers
    // moved because the gate's resolver now walks the new field-readiness
    // service functions and the Execution Readiness page, which are shared
    // symbols. Re-derived to sit AT the live numbers again — a tightening on
    // three counts, with the ceiling unchanged.
    //
    // 153/217/49/184 -> 157/236/56/184 on 2026-09-06 (D7 residual + Slice 1
    // authoring). The enterprise register did not change in this slice; the
    // numbers moved because the gate's resolver now walks
    // `createProjectFramework` and `addFrameworkStage`, which are shared
    // symbols. Re-derived to sit AT the live numbers — a tightening on three
    // counts, with the ceiling unchanged.
    rowsWithAnEnforceableCitation: 157,
    // 215 -> 206 on 2026-08-26. This drop is NOT the gate losing reach: it is the
    // gate WINNING. 74 rows were demoted from ✅ this same commit because their
    // cited symbol or table has no customer-reachable path, and a demoted row's
    // citations leave the enforceable set by definition. The floor tracks what the
    // gate can still parse and check, and that capability is unchanged.
    //
    // It may only be lowered again with the same kind of reason stated here. A
    // silent decrease means the parser stopped understanding evidence it used to
    // understand, which is precisely the failure this number exists to catch.
    citationsEnforced: 236,
    claimedRowsEnforced: 56,
    claimedRowsUnenforced: 184,
  },
  // Derived 2026-08-28, the commit that first ran this gate against the
  // D-family register, and derived AFTER the seven honest demotions it forced —
  // so the floor records the reach the gate has over a register telling the
  // truth, not the reach it had over one that was not.
  //
  // 109/224/39 -> 110/226/40 the same day: D11.31 "Append-only audit ledger"
  // named `audit_events` and its append-only trigger function in UNBACKTICKED
  // prose, and prose is mined for functions only — so the one substantive ✅
  // claim about a table in this register was outside the write-path judge
  // purely on punctuation. Backticked, both citations pass on their merits.
  //
  // 110/226/40 -> 116/297/48 (2026-08-28, Slice 3C): eight rows landed with
  // real chains and the repair pass added citations to them. Floors sit AT
  // today's numbers — leaving them at 110/226/40 would let a later change
  // de-cite these eight rows back to where they started with the suite still
  // green, which is exactly the slack this block's own history describes.
  //
  // 116/297/48 -> 119/350/57 (2026-08-28, Slice 3D): the gate review workflow,
  // three agents and the assurance case landed, and — the part that matters
  // here — five of the seven rows this gate demoted earlier the same day were
  // honestly re-closed by wiring the callers it found missing (framework
  // adoption, gate authoring, requirement tier and weight, framework
  // versioning, tailoring-rule authoring). RATCHETED UP for that reason: the
  // reach is real and a later change must not be able to give it back
  // silently. Two rows were deliberately NOT re-closed (D2.04, D3.19) and one
  // (D3.02) was returned to 🟡 rather than de-citing the dead symbol it still
  // depends on — the ceiling below did not move, which is the check that
  // would have caught doing it the other way.
  //
  // citationsEnforced 350 -> 362 (2026-08-28, Slice 3D REPAIR PASS). The
  // adversarial review found two register sentences asserting more than the
  // code delivered — D12.06's "no vendor or model id is hardcoded" (the three
  // agents each carried `?? "gpt-4o-mini"` and `?? "stigg/fast"`) and D12.12's
  // "develop-risk-agent from the Assurance Case screen" (`runRiskAgent` had
  // zero callers anywhere) — plus §70 walls missing behind four RPC-only
  // refusals. Both sentences are now true of the code rather than softened in
  // the register, and the repair notes on D3.14/D3.31/D11.24/D12.06/D12.08/
  // D12.12/D13.06 cite the new migration, functions and callers by resolvable
  // path. RATCHETED UP for the reason this block already gives twice: the
  // added reach is real, and a later change must not be able to de-cite it
  // with the suite still green. The other three numbers are unmoved — no row
  // changed glyph in this pass, and the ceiling holding at 3 is what proves
  // the repair did not buy its ✅s by adding uncheckable prose.
  //
  // 119/362/57 -> 125/417/61 (2026-08-29, Slice 4A). The Integrated Controls
  // substrate landed — the scope architecture chain and its gap detector, the
  // ScheduleActivity object with P6's fields walled off, CBS/WBS-coded cost
  // lines, post-baseline scope attribution, the eleven controls structures and
  // the calculation lineage record — and four rows (D5.01, D5.02, D5.03,
  // D5.29) flipped to ✅ on chains this gate can walk. RATCHETED UP for the
  // reason this block gives every time: the added reach is real, and a later
  // change must not be able to de-cite it with the suite still green. The
  // CEILING did not move, which is the check that proves the four new ✅s were
  // not bought with prose the gate cannot resolve; three rows in this slice
  // (D5.04, D5.28, D11.29) stayed honestly 🟡 with their gaps named.
  //
  // citationsEnforced 417 -> 423 (2026-08-29, Slice 4A REPAIR PASS). The
  // adversarial review found the four ✅s resting on machinery that was in
  // places unreachable, un-walled or filled in rather than refused: a
  // structure-state function with no tenant gate at all, a reconciliation
  // that priced un-baselined lines at zero and called it agreement, a
  // re-baseline that silently dropped recorded scope growth from the answer,
  // a surface rendering money figures no calculation_runs row backed, a
  // dual-caller guard that could never fire, and TRUNCATE left granted on
  // eight tables the row-level walls sit on. Each is now fixed in the code
  // and the register sentences describe the fixed code, citing the new
  // functions, triggers and helpers by resolvable path. RATCHETED UP for the
  // reason this block gives every time: the added reach is real, and a later
  // change must not be able to de-cite it with the suite still green. The
  // other three numbers are unmoved — no row changed glyph in this pass, and
  // the ceiling holding at 3 is what proves the repair did not buy anything
  // with prose the gate cannot resolve.
  //
  // 125/423/61 -> 132/470/67 (2026-08-29, Slice 4B). The performance family
  // landed — rules of credit with a percent that cannot be typed, the earned
  // value suite with every metric refusing by name, the eight-dimension
  // estimate basis and the confidence that travels with every forecast, the
  // progress integrity cross-check, and the §51 forecast whose P50/P80 say
  // they are absent — and six rows (D5.04, D5.05, D5.06, D5.16, D5.17, D5.20)
  // flipped to ✅ on chains this gate can walk. RATCHETED UP for the reason
  // this block gives every time: the added reach is real, and a later change
  // must not be able to de-cite it with the suite still green. The CEILING
  // did not move, which is the check that proves the six new ✅s were not
  // bought with prose the gate cannot resolve — two rows in this slice
  // (D5.07, D5.32) stayed honestly 🟡 because no probability distribution
  // exists to put a P50/P80 beside the deterministic figure, and D11.29
  // stayed 🟡 because "ALL kernels" still means more than seven.
  //
  // 470 -> 484 citationsEnforced (2026-08-29, Slice 4B repair pass). The
  // adversarial review found the performance family shipping numbers with no
  // basis behind them — an earned value summed over one period's claim rows
  // so an element that did not move that period dropped out and manufactured
  // a cost overrun; CPI 0.000 printed over a claim set that carried no
  // budget; earned schedule read off an origin nobody recorded; a staleness
  // fingerprint made of row counts that could not see a revised amount; a
  // §51 forecast with no staleness check at all; a work type nominated at
  // claim time, which is a percent chosen at claim time; and a SECURITY
  // DEFINER granted to `authenticated` that handed any tenant another
  // tenant's estimate defence. Each is fixed in the code, and the register
  // sentences now describe the fixed code and cite the new predicates,
  // helpers and acts by resolvable path. RATCHETED UP for the reason this
  // block gives every time: the added reach is real, and a later change must
  // not be able to de-cite it with the suite still green. The other three
  // numbers are unmoved — no row changed glyph in this pass, and the ceiling
  // holding at 3 is what proves the repair did not buy anything with prose
  // the gate cannot resolve.
  //
  // 132/484/67 -> 138/523/75 (2026-12-02, Slice 4C). Schedule assurance landed
  // — the nine II.6 defect classes with P6's own float and constraints riding
  // the one import door, the §50 quality score that refuses an empty schedule
  // rather than scoring it 100, the distinct schedule confidence, the risk →
  // activity → money chain, and the seeded Monte Carlo that REFUSES on a
  // failing schedule and names the classes — and eight rows (D5.07, D5.08,
  // D5.09, D5.13, D5.14, D5.15, D5.31, D5.32) flipped to ✅ on chains this
  // gate can walk. RATCHETED UP for the reason this block gives every time:
  // the added reach is real, and a later change must not be able to de-cite it
  // with the suite still green. The CEILING did not move, which is what proves
  // the eight new ✅s were not bought with prose the gate cannot resolve — and
  // the gate earned that in this pass rather than being taken on trust: it
  // rejected four unresolvable path citations and a private helper symbol with
  // no non-test caller, and each was replaced with the reachable chain rather
  // than with a softer sentence. D11.29 stayed 🟡 because "ALL kernels" still
  // means more than ten, with the six that do not record now named one by one.
  //
  // 523 -> 542 citations (2026-12-02, Slice 4C REPAIR, migration
  // 20261202090300). Adversarial review of 4C found the same defect in eleven
  // places: the door validated the SHAPE of what a client sent and trusted its
  // CONTENT, and the read then vouched for the result in words the server had
  // never checked. A planner token could POST a cost base of 999,999,999 on a
  // case whose earned-value EAC REFUSES and §51 printed a billion-dollar cost
  // P80 beside a null deterministic figure; a `deterministicHours` of 99999
  // produced a "P80 completion date" eleven years before the plan's own
  // finish; a schedule that degraded AFTER a run was recorded kept serving
  // that P80 as current, because D5.15 gated recording and never serving; a
  // re-dated schedule served a P80 date 78 days BEFORE the deterministic
  // finish, because the planned dates were outside the digest; a service key
  // could mint an AI-attributed distribution with no lineage row at all; and
  // the two columns that ARE the distribution had no product write path in the
  // whole platform. The fixes add resolvable citations — a new act
  // (`set_schedule_activity_duration_range`), its surface, its ledger, the
  // logic-support read, and the repaired doors — so this number RATCHETS UP,
  // for the reason this block gives every time: the added reach is real and a
  // later change must not be able to de-cite it with the suite still green.
  // The other three are UNMOVED: no row changed glyph in this pass. D5.28 and
  // D11.29 stayed 🟡 with their remaining gaps named, and the ceiling holding
  // at 3 is what proves the repair bought nothing with prose.
  [DEVELOP_REGISTER.name]: {
    //
    // 138/542/75 -> 147/594/86 (2026-08-31, Slice 4D). The change-control family
    // landed — contingency as an authority-gated ledger, the Change object and
    // Workflow 3 on the existing MOC engine, §54 decision latency with its
    // critical-path exposure, decision debt, the composed Sync Assurance engine
    // and the two §44 screens — and eleven rows (D5.18, D5.19, D5.27, D5.30,
    // D3.12, D3.13, D3.21, D3.36, D5.21, D13.02, D13.08) flipped to ✅ on chains
    // this gate can walk. RATCHETED UP for the reason this block gives every
    // time: the added reach is real, and a later change must not be able to
    // de-cite it with the suite still green.
    //
    // The CEILING did not move, which is the check that proves the eleven new ✅s
    // were not bought with prose the gate cannot resolve. It also earned its
    // keep in this slice rather than merely holding: the gate's first pass found
    // `linkDecisionToActivity` and `recordDecisionDelayExposure` with ZERO
    // non-test callers (the panel computed latency and debt but never authored
    // the inputs), and a `engineering_approval_rules` table citation on D5.27
    // claiming a customer write path that does not exist. The first two were
    // fixed by wiring the authoring controls; the third by stating the
    // dependency without claiming a write path AND naming the gap in the row.
    // D11.29 stayed honestly 🟡 with its six non-recording kernels named one by
    // one.
    //
    // 594 -> 618 citationsEnforced (2026-08-31, the Slice 4D repair). The
    // eleven rows above kept their ✅ and gained 24 more citations this gate
    // can resolve: the ceiling-authoring surface the feature was missing
    // (`state_authority_ceiling`, `draft_authority_ceiling`,
    // `get_authority_delegations`, `enforce_authority_limit_wall` and their
    // service functions), the repaired staleness path
    // (`decisionLatencyFingerprint`, `decisionDebtFingerprint`,
    // `dimensionFingerprint`, `DIMENSION_HEADLINE_FIELDS`,
    // `recordedLatencyHeadline`, `recordedDebtHeadline`) and the walls the
    // review added. RATCHETED UP so a later change cannot de-cite the repair
    // and stay green. The other two floors and the ceiling are unchanged and
    // sit AT the live numbers, which is the check that proves the repair
    // added reach rather than prose.
    //
    // 147/618/86 -> 149/661/89 (2026-08-31, Slice 5A). Design integrity and the
    // digital thread landed — the §10 Requirement object with its eleven
    // categories, its hierarchy and its objective→…→operating-KPI thread on the
    // ONE requirement table, the §11 Verification object generalized onto that
    // table with the five methods and a §70 wall no writer gets past, and the
    // Requirements Agent whose findings are SQL — and three rows (D4.16, D4.17,
    // D12.09) flipped to ✅ on chains this gate can walk. RATCHETED UP for the
    // reason this block gives every time: the added reach is real, and a later
    // change must not be able to de-cite it with the suite still green.
    //
    // The CEILING did not move, which is the check that proves the three new ✅s
    // were not bought with prose the gate cannot resolve. It also earned its keep
    // in this slice rather than merely holding: D4.16's first draft cited
    // `acceptance_tests` and `kpi_catalog` as backticked tables, and the
    // write-path judge failed the row — both are SELECT-only stores whose rows
    // come from a demo seed and a platform vocabulary. The fix was the D5.27
    // precedent: state the dependency without claiming a write path, and NAME
    // the residual in the row. Nothing was exempted and no floor was lowered.
    //
    // 661 -> 670 citationsEnforced (2026-08-31, the Slice 5A REPAIR PASS).
    // Three adversarial reviews found the same shape of defect three times: a
    // rule stated in the prose and enforced at ONE door, with the wall behind
    // the door missing — a cross-tenant obligation an ordinary planner could
    // use to move another organization's requirement to `verified`, a recorded
    // FAILURE silently superseded by a later pass with nothing anywhere
    // raising it, a requirement subtree (and its recorded failures) deletable
    // with no trigger and no audit, and an AI-operator identity that could
    // clear three of the five findings the Requirements Agent exists to
    // report. The three rows KEEP their ✅ and gained nine citations this gate
    // can resolve: the walls (`enforce_verification_subject_tenancy`,
    // `enforce_requirement_provenance`, `audit_requirement_thread_severance`),
    // the derived status (`derive_requirement_verification_status`,
    // `requirement_has_unretracted_failure`), and the surface the features
    // were missing (`requirementGapLists`, `wbsClause`, `aiFindingsAsFindings`,
    // `agentModelNote`, `listCommissioningTests`, `listOrgEvidenceItems`).
    // RATCHETED UP for the reason this block gives every time: the added reach
    // is real, and a later change must not be able to de-cite it and stay
    // green.
    //
    // The CEILING did not move, and the gate earned its keep again on the way:
    // the repair's first draft of D4.16 cited design_studies,
    // acceptance_tests and kpi_catalog as backticked tables while explaining
    // that they are NOT writable, and the write-path judge failed the row for
    // all three. Fixed by the D5.27 precedent — state the dependency, do not
    // claim the write path — and the row names the residual. Nothing was
    // exempted, no floor was lowered, and EXEMPTIONS is still empty.
    //
    // 149/670/89 -> 152/700/93 (2026-08-31, Slice 5B). The frontline design
    // review landed — who was in the room by name and discipline (with the
    // participation flags DERIVED from that roster rather than typed), the
    // eight I.25 dimensions as itemized findings, the per-recommendation
    // disposition record with a reason mandatory on every outcome and the
    // raiser barred from answering their own finding, the six I.26 axes whose
    // composite REFUSES the axis nobody scored, and the §19 Interface in seven
    // types on the SHARED dependency graph — and four rows (D4.10, D4.11,
    // D4.12, D4.18) flipped to ✅ on chains this gate can walk. RATCHETED UP
    // for the reason this block gives every time: the added reach is real, and
    // a later change must not be able to de-cite it with the suite still
    // green.
    //
    // The CEILING did not move, which is the check that proves the four new ✅s
    // were not bought with prose the gate cannot resolve. It earned its keep
    // again on the way: D4.18's first draft cited `buildInterfaceGraph`, and
    // the gate found it has ZERO non-test callers — it is an internal helper
    // of `readInterfaceExposure`, which is what the panel actually calls. The
    // fix was to stop citing it rather than to add a call that exists only to
    // satisfy the gate. Nothing was exempted, no floor was lowered, and
    // EXEMPTIONS is still empty.
    //
    // 700 -> 707 citationsEnforced (the Slice 5B REPAIR PASS). The repair added
    // `enforce_case_study_immutable`, `record_frontline_service_write`,
    // `carry_design_finding_to_requirement` and `FRONTLINE_ROLES` to the four
    // rows' evidence, and re-derived every citation the diff had moved — D4.18
    // was citing `src/lib/interdependency/index.ts:225,312`, which the same
    // commit had pushed to 251 and 338. Ratcheted UP so the added reach cannot
    // be de-cited later with the suite still green. EXEMPTIONS is still empty,
    // no floor was lowered, and the CEILING did not move.
    //
    // 152/707/93 -> 156/776/98 (2026-09-01, Slice 5C). The digital thread
    // landed — spec II.2's Common Data Environment as a real link model over
    // ONE ordered chain, exactly one authoritative revision per object held by
    // a partial unique index rather than a report, the §26 continuity
    // invariant enforced at the database with every permitted severance
    // recorded in a ledger, and change receipts produced by the change itself
    // and answerable only by a human who did not make it — and five rows
    // (D11.05, D11.06, D11.07, D11.19, D11.20) flipped to ✅ on chains this
    // gate can walk. RATCHETED UP for the reason this block gives every time:
    // the added reach is real, and a later change must not be able to de-cite
    // it with the suite still green.
    //
    // The CEILING did not move, which is the check that proves the five new
    // ✅s were not bought with prose the gate cannot resolve. D11.21 stayed
    // 🟡 on purpose: five of §34's nineteen edges have an endpoint object that
    // does not exist yet, and the row names all five rather than implying
    // coverage. Nothing was exempted, no floor was lowered, and EXEMPTIONS is
    // still empty.
    //
    // citationsEnforced 776 -> 785 (2026-09-01, the Slice 5C REPAIR PASS).
    // Adversarial review found the five ✅ rows leaning on acts the product
    // could not perform and records it could not read: the release act took a
    // revision id no read handed out, the hop to sever took a link id the
    // screen never rendered, and both cascade routes wrote severances into a
    // shape the only reader refuses on. Closing those added real surface —
    // `get_org_thread_severances`, `enforce_asset_thread_identity`,
    // `readOrgThreadSeverances`, `getOrgThreadSeverances`, `VersionPanel` —
    // and the floor moves up with it so none of it can be de-cited later while
    // the suite stays green. The other two floors and the CEILING are
    // unchanged: the repair bought no new ✅ and exempted nothing.
    //
    // 156/785/98 -> 159/838/100 (2026-09-01, Slice 5D). The event bus, the
    // Change Impact Agent, the case-scoped RAM kernel and the composed Sync
    // Information module landed; D11.26 and D12.10 flipped to ✅ on chains this
    // gate can walk, and D11.09, D11.21 and D12.13 gained real citations while
    // staying honestly 🟡. RATCHETED UP for the reason this block gives every
    // time: the added reach is real, and a later change must not be able to
    // de-cite it with the suite still green.
    //
    // The gate EARNED ITS KEEP twice in this slice rather than merely holding.
    // (a) D11.26's first draft cited `case_event_consequence_obligations` with
    // ZERO non-test callers — the predicate the gate wall reads was wired only
    // by a pg_get_functiondef transformation the gate cannot see, and the panel
    // re-derived the same filter on the client. The fix was to give the screen
    // the WALL'S OWN predicate (`getCaseEventGateBlockers`), which is both the
    // caller the gate wanted and the removal of a second implementation.
    // (b) `selectWeibullMethod` came off the dead-citation list in the suite
    // below, because this slice wired it — the instruction that list's own
    // comment carries. A live pin now holds that wiring.
    //
    // The CEILING did not move, which is the check that proves the two new ✅s
    // were not bought with prose the gate cannot resolve. EXEMPTIONS is still
    // empty and no floor was lowered.
    //
    // 159/838/100 -> 164/914/105 (2026-09-02, Slice 6A). The procurement and
    // commercial engine landed — the §25 ProcurementPackage with its four
    // status dimensions and its two gate blockers on Slice 3C's ONE predicate,
    // the sealed-bid tender with the seal enforced at the row policy AND at
    // the definer read, evaluations frozen once recorded with separation of
    // duties in both directions at the database, and the §24 Contract awarded
    // through a new authority_limits action type with its commitments posted
    // into Slice 4A's ONE cost model — and five rows (D6.03, D6.04, D6.05,
    // D6.08, D6.09) flipped to ✅ on chains this gate can walk. RATCHETED UP
    // for the reason this block gives every time: the added reach is real, and
    // a later change must not be able to de-cite it with the suite still
    // green.
    //
    // The CEILING did not move, which is the check that proves the five new
    // ✅s were not bought with prose the gate cannot resolve. It also caught
    // two things in this slice before they shipped: `withdrawSealedBid` had no
    // non-test caller (a withdrawal act nobody could perform from the product,
    // now wired into the tender panel), and D6.05/D6.08 cited `warranty_terms`
    // — a table that still has no customer write path, which is D6.06's named
    // gap and not evidence for these rows. EXEMPTIONS is still empty and no
    // floor was lowered.
    //
    // 164/914/105 -> 164/927/105 (2026-09-02, Slice 6A adversarial repair).
    // Thirteen more citations became enforceable and none was lost. The repair
    // added acts the rows now cite and the gate can walk —
    // `record_package_delivery_receipt` / `recordPackageDeliveryReceipt` (the
    // DATED receipt that is now the only discharge of the §25 slippage
    // blockers, wired into the package panel),
    // `enforce_package_bidder_integrity`, `enforce_cost_item_contract_commitment`
    // and `sync_sealed_bid_withheld_count` — and it REMOVED two citations that
    // were the shape this gate exists to keep out: `packageLateness`, a client
    // re-derivation of `case_procurement_gate_obligations` that disagreed with
    // the server inside one rendered payload, and `getCaseProcurementGateBlockers`,
    // a service wrapper with zero non-test callers onto a predicate
    // `get_case_procurement` already returns. Deleting a second implementation
    // is a reach INCREASE, not a decrease: the rule it duplicated still has
    // exactly one enforceable home.
    //
    // The CEILING did not move. EXEMPTIONS is still empty and no floor was
    // lowered.
    //
    // 164/927/105 -> 166/986/107 (2026-09-02, Slice 6B; citations 980 -> 986 in
    // the repair pass, where the D6.06/D6.01/D11.33 rows gained citations
    // naming the defects the repair closed). The commercial life of
    // a contract after signature landed — change orders through the SAME
    // authority the award used, invoices payable once, claims frozen when
    // answered, warranties that expire — with D6.06 and D6.01 flipping to ✅ on
    // chains this gate can walk, and fifty-three more citations became
    // enforceable. RATCHETED UP for the reason this block gives every time: the
    // added reach is real, and a later change must not be able to de-cite it
    // with the suite still green.
    //
    // The CEILING did not move, and the gate earned its keep again: D6.07 was
    // WRITTEN as a ✅ and this gate demoted it, because two middle hops of the
    // specification→failure thread read `material_suppliers` and `bom_lines`,
    // which have no customer write path at all — the slice's own transcript had
    // to seed both by direct SQL. The traversal is real and refuses at that hop
    // by name; the row says 🟡 and says why. Nothing was exempted, no floor was
    // lowered, and EXEMPTIONS is still empty.
    //
    // 166/986/107 -> 170/1027/110 (2026-09-03, Slice 7A). Advanced Work
    // Packaging landed — the typed EWP→PWP→CWP→IWP chain enforced at the
    // database, §27's WorkPackage on the canonical work identity, §28's ten
    // Constraint types on the canonical constraint store, and I.28's forward
    // burn-down recorded into the ONE lineage ledger — with D7.10, D7.17 and
    // D7.18 flipping to ✅ on chains this gate can walk, and forty-one more
    // citations becoming enforceable. RATCHETED UP for the reason this block
    // gives every time: the added reach is real, and a later change must not
    // be able to de-cite it with the suite still green.
    //
    // The CEILING did not move, and the gate earned its keep again on the
    // first attempt: all three rows were written citing `WorkPackagingPanels.tsx`
    // by bare filename, which resolves to nothing, and the stale-citation
    // assertion demoted them until the repo-relative path was written instead.
    // D7.07 was deliberately NOT flipped: its own row names three gaps, and
    // `run_recovery_escalation_clock` still has no scheduled caller while
    // `restoration_blockers` is still restoration-event-only, so it stays 🟡
    // with both residuals named. Nothing was exempted, no floor was lowered,
    // and EXEMPTIONS is still empty.
    //
    // 170/1027/110 -> 172/1067/114 (2026-09-03, Slice 7B). ONE field-readiness
    // engine now serves both the recovery path and the AWP packages: the ten
    // §27 elements as a single predicate on the work identity, Recovery's own
    // door refusing THROUGH it rather than holding a copy of the material and
    // permit/isolation rules, the assessment recorded into the one lineage
    // ledger, and the Execution Readiness board composing verdicts it does not
    // recompute. D7.05, D7.11, D7.19 and D13.09 flip to ✅ on chains this gate
    // can walk, and forty more citations become enforceable. RATCHETED UP for
    // the reason this block gives every time: the added reach is real, and a
    // later change must not be able to de-cite it with the suite still green.
    //
    // TWO ROWS WERE DELIBERATELY NOT FLIPPED, and each says why in its own
    // evidence. D7.06 keeps a NEW residual — the release door does not require
    // a field-readiness assessment, so a package NOBODY EVER WALKED still
    // reads `ready_for_human` on a person's own cleared constraints, exactly
    // as Slice 7A shipped it; requiring one would refuse every package 7A's
    // transcript releases. The narrower half of that gap IS closed: the one
    // verdict gained a SEVENTH refusing state (`stale`, 20261211090200) so a
    // package cannot be released against a RECORDED assessment its canonical
    // stores have moved past. D7.12 stays 🟡 because THREE of its ten elements (crew,
    // access, work-order predecessors) have no canonical object at all, and
    // inventing one to reach ✅ is the parallel store this whole programme
    // exists to refuse. The CEILING did not move. Nothing was exempted, no
    // floor was lowered, and EXEMPTIONS is still empty.
    //
    // 172/1067/114 -> 177/1122/122 (2026-09-04, Slice 7C). Resources,
    // competency readiness and the workface metrics landed — spec I.22's
    // ResourceDemand and ResourceCapacity time-phased across nine categories
    // on the EXTENDED craft_capacity family, collective feasibility across
    // projects reaching the ONE weekly feasibility door, spec I.23's
    // competency question asked in the FUTURE TENSE, and spec §49/I.28's
    // index built ONCE and cited from two rows. D7.01, D7.02, D7.03, D7.04,
    // D7.08, D7.13, D7.14 and D7.20 flip to ✅ on chains this gate can walk,
    // and fifty-five more citations become enforceable. RATCHETED UP for the
    // reason this block gives every time: the added reach is real, and a
    // later change must not be able to de-cite it with the suite still green.
    //
    // THE GATE EARNED ITS KEEP THREE TIMES IN ONE PASS, and each finding was
    // a real defect rather than a citation to reword.
    // (a) `getConstraintFreeWorkIndex` and `getWorkfaceExecutionMetrics` had
    //     ZERO non-test callers: the composed /sync-field page reads
    //     `get_sync_field_module` and never touched them. The fix was the
    //     capability the composition genuinely cannot offer — a planner's own
    //     horizon and look-ahead window, which `get_sync_field_module` has to
    //     fix to one reading — rather than a call added to satisfy the gate.
    // (b) All three `compute_*` recorders had ZERO callers: the lineage act
    //     existed with no way for a person to perform it. `WorkfaceMetricsPanel`
    //     and the competency panel now carry the RECORD act, the same shape
    //     Slice 7A's burn-down panel already had.
    // (c) D7.04's first draft cited `labour_rules` as a backticked table and
    //     the write-path judge failed the row: that catalogue is still
    //     seeded, not customer-written. Fixed by the D5.27/D4.16 precedent —
    //     state the dependency, do not claim the write path — and the row now
    //     names the residual.
    //
    // D7.16 was deliberately NOT flipped. Its composed surface exists at
    // /sync-field and the server carries the list of parts still open
    // (D7.06, D7.07, D7.12) rather than a comment; a composition is not more
    // complete than its pieces. The CEILING did not move, which is the check
    // that proves the eight new ✅s were not bought with prose the gate cannot
    // resolve. Nothing was exempted, no floor was lowered, and EXEMPTIONS is
    // still empty.
    //
    // 177/1122/122 -> 177/1136/122 (2026-09-04, Slice 7C adversarial repair).
    // Fourteen more citations became enforceable and none was lost. The repair
    // shipped the acts three refusal sentences INSTRUCTED and the product could
    // not perform — `close_resource_capacity` (the collision refusal told a
    // planner to close the standing figure; `effective_to` was settable only at
    // INSERT), `renew_member_competency` (the duplicate refusal told them to
    // supersede a holding; the table's only runtime writer was INSERT-only and
    // the pair is UNIQUE) and `set_workforce_member_active` (a leaver stayed
    // qualified and rostered forever in a ✅ metric) — plus their service
    // wrappers and component callers.
    //
    // THE GATE EARNED ITS KEEP AGAIN, twice.
    // (a) `retire_competency_requirement` had ZERO non-test callers and slipped
    //     the gate entirely because D7.03's evidence never BACKTICKED it. The
    //     act existed, a live requirement could not be restated (unique index)
    //     and could not be deleted (integrity trigger), so a competency
    //     requirement was write-once and permanent from every customer surface.
    //     Wired into CompetencyReadinessPanel and now cited in backticks, so
    //     the gate polices it from here on.
    // (b) Four ✅ rows (D7.08, D7.13, D7.14, D7.20) cited a chain through
    //     `/sync-field` that does not exist — that page calls
    //     `getSyncFieldModule` and neither of the two symbols the rows named.
    //     The capability IS reachable, through `WorkfaceMetricsPanel`, which is
    //     why the ✅s stand; but `judgeTsSymbol` only asks whether each cited
    //     symbol has SOME live non-test caller and cannot check the EDGES of a
    //     prose chain, so the fiction survived. The four chains now say what a
    //     reviewer would actually walk.
    //
    // RATCHETED UP for the reason this block gives every time: the added reach
    // is real, and a later change must not be able to de-cite it with the suite
    // still green. The CEILING did not move, no row changed status, nothing was
    // exempted, no floor was lowered, and EXEMPTIONS is still empty.
    //
    // 177/1136/122 -> 178/1147/128 (2026-09-06, D7 residual + Slice 1
    // authoring, #361). D7.07 flipped because THE ONE escalation clock now
    // walks package-anchored restoration_constraints and was already
    // scheduled (`syncai-recovery-escalation-clock`); D3.01/D3.22/D3.23/
    // D3.25/D3.37 flipped because FrameworkShelfPanel now calls
    // create_project_framework and add_framework_stage, and already called
    // add_framework_gate (checkpoint) and set_gate_requirement. D7.06 and
    // D7.12 stay 🟡 with their named gaps; D7.16 stays 🟡 because a
    // composition is not more complete than those two parts; D11.34 stays
    // ❌ — objects standing side by side is not one real case walked
    // through all twelve.
    //
    // 178/1147/128 -> 183/1202/133 (2026-09-06, Slice 7D register honesty,
    // #360 rebased onto #361). Five quality rows flipped with backticked 7D
    // symbols that already had live callers (`QualityManagementWorkbench`
    // on `/risk`). The CEILING stayed at 3 — the new ✅s are checkable. No
    // exemption, no floor lowered.
    //
    // 183/1202/133 -> 186/1228/138 (2026-09-06, residual cluster). Five
    // rows flipped: D3.19 and D11.32 were status-lag (both waiver halves
    // already reachable on `/governance`; first Develop connector already
    // ships under analyze-not-author); D3.29 gained estimate/schedule legs
    // on the ONE assumption family; D4.01 binds quality_requirements to
    // design_requirements; D4.14 publishes cyber on the live gate-requirement
    // authoring path. The CEILING stayed at 3. No exemption, no floor
    // lowered. D4.14 does not cite `sync_gate_readiness_categories` — that
    // SQL vocabulary pin has no product caller; the shelf and
    // `setGateRequirement` are the chain.
    rowsWithAnEnforceableCitation: 186,
    citationsEnforced: 1228,
    claimedRowsEnforced: 138,
    // D11.04 (a CI-fence claim proved by a named test file), D11.10 (a
    // canonical seeded vocabulary, which the write-path judge would fail for
    // not being customer-writable — a question the row never asked) and
    // D11.35 (a documentation deliverable, and the row says so itself).
    claimedRowsUnenforced: 3,
  },
};

interface Scope {
  register: RegisterSpec;
  summary: Record<string, number>;
  failures: Verdict[];
  stale: SkippedCitation[];
}

function analyse(register: RegisterSpec): Scope {
  const rows = parseRegister(register);
  const statusOf = new Map(rows.map((r) => [r.id, r.status]));

  const citations: Citation[] = [];
  const skipped: SkippedCitation[] = [];
  const stale: SkippedCitation[] = [];
  for (const row of rows) {
    const found = extractCitations(row, code, sql, defs);
    citations.push(...found.enforceable);
    skipped.push(...found.skipped);
    // Only a ✅ is a promise; a 🟡 already admits its gap, so a rotted
    // citation there is documentation debt, not a false claim.
    if (row.status === "✅") stale.push(...found.stale);
  }

  const verdicts = citations.filter((c) => !exempt.has(keyOf(c))).map(judge);
  const broken = verdicts.filter((v) => !v.ok);
  /** Only a ✅ is a promise. A 🟡 already admits the gap. */
  const failures = broken.filter((v) => statusOf.get(v.citation.id) === "✅");

  const analysedRows = new Set(citations.map((c) => c.id));
  const claimed = rows.filter((r) => r.status === "✅");
  return {
    register,
    failures,
    stale,
    summary: {
      registerRows: rows.length,
      claimedRows: claimed.length,
      rowsWithAnEnforceableCitation: analysedRows.size,
      claimedRowsEnforced: claimed.filter((r) => analysedRows.has(r.id)).length,
      claimedRowsUnenforced: claimed.filter((r) => !analysedRows.has(r.id))
        .length,
      citationsEnforced: citations.length,
      citationsSkipped: skipped.length,
      rowsCitingNothingCheckable: rows.filter((r) => !analysedRows.has(r.id))
        .length,
      knownGapsOnPartialRows: broken.length - failures.length,
    },
  };
}

const report = (list: Verdict[]) =>
  list
    .map(
      (v) =>
        `  ${v.citation.id}  ${v.citation.kind.padEnd(12)} \`${v.citation.raw}\`\n      ${v.detail}`,
    )
    .join("\n");

/* ── the same suite, the same standard, once per register ─────────────────── */

for (const register of REGISTERS) {
  const scope = analyse(register);
  const floors = FLOORS[register.name];

  describe(`${register.name} capability register reachability gate`, () => {
    it("has floors declared for it at all", () => {
      // A register added to REGISTERS with no floors would run its two failure
      // assertions and silently skip its coverage assertion — the gate quietly
      // half-applying to the newest register is exactly the state this whole
      // file exists to end.
      expect(
        floors,
        `no coverage floors declared for ${register.name}`,
      ).toBeDefined();
    });

    it("has no ✅ row citing a code file that no longer exists", () => {
      // The rot the coverage floors cannot see. A row keeps its ✅ while the
      // file it cites is renamed or deleted: the citation stops resolving, the
      // old classifier SKIPPED it as unparseable prose, and coverage barely
      // moved because one citation out of hundreds went quiet. A path carrying
      // a code extension is an unambiguous claim about a file, so it fails.
      expect(
        scope.stale.map((s) => `${s.id}: \`${s.raw}\` — ${s.reason}`),
      ).toEqual([]);
    });

    it("reports how much of the register it can actually enforce", () => {
      // A gate that silently checks four rows is worse than no gate: it
      // certifies the other 395 by implication. So the coverage is asserted and
      // printed, and a change that shrinks it fails here rather than passing.
      console.log(
        `[reachability gate: ${register.name}] ` +
          JSON.stringify(scope.summary, null, 2),
      );
      expect(
        scope.summary.rowsWithAnEnforceableCitation,
      ).toBeGreaterThanOrEqual(floors.rowsWithAnEnforceableCitation);
      expect(scope.summary.citationsEnforced).toBeGreaterThanOrEqual(
        floors.citationsEnforced,
      );
      expect(scope.summary.claimedRowsEnforced).toBeGreaterThanOrEqual(
        floors.claimedRowsEnforced,
      );
      // The one that is a ceiling. Every assertion above is satisfied by a
      // register that GROWS a ✅ row citing nothing checkable; this is the
      // only one that isn't.
      expect(
        scope.summary.claimedRowsUnenforced,
        `${register.name}: a ✅ row was added or edited into a state where this ` +
          `gate can check nothing about it. Cite something it can resolve, or ` +
          `raise this ceiling in the diff with a reason.`,
      ).toBeLessThanOrEqual(floors.claimedRowsUnenforced);
    });

    it("every ✅ row citing a symbol has a non-test caller", () => {
      const dead = scope.failures.filter(
        (v) => v.citation.kind !== "sql-table",
      );
      expect(dead.length === 0 ? "" : "\n" + report(dead)).toBe("");
    });

    it("every ✅ row citing a table has a customer-reachable write path", () => {
      const readOnly = scope.failures.filter(
        (v) => v.citation.kind === "sql-table",
      );
      expect(readOnly.length === 0 ? "" : "\n" + report(readOnly)).toBe("");
    });
  });
}

/* ── the machinery itself, proved once ────────────────────────────────────── */

describe("the reachability judges", () => {
  /**
   * Once the 68 caught rows were reclassified, every real row passed — which
   * is exactly the state in which a broken gate is indistinguishable from a
   * working one. So the machinery is exercised against known-dead code that
   * neither register cites: `poolEstimates` is finished and unit-tested with
   * zero non-test callers. If it starts passing, either somebody wired it up
   * (delete the case) or the detector broke (fix it) — silence is not an
   * option.
   *
   * `record_verification_result` used to sit on this list. It now has a
   * production caller (`recordVerificationResult` → VerificationLoop on
   * /learning-loop). The live pin below holds that wiring; do not put it
   * back on the dead list.
   *
   * `selectWeibullMethod` left the list on 2026-09-01 for the same reason and
   * by the instruction this comment already carried: Slice 5D's case-scoped
   * RAM reading calls it from `src/lib/develop/ram.ts`, which the case
   * workspace reaches through `runCaseRamAgent` → `CaseRamPanel`. The gate
   * caught the change itself — this suite failed on it before anything else
   * did — and the live pin below now holds the wiring, so the symbol cannot
   * quietly go dead again while this file still calls it live.
   */
  it("still detects a dead citation — the gate proves itself", () => {
    const dead = [{ name: "poolEstimates", kind: "ts-symbol" as const }];
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

  it("treats selectWeibullMethod as a live production caller (Slice 5D)", () => {
    const verdict = judge({
      id: "D12.13",
      raw: "selectWeibullMethod",
      name: "selectWeibullMethod",
      kind: "ts-symbol",
    });
    expect(verdict.ok, verdict.detail).toBe(true);
    expect(verdict.detail).toMatch(/develop\/ram/);
  });

  it("treats record_verification_result as a live production caller", () => {
    const verdict = judge({
      id: "C4.08",
      raw: "record_verification_result",
      name: "record_verification_result",
      kind: "sql-function",
    });
    expect(verdict.ok, verdict.detail).toBe(true);
    expect(verdict.detail).toMatch(/operatingLoopService/);
  });

  /**
   * A RESTRICTIVE POLICY IS A DENY, AND THE JUDGE NOW KNOWS IT.
   *
   * `design_requirements` carries three restrictive write policies whose whole
   * job is to STOP a client inserting, updating or deleting a case-scoped
   * requirement. The judge read `for insert to authenticated` off one of them
   * and reported "policy design_requirements_case_no_ins admits writes" — the
   * exact SELECT-only-RLS class it exists to catch, wearing an INSERT keyword.
   * The conclusion happened to be right (a real definer write path exists), so
   * nothing was damaged; the reasoning was wrong, and the next table cited with
   * a deny and no definer writer would have passed on it.
   *
   * Both halves are pinned: the deny no longer vouches for anything, and the
   * table still passes on the writer that actually exists.
   */
  it("does not accept a restrictive DENY policy as a write path", () => {
    const restrictive = [...policies.values()].filter(
      (p) =>
        p.table === "design_requirements" &&
        p.statements.some((st) => /\bas\s+restrictive\b/i.test(st)),
    );
    expect(
      restrictive.length,
      "design_requirements must still carry its restrictive case-scope denies",
    ).toBeGreaterThan(0);

    const verdict = judge({
      id: "Z9.95",
      raw: "design_requirements",
      name: "design_requirements",
      kind: "sql-table",
    });
    expect(verdict.ok, verdict.detail).toBe(true);
    expect(
      verdict.detail,
      "the write path must be the definer RPC, never a policy whose job is to refuse",
    ).not.toMatch(/admits writes/);
    expect(verdict.detail).toMatch(
      /definer write path via record_case_requirement/,
    );
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
   *
   * BOTH quoting styles are pinned, because for six weeks only one was
   * recognised. `evaluate_ca_effectiveness` passes its command as
   * `'select public.f()'`; `expire_governance_instruments` passes the identical
   * call as `$cron$select public.f();$cron$` (20261121090200:401) and the gate
   * called it dead. Whether a function looked reachable therefore depended on
   * the migration author's quoting habit, and the D-register was about to eat a
   * FALSE demotion for it — a lie told to make a gate green is the same defect
   * as a ✅ told to make a slice look finished.
   */
  it("counts a pg_cron schedule as a caller, in either quoting style", () => {
    const singleQuoted = judge({
      id: "Z9.94",
      raw: "evaluate_ca_effectiveness",
      name: "evaluate_ca_effectiveness",
      kind: "sql-function",
    });
    expect(singleQuoted.ok, singleQuoted.detail).toBe(true);

    const dollarQuoted = judge({
      id: "Z9.93",
      raw: "expire_governance_instruments",
      name: "expire_governance_instruments",
      kind: "sql-function",
    });
    expect(dollarQuoted.ok, dollarQuoted.detail).toBe(true);
    expect(dollarQuoted.detail).toMatch(/scheduled with pg_cron/);
  });

  /**
   * A parser that skips what it cannot read is a widened guard wearing a
   * parser's clothes: the rows it drops are certified by implication, and the
   * cheapest way to leave the gate becomes "write the row slightly
   * differently". Both failure modes are proved here against synthetic input,
   * because proving them against the real files would require breaking them.
   */
  it("refuses to skip a row it cannot parse", () => {
    const good = "| D1.01 | Cap | I.3 | ✅ | evidence here |";
    expect(parseRegister(DEVELOP_REGISTER, good)).toHaveLength(1);

    // Same ID-shaped first cell, no status glyph anywhere: an UNCHECKED row.
    const malformed = `${good}\n| D1.02 | Cap | I.4 | done | evidence here |`;
    expect(() => parseRegister(DEVELOP_REGISTER, malformed)).toThrow(
      /do not parse/,
    );

    // And a register whose shape has drifted out from under its pattern must
    // not read as "nothing to check, all clear".
    expect(() => parseRegister(DEVELOP_REGISTER, "# no rows at all\n")).toThrow(
      /ZERO rows/,
    );
  });

  /**
   * The residual of the rule above, closed.
   *
   * "Must parse" used to be scoped to lines that already LOOKED like rows —
   * leading pipe, ID-shaped first cell. So the throw could not fire for a line
   * that did not look ID-shaped, and an adversary walked straight through the
   * gap: pasting
   *
   *   | **D1.99** | Invisible capability | I.3 | ✅ | … `add_framework_gate`. |
   *
   * into a real capability table produced `register:check` exit 0, both test
   * files green, and an unchanged item count, for a ✅ row citing a function
   * this branch had just demoted seven rows over. Two asterisks.
   *
   * A register is now read structurally: every table line is a claim except a
   * `|---|` rule and the header directly above one. The header and rule cases
   * are asserted too, because a rule that failed on them would be reverted
   * within a day.
   */
  it("sees a row that does not look like a row", () => {
    const table = [
      "| ID    | Capability | Spec ref | Status | Evidence |",
      "| ----- | ---------- | -------- | ------ | -------- |",
      "| D1.01 | Cap        | I.3      | ✅     | evidence here |",
    ].join("\n");
    expect(parseRegister(DEVELOP_REGISTER, table)).toHaveLength(1);

    for (const disguise of [
      "| **D1.99** | Invisible | I.3 | ✅ | via `add_framework_gate`. |",
      "|D1.99. | Invisible | I.3 | ✅ | via `add_framework_gate`. |",
      "| d1.99 | Invisible | I.3 | ✅ | via `add_framework_gate`. |",
      "  | D1.99 | Invisible | I.3 | ✅ | via `add_framework_gate`. |",
    ]) {
      expect(
        () => parseRegister(DEVELOP_REGISTER, `${table}\n${disguise}`),
        `this line left the gate in silence: ${disguise}`,
      ).toThrow(/do not parse/);
    }

    // Same rule, same throw, on the enterprise register's shape.
    const enterprise = [
      "| ID    | Capability | Evidence |",
      "| ----- | ---------- | -------- |",
      "| C4.08 | Verify     | ✅ `record_verification_result` records it |",
    ].join("\n");
    expect(parseRegister(ENTERPRISE_REGISTER, enterprise)).toHaveLength(1);
    expect(() =>
      parseRegister(
        ENTERPRISE_REGISTER,
        `${enterprise}\n| **C4.99** | Invisible | ✅ shipped |`,
      ),
    ).toThrow(/do not parse/);
  });

  /**
   * The gate's own documented weakness, exploited and closed.
   *
   * The header of `capabilityEvidence.ts` states the cost of module-level
   * reachability honestly: "a symbol called only by a dead sibling in a LIVE
   * module passes this gate". For the D-family register that cost was the
   * entire gate — all 226 of its enforceable citations are `sql-function`, so
   * `judgeSqlFunction` is the only judge they ever meet — and an adversary
   * demonstrated the exploit end to end. Appending a never-imported,
   * never-called wrapper to `src/services/developService.ts` flipped
   * `add_framework_gate` from `ZERO callers` to `invoked from
   * src/services/developService.ts`, which would have reversed every one of
   * this branch's seven honest demotions for the price of a function nobody
   * calls.
   *
   * The corpus here is synthetic on purpose: proving it against the real tree
   * means writing dead code into `src/`.
   */
  it("does not accept a wrapper nobody calls as a caller", () => {
    const service = [
      'import { supabase } from "../lib/supabase";',
      "",
      "export async function recordReview(id: string) {",
      '  return supabase.rpc("record_case_gate_review", { id });',
      "}",
      "",
      "export async function deadWrapper() {",
      '  return supabase.rpc("add_framework_gate", {});',
      "}",
      "",
      "Deno.serve(async () => {",
      '  await supabase.rpc("expire_governance_instruments", {});',
      "});",
      "",
    ].join("\n");
    const page = [
      'import { recordReview } from "../services/service";',
      "export function Page() {",
      "  return <button onClick={() => recordReview('x')}>go</button>;",
      "}",
      "",
    ].join("\n");
    const corpus = {
      files: new Map([
        ["src/services/service.ts", service],
        ["src/pages/Page.tsx", page],
      ]),
      reachable: new Set(["src/services/service.ts", "src/pages/Page.tsx"]),
      roots: ["src/pages/Page.tsx"],
    };

    const ask = (name: string) =>
      judgeSqlFunction(
        { id: "Z9.92", raw: name, name, kind: "sql-function" },
        corpus,
        sql,
      );

    // Called from an exported function a live page actually uses.
    const live = ask("record_case_gate_review");
    expect(live.ok, live.detail).toBe(true);

    // The same module, the same `supabase.rpc(...)` shape — inside a function
    // nothing references. This is the whole exploit.
    const dead = ask("add_framework_gate");
    expect(dead.ok, dead.detail).toBe(false);
    expect(dead.detail).toMatch(/wrapper nobody calls is not a caller/);

    // …and the tightening must not swallow the shape every edge function in
    // this repo uses. `Deno.serve(async () => …)` is a top-level expression
    // the runtime invokes, not a declaration anything references. An earlier
    // draft read it as the body of the function declared above it and failed
    // `kb_ingest_document` closed — a false gap written into two registers.
    const served = ask("expire_governance_instruments");
    expect(served.ok, served.detail).toBe(true);
    expect(served.detail).toMatch(/invoked from src\/services\/service\.ts/);
  });

  /**
   * `modulesRunningPattern` pre-filters with one regex and iterates with
   * another, and that is not a style choice. `RegExp.test` on a /g pattern
   * advances `lastIndex`, and `String.matchAll` begins from the original's
   * `lastIndex` — so testing and then iterating the SAME object skips the
   * first match. Every symbol cited exactly once in the corpus then read as
   * uncalled: 23 false failures across both registers, all of them working
   * code. Pinned because the bug is invisible in review and fails closed.
   */
  it("finds a call site that occurs exactly once in a module", () => {
    const only = [
      'import { supabase } from "../lib/supabase";',
      "export async function loadOnce() {",
      '  return supabase.rpc("record_case_gate_review", {});',
      "}",
      "",
    ].join("\n");
    const user = [
      'import { loadOnce } from "../services/only";',
      "export function Page() {",
      "  return <button onClick={loadOnce}>go</button>;",
      "}",
      "",
    ].join("\n");
    const corpus = {
      files: new Map([
        ["src/services/only.ts", only],
        ["src/pages/Page.tsx", user],
      ]),
      reachable: new Set(["src/services/only.ts", "src/pages/Page.tsx"]),
      roots: ["src/pages/Page.tsx"],
    };
    expect(
      modulesRunningPattern(/["'`]record_case_gate_review["'`]/, corpus),
    ).toEqual(["src/services/only.ts"]);
  });

  /**
   * The two registers' row shapes are genuinely different — the D-family puts
   * status in its own cell after a spec-ref column. Each pattern must match its
   * own register and NOTHING of the other's, so a copy-paste that points a
   * register at the wrong pattern fails loudly instead of parsing zero rows and
   * reporting a clean bill of health.
   */
  it("keeps the two row patterns from matching each other's register", () => {
    const enterprise =
      "| C4.08 | Verify | ✅ `record_verification_result` records it |";
    const develop = "| D1.01 | Cap | I.3 | ✅ | evidence here |";
    expect(ENTERPRISE_REGISTER.row.test(enterprise)).toBe(true);
    expect(ENTERPRISE_REGISTER.row.test(develop)).toBe(false);
    expect(DEVELOP_REGISTER.row.test(develop)).toBe(true);
    expect(DEVELOP_REGISTER.row.test(enterprise)).toBe(false);
  });

  /**
   * Nine D-register rows quote a grep alternation in their evidence —
   * `grep 'ncr\|nonconformance' → only the spec file`. A pipe-free evidence
   * pattern truncates the cell there and silently drops every citation after
   * it, which is the de-citation evasion `register-baseline.mjs` exists to
   * catch, arriving by accident rather than by intent.
   */
  it("reads a whole evidence cell that contains an escaped pipe", () => {
    const [row] = parseRegister(
      DEVELOP_REGISTER,
      "| D4.03 | NCR | I.13 | ❌ | None: grep 'ncr\\|nonconformance' → only `set_gate_requirement` |",
    );
    expect(row.evidence).toContain("set_gate_requirement");
  });

  /**
   * The unreachable surface area, ratcheted.
   *
   * Twenty-three components and pages under src/ are imported by no entry point.
   * Several carry exactly the fabrications this branch deleted from the live
   * ones — `CommandCenterDashboard` renders
   * `<FinancialImpactWidget savings={1200000} interventions={17} />` and a
   * hardcoded "System Health 94%"; `DecisionLogs` holds a literal decision log
   * quoting "92% confidence" and "$25K".
   *
   * They are NOT deleted here, and that is a deliberate call rather than an
   * oversight. They are unreachable, so no user sees those numbers, which puts
   * them below every reachable fabrication in priority; one of them
   * (`ReliabilityEngineerPage`) belongs to a feature restoration two commits
   * behind this branch's base and deleting it would quietly undo somebody's
   * work in progress; and a 23-file, ~7,000-line deletion is a blast radius
   * this repair pass has no mandate for while another agent is working in the
   * same tree.
   *
   * What they must not do is GROW, or become evidence. `judgeFile` above now
   * refuses a register citation to any of them, so none can be offered as
   * proof of a capability. This ratchet handles the other half: a new dead
   * surface fails the build on the commit that adds it, when it is one file
   * and one author rather than an archaeology problem.
   *
   * 2026-08-20: raised 23 -> 25. NOT new dead surfaces — the RESTORATION of
   * `UnifiedChatInterface.tsx` and `billing/BillingOverview.tsx`, which an
   * earlier commit on this branch deleted under an Honesty-lane instruction
   * that has since been withdrawn (AGENTS.md rule 1: the lane corrects claims,
   * it does not delete code). Restoring them is the correction, so the ceiling
   * moves with them rather than the files staying deleted to keep a number
   * down. `UnifiedChatInterface` was not restored unchanged: it sent the anon
   * key as its Authorization bearer, which made every call to
   * `ai-agent-processor` arrive with a null `auth.uid()` and therefore outside
   * the caller's organization scope. That is now `supabase.functions.invoke`,
   * which carries the signed-in session token. Deleting the file would have
   * buried that defect instead of fixing it.
   *
   * This number may only ever go DOWN from here by wiring or by a deletion
   * that names its evidence twice, per AGENTS.md rule 1.
   *
   * 2026-08-31: `InThreadLearnRecorder` sat here while Honesty kept it
   * unmounted. 2026-09-04: ConversationLearn mounts it only after an
   * obligation id is resolved, and only claims recorded from
   * `recordVerificationResult`'s return. Learning Loop remains the other
   * write surface. The set may only shrink.
   */
  const HONESTY_UNMOUNTED = [] as const;

  it("does not grow the set of surfaces no entry point imports", () => {
    const orphans = [...code.files.keys()]
      .filter((f) => !isTestFile(f) && !code.reachable.has(f))
      .filter(
        (f) => f.startsWith("src/components/") || f.startsWith("src/pages/"),
      );
    for (const named of HONESTY_UNMOUNTED) {
      expect(
        orphans,
        `${named} must stay unmounted until a real RPC caller`,
      ).toContain(named);
      expect(
        [...code.files.keys()],
        `${named} must remain in the tree (Honesty does not delete)`,
      ).toContain(named);
    }
    const unnamed = orphans.filter(
      (f) => !(HONESTY_UNMOUNTED as readonly string[]).includes(f),
    );
    expect(
      unnamed.length,
      `dead surfaces:\n  ${unnamed.sort().join("\n  ")}`,
    ).toBeLessThanOrEqual(25);
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
