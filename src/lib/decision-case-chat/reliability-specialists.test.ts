import { describe, expect, it } from "vitest";
import {
  buildSpecialistBrief,
  selectReliabilitySpecialists,
  specialistClaimTypes,
} from "../../../supabase/functions/_shared/reliability-specialists";

describe("reliability specialist orchestration", () => {
  it("combines method specialists for a safety-critical PM interval question", () => {
    const specialists = selectReliabilitySpecialists(
      "Can we extend a safety-critical proof-test inspection interval without a validated P-F interval?",
    );
    const ids = specialists.map((specialist) => specialist.id);

    expect(ids).toContain("fmea-rcm-pm");
    expect(ids).toContain("authority-risk");
    expect(specialistClaimTypes(specialists)).toContain("maintenance_task");
    expect(buildSpecialistBrief(specialists)).toContain(
      "Reject calendar changes based only on zero recorded failures",
    );
  });

  it("combines quantitative, condition, RCA, and authority lenses for a trip question", () => {
    const specialists = selectReliabilitySpecialists(
      "Seven low-pressure trips followed startup. Historian calibration conflicts. Should we lower the protective trip setpoint?",
    );
    const ids = specialists.map((specialist) => specialist.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "rca-fracas",
        "condition-monitoring",
        "authority-risk",
      ]),
    );
    expect(specialistClaimTypes(specialists)).toContain("nameplate_spec");
  });

  it("uses a senior generalist for an unclassified reliability question", () => {
    const specialists = selectReliabilitySpecialists(
      "What should I consider before making this decision?",
    );

    expect(specialists.map((specialist) => specialist.id)).toEqual([
      "general-reliability",
    ]);
  });

  it("selects inventory and value specialists for a critical-spares decision", () => {
    const specialists = selectReliabilitySpecialists(
      "Should min/max increase for a repairable critical spare with intermittent demand, long supplier lead time, and stockout exposure?",
    );
    const ids = specialists.map((specialist) => specialist.id);

    expect(ids).toContain("mro-inventory");
    expect(ids).toContain("lifecycle-value");
    expect(buildSpecialistBrief(specialists)).toContain(
      "Treat intermittent demand and insurance spares differently from consumables",
    );
  });

  it("selects planning and scheduling for a readiness and lookahead request", () => {
    const specialists = selectReliabilitySpecialists(
      "Build a 6-week lookahead from the backlog, check Ready to Schedule status, and level-load craft capacity.",
    );

    expect(specialists.map((specialist) => specialist.id)).toContain(
      "planning-scheduling",
    );
    expect(buildSpecialistBrief(specialists)).toContain(
      "Validate job scope, task sequence, labor and craft hours",
    );
  });
});
