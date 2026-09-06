/**
 * Sync Develop Slice 4D — contingency (D5.18/D5.19), change control
 * (D5.27/D5.30), decision latency, exposure and debt (D3.12/D3.13/D3.21/
 * D3.36), the composed Sync Assurance engine (D5.21) and the two screens
 * (D13.08 Integrated Controls, D13.02 My Decisions).
 *
 * WHAT LIVES HERE AND WHAT DOES NOT — the controls.ts / performance.ts /
 * schedule.ts precedent, unchanged:
 *
 *   1. THE VOCABULARIES the spec fixes (II.8's cause classes, §21's impact
 *      vector, §44's seven My Decisions columns and six control dimensions)
 *      and the PUBLISHED POLICY NUMBERS. They mirror the migrations and the
 *      slice test pins each one against the migration text, so a threshold
 *      cannot be widened on one side only.
 *
 *   2. THE TYPES for the payloads, so a page cannot read a key the RPC does
 *      not return.
 *
 *   3. PURE PRESENTATION HELPERS. NOT calculations. Specifically: nothing
 *      here computes a balance, a latency, a debt or a ceiling. Every figure
 *      the screens show comes off a recorded calculation run or off the
 *      ledger; this module decides how an ABSENCE is worded, which is the
 *      only judgement a surface is allowed to make about a number.
 */

import type { PerformanceCalculationRun } from "./performance";

/* ────────────────────────── the vocabularies ─────────────────────────── */

/**
 * Spec II.8's own cause taxonomy: "$18M consumed: $7M scope maturation, $4M
 * market escalation, $3M construction productivity, $4M realized risk."
 *
 * `linked` marks the two classes that must cite a subject in a canonical
 * store — a risk in the risk register, a change in the change register. The
 * door refuses a linked class with no subject, because "a risk happened"
 * without saying which is an unattributed spend wearing an attributed label.
 *
 * `unattributed` is in the list and CANNOT BE CHOSEN. It exists so that a
 * spend which somehow reaches the ledger without a cause is SHOWN as
 * unattributed rather than dropped from the total; `selectableCauseClasses`
 * is what a form offers.
 */
export const CONTINGENCY_CAUSE_CLASSES = [
  { key: "realized_risk", label: "Realized risk", linked: true },
  { key: "approved_change", label: "Approved change", linked: true },
  { key: "scope_maturation", label: "Scope maturation", linked: false },
  { key: "market_escalation", label: "Market escalation", linked: false },
  { key: "productivity", label: "Productivity", linked: false },
  { key: "estimate_error", label: "Estimate error", linked: false },
  { key: "unattributed", label: "Unattributed", linked: false },
] as const;

export type ContingencyCauseClass =
  (typeof CONTINGENCY_CAUSE_CLASSES)[number]["key"];

/** The classes a human may choose. `unattributed` is deliberately not one. */
export function selectableCauseClasses(): {
  key: ContingencyCauseClass;
  label: string;
  linked: boolean;
}[] {
  return CONTINGENCY_CAUSE_CLASSES.filter((c) => c.key !== "unattributed").map(
    (c) => ({ key: c.key, label: c.label, linked: c.linked }),
  );
}

/**
 * The project-delivery change classes seeded onto the EXISTING MOC engine
 * (engineering_approval_rules). Listed here so a form can offer them; the
 * authoritative list is per organization and comes back on the read, because
 * an organization may have configured its own.
 */
export const PROJECT_CHANGE_CLASSES = [
  { key: "project_scope_change", label: "Change to approved project scope" },
  { key: "project_design_change", label: "Change to an approved design basis" },
  {
    key: "project_schedule_change",
    label: "Change to the approved schedule baseline",
  },
  {
    key: "project_cost_change",
    label: "Change to the approved cost baseline",
  },
] as const;

/** Spec §21's propagation targets, in the spec's own order. */
export const CHANGE_PROPAGATION_KINDS = [
  { key: "requirement", label: "Requirements" },
  { key: "procurement", label: "Procurement" },
  { key: "schedule", label: "Schedule" },
  { key: "cost", label: "Cost" },
  { key: "risk", label: "Risk" },
  { key: "scope", label: "Scope" },
  { key: "contingency", label: "Contingency" },
  { key: "commissioning", label: "Commissioning" },
] as const;

export type ChangePropagationKind =
  (typeof CHANGE_PROPAGATION_KINDS)[number]["key"];

export const CHANGE_STATUSES = [
  "proposed",
  "assessed",
  "approved",
  "rejected",
  "withdrawn",
  "implemented",
] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

