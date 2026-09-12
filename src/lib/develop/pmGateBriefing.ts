import type { GateReviewPack } from "../../services/developService";
import type { ReadinessBlocker } from "./index";

export interface BriefingMeasure {
  label: string;
  value: string;
  explanation: string;
  recordRefs: string[];
}

export interface BriefingBlocker {
  label: string;
  name: string;
  recordRef: string;
}

export interface PmGateBriefing {
  headline: string;
  position: "blocked" | "not_blocked" | "undefined";
  measures: BriefingMeasure[];
  blockers: BriefingBlocker[];
  projection: {
    value: string;
    explanation: string;
    recordRefs: string[];
  };
  decisionBoundary: string;
}

const BLOCKER_LABEL = {
  mandatory_criterion: "Mandatory requirement",
  open_risk: "Unresolved risk",
  open_condition: "Open gate condition",
  success_contract: "Missing success contract",
  regulatory_condition: "Permit condition",
  uncovered_commitment: "Uncovered commitment",
  assurance_not_satisfied: "Independent assurance",
  frontline_finding_open: "Open frontline recommendation",
  frontline_acceptance_uncarried: "Uncarried frontline acceptance",
  frontline_acceptance_carried_by_failed_requirement:
    "Failed carrier requirement",
  frontline_review_unattended: "Unattended design review",
  procurement_package_unawarded: "Unawarded procurement package",
  procurement_package_late: "Late procurement package",
  procurement_package_contract_late: "Late awarded contract",
} satisfies Record<ReadinessBlocker["type"], string>;

const BLOCKER_SOURCE = {
  mandatory_criterion: "stage_gate_criteria",
  open_risk: "risks",
  open_condition: "gate_conditions",
  success_contract: "development_cases",
  regulatory_condition: "regulatory_conditions",
  uncovered_commitment: "stakeholder_commitments",
  assurance_not_satisfied: "stage_gates",
  frontline_finding_open: "design_review_findings",
  frontline_acceptance_uncarried: "design_review_findings",
  frontline_acceptance_carried_by_failed_requirement: "design_review_findings",
  frontline_review_unattended: "design_studies",
  procurement_package_unawarded: "contract_packages",
  procurement_package_late: "contract_packages",
  procurement_package_contract_late: "contract_packages",
} satisfies Record<ReadinessBlocker["type"], string>;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function criterionRefs(pack: GateReviewPack): string[] {
  return pack.readiness.criteria.map((row) => `stage_gate_criteria:${row.id}`);
}

function latestReviewRef(pack: GateReviewPack): string[] {
  return pack.readiness.latestReview
    ? [`stage_gate_reviews:${pack.readiness.latestReview.id}`]
    : [];
}

/**
 * PM composition only. It performs no readiness, blocker, evidence, assurance,
 * or projection calculation; all values are copied from get_gate_review_pack.
 */
export function buildPmGateBriefing(pack: GateReviewPack): PmGateBriefing {
  const readiness = pack.readiness;
  const baseRefs = [
    `development_cases:${pack.caseId}`,
    `stage_gates:${pack.gateId}`,
  ];
  const criteria = criterionRefs(pack);
  const review = latestReviewRef(pack);
  const position =
    readiness.readinessPct == null
      ? "undefined"
      : readiness.blocked
        ? "blocked"
        : "not_blocked";

  const readinessValue =
    readiness.readinessPct == null
      ? "Not available"
      : `${readiness.readinessPct}%`;
  const headline =
    position === "undefined"
      ? `${pack.gateName}: readiness is not defined because this gate has no weighted requirements.`
      : position === "blocked"
        ? `${pack.gateName}: BLOCKED at ${readinessValue}.`
        : `${pack.gateName}: no deterministic blocker is recorded at ${readinessValue}.`;

  const blockers = readiness.blockers.map((blocker) => {
    const source = BLOCKER_SOURCE[blocker.type];
    return {
      label: BLOCKER_LABEL[blocker.type],
      name: blocker.name,
      recordRef: `${source}:${blocker.id}`,
    };
  });

  const projectionRefs = unique([...baseRefs, ...criteria, ...review]);
  const projection = readiness.projection;
  const projectionView =
    projection.available && projection.projectedDate
      ? {
          value: projection.projectedDate,
          explanation:
            "The governed evaluator projected this date from recorded criterion closures. It is a forecast, not a commitment.",
          recordRefs: projectionRefs,
        }
      : {
          value: "Not defensible yet",
          explanation:
            projection.reason ??
            "The governed evaluator returned no defensible closure-rate projection.",
          recordRefs: projectionRefs,
        };

  return {
    headline,
    position,
    measures: [
      {
        label: "Gate readiness",
        value: readinessValue,
        explanation:
          readiness.readinessPct == null
            ? "No weighted requirements exist, so zero percent would be misleading."
            : "Weighted result returned by the same evaluator used by the gate workflow.",
        recordRefs: unique([...baseRefs, ...criteria, ...review]),
      },
      {
        label: "Mandatory requirements",
        value: `${readiness.mandatoryMet} of ${readiness.mandatoryTotal} met`,
        explanation: "Latest recorded finding for every mandatory criterion.",
        recordRefs: unique([
          ...baseRefs,
          ...readiness.criteria
            .filter((row) => row.isMandatory)
            .map((row) => `stage_gate_criteria:${row.id}`),
          ...review,
        ]),
      },
      {
        label: "Evidence review",
        value: "Open record trail",
        explanation:
          "Linked evidence is shown for review; evidence status cannot move the readiness score.",
        recordRefs: unique([
          ...baseRefs,
          ...pack.requirements.flatMap((row) =>
            row.assembled.evidence.map(
              (evidence) => `evidence_items:${evidence.id}`,
            ),
          ),
        ]),
      },
      {
        label: "Decision authority",
        value: pack.sod.mayRecord ? "Eligible to record" : "Not eligible",
        explanation:
          "The database rechecks segregation of duties when a decision is recorded.",
        recordRefs: unique([...baseRefs, ...review]),
      },
    ],
    blockers,
    projection: projectionView,
    decisionBoundary:
      "This briefing is advisory. ‘Not blocked’ is not approval, and no percentage or forecast can pass the gate. A named eligible human must review the evidence and record the decision separately.",
  };
}
