/**
 * SyncAI risk operating kernel.
 *
 * ISO 31000 supplies the governance grammar; the customer's adopted criteria
 * supply the decision policy. Nothing in this module invents an engineering
 * limit or silently approves an action. The functions are pure so the same
 * behaviour can be used by the UI, edge functions and database contract tests.
 */

import {
  INDUSTRY_CATALOG,
  getIndustryCatalogEntry,
  type IndustryCode,
} from "../industry-catalog";
import { INDUSTRY_PROFILES } from "../industry-profiles";
import { getDomainSpecialistModule } from "../domain-specialists";
import {
  INDUSTRY_TEMPLATE_PACKS,
  type IndustryTemplatePack,
} from "../industry-template-packs";

export type RiskKind = "threat" | "opportunity" | "both";
export type AnalysisLevel =
  "qualitative" | "semi_quantitative" | "quantitative";
export type RiskLevel = "Very Low" | "Low" | "Medium" | "High" | "Critical";
export type RiskDecision =
  "ACCEPT" | "MONITOR" | "INVESTIGATE" | "TREAT" | "ESCALATE" | "STOP";

export const CONSEQUENCE_DIMENSIONS = [
  "safety",
  "environment",
  "production",
  "financial",
  "regulatory",
  "asset_integrity",
  "reputation",
  "customer",
  "cybersecurity",
] as const;

export type ConsequenceDimension = (typeof CONSEQUENCE_DIMENSIONS)[number];

export const ISO_31000_PRINCIPLES = [
  {
    key: "integrated",
    capability: "Risk embedded in operating decisions and work",
  },
  {
    key: "structured",
    capability: "Common scope, taxonomy and workflow contract",
  },
  {
    key: "customized",
    capability: "Context, criteria and industry-profile binding",
  },
  {
    key: "inclusive",
    capability: "Stakeholder views, challenge, consultation and approval",
  },
  {
    key: "dynamic",
    capability: "Indicators, velocity, context triggers and reassessment",
  },
  {
    key: "best_available_information",
    capability: "Canonical evidence, provenance, quality and confidence",
  },
  {
    key: "human_and_cultural",
    capability:
      "Human approval, competency, assumptions, bias and disagreement",
  },
  {
    key: "continual_improvement",
    capability: "Verified outcomes, learning events and framework review",
  },
] as const;

export const RISK_ENGINE_ARCHITECTURE = [
  {
    key: "context",
    purpose: "Objectives, stakeholders, obligations and dependencies",
  },
  {
    key: "criteria",
    purpose: "Tolerance, capacity, consequence, likelihood and time",
  },
  { key: "discovery", purpose: "Threats, opportunities and emerging signals" },
  {
    key: "analysis",
    purpose: "Likelihood, consequence, uncertainty and connectivity",
  },
  {
    key: "decision",
    purpose: "Accept, monitor, investigate, treat, escalate or stop",
  },
  {
    key: "treatment",
    purpose: "Alternatives, costs, benefits, new risks and residual risk",
  },
  {
    key: "execution",
    purpose: "Canonical recommendations, approvals and work orders",
  },
  { key: "assurance", purpose: "Control testing and treatment verification" },
  {
    key: "dynamic_monitoring",
    purpose: "Indicators, context changes and risk velocity",
  },
  {
    key: "learning",
    purpose: "Outcomes, incidents, effectiveness and improvement",
  },
  {
    key: "governance",
    purpose: "Named owners, authority, approval, acceptance and oversight",
  },
  {
    key: "evidence",
    purpose: "Sources, assumptions, limitations, provenance and audit trail",
  },
] as const;

export const ANALYSIS_METHODS = [
  {
    key: "qualitative",
    level: "qualitative",
    implementation: "risk-operating-system/analyzeRisk",
  },
  {
    key: "risk_matrix",
    level: "semi_quantitative",
    implementation: "risk-operating-system/analyzeRisk",
  },
  {
    key: "criticality_ranking",
    level: "semi_quantitative",
    implementation: "asset criticality + adopted criteria",
  },
  {
    key: "weibull",
    level: "quantitative",
    implementation: "src/lib/reliability",
  },
  {
    key: "monte_carlo",
    level: "quantitative",
    implementation: "src/lib/modelling/monte-carlo",
  },
  {
    key: "fault_tree",
    level: "quantitative",
    implementation: "src/lib/modelling/fault-tree",
  },
  {
    key: "event_tree",
    level: "quantitative",
    implementation: "risk-operating-system/advanced/runEventTree",
  },
  {
    key: "reliability_block_diagram",
    level: "quantitative",
    implementation: "src/lib/modelling/rbd",
  },
  {
    key: "bowtie",
    level: "quantitative",
    implementation: "process-safety major_hazards + barriers",
  },
  {
    key: "markov",
    level: "quantitative",
    implementation: "risk-operating-system/runMarkovModel",
  },
  {
    key: "bayesian_binomial",
    level: "quantitative",
    implementation: "risk-operating-system/advanced/runBayesianBinomial",
  },
  {
    key: "production_loss",
    level: "quantitative",
    implementation: "get_production_loss RPC",
  },
  {
    key: "probabilistic_cost",
    level: "quantitative",
    implementation: "src/lib/modelling/cost-forecast",
  },
] as const satisfies ReadonlyArray<{
  key: string;
  level: AnalysisLevel;
  implementation: string;
}>;