/**
 * Spec §44's Integrated Controls: "scope, schedule, cost, risk, change,
 * procurement in one coherent view."
 *
 * Contingency is carried as a seventh tile because II.8 makes it a control
 * dimension in its own right, and procurement is carried EMPTY because no
 * procurement calculation exists in Sync Develop yet. Both are shown rather
 * than omitted: a view that silently dropped a dimension would redefine what
 * "integrated" means, and a reader could not tell missing from clean.
 */
export const CONTROL_DIMENSIONS = [
  { key: "scope", label: "Scope", calculationKey: "case_scope_growth" },
  {
    key: "schedule",
    label: "Schedule",
    calculationKey: "case_schedule_quality",
  },
  { key: "cost", label: "Cost", calculationKey: "case_earned_value" },
  {
    key: "risk",
    label: "Risk",
    calculationKey: "case_risk_schedule_economics",
  },
  { key: "change", label: "Change", calculationKey: "case_change_control" },
  {
    key: "contingency",
    label: "Contingency",
    calculationKey: "case_contingency_consumption",
  },
  { key: "procurement", label: "Procurement", calculationKey: null },
] as const;

/** Spec §44's seven My Decisions columns, in the spec's own order. */
export const MY_DECISION_COLUMNS = [
  { key: "decision", label: "Decision" },
  { key: "project", label: "Project" },
  { key: "valueAtStake", label: "Value at stake" },
  { key: "risk", label: "Risk" },
  { key: "dueDate", label: "Due" },
  { key: "recommendation", label: "Recommendation" },
  { key: "confidence", label: "Confidence" },
] as const;

/** Mirrors `sync_calculation_code_version` for the four 4D keys. */
export const CHANGE_CALC_VERSION = "develop-change/4D/2026-12-03";

export const CHANGE_CALC_KEYS = [
  "case_contingency_consumption",
  "case_change_control",
  "case_decision_latency",
  "case_decision_debt",
] as const;
export type ChangeCalcKey = (typeof CHANGE_CALC_KEYS)[number];

/** Mirrors `sync_decision_latency_policy()`. Pinned by the slice test. */
export const DECISION_LATENCY_POLICY = {
  /** 4C's own definition of critical, read from 4C's own policy. */
  criticalFloatHours: 0,
  probabilityFloor: 0,
  probabilityCeiling: 1,
  /** Below this many CLOSED decisions the AVERAGE latency is withheld. */
  averageFloor: 3,
} as const;

/* ──────────────────────────────── types ──────────────────────────────── */

export interface ContingencyPool {
  id: string;
  poolRef: string;
  baselineId: string;
  baselineVersion: number;
  baselineStatus: string;
  originalAmount: number;
  currency: string;
  basis: string;
  status: "open" | "closed";
  establishedAt: string;
  establishedBy: string | null;
  drawnDown: number;
  released: number;
  remaining: number;
  consumedPercent: number | null;
  isCurrent: boolean;
  entryCount: number;
}

export interface ContingencyEntry {
  id: string;
  poolId: string;
  poolRef: string;
  entryNo: number;
  entryType: "establishment" | "drawdown" | "release";
  amount: number;
  causeClass: ContingencyCauseClass | null;
  causeRiskId: string | null;
  causeRiskTitle: string | null;
  causeNote: string | null;
  justification: string;
  approver: string | null;
  approverRole: string;
  approverCeiling: number | null;
  tierLabel: string | null;
  balanceAfter: number;
  reversesEntryId: string | null;
  recordedAt: string;
}

export interface ContingencyCauseRow {
  causeClass: ContingencyCauseClass;
  label: string;
  linked: boolean;
  /** Withheld (null) when the case holds contingency in more than one currency. */
  drawnDown: number | null;
  released: number | null;
  net: number | null;
  entryCount: number;
  sharePercent: number | null;
  refusal: string | null;
}

export interface ContingencyAuthority {
  permitted: boolean;
  refusal?: string;
  limitId?: string;
  tierLabel?: string;
  ceiling?: number | null;
  /** The currency the ceiling is stated in. A fund in another one refuses. */
  ceilingCurrency?: string | null;
  /**
   * What this approver has already committed against this fund. The ceiling is
   * cumulative against one pool, not per transaction, so the headroom is
   * `ceiling - alreadyCommitted`.
   */
  alreadyCommitted?: number | null;
  escalatesTo?: string | null;
}

