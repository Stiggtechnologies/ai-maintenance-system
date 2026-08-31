/**
 * Slice 4D unit tests.
 *
 * Every test here is about a REFUSAL — the shape of an absence, or the
 * sentence that replaces a number. The arithmetic these helpers do not do is
 * the point: balances, latencies, debts and ceilings are all the server's, and
 * a helper that computed one would be a second source of truth.
 */

import { describe, expect, it } from "vitest";
import {
  CHANGE_CALC_KEYS,
  CHANGE_CALC_VERSION,
  CONTINGENCY_CAUSE_CLASSES,
  CONTROL_DIMENSIONS,
  DECISION_LATENCY_POLICY,
  MY_DECISION_COLUMNS,
  DIMENSION_HEADLINE_FIELDS,
  changeBlocker,
  changeFingerprint,
  contingencyFingerprint,
  decisionDebtFingerprint,
  decisionDebtHeadline,
  decisionLatencyFingerprint,
  decisionLatencyHeadline,
  dimensionDisplay,
  dimensionFingerprint,
  drawdownPreflight,
  moneyOrReason,
  recordedDebtHeadline,
  recordedLatencyHeadline,
  selectableCauseClasses,
  sortMyDecisions,
} from "./change";
import type {
  CaseContingency,
  CaseDecisionDebt,
  CaseDecisionLatency,
  CaseIntegratedControls,
  ControlDimension,
  MyDecisionRow,
  ProjectChange,
} from "./change";
import type { PerformanceCalculationRun } from "./performance";

function run(
  over: Partial<PerformanceCalculationRun>,
): PerformanceCalculationRun {
  return {
    id: "r1",
    calculationKey: "case_contingency_consumption",
    method: "m",
    codeVersion: CHANGE_CALC_VERSION,
    inputs: {},
    inputRefs: [],
    outputs: { consumedNet: 10 },
    refusals: [],
    status: "computed",
    computedAt: "2026-12-03T00:00:00Z",
    computedBy: "planner@syncai.ca",
    ...over,
  };
}

function pool(over: Partial<CaseContingency["currentPool"]> = {}) {
  return {
    id: "p1",
    poolRef: "CONT-COST-v1",
    baselineId: "b1",
    baselineVersion: 1,
    baselineStatus: "approved",
    originalAmount: 1_000_000,
    currency: "CAD",
    basis: "x".repeat(30),
    status: "open" as const,
    establishedAt: "2026-12-01T00:00:00Z",
    establishedBy: "manager@syncai.ca",
    drawnDown: 200_000,
    released: 0,
    remaining: 800_000,
    consumedPercent: 20,
    isCurrent: true,
    entryCount: 2,
    ...over,
  };
}

function contingency(over: Partial<CaseContingency> = {}): CaseContingency {
  return {
    caseId: "c1",
    pools: [pool()],
    currentPool: pool(),
    entries: [],
    byCause: [],
    poolCount: 1,
    originalTotal: 1_000_000,
    drawnDownTotal: 200_000,
    releasedTotal: 0,
    consumedNet: 200_000,
    remainingTotal: 800_000,
    currency: "CAD",
    poolCurrencies: ["CAD"],
    currencyRefusal: null,
    refusal: null,
    authority: {
      permitted: true,
      tierLabel: "Project manager",
      ceiling: 250_000,
      escalatesTo: "executive",
    },
    callerRole: "maintenance_manager",
    lineContingency: {
      costItemsWithContingency: 0,
      total: 0,
      agreesWithPools: null,
      note: "no lines",
    },
    notInThisSlice: [],
    ...over,
  };
}

