import { describe, expect, it } from "vitest";
import {
  analyzeRisk,
  ANALYSIS_METHODS,
  assessControlEffectiveness,
  assessMaturity,
  assessScope,
  assessTreatmentReadiness,
  buildAudienceView,
  buildImplementationRoadmap,
  compareTreatments,
  detectAdaptationTriggers,
  detectStakeholderDisagreement,
  evaluateAggregateExposure,
  evaluateResidualAcceptance,
  evaluateValueOfInformation,
  getIndustryRiskFocus,
  ISO_31000_PRINCIPLES,
  RISK_ENGINE_ARCHITECTURE,
  runMarkovModel,
  type RiskAnalysisInput,
  type RiskCriteria,
} from ".";

const criteria: RiskCriteria = {
  id: "criteria-1",
  name: "Test criteria",
  status: "adopted",
  version: 1,
  likelihoodScale: [1, 2, 3, 4, 5],
  consequenceDimensions: [
    "safety",
    "environment",
    "production",
    "financial",
    "regulatory",
    "asset_integrity",
    "reputation",
    "customer",
    "cybersecurity",
  ],
  weights: {
    inherent: 0.55,
    exposure: 0.1,
    uncertainty: 0.1,
    connectivity: 0.1,
    velocity: 0.05,
    capacity: 0.1,
  },
  thresholds: {
    low: 20,
    medium: 40,
    high: 60,
    critical: 80,
  },
  decisionThresholds: {
    accept: 20,
    monitor: 40,
    investigate: 55,
    treat: 70,
    escalate: 85,
  },
  capacityLimit: 100,
};

const base: RiskAnalysisInput = {
  kind: "threat",
  analysisLevel: "semi_quantitative",
  likelihood: 4,
  consequences: { safety: 4, production: 5, financial: 4 },
  controlEffectiveness: 40,
  uncertainty: 30,
  confidence: 70,
  exposure: 75,
  complexity: 50,
  connectivity: 45,
  capacityLoad: 35,
  velocity: 30,
  timeToUnacceptableDays: 30,
};

describe("ISO 31000 risk analysis", () => {
  it("implements all eight principles and all twelve operating engines", () => {
    expect(ISO_31000_PRINCIPLES.map((item) => item.key)).toEqual([
      "integrated",
      "structured",
      "customized",
      "inclusive",
      "dynamic",
      "best_available_information",
      "human_and_cultural",
      "continual_improvement",
    ]);
    expect(RISK_ENGINE_ARCHITECTURE).toHaveLength(12);
    expect(RISK_ENGINE_ARCHITECTURE.map((engine) => engine.key)).toContain(
      "governance",
    );
    expect(RISK_ENGINE_ARCHITECTURE.map((engine) => engine.key)).toContain(
      "evidence",
    );
  });

  it("exposes qualitative, semi-quantitative and every requested quantitative method", () => {
    expect(new Set(ANALYSIS_METHODS.map((method) => method.level))).toEqual(
      new Set(["qualitative", "semi_quantitative", "quantitative"]),
    );
    for (const method of [
      "weibull",
      "monte_carlo",
      "fault_tree",
      "reliability_block_diagram",
      "bowtie",
      "markov",
      "production_loss",
      "probabilistic_cost",
    ]) {
      expect(ANALYSIS_METHODS.some((item) => item.key === method)).toBe(true);
    }
  });

  it("runs a governed Markov state model and preserves probability mass", () => {
    const result = runMarkovModel({
      states: ["available", "failed"],
      initial: [1, 0],
      transition: [
        [0.9, 0.1],
        [0.4, 0.6],
      ],
      rewards: [1, 0],
      steps: 10,
    });

    expect(result.valid).toBe(true);
    expect(
      result.distribution.reduce((sum, value) => sum + value, 0),
    ).toBeCloseTo(1);
    expect(result.expectedReward).toBeGreaterThan(0);
    expect(result.expectedReward).toBeLessThan(1);
  });

  it("keeps every driver visible instead of collapsing risk to likelihood × consequence", () => {
    const result = analyzeRisk(base, criteria);

    expect(result.drivers).toMatchObject({
      likelihood: 4,
      peakConsequence: 5,
      controlEffectiveness: 40,
      uncertainty: 30,
      confidence: 70,
      exposure: 75,
      connectivity: 45,
      capacityLoad: 35,
    });
    expect(result.currentScore).toBeGreaterThan(result.controlledScore);
    expect(result.explanation).toContain("adopted criteria");
  });

  it("does not produce an authoritative evaluation from draft criteria", () => {
    const result = analyzeRisk(base, { ...criteria, status: "draft" });

    expect(result.authoritative).toBe(false);
    expect(result.decision).toBe("INVESTIGATE");
    expect(result.explanation).toContain("draft");
  });

  it("models opportunity as well as threat", () => {
    const result = analyzeRisk(
      {
        ...base,
        kind: "opportunity",
        opportunityValue: 82,
        consequences: { production: 2, safety: 1 },
      },
      criteria,
    );

    expect(result.kind).toBe("opportunity");
    expect(result.opportunityScore).toBeGreaterThan(0);
    expect(result.explanation).toContain("opportunity");
  });

  it("accelerates evaluation when time to unacceptable is short", () => {
    const slow = analyzeRisk(
      { ...base, timeToUnacceptableDays: 180, velocity: 5 },
      criteria,
    );
    const fast = analyzeRisk(
      { ...base, timeToUnacceptableDays: 2, velocity: 90 },
      criteria,
    );

    expect(fast.currentScore).toBeGreaterThan(slow.currentScore);
    expect(fast.timePressure).toBeGreaterThan(slow.timePressure);
  });
});