export interface CaseContingency {
  caseId: string;
  pools: ContingencyPool[];
  currentPool: ContingencyPool | null;
  entries: ContingencyEntry[];
  byCause: ContingencyCauseRow[];
  poolCount: number;
  /**
   * The case-level totals are WITHHELD (null) when the pools disagree on
   * currency: adding CAD to USD produces a number in no currency at all. The
   * per-pool figures are exact and always present.
   */
  originalTotal: number | null;
  drawnDownTotal: number | null;
  releasedTotal: number | null;
  consumedNet: number | null;
  remainingTotal: number | null;
  currency: string | null;
  poolCurrencies: string[];
  currencyRefusal: string | null;
  refusal: string | null;
  authority: ContingencyAuthority | null;
  callerRole: string | null;
  lineContingency: {
    costItemsWithContingency: number;
    total: number;
    agreesWithPools: boolean | null;
    note: string;
  };
  notInThisSlice: string[];
  calculationRunId?: string;
  codeVersion?: string;
}

export interface ChangePropagationRow {
  id: string;
  targetKind: ChangePropagationKind;
  targetTable: string | null;
  targetId: string | null;
  effect: string;
  status: "pending" | "applied" | "not_applicable" | "blocked";
  syncOwned: boolean;
  closeNote: string | null;
  closedBy: string | null;
  closedAt: string | null;
}

export interface ProjectChange {
  id: string;
  changeRef: string;
  changeClass: string;
  classTitle: string | null;
  requiredSignerRole: string | null;
  baselineId: string;
  baselineType: string;
  baselineVersion: number;
  baselineStatus: string;
  proposedChange: string;
  reason: string;
  requester: string | null;
  status: ChangeStatus;
  impact: {
    technicalEffect: string;
    costEffect: number;
    scheduleEffectDays: number;
    riskEffect: string;
    contingencyEffect: number;
    currency: string;
    basis: string;
    assessedBy: string | null;
    assessedAt: string;
  } | null;
  impactRefusal: string | null;
  competenceSignedAt: string | null;
  competenceSignedBy: string | null;
  competenceNote: string | null;
  competenceRefusal: string | null;
  approver: string | null;
  approverRole: string | null;
  approverCeiling: number | null;
  tierLabel: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  implementedAt: string | null;
  createdAt: string;
  propagation: ChangePropagationRow[];
  propagationOutstanding: number;
  contingencyDrawn: number;
}

export interface CaseChangeControl {
  caseId: string;
  changes: ProjectChange[];
  changeCount: number;
  undecidedCount: number;
  approvedCount: number;
  outstandingObligations: number;
  classes: {
    changeClass: string;
    title: string;
    requiredRole: string;
    basis: string;
  }[];
  authority: ContingencyAuthority | null;
  callerRole: string | null;
  refusal: string | null;
  notInThisSlice: string[];
  calculationRunId?: string;
  codeVersion?: string;
}

export interface DecisionLatencyRow {
  decisionId: string;
  question: string | null;
  decisionType: string | null;
  owner: string | null;
  requiredDate: string | null;
  closedAt: string | null;
  isOpen: boolean;
  approvalStatus: string | null;
  reassessmentRequired: boolean;
  valueAtStake: number | null;
  currency: string | null;
  confidence: number | null;
  riskId: string | null;
  latencyDays: number | null;
  latencyKind: "closed" | "running" | "unmeasurable";
  latencyRefusal: string | null;
  linkedActivities: number;
  criticalLinks: number;
  onCriticalPath: boolean | null;
  criticalPathRefusal: string | null;
}

export interface CaseDecisionLatency {
  caseId: string;
  decisions: DecisionLatencyRow[];
  decisionCount: number;
  closedCount: number;
  openCount: number;
  undatedCount: number;
  unmeasurableCloseCount: number;
  averageLatencyDays: number | null;
  maxLatencyDays: number | null;
  averageRefusal: string | null;
  refusal: string | null;
  criticalPathExposureDays: number | null;
  criticalPathDecisionCount: number | null;
  criticalPathRefusal: string | null;
  scheduleActivityCount: number;
  activitiesWithFloat: number;
  calculationRunId?: string;
  codeVersion?: string;
}

export interface DecisionDebtRow {
  decisionId: string;
  question: string | null;
  owner: string | null;
  requiredDate: string | null;
  overdueDays: number | null;
  reassessmentRequired: boolean;
  criticalLinks: number;
  affectsCriticalPath: boolean | null;
  expectedImpact: number | null;
  probabilityOfDelay: number | null;
  currency: string | null;
  debt: number | null;
  basis: string | null;
  statedBy: string | null;
  statedAt: string | null;
  debtRefusal: string | null;
}

