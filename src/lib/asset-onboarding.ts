export type AssetOnboardingMode =
  | "quick"
  | "standard"
  | "deep"
  | "regulatory"
  | "fleet";

export type AssetClass =
  | "generic"
  | "pump"
  | "conveyor"
  | "mobile_equipment"
  | "fleet"
  | "compressor"
  | "motor";

export type OnboardingSource =
  | "manual"
  | "file"
  | "sap_export"
  | "maximo_export"
  | "pid"
  | "oem_manual"
  | "work_order_history";

export type OnboardingStatus =
  | "not_started"
  | "in_progress"
  | "complete";

export type AssetOnboardingLifecycle =
  | "new"
  | "newly_commissioned"
  | "in_service"
  | "used"
  | "rebuilt"
  | "transferred"
  | "unknown";

export type AssetOnboardingIndustry =
  | "general"
  | "oil_sands"
  | "mining"
  | "oil_gas"
  | "petrochemical"
  | "power"
  | "utilities"
  | "manufacturing"
  | "pulp_paper"
  | "rail"
  | "aviation"
  | "water_wastewater"
  | "defense";

export type OnboardingStepId =
  | "asset_identity"
  | "hierarchy"
  | "function"
  | "operating_context"
  | "criticality"
  | "failure_modes"
  | "existing_maintenance"
  | "recommended_strategy"
  | "condition_monitoring"
  | "spares"
  | "reliability_baseline"
  | "fracas_readiness"
  | "risk_safeguards"
  | "lifecycle"
  | "final_package";

export interface AssetOnboardingCommand {
  raw: string;
  isOnboarding: boolean;
  assetClass: AssetClass;
  assetId?: string;
  mode: AssetOnboardingMode;
  source: OnboardingSource;
  lifecycle: AssetOnboardingLifecycle;
  industry: AssetOnboardingIndustry;
  intent:
    | "start"
    | "status"
    | "gaps"
    | "complete"
    | "export"
    | "generate_fmea"
    | "generate_pm_strategy"
    | "generate_fracas"
    | "generate_criticality"
    | "generate_spares"
    | "generate_reliability_baseline";
}

export interface OnboardingStepDefinition {
  id: OnboardingStepId;
  name: string;
  purpose: string;
  requiredFields: string[];
  optionalFields: string[];
  validationRules: string[];
  questions: string[];
  outputs: string[];
}

export interface OnboardingStepState extends OnboardingStepDefinition {
  completionStatus: OnboardingStatus;
  completionScore: number;
  confidenceScore: number;
  source: OnboardingSource | "generated";
  answer?: string;
  lastUpdated?: string;
}

export interface AssetFailureMode {
  failureMode: string;
  failureMechanism: string;
  cause: string;
  effect: string;
  detectionMethod: string;
  consequence: string;
  currentControls: string;
  recommendedControls: string;
}

export interface MaintenanceTaskRecommendation {
  recommendation: string;
  failureModeAddressed: string;
  riskReduced: string;
  evidenceUsed: string[];
  assumptions: string[];
  confidence: "low" | "medium" | "high";
  requiredApproval: string;
  implementationWorkOrder: string;
}

export interface CriticalityResult {
  score: number;
  maxScore: number;
  criticalityClass: "low" | "medium" | "high" | "critical";
  riskDrivers: string[];
  recommendedStrategyIntensity: string;
  approvalRequirements: string[];
}

export interface AssetOnboardingProfile {
  onboardingContext: {
    lifecycle: AssetOnboardingLifecycle;
    industry: AssetOnboardingIndustry;
    industryTemplateName: string;
    industryTemplateCode: string;
    sourceTables: string[];
    pathSummary: string;
    commercialUse: string;
  };
  identity: Record<string, string>;
  hierarchy: {
    recommendedPlacement: string[];
    parentChildRelationships: string[];
    missingLevels: string[];
    qualityScore: number;
    flags: string[];
  };
  functionalDefinition: Record<string, string>;
  operatingContext: Record<string, string>;
  criticality: CriticalityResult;
  failureModes: AssetFailureMode[];
  existingMaintenance: {
    capturedTasks: string[];
    taskQualityFlags: string[];
    evaluationCriteria: string[];
  };
  recommendedStrategy: MaintenanceTaskRecommendation[];
  conditionMonitoring: {
    plan: string[];
    measurementPoints: string[];
    alertResponseProcedure: string[];
    pFCurve: string[];
    requiredBaseline: string[];
  };
  spares: {
    recommendedBom: string[];
    criticalSpares: string[];
    stockingRecommendations: string[];
    sparesRiskScore: number;
    missingBomItems: string[];
  };
  reliabilityBaseline: {
    failureCount: number;
    mtbfHours?: number;
    mttrHours?: number;
    availability?: number;
    downtimeContributionHours: number;
    maintenanceCost: number;
    badActorStatus: string;
    repeatFailureRate: string;
    reactiveWorkPercent?: number;
    pmCompliance?: number;
    scheduleCompliance?: number;
    dataQualityScore: number;
    missingData: string[];
    confidence: "low" | "medium" | "high";
  };
  fracasReadiness: {
    failureEventIntakeFields: string[];
    assetSpecificFailureCodes: string[];
    investigationTriggerThresholds: string[];
    rcaTriggerCriteria: string[];
    correctiveActionWorkflow: string[];
    effectivenessCheckTiming: string;
    recurrenceDetectionRules: string[];
  };
  riskSafeguards: {
    safetyCriticality: string;
    safetyAndComplianceNotes: string[];
    humanApprovalGates: string[];
    doNotChangeRules: string[];
  };
  lifecycle: {
    lifecycleStatus: string;
    remainingUsefulLifeEstimate: string;
    obsolescenceRisk: string;
    replacementPlanningRecommendation: string;
    capitalRiskNote: string;
    longTermAssetStrategy: string;
  };
}

export interface AssetOnboardingPackage {
  assetProfile: string;
  hierarchyRecommendation: string[];
  operatingContext: Record<string, string>;
  criticalityAssessment: CriticalityResult;
  fmea: AssetFailureMode[];
  maintenanceStrategy: MaintenanceTaskRecommendation[];
  conditionMonitoringPlan: string[];
  sparesRecommendation: string[];
  reliabilityBaseline: AssetOnboardingProfile["reliabilityBaseline"];
  fracasSetup: AssetOnboardingProfile["fracasReadiness"];
  lifecyclePlan: AssetOnboardingProfile["lifecycle"];
  dataGaps: string[];
  approvalChecklist: string[];
  implementationActions: string[];
}

export interface AssetOnboardingExports {
  markdown: string;
  json: string;
  wordHtml: string;
  pdfHtml: string;
  excelWorkbookCsv: string;
  cmmsImportCsv: string;
  powerBiDatasetJson: string;
  apiPayloadJson: string;
}

export interface AssetOnboardingSession {
  sessionId: string;
  tenantId: string;
  assetId: string;
  assetClass: AssetClass;
  mode: AssetOnboardingMode;
  source: OnboardingSource;
  lifecycle: AssetOnboardingLifecycle;
  industry: AssetOnboardingIndustry;
  status: "active" | "completed";
  currentStep: OnboardingStepId;
  completionScore: number;
  reliabilityReadiness: "low" | "medium" | "high" | "complete";
  readinessMessage: string;
  missingFields: string[];
  assumptions: string[];
  recommendations: string[];
  approvalRequired: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  steps: OnboardingStepState[];
  profile: AssetOnboardingProfile;
  finalPackage: AssetOnboardingPackage;
}