export interface MarkovModelInput {
  states: string[];
  initial: number[];
  transition: number[][];
  rewards?: number[];
  steps: number;
}

export function runMarkovModel(input: MarkovModelInput): {
  valid: boolean;
  distribution: number[];
  expectedReward: number | null;
  history: number[][];
  issues: string[];
} {
  const issues: string[] = [];
  const n = input.states.length;
  if (n === 0) issues.push("at least one state is required");
  if (input.initial.length !== n)
    issues.push("initial distribution must match state count");
  if (
    input.transition.length !== n ||
    input.transition.some((row) => row.length !== n)
  )
    issues.push("transition matrix must be square and match state count");
  if (input.steps < 0 || !Number.isInteger(input.steps))
    issues.push("steps must be a non-negative integer");
  if (input.rewards && input.rewards.length !== n)
    issues.push("rewards must match state count");
  const probabilityOk = (values: number[]) =>
    values.every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ) && Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) < 1e-9;
  if (input.initial.length === n && !probabilityOk(input.initial))
    issues.push("initial values must be probabilities summing to 1");
  if (
    input.transition.length === n &&
    input.transition.every((row) => row.length === n) &&
    input.transition.some((row) => !probabilityOk(row))
  )
    issues.push("every transition row must contain probabilities summing to 1");
  if (issues.length > 0) {
    return {
      valid: false,
      distribution: [],
      expectedReward: null,
      history: [],
      issues,
    };
  }

  let distribution = [...input.initial];
  const history = [[...distribution]];
  for (let step = 0; step < input.steps; step += 1) {
    const next = Array.from({ length: n }, () => 0);
    for (let from = 0; from < n; from += 1) {
      for (let to = 0; to < n; to += 1) {
        next[to] += distribution[from] * input.transition[from][to];
      }
    }
    distribution = next;
    history.push([...distribution]);
  }
  const expectedReward = input.rewards
    ? distribution.reduce(
        (sum, probability, index) => sum + probability * input.rewards![index],
        0,
      )
    : null;
  return {
    valid: true,
    distribution,
    expectedReward,
    history,
    issues,
  };
}

const INDUSTRY_RISK_OBJECTS: Partial<Record<IndustryCode, string[]>> = {
  mining: [
    "haul fleet availability",
    "slope stability",
    "mobile equipment",
    "conveyors",
    "processing plants",
    "weather",
    "tire risk",
    "workforce",
  ],
  oil_gas: [
    "loss of containment",
    "corrosion",
    "process safety",
    "rotating equipment",
    "turnarounds",
    "pipelines",
    "environmental release",
  ],
  utilities: [
    "grid reliability",
    "transformer failure",
    "wildfire",
    "storm damage",
    "capacity",
    "system restoration",
  ],
  manufacturing: [
    "OEE",
    "robotics",
    "product quality",
    "bottlenecks",
    "supplier disruption",
    "automation",
  ],
  transportation_logistics: [
    "fleet reliability",
    "infrastructure",
    "dispatch",
    "signaling",
    "service interruptions",
  ],
  buildings_infrastructure: [
    "structural deterioration",
    "fire systems",
    "HVAC",
    "public safety",
    "deferred capital",
  ],
};

export type RiskIndustryReadiness =
  "kernel_bound" | "template_only" | "focus_draft" | "custom";

export const RISK_INDUSTRY_READINESS_LABELS: Record<
  RiskIndustryReadiness,
  string
> = {
  kernel_bound: "Executable kernel",
  template_only: "Template only",
  focus_draft: "Risk-focus draft",
  custom: "Organization-defined",
};

export interface RiskIndustryPack {
  industryCode: string;
  label: string;
  riskObjects: string[];
  kernelContexts: string[];
  domainModules: Array<{
    key: string;
    label: string;
    methods: string[];
  }>;
  proseOnly: string[];
  readiness: RiskIndustryReadiness;
  validationStatus: IndustryTemplatePack["validationStatus"] | "not_applicable";
  focusSource: "curated" | "template_guidance" | "custom";
}