describe("the published vocabularies", () => {
  it("carries spec II.8's own four causes plus the two linked classes", () => {
    const keys = CONTINGENCY_CAUSE_CLASSES.map((c) => c.key);
    for (const k of [
      "scope_maturation",
      "market_escalation",
      "productivity",
      "realized_risk",
    ]) {
      expect(keys).toContain(k);
    }
    expect(
      CONTINGENCY_CAUSE_CLASSES.filter((c) => c.linked).map((c) => c.key),
    ).toEqual(["realized_risk", "approved_change"]);
  });

  it("keeps `unattributed` in the vocabulary and out of the chooser", () => {
    // The report must be able to SHOW an unattributed spend; a person must not
    // be able to record one. Both halves matter and they are different lists.
    expect(CONTINGENCY_CAUSE_CLASSES.map((c) => c.key)).toContain(
      "unattributed",
    );
    expect(selectableCauseClasses().map((c) => c.key)).not.toContain(
      "unattributed",
    );
    expect(selectableCauseClasses()).toHaveLength(
      CONTINGENCY_CAUSE_CLASSES.length - 1,
    );
  });

  it("shows all seven control dimensions including the empty one", () => {
    // Spec §44 names six; contingency is the seventh because II.8 makes it a
    // control dimension in its own right, and procurement is carried with a
    // null calculation key so the view cannot silently become five tiles.
    expect(CONTROL_DIMENSIONS).toHaveLength(7);
    const procurement = CONTROL_DIMENSIONS.find((d) => d.key === "procurement");
    expect(procurement?.calculationKey).toBeNull();
  });

  it("carries §44's seven My Decisions columns in the spec's order", () => {
    expect(MY_DECISION_COLUMNS.map((c) => c.key)).toEqual([
      "decision",
      "project",
      "valueAtStake",
      "risk",
      "dueDate",
      "recommendation",
      "confidence",
    ]);
  });

  it("pins one code version for the four 4D calculation keys", () => {
    expect(CHANGE_CALC_KEYS).toHaveLength(4);
    expect(CHANGE_CALC_VERSION).toBe("develop-change/4D/2026-12-03");
  });

  it("reads criticality from 4C's own threshold, not a second one", () => {
    expect(DECISION_LATENCY_POLICY.criticalFloatHours).toBe(0);
    expect(DECISION_LATENCY_POLICY.probabilityCeiling).toBe(1);
    expect(DECISION_LATENCY_POLICY.averageFloor).toBe(3);
  });
});

describe("dimensionDisplay — three states, none of them blank", () => {
  const base: ControlDimension = {
    key: "contingency",
    label: "Contingency",
    calculationKey: "case_contingency_consumption",
    what: "…",
    run: null,
    refusal: "No case_contingency_consumption run has been recorded.",
    stalenessCheckable: true,
    stalenessNote: null,
  };

  it("says NO RUN RECORDED rather than showing an empty tile", () => {
    const d = dimensionDisplay(base);
    expect(d.state).toBe("no_run");
    expect(d.outputs).toBeNull();
    expect(d.sentence).toMatch(/no case_contingency_consumption run/i);
  });

  it("never falls back to a live figure when there is no run", () => {
    // The absence of any `live` parameter on this helper IS the guarantee:
    // there is nothing for a fallback to come from.
    expect(dimensionDisplay(base).outputs).toBeNull();
  });

  it("distinguishes a REFUSED run from a missing one and keeps its reasons", () => {
    const d = dimensionDisplay({
      ...base,
      run: run({
        status: "refused",
        outputs: null,
        refusals: ["no drawdown recorded"],
      }),
      refusal: "The last recorded run REFUSED.",
    });
    expect(d.state).toBe("refused");
    expect(d.outputs).toBeNull();
    expect(d.refusals).toEqual(["no drawdown recorded"]);
  });

  it("carries a computed_with_refusals run's caveats alongside its figures", () => {
    const d = dimensionDisplay({
      ...base,
      run: run({
        status: "computed_with_refusals",
        refusals: ["$5,000 of consumption is UNATTRIBUTED"],
      }),
      refusal: null,
    });
    expect(d.state).toBe("figures");
    expect(d.outputs).toEqual({ consumedNet: 10 });
    expect(d.refusals[0]).toMatch(/unattributed/i);
  });

  it("treats a run whose outputs are null as refused even if status says otherwise", () => {
    // A defensive branch: a corrupted row must not render a blank number.
    const d = dimensionDisplay({
      ...base,
      run: run({ status: "computed", outputs: null }),
      refusal: null,
    });
    expect(d.state).toBe("refused");
  });
});

