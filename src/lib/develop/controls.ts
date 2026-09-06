/**
 * Sync Develop Slice 4A — Integrated Controls: the scope architecture chain
 * (D5.01), its traceability gaps (D5.02), post-baseline scope cost
 * attribution (D5.03), the eleven controls baseline structures (D5.04),
 * ScheduleActivity (D5.28), CostItem (D5.29) and calculation lineage
 * (D11.29).
 *
 * WHAT LIVES HERE AND WHAT DOES NOT. Three things, following the chains.ts
 * precedent exactly:
 *
 *   1. THE VOCABULARIES the spec fixes — the eleven I.8 controls structures,
 *      the I.6 chain links, the §23 cost columns, the scope-growth origins.
 *      They are `as const` so a select box and a database CHECK cannot drift
 *      apart silently; the slice's static test pins each one against the
 *      migration text.
 *
 *   2. THE TYPES for the get_case_controls payload, so a page cannot read a
 *      key the RPC does not return.
 *
 *   3. PURE PRESENTATION HELPERS over that payload — headlines and
 *      groupings. NOT calculations: every controls NUMBER in this slice is
 *      computed in SQL and arrives with a calculation_runs row behind it
 *      (D11.29). A second implementation here would be a number with no
 *      lineage, which is the thing the lineage record exists to make
 *      impossible. `scopeGrowthHeadline` formats a figure the server
 *      computed; it never adds one up.
 *
 * THE REFUSAL IS THE POINT. Every helper here is written so that "nothing
 * recorded" and "nothing wrong" produce DIFFERENT text. A traceability
 * report over an empty case says the chain has not been built; it does not
 * say the chain is complete. A growth figure with no approved baseline is a
 * sentence explaining why there is no figure, not a zero.
 */

/* ────────────────────────── the vocabularies ─────────────────────────── */

/**
 * Spec I.8, verbatim and in the spec's own order: "WBS, CBS, OBS, schedule,
 * cost baseline, progress, commitments, actuals, forecast, changes,
 * contingency." Eleven. The list is rendered in full even where a structure
 * has no home yet — a structure that quietly disappears from the list is a
 * structure nobody remembers to build.
 */
export const CONTROLS_STRUCTURES = [
  { value: "wbs", label: "WBS" },
  { value: "cbs", label: "CBS" },
  { value: "obs", label: "OBS" },
  { value: "schedule", label: "Schedule" },
  { value: "cost_baseline", label: "Cost baseline" },
  { value: "progress", label: "Progress" },
  { value: "commitments", label: "Commitments" },
  { value: "actuals", label: "Actuals" },
  { value: "forecast", label: "Forecast" },
  { value: "changes", label: "Changes" },
  { value: "contingency", label: "Contingency" },
] as const;

export type ControlsStructure = (typeof CONTROLS_STRUCTURES)[number]["value"];

/**
 * Spec I.6's chain, in the spec's own order. Two links carry no home in this
 * slice and say so — see the ruling in migration 20261130090000.
 */
export const SCOPE_CHAIN_LINKS = [
  "business need",
  "requirement",
  "system",
  "WBS",
  "work package",
  "contract",
  "schedule activity",
  "cost",
  "control account",
] as const;

/** project_cbs_codes.cost_type — pinned against the migration CHECK. */
export const CBS_COST_TYPES = [
  { value: "labour", label: "Labour" },
  { value: "material", label: "Material" },
  { value: "equipment", label: "Equipment" },
  { value: "subcontract", label: "Subcontract" },
  { value: "indirect", label: "Indirect" },
  { value: "owner_cost", label: "Owner cost" },
  { value: "contingency", label: "Contingency" },
  { value: "escalation", label: "Escalation" },
] as const;

/** project_scope_changes.origin — why scope arrived after the baseline. */
export const SCOPE_CHANGE_ORIGINS = [
  { value: "design_development", label: "Design development" },
  { value: "regulatory", label: "Regulatory" },
  { value: "stakeholder_commitment", label: "Stakeholder commitment" },
  { value: "error_correction", label: "Error correction" },
  { value: "field_condition", label: "Field condition" },
  { value: "owner_request", label: "Owner request" },
  { value: "risk_treatment", label: "Risk treatment" },
  { value: "interface", label: "Interface" },
] as const;