function getIndustryTemplatePack(
  industryCode: string,
): IndustryTemplatePack | null {
  return (
    (INDUSTRY_TEMPLATE_PACKS as Partial<Record<string, IndustryTemplatePack>>)[
      industryCode
    ] ?? null
  );
}

export function getRiskIndustryPackCatalog(): RiskIndustryPack[] {
  return INDUSTRY_CATALOG.map((entry) => {
    const profile = INDUSTRY_PROFILES.find(
      (item) => item.industryCode === entry.code,
    );
    const template = getIndustryTemplatePack(entry.code);
    const curatedRiskObjects = INDUSTRY_RISK_OBJECTS[entry.code];
    const readiness: RiskIndustryReadiness =
      entry.kind === "custom"
        ? "custom"
        : profile
          ? "kernel_bound"
          : template
            ? "template_only"
            : "focus_draft";
    return {
      industryCode: entry.code,
      label: entry.label,
      riskObjects: [...(curatedRiskObjects ?? template?.riskDrivers ?? [])],
      kernelContexts: [...(profile?.contexts ?? [])],
      domainModules: (profile?.domainModules ?? []).flatMap((key) => {
        const module = getDomainSpecialistModule(key);
        return module
          ? [
              {
                key: module.key,
                label: module.label,
                methods: module.methods.map((method) => method.key),
              },
            ]
          : [];
      }),
      proseOnly: [...(profile?.proseOnly ?? [])],
      readiness,
      validationStatus:
        entry.kind === "custom"
          ? "not_applicable"
          : (template?.validationStatus ?? "draft"),
      focusSource:
        entry.kind === "custom"
          ? "custom"
          : curatedRiskObjects
            ? "curated"
            : "template_guidance",
    };
  });
}

export function getIndustryRiskFocus(
  industryCode: string,
): RiskIndustryPack | null {
  const entry = getIndustryCatalogEntry(industryCode);
  if (!entry) return null;
  return (
    getRiskIndustryPackCatalog().find(
      (item) => item.industryCode === entry.code,
    ) ?? null
  );
}

export function getRiskIndustryOptionLabel(pack: RiskIndustryPack): string {
  const readiness = RISK_INDUSTRY_READINESS_LABELS[pack.readiness];
  if (pack.validationStatus === "not_applicable") {
    return `${pack.label} — ${readiness}`;
  }
  return `${pack.label} — ${readiness} · ${pack.validationStatus} content`;
}

export interface ImplementationDiscovery {
  objectives: string[];
  criticalServices: string[];
  stakeholders: string[];
  obligations: string[];
  existingSystems: string[];
  riskCaptureSystems: string[];
  dependencies: string[];
  riskOwnerRole: string;
  acceptanceAuthority: string;
  escalationThresholds: string[];
  consequenceDimensions: string[];
  likelihoodDefinitions: string[];
  riskTolerances: string[];
  decisionPoints: string[];
  treatmentTrackingSystems: string[];
}

export function buildDraftCriteriaDefinitions(
  consequenceDimensions: string[],
  likelihoodDefinitions: string[],
): {
  consequenceDimensions: Array<{
    key: string;
    label: string;
    scale: number[];
  }>;
  likelihoodScale: Array<{ score: number; label: string }>;
} {
  const usedKeys = new Set<string>();
  return {
    consequenceDimensions: consequenceDimensions.map((value, index) => {
      const label = value.trim();
      const baseKey =
        label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "") || `dimension_${index + 1}`;
      let key = baseKey;
      let suffix = 2;
      while (usedKeys.has(key)) {
        key = `${baseKey}_${suffix}`;
        suffix += 1;
      }
      usedKeys.add(key);
      return { key, label, scale: [1, 2, 3, 4, 5] };
    }),
    likelihoodScale: likelihoodDefinitions.map((value, index) => ({
      score: index + 1,
      label: value.trim(),
    })),
  };
}

