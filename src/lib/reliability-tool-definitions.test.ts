import { describe, expect, it } from "vitest";
import {
  getReliabilityToolDefinition,
  RELIABILITY_TOOL_DEFINITIONS,
} from "./reliability-tool-definitions";

describe("reliability tool definitions", () => {
  it("defines the launch tool set with stable ids", () => {
    expect(RELIABILITY_TOOL_DEFINITIONS.map((tool) => tool.id)).toEqual([
      "calculateAvailability",
      "calculateExponentialReliability",
      "calculateMaintenanceExecutionKpis",
      "estimateCostOfUnreliability",
      "calculateRiskPriorityNumber",
      "createBadActorPareto",
      "startAssetOnboarding",
      "updateAssetOnboardingStep",
      "exportAssetOnboardingPackage",
      "createRcaDraft",
      "createFracasCase",
    ]);
  });

  it("marks engineering workflows as review-required", () => {
    expect(getReliabilityToolDefinition("createRcaDraft").approval).toBe(
      "engineer-review-required",
    );
    expect(getReliabilityToolDefinition("createFracasCase").approval).toBe(
      "engineer-review-required",
    );
  });

  it("throws for unknown tools at runtime", () => {
    expect(() => getReliabilityToolDefinition("missingTool" as never)).toThrow(
      "Unknown reliability tool",
    );
  });
});
