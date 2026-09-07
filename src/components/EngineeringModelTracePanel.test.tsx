import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EngineeringModelTracePanel } from "./EngineeringModelTracePanel";

const getTrace = vi.fn();
vi.mock("../services/engineeringModelService", () => ({
  getRecommendationEngineeringModelTrace: (...args: unknown[]) =>
    getTrace(...args),
}));

describe("EngineeringModelTracePanel", () => {
  beforeEach(() => getTrace.mockReset());

  it("shows an explicit no-influence state", async () => {
    getTrace.mockResolvedValue([]);
    render(<EngineeringModelTracePanel recommendationId="rec-1" />);
    expect(
      await screen.findByText(/No engineering model influence is recorded/),
    ).toBeTruthy();
  });

  it("shows every required model status and preserves human authority", async () => {
    getTrace.mockResolvedValue([
      {
        calculationRunId: "run-1",
        modelKey: "pof.shaft-resonance.screening",
        modelVersion: "1.0.0",
        calculationStatus: "computed",
        verification: "pass",
        fieldValidation: "present",
        applicability: "within_range",
        engineeringApproval: "approved",
        productionEligibleAtRead: true,
        humanApprovalRequired: true,
        operationalAuthorization: false,
        refusals: [],
        computedAt: "2026-09-05T00:00:00Z",
      },
    ]);
    render(<EngineeringModelTracePanel recommendationId="rec-1" />);
    expect(
      await screen.findByText("pof.shaft-resonance.screening@1.0.0"),
    ).toBeTruthy();
    expect(screen.getByText(/verification: pass/)).toBeTruthy();
    expect(screen.getByText(/field: present/)).toBeTruthy();
    expect(screen.getByText(/applicability: within_range/)).toBeTruthy();
    expect(screen.getByText(/approval: approved/)).toBeTruthy();
    expect(screen.getByText(/grants no operational authority/)).toBeTruthy();
  });
});
