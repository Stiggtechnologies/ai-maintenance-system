import type { ModelRefusal, PhysicsModelPackManifest } from "./types.ts";

export const shaftResonanceModelPack: PhysicsModelPackManifest = {
  schemaVersion: "1.0.0",
  modelKey: "pof.shaft-resonance.screening",
  version: "1.0.0",
  name: "Shaft forcing-frequency and resonance screening",
  description:
    "A bounded screening model that compares an observed vibration peak with forcing and single-degree-of-freedom natural-frequency estimates. It cannot diagnose root cause or authorize continued operation.",
  modelKind: "deterministic_physics",
  domain: "rotating_machinery",
  lifeModelType: "resonance",
  mechanismKeys: ["misalignment", "looseness", "fatigue_crack"],
  authoring: {
    tool: "syncai",
    toolVersion: "engineering-model-supply-chain/1.0.0",
    mode: "full_model_project",
    sourceLicense: "Proprietary-SyncAI",
    sourceReference:
      "engineering-model-packs/vibration-resonance-v1/MANIFEST.json",
    createdAt: "2026-09-05T00:00:00.000Z",
  },
  artifacts: [
    {
      path: "engineering-model-packs/vibration-resonance-v1/PROJECT.md",
      role: "project",
      mediaType: "text/markdown",
      sha256:
        "866d44d79ba93e02687e41fcd139418f13d950ab6dec7df2f29ea087584a7953",
    },
    {
      path: "engineering-model-packs/vibration-resonance-v1/REQUIREMENTS.md",
      role: "requirements",
      mediaType: "text/markdown",
      sha256:
        "0ebb8f655408a27c0d373e1f7ac2dd5b33f30496838ff9bf702d57eeb48792c0",
    },
    {
      path: "engineering-model-packs/vibration-resonance-v1/ROADMAP.md",
      role: "roadmap",
      mediaType: "text/markdown",
      sha256:
        "ba3ac69384830da2cf60720cf18bdeac95aa670cf7f67909db925d43fc54ec79",
    },
    {
      path: "engineering-model-packs/vibration-resonance-v1/STATE.md",
      role: "state",
      mediaType: "text/markdown",
      sha256:
        "4b2b82b9bfa68011ee98545655256e69fa10b0f7591d47879313ba515e82465c",
    },
    {
      path: "engineering-model-packs/vibration-resonance-v1/MODEL.md",
      role: "model",
      mediaType: "text/markdown",
      sha256:
        "2fc5fd42079f62b60fe63a6d00afdf0be4e6943c8cb345881cc7b3accb44b5b1",
    },
    {
      path: "engineering-model-packs/vibration-resonance-v1/ASSUMPTIONS.md",
      role: "assumptions",
      mediaType: "text/markdown",
      sha256:
        "9f95d73c44d99cccfe308948c9dcd119ebe60374bd76eca5e84b52cf64737fa9",
    },
    {
      path: "engineering-model-packs/vibration-resonance-v1/CONVENTIONS.md",
      role: "conventions",
      mediaType: "text/markdown",
      sha256:
        "d710d183d44a8d5e69266535a63b7f380a8ec6dcdf36b0c4362673f2e69569a3",
    },
    {
      path: "engineering-model-packs/vibration-resonance-v1/DERIVATION.md",
      role: "derivation",
      mediaType: "text/markdown",
      sha256:
        "5bd378cd9d2d1a12dd1b3588d652c2d46dbc06d6de1b3738ec3d1afd206ccb8d",
    },
    {
      path: "engineering-model-packs/vibration-resonance-v1/verification/contract.json",
      role: "verification",
      mediaType: "application/json",
      sha256:
        "9f0806f64ae424f75987555ed69447194afcb58a916fc1fe5f8293011d82878f",
    },
    {
      path: "engineering-model-packs/vibration-resonance-v1/APPLICABILITY.json",
      role: "applicability",
      mediaType: "application/json",
      sha256:
        "64830207a18f393c879920e010363bfcadff74d17332c6df74405c6e04390442",
    },
    {
      path: "engineering-model-packs/vibration-resonance-v1/MANIFEST.json",
      role: "manifest",
      mediaType: "application/json",
      sha256:
        "b672ac4f7667a45aec628cde4b1ea86009f02fa148be7d52ef9ee291ead48002",
    },
  ],
  governingEquations: [
    {
      id: "shaft-frequency",
      expression: "f_s = n / 60",
      formulaReference: "DERIVATION-RES-001",
    },
    {
      id: "forcing-frequency",
      expression: "f_f = o f_s",
      formulaReference: "DERIVATION-RES-002",
    },
    {
      id: "natural-frequency",
      expression: "f_n = sqrt(k/m) / (2 pi)",
      formulaReference: "DERIVATION-RES-003",
    },
  ],
  assumptions: [
    "The mass-stiffness estimate represents the mode being screened.",
    "RPM and spectrum observations refer to the same stable operating interval.",
    "A frequency match is a hypothesis discriminator, not proof of resonance.",
  ],
  boundaryConditions: [
    "Linear single-degree-of-freedom approximation.",
    "No severe transient, impact, rub, or rapid speed sweep during the evaluated window.",
  ],
  parameters: [
    {
      code: "modal_mass_kg",
      name: "Modal mass",
      unit: "kg",
      description: "Effective modal mass.",
      sourceRequired: true,
      minimumEvidenceGrade: "B",
      uncertaintyComponent: "parameter",
    },
    {
      code: "modal_stiffness_n_m",
      name: "Modal stiffness",
      unit: "N/m",
      description: "Effective modal stiffness.",
      sourceRequired: true,
      minimumEvidenceGrade: "B",
      uncertaintyComponent: "parameter",
    },
    {
      code: "match_tolerance_pct",
      name: "Frequency match tolerance",
      unit: "%",
      description: "Engineering-approved comparison tolerance.",
      sourceRequired: true,
      minimumEvidenceGrade: "A",
      uncertaintyComponent: "model_form",
    },
  ],
  ports: [
    {
      code: "rpm",
      direction: "input",
      physicalMeaning: "shaft rotational speed",
      unit: "r/min",
      basis: "mean over spectrum window",
      convention: "positive rotation magnitude",
      validRange: { min: 0, minInclusive: false },
      required: true,
    },
    {
      code: "forcing_order",
      direction: "input",
      physicalMeaning: "forcing order",
      unit: "1",
      basis: "multiple of shaft frequency",
      convention: "positive scalar",
      validRange: { min: 0, minInclusive: false },
      required: true,
    },
    {
      code: "dominant_peak_hz",
      direction: "input",
      physicalMeaning: "dominant vibration spectral peak",
      unit: "Hz",
      basis: "peak frequency",
      convention: "positive frequency",
      validRange: { min: 0, minInclusive: false },
      required: true,
    },
    {
      code: "modal_mass_kg",
      direction: "input",
      physicalMeaning: "effective modal mass",
      unit: "kg",
      basis: "screened mode",
      convention: "positive scalar",
      validRange: { min: 0, minInclusive: false },
      required: true,
    },
    {
      code: "modal_stiffness_n_m",
      direction: "input",
      physicalMeaning: "effective modal stiffness",
      unit: "N/m",
      basis: "screened mode",
      convention: "positive scalar",
      validRange: { min: 0, minInclusive: false },
      required: true,
    },
    {
      code: "match_tolerance_pct",
      direction: "input",
      physicalMeaning: "approved resonance frequency-match tolerance",
      unit: "%",
      basis: "absolute percentage difference from reference frequency",
      convention: "positive percentage",
      validRange: { min: 0, max: 100, minInclusive: false },
      required: true,
    },
    {
      code: "shaft_frequency_hz",
      direction: "output",
      physicalMeaning: "shaft rotational frequency",
      unit: "Hz",
      basis: "mean over spectrum window",
      convention: "positive frequency",
      validRange: { min: 0 },
      required: true,
    },
    {
      code: "forcing_frequency_hz",
      direction: "output",
      physicalMeaning: "forcing frequency",
      unit: "Hz",
      basis: "forcing order times shaft frequency",
      convention: "positive frequency",
      validRange: { min: 0 },
      required: true,
    },
    {
      code: "natural_frequency_hz",
      direction: "output",
      physicalMeaning: "estimated natural frequency",
      unit: "Hz",
      basis: "single-degree-of-freedom estimate",
      convention: "positive frequency",
      validRange: { min: 0 },
      required: true,
    },
  ],
  conventions: {
    id: "syncai-si-rotating-v1",
    unitSystem: "SI",
    pressureBasis: "not_applicable",
    vibrationBasis: "rms",
    stressDefinition: "not_applicable",
    timeBasis: "operating",
    coordinateSystem: "sensor orientation must be declared in evidence",
    probabilityDefinition:
      "not_applicable; this pack reports deterministic frequency differences",
    notes: [
      "RPM is converted to hertz by division by 60.",
      "Spectrum amplitude is not used as an alarm threshold.",
    ],
  },
  applicability: {
    assetFamilies: [
      "rotating_equipment_power_transmission",
      "rotating_fluid_equipment",
      "rotating_electrical_equipment",
    ],
    componentCategories: ["shaft", "coupling", "bearing", "support_structure"],
    operatingStates: ["running_steady", "maintenance_test"],
    rules: [
      {
        inputCode: "rpm",
        description: "Positive contemporaneous shaft speed",
        range: { min: 0, minInclusive: false },
        evidenceRequired: true,
      },
      {
        inputCode: "forcing_order",
        description: "Positive forcing order",
        range: { min: 0, minInclusive: false },
        evidenceRequired: true,
      },
      {
        inputCode: "dominant_peak_hz",
        description: "Positive measured spectrum peak",
        range: { min: 0, minInclusive: false },
        evidenceRequired: true,
      },
      {
        inputCode: "modal_mass_kg",
        description: "Positive effective modal mass",
        range: { min: 0, minInclusive: false },
        evidenceRequired: true,
      },
      {
        inputCode: "modal_stiffness_n_m",
        description: "Positive effective modal stiffness",
        range: { min: 0, minInclusive: false },
        evidenceRequired: true,
      },
      {
        inputCode: "match_tolerance_pct",
        description: "Positive engineering-approved frequency-match tolerance",
        range: { min: 0, max: 100, minInclusive: false },
        evidenceRequired: true,
      },
    ],
    excludedConditionCodes: [
      "rapid_speed_transient",
      "impact_event",
      "known_rub",
      "sensor_saturation",
      "unknown_as_maintained_configuration",
    ],
    configurationBaselineRequired: true,
    measurementQualityRequired: true,
    maximumMissingFraction: 0.05,
  },
  verification: {
    requiredPassingKinds: [
      "dimensional",
      "limiting_case",
      "benchmark",
      "numerical_stability",
      "regression",
      "adversarial",
    ],
    independentRerunRequired: true,
    checks: [
      {
        id: "res-dim-001",
        kind: "dimensional",
        description: "All frequency outputs reduce to inverse seconds.",
        implementationReference: "src/lib/engineering-models/resonance.test.ts",
        expectedResult: "Hz",
        disposition: "required",
      },
      {
        id: "res-limit-001",
        kind: "limiting_case",
        description: "Shaft and forcing frequencies tend to zero with RPM.",
        implementationReference: "src/lib/engineering-models/resonance.test.ts",
        expectedResult: "0 Hz",
        disposition: "required",
      },
      {
        id: "res-conservation-na",
        kind: "conservation",
        description:
          "No conserved quantity is solved by this kinematic screen.",
        disposition: "not_applicable",
        notApplicableReason:
          "The model compares frequencies and does not integrate mass, energy, or momentum balances.",
      },
      {
        id: "res-symmetry-na",
        kind: "symmetry",
        description: "Rotation direction is reduced to positive magnitude.",
        disposition: "not_applicable",
        notApplicableReason:
          "Direction-sensitive mode shapes are outside this scalar screening model.",
      },
      {
        id: "res-bench-001",
        kind: "benchmark",
        description: "60 RPM produces 1 Hz shaft frequency.",
        implementationReference: "src/lib/engineering-models/resonance.test.ts",
        expectedResult: "1 Hz",
        tolerance: 1e-12,
        disposition: "required",
      },
      {
        id: "res-stability-001",
        kind: "numerical_stability",
        description:
          "Finite positive inputs produce finite outputs across the declared range.",
        implementationReference: "src/lib/engineering-models/resonance.test.ts",
        expectedResult: "finite",
        disposition: "required",
      },
      {
        id: "res-regression-001",
        kind: "regression",
        description: "Pinned reference case remains unchanged.",
        implementationReference: "src/lib/engineering-models/resonance.test.ts",
        expectedResult: "reference output",
        tolerance: 1e-9,
        disposition: "required",
      },
      {
        id: "res-adversarial-001",
        kind: "adversarial",
        description:
          "Bad units, missing evidence, transient states, and invalid values refuse.",
        implementationReference: "src/lib/engineering-models/resonance.test.ts",
        expectedResult: "refused",
        disposition: "required",
      },
    ],
  },
  evidenceRequirements: [
    {
      key: "contemporaneous-speed",
      purpose: "parameter",
      description: "Shaft speed over the spectrum window.",
      minimumGrade: "B",
      requiredForProduction: true,
    },
    {
      key: "vibration-spectrum",
      purpose: "measurement_quality",
      description:
        "Calibrated spectrum with sample-rate and orientation metadata.",
      minimumGrade: "B",
      requiredForProduction: true,
    },
    {
      key: "modal-properties",
      purpose: "parameter",
      description:
        "Measured or engineering-approved mass and stiffness bounds.",
      minimumGrade: "B",
      requiredForProduction: true,
    },
    {
      key: "as-maintained-configuration",
      purpose: "configuration",
      description: "Current installed geometry and support configuration.",
      minimumGrade: "A",
      requiredForProduction: true,
    },
    {
      key: "approved-match-tolerance",
      purpose: "applicability",
      description: "Engineering-approved comparison tolerance and basis.",
      minimumGrade: "A",
      requiredForProduction: true,
    },
    {
      key: "bench-reference-case",
      purpose: "bench_validation",
      description: "Known reference or controlled modal test.",
      minimumGrade: "B",
      requiredForProduction: true,
    },
    {
      key: "field-modal-confirmation",
      purpose: "field_validation",
      description: "Impact test, run-up/coast-down, or qualified equivalent.",
      minimumGrade: "B",
      requiredForProduction: true,
    },
  ],
  uncertainty: {
    method: "bounded",
    components: [
      {
        kind: "parameter",
        description: "Modal mass and stiffness bounds.",
        quantified: true,
      },
      {
        kind: "measurement",
        description: "RPM and spectral frequency resolution.",
        quantified: true,
      },
      {
        kind: "model_form",
        description: "Single-degree-of-freedom approximation.",
        quantified: false,
      },
      {
        kind: "operating_condition",
        description: "Operating-state variability over the sample window.",
        quantified: false,
      },
      {
        kind: "scenario",
        description: "Alternative forcing orders.",
        quantified: true,
      },
    ],
    output: "interval",
  },
  dependencies: [],
  standards: [],
  environment: {
    operatingSystem: "platform-independent TypeScript",
    runtimeVersions: { node: ">=20", typescript: "repository-pinned" },
    packageLockSha256:
      "3d2c1acd87bfbedb7696ebf7e66b4d9cc8427176098728d5958bb18b6f334a3f",
    solverVersions: {},
    numericalTolerances: { frequencyHz: 1e-9 },
    randomSeeds: [],
    airGapCompatible: true,
  },
  governance: {
    intendedUse: "engineering_decision_support",
    humanApprovalRequired: true,
    autonomousOperationalActionAllowed: false,
    thresholdsPolicy: "approved_source_only",
    requiredReviewerCompetency: "model_reviewer_vibration_and_rotordynamics",
    certificationClass: "advisory",
    escalationClass: "specialist_engineering",
    chemistryRequiresLabEvidence: false,
    sourceRightsConfirmed: true,
  },
  reliabilityAssurance: {
    failureTaxonomy: "canonical_damage_mechanisms",
    loadSpectrumMethod:
      "Contemporaneous RPM and vibration spectrum; transient cycle extraction is outside this screen.",
    damageAccumulationMethod:
      "Not applicable: this pack does not estimate damage or life.",
    mechanismInteractionPolicy: "independence_must_be_evidenced",
    censoringPolicy:
      "Not applicable to a frequency screen; any later life model must preserve suspensions and entry times.",
    cohortingFields: [
      "asset_family",
      "support_configuration",
      "operating_state",
      "speed_regime",
    ],
    calibration: {
      calibrationDatasetRequired: true,
      holdoutValidationRequired: true,
      residualChecksRequired: true,
      recalibrationTriggers: [
        "configuration_change",
        "systematic_field_bias",
        "measurement_chain_change",
        "dependency_version_change",
      ],
    },
    decisionSupport: {
      consequenceAwareThresholds: true,
      inspectionPlanningUsesValueOfInformation: true,
      probabilityOfDetectionRequired: true,
      interventionEffectModelRequired: true,
      asMaintainedConfigurationRequired: true,
      physicalAndEconomicRulSeparated: true,
      commonCauseAssessmentRequired: true,
      modelConflictRequiresHumanReview: true,
      fitnessForServiceEscalationConditions: [
        "suspected_crack",
        "pressure_boundary",
        "safety_critical_support",
      ],
      repairabilityAndFeasibilityRequired: true,
    },
    learning: {
      outcomeRecordingRequired: true,
      counterfactualReviewRequired: true,
      designFeedbackRequired: true,
      retirementTriggers: [
        "systematic_field_bias",
        "failed_regression",
        "invalidated_assumption",
        "superseded_version",
        "source_rights_withdrawn",
      ],
    },
    nonPhysicsRcaBranchesPreserved: true,
  },
  execution: {
    runtimeMode: "allowlisted_deterministic",
    calculationKey: "pof_shaft_resonance_screening",
    operationalNetworkRequired: false,
    arbitraryCodeAllowed: false,
  },
};

