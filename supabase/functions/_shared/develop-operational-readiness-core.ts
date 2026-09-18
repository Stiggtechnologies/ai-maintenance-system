// Deterministic half of D12.14. It explains the adopted Operational
// Readiness Index without changing, completing or accepting any record.

export interface OperationalReadinessAgentView {
  caseId: string;
  readinessStore: string;
  decisionBoundary?: string;
  profiles?: Array<{
    profileId: string;
    version: number;
    status: "draft" | "adopted" | "superseded";
    evidenceItemId: string;
  }>;
  calculation: {
    refusal?: "no_adopted_profile" | "missing_factor_inputs";
    error?: string;
    missingFactors?: string[];
    index?: number;
    status?: "BLOCKED" | "READY" | "NOT_READY";
    hardBlockerCount?: number;
    hardBlockers?: Array<{
      systemId: number;
      systemRef: string;
      itemId: string;
      assetId: string;
      asset: string;
      assetTag: string | null;
      requirementKey: string;
      item: string;
      category: string;
      status: string;
      kind: "safety_mission_critical" | "profile_hard_condition";
    }>;
    factors?: Array<{
      key: string;
      weight: number;
      categories: string[];
      satisfied?: number;
      total?: number;
      percent?: number | null;
    }>;
    profileId?: string;
    profileVersion?: number;
    evidenceItemId?: string;
  };
}

export interface OperationalReadinessAgentAnalysis {
  answer: "yes" | "no" | "not_assessable";
  headline: string;
  index: number | null;
  status: "BLOCKED" | "READY" | "NOT_READY" | "NOT_ASSESSABLE";
  profileVersion: number | null;
  factorFindings: Array<{
    key: string;
    percent: number | null;
    satisfied: number;
    total: number;
    weight: number;
    sourceRefs: string[];
  }>;
  blockers: Array<{
    systemRef: string;
    asset: string;
    assetTag: string | null;
    item: string;
    category: string;
    kind: string;
    sourceRefs: string[];
  }>;
  evidenceRefs: string[];
  limitations: string[];
}

function unique(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

export function analyzeOperationalReadiness(
  view: OperationalReadinessAgentView,
): OperationalReadinessAgentAnalysis {
  const calculation = view.calculation ?? {};
  const refusal = calculation.refusal;
  const factors = calculation.factors ?? [];
  const blockers = calculation.hardBlockers ?? [];
  const adoptedProfile = view.profiles?.find(
    (profile) => profile.status === "adopted",
  );
  const assessable =
    !refusal && calculation.index != null && calculation.status != null;
  const status = assessable ? calculation.status! : "NOT_ASSESSABLE";
  const answer = !assessable
    ? "not_assessable"
    : status === "READY"
      ? "yes"
      : "no";
  const headline =
    answer === "yes"
      ? `Yes on the current governed record: the Operational Readiness Index is ${calculation.index}% and no adopted hard condition is open. Human handover acceptance is still required.`
      : answer === "no"
        ? status === "BLOCKED"
          ? `No on the current governed record: the Operational Readiness Index is ${calculation.index}% and the deterministic status is BLOCKED. ${blockers.length} named hard blocker(s) remain.`
          : `No on the current governed record: the Operational Readiness Index is ${calculation.index}% and the deterministic status is NOT_READY. No hard condition is open, but one or more weighted factors remain incomplete.`
        : `Operational ownership tomorrow is not assessable: ${calculation.error ?? "the governed index has no usable calculation"}`;

  const factorFindings = factors.map((factor) => ({
    key: factor.key,
    percent: factor.percent ?? null,
    satisfied: Number(factor.satisfied ?? 0),
    total: Number(factor.total ?? 0),
    weight: Number(factor.weight),
    sourceRefs: [
      `development_cases:${view.caseId}`,
      `readiness_store:${view.readinessStore}`,
    ],
  }));
  const blockerFindings = blockers.map((blocker) => ({
    systemRef: blocker.systemRef,
    asset: blocker.asset,
    assetTag: blocker.assetTag,
    item: blocker.item,
    category: blocker.category,
    kind: blocker.kind,
    sourceRefs: [
      `commissioning_systems:${blocker.systemId}`,
      `asset_onboarding_items:${blocker.itemId}`,
      `assets:${blocker.assetId}`,
    ],
  }));
  const evidenceRefs = unique([
    `development_cases:${view.caseId}`,
    (calculation.profileId ?? adoptedProfile?.profileId)
      ? `operational_readiness_index_profiles:${calculation.profileId ?? adoptedProfile?.profileId}`
      : null,
    (calculation.evidenceItemId ?? adoptedProfile?.evidenceItemId)
      ? `evidence_items:${calculation.evidenceItemId ?? adoptedProfile?.evidenceItemId}`
      : null,
    ...blockerFindings.flatMap((blocker) => blocker.sourceRefs),
  ]);
  const limitations = refusal
    ? [
        calculation.error ??
          "The Operational Readiness Index refused calculation.",
        ...(calculation.missingFactors?.length
          ? [
              `Missing scoped factor inputs: ${calculation.missingFactors.join(", ")}.`,
            ]
          : []),
      ]
    : [
        "The index reflects the current recorded and evidenced scope; unrecorded conditions are not proof of readiness.",
        "READY is advisory and does not accept handover, approve go-live, authorize energization, or close a readiness item.",
      ];

  return {
    answer,
    headline,
    index: calculation.index ?? null,
    status,
    profileVersion:
      calculation.profileVersion ?? adoptedProfile?.version ?? null,
    factorFindings,
    blockers: blockerFindings,
    evidenceRefs,
    limitations,
  };
}