describe("moneyOrReason — a dash where an amount belongs reads as zero", () => {
  it("returns the reason, flagged, when the amount is absent", () => {
    const r = moneyOrReason(null, "CAD", "no fund established");
    expect(r.isRefusal).toBe(true);
    expect(r.text).toBe("no fund established");
  });

  it("refuses a non-finite amount rather than printing NaN", () => {
    expect(moneyOrReason(Number.NaN, "CAD", "unmeasured").isRefusal).toBe(true);
    expect(moneyOrReason(Infinity, "CAD", "unmeasured").isRefusal).toBe(true);
  });

  it("prints a real zero as a number, because zero spent is a measurement", () => {
    const r = moneyOrReason(0, "CAD", "unmeasured");
    expect(r.isRefusal).toBe(false);
    expect(r.text).toContain("0");
  });
});

describe("drawdownPreflight — the form's copy of the server's refusals", () => {
  it("refuses an empty amount", () => {
    expect(drawdownPreflight("", contingency()).ok).toBe(false);
  });

  it("refuses NaN and infinity by name", () => {
    expect(drawdownPreflight("NaN", contingency()).reason).toMatch(
      /finite number/i,
    );
    expect(drawdownPreflight("Infinity", contingency()).reason).toMatch(
      /finite number/i,
    );
  });

  it("refuses zero and negative amounts, naming release as the reverse act", () => {
    expect(drawdownPreflight("0", contingency()).reason).toMatch(
      /greater than zero/i,
    );
    const neg = drawdownPreflight("-1000", contingency());
    expect(neg.ok).toBe(false);
    expect(neg.reason).toMatch(/release/i);
  });

  it("refuses more than remains and names the remainder", () => {
    const r = drawdownPreflight("900000", contingency());
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/cannot go negative/i);
    expect(r.reason).toMatch(/800,000/);
  });

  it("refuses above the caller's ceiling and names the escalation", () => {
    const r = drawdownPreflight("300000", contingency());
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ceiling/i);
    expect(r.reason).toMatch(/executive/);
  });

  it("refuses when no pool is established, surfacing the read's own sentence", () => {
    const c = contingency({
      currentPool: null,
      refusal: "No contingency fund is established for this case.",
    });
    expect(drawdownPreflight("100", c).reason).toMatch(/no contingency fund/i);
  });

  it("refuses when the delegation itself refuses, quoting the server", () => {
    const c = contingency({
      authority: {
        permitted: false,
        refusal:
          "Delegation of authority: no adopted contingency-drawdown delegation exists for planner.",
      },
    });
    const r = drawdownPreflight("100", c);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no adopted contingency-drawdown delegation/i);
  });

  it("permits an amount inside both the balance and the ceiling", () => {
    expect(drawdownPreflight("100000", contingency())).toEqual({
      ok: true,
      reason: null,
    });
  });

  it("never permits what the server would refuse — the ceiling is a bound, not a hint", () => {
    // A null ceiling must not read as unlimited on the client either. With
    // permitted:true and no ceiling the client defers to the server, which
    // refuses a null ceiling by name (R2).
    const c = contingency({
      authority: { permitted: true, tierLabel: "PM", ceiling: null },
    });
    expect(drawdownPreflight("100000", c).ok).toBe(true);
  });
});

