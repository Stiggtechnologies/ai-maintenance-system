import { describe, expect, it } from "vitest";
import {
  DOMAIN_SPECIALIST_MODULES,
  evaluateDomainSpecialist,
  registeredDomainEvaluatorKeys,
} from ".";

function evidenceFor(required: string[]) {
  return required.map((key) => ({
    key,
    sourceReference: `evidence://${key}/controlled-record`,
    evidenceItemId: "11111111-1111-4111-8111-111111111111",
  }));
}

describe("domain-depth specialist registry", () => {
  it("covers the requested specialist industries and executable methods", () => {
    expect(DOMAIN_SPECIALIST_MODULES).toHaveLength(17);
    expect(
      new Set(DOMAIN_SPECIALIST_MODULES.map((module) => module.industryCode))
        .size,
    ).toBe(17);
    const methods = DOMAIN_SPECIALIST_MODULES.flatMap((module) =>
      module.methods.map((method) => method.key),
    );
    expect(methods).toHaveLength(58);
    expect(new Set(methods).size).toBe(methods.length);
    expect(registeredDomainEvaluatorKeys()).toEqual([...methods].sort());
    expect(
      new Set(DOMAIN_SPECIALIST_MODULES.map((module) => module.reviewerRoleKey))
        .size,
    ).toBe(17);
  });

  it("makes the complete process-industry family executable and non-authoritative", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "petrochemical-rbi",
    )!;
    expect(module.methods.map((method) => method.key)).toEqual([
      "rbi-corrosion-loop",
      "process-safety-barriers",
      "pressure-containment-assurance",
      "sis-proof-test-assurance",
      "turnaround-readiness",
      "loss-of-containment-risk",
    ]);
    for (const method of module.methods) {
      const result = evaluateDomainSpecialist({
        moduleKey: module.key,
        methodKey: method.key,
        inputs: method.exampleInputs,
        evidence: evidenceFor(method.requiredEvidence),
      });
      expect(result.status, `${method.key}: ${result.gaps}`).toBe("draft");
      expect(result.authoritative).toBe(false);
      expect(result.humanApprovalRequired).toBe(true);
      expect(result.requiredApproverRoleKey).toBe("domain_rbi_reviewer");
    }
  });

  it("blocks every process-industry method without canonical evidence", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "petrochemical-rbi",
    )!;
    for (const method of module.methods) {
      const result = evaluateDomainSpecialist({
        moduleKey: module.key,
        methodKey: method.key,
        inputs: method.exampleInputs,
        evidence: [],
      });
      expect(result.status).toBe("blocked");
    }
  });

  it("never credits an unverified loss-of-containment barrier", () => {
    const method = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "petrochemical-rbi",
    )!.methods.find(
      (candidate) => candidate.key === "loss-of-containment-risk",
    )!;
    const inputs = structuredClone(method.exampleInputs);
    (inputs.scenarios as Array<Record<string, unknown>>)[0].barriersVerified =
      false;
    const result = evaluateDomainSpecialist({
      moduleKey: "petrochemical-rbi",
      methodKey: method.key,
      inputs,
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.status).toBe("draft");
    expect(result.gaps.join(" ")).toMatch(/not evidenced as verified/i);
  });

  it("makes the complete civil-infrastructure family executable and non-authoritative", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "civil-infrastructure",
    )!;
    expect(module.methods.map((method) => method.key)).toEqual([
      "structural-condition",
      "inspection-rating",
      "deterioration-forecast",
      "load-restriction",
      "geographic-risk",
      "renewal-planning",
    ]);
    for (const method of module.methods) {
      const result = evaluateDomainSpecialist({
        moduleKey: module.key,
        methodKey: method.key,
        inputs: method.exampleInputs,
        evidence: evidenceFor(method.requiredEvidence),
      });
      expect(result.status, `${method.key}: ${result.gaps}`).toBe("draft");
      expect(result.authoritative).toBe(false);
      expect(result.humanApprovalRequired).toBe(true);
      expect(result.requiredApproverRoleKey).toBe(
        "domain_civil_infrastructure_reviewer",
      );
    }
  });

  it("blocks every civil-infrastructure method without canonical evidence", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "civil-infrastructure",
    )!;
    for (const method of module.methods) {
      const result = evaluateDomainSpecialist({
        moduleKey: module.key,
        methodKey: method.key,
        inputs: method.exampleInputs,
        evidence: [],
      });
      expect(result.status).toBe("blocked");
    }
  });

  it("makes the healthcare family executable, evidence-bound and non-authoritative", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "healthcare-clinical-engineering",
    )!;
    expect(module.methods.map((method) => method.key)).toEqual([
      "clinical-criticality",
      "device-availability",
      "calibration-assurance",
      "infection-control-readiness",
      "patient-risk",
      "device-traceability",
    ]);
    for (const method of module.methods) {
      const result = evaluateDomainSpecialist({
        moduleKey: module.key,
        methodKey: method.key,
        inputs: method.exampleInputs,
        evidence: evidenceFor(method.requiredEvidence),
      });
      expect(result.status, `${method.key}: ${result.gaps}`).toBe("draft");
      expect(result.authoritative).toBe(false);
      expect(result.humanApprovalRequired).toBe(true);
      expect(result.requiredApproverRoleKey).toBe(
        "domain_healthcare_clinical_engineering_reviewer",
      );
    }
  });

  it("blocks healthcare calculations without canonical evidence", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "healthcare-clinical-engineering",
    )!;
    for (const method of module.methods) {
      const result = evaluateDomainSpecialist({
        moduleKey: module.key,
        methodKey: method.key,
        inputs: method.exampleInputs,
        evidence: [],
      });
      expect(result.status).toBe("blocked");
      expect(result.gaps).not.toHaveLength(0);
    }
  });

  it("refuses patient identifiers at the healthcare specialist boundary", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "healthcare-clinical-engineering",
    )!;
    const method = module.methods.find(
      (candidate) => candidate.key === "patient-risk",
    )!;
    const inputs = structuredClone(method.exampleInputs);
    (inputs.hazards as Array<Record<string, unknown>>)[0].patientId =
      "MRN-12345";
    const result = evaluateDomainSpecialist({
      moduleKey: module.key,
      methodKey: method.key,
      inputs,
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.status).toBe("blocked");
    expect(result.gaps.join(" ")).toMatch(/patient identifiers/i);
    expect(JSON.stringify(result)).not.toContain("MRN-12345");
  });

  it("makes the full buildings and facilities family executable and non-authoritative", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "buildings-infrastructure",
    )!;
    expect(module.methods.map((method) => method.key)).toEqual([
      "code-compliance",
      "fire-life-safety",
      "occupancy-accessibility",
      "occupant-environment",
      "bas-control-integrity",
      "energy-water-performance",
      "facility-renewal-priority",
    ]);
    for (const method of module.methods) {
      const result = evaluateDomainSpecialist({
        moduleKey: module.key,
        methodKey: method.key,
        inputs: method.exampleInputs,
        evidence: evidenceFor(method.requiredEvidence),
      });
      expect(result.status, `${method.key}: ${result.gaps}`).toBe("draft");
      expect(result.authoritative).toBe(false);
      expect(result.humanApprovalRequired).toBe(true);
    }
  });

  it("does not treat unapproved occupied-environment criteria as compliance", () => {
    const method = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "buildings-infrastructure",
    )!.methods.find((candidate) => candidate.key === "occupant-environment")!;
    const inputs = structuredClone(method.exampleInputs);
    (
      inputs.observations as Array<Record<string, unknown>>
    )[0].criteriaApproved = false;
    const result = evaluateDomainSpecialist({
      moduleKey: "buildings-infrastructure",
      methodKey: method.key,
      inputs,
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.status).toBe("draft");
    expect(
      result.metrics.find((metric) => metric.key === "occupied_compliance")
        ?.value,
    ).toBe(0);
    expect(result.gaps.join(" ")).toMatch(/not authority-approved/i);
  });

  it("surfaces BAS overrides instead of implying control integrity", () => {
    const method = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "buildings-infrastructure",
    )!.methods.find((candidate) => candidate.key === "bas-control-integrity")!;
    const inputs = structuredClone(method.exampleInputs);
    const point = (inputs.controlPoints as Array<Record<string, unknown>>)[0];
    point.manualOverrideActive = true;
    point.overrideApproved = false;
    const result = evaluateDomainSpecialist({
      moduleKey: "buildings-infrastructure",
      methodKey: method.key,
      inputs,
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.status).toBe("draft");
    expect(
      result.metrics.find((metric) => metric.key === "coverage")?.value,
    ).toBe(0);
    expect(result.gaps.join(" ")).toMatch(/override control is incomplete/i);
  });

  it("calculates only approved like-for-like energy and water variance", () => {
    const method = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "buildings-infrastructure",
    )!.methods.find(
      (candidate) => candidate.key === "energy-water-performance",
    )!;
    const result = evaluateDomainSpecialist({
      moduleKey: "buildings-infrastructure",
      methodKey: method.key,
      inputs: method.exampleInputs,
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.status).toBe("draft");
    expect(
      result.metrics.find((metric) => metric.key === "energy_variance_pct")
        ?.value,
    ).toBe(-8);
    expect(
      result.metrics.find((metric) => metric.key === "water_variance_pct")
        ?.value,
    ).toBe(-3.2);

    const inputs = structuredClone(method.exampleInputs);
    (
      inputs.periods as Array<Record<string, unknown>>
    )[0].normalizationApproved = false;
    const blocked = evaluateDomainSpecialist({
      moduleKey: "buildings-infrastructure",
      methodKey: method.key,
      inputs,
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.gaps.join(" ")).toMatch(/no supplied period/i);
  });

  it("keeps mandatory renewal work ahead of economics and blocks an empty evidence-ready scope", () => {
    const method = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "buildings-infrastructure",
    )!.methods.find(
      (candidate) => candidate.key === "facility-renewal-priority",
    )!;
    const result = evaluateDomainSpecialist({
      moduleKey: "buildings-infrastructure",
      methodKey: method.key,
      inputs: method.exampleInputs,
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.status).toBe("draft");
    expect(result.findings[0]).toMatch(/FIRE-PUMP-1.*MANDATORY/i);

    const inputs = structuredClone(method.exampleInputs);
    for (const candidate of inputs.candidates as Array<Record<string, unknown>>)
      candidate.evidenceReady = false;
    const blocked = evaluateDomainSpecialist({
      moduleKey: "buildings-infrastructure",
      methodKey: method.key,
      inputs,
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.gaps.join(" ")).toMatch(/no supplied renewal candidate/i);
  });

  it("keeps battery thermal, HV, degradation, and fire decisions evidence-bound and non-authoritative", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "battery-energy-storage",
    )!;
    expect(module.methods.map((method) => method.key)).toEqual([
      "battery-thermal-envelope",
      "battery-hv-safety",
      "battery-degradation",
      "battery-fire-readiness",
    ]);
    for (const method of module.methods) {
      const result = evaluateDomainSpecialist({
        moduleKey: module.key,
        methodKey: method.key,
        inputs: method.exampleInputs,
        evidence: evidenceFor(method.requiredEvidence),
      });
      expect(result.status, `${method.key}: ${result.gaps}`).toBe("draft");
      expect(result.authoritative).toBe(false);
      expect(result.humanApprovalRequired).toBe(true);
    }
  });

  it("refuses to invent a battery degradation threshold", () => {
    const method = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "battery-energy-storage",
    )!.methods.find((candidate) => candidate.key === "battery-degradation")!;
    const inputs = structuredClone(method.exampleInputs);
    delete (inputs.units as Array<Record<string, unknown>>)[0]
      .minimumCapacityRetention;
    const result = evaluateDomainSpecialist({
      moduleKey: "battery-energy-storage",
      methodKey: method.key,
      inputs,
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.status).toBe("blocked");
    expect(result.gaps.join(" ")).toMatch(/minimum capacity retention/i);
  });

  it("executes every governed example without claiming authority", () => {
    for (const module of DOMAIN_SPECIALIST_MODULES) {
      for (const method of module.methods) {
        const result = evaluateDomainSpecialist({
          moduleKey: module.key,
          methodKey: method.key,
          inputs: method.exampleInputs,
          evidence: evidenceFor(method.requiredEvidence),
        });
        expect(
          result.status,
          `${module.key}/${method.key}: ${result.gaps}`,
        ).toBe("draft");
        expect(result.modelKey).toBe(`domain.${module.key}.${method.key}`);
        expect(result.modelVersion).toBe(module.version);
        expect(result.authoritative).toBe(false);
        expect(result.humanApprovalRequired).toBe(true);
        expect(result.authorityBoundary).toMatch(/cannot certify compliance/);
      }
    }
  });

  it("refuses missing evidence instead of turning absent records into a pass", () => {
    const result = evaluateDomainSpecialist({
      moduleKey: "petrochemical-rbi",
      methodKey: "rbi-corrosion-loop",
      inputs: DOMAIN_SPECIALIST_MODULES.find(
        (module) => module.key === "petrochemical-rbi",
      )!.methods[0].exampleInputs,
      evidence: [],
    });
    expect(result.status).toBe("blocked");
    expect(result.metrics).toEqual([]);
    expect(result.gaps).toContain(
      "Missing required evidence reference: inspection-data.",
    );
  });

  it("does not invent a corrosion rate, RBI matrix cell, or inspection rule", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "petrochemical-rbi",
    )!;
    const method = module.methods[0];
    const result = evaluateDomainSpecialist({
      moduleKey: module.key,
      methodKey: method.key,
      inputs: {
        inspectionFraction: 0.5,
        riskMatrix: { "1:A": "low" },
        circuits: [
          {
            id: "CL-1",
            previousThickness: 10,
            currentThickness: 9,
            elapsedYears: 2,
            minimumThickness: 7,
            probabilityCategory: "2",
            consequenceCategory: "B",
          },
        ],
      },
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.status).toBe("draft");
    const corrosionRateMetric = ["CL-1", "corrosion", "rate"].join("_");
    expect(
      result.metrics.find((metric) => metric.key === corrosionRateMetric)
        ?.value,
    ).toBe(0.5);
    expect(result.gaps).toContain(
      "CL-1: approved risk matrix has no 2:B cell.",
    );
    expect(result.formulae.join(" ")).toMatch(/Candidate interval/);
  });

  it("calculates a precedence-feasible line balance from supplied takt inputs", () => {
    const method = DOMAIN_SPECIALIST_MODULES.find(
      (module) => module.key === "manufacturing-operations",
    )!.methods.find((candidate) => candidate.key === "line-balancing")!;
    const result = evaluateDomainSpecialist({
      moduleKey: "manufacturing-operations",
      methodKey: method.key,
      inputs: {
        availableMinutes: 60,
        requiredUnits: 10,
        tasks: [
          { id: "A", minutes: 4, predecessors: [] },
          { id: "B", minutes: 3, predecessors: ["A"] },
          { id: "C", minutes: 2, predecessors: ["A"] },
        ],
      },
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.status).toBe("draft");
    expect(result.metrics.find((metric) => metric.key === "takt")?.value).toBe(
      6,
    );
    expect(result.findings[0]).toContain("A");
    expect(result.authoritative).toBe(false);
  });

  it("decomposes OEE only from approved and reconciled production inputs", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "manufacturing-operations",
    )!;
    const method = module.methods.find(
      (candidate) => candidate.key === "oee-loss-decomposition",
    )!;
    const result = evaluateDomainSpecialist({
      moduleKey: module.key,
      methodKey: method.key,
      inputs: method.exampleInputs,
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.status).toBe("draft");
    expect(
      result.metrics.find((metric) => metric.key === "LINE-1/SHIFT-A_oee")
        ?.value,
    ).toBe(76.6);
    expect(result.gaps).toEqual([]);
    expect(result.authorityBoundary).toMatch(/non-authoritative draft/i);
    expect(method.limitations.join(" ")).toMatch(/change line speed/i);
  });

  it("blocks OEE arithmetic when its governed time and count controls are incomplete", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "manufacturing-operations",
    )!;
    const method = module.methods.find(
      (candidate) => candidate.key === "oee-loss-decomposition",
    )!;
    const inputs = structuredClone(method.exampleInputs);
    (inputs.periods as Record<string, unknown>[])[0].downtimeReconciled = false;
    const result = evaluateDomainSpecialist({
      moduleKey: module.key,
      methodKey: method.key,
      inputs,
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.metrics).toEqual([]);
    expect(result.gaps[0]).toMatch(/reconciled downtime history/);
  });

  it("reconciles manufacturing quality loss without releasing product", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "manufacturing-operations",
    )!;
    const method = module.methods.find(
      (candidate) => candidate.key === "quality-loss-reconciliation",
    )!;
    const result = evaluateDomainSpecialist({
      moduleKey: module.key,
      methodKey: method.key,
      inputs: method.exampleInputs,
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(
      result.metrics.find(
        (metric) => metric.key === "LOT-2401_first_pass_yield",
      )?.value,
    ).toBe(94);
    expect(result.authorityBoundary).toMatch(
      /release an asset\/product\/facility/i,
    );
    expect(method.limitations.join(" ")).toMatch(/release product/i);
  });

  it("refuses to manufacture a quality-loss result from unreconciled counts", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "manufacturing-operations",
    )!;
    const method = module.methods.find(
      (candidate) => candidate.key === "quality-loss-reconciliation",
    )!;
    const inputs = structuredClone(method.exampleInputs);
    (inputs.lots as Record<string, unknown>[])[0].scrapUnits = 10;
    const result = evaluateDomainSpecialist({
      moduleKey: module.key,
      methodKey: method.key,
      inputs,
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.metrics).toEqual([]);
    expect(result.gaps[0]).toMatch(/does not equal total produced/);
  });

  it("blocks tooling remaining-life arithmetic when trace controls are incomplete", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "manufacturing-operations",
    )!;
    const method = module.methods.find(
      (candidate) => candidate.key === "tooling-life-assurance",
    )!;
    const inputs = structuredClone(method.exampleInputs);
    (inputs.tools as Record<string, unknown>[])[0].qualityTraceCurrent = false;
    const result = evaluateDomainSpecialist({
      moduleKey: module.key,
      methodKey: method.key,
      inputs,
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.metrics[0].value).toBeNull();
    expect(result.gaps[0]).toMatch(/quality trace/);
    expect(result.authorityBoundary).toMatch(/approve a limit/i);
    expect(method.limitations.join(" ")).toMatch(/extend tool life/i);
  });

  it("separates changeover duration from governed production release readiness", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "manufacturing-operations",
    )!;
    const method = module.methods.find(
      (candidate) => candidate.key === "changeover-readiness",
    )!;
    const inputs = structuredClone(method.exampleInputs);
    (inputs.changeovers as Record<string, unknown>[])[0].firstOffApproved =
      false;
    const result = evaluateDomainSpecialist({
      moduleKey: module.key,
      methodKey: method.key,
      inputs,
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.metrics[0].value).toBe(7);
    expect(result.gaps[0]).toMatch(/first-off quality result/);
    expect(result.summary).toMatch(/duration alone never establishes/i);
  });

  it("finds the exact shortest bounded route and preserves dispatch authority", () => {
    const method = DOMAIN_SPECIALIST_MODULES.find(
      (module) => module.key === "transport-logistics",
    )!.methods.find(
      (candidate) => candidate.key === "route-depot-optimization",
    )!;
    const result = evaluateDomainSpecialist({
      moduleKey: "transport-logistics",
      methodKey: method.key,
      inputs: method.exampleInputs,
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.status).toBe("draft");
    expect(result.findings[0]).toBe("D → A → B → D");
    expect(
      result.metrics.find((metric) => metric.key === "travel_cost")?.value,
    ).toBe(50);
    expect(result.authorityBoundary).toMatch(/dispatch resources/);
  });

  it("blocks life arithmetic when back-to-birth trace is incomplete", () => {
    const method = DOMAIN_SPECIALIST_MODULES.find(
      (module) => module.key === "aviation-airworthiness",
    )!.methods.find((candidate) => candidate.key === "life-limited-part")!;
    const result = evaluateDomainSpecialist({
      moduleKey: "aviation-airworthiness",
      methodKey: method.key,
      inputs: {
        parts: [
          {
            partNumber: "PN",
            serialNumber: "SN",
            approvedLimit: 10_000,
            unit: "cycles",
            authenticatedUsage: [4_000],
            backToBirthComplete: false,
            configurationCurrent: true,
          },
        ],
      },
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.status).toBe("draft");
    expect(result.metrics[0].value).toBeNull();
    expect(result.gaps[0]).toMatch(/remaining life is blocked/);
  });

  it("requires an explicit canonical evidence binding for every evidence key", () => {
    const method = DOMAIN_SPECIALIST_MODULES[0].methods[0];
    const evidence = evidenceFor(method.requiredEvidence);
    evidence[0] = { ...evidence[0], evidenceItemId: "" };
    const result = evaluateDomainSpecialist({
      moduleKey: "oil-sands-tailings",
      methodKey: method.key,
      inputs: method.exampleInputs,
      evidence,
    });
    expect(result.status).toBe("blocked");
    expect(result.gaps).toContain(
      "Missing canonical evidence binding: geotechnical-model.",
    );
  });

  it("does not treat missing GxP change-control state as closed", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "pharmaceutical-quality",
    )!;
    const method = module.methods.find(
      (candidate) => candidate.key === "gxp-validation",
    )!;
    const result = evaluateDomainSpecialist({
      moduleKey: module.key,
      methodKey: method.key,
      inputs: {
        requirements: [
          {
            id: "URS-1",
            inScope: true,
            testReference: "OQ-12",
            result: "passed",
            approved: true,
          },
        ],
      },
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.status).toBe("draft");
    expect(
      result.metrics.find((metric) => metric.key === "coverage")?.value,
    ).toBe(0);
    expect(result.gaps[0]).toMatch(/change-control state/);
  });

  it("blocks an empty applicable airworthiness scope", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "aviation-airworthiness",
    )!;
    const method = module.methods.find(
      (candidate) => candidate.key === "airworthiness-compliance",
    )!;
    const result = evaluateDomainSpecialist({
      moduleKey: module.key,
      methodKey: method.key,
      inputs: { instructions: [{ id: "AD-1", applicable: false }] },
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.status).toBe("blocked");
    expect(result.gaps[0]).toMatch(/scope must contain at least one record/);
  });

  it("blocks duplicate line-balancing task identifiers", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "manufacturing-operations",
    )!;
    const method = module.methods.find(
      (candidate) => candidate.key === "line-balancing",
    )!;
    const result = evaluateDomainSpecialist({
      moduleKey: module.key,
      methodKey: method.key,
      inputs: {
        availableMinutes: 60,
        requiredUnits: 10,
        tasks: [
          { id: "A", minutes: 2, predecessors: [] },
          { id: "A", minutes: 3, predecessors: [] },
        ],
      },
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.status).toBe("blocked");
    expect(result.gaps[0]).toMatch(/duplicate ID A/);
  });

  it("blocks negative route values and separates travel time from cost", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "transport-logistics",
    )!;
    const method = module.methods.find(
      (candidate) => candidate.key === "route-depot-optimization",
    )!;
    const inputs = structuredClone(method.exampleInputs);
    (inputs.travelCosts as Record<string, number>)["D:A"] = -10;
    const result = evaluateDomainSpecialist({
      moduleKey: module.key,
      methodKey: method.key,
      inputs,
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.status).toBe("blocked");
    expect(result.gaps[0]).toMatch(/travel cost must not be negative/);
  });

  it("blocks factorial route searches above the bounded limit", () => {
    const module = DOMAIN_SPECIALIST_MODULES.find(
      (candidate) => candidate.key === "transport-logistics",
    )!;
    const method = module.methods.find(
      (candidate) => candidate.key === "route-depot-optimization",
    )!;
    const result = evaluateDomainSpecialist({
      moduleKey: module.key,
      methodKey: method.key,
      inputs: {
        stops: Array.from({ length: 9 }, (_, index) => ({
          id: `S-${index}`,
          demand: 1,
          serviceMinutes: 1,
        })),
        depots: [{ id: "D", capacity: 20, availableMinutes: 500 }],
        travelCosts: { "D:S-0": 1 },
        travelMinutes: { "D:S-0": 1 },
      },
      evidence: evidenceFor(method.requiredEvidence),
    });
    expect(result.status).toBe("blocked");
    expect(result.gaps).toContain(
      "Exact route optimization is limited to 8 stops.",
    );
  });
});