export function buildImplementationRoadmap(input: ImplementationDiscovery): {
  complete: boolean;
  gaps: string[];
  phases: {
    name: string;
    status: "ready" | "draft" | "blocked";
    output: string;
  }[];
  configurationStatus: "draft";
  humanAdoptionRequired: true;
} {
  const gaps = Object.entries(input)
    .filter(([, value]) =>
      Array.isArray(value) ? value.length === 0 : !value.trim(),
    )
    .map(([key]) => key);
  const complete = gaps.length === 0;
  return {
    complete,
    gaps,
    phases: [
      {
        name: "Current-state assessment",
        status: complete ? "ready" : "blocked",
        output:
          "Objectives, services, obligations, stakeholders and existing systems",
      },
      {
        name: "Gap assessment",
        status: complete ? "ready" : "blocked",
        output: "Evidence gaps across principles, framework and process",
      },
      {
        name: "Implementation roadmap",
        status: complete ? "ready" : "blocked",
        output:
          "Sequenced governance, criteria, workflow and integration changes",
      },
      {
        name: "Configuration",
        status: "draft",
        output: "Draft context and criteria for customer review",
      },
      {
        name: "Workflow deployment",
        status: "blocked",
        output:
          "Embedded assessments at recorded decision points after adoption",
      },
      {
        name: "Monitoring",
        status: "blocked",
        output: "Indicators, velocity, capacity and adaptation triggers",
      },
      {
        name: "Improvement",
        status: "blocked",
        output: "Verified outcomes and framework-effectiveness review",
      },
    ],
    configurationStatus: "draft",
    humanAdoptionRequired: true,
  };
}

export interface RiskCriteria {
  id: string;
  name: string;
  status: "draft" | "adopted" | "superseded";
  version: number;
  likelihoodScale: number[];
  consequenceDimensions: ConsequenceDimension[];
  weights: {
    inherent: number;
    exposure: number;
    uncertainty: number;
    connectivity: number;
    velocity: number;
    capacity: number;
  };
  thresholds: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  decisionThresholds: {
    accept: number;
    monitor: number;
    investigate: number;
    treat: number;
    escalate: number;
  };
  capacityLimit: number;
}

export interface RiskAnalysisInput {
  kind: RiskKind;
  analysisLevel: AnalysisLevel;
  likelihood: number;
  consequences: Partial<Record<ConsequenceDimension, number>>;
  controlEffectiveness: number;
  uncertainty: number;
  confidence: number;
  exposure: number;
  complexity: number;
  connectivity: number;
  capacityLoad: number;
  velocity: number;
  timeToUnacceptableDays: number | null;
  opportunityValue?: number;
}