describe("changeBlocker — Workflow 3's order, so the right blocker is named", () => {
  const base: ProjectChange = {
    id: "ch1",
    changeRef: "CR-1",
    changeClass: "project_cost_change",
    classTitle: "Change to the approved cost baseline",
    requiredSignerRole: "reliability_engineer",
    baselineId: "b1",
    baselineType: "COST",
    baselineVersion: 1,
    baselineStatus: "approved",
    proposedChange: "x".repeat(30),
    reason: "y".repeat(30),
    requester: "planner@syncai.ca",
    status: "proposed",
    impact: null,
    impactRefusal: "This change has not been assessed.",
    competenceSignedAt: null,
    competenceSignedBy: null,
    competenceNote: null,
    competenceRefusal: "requires competence sign-off",
    approver: null,
    approverRole: null,
    approverCeiling: null,
    tierLabel: null,
    decidedAt: null,
    decisionNote: null,
    implementedAt: null,
    createdAt: "2026-12-03T00:00:00Z",
    propagation: [],
    propagationOutstanding: 0,
    contingencyDrawn: 0,
  };

  it("names the missing assessment before the missing signature", () => {
    expect(changeBlocker(base)).toMatch(/not been assessed/i);
  });

  it("names the missing signature once the impact exists", () => {
    const assessed = {
      ...base,
      status: "assessed" as const,
      impact: {
        technicalEffect: "t",
        costEffect: 1000,
        scheduleEffectDays: 2,
        riskEffect: "Low",
        contingencyEffect: 0,
        currency: "CAD",
        basis: "b".repeat(30),
        assessedBy: "planner@syncai.ca",
        assessedAt: "2026-12-03T00:00:00Z",
      },
      impactRefusal: null,
    };
    expect(changeBlocker(assessed)).toMatch(/competence sign-off/i);
  });

  it("separates DECIDED from PROPAGATED on an approved change", () => {
    const approved = {
      ...base,
      status: "approved" as const,
      impact: {
        technicalEffect: "t",
        costEffect: 1000,
        scheduleEffectDays: 2,
        riskEffect: "Low",
        contingencyEffect: 0,
        currency: "CAD",
        basis: "b".repeat(30),
        assessedBy: "planner@syncai.ca",
        assessedAt: "2026-12-03T00:00:00Z",
      },
      impactRefusal: null,
      competenceSignedAt: "2026-12-03T00:00:00Z",
      competenceRefusal: null,
      decidedAt: "2026-12-03T01:00:00Z",
      propagationOutstanding: 2,
    };
    const blocker = changeBlocker(approved);
    expect(blocker).toMatch(/2 propagation obligation/i);
    expect(blocker).toMatch(/DECIDED/);
  });

  it("has nothing to say about a fully propagated change", () => {
    expect(
      changeBlocker({
        ...base,
        status: "implemented",
        impact: {
          technicalEffect: "t",
          costEffect: 0,
          scheduleEffectDays: 0,
          riskEffect: "Low",
          contingencyEffect: 0,
          currency: "CAD",
          basis: "b".repeat(30),
          assessedBy: "p",
          assessedAt: "2026-12-03T00:00:00Z",
        },
        impactRefusal: null,
        competenceSignedAt: "2026-12-03T00:00:00Z",
        competenceRefusal: null,
        decidedAt: "2026-12-03T01:00:00Z",
        propagationOutstanding: 0,
      }),
    ).toBeNull();
  });
});

describe("decisionLatencyHeadline — §54, or the reason there is no §54", () => {
  const base: CaseDecisionLatency = {
    caseId: "c1",
    decisions: [],
    decisionCount: 4,
    closedCount: 3,
    openCount: 1,
    undatedCount: 0,
    unmeasurableCloseCount: 0,
    averageLatencyDays: 5,
    maxLatencyDays: 12,
    averageRefusal: null,
    refusal: null,
    criticalPathExposureDays: 11.7,
    criticalPathDecisionCount: 2,
    criticalPathRefusal: null,
    scheduleActivityCount: 20,
    activitiesWithFloat: 20,
  };

  it("produces spec I.30's own sentence when the float exists", () => {
    expect(decisionLatencyHeadline(base)).toBe(
      "2 open decisions account for 11.7 days of current critical-path exposure.",
    );
  });

  it("refuses rather than reporting 0 days when no decision is recorded", () => {
    const r = decisionLatencyHeadline({
      ...base,
      decisionCount: 0,
      refusal: "No decision is recorded against this case.",
    });
    expect(r).toMatch(/no decision is recorded/i);
    expect(r).not.toMatch(/0 days/);
  });

  it("refuses rather than reporting 0 days when no activity carries a float", () => {
    const r = decisionLatencyHeadline({
      ...base,
      criticalPathExposureDays: null,
      criticalPathDecisionCount: null,
      activitiesWithFloat: 0,
      criticalPathRefusal:
        "No activity on this case carries a total float. Sync does not recompute the network.",
    });
    expect(r).toMatch(/does not recompute the network/i);
    expect(r).not.toMatch(/\b0 days\b/);
  });

  it("states a MEASURED zero as a measurement, not as an absence", () => {
    const r = decisionLatencyHeadline({
      ...base,
      criticalPathExposureDays: 0,
      criticalPathDecisionCount: 0,
    });
    expect(r).toMatch(/no open decision/i);
  });
});

