import type { CaseControls } from "./controls";

export type ScopeCreepFlagKind =
  | "unapproved_addition"
  | "baseline_drift"
  | "uncosted_addition"
  | "not_assessable";

export interface ScopeCreepFlag {
  kind: ScopeCreepFlagKind;
  classification: "potential_scope_creep" | "evidence_gap";
  title: string;
  detail: string;
  sourceRefs: string[];
}

export interface ScopeCreepCaseResult {
  caseId: string;
  caseTitle: string;
  status: string;
  flags: ScopeCreepFlag[];
  potentialScopeCreepCount: number;
  evidenceGapCount: number;
}

export interface ScopeCreepDetectionResult {
  cases: ScopeCreepCaseResult[];
  reviewedCaseCount: number;
  flaggedCaseCount: number;
  method: string;
  limitations: string[];
  decisionBoundary: string;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function detectCaseScopeCreep(input: {
  caseId: string;
  caseTitle: string;
  status: string;
  controls: CaseControls;
}): ScopeCreepCaseResult {
  const flags: ScopeCreepFlag[] = [];
  const growth = input.controls.scopeGrowth;

  if (!growth.evaluable) {
    flags.push({
      kind: "not_assessable",
      classification: "evidence_gap",
      title: "Scope movement is not assessable",
      detail:
        growth.refusal ??
        "No approved scope baseline is available as the comparison reference.",
      sourceRefs: [`development_cases:${input.caseId}`],
    });
  } else {
    for (const addition of growth.additions ?? []) {
      const refs = [
        `project_scope_changes:${addition.id}`,
        ...(growth.baseline?.id
          ? [`development_baselines:${growth.baseline.id}`]
          : []),
      ];
      if (!addition.approvedChangeRef) {
        flags.push({
          kind: "unapproved_addition",
          classification: "potential_scope_creep",
          title: "Post-baseline scope has no approved change reference",
          detail: `${addition.changeRef}: ${addition.description}`,
          sourceRefs: refs,
        });
      }
      if (addition.costEffect == null) {
        flags.push({
          kind: "uncosted_addition",
          classification: "evidence_gap",
          title: "Post-baseline scope is not costed",
          detail: `${addition.changeRef} has no recorded cost effect; financial exposure is unknown.`,
          sourceRefs: refs,
        });
      }
    }
  }

  for (const structure of input.controls.controlsBaseline.structures) {
    if (structure.drifted !== true) continue;
    flags.push({
      kind: "baseline_drift",
      classification: "potential_scope_creep",
      title: `${structure.structure.toUpperCase()} structure moved after baseline capture`,
      detail:
        structure.driftDetail ??
        "The current structure differs from its approved-baseline capture.",
      sourceRefs: unique([
        ...(structure.baseline?.baselineId
          ? [`development_baselines:${structure.baseline.baselineId}`]
          : []),
        `${structure.home}:${input.caseId}`,
      ]),
    });
  }

  flags.sort((left, right) => {
    const leftOrder = left.classification === "potential_scope_creep" ? 0 : 1;
    const rightOrder = right.classification === "potential_scope_creep" ? 0 : 1;
    return leftOrder - rightOrder || left.title.localeCompare(right.title);
  });

  return {
    caseId: input.caseId,
    caseTitle: input.caseTitle,
    status: input.status,
    flags,
    potentialScopeCreepCount: flags.filter(
      (flag) => flag.classification === "potential_scope_creep",
    ).length,
    evidenceGapCount: flags.filter(
      (flag) => flag.classification === "evidence_gap",
    ).length,
  };
}

export function buildScopeCreepDetection(
  cases: Array<{
    caseId: string;
    caseTitle: string;
    status: string;
    controls: CaseControls;
  }>,
): ScopeCreepDetectionResult {
  const results = cases
    .map((item) => detectCaseScopeCreep(item))
    .filter((item) => item.flags.length > 0)
    .sort(
      (left, right) =>
        right.potentialScopeCreepCount - left.potentialScopeCreepCount ||
        right.evidenceGapCount - left.evidenceGapCount ||
        left.caseTitle.localeCompare(right.caseTitle),
    );

  return {
    cases: results,
    reviewedCaseCount: cases.length,
    flaggedCaseCount: results.length,
    method:
      "Deterministic flags compare current canonical controls records with the approved scope baseline: post-baseline additions without an approved change reference and captured WBS/CBS/control-account drift are potential scope creep; missing baselines and costs are evidence gaps.",
    limitations: [
      "A flag is a prompt for investigation, not a determination that contractual or project scope changed.",
      "No flag is not proof that scope is stable; unrecorded changes cannot be detected from repository evidence.",
      "Approved change references show governance linkage, not that the change was economically beneficial or correctly implemented.",
    ],
    decisionBoundary:
      "Only a named human may determine scope change, approve a change request, move a baseline, authorize funding or direct work through the existing governed controls.",
  };
}