/** GateRequirement's eight tiers, reused for a business need's provenance. */
export const NEED_SOURCE_AUTHORITIES = [
  "LAW",
  "REGULATION",
  "CORPORATE_STANDARD",
  "PROJECT_FRAMEWORK",
  "CONTRACT",
  "INDUSTRY_GUIDANCE",
  "BEST_PRACTICE",
  "AI_SUGGESTION",
] as const;

/** Spec §23's five money columns on a CostItem, in the spec's order. */
export const COST_ITEM_AMOUNTS = [
  { key: "baselineCost", field: "baseline_cost", label: "Baseline" },
  { key: "commitment", field: "commitment", label: "Commitment" },
  { key: "actual", field: "actual", label: "Actual" },
  { key: "forecast", field: "forecast", label: "Forecast" },
  { key: "contingency", field: "contingency", label: "Contingency" },
] as const;

/**
 * The code identity recorded on every Slice 4A calculation run.
 *
 * MIRRORS sync_calculation_code_version() in migration 20261130090600 and is
 * pinned against it by the slice test. The SERVER stamps the version on the
 * row — a caller-supplied version would certify nothing — and this constant
 * exists so the surface can say WHICH code version it is showing you, and so
 * a bump that lands on one side only fails CI instead of shipping.
 */
export const CONTROLS_CALC_VERSION = "develop-controls/4A/2026-11-24";

/* ─────────────────────── get_case_controls payload ───────────────────── */

export interface ScopeNeed {
  id: string;
  needRef: string;
  statement: string;
  sourceAuthority: string;
  status: string;
  owner: string | null;
  requirementCount: number;
}

export interface WbsElement {
  id: string;
  wbsCode: string;
  title: string;
  scopeDescription: string;
  depth: number;
  parentWbsCode: string | null;
  systemNode: string | null;
  requirementCount: number;
  activityCount: number;
  costItemCount: number;
  controlAccountRef: string | null;
}

export interface CbsCode {
  id: string;
  cbsCode: string;
  title: string;
  costType: string;
}

export interface ControlAccount {
  id: string;
  controlAccountRef: string;
  wbsCode: string | null;
  cbsCode: string | null;
  accountableOwner: string | null;
  orgNode: string | null;
  costItemCount: number;
}

export interface CostItem {
  id: string;
  costItemRef: string;
  description: string;
  wbsCode: string | null;
  cbsCode: string | null;
  controlAccountRef: string | null;
  currency: string;
  baselineCost: number | null;
  commitment: number | null;
  actual: number | null;
  forecast: number | null;
  contingency: number | null;
  contingencyBasis: string | null;
  basis: string;
  sourceSystem: string | null;
}

export interface ScheduleActivityRow {
  id: number;
  activityKey: string;
  label: string;
  /** 'imported' (P6 owns it) or 'local' (Sync authored it). */
  origin: string;
  sourceSystem: string | null;
  durationHours: number | null;
  plannedStart: string | null;
  plannedFinish: string | null;
  calendarName: string | null;
  /** The verbatim P6 string, never interpreted by the import. */
  wbsPath: string | null;
  /** The resolved element, or null — an activity with no authorized scope. */
  wbsCode: string | null;
  schedule: string;
}

export interface ChainLinkState {
  link: string;
  home: string;
  built: boolean;
  count: number | null;
  /** Present exactly on the links this slice does not build. */
  deferral?: string;
  /**
   * True on a link a WBS element may legitimately not have. A count of 0 on
   * an optional link is not a gap and there is no gap class for it, so the
   * chip must not read like a hole.
   */
  optional?: boolean;
}