export interface CaseDecisionDebt {
  caseId: string;
  decisions: DecisionDebtRow[];
  outstandingCount: number;
  quantifiedCount: number;
  unquantifiedCount: number;
  totalDebt: number | null;
  currency: string | null;
  criticalPathCapableCount: number | null;
  criticalPathCapableRefusal: string | null;
  refusal: string | null;
  calculationRunId?: string;
  codeVersion?: string;
}

export interface ControlDimension {
  key: string;
  label: string;
  calculationKey: string | null;
  what: string;
  run: PerformanceCalculationRun | null;
  refusal: string | null;
  /**
   * Whether the Integrated Controls read can produce this dimension's own
   * fingerprint without performing its kernel's read. False for scope,
   * schedule, cost and risk — and the tile then SAYS the currency of the
   * figure was not checked, rather than printing a caption that implies it
   * was. An unchecked caption and a checked one must not look the same.
   */
  stalenessCheckable: boolean;
  stalenessNote: string | null;
}

export interface CaseIntegratedControls {
  caseId: string;
  caseTitle: string;
  caseStatus: string;
  stageKey: string | null;
  dimensions: ControlDimension[];
  dimensionsWithRun: number;
  dimensionsTotal: number;
  refusedRunCount: number;
  currentFingerprints: Record<string, unknown>;
  decisionLatency: PerformanceCalculationRun | null;
  decisionDebt: PerformanceCalculationRun | null;
  composedNotComputed: string;
  notInThisSlice: string[];
}

export interface AssuranceConstituent {
  kind: "run" | "record";
  key?: string;
  run?: PerformanceCalculationRun | null;
  refusal: string | null;
}

export interface CaseAssuranceEngine {
  caseId: string;
  caseTitle: string;
  constituents: {
    estimateQuality: AssuranceConstituent;
    scheduleQuality: AssuranceConstituent;
    progressIntegrity: AssuranceConstituent;
    independentChallenge: AssuranceConstituent & {
      reviews: unknown[];
      reviewCount: number;
      completedCount: number;
      claims: unknown[];
      claimCount: number;
    };
  };
  constituentsLive: number;
  constituentsTotal: number;
  missing: string[];
  compositeRefusal: string;
  notInThisSlice: string[];
}

export interface MyDecisionRow {
  decisionId: string;
  decision: string;
  decisionType: string | null;
  caseId: string | null;
  project: string | null;
  domain: "development_case" | "risk" | "operating_loop";
  valueAtStake: number | null;
  currency: string | null;
  valueRefusal: string | null;
  riskId: string | null;
  riskTitle: string | null;
  riskLevel: string | null;
  riskScore: number | null;
  dueDate: string | null;
  latencyDays: number | null;
  overdue: boolean | null;
  dueRefusal: string | null;
  reassessmentRequired: boolean;
  reassessmentReason: string | null;
  recommendationId: string | null;
  recommendation: string | null;
  recommendationStatus: string | null;
  recommendationRefusal: string | null;
  confidence: number | null;
  linkedActivities: number;
  onCriticalPath: boolean | null;
  /**
   * The two numbers a person STATED, in the currency they stated them in.
   * Their product is NOT computed here: spec II.17's DecisionDebt is what the
   * recorded `case_decision_debt` run says it is, and a second derivation in a
   * read would be a second source of truth for a governance figure.
   */
  expectedImpact: number | null;
  probabilityOfDelay: number | null;
  exposureCurrency: string | null;
  owner: string | null;
  raisedAt: string;
}

export interface MyDecisions {
  decisions: MyDecisionRow[];
  /** Over the WHOLE queue, not over the page. */
  count: number;
  overdueCount: number;
  reopenedCount: number;
  undatedCount: number;
  /** How many rows this page carries, and whether the queue is longer. */
  returned: number;
  truncated: boolean;
  truncationNote: string | null;
  scope: "organization" | "mine";
  scopeNote: string;
  callerRole: string;
  refusal: string | null;
  limit: number;
}

/**
 * The delegation instrument the money doors are checked against
 * (20261203090400). A ceiling is stated on a DRAFT and then adopted; an
 * adopted delegation is never edited, because every recorded drawdown and
 * every approved change quotes the ceiling it was checked against.
 */
