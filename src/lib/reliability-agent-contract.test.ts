import { describe, expect, it } from "vitest";
import { createSeedDecisionCases } from "./decision-case";
import {
  RELIABILITY_AGENT_BENCHMARKS,
  RELIABILITY_AGENT_REQUIRED_DIMENSIONS,
  classifyDecisionQuestionScope,
  isActiveCaseTraceRequest,
} from "./reliability-agent-contract";

describe("reliability agent behavior contract", () => {
  it("covers conversation and the major reliability decision families", () => {
    const capabilities = RELIABILITY_AGENT_BENCHMARKS.map(
      (benchmark) => benchmark.capability,
    ).join(" ");

    expect(RELIABILITY_AGENT_BENCHMARKS.length).toBeGreaterThanOrEqual(12);
    expect(capabilities).toMatch(/conversation/i);
    expect(capabilities).toMatch(/RCA/i);
    expect(capabilities).toMatch(/FRACAS/i);
    expect(capabilities).toMatch(/FMEA/i);
    expect(capabilities).toMatch(/RCM/i);
    expect(capabilities).toMatch(/RAM/i);
    expect(capabilities).toMatch(/PM optimization/i);
    expect(capabilities).toMatch(/value/i);
    expect(RELIABILITY_AGENT_REQUIRED_DIMENSIONS).toHaveLength(9);
  });

  it.each(
    RELIABILITY_AGENT_BENCHMARKS.filter((benchmark) =>
      benchmark.expectedRoute.startsWith("agent_"),
    ),
  )("routes $id without leaking the active case", (benchmark) => {
    const active = createSeedDecisionCases({
      industry: benchmark.industry,
    })[0];
    const scope = classifyDecisionQuestionScope(active, benchmark.prompt);

    expect(scope).toBe(
      benchmark.expectedRoute === "agent_new_subject"
        ? "provisional_new_subject"
        : "active_case",
    );
    expect(isActiveCaseTraceRequest(active, benchmark.prompt)).toBe(false);
    expect(benchmark.requiredBehaviors.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps only explicit active-case audits on the deterministic trace path", () => {
    const [active] = createSeedDecisionCases();

    expect(
      isActiveCaseTraceRequest(
        active,
        "Show the calculations and exact source records for this case.",
      ),
    ).toBe(true);
    expect(
      isActiveCaseTraceRequest(
        active,
        "Calculate MTBF for compressor C-330 from 7,100 operating hours and 7 failures.",
      ),
    ).toBe(false);
    expect(
      classifyDecisionQuestionScope(
        active,
        "Calculate MTBF for compressor C-330 from 7,100 operating hours and 7 failures.",
      ),
    ).toBe("provisional_new_subject");
  });

  it("recognizes an OEM model as a new subject even in a short follow-up", () => {
    const [active] = createSeedDecisionCases({ industry: "mining" });

    expect(
      classifyDecisionQuestionScope(
        active,
        "What are your steps to onboard a Caterpillar 797 truck in an Alberta oil sands mine?",
      ),
    ).toBe("provisional_new_subject");
    expect(
      classifyDecisionQuestionScope(active, "Caterpillar 797 Dump truck"),
    ).toBe("provisional_new_subject");
  });
});
