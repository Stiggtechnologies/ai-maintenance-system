export type PmoFunctionScope = "portfolio" | "case";

export interface PmoFunctionDefinition {
  key:
    | "methodology_governance"
    | "framework_tailoring"
    | "gate_calibration"
    | "portfolio_health"
    | "resource_conflicts"
    | "benchmarking"
    | "performance_trends"
    | "lessons"
    | "assurance"
    | "value_realization";
  label: string;
  purpose: string;
  source: string;
  scope: PmoFunctionScope;
  href: (caseId?: string) => string | null;
}

/** Spec I.31's ten PMO functions, routed to their existing governed owners. */
export const SYNC_PMO_FUNCTIONS: readonly PmoFunctionDefinition[] = [
  {
    key: "methodology_governance",
    label: "Methodology governance",
    purpose:
      "Govern adopted methods, authority bindings and accountable decisions.",
    source: "Adopted framework and governance records",
    scope: "case",
    href: (id) => (id ? `/develop/cases/${id}#governance` : null),
  },
  {
    key: "framework_tailoring",
    label: "Framework tailoring",
    purpose:
      "Tailor lifecycle stages, gates and requirements without bypassing adoption.",
    source: "Framework shelf and human adoption workflow",
    scope: "case",
    href: (id) => (id ? `/develop/cases/${id}#governance` : null),
  },
  {
    key: "gate_calibration",
    label: "Gate calibration",
    purpose:
      "Review gate burden, readiness and recorded outcomes in project context.",
    source: "Gate requirements, reviews and methodology outcomes",
    scope: "case",
    href: (id) => (id ? `/develop/cases/${id}#governance` : null),
  },
  {
    key: "portfolio_health",
    label: "Portfolio health",
    purpose:
      "Inspect current project, gate, forecast, risk, readiness and benefit evidence.",
    source: "Canonical development portfolio composition",
    scope: "portfolio",
    href: () => "#portfolio-health",
  },
  {
    key: "resource_conflicts",
    label: "Resource conflicts",
    purpose:
      "Find collective capacity conflicts individual project views cannot see.",
    source: "Approved demand, capacity and deductions",
    scope: "portfolio",
    href: () => "/sync-field",
  },
  {
    key: "benchmarking",
    label: "Benchmarking",
    purpose:
      "Compare normalized cohorts while refusing weak or incomparable samples.",
    source: "Governed benchmark cohorts and reference classes",
    scope: "portfolio",
    href: () => "/benchmarking",
  },
  {
    key: "performance_trends",
    label: "Performance trends",
    purpose: "Review recorded cost and schedule periods and their lineage.",
    source: "Canonical case performance calculations",
    scope: "case",
    href: (id) => (id ? `/develop/cases/${id}#performance` : null),
  },
  {
    key: "lessons",
    label: "Lessons",
    purpose: "Apply verified lessons and trace them to outcomes and evidence.",
    source: "Project lessons and verified outcome records",
    scope: "case",
    href: (id) => (id ? `/develop/cases/${id}#realize` : null),
  },
  {
    key: "assurance",
    label: "Assurance",
    purpose:
      "Challenge claims against supporting, contradicting and missing evidence.",
    source: "Assurance case and independent review records",
    scope: "case",
    href: (id) => (id ? `/develop/cases/${id}/assurance` : null),
  },
  {
    key: "value_realization",
    label: "Value realization",
    purpose:
      "Compare committed benefits with forecasts and verified actual outcomes.",
    source: "Benefit commitments and value realization records",
    scope: "case",
    href: (id) => (id ? `/develop/cases/${id}#realize` : null),
  },
] as const;

export function resolvePmoFunctionHref(
  definition: PmoFunctionDefinition,
  caseId: string | null,
): string | null {
  return definition.href(caseId ?? undefined);
}