const STEP_DEFINITIONS: OnboardingStepDefinition[] = [
  {
    id: "asset_identity",
    name: "Asset identity",
    purpose:
      "Identify the asset and accountable owners before reliability analysis starts.",
    requiredFields: [
      "Asset tag",
      "Asset name",
      "Asset type",
      "Functional location",
      "Site",
      "Area",
      "System",
      "Operations owner",
      "Maintenance owner",
      "Reliability owner",
      "OEM",
      "Model",
      "Serial number",
      "Commissioning date",
    ],
    optionalFields: ["Subsystem", "Unit", "Process", "Owner department"],
    validationRules: [
      "Asset tag must be unique within the tenant.",
      "At least one accountable owner must be named before completion.",
      "Commissioning date should not be in the future.",
    ],
    questions: [
      "What is the asset tag, name, type, and functional location?",
      "Who owns it for operations, maintenance, and reliability?",
      "What OEM, model, serial number, and commissioning date are known?",
    ],
    outputs: ["Asset identity record", "Ownership map", "Identity data gaps"],
  },
  {
    id: "hierarchy",
    name: "Hierarchy",
    purpose:
      "Place the asset in a reliability-ready hierarchy from enterprise down to maintainable item.",
    requiredFields: [
      "Enterprise",
      "Site",
      "Plant",
      "Area",
      "Process unit",
      "System",
      "Subsystem",
      "Equipment",
      "Component",
      "Maintainable item",
    ],
    optionalFields: ["Part", "Functional location", "Installed spare"],
    validationRules: [
      "Asset should not be assigned directly to site without a system.",
      "Driven equipment should link to driver equipment where applicable.",
      "Functional location and equipment tag should not conflict.",
    ],
    questions: [
      "Where does this asset sit in the enterprise/site/plant/area/system hierarchy?",
      "What parent asset, child assets, driver, driven equipment, or maintainable items should be linked?",
      "Are there known hierarchy problems or spare/installed-asset mismatches?",
    ],
    outputs: [
      "Recommended hierarchy placement",
      "Parent-child relationships",
      "Missing hierarchy levels",
      "Hierarchy quality score",
    ],
  },
  {
    id: "function",
    name: "Function",
    purpose:
      "Define what the asset must do, under what performance standard, before RCA/FMEA/RCM can be credible.",
    requiredFields: [
      "Primary function",
      "Performance standard",
      "Required capacity",
      "Required pressure",
      "Required flow",
      "Required speed",
      "Required temperature",
      "Required duty cycle",
      "Standby/operating role",
      "Mission duration",
      "Demand profile",
    ],
    optionalFields: ["Secondary functions", "Quality requirements"],
    validationRules: [
      "Function must include a verb, object, and performance standard.",
      "Mission duration and duty cycle must be stated for RAM use.",
    ],
    questions: [
      "What is the primary function in measurable terms?",
      "What capacity, pressure, flow, speed, temperature, duty cycle, and demand profile are required?",
      "Is this asset operating, standby, emergency, or intermittent?",
    ],
    outputs: ["Functional definition", "Performance standard", "RCM basis"],
  },
  {
    id: "operating_context",
    name: "Operating context",
    purpose:
      "Capture the operating conditions that change failure modes, detection methods, intervals, and risk.",
    requiredFields: [
      "Duty type",
      "Operating hours per year",
      "Starts/stops per day",
      "Load profile",
      "Process fluid/material",
      "Ambient conditions",
      "Contamination exposure",
      "Corrosion exposure",
      "Dust exposure",
      "Moisture exposure",
      "Temperature range",
      "Vibration exposure",
      "Shock/loading conditions",
      "Operator interaction",
      "Accessibility constraints",
      "Safety/environmental hazards",
    ],
    optionalFields: [
      "Fluid specific gravity",
      "Viscosity",
      "Solids content",
      "NPSH margin",
      "Operating point vs BEP",
      "Belt width",
      "Belt speed",
      "Tonnage",
      "Payload",
      "Route profile",
    ],
    validationRules: [
      "Operating hours must be numeric when used for reliability calculations.",
      "Asset-class-specific context must be captured before PM optimization.",
    ],
    questions: [
      "Is duty continuous, intermittent, standby, or demand-based?",
      "What process, environmental, load, contamination, and access conditions matter?",
      "What asset-class-specific operating details are known?",
    ],
    outputs: [
      "Operating context",
      "Asset-class-specific questions",
      "Context data gaps",
    ],
  },
  {
    id: "criticality",
    name: "Criticality",
    purpose:
      "Score consequence, likelihood, detectability, redundancy, and regulatory exposure.",
    requiredFields: [
      "Safety consequence",
      "Environmental consequence",
      "Production consequence",
      "Quality consequence",
      "Maintenance cost consequence",
      "Repair time consequence",
      "Spares availability",
      "Redundancy",
      "Detectability",
      "Failure frequency",
      "Regulatory exposure",
    ],
    optionalFields: ["Risk matrix", "Business interruption cost"],
    validationRules: [
      "Safety and environmental consequence must override purely financial priority.",
      "No installed standby should increase strategy intensity.",
    ],
    questions: [
      "What happens if this asset fails for safety, environment, production, quality, cost, and repair time?",
      "Is there redundancy or standby coverage?",
      "How detectable is degradation before failure?",
    ],
    outputs: [
      "Criticality score",
      "Criticality class",
      "Risk drivers",
      "Strategy intensity",
      "Approval requirements",
    ],
  },
  {
    id: "failure_modes",
    name: "Failure modes",
    purpose:
      "Generate an asset-specific failure mode library and starter FMEA rows.",
    requiredFields: [
      "Failure mode",
      "Failure mechanism",
      "Cause",
      "Effect",
      "Detection method",
      "Consequence",
      "Current controls",
      "Recommended controls",
      "Data codes",
    ],
    optionalFields: ["Severity", "Occurrence", "Detection", "RPN"],
    validationRules: [
      "Each PM task should link to at least one credible failure mode.",
      "Current and recommended controls must be distinct.",
    ],
    questions: [
      "Which failure modes are known from history, OEM guidance, or SME knowledge?",
      "What mechanisms and causes are most likely in this operating context?",
      "How would each mode be detected and controlled?",
    ],
    outputs: ["Draft FMEA", "Failure mode library", "Recommended data codes"],
  },
  {
    id: "existing_maintenance",
    name: "Existing maintenance",
    purpose:
      "Capture and challenge current PMs, inspections, lubrication, condition monitoring, rounds, shutdown tasks, and run-to-failure items.",
    requiredFields: [
      "Current PMs",
      "Inspection tasks",
      "Lubrication tasks",
      "Condition monitoring tasks",
      "Calibration tasks",
      "Statutory tasks",
      "Operator rounds",
      "Shutdown tasks",
      "Overhaul tasks",
      "Failure-finding tasks",
      "Run-to-failure items",
    ],
    optionalFields: ["Task interval basis", "Acceptance criteria", "Skills"],
    validationRules: [
      "Task must state objective, interval, basis, acceptance criteria, skill, duration, shutdown need, and safety requirement where applicable.",
      "Tasks with no linked failure mode or no acceptance criteria must be flagged.",
    ],
    questions: [
      "What PMs, inspections, lubrication, calibration, condition monitoring, rounds, shutdown, overhaul, and failure-finding tasks currently exist?",
      "What is the objective, interval, basis, acceptance criteria, skill, duration, and shutdown need?",
      "Which tasks are duplicated, vague, intrusive, or not linked to a failure mode?",
    ],
    outputs: [
      "Existing strategy capture",
      "Task quality flags",
      "Low-value or risky PM flags",
    ],
  },
  {
    id: "recommended_strategy",
    name: "Recommended strategy",
    purpose:
      "Create failure-mode-based maintenance recommendations with evidence, assumptions, confidence, approvals, and implementation actions.",
    requiredFields: [
      "Failure-mode-based PMs",
      "Condition monitoring tasks",
      "Operator care tasks",
      "Lubrication strategy",
      "Inspection strategy",
      "Calibration strategy",
      "Overhaul strategy",
      "Run-to-failure decisions",
      "Spares recommendations",
      "Task intervals",
      "Task basis",
    ],
    optionalFields: ["Implementation work order", "Shutdown window"],
    validationRules: [
      "Each recommendation must name the failure mode addressed and risk reduced.",
      "High-risk strategy changes require human approval.",
    ],
    questions: [
      "Which failure modes need PM, condition monitoring, operator care, lubrication, overhaul, or run-to-failure treatment?",
      "What interval and basis are defensible?",
      "What approval or implementation work order is required?",
    ],
    outputs: [
      "Recommended maintenance strategy",
      "Implementation work orders",
      "Approval requirements",
    ],
  },
  {
    id: "condition_monitoring",
    name: "Condition monitoring",
    purpose:
      "Define monitoring points, baselines, limits, P-F interval, routes, and response procedures.",
    requiredFields: [
      "Existing monitoring methods",
      "Measurement points",
      "Process indicators",
      "Inspection routes",
      "Alarm limits",
      "Baseline data",
      "P-F interval estimate",
      "Response procedure",
    ],
    optionalFields: [
      "Vibration points",
      "Oil analysis points",
      "Ultrasound points",
      "Thermography points",
    ],
    validationRules: [
      "Monitoring task must name a failure precursor and a response action.",
      "Alarm limits should not be changed without engineering approval.",
    ],
    questions: [
      "What monitoring methods and measurement points exist today?",
      "What baseline data and alarm limits are available?",
      "What is the estimated P-F interval and response procedure?",
    ],
    outputs: [
      "Condition monitoring plan",
      "Measurement point list",
      "Alert response procedure",
      "P-F curve",
      "Required baseline",
    ],
  },
  {
    id: "spares",
    name: "Spares and materials",
    purpose:
      "Capture BOM, critical spares, lead time, repairables, rotables, substitutes, stock levels, and obsolescence risk.",
    requiredFields: [
      "Critical spares",
      "Insurance spares",
      "Consumables",
      "Long-lead items",
      "Repairables",
      "Rotables",
      "BOM",
      "Vendor",
      "Lead time",
      "Stock level",
      "Usage history",
      "Substitutes",
      "Obsolescence risk",
    ],
    optionalFields: ["Vendor support status", "Interchangeability notes"],
    validationRules: [
      "Long-lead high-criticality spares must be flagged.",
      "BOM gaps should block final readiness from complete status.",
    ],
    questions: [
      "What critical, insurance, consumable, long-lead, repairable, and rotable parts exist?",
      "What vendor, lead time, stock level, usage history, substitutes, and obsolescence risks are known?",
      "What BOM items are missing?",
    ],
    outputs: [
      "Recommended BOM",
      "Critical spares list",
      "Stocking recommendations",
      "Spares risk score",
      "Missing BOM items",
    ],
  },
  {
    id: "reliability_baseline",
    name: "Reliability baseline",
    purpose:
      "Import or collect failure, downtime, repair, work order, cost, production loss, condition, inspection, oil, vibration, and operator history.",
    requiredFields: [
      "Failure history",
      "Downtime history",
      "Repair time",
      "Work order history",
      "Cost history",
      "Production loss",
      "Condition monitoring history",
      "Inspection findings",
      "Oil analysis history",
      "Vibration history",
      "Operator logs",
    ],
    optionalFields: ["Warranty claims", "Fleet history"],
    validationRules: [
      "Operating hours and true failure count are required before MTBF is trusted.",
      "Repair-event boundaries are required before MTTR is trusted.",
    ],
    questions: [
      "What failure, downtime, repair, work order, cost, production loss, and condition history exists?",
      "What operating exposure should be used for MTBF and availability?",
      "What data quality gaps block PM interval optimization?",
    ],
    outputs: [
      "Failure count",
      "MTBF",
      "MTTR",
      "Availability",
      "Downtime contribution",
      "Maintenance cost",
      "Bad actor status",
      "Repeat failure rate",
      "Reactive work percent",
      "PM compliance",
      "Schedule compliance",
      "Data quality score",
      "Baseline confidence",
    ],
  },
  {
    id: "fracas_readiness",
    name: "FRACAS readiness",
    purpose:
      "Define failure event intake, asset-specific failure codes, RCA triggers, corrective action workflow, effectiveness timing, and recurrence rules.",
    requiredFields: [
      "Failure event intake form",
      "Asset-specific failure codes",
      "Investigation trigger thresholds",
      "RCA trigger criteria",
      "Corrective action workflow",
      "Effectiveness check timing",
      "Recurrence detection rules",
    ],
    optionalFields: ["Failure review board cadence", "Escalation matrix"],
    validationRules: [
      "RCA triggers must include repeat failure, downtime, safety/environmental consequence, and cost threshold.",
      "Effectiveness check must happen after enough operating exposure.",
    ],
    questions: [
      "What fields should every failure event capture for this asset?",
      "When should a failure trigger RCA or formal FRACAS review?",
      "How will corrective action effectiveness and recurrence be checked?",
    ],
    outputs: [
      "Failure event intake form",
      "Asset-specific failure codes",
      "RCA trigger criteria",
      "Corrective action workflow",
      "Effectiveness checks",
      "Recurrence rules",
    ],
  },
  {
    id: "risk_safeguards",
    name: "Risk and safeguards",
    purpose:
      "Document safety, environmental, energy, regulatory, OEM, and engineering approval boundaries.",
    requiredFields: [
      "Safety criticality",
      "Environmental controls",
      "LOTO requirements",
      "Confined space exposure",
      "Pressure energy",
      "Electrical hazards",
      "Stored energy",
      "Lifting requirements",
      "Regulatory inspection requirements",
      "OEM constraints",
      "Engineering approval needs",
    ],
    optionalFields: ["Operating envelope", "Integrity operating window"],
    validationRules: [
      "Safety, environmental, regulatory, OEM-limit, pressure, lifting, electrical, shutdown, and startup decisions require human approval.",
      "Do-not-change rules must be explicit before strategy export.",
    ],
    questions: [
      "What safety, environmental, stored-energy, electrical, pressure, lifting, and regulatory hazards apply?",
      "What OEM limits, operating-envelope rules, and engineering approval gates must not be bypassed?",
      "What changes should the system refuse to auto-approve?",
    ],
    outputs: [
      "Safety and compliance notes",
      "Human approval gates",
      "Do-not-change rules",
    ],
  },
  {
    id: "lifecycle",
    name: "Lifecycle profile",
    purpose:
      "Capture age, design life, remaining useful life, obsolescence, degradation, replacement cost, repair cost, upgrades, technology risk, and vendor support.",
    requiredFields: [
      "Age",
      "Design life",
      "Remaining useful life estimate",
      "Obsolescence risk",
      "Known degradation mechanisms",
      "Replacement cost",
      "Repair cost",
      "Upgrade options",
      "Technology risk",
      "Vendor support status",
    ],
    optionalFields: ["Capital plan", "Long-range outage window"],
    validationRules: [
      "Lifecycle recommendations must distinguish evidence from assumption.",
      "Replacement planning should consider risk, supportability, and cost of unreliability.",
    ],
    questions: [
      "How old is the asset and what design life should be used?",
      "What degradation, obsolescence, replacement, repair, upgrade, and vendor-support risks are known?",
      "What capital or lifecycle planning decision is needed?",
    ],
    outputs: [
      "Lifecycle status",
      "Replacement planning recommendation",
      "Capital risk note",
      "Long-term asset strategy",
    ],
  },
  {
    id: "final_package",
    name: "Final package",
    purpose:
      "Generate the reliability-ready asset profile and export payloads.",
    requiredFields: [
      "Asset profile",
      "Hierarchy recommendation",
      "Operating context",
      "Criticality assessment",
      "FMEA",
      "Maintenance strategy",
      "Condition monitoring plan",
      "Spares recommendation",
      "Reliability baseline",
      "FRACAS setup",
      "Lifecycle plan",
      "Data gaps",
      "Approval checklist",
      "Implementation action list",
    ],
    optionalFields: [
      "PDF export",
      "Word export",
      "Excel export",
      "JSON export",
      "CMMS import file",
      "Power BI dataset",
      "API payload",
    ],
    validationRules: [
      "Final package must preserve assumptions and approval gates.",
      "Incomplete fields must remain visible as data gaps.",
    ],
    questions: [
      "Review the generated package and confirm what should be exported.",
      "Which gaps block PM optimization or strategy approval?",
      "Which actions should be implemented first?",
    ],
    outputs: [
      "Asset profile",
      "Reliability-ready package",
      "Export payloads",
      "Approval checklist",
      "Implementation action list",
    ],
  },
];