export interface RiskAnalysisResult {
  kind: RiskKind;
  authoritative: boolean;
  inherentScore: number;
  controlledScore: number;
  currentScore: number;
  opportunityScore: number;
  level: RiskLevel;
  decision: RiskDecision;
  timePressure: number;
  drivers: {
    likelihood: number;
    peakConsequence: number;
    controlEffectiveness: number;
    uncertainty: number;
    confidence: number;
    exposure: number;
    complexity: number;
    connectivity: number;
    capacityLoad: number;
    velocity: number;
  };
  explanation: string;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function peakConsequence(
  consequences: RiskAnalysisInput["consequences"],
): number {
  const values = Object.values(consequences).filter(Number.isFinite);
  return values.length > 0 ? Math.max(...values) : 0;
}

function levelFor(score: number, criteria: RiskCriteria): RiskLevel {
  if (score >= criteria.thresholds.critical) return "Critical";
  if (score >= criteria.thresholds.high) return "High";
  if (score >= criteria.thresholds.medium) return "Medium";
  if (score >= criteria.thresholds.low) return "Low";
  return "Very Low";
}

function decisionFor(score: number, criteria: RiskCriteria): RiskDecision {
  const threshold = criteria.decisionThresholds;
  if (score >= 95) return "STOP";
  if (score >= threshold.escalate) return "ESCALATE";
  if (score >= threshold.treat) return "TREAT";
  if (score >= threshold.investigate) return "INVESTIGATE";
  if (score >= threshold.monitor) return "MONITOR";
  return "ACCEPT";
}

export function analyzeRisk(
  input: RiskAnalysisInput,
  criteria: RiskCriteria,
): RiskAnalysisResult {
  const maximumLikelihood = Math.max(...criteria.likelihoodScale, 1);
  const maximumConsequence = 5;
  const peak = peakConsequence(input.consequences);
  const inherent = clamp(
    (input.likelihood / maximumLikelihood) * (peak / maximumConsequence) * 100,
  );
  const controlled = inherent * (1 - clamp(input.controlEffectiveness) / 100);
  const days = input.timeToUnacceptableDays;
  const timePressure =
    days === null
      ? 0
      : days <= 0
        ? 100
        : clamp(100 * (1 - Math.min(days, 365) / 365));
  const connectionPressure =
    (clamp(input.connectivity) + clamp(input.complexity)) / 2;
  const weighted =
    controlled * criteria.weights.inherent +
    clamp(input.exposure) * criteria.weights.exposure +
    clamp(input.uncertainty) * criteria.weights.uncertainty +
    connectionPressure * criteria.weights.connectivity +
    clamp(input.velocity) * criteria.weights.velocity +
    clamp(input.capacityLoad) * criteria.weights.capacity +
    timePressure * 0.1;
  const current = clamp(weighted);
  const opportunity =
    input.kind === "threat"
      ? 0
      : clamp(input.opportunityValue ?? 0) *
        (clamp(input.confidence) / 100) *
        (0.5 + clamp(input.exposure) / 200);
  const authoritative = criteria.status === "adopted";
  const evaluatedDecision = decisionFor(current, criteria);
  const decision = authoritative ? evaluatedDecision : "INVESTIGATE";
  const kindText =
    input.kind === "opportunity"
      ? ` The opportunity score is ${rounded(opportunity)}; it remains subject to the same residual-risk and approval controls as a threat decision.`
      : input.kind === "both"
        ? ` The event carries both downside exposure and opportunity; neither is netted away.`
        : "";
  const criteriaText = authoritative
    ? `Evaluated against adopted criteria “${criteria.name}” v${criteria.version}.`
    : `Criteria “${criteria.name}” are ${criteria.status}; the result is diagnostic only and INVESTIGATE is forced until criteria are adopted.`;

  return {
    kind: input.kind,
    authoritative,
    inherentScore: rounded(inherent),
    controlledScore: rounded(controlled),
    currentScore: rounded(current),
    opportunityScore: rounded(opportunity),
    level: levelFor(current, criteria),
    decision,
    timePressure: rounded(timePressure),
    drivers: {
      likelihood: input.likelihood,
      peakConsequence: peak,
      controlEffectiveness: clamp(input.controlEffectiveness),
      uncertainty: clamp(input.uncertainty),
      confidence: clamp(input.confidence),
      exposure: clamp(input.exposure),
      complexity: clamp(input.complexity),
      connectivity: clamp(input.connectivity),
      capacityLoad: clamp(input.capacityLoad),
      velocity: clamp(input.velocity),
    },
    explanation: `${criteriaText} Risk is not a bare matrix product: the score preserves existing-control effectiveness, exposure, uncertainty, complexity/connectivity, velocity, time pressure and aggregate capacity.${kindText}`,
  };
}

export interface AssessmentScope {
  decisionSupported: string;
  objective: string;
  inclusions: string[];
  exclusions: string[];
  timeHorizon: string;
  assumptions: string[];
  decisionOwnerId: string;
  expectedOutcome: string;
  location: string;
  resources: string[];
  responsibilities: string[];
  relationships: string[];
}

export function assessScope(scope: AssessmentScope): {
  complete: boolean;
  missing: (keyof AssessmentScope)[];
  explanation: string;
} {
  const missing = (
    Object.entries(scope) as [keyof AssessmentScope, string | string[]][]
  )
    .filter(([, value]) =>
      Array.isArray(value) ? value.length === 0 : value.trim().length === 0,
    )
    .map(([key]) => key);
  return {
    complete: missing.length === 0,
    missing,
    explanation:
      missing.length === 0
        ? "Assessment scope is explicit and decision-bound."
        : `Assessment is not decision-ready: ${missing.join(", ")} must be defined.`,
  };
}

export interface StakeholderView {
  stakeholder: string;
  likelihood: number;
  consequence: number;
}

export function detectStakeholderDisagreement(views: StakeholderView[]): {
  material: boolean;
  likelihoodSpread: number;
  consequenceSpread: number;
  outliers: string[];
  questionToResolve: string;
} {
  if (views.length < 2) {
    return {
      material: false,
      likelihoodSpread: 0,
      consequenceSpread: 0,
      outliers: [],
      questionToResolve:
        "Add another informed stakeholder view before claiming consensus.",
    };
  }
  const likelihoods = views.map((view) => view.likelihood);
  const consequences = views.map((view) => view.consequence);
  const likelihoodSpread = Math.max(...likelihoods) - Math.min(...likelihoods);
  const consequenceSpread =
    Math.max(...consequences) - Math.min(...consequences);
  const meanLikelihood =
    likelihoods.reduce((sum, value) => sum + value, 0) / views.length;
  const meanConsequence =
    consequences.reduce((sum, value) => sum + value, 0) / views.length;
  const outliers = views
    .filter(
      (view) =>
        Math.abs(view.likelihood - meanLikelihood) >= 1.5 ||
        Math.abs(view.consequence - meanConsequence) >= 1.5,
    )
    .map((view) => view.stakeholder);
  const material = likelihoodSpread >= 2 || consequenceSpread >= 2;
  return {
    material,
    likelihoodSpread,
    consequenceSpread,
    outliers,
    questionToResolve: material
      ? "What additional information would resolve this material disagreement? Preserve every view until it is resolved."
      : "Views are within one scoring band; record the remaining differences without averaging away their rationale.",
  };
}

export interface ValueOfInformationInput {
  informationCost: number;
  decisionCostIfWrong: number;
  uncertaintyReduction: number;
  probabilityDecisionChanges: number;
}

export function evaluateValueOfInformation(input: ValueOfInformationInput): {
  expectedValue: number;
  informationCost: number;
  netValue: number;
  recommendation: "GATHER_INFORMATION" | "DECIDE_WITH_CURRENT_INFORMATION";
  explanation: string;
} {
  const expectedValue =
    Math.max(0, input.decisionCostIfWrong) *
    clamp(input.uncertaintyReduction, 0, 1) *
    clamp(input.probabilityDecisionChanges, 0, 1);
  const netValue = expectedValue - Math.max(0, input.informationCost);
  return {
    expectedValue: rounded(expectedValue),
    informationCost: Math.max(0, input.informationCost),
    netValue: rounded(netValue),
    recommendation:
      netValue > 0 ? "GATHER_INFORMATION" : "DECIDE_WITH_CURRENT_INFORMATION",
    explanation:
      netValue > 0
        ? "The expected decision value of resolving uncertainty exceeds the cost of enquiry."
        : "Further enquiry is not expected to change enough decision value to cover its cost; document the residual uncertainty.",
  };
}

export interface ControlTest {
  passed: boolean;
  observedAt: string;
}

export function assessControlEffectiveness(input: {
  intendedEffect: string;
  tests: ControlTest[];
  failuresDespiteControl: number;
  overdueTests: number;
}): {
  rating: "effective" | "partial" | "weak" | "ineffective" | "unknown";
  score: number | null;
  confidence: number;
  trend: "improving" | "stable" | "declining" | "unknown";
  explanation: string;
} {
  if (input.tests.length === 0) {
    return {
      rating: "unknown",
      score: null,
      confidence: 0,
      trend: "unknown",
      explanation: `The control “${input.intendedEffect}” has not been tested. Existence is not operating effectiveness.`,
    };
  }
  const passes = input.tests.filter((test) => test.passed).length;
  const passRate = (passes / input.tests.length) * 100;
  const score = clamp(
    passRate - input.failuresDespiteControl * 20 - input.overdueTests * 10,
  );
  const rating =
    score >= 80 && input.failuresDespiteControl === 0
      ? "effective"
      : score >= 50 && input.failuresDespiteControl === 0
        ? "partial"
        : score > 0
          ? "weak"
          : "ineffective";
  const trend =
    input.failuresDespiteControl > 0 || input.overdueTests > 0
      ? "declining"
      : input.tests.length > 1 && input.tests.at(-1)?.passed
        ? "stable"
        : "declining";
  return {
    rating,
    score: rounded(score),
    confidence: Math.min(100, input.tests.length * 20),
    trend,
    explanation:
      input.failuresDespiteControl > 0
        ? `${input.failuresDespiteControl} failure(s) occurred despite the control; passing control paperwork does not establish the intended modifying effect.`
        : `${passes} of ${input.tests.length} tests demonstrated the intended effect; ${input.overdueTests} test(s) are overdue.`,
  };
}

export interface AggregateRiskInput {
  id: string;
  score: number;
  dependencyKeys: string[];
}

export function evaluateAggregateExposure(
  risks: AggregateRiskInput[],
  capacity: { capacityLimit: number; currentCommittedCapacity: number },
): {
  individualExposure: number;
  combinedExposure: number;
  commonDependencies: string[];
  withinCapacity: boolean;
  capacityRemaining: number;
  explanation: string;
} {
  const counts = new Map<string, number>();
  risks.forEach((risk) =>
    risk.dependencyKeys.forEach((key) =>
      counts.set(key, (counts.get(key) ?? 0) + 1),
    ),
  );
  const commonDependencies = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();
  const individualExposure = risks.reduce(
    (sum, risk) => sum + clamp(risk.score),
    0,
  );
  const interactionLoad = Math.max(0, risks.length - 1) * 5;
  const dependencyLoad = commonDependencies.reduce(
    (sum, key) => sum + ((counts.get(key) ?? 1) - 1) * 10,
    0,
  );
  const combinedExposure =
    individualExposure +
    interactionLoad +
    dependencyLoad +
    Math.max(0, capacity.currentCommittedCapacity);
  const capacityRemaining = capacity.capacityLimit - combinedExposure;
  return {
    individualExposure: rounded(individualExposure),
    combinedExposure: rounded(combinedExposure),
    commonDependencies,
    withinCapacity: capacityRemaining >= 0,
    capacityRemaining: rounded(capacityRemaining),
    explanation:
      commonDependencies.length > 0
        ? `Combined exposure includes concurrency, committed organizational capacity and common dependencies: ${commonDependencies.join(", ")}.`
        : "Combined exposure includes concurrency and committed organizational capacity; no recorded common dependency was found.",
  };
}

export type TreatmentStrategy =
  | "avoid"
  | "pursue_opportunity"
  | "remove_source"
  | "change_likelihood"
  | "change_consequence"
  | "share"
  | "retain";

export interface TreatmentOption {
  id: string;
  strategy: TreatmentStrategy;
  residualRisk: number;
  introducedRisk: number;
  cost: number;
  downtimeHours: number;
  confidence: number;
  requiredResources: string[];
  availableResources: string[];
}

export interface RankedTreatment extends TreatmentOption {
  executable: boolean;
  missingResources: string[];
  netRiskChange: number;
  valuePerCost: number | null;
}

export function compareTreatments(
  currentRisk: number,
  options: TreatmentOption[],
): RankedTreatment[] {
  return options
    .map((option) => {
      const missingResources = option.requiredResources.filter(
        (resource) => !option.availableResources.includes(resource),
      );
      const netRiskChange =
        currentRisk - option.residualRisk - option.introducedRisk;
      return {
        ...option,
        executable: missingResources.length === 0,
        missingResources,
        netRiskChange: rounded(netRiskChange),
        valuePerCost:
          option.cost > 0 ? rounded(netRiskChange / option.cost) : null,
      };
    })
    .sort((a, b) => {
      if (a.executable !== b.executable) return a.executable ? -1 : 1;
      if (a.netRiskChange !== b.netRiskChange)
        return b.netRiskChange - a.netRiskChange;
      return b.confidence - a.confidence;
    });
}

export function assessTreatmentReadiness(input: {
  requiredResources: string[];
  availableResources: string[];
  requiredCompetencies: string[];
  activeCompetencies: string[];
}): {
  executable: boolean;
  missingResources: string[];
  missingCompetencies: string[];
  explanation: string;
} {
  const missingResources = input.requiredResources.filter(
    (item) => !input.availableResources.includes(item),
  );
  const missingCompetencies = input.requiredCompetencies.filter(
    (item) => !input.activeCompetencies.includes(item),
  );
  const executable =
    missingResources.length === 0 && missingCompetencies.length === 0;
  return {
    executable,
    missingResources,
    missingCompetencies,
    explanation: executable
      ? "Required resources and active competencies are recorded. Human release controls still apply."
      : `Treatment is not executable. Missing resources: ${missingResources.join(", ") || "none"}. Missing competencies: ${missingCompetencies.join(", ") || "none"}.`,
  };
}

const RISK_RANK: Record<string, number> = {
  "Very Low": 0,
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
};

export function evaluateResidualAcceptance(input: {
  residualRiskLevel: RiskLevel;
  acceptedById: string;
  acceptedRole: string;
  expiresAt: string | null;
  reassessmentTrigger: string;
  rationale: string;
  compensatingControls: string;
  authorityCeiling: RiskLevel;
}): { acceptable: boolean; gaps: string[]; explanation: string } {
  const gaps: string[] = [];
  if (!input.acceptedById.trim()) gaps.push("named acceptance owner");
  if (!input.acceptedRole.trim()) gaps.push("acceptance role");
  if (!input.expiresAt) gaps.push("expiry date");
  else {
    const expiry = new Date(input.expiresAt).getTime();
    const now = Date.now();
    if (!Number.isFinite(expiry) || expiry <= now)
      gaps.push("future expiry date");
    if (Number.isFinite(expiry) && expiry > now + 366 * 24 * 60 * 60 * 1000)
      gaps.push("expiry within one year");
  }
  if (!input.reassessmentTrigger.trim()) gaps.push("reassessment trigger");
  if (input.rationale.trim().length < 20) gaps.push("substantive rationale");
  if (input.compensatingControls.trim().length < 20)
    gaps.push("compensating controls");
  if (
    (RISK_RANK[input.residualRiskLevel] ?? 99) >
    (RISK_RANK[input.authorityCeiling] ?? -1)
  )
    gaps.push("higher approval authority");
  return {
    acceptable: gaps.length === 0,
    gaps,
    explanation:
      gaps.length === 0
        ? "Residual risk may be routed for time-bounded human acceptance at the recorded authority level."
        : `Residual risk cannot be accepted yet: ${gaps.join(", ")}.`,
  };
}

export type Audience =
  "technician" | "supervisor" | "manager" | "executive" | "board" | "oversight";

export interface AudienceSource {
  objective: string;
  currentRisk: string;
  treatments: readonly string[];
  actions: readonly string[];
  controls: readonly string[];
  evidenceQuality: string;
  overdueTreatments: number;
  acceptedRisk: boolean;
}

export function buildAudienceView(source: AudienceSource, audience: Audience) {
  const primaryQuestions: Record<Audience, string> = {
    technician: "What do I need to do, and what evidence must I record?",
    supervisor: "What threatens safe execution on this shift?",
    manager: "Which risk requires a decision, treatment owner or resource?",
    executive:
      "Which objectives are exposed, and what trade-off needs authority?",
    board:
      "Is enterprise risk within acceptable bounds, and is management effective?",
    oversight:
      "Is management identifying, treating, accepting and reporting risk appropriately?",
  };
  return {
    audience,
    primaryQuestion: primaryQuestions[audience],
    objective: source.objective,
    currentRisk: source.currentRisk,
    items:
      audience === "technician"
        ? source.actions
        : audience === "oversight" || audience === "board"
          ? [
              `Evidence quality: ${source.evidenceQuality}`,
              `Overdue treatments: ${source.overdueTreatments}`,
              `Risk acceptance recorded: ${source.acceptedRisk ? "yes" : "no"}`,
            ]
          : [...source.treatments, ...source.controls],
    canExecute: audience !== "board" && audience !== "oversight",
  };
}

export type AdaptationTriggerType =
  | "regulation_change"
  | "organizational_restructure"
  | "acquisition"
  | "new_technology"
  | "new_asset_type"
  | "weather_change"
  | "supply_chain_deterioration"
  | "workforce_loss"
  | "major_incident"
  | "new_operating_regime";

export function detectAdaptationTriggers(
  events: { type: AdaptationTriggerType; material: boolean; detail?: string }[],
): { reviewRequired: boolean; reasons: string[]; explanation: string } {
  const reasons = events
    .filter((event) => event.material)
    .map((event) => event.detail?.trim() || event.type.replaceAll("_", " "));
  return {
    reviewRequired: reasons.length > 0,
    reasons,
    explanation:
      reasons.length > 0
        ? "Material context changed; existing context, criteria, controls and assumptions require human review."
        : "No recorded material context change currently forces a framework review.",
  };
}

type MaturityScore = 0 | 1 | 2 | 3 | 4 | 5;

export interface MaturityInput {
  principles: {
    integrated: MaturityScore;
    structured: MaturityScore;
    customized: MaturityScore;
    inclusive: MaturityScore;
    dynamic: MaturityScore;
    bestAvailableInformation: MaturityScore;
    humanAndCultural: MaturityScore;
    continualImprovement: MaturityScore;
  };
  framework: {
    leadership: MaturityScore;
    design: MaturityScore;
    implementation: MaturityScore;
    evaluation: MaturityScore;
    improvement: MaturityScore;
  };
  process: {
    scope: MaturityScore;
    identification: MaturityScore;
    analysis: MaturityScore;
    evaluation: MaturityScore;
    treatment: MaturityScore;
    monitoring: MaturityScore;
    communication: MaturityScore;
    recording: MaturityScore;
  };
}

const MATURITY_LABELS = [
  "Ad hoc",
  "Risk registers exist",
  "Common risk processes",
  "Integrated into decisions",
  "Dynamic risk monitoring",
  "Predictive and continually improving",
] as const;

export function assessMaturity(input: MaturityInput): {
  level: MaturityScore;
  label: (typeof MATURITY_LABELS)[number];
  scores: { principles: number; framework: number; process: number };
  gaps: string[];
  explanation: string;
} {
  const average = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const principleEntries = Object.entries(input.principles);
  const frameworkEntries = Object.entries(input.framework);
  const processEntries = Object.entries(input.process);
  const principleScore = average(principleEntries.map(([, value]) => value));
  const frameworkScore = average(frameworkEntries.map(([, value]) => value));
  const processScore = average(processEntries.map(([, value]) => value));
  const level = clamp(
    Math.floor(Math.min(principleScore, frameworkScore, processScore)),
    0,
    5,
  ) as MaturityScore;
  const gaps = [
    ...principleEntries
      .filter(([, value]) => value < 2)
      .map(([key]) => `principle: ${key}`),
    ...frameworkEntries
      .filter(([, value]) => value < 2)
      .map(([key]) => `framework: ${key}`),
    ...processEntries
      .filter(([, value]) => value < 2)
      .map(([key]) => `process: ${key}`),
  ];
  return {
    level,
    label: MATURITY_LABELS[level],
    scores: {
      principles: rounded(principleScore),
      framework: rounded(frameworkScore),
      process: rounded(processScore),
    },
    gaps,
    explanation: `Maturity is constrained by the weakest of principles, framework and process; ${gaps.length} sub-dimension(s) remain below a repeatable common process.`,
  };
}
