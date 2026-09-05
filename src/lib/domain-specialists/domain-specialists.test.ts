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
  }));
}

describe("domain-depth specialist registry", () => {
  it("covers the requested 14 industries and 29 executable methods", () => {
    expect(DOMAIN_SPECIALIST_MODULES).toHaveLength(14);
    expect(
      new Set(DOMAIN_SPECIALIST_MODULES.map((module) => module.industryCode))
        .size,
    ).toBe(14);
    const methods = DOMAIN_SPECIALIST_MODULES.flatMap((module) =>
      module.methods.map((method) => method.key),
    );
    expect(methods).toHaveLength(29);
    expect(new Set(methods).size).toBe(methods.length);
    expect(registeredDomainEvaluatorKeys()).toEqual([...methods].sort());
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
});
