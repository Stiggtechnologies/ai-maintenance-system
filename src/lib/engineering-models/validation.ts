import type {
  ApplicabilityAssessment,
  EngineeringModelLifecycleState,
  EngineeringModelPort,
  ModelEvaluationContext,
  ModelPromotionEvidence,
  ModelRefusal,
  PhysicsModelPackManifest,
  VerificationCheckKind,
} from "./types.ts";

const REQUIRED_ARTIFACT_ROLES = [
  "project",
  "requirements",
  "roadmap",
  "state",
  "model",
  "assumptions",
  "conventions",
  "derivation",
  "verification",
  "applicability",
  "manifest",
] as const;

const REQUIRED_VERIFICATION_KINDS: VerificationCheckKind[] = [
  "dimensional",
  "limiting_case",
  "conservation",
  "symmetry",
  "benchmark",
  "numerical_stability",
  "regression",
  "adversarial",
];

const LIFECYCLE_FORWARD: Record<
  Exclude<EngineeringModelLifecycleState, "revalidation_required" | "retired">,
  EngineeringModelLifecycleState[]
> = {
  draft: ["derived"],
  derived: ["verified"],
  verified: ["bench_validated"],
  bench_validated: ["field_validated"],
  field_validated: ["engineering_approved"],
  engineering_approved: ["production_eligible"],
  production_eligible: ["revalidation_required", "retired"],
};

export interface ManifestValidationIssue {
  path: string;
  message: string;
}

function hasText(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  return [
    ...new Set(values.filter((value) => seen.has(value) || !seen.add(value))),
  ];
}

function rangeIsValid(range: EngineeringModelPort["validRange"]): boolean {
  if (!range) return true;
  if (range.min !== undefined && !Number.isFinite(range.min)) return false;
  if (range.max !== undefined && !Number.isFinite(range.max)) return false;
  if (range.min === undefined || range.max === undefined) return true;
  if (range.min > range.max) return false;
  return !(
    range.min === range.max &&
    (range.minInclusive === false || range.maxInclusive === false)
  );
}

