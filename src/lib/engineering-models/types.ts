export type EngineeringModelLifecycleState =
  | "draft"
  | "derived"
  | "verified"
  | "bench_validated"
  | "field_validated"
  | "engineering_approved"
  | "production_eligible"
  | "revalidation_required"
  | "retired";

export type EngineeringModelKind =
  | "deterministic_physics"
  | "empirical_reliability"
  | "hybrid"
  | "oem_curve"
  | "standards_method";

export type PhysicsOfFailureModelType =
  | "resonance"
  | "bearing_fatigue"
  | "stress_life_fatigue"
  | "strain_life_fatigue"
  | "crack_growth"
  | "creep"
  | "abrasive_wear"
  | "corrosion_degradation"
  | "thermal_activation"
  | "thermal_cycling"
  | "electrical_aging"
  | "empirical_distribution"
  | "other";

export type VerificationCheckKind =
  | "dimensional"
  | "limiting_case"
  | "conservation"
  | "symmetry"
  | "benchmark"
  | "numerical_stability"
  | "regression"
  | "adversarial"
  | "lab_validation"
  | "field_validation";

export type EvidenceGrade = "A" | "B" | "C" | "D";

export interface EngineeringConventionSet {
  id: string;
  unitSystem: "SI" | "US_CUSTOMARY" | "mixed_declared";
  pressureBasis: "absolute" | "gauge" | "not_applicable";
  vibrationBasis: "rms" | "peak" | "peak_to_peak" | "not_applicable";
  stressDefinition: "amplitude" | "range" | "maximum" | "not_applicable";
  timeBasis: "calendar" | "operating" | "cycles" | "declared_per_port";
  coordinateSystem: string;
  referenceTemperatureK?: number;
  probabilityDefinition: string;
  notes: string[];
}

export interface NumericRange {
  min?: number;
  max?: number;
  minInclusive?: boolean;
  maxInclusive?: boolean;
}

export interface EngineeringModelPort {
  code: string;
  direction: "input" | "output";
  physicalMeaning: string;
  unit: string;
  basis: string;
  convention: string;
  validRange?: NumericRange;
  required: boolean;
}

export interface ModelParameterDefinition {
  code: string;
  name: string;
  unit: string;
  description: string;
  sourceRequired: boolean;
  minimumEvidenceGrade?: EvidenceGrade;
  uncertaintyComponent:
    | "parameter"
    | "measurement"
    | "model_form"
    | "operating_condition"
    | "scenario";
}

export interface ApplicabilityRule {
  inputCode: string;
  description: string;
  range?: NumericRange;
  allowedValues?: Array<string | number | boolean>;
  evidenceRequired: boolean;
}

export interface ModelApplicabilityEnvelope {
  assetFamilies: string[];
  componentCategories: string[];
  operatingStates: string[];
  rules: ApplicabilityRule[];
  excludedConditionCodes: string[];
  configurationBaselineRequired: boolean;
  measurementQualityRequired: boolean;
  maximumMissingFraction: number;
}

export interface VerificationCheckDefinition {
  id: string;
  kind: VerificationCheckKind;
  description: string;
  implementationReference?: string;
  expectedResult?: string;
  tolerance?: number;
  disposition: "required" | "not_applicable";
  notApplicableReason?: string;
}

export interface VerificationContract {
  checks: VerificationCheckDefinition[];
  requiredPassingKinds: VerificationCheckKind[];
  independentRerunRequired: boolean;
}

export interface ModelEvidenceRequirement {
  key: string;
  purpose:
    | "parameter"
    | "applicability"
    | "verification"
    | "bench_validation"
    | "field_validation"
    | "lab_assay"
    | "measurement_quality"
    | "configuration";
  description: string;
  minimumGrade: EvidenceGrade;
  requiredForProduction: boolean;
}

export interface ModelArtifactReference {
  path: string;
  role:
    | "project"
    | "requirements"
    | "roadmap"
    | "state"
    | "model"
    | "assumptions"
    | "conventions"
    | "derivation"
    | "verification"
    | "validation_data"
    | "applicability"
    | "manifest"
    | "figure"
    | "other";
  mediaType: string;
  sha256: string;
}

export interface ReproducibleEnvironment {
  operatingSystem: string;
  runtimeVersions: Record<string, string>;
  packageLockSha256: string;
  solverVersions: Record<string, string>;
  numericalTolerances: Record<string, number>;
  randomSeeds: number[];
  airGapCompatible: boolean;
}

export interface ModelDependencyReference {
  modelKey: string;
  version: string;
  producerPort: string;
  consumerPort: string;
}

export interface UncertaintyModel {
  method: "bounded" | "analytic" | "monte_carlo" | "bayesian" | "ensemble";
  components: Array<{
    kind:
      | "parameter"
      | "measurement"
      | "model_form"
      | "operating_condition"
      | "scenario";
    description: string;
    quantified: boolean;
  }>;
  output: "interval" | "distribution" | "scenarios";
}

