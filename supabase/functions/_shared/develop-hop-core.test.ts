import { describe, expect, it } from "vitest";
import {
  analyzeHopScreen,
  HOP_CATEGORIES,
  type HopAgentScreen,
} from "./develop-hop-core";

const base: HopAgentScreen = {
  organizationId: "org",
  asOf: "2026-09-12T00:00:00Z",
  lookbackDays: 90,
  eventCount: 0,
  eventLimit: 500,
  eventsTruncated: false,
  unclassifiedEventCount: 0,
  caseCount: 1,
  caseLimit: 100,
  casesTruncated: false,
  events: [],
  decisionDelays: [],
  unclearAuthority: [],
  workarounds: [],
  repeatDeviations: [],
  overloadedRoles: [],
  basis: "canonical sources",
};
describe("D12.19 HOP deterministic analysis", () => {
  it("always reports all nine system-condition categories", () => {
    const out = analyzeHopScreen(base);
    expect(out.categoryCounts.map((x) => x.key)).toEqual(HOP_CATEGORIES);
    expect(out.categoryCounts.every((x) => x.count === 0)).toBe(true);
  });
  it("combines human observations and governed source signals without people", () => {
    const out = analyzeHopScreen({
      ...base,
      eventCount: 1,
      events: [
        {
          id: 1,
          occurredAt: base.asOf,
          caseId: null,
          workOrderId: null,
          errorType: "lapse",
          outcomeSeverity: "near_miss",
          categories: ["task_complexity"],
          conditions:
            "The task sequence contained ambiguous branching instructions.",
          correctiveAction: null,
          basis: "Observed during a controlled field review.",
          evidenceRefs: ["evidence:1"],
        },
      ],
      decisionDelays: [
        {
          decisionId: "d1",
          caseId: "c1",
          caseTitle: "Pump renewal",
          requiredDate: "2026-09-01",
          sourceRef: "decisions:d1",
        },
      ],
      overloadedRoles: [
        {
          caseId: "c1",
          caseTitle: "Pump renewal",
          overCommittedPools: 2,
          sourceRef: "rpc:get_case_resource_balance",
        },
      ],
    });
    expect(out.findings).toHaveLength(3);
    expect(
      out.categoryCounts.find((x) => x.key === "task_complexity")?.count,
    ).toBe(1);
    expect(JSON.stringify(out)).not.toMatch(
      /email|workerId|memberId|personId|ownerId/i,
    );
  });
  it("states non-surveillance, human authority, and bounded-zero limitations", () => {
    const text = analyzeHopScreen(base).limitations.join(" ");
    expect(text).toMatch(/not worker surveillance/i);
    expect(text).toMatch(/cannot assign blame/i);
    expect(text).toMatch(/not proof/i);
    expect(text).toMatch(/no unsupported threshold/i);
  });
  it("discloses legacy observations that cannot be categorized", () => {
    expect(
      analyzeHopScreen({ ...base, unclassifiedEventCount: 2 }).limitations.join(
        " ",
      ),
    ).toMatch(/2 legacy event\(s\).*excluded/i);
  });
});