describe("scope, information and stakeholder discipline", () => {
  it("refuses an undefined assessment scope and names every gap", () => {
    const result = assessScope({
      decisionSupported: "",
      objective: "Return the truck safely",
      inclusions: [],
      exclusions: [],
      timeHorizon: "",
      assumptions: [],
      decisionOwnerId: "",
      expectedOutcome: "",
      location: "",
      resources: [],
      responsibilities: [],
      relationships: [],
    });

    expect(result.complete).toBe(false);
    expect(result.missing).toContain("decisionSupported");
    expect(result.missing).toContain("exclusions");
    expect(result.missing).toContain("decisionOwnerId");
  });

  it("captures material disagreement instead of averaging it away", () => {
    const result = detectStakeholderDisagreement([
      { stakeholder: "Reliability", likelihood: 5, consequence: 5 },
      { stakeholder: "Operations", likelihood: 2, consequence: 3 },
      { stakeholder: "Safety", likelihood: 4, consequence: 5 },
    ]);

    expect(result.material).toBe(true);
    expect(result.likelihoodSpread).toBe(3);
    expect(result.questionToResolve).toContain("additional information");
  });

  it("recommends inexpensive enquiry when it is worth more than deciding blind", () => {
    const result = evaluateValueOfInformation({
      informationCost: 8_000,
      decisionCostIfWrong: 400_000,
      uncertaintyReduction: 0.7,
      probabilityDecisionChanges: 0.4,
    });

    expect(result.expectedValue).toBeGreaterThan(result.informationCost);
    expect(result.recommendation).toBe("GATHER_INFORMATION");
  });
});

describe("controls, aggregation and treatments", () => {
  it("reports a control as unknown when it has not been tested", () => {
    const result = assessControlEffectiveness({
      intendedEffect: "Detect bearing degradation",
      tests: [],
      failuresDespiteControl: 2,
      overdueTests: 1,
    });

    expect(result.rating).toBe("unknown");
    expect(result.confidence).toBe(0);
    expect(result.explanation).toContain("not been tested");
  });

  it("detects declining controls when failures continue despite passing paperwork", () => {
    const result = assessControlEffectiveness({
      intendedEffect: "Prevent seal failures",
      tests: [
        { passed: true, observedAt: "2026-06-01" },
        { passed: true, observedAt: "2026-07-01" },
      ],
      failuresDespiteControl: 3,
      overdueTests: 0,
    });

    expect(result.rating).toBe("weak");
    expect(result.trend).toBe("declining");
  });

  it("raises aggregate exposure for simultaneous risks and common dependencies", () => {
    const result = evaluateAggregateExposure(
      [
        { id: "pump-a", score: 35, dependencyKeys: ["mcc-1"] },
        { id: "pump-b", score: 38, dependencyKeys: ["mcc-1"] },
        { id: "storm", score: 45, dependencyKeys: ["site-power"] },
      ],
      { capacityLimit: 100, currentCommittedCapacity: 45 },
    );

    expect(result.commonDependencies).toEqual(["mcc-1"]);
    expect(result.combinedExposure).toBeGreaterThan(100);
    expect(result.withinCapacity).toBe(false);
  });

  it("ranks treatments by net risk change and refuses an unexecutable option", () => {
    const result = compareTreatments(78, [
      {
        id: "inspect",
        strategy: "change_likelihood",
        residualRisk: 45,
        introducedRisk: 3,
        cost: 8_000,
        downtimeHours: 2,
        confidence: 80,
        requiredResources: ["ultrasound technician"],
        availableResources: [],
      },
      {
        id: "reduce-load",
        strategy: "change_consequence",
        residualRisk: 52,
        introducedRisk: 1,
        cost: 1_000,
        downtimeHours: 0,
        confidence: 70,
        requiredResources: ["operations authority"],
        availableResources: ["operations authority"],
      },
    ]);

    expect(result[0].id).toBe("reduce-load");
    expect(result.find((item) => item.id === "inspect")?.executable).toBe(
      false,
    );
    expect(
      result.find((item) => item.id === "inspect")?.missingResources,
    ).toEqual(["ultrasound technician"]);
  });

  it("checks both resources and active competencies before calling a treatment executable", () => {
    const result = assessTreatmentReadiness({
      requiredResources: ["ultrasound kit", "approved procedure"],
      availableResources: ["ultrasound kit", "approved procedure"],
      requiredCompetencies: ["condition-monitoring-level-2"],
      activeCompetencies: [],
    });

    expect(result.executable).toBe(false);
    expect(result.missingCompetencies).toEqual([
      "condition-monitoring-level-2",
    ]);
  });
});