export interface ModelGovernanceContract {
  intendedUse: "engineering_decision_support";
  humanApprovalRequired: true;
  autonomousOperationalActionAllowed: false;
  thresholdsPolicy: "approved_source_only";
  requiredReviewerCompetency: string;
  certificationClass: "advisory" | "engineering" | "safety_related";
  escalationClass:
    | "maintenance_planning"
    | "specialist_engineering"
    | "integrity_or_ffs"
    | "oem"
    | "regulator";
  chemistryRequiresLabEvidence: boolean;
  sourceRightsConfirmed: boolean;
}

export interface ReliabilityAssuranceContract {
  failureTaxonomy: "canonical_damage_mechanisms";
  loadSpectrumMethod: string;
  damageAccumulationMethod: string;
  mechanismInteractionPolicy:
    "independence_must_be_evidenced" | "approved_interaction_model_required";
  censoringPolicy: string;
  cohortingFields: string[];
  calibration: {
    calibrationDatasetRequired: boolean;
    holdoutValidationRequired: boolean;
    residualChecksRequired: boolean;
    recalibrationTriggers: string[];
  };
  decisionSupport: {
    consequenceAwareThresholds: boolean;
    inspectionPlanningUsesValueOfInformation: boolean;
    probabilityOfDetectionRequired: boolean;
    interventionEffectModelRequired: boolean;
    asMaintainedConfigurationRequired: boolean;
    physicalAndEconomicRulSeparated: boolean;
    commonCauseAssessmentRequired: boolean;
    modelConflictRequiresHumanReview: boolean;
    fitnessForServiceEscalationConditions: string[];
    repairabilityAndFeasibilityRequired: boolean;
  };
  learning: {
    outcomeRecordingRequired: boolean;
    counterfactualReviewRequired: boolean;
    designFeedbackRequired: boolean;
    retirementTriggers: string[];
  };
  nonPhysicsRcaBranchesPreserved: boolean;
}

export interface PhysicsModelPackManifest {
  schemaVersion: "1.0.0";
  modelKey: string;
  version: string;
  name: string;
  description: string;
  modelKind: EngineeringModelKind;
  domain: string;
  lifeModelType?: PhysicsOfFailureModelType;
  mechanismKeys: string[];
  authoring: {
    tool: "gpd" | "syncai" | "manual" | "oem" | "standards_body";
    toolVersion: string;
    mode: "quick_check" | "full_model_project";
    sourceLicense: string;
    sourceReference: string;
    createdAt: string;
  };
  artifacts: ModelArtifactReference[];
  governingEquations: Array<{
    id: string;
    expression: string;
    formulaReference: string;
  }>;
  assumptions: string[];
  boundaryConditions: string[];
  parameters: ModelParameterDefinition[];
  ports: EngineeringModelPort[];
  conventions: EngineeringConventionSet;
  applicability: ModelApplicabilityEnvelope;
  verification: VerificationContract;
  evidenceRequirements: ModelEvidenceRequirement[];
  uncertainty: UncertaintyModel;
  dependencies: ModelDependencyReference[];
  standards: Array<{
    designation: string;
    relationship: "normative" | "informative" | "oem_proprietary";
    usageRights: string;
  }>;
  environment: ReproducibleEnvironment;
  governance: ModelGovernanceContract;
  reliabilityAssurance: ReliabilityAssuranceContract;
  execution: {
    runtimeMode: "allowlisted_deterministic";
    calculationKey: string;
    operationalNetworkRequired: false;
    arbitraryCodeAllowed: false;
  };
}

export interface MeasurementQuality {
  calibrationCurrent: boolean;
  samplingAdequate: boolean;
  missingFraction: number;
  driftDetected: boolean;
  uncertainty?: number;
}

export interface ModelInputValue {
  value: number | string | boolean;
  unit: string;
  evidenceItemId?: string;
  sourceReference: string;
  evidenceGrade: EvidenceGrade;
  measurementQuality?: MeasurementQuality;
}

export interface ModelEvaluationContext {
  assetFamily: string;
  componentCategory: string;
  operatingState: string;
  activeConditionCodes: string[];
  configurationBaselineId?: string;
  inputs: Record<string, ModelInputValue>;
}

export interface ModelRefusal {
  code: string;
  message: string;
  path?: string;
}

export interface ApplicabilityAssessment {
  applicable: boolean;
  refusals: ModelRefusal[];
}

export interface VerificationResultInput {
  checkId: string;
  passed: boolean;
  evidenceItemId?: string;
  runReference: string;
}

export interface ModelPromotionEvidence {
  verificationResults: VerificationResultInput[];
  evidenceRequirementKeys: string[];
  benchValidationEvidenceIds: string[];
  fieldValidationEvidenceIds: string[];
  blockingDebtCount: number;
  reviewerUserId?: string;
  authorUserId?: string;
  reviewerCompetencies: string[];
  applicabilityMachineReadable: boolean;
}