export interface AuthorityDelegation {
  id: string;
  roleKey: string;
  tierLabel: string | null;
  actionType: string;
  status: "draft" | "adopted" | "superseded";
  orgNodeId: string | null;
  version: number;
  maxCommitment: number | null;
  maxCommitmentCurrency: string;
  maxRiskLevel: string | null;
  escalatesToRole: string | null;
  basis: string;
  adoptedBy: string | null;
  adoptedAt: string | null;
  isMyRole: boolean;
  /** A blank ceiling REFUSES every act it governs. It is not an unlimited one. */
  ceilingRefusal: string | null;
  /** You do not state or adopt the spending ceiling of the role you hold. */
  selfAdoptionRefusal: string | null;
}

export interface AuthorityDelegations {
  delegations: AuthorityDelegation[];
  callerRole: string;
  canState: boolean;
  refusal: string | null;
  note: string;
}

/* ────────────────────── pure presentation helpers ────────────────────── */

/**
 * The ONE place a control dimension decides what to render.
 *
 * Three states, and none of them is a blank: a run with figures, a run that
 * REFUSED, or no run at all. The third is the one that matters — falling back
 * to a live read here would put a number with no lineage under a lineage
 * caption, which is the 4A failure this convention exists to prevent.
 */
/**
 * THE HEADLINE FIELDS EACH CONTROL DIMENSION IS ABOUT.
 *
 * The tile used to render `Object.entries(outputs).slice(0, 5)`. jsonb orders
 * keys by (length, bytewise), so that truncation was ARBITRARY: the cost tile
 * showed `ac, es, ev, pv, bac` and silently dropped `cpi`, `spi`, `eac`,
 * `vac` — the entire earned-value suite the dimension exists to carry — along
 * with `currency`, so the money on the tile had no unit. On a screen whose
 * claim is "six control dimensions, one view", four arbitrary numbers per
 * dimension is not that view. The fields are named here, in the spec's own
 * order, and anything the run carries beyond them is reachable in the lineage
 * block rather than cut without saying so.
 */
export const DIMENSION_HEADLINE_FIELDS: Record<string, string[]> = {
  scope: [
    "approvedCostTotal",
    "unapprovedCostTotal",
    "additionCount",
    "uncostedCount",
    "currency",
  ],
  schedule: [
    "scheduleQualityScore",
    "band",
    "diagnosedClassCount",
    "activityCount",
    "scheduleConfidenceScore",
  ],
  cost: ["cpi", "spi", "eac", "vac", "bac", "currency"],
  risk: ["pricedRiskCount", "expectedDelayDays", "expectedCost", "currency"],
  change: [
    "approvedCostEffect",
    "approvedScheduleEffectDays",
    "contingencyDrawnAgainstChange",
    "outstandingObligations",
    "approvedCount",
    "currency",
  ],
  contingency: [
    "consumedNet",
    "consumedPercent",
    "remainingTotal",
    "originalTotal",
    "largestCause",
    "currency",
  ],
};

/**
 * The ONE place a control dimension decides what to render.
 *
 * Three states, and none of them is a blank: a run with figures, a run that
 * REFUSED, or no run at all. The third is the one that matters — falling back
 * to a live read here would put a number with no lineage under a lineage
 * caption, which is the 4A failure this convention exists to prevent.
 *
 * `fields` is the named headline set for this dimension, present-or-absent
 * from the run's own outputs, plus a count of everything else the run carries
 * so nothing is cut silently.
 */
export function dimensionDisplay(dim: ControlDimension): {
  state: "figures" | "refused" | "no_run";
  sentence: string | null;
  outputs: Record<string, unknown> | null;
  fields: { key: string; value: unknown }[];
  otherFieldCount: number;
  refusals: string[];
} {
  if (dim.run == null) {
    return {
      state: "no_run",
      sentence:
        dim.refusal ??
        `No ${dim.label.toLowerCase()} run has been recorded for this case.`,
      outputs: null,
      fields: [],
      otherFieldCount: 0,
      refusals: [],
    };
  }
  if (dim.run.status === "refused" || dim.run.outputs == null) {
    return {
      state: "refused",
      sentence:
        dim.refusal ??
        "The last recorded run of this calculation refused; there are no figures.",
      outputs: null,
      fields: [],
      otherFieldCount: 0,
      refusals: dim.run.refusals ?? [],
    };
  }
  const outputs = dim.run.outputs;
  const named = DIMENSION_HEADLINE_FIELDS[dim.key] ?? Object.keys(outputs);
  const fields = named
    .filter((k) => k in outputs)
    .map((k) => ({ key: k, value: outputs[k] }));
  const shown = new Set(fields.map((f) => f.key));
  return {
    state: "figures",
    sentence: null,
    outputs,
    fields,
    otherFieldCount: Object.keys(outputs).filter((k) => !shown.has(k)).length,
    refusals: dim.run.refusals ?? [],
  };
}