describe("controlled residual risk and governance", () => {
  it("requires residual risk, expiry, reassessment trigger, rationale and named owner", () => {
    const result = evaluateResidualAcceptance({
      residualRiskLevel: "High",
      acceptedById: "",
      acceptedRole: "maintenance_manager",
      expiresAt: null,
      reassessmentTrigger: "",
      rationale: "short",
      compensatingControls: "",
      authorityCeiling: "Medium",
    });

    expect(result.acceptable).toBe(false);
    expect(result.gaps).toContain("named acceptance owner");
    expect(result.gaps).toContain("expiry date");
    expect(result.gaps).toContain("higher approval authority");
  });

  it("keeps management and oversight representations distinct", () => {
    const source = {
      objective: "Restore feeder service",
      currentRisk: "High",
      treatments: ["Stage mobile generation"],
      actions: ["Dispatch crew"],
      controls: ["Protection scheme"],
      evidenceQuality: "moderate",
      overdueTreatments: 1,
      acceptedRisk: false,
    } as const;

    expect(buildAudienceView(source, "technician").primaryQuestion).toContain(
      "do",
    );
    expect(buildAudienceView(source, "board").primaryQuestion).toContain(
      "bounds",
    );
    expect(buildAudienceView(source, "oversight").canExecute).toBe(false);
  });
});

describe("framework adaptation and maturity", () => {
  it("uses the existing industry-profile kernel and adds the sector risk focus", () => {
    const mining = getIndustryRiskFocus("mining");
    const utilities = getIndustryRiskFocus("utilities");

    expect(mining?.riskObjects).toContain("slope stability");
    expect(mining?.kernelContexts).toContain("mobile_plant_failure");
    expect(utilities?.riskObjects).toContain("wildfire");
    expect(utilities?.kernelContexts).toContain("network_outage");
  });

  it("builds the implementation copilot sequence without auto-adopting policy", () => {
    const roadmap = buildImplementationRoadmap({
      objectives: ["Safe production"],
      criticalServices: ["Mine haulage"],
      stakeholders: ["Operations", "Maintenance", "Safety"],
      obligations: ["Mine safety regulation"],
      existingSystems: ["CMMS", "Historian"],
      riskOwnerRole: "Mine manager",
      acceptanceAuthority: "Delegation of authority",
      decisionPoints: ["Maintenance deferral", "Shutdown scope"],
    });

    expect(roadmap.complete).toBe(true);
    expect(roadmap.phases.map((phase) => phase.name)).toEqual([
      "Current-state assessment",
      "Gap assessment",
      "Implementation roadmap",
      "Configuration",
      "Workflow deployment",
      "Monitoring",
      "Improvement",
    ]);
    expect(roadmap.configurationStatus).toBe("draft");
    expect(roadmap.humanAdoptionRequired).toBe(true);
  });

  it("detects material context changes that require criteria review", () => {
    const triggers = detectAdaptationTriggers([
      { type: "regulation_change", material: true },
      { type: "weather_change", material: false },
      { type: "new_operating_regime", material: true },
    ]);

    expect(triggers.reviewRequired).toBe(true);
    expect(triggers.reasons).toHaveLength(2);
  });

  it("scores maturity across principles, framework and process and names the gaps", () => {
    const maturity = assessMaturity({
      principles: {
        integrated: 3,
        structured: 3,
        customized: 2,
        inclusive: 2,
        dynamic: 1,
        bestAvailableInformation: 3,
        humanAndCultural: 2,
        continualImprovement: 1,
      },
      framework: {
        leadership: 3,
        design: 2,
        implementation: 2,
        evaluation: 1,
        improvement: 1,
      },
      process: {
        scope: 3,
        identification: 3,
        analysis: 2,
        evaluation: 2,
        treatment: 2,
        monitoring: 1,
        communication: 2,
        recording: 3,
      },
    });

    expect(maturity.level).toBeGreaterThanOrEqual(1);
    expect(maturity.level).toBeLessThanOrEqual(3);
    expect(maturity.gaps.some((gap) => gap.includes("dynamic"))).toBe(true);
    expect(maturity.gaps.some((gap) => gap.includes("improvement"))).toBe(true);
  });
});
