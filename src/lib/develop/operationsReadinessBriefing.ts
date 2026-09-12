import type {
  CaseSystemHandoverPackages,
  HandoverReadinessDimension,
} from "../../services/handoverPackageService";
import type { SystemOperationalReadinessResult } from "./index";

export interface OperationsBriefingMeasure {
  label: string;
  value: string;
  explanation: string;
  recordRefs: string[];
}

export interface OperationsBriefingSystem {
  systemId: number;
  systemRef: string;
  title: string;
  position:
    | "accepted"
    | "accepted_with_current_gaps"
    | "ready_for_human_acceptance"
    | "blocked";
  positionLabel: string;
  measures: OperationsBriefingMeasure[];
  categoryCoverage: OperationsBriefingMeasure[];
  blockers: string[];
  operationsOwner: string;
  requiredAcceptanceDate: string;
  recordRefs: string[];
}

export interface OperationsReadinessBriefing {
  systems: OperationsBriefingSystem[];
  decisionBoundary: string;
  equipmentReleaseBoundary: string;
  emptyState: string | null;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function dimensionRefs(
  systemId: number,
  dimension: HandoverReadinessDimension,
): string[] {
  return unique([
    `commissioning_systems:${systemId}`,
    `source:${dimension.source}`,
    ...dimension.gaps.flatMap((gap) => [
      gap.itemId ? `asset_onboarding_items:${gap.itemId}` : null,
      gap.testId != null ? `acceptance_tests:${gap.testId}` : null,
      gap.assetId ? `assets:${gap.assetId}` : null,
    ]),
  ]);
}

function measure(
  label: string,
  dimension: HandoverReadinessDimension,
  systemId: number,
): OperationsBriefingMeasure {
  const value =
    dimension.percent == null ? "Not assessed" : `${dimension.percent}%`;
  const explanation =
    dimension.total === 0
      ? `No scoped ${label.toLowerCase()} records were returned. Absence is not treated as readiness.`
      : `${dimension.satisfied} of ${dimension.total} scoped records are evidence-complete; ${dimension.gaps.length} named gap(s) remain.`;
  return {
    label,
    value,
    explanation,
    recordRefs: dimensionRefs(systemId, dimension),
  };
}

/**
 * Presentation-only composition over get_case_system_handover_packages and
 * get_case_system_operational_readiness. It copies the governed readiness
 * dimensions and their refusals/statuses; category percentages group only the
 * latter read's evidenceReady flags. It does not determine acceptance.
 */
export function buildOperationsReadinessBriefing(
  model: CaseSystemHandoverPackages,
  systemReadiness: SystemOperationalReadinessResult,
): OperationsReadinessBriefing {
  return {
    decisionBoundary: model.decisionBoundary,
    equipmentReleaseBoundary: model.equipmentReleaseBoundary,
    emptyState:
      model.systems.length === 0
        ? "No commissioning systems are recorded for this case. Pre-handover readiness cannot be assessed."
        : null,
    systems: model.systems.map((system) => {
      const detail = systemReadiness.systems.find(
        (candidate) => candidate.systemId === system.systemId,
      );
      const categoryCoverage = detail
        ? [...new Set(detail.items.map((item) => item.category))]
            .sort()
            .map((category) => {
              const items = detail.items.filter(
                (item) => item.category === category,
              );
              const satisfied = items.filter(
                (item) => item.evidenceReady,
              ).length;
              return {
                label: category.replaceAll("_", " "),
                value: `${Math.round((1000 * satisfied) / items.length) / 10}%`,
                explanation: `${satisfied} of ${items.length} scoped items carry evidence. This is presentation coverage, not a handover verdict.`,
                recordRefs: unique([
                  `commissioning_systems:${system.systemId}`,
                  ...items.flatMap((item) => [
                    `asset_onboarding_items:${item.itemId}`,
                    `assets:${item.assetId}`,
                    item.evidenceItemId
                      ? `evidence_items:${item.evidenceItemId}`
                      : null,
                  ]),
                ]),
              };
            })
        : [];
      const position =
        system.package?.status === "accepted"
          ? system.readiness.canAccept
            ? "accepted"
            : "accepted_with_current_gaps"
          : system.readiness.canAccept
            ? "ready_for_human_acceptance"
            : "blocked";
      const positionLabel =
        position === "accepted"
          ? "Operations ownership accepted"
          : position === "accepted_with_current_gaps"
            ? "Accepted · current gaps require review"
            : position === "ready_for_human_acceptance"
              ? "Evidence complete — human acceptance required"
              : "Blocked before handover";
      const measures = [
        measure(
          "Physical readiness",
          system.readiness.physicalReadiness,
          system.systemId,
        ),
        measure(
          "Information readiness",
          system.readiness.informationReadiness,
          system.systemId,
        ),
        measure(
          "Operational readiness",
          system.readiness.operationalReadiness,
          system.systemId,
        ),
        {
          label: "Residual risk acceptance",
          value: `${system.readiness.acceptedResidualRiskCount}/${system.readiness.residualRiskCount}`,
          explanation:
            system.readiness.residualRiskCount === 0
              ? "No current case or bound-system-asset risk records were returned. This is not proof that risk is absent."
              : `${system.readiness.acceptedResidualRiskCount} of ${system.readiness.residualRiskCount} current residual risks have an active canonical human acceptance.`,
          recordRefs: unique([
            `commissioning_systems:${system.systemId}`,
            ...system.readiness.residualRisks.map(
              (risk) => `risks:${risk.riskId}`,
            ),
          ]),
        },
      ];
      return {
        systemId: system.systemId,
        systemRef: system.systemRef,
        title: system.title,
        position,
        positionLabel,
        measures,
        categoryCoverage,
        blockers: system.readiness.blockers,
        operationsOwner: system.package?.ownerTo ?? "No operations owner named",
        requiredAcceptanceDate:
          system.package?.requiredAcceptanceDate ?? "Not recorded",
        recordRefs: unique([
          `commissioning_systems:${system.systemId}`,
          system.package
            ? `system_handover_packages:${system.package.id}`
            : null,
          system.package?.preparationEvidenceItemId
            ? `evidence_items:${system.package.preparationEvidenceItemId}`
            : null,
          system.package?.acceptanceEvidenceItemId
            ? `evidence_items:${system.package.acceptanceEvidenceItemId}`
            : null,
        ]),
      };
    }),
  };
}
