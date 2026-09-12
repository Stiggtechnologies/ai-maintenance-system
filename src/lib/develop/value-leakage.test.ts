import { describe, expect, it } from "vitest";
import {
  RECORDABLE_VALUE_TRAJECTORY_POINTS,
  VALUE_LEAKAGE_BUCKETS,
  VALUE_TRAJECTORY_POINTS,
  summarizeValueLeakage,
} from "./realize";

describe("value leakage vocabulary and arithmetic", () => {
  it("pins the six II.24 lifecycle points", () => {
    expect(VALUE_TRAJECTORY_POINTS).toEqual([
      "original",
      "design",
      "sanction",
      "execution_forecast",
      "startup",
      "realized",
    ]);
    expect(RECORDABLE_VALUE_TRAJECTORY_POINTS).toEqual([
      "original",
      "design",
      "execution_forecast",
      "startup",
    ]);
  });

  it("pins all seven §53 attribution buckets", () => {
    expect(VALUE_LEAKAGE_BUCKETS).toEqual([
      "scope",
      "cost",
      "schedule",
      "reliability",
      "ramp_up",
      "operating_cost",
      "market_assumption",
    ]);
  });

  it("shows the unattributed residual instead of redistributing it", () => {
    expect(
      summarizeValueLeakage({
        approvedValue: 90,
        realizedValue: 64,
        attributions: [
          { bucket: "scope", value: 8 },
          { bucket: "schedule", value: 7 },
        ],
      }),
    ).toEqual({
      leakage: 26,
      attributed: 15,
      residual: 11,
      attributionValid: true,
    });
  });

  it("names an over-attributed or gain ledger as invalid", () => {
    expect(
      summarizeValueLeakage({
        approvedValue: 90,
        realizedValue: 64,
        attributions: [{ bucket: "cost", value: 27 }],
      }).attributionValid,
    ).toBe(false);
    expect(
      summarizeValueLeakage({
        approvedValue: 90,
        realizedValue: 100,
        attributions: [{ bucket: "cost", value: 1 }],
      }).attributionValid,
    ).toBe(false);
  });
});