export interface ScopeTraceability {
  caseId: string;
  chain: ChainLinkState[];
  forwardGaps: {
    needsWithoutRequirement: {
      needId: string;
      needRef: string;
      statement: string;
      sourceAuthority: string;
      owner: string | null;
    }[];
    requirementsWithoutWbs: {
      requirementId: number;
      requirementRef: string;
      category: string;
      requirement: string;
      verificationStatus: string;
      needRef: string | null;
    }[];
    wbsElementsWithoutControlAccount: {
      wbsElementId: string;
      wbsCode: string;
      title: string;
      depth: number;
    }[];
  };
  orphans: {
    requirementsWithoutNeed: {
      requirementId: number;
      requirementRef: string;
      category: string;
      requirement: string;
      source: string;
      /** Set when the need exists but was WITHDRAWN — a different story. */
      withdrawnNeedRef?: string | null;
    }[];
    wbsElementsWithoutRequirement: {
      wbsElementId: string;
      wbsCode: string;
      title: string;
      scopeDescription: string;
    }[];
    scheduleActivitiesWithoutScope: {
      activityId: number;
      activityKey: string;
      label: string;
      origin: string;
      sourceSystem: string | null;
      wbsPath: string | null;
      schedule: string;
      durationHours: number | null;
    }[];
    costItemsOutsideAControlAccount: {
      costItemId: string;
      costItemRef: string;
      description: string;
      wbsCode: string | null;
      baselineCost: number | null;
      forecast: number | null;
      currency: string;
    }[];
  };
  totals: {
    needs: number;
    requirements: number;
    wbsElements: number;
    scheduleActivities: number;
    costItems: number;
  };
  brokenLinkCount: number;
  /** Null — never 100, never 0 — when the denominator is empty. */
  requirementsTracedPct: number | null;
  activitiesWithScopePct: number | null;
}

export interface ControlsBaselineStructure {
  structure: ControlsStructure;
  home: string;
  currentCount: number | null;
  /** Named reason this structure cannot be baselined at all, or null. */
  refusal: string | null;
  baselined: boolean;
  baseline: {
    baselineId: string;
    baselineType: string;
    version: number;
    approvedAt: string;
    capturedAt: string;
    capturedBy: string | null;
    /**
     * When the structure's rows last moved, as at capture time. The capture
     * act refuses if this is after approvedAt, so a capture always describes
     * the approval instant rather than the moment the button was pressed.
     */
    structureLastChangedAt: string | null;
    elementCount: number;
  } | null;
  /** Null until something was captured — not false. */
  drifted: boolean | null;
  driftDetail: string | null;
}

export interface ControlsBaseline {
  caseId: string;
  structures: ControlsBaselineStructure[];
  structureCount: number;
  capturedCount: number;
  driftedCount: number;
  baselineComplete: boolean | null;
}

export interface ScopeGrowthAddition {
  id: string;
  changeRef: string;
  description: string;
  origin: string;
  addedAt: string;
  wbsCode: string | null;
  costEffect: number | null;
  costBasis: string | null;
  currency: string;
  approvedChangeRef: string | null;
  recordedBy: string | null;
}

export interface ScopeGrowth {
  caseId: string;
  evaluable: boolean;
  /** Present exactly when evaluable is false. */
  refusal?: string;
  baseline?: {
    id: string;
    version: number;
    approvedAt: string;
    approvedBy: string | null;
    description: string;
  };
  additionCount?: number;
  costTotal?: number | null;
  /**
   * Why there is no total, when there is none: nothing costed, or additions
   * in more than one currency. Never a zero standing in for either.
   */
  costTotalRefusal?: string | null;
  /** Null whenever costTotal is null — a bare number has no unit. */
  currency?: string | null;
  approvedCostTotal?: number | null;
  unapprovedCostTotal?: number | null;
  uncostedCount?: number;
  unapprovedCount?: number;
  byOrigin?: Record<
    string,
    { count: number; costed: number; costTotal: number | null }
  >;
  additions?: ScopeGrowthAddition[];
  /**
   * Everything attributed to a SUPERSEDED version of this case's scope
   * baseline. Not in the headline (it was folded into the current version
   * when that was approved) and never dropped, so re-baselining cannot make
   * recorded growth disappear.
   */
  priorBaselines?: {
    additionCount: number;
    costTotal: number | null;
    versions: {
      baselineId: string;
      version: number;
      status: string;
      approvedAt: string | null;
      additionCount: number;
      costTotal: number | null;
      uncostedCount: number;
    }[];
  };
  caveats?: string[];
  calculationRunId?: string;
  codeVersion?: string;
}

