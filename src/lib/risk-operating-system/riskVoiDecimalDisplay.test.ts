import { describe, expect, it } from "vitest";
import { evaluateValueOfInformation } from "./index";

// Synthetic representation fixtures, not financial limits or engineering policy.
// Expected decimals are the canonical NUMERIC round-to-cents result, decoded
// as the same JSON number a PostgREST receipt supplies.
describe("canonical VOI decimal-to-JSON display conversion", () => {
  it.each([
    [
      "large positive cents",
      0,
      100000000000000.03,
      0.999,
      1,
      "99900000000000.03",
      "99900000000000.03",
      "GATHER_INFORMATION",
    ],
    [
      "large negative cents",
      100000000000000.03,
      0,
      1,
      1,
      "0.00",
      "-100000000000000.03",
      "DECIDE_WITH_CURRENT_INFORMATION",
    ],
    [
      "finite scientific positive",
      0,
      1e307,
      1,
      1,
      "1e307",
      "1e307",
      "GATHER_INFORMATION",
    ],
    [
      "finite scientific negative",
      1e307,
      0,
      1,
      1,
      "0",
      "-1e307",
      "DECIDE_WITH_CURRENT_INFORMATION",
    ],
    [
      "maximum finite positive",
      0,
      Number.MAX_VALUE,
      1,
      1,
      String(Number.MAX_VALUE),
      String(Number.MAX_VALUE),
      "GATHER_INFORMATION",
    ],
    [
      "maximum finite negative",
      Number.MAX_VALUE,
      0,
      1,
      1,
      "0",
      String(-Number.MAX_VALUE),
      "DECIDE_WITH_CURRENT_INFORMATION",
    ],
    [
      "positive half-cent",
      0,
      0.005,
      1,
      1,
      "0.01",
      "0.01",
      "GATHER_INFORMATION",
    ],
    [
      "negative half-cent",
      0.005,
      0,
      1,
      1,
      "0",
      "-0.01",
      "DECIDE_WITH_CURRENT_INFORMATION",
    ],
    [
      "negative displayed zero",
      1e-308,
      0,
      1,
      1,
      "0",
      "0",
      "DECIDE_WITH_CURRENT_INFORMATION",
    ],
  ] as const)(
    "converts %s without rounding BigInt cents through a binary intermediate",
    (
      _name,
      informationCost,
      decisionCostIfWrong,
      uncertaintyReduction,
      probabilityDecisionChanges,
      expected,
      net,
      recommendation,
    ) => {
      const result = evaluateValueOfInformation({
        informationCost,
        decisionCostIfWrong,
        uncertaintyReduction,
        probabilityDecisionChanges,
      });
      expect(result.expectedValue).toBe(Number(expected));
      expect(result.netValue).toBe(Number(net));
      expect(Number.isFinite(result.expectedValue)).toBe(true);
      expect(Number.isFinite(result.netValue)).toBe(true);
      expect(result.recommendation).toBe(recommendation);
      expect(JSON.parse(JSON.stringify(result))).toMatchObject({
        expectedValue: Number(expected),
        netValue: Number(net),
        recommendation,
      });
    },
  );
});