const ASSET_CLASS_ALIASES: Record<string, AssetClass> = {
  asset: "generic",
  equipment: "generic",
  pump: "pump",
  pumps: "pump",
  centrifugal: "pump",
  conveyor: "conveyor",
  conveyors: "conveyor",
  belt: "conveyor",
  truck: "mobile_equipment",
  trucks: "mobile_equipment",
  haul: "mobile_equipment",
  loader: "mobile_equipment",
  mobile: "mobile_equipment",
  fleet: "fleet",
  fleets: "fleet",
  compressor: "compressor",
  compressors: "compressor",
  motor: "motor",
  motors: "motor",
};

const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  generic: "Generic asset",
  pump: "Centrifugal pump",
  conveyor: "Conveyor",
  mobile_equipment: "Mobile equipment",
  fleet: "Fleet",
  compressor: "Compressor",
  motor: "Electric motor",
};

const INDUSTRY_ALIASES: Record<string, AssetOnboardingIndustry> = {
  general: "general",
  industrial: "general",
  "oil-sands": "oil_sands",
  oilsands: "oil_sands",
  oil_sands: "oil_sands",
  mining: "mining",
  mine: "mining",
  "oil-gas": "oil_gas",
  oil_gas: "oil_gas",
  "o&g": "oil_gas",
  petrochemical: "petrochemical",
  power: "power",
  utilities: "utilities",
  utility: "utilities",
  manufacturing: "manufacturing",
  "pulp-paper": "pulp_paper",
  pulp_paper: "pulp_paper",
  rail: "rail",
  aviation: "aviation",
  "water-wastewater": "water_wastewater",
  water_wastewater: "water_wastewater",
  defense: "defense",
};

const INDUSTRY_TEMPLATE_LABELS: Record<AssetOnboardingIndustry, string> = {
  general: "General industrial reliability template",
  oil_sands: "Oil sands safety, environment, and production template",
  mining: "Mining production and safety template",
  oil_gas: "Oil and gas integrity and production template",
  petrochemical: "Petrochemical process safety and availability template",
  power: "Power generation availability template",
  utilities: "Utilities continuity and regulatory template",
  manufacturing: "Manufacturing OEE and quality template",
  pulp_paper: "Pulp and paper uptime and process reliability template",
  rail: "Rail maintenance and safety template",
  aviation: "Aviation maintenance and compliance template",
  water_wastewater: "Water and wastewater continuity template",
  defense: "Defense sustainment and readiness template",
};

const LIFECYCLE_ALIASES: Record<string, AssetOnboardingLifecycle> = {
  new: "new",
  purchased: "new",
  design: "new",
  procurement: "new",
  commissioning: "newly_commissioned",
  commissioned: "newly_commissioned",
  "newly-commissioned": "newly_commissioned",
  existing: "in_service",
  "in-service": "in_service",
  in_service: "in_service",
  operating: "in_service",
  used: "used",
  acquired: "used",
  brownfield: "used",
  rebuilt: "rebuilt",
  refurbished: "rebuilt",
  transferred: "transferred",
  transfer: "transferred",
  unknown: "unknown",
};

const LIFECYCLE_LABELS: Record<AssetOnboardingLifecycle, string> = {
  new: "New asset",
  newly_commissioned: "Newly commissioned asset",
  in_service: "Existing in-service asset",
  used: "Used or inherited asset",
  rebuilt: "Rebuilt or refurbished asset",
  transferred: "Transferred asset",
  unknown: "Unknown-condition asset",
};