export interface CostReconciliation {
  caseId: string;
  lineCount: number;
  baselinedLineCount: number;
  lineBaselineTotal: number | null;
  linesOutsideAControlAccount: number;
  businessCaseRef: string | null;
  businessCaseCapital: number | null;
  /** The option the capital figure came from, named so a reader can see it. */
  optionId: number | null;
  optionLabel: string | null;
  /** Null when the lines are not addable — never borrowed from one row. */
  currency: string | null;
  variance: number | null;
  /** Null when either side is missing — never "false" for an absent side. */
  reconciles: boolean | null;
  refusals: string[];
  calculationRunId?: string;
  codeVersion?: string;
}

export interface CalculationRun {
  id: string;
  calculationKey: string;
  method: string;
  codeVersion: string;
  inputs: Record<string, unknown>;
  inputRefs: { table: string; id: string }[];
  outputs: Record<string, unknown> | null;
  refusals: string[];
  status: "computed" | "computed_with_refusals" | "refused";
  computedAt: string;
  computedBy: string | null;
}

export interface CaseControls {
  caseId: string;
  caseTitle: string;
  needs: ScopeNeed[];
  wbs: WbsElement[];
  cbs: CbsCode[];
  controlAccounts: ControlAccount[];
  costItems: CostItem[];
  scheduleActivities: ScheduleActivityRow[];
  /**
   * The five-level tree's system nodes inside this tenant. The organizations
   * RLS policy exposes only the caller's own root row, so the definer read
   * supplies them — without which the chain's System link is reported as
   * built and is unreachable from the product.
   */
  systemNodes: { id: string; name: string }[];
  traceability: ScopeTraceability;
  controlsBaseline: ControlsBaseline;
  scopeGrowth: ScopeGrowth;
  costReconciliation: CostReconciliation;
  latestCalculations: Record<string, CalculationRun | undefined>;
  notInThisSlice: string[];
}

/* ────────────────────────── presentation helpers ─────────────────────── */

/**
 * The one-line verdict the traceability report opens with (D5.02).
 *
 * "Nothing recorded" and "nothing broken" are DIFFERENT sentences. An empty
 * case returning "the chain is complete" is the tidy-tree failure the row
 * exists to prevent.
 */
export function traceabilityHeadline(trace: ScopeTraceability): string {
  const { needs, requirements, wbsElements } = trace.totals;
  if (needs === 0 && requirements === 0 && wbsElements === 0) {
    return "No scope architecture is recorded on this case yet — there is no chain to check, which is not the same as a chain with no gaps.";
  }
  if (trace.brokenLinkCount === 0) {
    return `Every recorded link joins: ${needs} need(s) → ${requirements} requirement(s) → ${wbsElements} WBS element(s), each reaching a control account.`;
  }
  return `${trace.brokenLinkCount} break(s) in the scope chain: the report below names each one and which direction it fails in.`;
}

/** A money figure ALWAYS carries its unit, or it is not rendered as money. */
export function formatMoney(
  value: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (value == null) return "not stated";
  if (currency == null || currency.trim() === "") {
    // A bare number under no unit is the fabricated figure this slice
    // exists not to print.
    return `${new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 }).format(value)} (currency not established)`;
  }
  return `${new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 }).format(value)} ${currency}`;
}

/**
 * The spec's own scope-growth sentence (I.6), or the refusal that replaces
 * it — rendered from a RECORDED RUN, never from the live read.
 *
 * The read path (get_case_scope_growth, embedded in get_case_controls)
 * records nothing, so a figure taken from it would be a money number with no
 * lineage sitting under a lineage block describing a different, older run.
 * The run's outputs carry the figure AND its currency, so the number and its
 * defence cannot disagree.
 */