/**
 * The live fingerprint of ONE control dimension, for staleness — or null when
 * this screen cannot produce that dimension's fingerprint without performing
 * its kernel's read.
 *
 * Null is not "current": callers must render `stalenessNote` rather than a
 * clean caption. `performanceRunIsStale` answers false for an empty
 * fingerprint, which would have been indistinguishable from "checked and
 * fresh".
 */
export function dimensionFingerprint(
  dim: ControlDimension,
  controls: CaseIntegratedControls,
): Record<string, unknown> | null {
  if (!dim.stalenessCheckable) return null;
  if (dim.key === "contingency") return contingencyFingerprint(controls);
  if (dim.key === "change") return changeFingerprint(controls);
  return null;
}

/**
 * The live fingerprint of the contingency ledger, for staleness.
 *
 * `ledgerDigest` is the load-bearing field and it is computed IN SQL by both
 * the compute function and the screen read — one definition, read by both
 * sides. Counts alone could not see a service-path edit that the immutability
 * trigger audits and admits.
 */
export function contingencyFingerprint(
  controls: CaseIntegratedControls,
): Record<string, unknown> {
  return {
    ledgerDigest: controls.currentFingerprints.ledgerDigest ?? null,
  };
}

/** The live fingerprint of the change register, for staleness. */
export function changeFingerprint(
  controls: CaseIntegratedControls,
): Record<string, unknown> {
  return {
    changeDigest: controls.currentFingerprints.changeDigest ?? null,
    propagationDigest: controls.currentFingerprints.propagationDigest ?? null,
  };
}

/**
 * The live fingerprint of the decision-latency inputs, for staleness.
 *
 * These are the digests `compute_case_decision_latency` records, re-derived by
 * `get_case_integrated_controls` in SQL — one definition, read by both sides.
 * Without them the decision panel printed LIVE-READ figures under a lineage
 * caption describing an older run, with nothing to compare: the same failure
 * the 4B forecast panel had, one screen along.
 */
export function decisionLatencyFingerprint(
  controls: CaseIntegratedControls,
): Record<string, unknown> {
  return {
    decisionDigest: controls.currentFingerprints.decisionDigest ?? null,
    linkDigest: controls.currentFingerprints.linkDigest ?? null,
    policyDigest: controls.currentFingerprints.policyDigest ?? null,
  };
}

/** The live fingerprint of the decision-debt inputs, for staleness. */
export function decisionDebtFingerprint(
  controls: CaseIntegratedControls,
): Record<string, unknown> {
  return {
    exposureDigest: controls.currentFingerprints.exposureDigest ?? null,
    openDecisionDigest: controls.currentFingerprints.openDecisionDigest ?? null,
  };
}

/**
 * Money, or the reason there is none. Never "—" on its own: a dash where an
 * amount belongs reads as zero to everybody who is not looking for a refusal.
 */
export function moneyOrReason(
  amount: number | null | undefined,
  currency: string | null | undefined,
  reason: string,
): { text: string; isRefusal: boolean } {
  if (amount == null || !Number.isFinite(amount)) {
    return { text: reason, isRefusal: true };
  }
  const cur = currency ?? "";
  return {
    text: `${cur ? cur + " " : "$"}${amount.toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })}`,
    isRefusal: false,
  };
}

/**
 * How a drawdown will be judged BEFORE it is attempted, from the ladder the
 * read already returned. This mirrors the server's refusal so the form can
 * say why a button is disabled — it is NOT the enforcement, which is
 * `sync_contingency_authority` inside the definer, and it never permits
 * anything the server would refuse.
 */