export function validatePhysicsModelPack(
  manifest: PhysicsModelPackManifest,
): ManifestValidationIssue[] {
  const issues: ManifestValidationIssue[] = [];
  if (manifest.schemaVersion !== "1.0.0") {
    issues.push({
      path: "schemaVersion",
      message: "Only manifest schema 1.0.0 is accepted.",
    });
  }
  for (const [path, value] of [
    ["modelKey", manifest.modelKey],
    ["version", manifest.version],
    ["name", manifest.name],
    ["description", manifest.description],
    ["domain", manifest.domain],
    ["authoring.toolVersion", manifest.authoring.toolVersion],
    ["authoring.sourceLicense", manifest.authoring.sourceLicense],
    ["authoring.sourceReference", manifest.authoring.sourceReference],
    ["execution.calculationKey", manifest.execution.calculationKey],
    [
      "governance.requiredReviewerCompetency",
      manifest.governance.requiredReviewerCompetency,
    ],
  ] as const) {
    if (!hasText(value)) issues.push({ path, message: `${path} is required.` });
  }
  if (
    manifest.authoring.tool === "gpd" &&
    manifest.authoring.sourceLicense !== "Apache-2.0"
  ) {
    issues.push({
      path: "authoring.sourceLicense",
      message:
        "A GPD-authored pack must preserve its Apache-2.0 source provenance.",
    });
  }
  if (manifest.governance.humanApprovalRequired !== true) {
    issues.push({
      path: "governance.humanApprovalRequired",
      message: "Human approval must remain required.",
    });
  }
  if (manifest.governance.autonomousOperationalActionAllowed !== false) {
    issues.push({
      path: "governance.autonomousOperationalActionAllowed",
      message: "A physics model may not authorize an operational action.",
    });
  }
  if (manifest.governance.thresholdsPolicy !== "approved_source_only") {
    issues.push({
      path: "governance.thresholdsPolicy",
      message: "Thresholds must come from approved sources.",
    });
  }
  if (!manifest.governance.sourceRightsConfirmed) {
    issues.push({
      path: "governance.sourceRightsConfirmed",
      message: "Source usage rights must be confirmed.",
    });
  }
  if (
    manifest.execution.runtimeMode !== "allowlisted_deterministic" ||
    manifest.execution.operationalNetworkRequired !== false ||
    manifest.execution.arbitraryCodeAllowed !== false
  ) {
    issues.push({
      path: "execution",
      message:
        "Production execution must be allowlisted, deterministic, offline-capable, and prohibit arbitrary code.",
    });
  }
  if (
    !Number.isFinite(Date.parse(manifest.authoring.createdAt)) ||
    manifest.governingEquations.length === 0 ||
    manifest.assumptions.length === 0 ||
    manifest.boundaryConditions.length === 0
  ) {
    issues.push({
      path: "modelDefinition",
      message:
        "A dated pack requires governing equations, assumptions, and boundary conditions.",
    });
  }
  if (
    manifest.modelKind === "deterministic_physics" &&
    manifest.mechanismKeys.length === 0
  ) {
    issues.push({
      path: "mechanismKeys",
      message:
        "A deterministic physics model requires at least one canonical damage mechanism.",
    });
  }

  const artifactRoles = new Set(
    manifest.artifacts.map((artifact) => artifact.role),
  );
  for (const duplicate of duplicateValues(
    manifest.artifacts.map((artifact) => artifact.path),
  )) {
    issues.push({
      path: "artifacts",
      message: `Duplicate artifact path ${duplicate}.`,
    });
  }
  for (const role of REQUIRED_ARTIFACT_ROLES) {
    if (!artifactRoles.has(role)) {
      issues.push({
        path: "artifacts",
        message: `Required ${role} artifact is missing.`,
      });
    }
  }
  manifest.artifacts.forEach((artifact, index) => {
    if (!/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
      issues.push({
        path: `artifacts[${index}].sha256`,
        message: "Artifact requires a SHA-256 digest.",
      });
    }
    if (artifact.path.startsWith("/") || artifact.path.includes("..")) {
      issues.push({
        path: `artifacts[${index}].path`,
        message: "Artifact paths must be relative and traversal-free.",
      });
    }
  });

  const portCodes = manifest.ports.map(
    (port) => `${port.direction}:${port.code}`,
  );
  for (const duplicate of duplicateValues(portCodes)) {
    issues.push({
      path: "ports",
      message: `Duplicate model port ${duplicate}.`,
    });
  }
  manifest.ports.forEach((port, index) => {
    if (
      ![
        port.code,
        port.physicalMeaning,
        port.unit,
        port.basis,
        port.convention,
      ].every(hasText)
    ) {
      issues.push({
        path: `ports[${index}]`,
        message:
          "Every port requires code, meaning, unit, basis, and convention.",
      });
    }
    if (!rangeIsValid(port.validRange)) {
      issues.push({
        path: `ports[${index}].validRange`,
        message: "Port range must be finite and ordered.",
      });
    }
  });
  const inputPorts = new Map(
    manifest.ports
      .filter((port) => port.direction === "input")
      .map((port) => [port.code, port]),
  );
  for (const duplicate of duplicateValues(
    manifest.applicability.rules.map((rule) => rule.inputCode),
  )) {
    issues.push({
      path: "applicability.rules",
      message: `Duplicate applicability rule ${duplicate}.`,
    });
  }
  for (const rule of manifest.applicability.rules) {
    if (!inputPorts.has(rule.inputCode)) {
      issues.push({
        path: "applicability.rules",
        message: `Applicability rule ${rule.inputCode} has no matching input port.`,
      });
    }
    if (!hasText(rule.description) || !rangeIsValid(rule.range)) {
      issues.push({
        path: `applicability.rules.${rule.inputCode}`,
        message: "Applicability rules require a description and a valid range.",
      });
    }
    if (rule.allowedValues && rule.allowedValues.length === 0) {
      issues.push({
        path: `applicability.rules.${rule.inputCode}.allowedValues`,
        message: "An allowed-values constraint cannot be empty.",
      });
    }
  }
  for (const port of inputPorts.values()) {
    if (
      port.required &&
      !manifest.applicability.rules.some((rule) => rule.inputCode === port.code)
    ) {
      issues.push({
        path: "applicability.rules",
        message: `Required input port ${port.code} has no applicability rule.`,
      });
    }
  }
  for (const duplicate of duplicateValues(
    manifest.parameters.map((parameter) => parameter.code),
  )) {
    issues.push({
      path: "parameters",
      message: `Duplicate parameter ${duplicate}.`,
    });
  }
  for (const duplicate of duplicateValues(
    manifest.verification.checks.map((check) => check.id),
  )) {
    issues.push({
      path: "verification.checks",
      message: `Duplicate verification check ${duplicate}.`,
    });
  }
  for (const kind of REQUIRED_VERIFICATION_KINDS) {
    const checks = manifest.verification.checks.filter(
      (check) => check.kind === kind,
    );
    if (checks.length === 0) {
      issues.push({
        path: "verification.checks",
        message: `${kind} must be implemented or explicitly ruled not applicable.`,
      });
    }
    checks.forEach((check) => {
      if (
        check.disposition === "not_applicable" &&
        !hasText(check.notApplicableReason)
      ) {
        issues.push({
          path: `verification.checks.${check.id}`,
          message: "Not-applicable checks require a reason.",
        });
      }
      if (
        check.disposition === "required" &&
        !hasText(check.implementationReference)
      ) {
        issues.push({
          path: `verification.checks.${check.id}`,
          message: "Required checks need an implementation reference.",
        });
      }
    });
  }
  for (const kind of manifest.verification.requiredPassingKinds) {
    if (
      !manifest.verification.checks.some(
        (check) => check.kind === kind && check.disposition === "required",
      )
    ) {
      issues.push({
        path: "verification.requiredPassingKinds",
        message: `${kind} is marked required but has no required check.`,
      });
    }
  }
  if (!manifest.verification.independentRerunRequired) {
    issues.push({
      path: "verification.independentRerunRequired",
      message: "Sync must independently rerun verification.",
    });
  }
  if (manifest.applicability.assetFamilies.length === 0) {
    issues.push({
      path: "applicability.assetFamilies",
      message: "At least one bounded asset family is required.",
    });
  }
  if (manifest.applicability.rules.length === 0) {
    issues.push({
      path: "applicability.rules",
      message: "A machine-readable applicability envelope is required.",
    });
  }
  if (
    !Number.isFinite(manifest.applicability.maximumMissingFraction) ||
    manifest.applicability.maximumMissingFraction < 0 ||
    manifest.applicability.maximumMissingFraction > 1
  ) {
    issues.push({
      path: "applicability.maximumMissingFraction",
      message: "Maximum missing fraction must be between zero and one.",
    });
  }
  if (manifest.evidenceRequirements.length === 0) {
    issues.push({
      path: "evidenceRequirements",
      message: "Evidence requirements are required.",
    });
  }
  for (const duplicate of duplicateValues(
    manifest.evidenceRequirements.map((requirement) => requirement.key),
  )) {
    issues.push({
      path: "evidenceRequirements",
      message: `Duplicate evidence requirement ${duplicate}.`,
    });
  }
  if (manifest.uncertainty.components.length === 0) {
    issues.push({
      path: "uncertainty.components",
      message: "Uncertainty sources must be decomposed.",
    });
  }
  const uncertaintyKinds = new Set(
    manifest.uncertainty.components.map((component) => component.kind),
  );
  for (const kind of [
    "parameter",
    "measurement",
    "model_form",
    "operating_condition",
    "scenario",
  ] as const) {
    if (!uncertaintyKinds.has(kind)) {
      issues.push({
        path: "uncertainty.components",
        message: `${kind} uncertainty must be explicitly represented.`,
      });
    }
  }
  if (!/^[a-f0-9]{64}$/i.test(manifest.environment.packageLockSha256)) {
    issues.push({
      path: "environment.packageLockSha256",
      message: "A reproducible dependency lock SHA-256 digest is required.",
    });
  }
  if (
    manifest.reliabilityAssurance.failureTaxonomy !==
    "canonical_damage_mechanisms"
  ) {
    issues.push({
      path: "reliabilityAssurance.failureTaxonomy",
      message:
        "Model packs must use SyncAI's canonical damage-mechanism taxonomy.",
    });
  }
  if (!manifest.reliabilityAssurance.nonPhysicsRcaBranchesPreserved) {
    issues.push({
      path: "reliabilityAssurance.nonPhysicsRcaBranchesPreserved",
      message: "PoF must not suppress non-physics RCA branches.",
    });
  }
  for (const [path, value] of [
    [
      "reliabilityAssurance.calibration.calibrationDatasetRequired",
      manifest.reliabilityAssurance.calibration.calibrationDatasetRequired,
    ],
    [
      "reliabilityAssurance.calibration.holdoutValidationRequired",
      manifest.reliabilityAssurance.calibration.holdoutValidationRequired,
    ],
    [
      "reliabilityAssurance.calibration.residualChecksRequired",
      manifest.reliabilityAssurance.calibration.residualChecksRequired,
    ],
    [
      "reliabilityAssurance.decisionSupport.consequenceAwareThresholds",
      manifest.reliabilityAssurance.decisionSupport.consequenceAwareThresholds,
    ],
    [
      "reliabilityAssurance.decisionSupport.inspectionPlanningUsesValueOfInformation",
      manifest.reliabilityAssurance.decisionSupport
        .inspectionPlanningUsesValueOfInformation,
    ],
    [
      "reliabilityAssurance.decisionSupport.probabilityOfDetectionRequired",
      manifest.reliabilityAssurance.decisionSupport
        .probabilityOfDetectionRequired,
    ],
    [
      "reliabilityAssurance.decisionSupport.interventionEffectModelRequired",
      manifest.reliabilityAssurance.decisionSupport
        .interventionEffectModelRequired,
    ],
    [
      "reliabilityAssurance.decisionSupport.asMaintainedConfigurationRequired",
      manifest.reliabilityAssurance.decisionSupport
        .asMaintainedConfigurationRequired,
    ],
    [
      "reliabilityAssurance.decisionSupport.physicalAndEconomicRulSeparated",
      manifest.reliabilityAssurance.decisionSupport
        .physicalAndEconomicRulSeparated,
    ],
    [
      "reliabilityAssurance.decisionSupport.commonCauseAssessmentRequired",
      manifest.reliabilityAssurance.decisionSupport
        .commonCauseAssessmentRequired,
    ],
    [
      "reliabilityAssurance.decisionSupport.modelConflictRequiresHumanReview",
      manifest.reliabilityAssurance.decisionSupport
        .modelConflictRequiresHumanReview,
    ],
    [
      "reliabilityAssurance.decisionSupport.repairabilityAndFeasibilityRequired",
      manifest.reliabilityAssurance.decisionSupport
        .repairabilityAndFeasibilityRequired,
    ],
    [
      "reliabilityAssurance.learning.outcomeRecordingRequired",
      manifest.reliabilityAssurance.learning.outcomeRecordingRequired,
    ],
    [
      "reliabilityAssurance.learning.counterfactualReviewRequired",
      manifest.reliabilityAssurance.learning.counterfactualReviewRequired,
    ],
    [
      "reliabilityAssurance.learning.designFeedbackRequired",
      manifest.reliabilityAssurance.learning.designFeedbackRequired,
    ],
  ] as const) {
    if (value !== true) {
      issues.push({
        path,
        message: `${path} must remain an explicit production control.`,
      });
    }
  }
  for (const [path, value] of [
    [
      "reliabilityAssurance.loadSpectrumMethod",
      manifest.reliabilityAssurance.loadSpectrumMethod,
    ],
    [
      "reliabilityAssurance.damageAccumulationMethod",
      manifest.reliabilityAssurance.damageAccumulationMethod,
    ],
    [
      "reliabilityAssurance.censoringPolicy",
      manifest.reliabilityAssurance.censoringPolicy,
    ],
  ] as const) {
    if (!hasText(value)) {
      issues.push({ path, message: `${path} must be declared.` });
    }
  }
  if (manifest.reliabilityAssurance.cohortingFields.length === 0) {
    issues.push({
      path: "reliabilityAssurance.cohortingFields",
      message: "Population-cohort fields must be declared.",
    });
  }
  if (
    manifest.reliabilityAssurance.decisionSupport
      .fitnessForServiceEscalationConditions.length === 0
  ) {
    issues.push({
      path: "reliabilityAssurance.decisionSupport.fitnessForServiceEscalationConditions",
      message: "Fitness-for-service escalation conditions are required.",
    });
  }
  if (
    manifest.reliabilityAssurance.calibration.recalibrationTriggers.length === 0
  ) {
    issues.push({
      path: "reliabilityAssurance.calibration.recalibrationTriggers",
      message: "Recalibration triggers are required.",
    });
  }
  if (manifest.reliabilityAssurance.learning.retirementTriggers.length === 0) {
    issues.push({
      path: "reliabilityAssurance.learning.retirementTriggers",
      message: "Model retirement triggers are required.",
    });
  }
  if (
    manifest.governance.chemistryRequiresLabEvidence &&
    !manifest.evidenceRequirements.some(
      (requirement) =>
        requirement.purpose === "lab_assay" &&
        requirement.requiredForProduction,
    )
  ) {
    issues.push({
      path: "evidenceRequirements",
      message:
        "Chemistry-dependent models require production lab-assay evidence.",
    });
  }
  for (const standard of manifest.standards) {
    if (!hasText(standard.designation) || !hasText(standard.usageRights)) {
      issues.push({
        path: "standards",
        message:
          "Every standards or OEM reference requires designation and usage rights.",
      });
    }
  }
  return issues;
}