export function scopeGrowthHeadline(
  growth: ScopeGrowth,
  run?: CalculationRun,
): string {
  if (!growth.evaluable) {
    return growth.refusal ?? "Scope growth is not evaluable on this case.";
  }
  const outputs = scopeGrowthOutputs(run);
  if (outputs == null) {
    return "No scope-growth calculation has been recorded for this case yet, so no figure is shown. The additions below are the recorded rows; press Compute and record to produce the figure they add up to, with its lineage.";
  }
  if (outputs.additionCount === 0) {
    return "No scope has been attributed to this baseline yet. That is zero recorded additions, not a measured zero.";
  }
  if (outputs.costTotal == null) {
    return (
      growth.costTotalRefusal ??
      `${outputs.additionCount} scope addition(s) since the baseline and no addable total — so there is a count, not a figure.`
    );
  }
  const uncosted = outputs.uncostedCount ?? 0;
  const tail =
    uncosted > 0
      ? `, with ${uncosted} further addition(s) not yet costed and therefore not in that figure`
      : "";
  return `${formatMoney(outputs.costTotal, outputs.currency)} of cost is associated with scope added after the baseline was approved${tail}.`;
}

/** The reconciliation sentence, likewise from the recorded run alone. */
export function costReconciliationHeadline(
  run?: CalculationRun,
): string | null {
  const outputs = costReconciliationOutputs(run);
  if (outputs == null || outputs.reconciles == null) return null;
  const left = formatMoney(outputs.lineBaselineTotal, outputs.currency);
  const right = formatMoney(outputs.businessCaseCapital, outputs.currency);
  const ref = outputs.businessCaseRef ? ` (${outputs.businessCaseRef}` : "";
  const option = outputs.optionLabel ? `, option "${outputs.optionLabel}"` : "";
  const close = ref ? `${option})` : "";
  const verdict = outputs.reconciles
    ? "they agree"
    : `variance ${formatMoney(outputs.variance, outputs.currency)}`;
  return `${left} of coded lines against ${right} of business-case capital${ref}${close} — ${verdict}.`;
}

/** Outputs of a recorded case_scope_growth run, or null if there is none. */
export function scopeGrowthOutputs(run: CalculationRun | undefined): {
  costTotal: number | null;
  currency: string | null;
  additionCount: number;
  uncostedCount: number;
} | null {
  if (!hasDisplayableOutputs(run)) return null;
  const o = run.outputs as Record<string, unknown>;
  return {
    costTotal: typeof o.costTotal === "number" ? o.costTotal : null,
    currency: typeof o.currency === "string" ? o.currency : null,
    additionCount: typeof o.additionCount === "number" ? o.additionCount : 0,
    uncostedCount: typeof o.uncostedCount === "number" ? o.uncostedCount : 0,
  };
}

/** Outputs of a recorded case_cost_reconciliation run, or null. */
export function costReconciliationOutputs(run: CalculationRun | undefined): {
  lineBaselineTotal: number | null;
  businessCaseCapital: number | null;
  currency: string | null;
  businessCaseRef: string | null;
  optionLabel: string | null;
  variance: number | null;
  reconciles: boolean | null;
} | null {
  if (!hasDisplayableOutputs(run)) return null;
  const o = run.outputs as Record<string, unknown>;
  return {
    lineBaselineTotal:
      typeof o.lineBaselineTotal === "number" ? o.lineBaselineTotal : null,
    businessCaseCapital:
      typeof o.businessCaseCapital === "number" ? o.businessCaseCapital : null,
    currency: typeof o.currency === "string" ? o.currency : null,
    businessCaseRef:
      typeof o.businessCaseRef === "string" ? o.businessCaseRef : null,
    optionLabel: typeof o.optionLabel === "string" ? o.optionLabel : null,
    variance: typeof o.variance === "number" ? o.variance : null,
    reconciles: typeof o.reconciles === "boolean" ? o.reconciles : null,
  };
}