export function drawdownPreflight(
  amountText: string,
  contingency: CaseContingency,
): { ok: boolean; reason: string | null } {
  const raw = amountText.trim();
  if (raw === "") return { ok: false, reason: "State the amount to draw." };
  const amount = Number(raw);
  if (!Number.isFinite(amount)) {
    return {
      ok: false,
      reason:
        "The amount must be a finite number. NaN and infinity are refused at every door — they pass every ceiling and balance test vacuously.",
    };
  }
  if (amount <= 0) {
    return {
      ok: false,
      reason:
        "A drawdown must be greater than zero. Returning money to the fund is a release against the drawdown it reverses, not a negative drawdown.",
    };
  }
  const pool = contingency.currentPool;
  if (pool == null) {
    return {
      ok: false,
      reason:
        contingency.refusal ??
        "No contingency fund is established against the current approved cost baseline.",
    };
  }
  if (amount > pool.remaining) {
    return {
      ok: false,
      reason: `This exceeds what remains in ${pool.poolRef}: ${pool.currency} ${pool.remaining.toLocaleString()} of the original ${pool.currency} ${pool.originalAmount.toLocaleString()}. A contingency fund cannot go negative.`,
    };
  }
  const auth = contingency.authority;
  if (auth == null) {
    return {
      ok: false,
      reason:
        "Your contingency delegation could not be read, so no amount can be verified as within your authority.",
    };
  }
  if (!auth.permitted && auth.refusal != null) {
    return { ok: false, reason: auth.refusal };
  }
  // The ceiling is CUMULATIVE against this fund, not per transaction: a
  // $250,000 approver who splits a spend into two calls has still committed
  // $500,000. The server enforces it; the preflight quotes the same arithmetic
  // so the person sees the headroom before pressing the button.
  const committed = auth.alreadyCommitted ?? 0;
  if (auth.ceiling != null && committed + amount > auth.ceiling) {
    const headroom = auth.ceiling - committed;
    return {
      ok: false,
      reason:
        committed > 0
          ? `You have already committed ${committed.toLocaleString()} of your ${auth.tierLabel ?? "adopted"} ceiling of ${auth.ceiling.toLocaleString()} against this fund, so ${headroom.toLocaleString()} remains within your authority. The ceiling is what you may commit from one fund, not what you may commit per transaction. Escalate to ${auth.escalatesTo ?? "a higher authority"}.`
          : `${amount.toLocaleString()} exceeds your ${auth.tierLabel ?? "adopted"} ceiling of ${auth.ceiling.toLocaleString()}. Escalate to ${auth.escalatesTo ?? "a higher authority"}.`,
    };
  }
  return { ok: true, reason: null };
}

/**
 * The §54 headline AS RECORDED, not as read live.
 *
 * The surface convention is: render the recorded RUN, never the read. The
 * decision panel used to print `decisionLatencyHeadline(liveRead)` directly
 * above a lineage caption describing an older run — so a figure of 213.6 days
 * over two decisions sat under a caption for a run that measured 91.3 over
 * one, with a clean code version and no staleness mark. This reads the run.
 */
export function recordedLatencyHeadline(
  run: PerformanceCalculationRun | null | undefined,
  stale: boolean,
): string {
  if (run == null) {
    return "No decision-latency run has been recorded for this case. Nothing here is a figure this screen produced — press Compute latency to record one.";
  }
  if (run.status === "refused" || run.outputs == null) {
    return (
      run.refusals?.[0] ??
      "The last recorded decision-latency run REFUSED; there is no figure."
    );
  }
  const days = run.outputs.criticalPathExposureDays;
  const n = run.outputs.criticalPathDecisionCount;
  const staleNote = stale
    ? " The decisions or their schedule links have moved since this run was recorded, so this figure is superseded — recompute it."
    : "";
  if (days == null || n == null) {
    return `The recorded run states no critical-path exposure; its reasons are listed below.${staleNote}`;
  }
  const count = Number(n);
  if (count === 0) {
    return `No open decision on this case was both overdue and linked to an activity P6 reports as critical when this run was recorded.${staleNote}`;
  }
  return `${count} open decision${count === 1 ? "" : "s"} account${count === 1 ? "s" : ""} for ${String(days)} day${String(days) === "1" ? "" : "s"} of critical-path exposure, as recorded.${staleNote}`;
}

/** The II.17 headline AS RECORDED. Never "$0 of decision debt". */
export function recordedDebtHeadline(
  run: PerformanceCalculationRun | null | undefined,
  stale: boolean,
): string {
  if (run == null) {
    return "No decision-debt run has been recorded for this case. Press Compute decision debt to record one.";
  }
  if (run.status === "refused" || run.outputs == null) {
    return (
      run.refusals?.[0] ??
      "The last recorded decision-debt run REFUSED; there is no figure."
    );
  }
  const total = run.outputs.totalDebt;
  const currency = run.outputs.currency;
  const quantified = Number(run.outputs.quantifiedCount ?? 0);
  const unquantified = Number(run.outputs.unquantifiedCount ?? 0);
  const staleNote = stale
    ? " The stated exposures or the outstanding decisions have moved since this run was recorded, so this figure is superseded — recompute it."
    : "";
  const money =
    total == null
      ? "No debt figure was recorded"
      : `${currency == null ? "" : `${String(currency)} `}${Number(total).toLocaleString()}`;
  const unq =
    unquantified > 0
      ? ` ${unquantified} outstanding decision${unquantified === 1 ? "" : "s"} carr${unquantified === 1 ? "ies" : "y"} no stated exposure and ${unquantified === 1 ? "is" : "are"} excluded from that figure.`
      : "";
  return `${money} of decision debt across ${quantified} quantified outstanding decision${quantified === 1 ? "" : "s"}, as recorded.${unq}${staleNote}`;
}

