import { describe, expect, it } from "vitest";
import * as realize from "./realize";
import {
  CHECKPOINT_HORIZONS,
  DELIVERY_FAILURE_TYPES,
  WARRANTY_METRICS,
  checkpointDueOn,
  checkpointLifecycle,
  checkpointLifecycleLabel,
  isCheckpointHorizon,
  isDeliveryFailureType,
  isWarrantyMetric,
  lessonRecordRefusal,
  warrantyCompleteness,
} from "./realize";

describe("spec vocabularies (pinned to SQL helpers in the slice test)", () => {
  it("carries the seven I.36 warranted metrics in spec order", () => {
    expect(WARRANTY_METRICS).toEqual([
      "throughput",
      "availability",
      "reliability",
      "maintenance_cost",
      "energy",
      "quality",
      "operating_cost",
    ]);
  });

  it("carries the four post-startup horizons — not the RIA 30/60/90 leftover", () => {
    expect(CHECKPOINT_HORIZONS).toEqual([30, 90, 180, 365]);
    expect(CHECKPOINT_HORIZONS).not.toContain(60);
  });

  it("carries the eight I.37 delivery failure types as taxonomy keys", () => {
    expect(DELIVERY_FAILURE_TYPES).toHaveLength(8);
    expect(DELIVERY_FAILURE_TYPES.every((k) => k.startsWith("project_delivery."))).toBe(
      true,
    );
    expect(DELIVERY_FAILURE_TYPES).toContain("project_delivery.benefit_shortfall");
  });
});

describe("warrantyCompleteness", () => {
  it("an unstated metric is not warranted — never zero", () => {
    const c = warrantyCompleteness([
      { key: "availability", target: 0.95, unit: "fraction" },
    ]);
    expect(c.stated).toEqual([
      { key: "availability", target: 0.95, unit: "fraction" },
    ]);
    expect(c.notWarranted).toEqual([
      "throughput",
      "reliability",
      "maintenance_cost",
      "energy",
      "quality",
      "operating_cost",
    ]);
  });

  it("a target without a unit is not a stated metric", () => {
    const c = warrantyCompleteness([
      { key: "energy", target: 12, unit: "  " },
      { key: "quality", target: null, unit: "%" },
    ]);
    expect(c.stated).toEqual([]);
    expect(c.notWarranted).toHaveLength(7);
  });

  it("ignores keys that are not in the seven — no invented eighth metric", () => {
    const c = warrantyCompleteness([
      { key: "mtbf", target: 8000, unit: "h" },
      { key: "availability", target: 0.97, unit: "fraction" },
    ]);
    expect(c.stated.map((s) => s.key)).toEqual(["availability"]);
    expect(isWarrantyMetric("mtbf")).toBe(false);
  });
});

describe("checkpointDueOn", () => {
  it("adds horizon days the same way the server does (startup + N days)", () => {
    expect(checkpointDueOn("2026-01-01", 30)).toBe("2026-01-31");
    expect(checkpointDueOn("2026-01-01", 90)).toBe("2026-04-01");
    expect(checkpointDueOn("2026-01-01", 180)).toBe("2026-06-30");
    expect(checkpointDueOn("2026-01-01", 365)).toBe("2027-01-01");
  });

  it("refuses an invented horizon rather than dating it", () => {
    expect(checkpointDueOn("2026-01-01", 60)).toBeNull();
    expect(isCheckpointHorizon(60)).toBe(false);
  });

  it("refuses an unparseable startup rather than inventing a due date", () => {
    expect(checkpointDueOn("not-a-date", 30)).toBeNull();
  });
});

describe("checkpointLifecycle — observation is not verification", () => {
  it("no startup means the clock has not started — not overdue, not clear", () => {
    expect(
      checkpointLifecycle({
        startupAt: null,
        observedAt: null,
        status: "projected",
      }),
    ).toBe("clock_not_started");
  });

  it("a design target sitting on a started clock is awaiting observation", () => {
    expect(
      checkpointLifecycle({
        startupAt: "2026-01-01",
        observedAt: null,
        status: "projected",
      }),
    ).toBe("awaiting_observation");
  });

  it("an observed actual that has not been verified is not authorized", () => {
    expect(
      checkpointLifecycle({
        startupAt: "2026-01-01",
        observedAt: "2026-02-01T00:00:00Z",
        status: "projected",
      }),
    ).toBe("observed_unverified");
    expect(checkpointLifecycleLabel("observed_unverified")).toMatch(
      /separate human act/,
    );
  });

  it("verified / rejected are terminal and do not depend on the clock", () => {
    expect(
      checkpointLifecycle({
        startupAt: null,
        observedAt: "2026-02-01T00:00:00Z",
        status: "verified",
      }),
    ).toBe("verified");
    expect(
      checkpointLifecycle({
        startupAt: "2026-01-01",
        observedAt: "2026-02-01T00:00:00Z",
        status: "rejected",
      }),
    ).toBe("rejected");
  });
});

describe("lessonRecordRefusal", () => {
  const ok = {
    failureModeKey: "project_delivery.commissioning_defect",
    cause: "Vendor torque procedure omitted the hold point",
    correctiveAction: "Add the hold point to the commissioning ITP",
    applicability: "Rotating equipment packages with vendor-led commissioning",
  };

  it("accepts a complete I.37 lesson", () => {
    expect(lessonRecordRefusal(ok)).toBeNull();
    expect(isDeliveryFailureType(ok.failureModeKey)).toBe(true);
  });

  it("refuses a failure type that is not one of the eight", () => {
    expect(
      lessonRecordRefusal({ ...ok, failureModeKey: "bearing_wear" }),
    ).toMatch(/eight delivery failure types/);
  });

  it("refuses a lesson that cannot close or cannot screen", () => {
    expect(lessonRecordRefusal({ ...ok, cause: "short" })).toMatch(/cause/);
    expect(
      lessonRecordRefusal({ ...ok, correctiveAction: "fix it" }),
    ).toMatch(/corrective action/);
    expect(
      lessonRecordRefusal({ ...ok, applicability: "maybe" }),
    ).toMatch(/applicability/);
  });
});