export interface ShaftResonanceInput {
  rpm: number;
  forcingOrder: number;
  dominantPeakHz: number;
  modalMassKg: number;
  modalStiffnessNPerM: number;
  approvedMatchTolerancePct?: number;
  toleranceSourceReference?: string;
}

export interface ShaftResonanceResult {
  shaftFrequencyHz: number;
  forcingFrequencyHz: number;
  naturalFrequencyHz: number;
  peakToForcingDifferencePct: number;
  peakToNaturalDifferencePct: number;
  forcingMatch: boolean | null;
  naturalFrequencyMatch: boolean | null;
  conclusion:
    | "screen_supports_resonance_hypothesis"
    | "screen_does_not_support_resonance_hypothesis"
    | "refused";
  refusals: ModelRefusal[];
  humanApprovalRequired: true;
}

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be finite and greater than zero.`);
}

function percentDifference(measured: number, reference: number): number {
  return (Math.abs(measured - reference) / reference) * 100;
}

export function evaluateShaftResonance(
  input: ShaftResonanceInput,
): ShaftResonanceResult {
  positive(input.rpm, "rpm");
  positive(input.forcingOrder, "forcingOrder");
  positive(input.dominantPeakHz, "dominantPeakHz");
  positive(input.modalMassKg, "modalMassKg");
  positive(input.modalStiffnessNPerM, "modalStiffnessNPerM");
  const shaftFrequencyHz = input.rpm / 60;
  const forcingFrequencyHz = shaftFrequencyHz * input.forcingOrder;
  const naturalFrequencyHz =
    Math.sqrt(input.modalStiffnessNPerM / input.modalMassKg) / (2 * Math.PI);
  if (
    ![shaftFrequencyHz, forcingFrequencyHz, naturalFrequencyHz].every(
      Number.isFinite,
    )
  ) {
    throw new Error(
      "Derived frequencies exceed the deterministic evaluator's numerically stable range.",
    );
  }
  const peakToForcingDifferencePct = percentDifference(
    input.dominantPeakHz,
    forcingFrequencyHz,
  );
  const peakToNaturalDifferencePct = percentDifference(
    input.dominantPeakHz,
    naturalFrequencyHz,
  );
  if (
    ![peakToForcingDifferencePct, peakToNaturalDifferencePct].every(
      Number.isFinite,
    )
  ) {
    throw new Error(
      "Frequency comparison exceeds the deterministic evaluator's numerically stable range.",
    );
  }
  const refusals: ModelRefusal[] = [];
  if (
    input.approvedMatchTolerancePct === undefined ||
    !Number.isFinite(input.approvedMatchTolerancePct) ||
    input.approvedMatchTolerancePct <= 0 ||
    !input.toleranceSourceReference?.trim()
  ) {
    refusals.push({
      code: "approved_match_tolerance_missing",
      message:
        "Frequencies were calculated, but classification refuses without an approved tolerance and source reference.",
    });
  }
  const tolerance = input.approvedMatchTolerancePct;
  const forcingMatch =
    refusals.length === 0 && tolerance !== undefined
      ? peakToForcingDifferencePct <= tolerance
      : null;
  const naturalFrequencyMatch =
    refusals.length === 0 && tolerance !== undefined
      ? peakToNaturalDifferencePct <= tolerance
      : null;
  return {
    shaftFrequencyHz,
    forcingFrequencyHz,
    naturalFrequencyHz,
    peakToForcingDifferencePct,
    peakToNaturalDifferencePct,
    forcingMatch,
    naturalFrequencyMatch,
    conclusion:
      refusals.length > 0
        ? "refused"
        : forcingMatch && naturalFrequencyMatch
          ? "screen_supports_resonance_hypothesis"
          : "screen_does_not_support_resonance_hypothesis",
    refusals,
    humanApprovalRequired: true,
  };
}