/**
 * The sentence a change's position deserves, in one place.
 *
 * The order is the order Workflow 3 imposes: a change cannot be decided
 * before it is assessed, and cannot be approved before it is signed. Saying
 * "not approved" about a change nobody has assessed would name the wrong
 * blocker.
 */
export function changeBlocker(change: ProjectChange): string | null {
  if (change.status === "withdrawn") return "This change was withdrawn.";
  if (change.status === "rejected") return "This change was rejected.";
  if (change.impact == null) return change.impactRefusal;
  if (change.competenceSignedAt == null && change.decidedAt == null) {
    return change.competenceRefusal;
  }
  if (change.decidedAt == null) {
    return "Assessed and signed; awaiting a decision from somebody whose adopted delegation covers its cost effect and residual risk.";
  }
  if (change.status === "approved" && change.propagationOutstanding > 0) {
    return `Approved, with ${change.propagationOutstanding} propagation obligation(s) still outstanding. What was DECIDED and what has REACHED the estimate and the schedule are different numbers.`;
  }
  return null;
}

/**
 * The §54 headline sentence, or the refusal.
 *
 * Spec I.30's example is "engineering decisions account for 11.7 days of
 * current critical-path exposure". A case with no float cannot produce that
 * sentence and says so instead — it never reports 0 days.
 */
export function decisionLatencyHeadline(latency: CaseDecisionLatency): string {
  if (latency.refusal != null) return latency.refusal;
  if (latency.criticalPathRefusal != null) return latency.criticalPathRefusal;
  const days = latency.criticalPathExposureDays;
  const n = latency.criticalPathDecisionCount;
  // NO `?? 0` ON THIS SENTENCE. It used to read `?? 0` on both, which was
  // unreachable only because the kernel happens to null the figure exactly
  // when it sets a refusal — one refactor away from printing "0 days of
  // current critical-path exposure" on a case that REFUSED, which is the one
  // sentence D3.13 promises never to emit.
  if (days == null || n == null) {
    return "Critical-path exposure is not available for this case and no reason was given. That is a defect, not a measurement of zero — the kernel returns a figure or a named refusal, never neither.";
  }
  if (n === 0) {
    return "No open decision on this case is both overdue and linked to an activity P6 reports as critical.";
  }
  return `${n} open decision${n === 1 ? "" : "s"} account${n === 1 ? "s" : ""} for ${days} day${days === 1 ? "" : "s"} of current critical-path exposure.`;
}

/** The II.17 headline, or the refusal. Never "$0 of decision debt". */
export function decisionDebtHeadline(debt: CaseDecisionDebt): string {
  if (debt.refusal != null) return debt.refusal;
  const money = moneyOrReason(
    debt.totalDebt,
    debt.currency,
    "no debt figure recorded",
  );
  const unq =
    debt.unquantifiedCount > 0
      ? ` ${debt.unquantifiedCount} outstanding decision${debt.unquantifiedCount === 1 ? "" : "s"} carry no stated exposure and are excluded from that figure.`
      : "";
  return `${money.text} of decision debt across ${debt.quantifiedCount} quantified outstanding decision${debt.quantifiedCount === 1 ? "" : "s"}.${unq}`;
}

/**
 * The My Decisions sort a person expects: overdue first, then by due date,
 * then by value at stake. Undated rows go LAST and carry their own sentence
 * rather than appearing to be on time.
 */
export function sortMyDecisions(rows: MyDecisionRow[]): MyDecisionRow[] {
  return [...rows].sort((a, b) => {
    if (a.dueDate == null && b.dueDate == null) {
      return (b.valueAtStake ?? -1) - (a.valueAtStake ?? -1);
    }
    if (a.dueDate == null) return 1;
    if (b.dueDate == null) return -1;
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return (b.valueAtStake ?? -1) - (a.valueAtStake ?? -1);
  });
}