function valueInRange(
  value: number,
  range: NonNullable<EngineeringModelPort["validRange"]>,
): boolean {
  const minOk =
    range.min === undefined ||
    (range.minInclusive === false ? value > range.min : value >= range.min);
  const maxOk =
    range.max === undefined ||
    (range.maxInclusive === false ? value < range.max : value <= range.max);
  return minOk && maxOk;
}

export function assessModelApplicability(
  manifest: PhysicsModelPackManifest,
  context: ModelEvaluationContext,
): ApplicabilityAssessment {
  const refusals: ModelRefusal[] = [];
  const envelope = manifest.applicability;
  if (
    !context ||
    typeof context !== "object" ||
    !Array.isArray(context.activeConditionCodes) ||
    !context.inputs ||
    typeof context.inputs !== "object" ||
    Array.isArray(context.inputs)
  ) {
    return {
      applicable: false,
      refusals: [
        {
          code: "invalid_evaluation_context",
          message:
            "Model context requires an input object and an active-condition array.",
        },
      ],
    };
  }
  if (!envelope.assetFamilies.includes(context.assetFamily)) {
    refusals.push({
      code: "asset_family_outside_envelope",
      message: `Asset family ${context.assetFamily} is outside this model's applicability envelope.`,
    });
  }
  if (
    envelope.componentCategories.length > 0 &&
    !envelope.componentCategories.includes(context.componentCategory)
  ) {
    refusals.push({
      code: "component_outside_envelope",
      message: `Component ${context.componentCategory} is outside this model's applicability envelope.`,
    });
  }
  if (
    envelope.operatingStates.length > 0 &&
    !envelope.operatingStates.includes(context.operatingState)
  ) {
    refusals.push({
      code: "operating_state_outside_envelope",
      message: `Operating state ${context.operatingState} is outside this model's applicability envelope.`,
    });
  }
  const exclusions = context.activeConditionCodes.filter((code) =>
    envelope.excludedConditionCodes.includes(code),
  );
  if (exclusions.length > 0) {
    refusals.push({
      code: "excluded_condition_present",
      message: `Excluded condition(s) present: ${exclusions.join(", ")}.`,
    });
  }
  if (
    envelope.configurationBaselineRequired &&
    !context.configurationBaselineId
  ) {
    refusals.push({
      code: "configuration_baseline_missing",
      message: "The as-maintained configuration baseline is required.",
    });
  }
  for (const port of manifest.ports.filter(
    (item) => item.direction === "input" && item.required,
  )) {
    const input = context.inputs[port.code];
    if (!input) {
      refusals.push({
        code: "required_input_missing",
        path: port.code,
        message: `Required input ${port.code} is missing.`,
      });
    } else if (input.unit !== port.unit) {
      refusals.push({
        code: "input_unit_mismatch",
        path: port.code,
        message: `${port.code} must use ${port.unit}; received ${input.unit}.`,
      });
    }
  }
  for (const rule of envelope.rules) {
    const input = context.inputs[rule.inputCode];
    if (!input) {
      refusals.push({
        code: "applicability_input_missing",
        path: rule.inputCode,
        message: `${rule.description}: input is missing.`,
      });
      continue;
    }
    if (rule.evidenceRequired && !input.evidenceItemId) {
      refusals.push({
        code: "canonical_evidence_missing",
        path: rule.inputCode,
        message: `${rule.inputCode} is not bound to canonical evidence.`,
      });
    }
    if (
      !input.sourceReference?.trim() ||
      !["A", "B", "C", "D"].includes(input.evidenceGrade)
    ) {
      refusals.push({
        code: "evidence_metadata_missing",
        path: rule.inputCode,
        message: `${rule.inputCode} requires a source reference and evidence grade.`,
      });
    }
    if (
      rule.range &&
      (typeof input.value !== "number" ||
        !Number.isFinite(input.value) ||
        !valueInRange(input.value, rule.range))
    ) {
      refusals.push({
        code: "input_outside_envelope",
        path: rule.inputCode,
        message: `${rule.inputCode} is outside the approved range.`,
      });
    }
    if (rule.allowedValues && !rule.allowedValues.includes(input.value)) {
      refusals.push({
        code: "input_value_not_allowed",
        path: rule.inputCode,
        message: `${rule.inputCode} is not an approved value.`,
      });
    }
    if (envelope.measurementQualityRequired) {
      const quality = input.measurementQuality;
      if (
        !quality ||
        !quality.calibrationCurrent ||
        !quality.samplingAdequate ||
        quality.driftDetected ||
        !Number.isFinite(quality.missingFraction) ||
        quality.missingFraction < 0 ||
        quality.missingFraction > envelope.maximumMissingFraction
      ) {
        refusals.push({
          code: "measurement_quality_insufficient",
          path: rule.inputCode,
          message: `${rule.inputCode} does not meet the declared measurement-quality contract.`,
        });
      }
    }
  }
  return { applicable: refusals.length === 0, refusals };
}