/**
 * Has the world moved since this run was recorded?
 *
 * A recorded figure stays defensible for ever, but it stops being CURRENT the
 * moment its inputs change — and a page that shows a run's number beside
 * today's rows, with no word about the gap, is showing two different answers
 * to one question. The run records the same fingerprint the live read
 * produces, so this is a comparison rather than a second calculation.
 */
export function runIsStale(
  run: CalculationRun | undefined,
  current: Record<string, unknown>,
): boolean {
  if (run == null) return false;
  for (const [key, value] of Object.entries(current)) {
    if (!(key in run.inputs)) continue;
    const recorded = run.inputs[key];
    if (JSON.stringify(recorded ?? null) !== JSON.stringify(value ?? null)) {
      return true;
    }
  }
  return false;
}

/** The live fingerprint of the scope-growth inputs, for runIsStale. */
export function scopeGrowthFingerprint(
  growth: ScopeGrowth,
  trace: ScopeTraceability,
): Record<string, unknown> {
  return {
    baselineId: growth.baseline?.id ?? null,
    baselineVersion: growth.baseline?.version ?? null,
    additionCount: growth.additionCount ?? 0,
    uncostedCount: growth.uncostedCount ?? 0,
    brokenScopeLinks: trace.brokenLinkCount,
  };
}

/** The live fingerprint of the cost-reconciliation inputs. */
export function costReconciliationFingerprint(
  recon: CostReconciliation,
): Record<string, unknown> {
  return {
    lineCount: recon.lineCount,
    baselinedLineCount: recon.baselinedLineCount,
    businessCaseRef: recon.businessCaseRef,
    linesOutsideAControlAccount: recon.linesOutsideAControlAccount,
  };
}

/**
 * Whether a controls number may be displayed at all.
 *
 * A run that REFUSED has no outputs, and rendering a blank where a number
 * belongs is how a refusal becomes an implied zero. Callers use this to
 * choose between "show the figure" and "show why there isn't one".
 */
export function hasDisplayableOutputs(
  run: CalculationRun | undefined,
): run is CalculationRun & { outputs: Record<string, unknown> } {
  return run != null && run.outputs != null && run.status !== "refused";
}

/**
 * The activities D5.02 flags, split by who owns them.
 *
 * An uncoded P6 activity and an uncoded Sync-authored one are different
 * conversations: the first is resolved by mapping a wbs_path somebody else
 * wrote, the second by coding scope we authored ourselves. A single count
 * hides which conversation you are in.
 */
export function uncodedActivitiesByOrigin(trace: ScopeTraceability): {
  imported: number;
  local: number;
} {
  const rows = trace.orphans.scheduleActivitiesWithoutScope;
  return {
    imported: rows.filter((r) => r.origin === "imported").length,
    local: rows.filter((r) => r.origin === "local").length,
  };
}

/**
 * The structures that can be baselined right now: a home exists and it holds
 * something. A structure carrying a refusal is deliberately excluded — the
 * screen offers the act only where the act would succeed, and shows the
 * refusal where it would not.
 */
export function capturableStructures(
  baseline: ControlsBaseline,
): ControlsBaselineStructure[] {
  return baseline.structures.filter(
    (s) => s.refusal == null && !s.baselined && (s.currentCount ?? 0) > 0,
  );
}

/** The structures whose contents moved after they were fixed. */
export function driftedStructures(
  baseline: ControlsBaseline,
): ControlsBaselineStructure[] {
  return baseline.structures.filter((s) => s.drifted === true);
}

/**
 * The sentence an EMPTY gap list gets.
 *
 * "Every requirement is delivered by at least one WBS element" over a case
 * with zero requirements is reassurance about an empty set — the vacuous
 * truth that makes a gap report worth ignoring. Nothing recorded and nothing
 * wrong get different words, which is this module's whole rule applied one
 * level down.
 */
export function emptyGapSentence(
  denominator: number,
  nothingRecorded: string,
  nothingWrong: string,
): string {
  return denominator === 0 ? nothingRecorded : nothingWrong;
}
