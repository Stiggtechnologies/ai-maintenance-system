import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceEvidence } from "../../lib/develop";
import {
  getCaseBenefitsScreen,
  recordCaseValueLeakageAttribution,
  recordCaseValueTrajectoryPoint,
  type CaseBenefitsScreen,
} from "../../services/developService";
import { verifyValueMetric } from "../../services/operatingLoopService";
import { BenefitsAndLeakageSection } from "./RealizePanels";

vi.mock("../../services/developService", () => ({
  getCaseBenefitsScreen: vi.fn(),
  recordCaseValueLeakageAttribution: vi
    .fn()
    .mockResolvedValue({ metricId: "m-2" }),
  recordCaseValueTrajectoryPoint: vi
    .fn()
    .mockResolvedValue({ metricId: "m-1" }),
}));
vi.mock("../../services/operatingLoopService", () => ({
  verifyValueMetric: vi.fn().mockResolvedValue({ status: "verified" }),
}));

const evidence = [
  {
    id: "71000000-0000-4000-8000-000000000001",
    description: "Approved benefits evidence",
    sourceReference: "BEN-001",
  },
] as WorkspaceEvidence[];

const payload: CaseBenefitsScreen = {
  caseId: "case-1",
  basis: "Expected, forecast and verified actual remain distinct.",
  benefits: [
    {
      id: "benefit-1",
      label: "Annual throughput value",
      expected: 90,
      unit: "CADm",
      expectedDate: "2027-12-31",
      ownerId: "owner-1",
      owner: "Benefit Owner",
      basis: "Approved economic model",
      currentForecast: 71,
      forecastStatus: "projected",
      actual: 64,
      actualHorizonDays: 365,
      variance: -26,
    },
  ],
  valueLeakage: {
    caseId: "case-1",
    leakageEvaluable: true,
    unit: "CADm",
    approvedValue: 90,
    realizedValue: 64,
    approvedToRealizedLeakage: 26,
    originalToRealizedChange: 36,
    trajectoryComplete: false,
    missingPoints: ["startup"],
    trajectory: [
      { point: "original", value: 100, unit: "CADm", status: "verified" },
      { point: "startup", value: null, unit: null, status: "missing" },
    ],
    attributions: [
      {
        id: "a-1",
        bucket: "scope",
        kind: "causal",
        value: 8,
        basis: "Scope compromise supported by change records",
        evidenceItemId: evidence[0].id,
      },
    ],
    attributedValue: 8,
    unattributedResidual: 18,
    attributionValid: true,
    missingActualBenefits: 0,
    pendingVerificationCount: 1,
    pendingVerification: [
      {
        id: "pending-1",
        metricType: "project_value_trajectory",
        label: "Value trajectory · design",
        value: 95,
        unit: "CADm",
        basis: "Design estimate approved",
        point: "design",
        bucket: null,
        kind: null,
        evidenceItemId: evidence[0].id,
        recordedBy: "author-1",
        createdAt: "2026-09-11",
      },
    ],
    formula: "Value Leakage = Approved − Realized",
    decisionBoundary: "Attribution is not causal proof or investment approval.",
  },
};

describe("BenefitsAndLeakageSection", () => {
  it("renders benefit variance, named trajectory gaps and residual", async () => {
    vi.mocked(getCaseBenefitsScreen).mockResolvedValue(payload);
    render(
      <BenefitsAndLeakageSection
        caseId="case-1"
        evidence={evidence}
        canRealize={false}
      />,
    );
    expect(
      await screen.findByText("Annual throughput value"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Named trajectory gaps: startup/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/unattributed residual · 18 CADm/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/not causal proof or investment approval/i),
    ).toBeInTheDocument();
  });

  it("records a governed trajectory point with canonical evidence", async () => {
    vi.mocked(getCaseBenefitsScreen).mockResolvedValue(payload);
    render(
      <BenefitsAndLeakageSection
        caseId="case-1"
        evidence={evidence}
        canRealize
      />,
    );
    await screen.findByText("Annual throughput value");
    fireEvent.click(
      screen.getByRole("button", { name: /Record lifecycle point/i }),
    );
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "design" } });
    fireEvent.change(selects[1], { target: { value: evidence[0].id } });
    fireEvent.change(screen.getByPlaceholderText("Value"), {
      target: { value: "95" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Unit/), {
      target: { value: "CADm" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Point basis/), {
      target: { value: "Approved design estimate" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: /Record for independent verification/i,
      }),
    );
    await waitFor(() =>
      expect(recordCaseValueTrajectoryPoint).toHaveBeenCalledWith(
        expect.objectContaining({
          caseId: "case-1",
          point: "design",
          value: 95,
          evidenceItemId: evidence[0].id,
        }),
      ),
    );
  });

  it("routes attribution and verification through governed services", async () => {
    vi.mocked(getCaseBenefitsScreen).mockResolvedValue(payload);
    render(
      <BenefitsAndLeakageSection
        caseId="case-1"
        evidence={evidence}
        canRealize
      />,
    );
    await screen.findByText("Annual throughput value");
    fireEvent.click(screen.getByRole("button", { name: /Attribute leakage/i }));
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "schedule" } });
    fireEvent.change(selects[1], { target: { value: "contributing" } });
    fireEvent.change(selects[2], { target: { value: evidence[0].id } });
    fireEvent.change(screen.getByPlaceholderText("Value"), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Causal basis/), {
      target: { value: "Schedule delay supported by approved records" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: /Record for independent verification/i,
      }),
    );
    await waitFor(() =>
      expect(recordCaseValueLeakageAttribution).toHaveBeenCalledWith(
        expect.objectContaining({
          bucket: "schedule",
          value: 7,
          attributionKind: "contributing",
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Verify evidence" }));
    await waitFor(() =>
      expect(verifyValueMetric).toHaveBeenCalledWith(
        "pending-1",
        true,
        expect.stringContaining("not causal proof"),
      ),
    );
  });
});