export interface PortCompatibilityResult {
  compatible: boolean;
  refusals: ModelRefusal[];
}

export function checkModelPortCompatibility(
  producer: EngineeringModelPort,
  consumer: EngineeringModelPort,
): PortCompatibilityResult {
  const refusals: ModelRefusal[] = [];
  if (producer.direction !== "output" || consumer.direction !== "input") {
    refusals.push({
      code: "port_direction_mismatch",
      message: "A dependency must connect an output to an input.",
    });
  }
  for (const [field, left, right] of [
    ["physical meaning", producer.physicalMeaning, consumer.physicalMeaning],
    ["unit", producer.unit, consumer.unit],
    ["basis", producer.basis, consumer.basis],
    ["convention", producer.convention, consumer.convention],
  ] as const) {
    if (left !== right)
      refusals.push({
        code: "port_semantic_mismatch",
        message: `Port ${field} differs: ${left} → ${right}.`,
      });
  }
  const p = producer.validRange;
  const c = consumer.validRange;
  const lowerBoundaryMismatch =
    c?.min !== undefined &&
    (p?.min === undefined ||
      p.min < c.min ||
      (p.min === c.min &&
        p.minInclusive !== false &&
        c.minInclusive === false));
  const upperBoundaryMismatch =
    c?.max !== undefined &&
    (p?.max === undefined ||
      p.max > c.max ||
      (p.max === c.max &&
        p.maxInclusive !== false &&
        c.maxInclusive === false));
  if (lowerBoundaryMismatch || upperBoundaryMismatch) {
    refusals.push({
      code: "port_range_mismatch",
      message:
        "Producer output range exceeds the consumer's approved input range.",
    });
  }
  return { compatible: refusals.length === 0, refusals };
}