function nowIso(now = new Date()): string {
  return now.toISOString();
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function parseAssetOnboardingCommand(
  rawCommand: string,
): AssetOnboardingCommand {
  const raw = rawCommand.trim();
  const normalized = raw.toLowerCase();
  const tokens = normalized.split(/\s+/).filter(Boolean);

  const generateMap: Record<string, AssetOnboardingCommand["intent"]> = {
    fmea: "generate_fmea",
    "pm-strategy": "generate_pm_strategy",
    pm: "generate_pm_strategy",
    fracas: "generate_fracas",
    fracAS: "generate_fracas",
    criticality: "generate_criticality",
    spares: "generate_spares",
    "reliability-baseline": "generate_reliability_baseline",
    baseline: "generate_reliability_baseline",
  };

  const isOnboarding = normalized.startsWith("/onboard");
  const isGenerate = normalized.startsWith("/generate");

  if (!isOnboarding && !isGenerate) {
    return {
      raw,
      isOnboarding: false,
      assetClass: "generic",
      mode: "standard",
      source: "manual",
      lifecycle: "in_service",
      industry: "general",
      intent: "start",
    };
  }

  let intent: AssetOnboardingCommand["intent"] = "start";
  if (isOnboarding) {
    if (tokens.includes("status")) intent = "status";
    if (tokens.includes("gaps")) intent = "gaps";
    if (tokens.includes("complete")) intent = "complete";
    if (tokens.includes("export")) intent = "export";
  }
  if (isGenerate) {
    intent = generateMap[tokens[1] ?? ""] ?? "start";
  }

  let mode: AssetOnboardingMode = "standard";
  if (tokens.includes("quick")) mode = "quick";
  if (tokens.includes("deep")) mode = "deep";
  if (tokens.includes("regulatory") || tokens.includes("safety-critical")) {
    mode = "regulatory";
  }
  if (tokens.includes("fleet")) mode = "fleet";

  const lifecycleToken = tokens.find((token) => LIFECYCLE_ALIASES[token]);
  const lifecycle =
    lifecycleToken !== undefined
      ? LIFECYCLE_ALIASES[lifecycleToken]
      : tokens.includes("from") && (tokens.includes("sap") || tokens.includes("maximo") || tokens.includes("work"))
        ? "in_service"
        : "in_service";

  const industryToken = tokens.find((token) => INDUSTRY_ALIASES[token]);
  const industry =
    industryToken !== undefined ? INDUSTRY_ALIASES[industryToken] : "general";

  let source: OnboardingSource = "manual";
  if (tokens.includes("file")) source = "file";
  if (tokens.includes("sap")) source = "sap_export";
  if (tokens.includes("maximo")) source = "maximo_export";
  if (tokens.includes("p&id") || tokens.includes("pid")) source = "pid";
  if (tokens.includes("oem") || tokens.includes("manual")) source = "oem_manual";
  if (tokens.includes("work") && tokens.includes("history")) {
    source = "work_order_history";
  }

  const assetClassToken = tokens.find((token) => ASSET_CLASS_ALIASES[token]);
  const assetClass =
    assetClassToken !== undefined ? ASSET_CLASS_ALIASES[assetClassToken] : "generic";
  const commandWords = new Set([
    "/onboard",
    "/generate",
    "asset",
    "from",
    "quick",
    "standard",
    "deep",
    "regulatory",
    "safety-critical",
    "status",
    "gaps",
    "complete",
    "export",
    "file",
    "sap",
    "maximo",
    "p&id",
    "pid",
    "oem",
    "manual",
    "work",
    "order",
    "history",
    "fmea",
    "pm-strategy",
    "pm",
    "fracas",
    "criticality",
    "spares",
    "reliability-baseline",
    "baseline",
    "new",
    "purchased",
    "design",
    "procurement",
    "commissioning",
    "commissioned",
    "newly-commissioned",
    "existing",
    "in-service",
    "in_service",
    "operating",
    "used",
    "acquired",
    "brownfield",
    "rebuilt",
    "refurbished",
    "transferred",
    "transfer",
    "unknown",
  ]);
  Object.keys(ASSET_CLASS_ALIASES).forEach((word) => commandWords.add(word));
  Object.keys(INDUSTRY_ALIASES).forEach((word) => commandWords.add(word));

  const originalTokens = raw.split(/\s+/).filter(Boolean);
  const assetId = originalTokens.find((token) => {
    const lower = token.toLowerCase();
    return !commandWords.has(lower) && !lower.startsWith("/");
  });

  return {
    raw,
    isOnboarding: true,
    assetClass,
    assetId,
    mode,
    source,
    lifecycle,
    industry,
    intent,
  };
}

export function getOnboardingStepDefinitions() {
  return STEP_DEFINITIONS.map((step) => ({ ...step }));
}

function getAssetSpecificQuestions(assetClass: AssetClass): string[] {
  if (assetClass === "pump") {
    return [
      "Fluid, specific gravity, viscosity, solids content, suction conditions, NPSH margin, seal type, and operating point vs BEP.",
    ];
  }
  if (assetClass === "conveyor") {
    return [
      "Belt width, belt speed, material handled, tonnage, incline, take-up type, pulley arrangement, cleaning system, and idler type.",
    ];
  }
  if (assetClass === "mobile_equipment" || assetClass === "fleet") {
    return [
      "Hours/km, duty cycle, payload, route profile, operator variability, fuel/electric usage, and maintenance bay constraints.",
    ];
  }
  if (assetClass === "compressor") {
    return [
      "Gas/service, pressure ratio, driver, cooling method, lubrication system, surge margin, and duty cycle.",
    ];
  }
  if (assetClass === "motor") {
    return [
      "Voltage, power rating, enclosure, insulation class, duty, driven equipment, starts/hour, and protection settings.",
    ];
  }
  return ["Operating envelope, duty cycle, process conditions, access constraints, and known failure mechanisms."];
}

function getLifecycleSpecificQuestions(lifecycle: AssetOnboardingLifecycle): string[] {
  if (lifecycle === "new") {
    return [
      "Confirm OEM manual, datasheet, P&ID, commissioning date, warranty dates, reliability requirements, FAT/SAT records, and baseline measurements before service.",
    ];
  }
  if (lifecycle === "newly_commissioned") {
    return [
      "Confirm commissioning punch list closure, early-life failures, warranty obligations, baseline vibration/oil/thermal readings, and PM/BOM load into CMMS.",
    ];
  }
  if (lifecycle === "used" || lifecycle === "in_service") {
    return [
      "Import work-order history, verify field configuration, assess current condition, compare actual duty against design duty, and score data quality before PM optimization.",
    ];
  }
  if (lifecycle === "rebuilt") {
    return [
      "Capture rebuild scope, parts replaced, test records, warranty status, reused components, acceptance criteria, and post-rebuild baseline readings.",
    ];
  }
  if (lifecycle === "transferred") {
    return [
      "Capture previous site/service, transfer date, storage conditions, configuration differences, missing history, and new operating-context mismatch risks.",
    ];
  }
  return [
    "Treat this as unknown condition: verify existence, nameplate, configuration, operating restrictions, minimum inspection evidence, and fit-for-service status.",
  ];
}

function industryContext(industry: AssetOnboardingIndustry) {
  const common = {
    name: INDUSTRY_TEMPLATE_LABELS[industry],
    templateCode: industry === "general" ? "heavy_industrial_master" : industry,
    sourceTables: [
      "deployment_templates",
      "industry_asset_libraries",
      "industry_criticality_profiles",
      "industry_governance_profiles",
      "industry_work_taxonomies",
      "industry_failure_mode_packs",
      "industry_oee_models",
    ],
    questions: [
      "Confirm the site risk matrix, approval authority, data rights, and CMMS/EAM source before publishing the asset profile.",
    ],
    riskDrivers: ["Incomplete site-specific operating context"],
    safeguards: ["Human approval required for safety, environmental, regulatory, OEM-limit, and production-critical changes."],
    failureModeNotes: ["Use customer documents and failure codes when available; generated library remains draft until SME validation."],
  };

  if (industry === "oil_sands") {
    return {
      name: INDUSTRY_TEMPLATE_LABELS[industry],
      templateCode: "oil_sands",
      sourceTables: common.sourceTables,
      questions: [
        "Confirm winterization, abrasive slurry/service exposure, tailings/process-water impacts, environmental consequence, remote repair constraints, and turnaround dependency.",
      ],
      riskDrivers: ["Environmental consequence", "Production bottleneck", "Remote execution constraints", "Abrasive or contaminated service"],
      safeguards: [
        "Route environmental, pressure, lifting, electrical, hot-work, isolation, and regulatory implications through qualified approval.",
        "Do not recommend operating-envelope or integrity-limit changes without site engineering authority.",
      ],
      failureModeNotes: [
        "Prioritize slurry/abrasive wear, contamination ingress, seal flush reliability, cold-weather exposure, corrosion/erosion, and access constraints where applicable.",
      ],
    };
  }

  if (industry === "mining") {
    return {
      name: INDUSTRY_TEMPLATE_LABELS[industry],
      templateCode: "mining",
      sourceTables: common.sourceTables,
      questions: [
        "Confirm throughput bottleneck role, dust/abrasion exposure, shift schedule, mobile/fixed plant interaction, operator variability, and safety isolation constraints.",
      ],
      riskDrivers: ["Throughput loss", "Dust and abrasive wear", "Mobile/fixed plant dependency", "Safety isolation risk"],
      safeguards: [
        "Route high-energy, guarding, lifting, mobile equipment, confined-space, and production-critical recommendations through site authority.",
        "Treat production bottleneck assets as high governance even when historical data is incomplete.",
      ],
      failureModeNotes: [
        "Prioritize abrasion, impact damage, contamination, structural fatigue, seized rotating components, belt/pulley/idler risks, and duty-cycle overload where applicable.",
      ],
    };
  }

  if (industry === "manufacturing") {
    return {
      ...common,
      questions: [
        "Confirm OEE losses, quality impact, changeover pattern, line bottleneck role, sanitation/cleaning exposure, and shift utilization.",
      ],
      riskDrivers: ["OEE loss", "Quality impact", "Line bottleneck dependency"],
    };
  }

  if (industry === "utilities" || industry === "power" || industry === "water_wastewater") {
    return {
      ...common,
      questions: [
        "Confirm continuity-of-service impact, redundancy, regulatory reporting exposure, emergency response requirements, and public/customer consequence.",
      ],
      riskDrivers: ["Service continuity", "Regulatory exposure", "Redundancy constraints"],
    };
  }

  return common;
}

function failureModeLibrary(assetClass: AssetClass): AssetFailureMode[] {
  if (assetClass === "pump") {
    return [
      {
        failureMode: "Mechanical seal leakage",
        failureMechanism: "Seal face wear or thermal/mechanical distortion",
        cause: "Poor flush, dry running, misalignment, process contamination, or operation away from BEP",
        effect: "Loss of containment, unplanned shutdown, environmental exposure, and repeat maintenance",
        detectionMethod: "Leak inspection, seal pot trend, vibration, process pressure/flow deviation",
        consequence: "Production loss and potential safety/environmental consequence",
        currentControls: "Operator rounds and basic PM inspection",
        recommendedControls: "Seal plan review, operating point verification, flush health check, and FRACAS trigger on recurrence",
      },
      {
        failureMode: "Bearing failure",
        failureMechanism: "Fatigue, lubrication degradation, contamination, or overload",
        cause: "Incorrect lubrication, water ingress, misalignment, high vibration, or installation defect",
        effect: "High vibration, heat, seizure risk, and secondary damage",
        detectionMethod: "Vibration, ultrasound, bearing temperature, oil/grease inspection",
        consequence: "Unplanned downtime and repair cost",
        currentControls: "Lubrication PM and route inspection",
        recommendedControls: "Vibration route, lubrication standard, contamination control, and precision alignment",
      },
      {
        failureMode: "Cavitation damage",
        failureMechanism: "Vapor bubble collapse and hydraulic instability",
        cause: "Insufficient NPSH margin, suction restriction, low level, high temperature, or off-curve operation",
        effect: "Impeller damage, noise, vibration, loss of performance, seal/bearing stress",
        detectionMethod: "Noise, vibration, suction/discharge pressure, flow trend, inspection",
        consequence: "Progressive degradation and reduced availability",
        currentControls: "Operator observation and process alarms",
        recommendedControls: "NPSH verification, suction screen strategy, operating envelope alarm, and hydraulic review",
      },
      {
        failureMode: "Shaft misalignment",
        failureMechanism: "Angular/parallel offset and soft-foot strain",
        cause: "Poor installation, baseplate looseness, pipe strain, thermal growth, or foundation movement",
        effect: "Coupling wear, bearing load, seal distress, high vibration",
        detectionMethod: "Vibration, alignment readings, coupling inspection, thermography",
        consequence: "Repeat rotating-equipment failures",
        currentControls: "Corrective alignment after repair",
        recommendedControls: "Precision alignment standard, pipe strain check, baseplate/foundation inspection",
      },
    ];
  }

  if (assetClass === "conveyor") {
    return [
      {
        failureMode: "Belt mistracking",
        failureMechanism: "Lateral belt drift and edge damage",
        cause: "Material buildup, pulley misalignment, idler failure, uneven loading, or take-up issue",
        effect: "Spillage, belt damage, cleanup, trip, and production interruption",
        detectionMethod: "Operator rounds, belt wander switch, inspection route, camera/vision",
        consequence: "Production loss and cleanup cost",
        currentControls: "Operator observation and corrective adjustment",
        recommendedControls: "Idler route, loading-zone inspection, cleaning-system PM, and mistracking trigger threshold",
      },
      {
        failureMode: "Idler bearing failure",
        failureMechanism: "Bearing wear, contamination, seizure, or shell wear",
        cause: "Dust/water ingress, overloading, misalignment, or inadequate sealing",
        effect: "Heat, belt damage, fire risk, drag, and unplanned replacement",
        detectionMethod: "Thermography, ultrasound, acoustic inspection, route inspection",
        consequence: "Fire/safety exposure and production loss",
        currentControls: "Visual route inspection",
        recommendedControls: "Thermography/ultrasound route, critical idler spares, and replacement criteria",
      },
      {
        failureMode: "Drive pulley lagging failure",
        failureMechanism: "Lagging wear or delamination",
        cause: "Contamination, over-tension, poor bonding, carryback, or age",
        effect: "Slip, heat, belt damage, reduced capacity",
        detectionMethod: "Slip trend, thermography, inspection, motor current trend",
        consequence: "Throughput loss and repair downtime",
        currentControls: "Shutdown inspection",
        recommendedControls: "Pulley inspection criteria, cleaning improvement, and load/tension verification",
      },
    ];
  }

  if (assetClass === "mobile_equipment" || assetClass === "fleet") {
    return [
      {
        failureMode: "Hydraulic hose failure",
        failureMechanism: "Abrasion, fatigue, burst, or fitting leak",
        cause: "Routing issue, contamination, pressure spike, age, or physical damage",
        effect: "Loss of function, spill, safety exposure, and downtime",
        detectionMethod: "Inspection, leak detection, pressure trend, operator report",
        consequence: "Safety/environmental exposure and lost availability",
        currentControls: "PM inspection",
        recommendedControls: "Hose life tracking, routing review, critical hose kits, and inspection criteria",
      },
      {
        failureMode: "Undercarriage or tire wear",
        failureMechanism: "Wear, impact, heat, or fatigue",
        cause: "Route profile, payload, operator variability, ground conditions, or inflation/tension issues",
        effect: "Reduced availability, high cost, safety exposure",
        detectionMethod: "Inspection, wear measurement, telematics, operator logs",
        consequence: "High maintenance cost and availability loss",
        currentControls: "Routine inspection",
        recommendedControls: "Route/duty review, wear trend, operator coaching, and replacement forecast",
      },
    ];
  }

  if (assetClass === "motor") {
    return [
      {
        failureMode: "Winding insulation failure",
        failureMechanism: "Thermal, electrical, moisture, contamination, or aging degradation",
        cause: "Overload, poor cooling, voltage imbalance, frequent starts, ingress, or loose connections",
        effect: "Trip, motor failure, production loss, possible electrical hazard",
        detectionMethod: "MCA, insulation resistance, thermography, current trend, protection relay event",
        consequence: "Production loss and electrical safety exposure",
        currentControls: "Protection relay and PM inspection",
        recommendedControls: "MCA route, thermography, cooling inspection, starts/hour review, and protection-setting governance",
      },
    ];
  }

  return [
    {
      failureMode: "Functional failure",
      failureMechanism: "Component degradation or operating context mismatch",
      cause: "Incomplete asset context, poor maintenance basis, or uncontrolled operating condition",
      effect: "Loss of required function and unplanned corrective work",
      detectionMethod: "Inspection, trend review, work history, and SME review",
      consequence: "Reliability risk requiring further asset-specific analysis",
      currentControls: "Existing PMs and operator awareness",
      recommendedControls: "Complete onboarding, build FMEA, and link tasks to credible failure modes",
    },
  ];
}

function defaultIdentity(assetId: string, assetClass: AssetClass) {
  return {
    "Asset tag": assetId,
    "Asset name": assetId === "NEW-ASSET" ? "" : `${assetId} ${ASSET_CLASS_LABELS[assetClass]}`,
    "Asset type": ASSET_CLASS_LABELS[assetClass],
    "Functional location": "",
    Site: "",
    Area: "",
    System: "",
    "Operations owner": "",
    "Maintenance owner": "",
    "Reliability owner": "",
    OEM: "",
    Model: "",
    "Serial number": "",
    "Commissioning date": "",
  };
}

function defaultCriticality(
  assetClass: AssetClass,
  industry: AssetOnboardingIndustry,
): CriticalityResult {
  const template = industryContext(industry);
  const riskDrivers =
    assetClass === "pump"
      ? ["Production loss", "Repeat seal/bearing failures", "Potential loss of containment", "No confirmed standby status"]
      : assetClass === "conveyor"
        ? ["Production bottleneck", "Fire risk from seized rotating components", "Cleanup and spillage exposure"]
        : assetClass === "fleet" || assetClass === "mobile_equipment"
          ? ["Availability loss", "High repair cost", "Safety/environmental exposure", "Operator variability"]
          : ["Incomplete criticality inputs", "Unknown redundancy", "Unknown consequence profile"];

  const industryLift =
    industry === "oil_sands" || industry === "mining"
      ? 8
      : industry === "petrochemical" || industry === "power" || industry === "utilities"
        ? 5
        : 0;
  const score = Math.min(
    55,
    (assetClass === "generic" ? 25 : assetClass === "conveyor" ? 39 : 36) +
      industryLift,
  );
  const criticalityClass =
    score >= 44 ? "critical" : score >= 34 ? "high" : score >= 22 ? "medium" : "low";

  return {
    score,
    maxScore: 55,
    criticalityClass,
    riskDrivers: Array.from(new Set([...riskDrivers, ...template.riskDrivers])),
    recommendedStrategyIntensity:
      criticalityClass === "high" || criticalityClass === "critical"
        ? "Condition-based maintenance plus failure-mode-based PMs and FRACAS triggers"
        : "FMEA-lite strategy with targeted inspections and data-quality improvement",
    approvalRequirements: [
      "Reliability engineer approval before PM interval changes",
      "Maintenance owner approval before task deletion",
      "Qualified engineering approval for safety, environmental, regulatory, OEM-limit, protection, or operating-envelope changes",
    ],
  };
}

function buildDefaultProfile(
  assetId: string,
  assetClass: AssetClass,
  lifecycle: AssetOnboardingLifecycle,
  industry: AssetOnboardingIndustry,
): AssetOnboardingProfile {
  const failureModes = failureModeLibrary(assetClass);
  const template = industryContext(industry);
  const criticality = defaultCriticality(assetClass, industry);
  const isNewAsset = lifecycle === "new" || lifecycle === "newly_commissioned";
  const isUsedAsset =
    lifecycle === "used" ||
    lifecycle === "in_service" ||
    lifecycle === "rebuilt" ||
    lifecycle === "transferred" ||
    lifecycle === "unknown";

  return {
    onboardingContext: {
      lifecycle,
      industry,
      industryTemplateName: template.name,
      industryTemplateCode: template.templateCode,
      sourceTables: template.sourceTables,
      pathSummary: `${LIFECYCLE_LABELS[lifecycle]} using ${template.name}.`,
      commercialUse:
        "Template-driven onboarding applies the existing SyncAI industry packs to asset context, criticality, failure modes, governance, and pilot deliverables.",
    },
    identity: defaultIdentity(assetId, assetClass),
    hierarchy: {
      recommendedPlacement: [
        "Enterprise",
        "Site",
        "Plant",
        "Area",
        "Process unit",
        "System",
        "Subsystem",
        `${ASSET_CLASS_LABELS[assetClass]} ${assetId}`,
        "Component",
        "Maintainable item",
      ],
      parentChildRelationships:
        assetClass === "pump"
          ? [`Motor -> driven equipment ${assetId}`, `${assetId} -> seal, bearings, coupling, impeller`]
          : assetClass === "conveyor"
            ? [`Conveyor system -> ${assetId}`, `${assetId} -> belt, pulleys, idlers, drive, take-up, cleaning system`]
            : [`System -> ${assetId}`, `${assetId} -> maintainable items and critical components`],
      missingLevels: ["Site", "Area", "System", "Functional location"],
      qualityScore: assetId === "NEW-ASSET" ? 20 : 35,
      flags:
        assetClass === "pump"
          ? ["Pump has no confirmed driver asset link.", "Functional location is not confirmed."]
          : assetClass === "conveyor"
            ? ["Conveyor has no confirmed upstream/downstream system links.", "Critical idler/pulley components are not confirmed."]
            : ["Asset hierarchy requires validation before reliability calculations are trusted."],
    },
    functionalDefinition: {
      "Primary function":
        assetClass === "pump"
          ? `Transfer process fluid at required flow and pressure during assigned operating duty for ${assetId}.`
          : assetClass === "conveyor"
            ? `Move material at required tonnage and belt speed during assigned operating duty for ${assetId}.`
            : `Perform required function for ${assetId} under stated operating conditions.`,
      "Performance standard": "Not confirmed",
      "Required capacity": "Not confirmed",
      "Required pressure": assetClass === "pump" ? "Not confirmed" : "Not applicable or not confirmed",
      "Required flow": assetClass === "pump" ? "Not confirmed" : "Not applicable or not confirmed",
      "Required speed": "Not confirmed",
      "Required temperature": "Not confirmed",
      "Required duty cycle": "Not confirmed",
      "Standby/operating role": "Not confirmed",
      "Mission duration": "Not confirmed",
      "Demand profile": "Not confirmed",
    },
    operatingContext: {
      "Duty type": "Not confirmed",
      "Operating hours per year": "Not confirmed",
      "Starts/stops per day": "Not confirmed",
      "Load profile": "Not confirmed",
      "Process fluid/material": "Not confirmed",
      "Ambient conditions": "Not confirmed",
      "Contamination exposure": "Not confirmed",
      "Corrosion exposure": "Not confirmed",
      "Dust exposure": "Not confirmed",
      "Moisture exposure": "Not confirmed",
      "Temperature range": "Not confirmed",
      "Vibration exposure": "Not confirmed",
      "Shock/loading conditions": "Not confirmed",
      "Operator interaction": "Not confirmed",
      "Accessibility constraints": "Not confirmed",
      "Safety/environmental hazards": "Not confirmed",
      "Asset-class-specific context": getAssetSpecificQuestions(assetClass).join(" "),
      "Lifecycle-specific context": getLifecycleSpecificQuestions(lifecycle).join(" "),
      "Industry template context": template.questions.join(" "),
    },
    criticality,
    failureModes: [
      ...failureModes,
      ...template.failureModeNotes.map((note) => ({
        failureMode: `${template.name} context risk`,
        failureMechanism: "Industry operating context not fully captured",
        cause: note,
        effect: "Generic recommendations may miss site-specific risk drivers",
        detectionMethod: "Template review, SME validation, and source document retrieval",
        consequence: "Reduced confidence until industry template evidence is confirmed",
        currentControls: "Existing SyncAI industry template pack",
        recommendedControls: "Validate against customer CMMS/EAM codes, OEM documents, and site standards",
      })),
    ],
    existingMaintenance: {
      capturedTasks: isNewAsset
        ? [
            "OEM recommended tasks not imported",
            "Commissioning PMs not confirmed",
            "Condition monitoring baselines not captured",
          ]
        : [
            "Current PMs not imported",
            "Operator rounds not confirmed",
            "Condition monitoring routes not confirmed",
          ],
      taskQualityFlags: [
        "PM interval basis is not confirmed.",
        "Task acceptance criteria are not confirmed.",
        "Tasks are not yet linked to failure modes.",
        isNewAsset
          ? "Commissioning and warranty tasks are not yet mapped to CMMS."
          : "Historical PM effectiveness has not yet been checked against failure history.",
      ],
      evaluationCriteria: [
        "Linked failure mode",
        "Task objective",
        "Task type",
        "Task interval",
        "Interval basis",
        "Acceptance criteria",
        "Required skill",
        "Estimated duration",
        "Shutdown requirement",
        "Safety requirement",
        "Effectiveness",
        "Value",
      ],
    },
    recommendedStrategy: failureModes.slice(0, 4).map((failureMode) => ({
      recommendation: `Add or validate a task/control for ${failureMode.failureMode}.`,
      failureModeAddressed: failureMode.failureMode,
      riskReduced: failureMode.consequence,
      evidenceUsed: [
        `${ASSET_CLASS_LABELS[assetClass]} starter failure-mode library`,
        `${template.name} from existing SyncAI industry template packs`,
        isNewAsset ? "Design/OEM/commissioning context required" : "Actual condition and work history required",
      ],
      assumptions: [
        "Operating context has not yet been fully validated.",
        "Existing PMs have not yet been imported and linked to failure modes.",
        `${LIFECYCLE_LABELS[lifecycle]} path controls the evidence required before approval.`,
      ],
      confidence: "medium",
      requiredApproval:
        "Reliability engineer approval before implementation; qualified engineering approval if safety, environmental, OEM-limit, or regulatory impact exists.",
      implementationWorkOrder: `Draft strategy validation work order for ${assetId} - ${failureMode.failureMode}`,
    })),
    conditionMonitoring: {
      plan:
        assetClass === "pump"
          ? ["Vibration route", "Bearing temperature trend", "Seal leak inspection", "Suction/discharge pressure trend", "Lubrication health check"]
          : assetClass === "conveyor"
            ? ["Thermography route", "Idler/pulley inspection route", "Belt tracking checks", "Drive current trend", "Cleaning system inspection"]
            : ["Inspection route", "Condition indicators tied to failure modes", "Baseline measurement plan"],
      measurementPoints:
        assetClass === "pump"
          ? ["Inboard bearing", "Outboard bearing", "Motor drive end", "Motor non-drive end", "Seal flush/plan point"]
          : assetClass === "conveyor"
            ? ["Head pulley", "Tail pulley", "Drive gearbox", "Take-up", "Critical idler zones"]
            : ["Critical component points to be defined"],
      alertResponseProcedure: [
        "Confirm alert against baseline.",
        "Check operating context and recent maintenance.",
        "Create follow-up work order with acceptance criteria.",
        "Escalate if safety/environmental/production threshold is crossed.",
      ],
      pFCurve: [
        "Potential failure detected by condition indicator.",
        "Plan corrective work inside estimated P-F interval.",
        "Verify failure mode after intervention.",
      ],
      requiredBaseline: [
        "Normal operating vibration/temperature/load baseline",
        "Alarm/action limits",
        "Known good inspection condition",
        isUsedAsset ? "Current condition inspection and history reconciliation" : "Commissioning baseline before routine operation",
      ],
    },
    spares: {
      recommendedBom:
        assetClass === "pump"
          ? ["Mechanical seal", "Bearing set", "Coupling insert", "Gaskets/O-rings", "Impeller wear parts", "Lubricant"]
          : assetClass === "conveyor"
            ? ["Critical idlers", "Belt repair kit", "Pulley lagging materials", "Cleaner blades", "Drive components", "Bearings"]
            : ["Critical components", "Consumables", "Long-lead items", "Repairables", "Rotables"],
      criticalSpares:
        assetClass === "pump"
          ? ["Mechanical seal", "Bearing set", "Coupling parts"]
          : assetClass === "conveyor"
            ? ["Critical idlers", "Cleaner blades", "Belt repair kit"]
            : ["Long-lead high-criticality spares to be confirmed"],
      stockingRecommendations: [
        "Confirm lead time and usage history.",
        "Stock high-criticality long-lead items or document accepted risk.",
        "Validate substitutes and obsolescence risk.",
      ],
      sparesRiskScore: assetClass === "generic" ? 45 : 65,
      missingBomItems: ["Vendor lead time", "Stock level", "Usage history", "Substitutes", "Obsolescence risk"],
    },
    reliabilityBaseline: {
      failureCount: 0,
      downtimeContributionHours: 0,
      maintenanceCost: 0,
      badActorStatus: "Unknown until failure history is imported",
      repeatFailureRate: "Unknown",
      dataQualityScore: isNewAsset ? 20 : 30,
      missingData: [
        isNewAsset ? "Reliability requirements" : "Operating hours",
        isNewAsset ? "Commissioning records" : "Failure history",
        isNewAsset ? "OEM task list" : "Downtime history",
        isNewAsset ? "Warranty start/end dates" : "Repair time",
        isNewAsset ? "Baseline condition readings" : "Work order history",
        "Cost history",
        "Production loss",
        "Condition monitoring history",
      ],
      confidence: "low",
    },
    fracasReadiness: {
      failureEventIntakeFields: [
        "Asset ID",
        "Event date/time",
        "Operating context",
        "Failure symptom",
        "Functional failure",
        "Failure mode",
        "Failure mechanism",
        "Immediate cause",
        "Root cause",
        "Evidence summary",
        "Corrective action",
        "Preventive action",
        "Owner",
        "Due date",
        "Verification method",
        "Effectiveness check date",
        "Status",
        "Recurrence detected",
      ],
      assetSpecificFailureCodes: failureModes.map((mode) => mode.failureMode),
      investigationTriggerThresholds: [
        isNewAsset ? "Any failure during warranty or early-life period" : "Any repeat failure on a known mode",
        "Same failure mode repeats within 90 days",
        "Single event causes more than 8 hours downtime",
        "Safety or environmental consequence occurs",
        "Repair cost exceeds configured threshold",
      ],
      rcaTriggerCriteria: [
        "Repeat failure within 90 days",
        "Criticality high or critical",
        "Safety/environmental impact",
        "Downtime or cost threshold exceeded",
      ],
      correctiveActionWorkflow: [
        "Open FRACAS case",
        "Assign investigation owner",
        "Attach evidence",
        "Select RCA method",
        "Approve corrective/preventive action",
        "Verify effectiveness",
        "Check recurrence",
        "Capture lessons learned",
      ],
      effectivenessCheckTiming: "After next operating cycle or 90 days, whichever provides meaningful exposure.",
      recurrenceDetectionRules: [
        "Same asset and failure mode within configured recurrence window",
        "Same root cause on sibling asset",
        "Repeat corrective action without effectiveness evidence",
      ],
    },
    riskSafeguards: {
      safetyCriticality: criticality.criticalityClass === "high" ? "High until validated" : "Not confirmed",
      safetyAndComplianceNotes: [
        "LOTO, stored energy, pressure, electrical, lifting, confined space, and environmental controls must be confirmed before work execution.",
        "Regulatory inspection requirements and OEM constraints are not yet fully validated.",
        ...template.safeguards,
      ],
      humanApprovalGates: [
        "PM interval changes",
        "Safety-critical recommendations",
        "Environmental compliance actions",
        "Integrity operating window or operating envelope changes",
        "Pressure equipment recommendations",
        "Lifting/hoisting recommendations",
        "Electrical protection settings",
        "Shutdown/startup recommendations",
        "OEM-limit changes",
        "Regulatory interpretations",
      ],
      doNotChangeRules: [
        "Do not change OEM limits without qualified engineering review.",
        "Do not remove PMs from high-criticality assets without documented residual risk approval.",
        "Do not interpret regulatory requirements without authorized human review.",
      ],
    },
    lifecycle: {
      lifecycleStatus:
        lifecycle === "new"
          ? "Pre-service asset: commissioning, warranty, baseline, and CMMS load must be completed before normal operation."
          : lifecycle === "newly_commissioned"
            ? "Early-life asset: watch infant mortality, warranty failures, and commissioning defects."
            : lifecycle === "rebuilt"
              ? "Rebuilt asset: validate rebuild scope, reused components, acceptance tests, and post-rebuild baseline."
              : lifecycle === "transferred"
                ? "Transferred asset: validate previous service, storage, configuration mismatch, and new duty."
                : lifecycle === "unknown"
                  ? "Unknown-condition asset: field verification and fit-for-service evidence required before normal reliability assumptions."
                  : "In-service/used asset: actual history, condition, degradation, and supportability must be reconciled.",
      remainingUsefulLifeEstimate: "Not enough data",
      obsolescenceRisk: "Unknown",
      replacementPlanningRecommendation:
        "Capture replacement cost, repair cost, vendor support status, known degradation mechanisms, and upgrade options before capital decision.",
      capitalRiskNote:
        "Capital risk cannot be quantified until reliability baseline and lifecycle cost inputs are complete.",
      longTermAssetStrategy:
        "Use the completed FMEA, criticality, spares, condition monitoring, and cost-of-unreliability outputs to set long-term strategy.",
    },
  };
}

function completedFieldCount(
  step: OnboardingStepDefinition,
  assetId: string,
  assetClass: AssetClass,
  lifecycle: AssetOnboardingLifecycle,
  industry: AssetOnboardingIndustry,
) {
  if (step.id === "asset_identity") {
    return assetId === "NEW-ASSET" ? 1 : lifecycle === "new" ? 4 : 3;
  }
  if (step.id === "failure_modes") return Math.min(step.requiredFields.length, 5);
  if (step.id === "criticality") {
    const industryBoost = industry === "oil_sands" || industry === "mining" ? 2 : 0;
    return Math.min(
      step.requiredFields.length,
      (assetClass === "generic" ? 3 : 6) + industryBoost,
    );
  }
  if (step.id === "recommended_strategy") return Math.min(step.requiredFields.length, 4);
  if (step.id === "fracas_readiness") return Math.min(step.requiredFields.length, 4);
  if (step.id === "lifecycle") {
    return Math.min(
      step.requiredFields.length,
      lifecycle === "new" || lifecycle === "newly_commissioned" ? 4 : lifecycle === "unknown" ? 1 : 3,
    );
  }
  if (step.id === "final_package") return 0;
  return 0;
}

function initializeSteps(
  assetId: string,
  assetClass: AssetClass,
  source: OnboardingSource,
  lifecycle: AssetOnboardingLifecycle,
  industry: AssetOnboardingIndustry,
): OnboardingStepState[] {
  const template = industryContext(industry);

  return STEP_DEFINITIONS.map((step, index) => {
    const completed = completedFieldCount(step, assetId, assetClass, lifecycle, industry);
    const score = Math.round((completed / step.requiredFields.length) * 100);
    const questions =
      step.id === "operating_context"
        ? [
            ...step.questions,
            ...getAssetSpecificQuestions(assetClass),
            ...getLifecycleSpecificQuestions(lifecycle),
            ...template.questions,
          ]
        : step.id === "criticality" || step.id === "risk_safeguards"
          ? [...step.questions, ...template.questions]
          : step.id === "lifecycle"
            ? [...step.questions, ...getLifecycleSpecificQuestions(lifecycle)]
            : [...step.questions];

    return {
      ...step,
      questions,
      completionStatus:
        index === 0 ? "in_progress" : score >= 100 ? "complete" : "not_started",
      completionScore: score,
      confidenceScore: score >= 75 ? 70 : score >= 30 ? 45 : 20,
      source: index === 0 && score > 0 ? source : "generated",
    };
  });
}

function missingFieldsForSteps(steps: OnboardingStepState[]) {
  return steps.flatMap((step) =>
    step.completionScore >= 100
      ? []
      : step.requiredFields
          .slice(0, Math.max(1, Math.ceil(step.requiredFields.length * (1 - step.completionScore / 100))))
          .map((field) => `${step.name}: ${field}`),
  );
}

function readinessFromScore(score: number): AssetOnboardingSession["reliabilityReadiness"] {
  if (score >= 95) return "complete";
  if (score >= 80) return "high";
  if (score >= 55) return "medium";
  return "low";
}

function readinessMessage(
  readiness: AssetOnboardingSession["reliabilityReadiness"],
  missingFields: string[],
) {
  if (readiness === "complete") {
    return "This asset is reliability-ready for RCA, FMEA, FRACAS, RAM, PM optimization, spares, and lifecycle planning with normal engineering governance.";
  }
  if (
    missingFields.some(
      (field) =>
        field.includes("Operating hours") ||
        field.includes("Failure history") ||
        field.includes("Repair time"),
    )
  ) {
    return "This asset is usable for preliminary analysis, but not yet reliable enough for PM interval optimization because operating hours and confirmed failure history are incomplete.";
  }
  if (readiness === "medium") {
    return "This asset is ready for preliminary RCA, FMEA-lite, and FRACAS setup, but still needs stronger operating context and baseline data before strategy approval.";
  }
  return "This asset is not yet reliability-ready. Complete identity, hierarchy, function, operating context, criticality, failure modes, and baseline data first.";
}

function buildFinalPackage(profile: AssetOnboardingProfile, assetId: string): AssetOnboardingPackage {
  const dataGaps = [
    ...profile.hierarchy.missingLevels.map((item) => `Hierarchy: ${item}`),
    ...profile.existingMaintenance.taskQualityFlags,
    ...profile.reliabilityBaseline.missingData.map((item) => `Reliability baseline: ${item}`),
    ...profile.spares.missingBomItems.map((item) => `Spares/BOM: ${item}`),
  ];

  return {
    assetProfile: `${assetId} - ${profile.identity["Asset type"]} (${LIFECYCLE_LABELS[profile.onboardingContext.lifecycle]}, ${profile.onboardingContext.industryTemplateName})`,
    hierarchyRecommendation: profile.hierarchy.recommendedPlacement,
    operatingContext: profile.operatingContext,
    criticalityAssessment: profile.criticality,
    fmea: profile.failureModes,
    maintenanceStrategy: profile.recommendedStrategy,
    conditionMonitoringPlan: profile.conditionMonitoring.plan,
    sparesRecommendation: profile.spares.stockingRecommendations,
    reliabilityBaseline: profile.reliabilityBaseline,
    fracasSetup: profile.fracasReadiness,
    lifecyclePlan: profile.lifecycle,
    dataGaps,
    approvalChecklist: profile.riskSafeguards.humanApprovalGates,
    implementationActions: [
      "Confirm asset identity and ownership.",
      "Validate hierarchy and driver/driven relationships.",
      "Confirm measurable function and operating context.",
      "Review criticality with operations, maintenance, and reliability.",
      "Validate starter FMEA failure modes with SMEs.",
      "Import current PMs and link each task to failure modes.",
      "Import failure history and calculate baseline reliability metrics.",
      "Approve high-risk strategy changes through governance.",
      "Export package to CMMS/APM/Power BI/API once validated.",
    ],
  };
}

function recomputeSession(session: AssetOnboardingSession): AssetOnboardingSession {
  const completionScore = Math.round(
    session.steps.reduce((total, step) => total + step.completionScore, 0) /
      session.steps.length,
  );
  const missingFields = missingFieldsForSteps(session.steps);
  const reliabilityReadiness = readinessFromScore(completionScore);
  const currentStep =
    session.steps.find((step) => step.completionStatus !== "complete")?.id ??
    "final_package";
  const status = reliabilityReadiness === "complete" ? "completed" : "active";

  return {
    ...session,
    status,
    currentStep,
    completionScore,
    reliabilityReadiness,
    readinessMessage: readinessMessage(reliabilityReadiness, missingFields),
    missingFields,
    completedAt: status === "completed" ? session.updatedAt : undefined,
    finalPackage: buildFinalPackage(session.profile, session.assetId),
  };
}

export function createAssetOnboardingSession({
  commandText,
  tenantId = "demo-tenant",
  createdBy = "demo-user",
  now = new Date(),
}: {
  commandText: string;
  tenantId?: string;
  createdBy?: string;
  now?: Date;
}): AssetOnboardingSession {
  const command = parseAssetOnboardingCommand(commandText);
  const assetId = command.assetId ?? "NEW-ASSET";
  const timestamp = nowIso(now);
  const profile = buildDefaultProfile(assetId, command.assetClass, command.lifecycle, command.industry);
  const steps = initializeSteps(assetId, command.assetClass, command.source, command.lifecycle, command.industry);

  return recomputeSession({
    sessionId: `onboard-${slug(assetId)}-${now.getTime()}`,
    tenantId,
    assetId,
    assetClass: command.assetClass,
    mode: command.mode,
    source: command.source,
    lifecycle: command.lifecycle,
    industry: command.industry,
    status: "active",
    currentStep: "asset_identity",
    completionScore: 0,
    reliabilityReadiness: "low",
    readinessMessage: "",
    missingFields: [],
    assumptions: [
      `${LIFECYCLE_LABELS[command.lifecycle]} evidence path is active.`,
      `${INDUSTRY_TEMPLATE_LABELS[command.industry]} is used as the onboarding template; customer records override generated defaults.`,
      "Asset onboarding starts with generated starter content until customer records, SMEs, and source documents validate it.",
      "Recommendations are decision support and require human approval before implementation.",
      "PM interval optimization is blocked until operating hours and confirmed failure history are complete.",
    ],
    recommendations: [
      "Use the selected industry template to shape criticality, safeguards, failure modes, work taxonomy, and first-customer pilot outputs.",
      "Complete identity, hierarchy, function, operating context, criticality, and failure modes before relying on asset-specific outputs.",
      "Import current PMs and failure history before approving PM optimization.",
      "Use FRACAS triggers to convert repeat failures into closed-loop corrective action.",
    ],
    approvalRequired: profile.riskSafeguards.humanApprovalGates,
    createdBy,
    createdAt: timestamp,
    updatedAt: timestamp,
    steps,
    profile,
    finalPackage: buildFinalPackage(profile, assetId),
  });
}

export function applyAssetOnboardingAnswer({
  session,
  answer,
  now = new Date(),
}: {
  session: AssetOnboardingSession;
  answer: string;
  now?: Date;
}): AssetOnboardingSession {
  const timestamp = nowIso(now);
  const currentIndex = session.steps.findIndex(
    (step) => step.id === session.currentStep,
  );

  if (currentIndex < 0) return session;

  const updatedSteps: OnboardingStepState[] = session.steps.map((step, index) => {
    if (index !== currentIndex) return step;
    const answerLength = answer.trim().length;
    const score = answerLength >= 20 ? 100 : Math.max(step.completionScore, 50);
    const completionStatus: OnboardingStatus =
      score >= 100 ? "complete" : "in_progress";
    const source: OnboardingSource = "manual";
    return {
      ...step,
      answer,
      completionStatus,
      completionScore: score,
      confidenceScore: score >= 100 ? 75 : 45,
      source,
      lastUpdated: timestamp,
    };
  });

  const nextIncomplete = updatedSteps.findIndex(
    (step) => step.completionStatus !== "complete",
  );
  const promotedSteps: OnboardingStepState[] = updatedSteps.map((step, index) => {
    const completionStatus: OnboardingStatus =
      index === nextIncomplete && step.completionStatus === "not_started"
        ? "in_progress"
        : step.completionStatus;

    return {
      ...step,
      completionStatus,
    };
  });

  return recomputeSession({
    ...session,
    updatedAt: timestamp,
    steps: promotedSteps,
  });
}

export function getCurrentOnboardingStep(session: AssetOnboardingSession) {
  return session.steps.find((step) => step.id === session.currentStep) ?? session.steps[0];
}

export function getOnboardingSampleAnswer(session: AssetOnboardingSession) {
  const step = getCurrentOnboardingStep(session);
  const tag = session.assetId;
  const assetType = ASSET_CLASS_LABELS[session.assetClass];
  const lifecycleLabel = LIFECYCLE_LABELS[session.lifecycle];
  const industryLabel = INDUSTRY_TEMPLATE_LABELS[session.industry];
  const template = industryContext(session.industry);

  const samples: Record<OnboardingStepId, string> = {
    asset_identity: `Asset tag: ${tag}. Asset name: ${tag} ${assetType}. Asset type: ${assetType}. Lifecycle path: ${lifecycleLabel}. Industry template: ${industryLabel}. Functional location: FL-${tag}. Site: Demo Site. Area: Process Area 1. System: Utilities. Operations owner: Operations Superintendent. Maintenance owner: Maintenance Supervisor. Reliability owner: Reliability Engineer. OEM/model/serial/commissioning date require validation.`,
    hierarchy: `Recommended hierarchy: Enterprise > Demo Site > Plant 1 > Process Area 1 > Utilities > Transfer System > ${tag}. Parent asset is the process system. For a pump, link motor driver and maintainable items for seal, bearings, coupling, and impeller. Missing hierarchy levels: plant, area, system owner validation.`,
    function: `Primary function: ${session.assetClass === "pump" ? `Transfer process fluid from source to destination at required flow and pressure for ${tag}.` : `Perform required function for ${tag} under stated operating conditions.`} Performance standard, capacity, duty cycle, standby role, mission duration, and demand profile require site confirmation.`,
    operating_context: `Duty is assumed continuous/intermittent until confirmed. Operating hours per year, starts/stops, load profile, process material, contamination, corrosion, dust, moisture, temperature, vibration, accessibility, and safety/environmental hazards require validation. ${getAssetSpecificQuestions(session.assetClass).join(" ")} ${getLifecycleSpecificQuestions(session.lifecycle).join(" ")} ${template.questions.join(" ")}`,
    criticality: `Preliminary criticality is ${session.profile.criticality.criticalityClass} using ${industryLabel}. Main drivers: ${session.profile.criticality.riskDrivers.join(", ")}. Confirm safety, environmental, production, quality, cost, repair time, spares, redundancy, detectability, failure frequency, and regulatory exposure with SMEs.`,
    failure_modes: `Starter failure modes: ${session.profile.failureModes.map((mode) => mode.failureMode).join(", ")}. Validate mechanisms, causes, effects, detection methods, consequences, current controls, recommended controls, and data codes with operations, maintenance, and reliability.`,
    existing_maintenance: `Current PMs, inspections, lubrication, condition monitoring, calibration, statutory tasks, operator rounds, shutdown tasks, overhaul tasks, failure-finding tasks, and run-to-failure items are not imported yet. Flag PMs with no failure mode, no interval basis, vague acceptance criteria, duplicate scope, intrusive work, or condition-monitoring opportunity.`,
    recommended_strategy: `Recommended strategy starts with failure-mode-based PMs, condition monitoring, operator care, lubrication, inspection, calibration, overhaul, run-to-failure decisions, and spares recommendations. Each recommendation needs evidence, assumptions, confidence, required approval, and implementation work order.`,
    condition_monitoring: `Condition monitoring plan should include methods, measurement points, process indicators, routes, alarm limits, baseline data, P-F interval estimate, and response procedure. Initial plan: ${session.profile.conditionMonitoring.plan.join(", ")}.`,
    spares: `Spares review should capture critical spares, insurance spares, consumables, long-lead items, repairables, rotables, BOM, vendor, lead time, stock level, usage history, substitutes, and obsolescence risk. Starter BOM: ${session.profile.spares.recommendedBom.join(", ")}.`,
    reliability_baseline: `Reliability baseline requires failure history, downtime history, repair time, work order history, cost history, production loss, condition monitoring history, inspection findings, oil/vibration history, and operator logs. Calculate failure count, MTBF, MTTR, availability, downtime contribution, maintenance cost, bad actor status, repeat failure rate, reactive work %, PM compliance, and schedule compliance after import.`,
    fracas_readiness: `FRACAS setup: use event intake fields, asset-specific failure codes, RCA triggers, corrective action workflow, effectiveness checks, and recurrence rules. Open RCA if same mode repeats within 90 days, downtime exceeds 8 hours, safety/environmental consequence occurs, or repair cost exceeds threshold.`,
    risk_safeguards: `Safety and safeguards: confirm LOTO, confined space, pressure energy, electrical hazards, stored energy, lifting, environmental controls, regulatory inspection requirements, OEM constraints, and engineering approval needs. Do not auto-approve OEM limit, protection setting, regulatory, safety-critical, or PM interval changes.`,
    lifecycle: `Lifecycle profile needs age, design life, remaining useful life, obsolescence risk, degradation mechanisms, replacement cost, repair cost, upgrade options, technology risk, and vendor support status. Use lifecycle plan for capital risk and long-term asset strategy.`,
    final_package: `Final package reviewed. Export asset profile, hierarchy recommendation, operating context, criticality, FMEA, maintenance strategy, condition monitoring plan, spares, reliability baseline, FRACAS setup, lifecycle plan, data gaps, approval checklist, and implementation action list.`,
  };

  return samples[step.id];
}

function markdownList(items: string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}

function fmeaMarkdown(failureModes: AssetFailureMode[]) {
  return failureModes
    .map(
      (mode, index) =>
        `${index + 1}. ${mode.failureMode}\n   - Mechanism: ${mode.failureMechanism}\n   - Cause: ${mode.cause}\n   - Effect: ${mode.effect}\n   - Detection: ${mode.detectionMethod}\n   - Consequence: ${mode.consequence}\n   - Current controls: ${mode.currentControls}\n   - Recommended controls: ${mode.recommendedControls}`,
    )
    .join("\n");
}

function strategyMarkdown(recommendations: MaintenanceTaskRecommendation[]) {
  return recommendations
    .map(
      (item, index) =>
        `${index + 1}. ${item.recommendation}\n   - Failure mode addressed: ${item.failureModeAddressed}\n   - Risk reduced: ${item.riskReduced}\n   - Evidence used: ${item.evidenceUsed.join("; ")}\n   - Assumptions: ${item.assumptions.join("; ")}\n   - Confidence: ${item.confidence}\n   - Approval: ${item.requiredApproval}\n   - Implementation work order: ${item.implementationWorkOrder}`,
    )
    .join("\n");
}

export function buildAssetOnboardingExports(
  session: AssetOnboardingSession,
): AssetOnboardingExports {
  const pkg = session.finalPackage;
  const markdown = [
    `# Reliability-Ready Asset Onboarding Package - ${session.assetId}`,
    "",
    `Mode: ${session.mode}`,
    `Asset class: ${ASSET_CLASS_LABELS[session.assetClass]}`,
    `Lifecycle path: ${LIFECYCLE_LABELS[session.lifecycle]}`,
    `Industry template: ${INDUSTRY_TEMPLATE_LABELS[session.industry]}`,
    `Template code: ${session.profile.onboardingContext.industryTemplateCode}`,
    `Template source tables: ${session.profile.onboardingContext.sourceTables.join(", ")}`,
    `Completion score: ${session.completionScore}%`,
    `Reliability readiness: ${session.reliabilityReadiness}`,
    `Readiness message: ${session.readinessMessage}`,
    "",
    "## Asset Profile",
    "",
    pkg.assetProfile,
    "",
    "## Hierarchy Recommendation",
    "",
    markdownList(pkg.hierarchyRecommendation),
    "",
    "## Operating Context",
    "",
    Object.entries(pkg.operatingContext)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join("\n"),
    "",
    "## Criticality Assessment",
    "",
    `- Score: ${pkg.criticalityAssessment.score}/${pkg.criticalityAssessment.maxScore}`,
    `- Class: ${pkg.criticalityAssessment.criticalityClass}`,
    `- Strategy intensity: ${pkg.criticalityAssessment.recommendedStrategyIntensity}`,
    `- Risk drivers: ${pkg.criticalityAssessment.riskDrivers.join("; ")}`,
    "",
    "## FMEA",
    "",
    fmeaMarkdown(pkg.fmea),
    "",
    "## Maintenance Strategy",
    "",
    strategyMarkdown(pkg.maintenanceStrategy),
    "",
    "## Condition Monitoring Plan",
    "",
    markdownList(pkg.conditionMonitoringPlan),
    "",
    "## Spares Recommendation",
    "",
    markdownList(pkg.sparesRecommendation),
    "",
    "## Reliability Baseline",
    "",
    Object.entries(pkg.reliabilityBaseline)
      .map(([key, value]) => `- ${key}: ${Array.isArray(value) ? value.join("; ") : String(value)}`)
      .join("\n"),
    "",
    "## FRACAS Setup",
    "",
    markdownList(pkg.fracasSetup.rcaTriggerCriteria),
    "",
    "## Lifecycle Plan",
    "",
    Object.entries(pkg.lifecyclePlan)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join("\n"),
    "",
    "## Data Gaps",
    "",
    markdownList(pkg.dataGaps),
    "",
    "## Approval Checklist",
    "",
    markdownList(pkg.approvalChecklist),
    "",
    "## Implementation Actions",
    "",
    markdownList(pkg.implementationActions),
  ].join("\n");

  const htmlBody = markdown
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^- (.*)$/gm, "<li>$1</li>")
    .replace(/\n/g, "<br />");
  const wordHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${session.assetId} onboarding package</title></head><body>${htmlBody}</body></html>`;
  const pdfHtml = wordHtml;
  const excelRows = [
    ["section", "field", "value"],
    ["identity", "asset_id", session.assetId],
    ["identity", "asset_class", ASSET_CLASS_LABELS[session.assetClass]],
    ["context", "lifecycle_path", LIFECYCLE_LABELS[session.lifecycle]],
    ["context", "industry_template", INDUSTRY_TEMPLATE_LABELS[session.industry]],
    ["readiness", "completion_score", `${session.completionScore}`],
    ["readiness", "reliability_readiness", session.reliabilityReadiness],
    ...pkg.dataGaps.map((gap) => ["data_gap", "gap", gap]),
    ...pkg.approvalChecklist.map((item) => ["approval", "gate", item]),
  ];
  const excelWorkbookCsv = excelRows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const cmmsImportCsv = [
    "asset_tag,asset_type,lifecycle_path,industry_template,functional_location,criticality_class,maintenance_strategy,approval_required",
    [
      session.assetId,
      ASSET_CLASS_LABELS[session.assetClass],
      LIFECYCLE_LABELS[session.lifecycle],
      INDUSTRY_TEMPLATE_LABELS[session.industry],
      session.profile.identity["Functional location"] || "",
      pkg.criticalityAssessment.criticalityClass,
      pkg.criticalityAssessment.recommendedStrategyIntensity,
      "yes",
    ]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(","),
  ].join("\n");
  const powerBiDatasetJson = JSON.stringify(
    {
      tables: {
        asset: [{
          assetId: session.assetId,
          assetClass: session.assetClass,
          lifecycle: session.lifecycle,
          industry: session.industry,
          industryTemplate: INDUSTRY_TEMPLATE_LABELS[session.industry],
        }],
        completion: session.steps.map((step) => ({
          stepId: step.id,
          stepName: step.name,
          completionScore: step.completionScore,
          confidenceScore: step.confidenceScore,
          status: step.completionStatus,
        })),
        failureModes: pkg.fmea,
        recommendations: pkg.maintenanceStrategy,
      },
    },
    null,
    2,
  );
  const apiPayloadJson = JSON.stringify(
    {
      session,
      package: pkg,
      exports: {
        markdown: "included separately",
        wordHtml: "included separately",
        pdfHtml: "included separately",
        excelWorkbookCsv: "included separately",
        cmmsImportCsv: "included separately",
        powerBiDatasetJson: "included separately",
      },
    },
    null,
    2,
  );

  return {
    markdown,
    json: JSON.stringify(pkg, null, 2),
    wordHtml,
    pdfHtml,
    excelWorkbookCsv,
    cmmsImportCsv,
    powerBiDatasetJson,
    apiPayloadJson,
  };
}

export function getAssetClassLabel(assetClass: AssetClass) {
  return ASSET_CLASS_LABELS[assetClass];
}

export function getAssetOnboardingLifecycleLabel(
  lifecycle: AssetOnboardingLifecycle,
) {
  return LIFECYCLE_LABELS[lifecycle];
}

export function getAssetOnboardingIndustryLabel(
  industry: AssetOnboardingIndustry,
) {
  return INDUSTRY_TEMPLATE_LABELS[industry];
}