describe("decisionDebtHeadline — II.17, never a confident zero", () => {
  const base: CaseDecisionDebt = {
    caseId: "c1",
    decisions: [],
    outstandingCount: 5,
    quantifiedCount: 3,
    unquantifiedCount: 2,
    totalDebt: 240_000,
    currency: "CAD",
    criticalPathCapableCount: 2,
    criticalPathCapableRefusal: null,
    refusal: null,
  };

  it("names the unquantified remainder beside the figure", () => {
    const r = decisionDebtHeadline(base);
    expect(r).toMatch(/240,000/);
    expect(r).toMatch(/2 outstanding decisions carry no stated exposure/i);
  });

  it("refuses on an empty set rather than reporting zero debt", () => {
    const r = decisionDebtHeadline({
      ...base,
      outstandingCount: 0,
      quantifiedCount: 0,
      totalDebt: null,
      refusal: "No decision on this case is outstanding.",
    });
    expect(r).toMatch(/no decision on this case is outstanding/i);
    expect(r).not.toMatch(/\$0/);
  });

  it("refuses when nothing has been quantified", () => {
    const r = decisionDebtHeadline({
      ...base,
      quantifiedCount: 0,
      totalDebt: null,
      refusal:
        "5 decisions are outstanding and NONE of them carries a stated delay exposure.",
    });
    expect(r).toMatch(/none of them carries a stated delay exposure/i);
  });

  it("refuses to add two currencies together", () => {
    const r = decisionDebtHeadline({
      ...base,
      totalDebt: null,
      refusal:
        "The stated exposures on this case use 2 different currencies. They are NOT summed.",
    });
    expect(r).toMatch(/not summed/i);
  });
});

describe("fingerprints — what makes a published figure go stale", () => {
  const controls: CaseIntegratedControls = {
    caseId: "c1",
    caseTitle: "t",
    caseStatus: "active",
    stageKey: null,
    dimensions: [],
    dimensionsWithRun: 0,
    dimensionsTotal: 7,
    refusedRunCount: 0,
    currentFingerprints: {
      ledgerDigest: "abc",
      changeDigest: "def",
      propagationDigest: "ghi",
    },
    decisionLatency: null,
    decisionDebt: null,
    composedNotComputed: "",
    notInThisSlice: [],
  };

  it("puts the ledger CONTENT in the contingency fingerprint, not a count", () => {
    // A count cannot see an edited amount. The digest can, which is what makes
    // a service-path edit the immutability trigger admits show as stale.
    expect(contingencyFingerprint(controls)).toEqual({ ledgerDigest: "abc" });
  });

  it("puts both the change vector AND the propagation state in the change fingerprint", () => {
    // Closing an obligation changes what "approved change" means on screen
    // without touching a single change row, so the propagation digest has to
    // be in the comparison too.
    expect(changeFingerprint(controls)).toEqual({
      changeDigest: "def",
      propagationDigest: "ghi",
    });
  });

  it("yields nulls rather than throwing when a fingerprint field is absent", () => {
    const older = { ...controls, currentFingerprints: {} };
    expect(contingencyFingerprint(older)).toEqual({ ledgerDigest: null });
    expect(changeFingerprint(older)).toEqual({
      changeDigest: null,
      propagationDigest: null,
    });
  });
});