export interface PromotionVerdict {
  allowed: boolean;
  refusals: ModelRefusal[];
}

export function assessModelPromotion(
  manifest: PhysicsModelPackManifest,
  current: EngineeringModelLifecycleState,
  next: EngineeringModelLifecycleState,
  evidence: ModelPromotionEvidence,
): PromotionVerdict {
  const refusals: ModelRefusal[] = [];
  const allowedNext =
    current === "revalidation_required"
      ? ["verified", "retired"]
      : current === "retired"
        ? []
        : LIFECYCLE_FORWARD[current];
  if (!allowedNext.includes(next)) {
    refusals.push({
      code: "invalid_lifecycle_transition",
      message: `${current} cannot transition directly to ${next}.`,
    });
  }
  if (
    [
      "verified",
      "bench_validated",
      "field_validated",
      "engineering_approved",
      "production_eligible",
    ].includes(next)
  ) {
    for (const check of manifest.verification.checks.filter(
      (item) => item.disposition === "required",
    )) {
      if (
        !evidence.verificationResults.some(
          (result) =>
            result.checkId === check.id &&
            result.passed &&
            result.runReference.trim(),
        )
      ) {
        refusals.push({
          code: "verification_check_not_passed",
          path: check.id,
          message: `Required verification ${check.id} has not passed.`,
        });
      }
    }
  }
  if (
    [
      "bench_validated",
      "field_validated",
      "engineering_approved",
      "production_eligible",
    ].includes(next) &&
    evidence.benchValidationEvidenceIds.length === 0
  ) {
    refusals.push({
      code: "bench_validation_missing",
      message: "Bench-validation evidence is required.",
    });
  }
  if (
    ["field_validated", "engineering_approved", "production_eligible"].includes(
      next,
    ) &&
    evidence.fieldValidationEvidenceIds.length === 0
  ) {
    refusals.push({
      code: "field_validation_missing",
      message: "Field-validation evidence is required.",
    });
  }
  if (["engineering_approved", "production_eligible"].includes(next)) {
    if (
      !evidence.reviewerUserId ||
      evidence.reviewerUserId === evidence.authorUserId
    ) {
      refusals.push({
        code: "independent_review_missing",
        message: "A named independent engineering reviewer is required.",
      });
    }
    if (
      !evidence.reviewerCompetencies.includes(
        manifest.governance.requiredReviewerCompetency,
      )
    ) {
      refusals.push({
        code: "reviewer_competency_missing",
        message: `Reviewer lacks ${manifest.governance.requiredReviewerCompetency}.`,
      });
    }
  }
  if (next === "production_eligible") {
    if (evidence.blockingDebtCount > 0)
      refusals.push({
        code: "blocking_verification_debt",
        message: "Blocking verification debt remains open.",
      });
    if (!evidence.applicabilityMachineReadable)
      refusals.push({
        code: "applicability_not_machine_readable",
        message:
          "Production use requires a machine-readable applicability envelope.",
      });
    for (const requirement of manifest.evidenceRequirements.filter(
      (item) => item.requiredForProduction,
    )) {
      if (!evidence.evidenceRequirementKeys.includes(requirement.key)) {
        refusals.push({
          code: "production_evidence_missing",
          path: requirement.key,
          message: `Required production evidence ${requirement.key} is missing.`,
        });
      }
    }
  }
  return { allowed: refusals.length === 0, refusals };
}

export function downstreamModelKeys(
  rootModelKey: string,
  dependencies: Array<{ producerModelKey: string; consumerModelKey: string }>,
): string[] {
  const downstream = new Set<string>();
  const queue = [rootModelKey];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of dependencies.filter(
      (item) => item.producerModelKey === current,
    )) {
      if (edge.consumerModelKey === rootModelKey)
        throw new Error("Engineering model dependency graph contains a cycle.");
      if (!downstream.has(edge.consumerModelKey)) {
        downstream.add(edge.consumerModelKey);
        queue.push(edge.consumerModelKey);
      }
    }
  }
  return [...downstream];
}