describe("lessonAppliesToCase — deterministic D9.12, no score", () => {
  const caseRow = {
    caseId: "new-case",
    lifecycleType: "brownfield",
    title: "Primary crusher upgrade",
    problemStatement: "The existing crusher cannot hold the required throughput",
  };

  it("matches the same lifecycle type from the source case", () => {
    expect(
      realize.lessonAppliesToCase({
        ...caseRow,
        lessonCaseId: "old-case",
        sourceLifecycleType: "brownfield",
        applicability: "Applies to brownfield crusher upgrades on this site",
      }),
    ).toBe(true);
  });

  it("matches when applicability names the lifecycle type", () => {
    expect(
      realize.lessonAppliesToCase({
        ...caseRow,
        lessonCaseId: "old-case",
        sourceLifecycleType: "greenfield",
        applicability: "Use on any brownfield modification of comminution plant",
      }),
    ).toBe(true);
  });

  it("matches a significant token shared with the new problem statement", () => {
    expect(
      realize.lessonAppliesToCase({
        ...caseRow,
        lessonCaseId: "old-case",
        sourceLifecycleType: "greenfield",
        applicability: "Crusher liner changes that starved downstream throughput",
      }),
    ).toBe(true);
  });

  it("does not match a case against its own lessons", () => {
    expect(
      realize.lessonAppliesToCase({
        ...caseRow,
        caseId: "same",
        lessonCaseId: "same",
        sourceLifecycleType: "brownfield",
        applicability: "Applies to brownfield crusher upgrades on this site",
      }),
    ).toBe(false);
  });

  it("does not match on stopwords alone", () => {
    expect(
      realize.lessonAppliesToCase({
        caseId: "new-case",
        lifecycleType: "regulatory",
        title: "The project case",
        problemStatement: "This project will apply after the lesson",
        lessonCaseId: "old-case",
        sourceLifecycleType: "greenfield",
        applicability: "This project applies after the lesson from that case",
      }),
    ).toBe(false);
  });
});

describe("valueRealizationRatio — never fabricates 0% or 100%", () => {
  it("refuses without an approved BENEFITS baseline", () => {
    const r = realize.valueRealizationRatio({
      approvedExpectedBenefit: 100,
      approvedExpectedUnit: "usd",
      realizedBenefit: 80,
      mixedUnits: false,
      hasApprovedBenefitsBaseline: false,
      snapshotPresent: true,
    });
    expect(r.evaluable).toBe(false);
    if (!r.evaluable) {
      expect(r.refusal).toBe("no_approved_benefits_baseline");
    }
  });

  it("refuses mixed units rather than adding them", () => {
    const r = realize.valueRealizationRatio({
      approvedExpectedBenefit: 100,
      approvedExpectedUnit: "usd",
      realizedBenefit: 80,
      mixedUnits: true,
      hasApprovedBenefitsBaseline: true,
      snapshotPresent: true,
    });
    expect(r.evaluable).toBe(false);
    if (!r.evaluable) expect(r.refusal).toBe("mixed_units");
  });

  it("refuses a zero denominator", () => {
    const r = realize.valueRealizationRatio({
      approvedExpectedBenefit: 0,
      approvedExpectedUnit: "usd",
      realizedBenefit: 0,
      mixedUnits: false,
      hasApprovedBenefitsBaseline: true,
      snapshotPresent: true,
    });
    expect(r.evaluable).toBe(false);
    if (!r.evaluable) expect(r.refusal).toBe("zero_denominator");
  });

  it("returns Realized / Approved when both sides exist", () => {
    const r = realize.valueRealizationRatio({
      approvedExpectedBenefit: 200,
      approvedExpectedUnit: "usd",
      realizedBenefit: 50,
      mixedUnits: false,
      hasApprovedBenefitsBaseline: true,
      snapshotPresent: true,
    });
    expect(r).toEqual({ evaluable: true, ratio: 0.25, unit: "usd" });
  });
});

describe("phaseSuccessVerdict — on-budget-but-unreliable is failure", () => {
  it("a passing gate with failing RAM is not success", () => {
    expect(
      realize.phaseSuccessVerdict({
        gateVerdict: "met",
        costVerdict: "met",
        ramVerdict: "not_met",
      }),
    ).toBe("not_success");
  });

  it("missing RAM does not become success", () => {
    expect(
      realize.phaseSuccessVerdict({
        gateVerdict: "met",
        costVerdict: "met",
        ramVerdict: "missing",
      }),
    ).toBe("success");
  });

  it("an unreviewed gate is incomplete, not a pass", () => {
    expect(
      realize.phaseSuccessVerdict({
        gateVerdict: "incomplete",
        costVerdict: "met",
        ramVerdict: "met",
      }),
    ).toBe("incomplete");
  });
});

describe("this module does not authorize", () => {
  it("exports no verify / adopt / authorize helper — those doors stay on the server", () => {
    const names = Object.keys(realize);
    for (const name of names) {
      expect(name).not.toMatch(/verify|authorize|adopt/i);
    }
  });
});