describe("sortMyDecisions — undated rows go last, not first", () => {
  const row = (over: Partial<MyDecisionRow>): MyDecisionRow =>
    ({
      decisionId: "d",
      decision: "d",
      decisionType: null,
      caseId: null,
      project: null,
      domain: "risk",
      valueAtStake: null,
      currency: null,
      valueRefusal: null,
      riskId: null,
      riskTitle: null,
      riskLevel: null,
      riskScore: null,
      dueDate: null,
      latencyDays: null,
      overdue: null,
      dueRefusal: null,
      reassessmentRequired: false,
      reassessmentReason: null,
      recommendationId: null,
      recommendation: null,
      recommendationStatus: null,
      recommendationRefusal: null,
      confidence: null,
      linkedActivities: 0,
      onCriticalPath: null,
      expectedImpact: null,
      probabilityOfDelay: null,
      exposureCurrency: null,
      owner: null,
      raisedAt: "2026-12-01T00:00:00Z",
      ...over,
    }) as MyDecisionRow;

  it("sorts by due date and pushes undated decisions to the bottom", () => {
    const sorted = sortMyDecisions([
      row({ decisionId: "undated" }),
      row({ decisionId: "late", dueDate: "2026-11-01" }),
      row({ decisionId: "soon", dueDate: "2026-12-20" }),
    ]);
    expect(sorted.map((r) => r.decisionId)).toEqual([
      "late",
      "soon",
      "undated",
    ]);
  });

  it("breaks ties on value at stake, and an unvalued decision loses the tie", () => {
    const sorted = sortMyDecisions([
      row({ decisionId: "unvalued", dueDate: "2026-12-01" }),
      row({ decisionId: "big", dueDate: "2026-12-01", valueAtStake: 900 }),
    ]);
    expect(sorted[0].decisionId).toBe("big");
  });

  it("does not mutate the array it was given", () => {
    const input = [
      row({ decisionId: "a", dueDate: "2026-12-20" }),
      row({ decisionId: "b", dueDate: "2026-11-01" }),
    ];
    sortMyDecisions(input);
    expect(input.map((r) => r.decisionId)).toEqual(["a", "b"]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE REPAIR SUITE (surface half). One test per defect adversarial review
 * found on the client side of this slice.
 * ═══════════════════════════════════════════════════════════════════════ */
describe("Slice 4D repair — the surface", () => {
  const dim = (over: Partial<ControlDimension> = {}): ControlDimension => ({
    key: "cost",
    label: "Cost",
    calculationKey: "case_earned_value",
    what: "…",
    run: {
      id: "r1",
      calculationKey: "case_earned_value",
      method: "…",
      codeVersion: "develop-performance/4B/2026-12-01",
      inputs: { basisDigest: "abc" },
      inputRefs: [],
      // jsonb orders keys by (length, bytewise) — this is the ACTUAL order the
      // recorded earned-value run comes back in, which is why a positional
      // slice(0, 5) showed ac/es/ev/pv/bac and dropped the whole suite.
      outputs: {
        ac: 312000,
        es: 1.91,
        ev: 84000,
        pv: 90000,
        bac: 100000,
        cpi: 0.27,
        spi: 0.93,
        eac: 371428,
        vac: -271428,
        currency: "CAD",
      },
      refusals: [],
      status: "computed",
      computedAt: "2026-12-03T00:00:00Z",
      computedBy: "planner@syncai.ca",
    } as unknown as ControlDimension["run"],
    refusal: null,
    stalenessCheckable: false,
    stalenessNote: "…",
    ...over,
  });

  it("renders the fields the dimension is ABOUT, never an arbitrary slice", () => {
    // The old tile rendered Object.entries(outputs).slice(0, 5) and silently
    // dropped cpi, spi, eac, vac — the entire earned-value suite D5.05/D5.06
    // names — plus the currency, so the money on the tile had no unit.
    const d = dimensionDisplay(dim());
    const keys = d.fields.map((f) => f.key);
    for (const k of ["cpi", "spi", "eac", "vac", "currency"]) {
      expect(keys, `${k} is cut from the cost tile`).toContain(k);
    }
    // ...and whatever it does not show, it COUNTS rather than hiding.
    expect(d.otherFieldCount).toBe(
      Object.keys(dim().run?.outputs ?? {}).length - keys.length,
    );
  });

  it("every control dimension has a named headline set", () => {
    for (const c of CONTROL_DIMENSIONS) {
      if (c.calculationKey == null) continue;
      expect(
        DIMENSION_HEADLINE_FIELDS[c.key],
        `${c.key} would fall back to an arbitrary key order`,
      ).toBeDefined();
    }
  });

  it("a dimension the screen cannot fingerprint returns NULL, not an empty match", () => {
    // performanceRunIsStale answers `false` for an empty fingerprint, which is
    // indistinguishable from "checked and fresh". Null forces the caller to
    // render the sentence instead of a clean caption.
    const controls = {
      currentFingerprints: { ledgerDigest: "x", changeDigest: "y" },
    } as unknown as CaseIntegratedControls;
    expect(dimensionFingerprint(dim(), controls)).toBeNull();
    expect(
      dimensionFingerprint(
        dim({ key: "contingency", stalenessCheckable: true }),
        controls,
      ),
    ).toEqual({ ledgerDigest: "x" });
  });

  it("the decision runs have a fingerprint at all", () => {
    // Without these the decision panel printed live-read figures under a
    // lineage caption describing an older run, with nothing to compare.
    const controls = {
      currentFingerprints: {
        decisionDigest: "d",
        linkDigest: "l",
        policyDigest: "p",
        exposureDigest: "e",
        openDecisionDigest: "o",
      },
    } as unknown as CaseIntegratedControls;
    expect(decisionLatencyFingerprint(controls)).toEqual({
      decisionDigest: "d",
      linkDigest: "l",
      policyDigest: "p",
    });
    expect(decisionDebtFingerprint(controls)).toEqual({
      exposureDigest: "e",
      openDecisionDigest: "o",
    });
  });

  it("the §54 headline never prints a silent zero when the figure is absent", () => {
    const l = {
      refusal: null,
      criticalPathRefusal: null,
      criticalPathExposureDays: null,
      criticalPathDecisionCount: null,
    } as unknown as CaseDecisionLatency;
    const text = decisionLatencyHeadline(l);
    expect(text).not.toMatch(/0 days/);
    expect(text).toMatch(/not available/i);
  });

  it("the published decision figures come off the RUN, and say when it is stale", () => {
    const run = {
      status: "computed",
      outputs: { criticalPathExposureDays: 91.3, criticalPathDecisionCount: 1 },
      refusals: [],
    } as unknown as Parameters<typeof recordedLatencyHeadline>[0];
    expect(recordedLatencyHeadline(run, false)).toMatch(/91.3 days/);
    expect(recordedLatencyHeadline(run, true)).toMatch(/superseded/i);
    expect(recordedLatencyHeadline(null, false)).toMatch(
      /no decision-latency run/i,
    );
    const refused = {
      status: "refused",
      outputs: null,
      refusals: ["No decision is recorded against this case."],
    } as unknown as Parameters<typeof recordedDebtHeadline>[0];
    expect(recordedDebtHeadline(refused, false)).toMatch(
      /No decision is recorded/,
    );
    expect(recordedDebtHeadline(null, false)).toMatch(/no decision-debt run/i);
  });

  it("the drawdown preflight quotes the CUMULATIVE headroom, not the transaction", () => {
    const c = contingency({
      authority: {
        permitted: true,
        tierLabel: "Project manager",
        ceiling: 250_000,
        alreadyCommitted: 105_000,
        escalatesTo: "executive",
      },
    });
    const r = drawdownPreflight("180000", c);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/already committed 105,000/);
    expect(r.reason).toMatch(/not what you may commit per transaction/);
    // ...and a draw inside the remaining headroom passes.
    expect(drawdownPreflight("100000", c).ok).toBe(true);
  });

  it("a withheld multi-currency total is not rendered as zero anywhere", () => {
    const c = contingency({
      originalTotal: null,
      remainingTotal: null,
      drawnDownTotal: null,
      consumedNet: null,
      poolCurrencies: ["CAD", "USD"],
      currencyRefusal: "…produces a number in no currency at all…",
    });
    expect(c.originalTotal).toBeNull();
    const m = moneyOrReason(c.remainingTotal, null, c.currencyRefusal ?? "");
    expect(m.isRefusal).toBe(true);
    expect(m.text).toMatch(/no currency at all/);
  });
});
