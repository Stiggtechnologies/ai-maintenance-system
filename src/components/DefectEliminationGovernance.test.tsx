import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DefectEliminationGovernance } from "./DefectEliminationGovernance";

const load = vi.fn();
const record = vi.fn();
let role = "reliability_engineer";

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role } }),
}));
vi.mock("../services/defectEliminationGovernanceService", () => ({
  loadDefectEliminationGovernance: () => load(),
  recordDefectEliminationGovernance: (...args: unknown[]) => record(...args),
}));

const boundaries = {
  mayCreateWork: false as const,
  mayChangePmInterval: false as const,
  mayApproveStrategy: false as const,
  mayAcceptRisk: false as const,
  mayCommitSpend: false as const,
  mayReturnToService: false as const,
};

const reuse = {
  fracas:
    "Canonical investigation packs and named assignments. A root cause is not claimed by recording governance.",
  pmOptimization:
    "Canonical asset-strategy assessments. Block, opportunistic and multi-component policies are not recomputed here.",
  weibull:
    "Canonical reliability life-data reports. The retained fit is frozen, not refit.",
  elimination:
    "The organization elimination metric is snapshotted. An unavailable rate stays unavailable.",
};

function workspace(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    basis:
      "Stage 3 governance freezes retained FRACAS, RCA, PM and Weibull evidence.",
    boundaries,
    reuse,
    elimination: {
      available: false,
      eliminationRatePct: null,
      basis: "No coded target yet. No rate was invented.",
    },
    candidates: [
      {
        assetId: "asset-1",
        assetTag: "P-101",
        ready: false,
        gaps: ["missing_weibull"],
        fracasPackId: "pack-1",
        workOrderNumber: "WO-9",
        assignmentId: "assign-1",
        investigatorName: "A. Engineer",
        callerIsInvestigator: false,
        strategyAssessmentId: "assessment-1",
        recommendationKind: "interval_change",
        pmKernelVersion: "kernel-1",
        lifeReportId: null,
        weibullMethod: null,
        beta: null,
        eta: null,
        component: null,
        lifeKernelVersion: null,
      },
    ],
    decisions: [],
    ...overrides,
  };
}

describe("DefectEliminationGovernance", () => {
  beforeEach(() => {
    role = "reliability_engineer";
    load.mockReset();
    record.mockReset();
    load.mockResolvedValue(workspace());
  });

  it("shows the evidence gap and does not offer a decision or an invented rate", async () => {
    render(<DefectEliminationGovernance />);

    expect(
      await screen.findByText(
        /No retained Weibull report includes a life event/i,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/No coded target yet. No rate was invented/i),
    ).toBeVisible();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Record governance decision" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Does not create work/i)).toBeVisible();
  });

  it("records a decision from the retained fit without treating it as a new calculation", async () => {
    load.mockResolvedValue(
      workspace({
        elimination: {
          available: true,
          eliminationRatePct: 25,
          basis: "One of four coded targets closed effective.",
        },
        candidates: [
          {
            assetId: "asset-1",
            assetTag: "P-101",
            ready: true,
            gaps: [],
            fracasPackId: "pack-1",
            workOrderNumber: "WO-9",
            assignmentId: "assign-1",
            investigatorName: "A. Engineer",
            callerIsInvestigator: false,
            strategyAssessmentId: "assessment-1",
            recommendationKind: "retain_current",
            pmKernelVersion: "kernel-1",
            lifeReportId: "report-1",
            weibullMethod: "mle_censored",
            beta: 2.5,
            eta: 1000,
            component: "bearing",
            lifeKernelVersion: "life-1",
          },
        ],
      }),
    );
    record.mockResolvedValue(undefined);
    render(<DefectEliminationGovernance />);

    expect(await screen.findByText("25%")).toBeVisible();
    expect(
      screen.getByText(/Retained fit, not a new calculation/i),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Disposition"), {
      target: { value: "pursue_elimination" },
    });
    fireEvent.change(screen.getByLabelText("Basis"), {
      target: {
        value:
          "The retained censored Weibull fit and current PM assessment support pursuit. No interval is changed.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record governance decision" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /does not create work/i,
    );
    expect(record).toHaveBeenCalledWith({
      assetId: "asset-1",
      fracasPackId: "pack-1",
      strategyAssessmentId: "assessment-1",
      lifeReportId: "report-1",
      disposition: "pursue_elimination",
      basis:
        "The retained censored Weibull fit and current PM assessment support pursuit. No interval is changed.",
    });
  });

  it("keeps the form closed for the assigned investigator and for a non-governing role", async () => {
    load.mockResolvedValue(
      workspace({
        candidates: [
          {
            assetId: "asset-1",
            assetTag: "P-101",
            ready: true,
            gaps: [],
            fracasPackId: "pack-1",
            workOrderNumber: "WO-9",
            assignmentId: "assign-1",
            investigatorName: "A. Engineer",
            callerIsInvestigator: true,
            strategyAssessmentId: "assessment-1",
            recommendationKind: "retain_current",
            pmKernelVersion: "kernel-1",
            lifeReportId: "report-1",
            weibullMethod: "mle",
            beta: 1.2,
            eta: 800,
            component: "seal",
            lifeKernelVersion: "life-1",
          },
        ],
      }),
    );
    const { unmount } = render(<DefectEliminationGovernance />);
    expect(await screen.findByText(/cannot govern their own/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Record governance decision" }),
    ).not.toBeInTheDocument();
    unmount();

    role = "planner";
    load.mockResolvedValue(
      workspace({
        candidates: [
          {
            assetId: "asset-1",
            assetTag: "P-101",
            ready: true,
            gaps: [],
            fracasPackId: "pack-1",
            workOrderNumber: "WO-9",
            assignmentId: "assign-1",
            investigatorName: "A. Engineer",
            callerIsInvestigator: false,
            strategyAssessmentId: "assessment-1",
            recommendationKind: "retain_current",
            pmKernelVersion: "kernel-1",
            lifeReportId: "report-1",
            weibullMethod: "mle",
            beta: 1.2,
            eta: 800,
            component: "seal",
            lifeKernelVersion: "life-1",
          },
        ],
      }),
    );
    render(<DefectEliminationGovernance />);
    expect(await screen.findByText(/AI operator cannot/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Record governance decision" }),
    ).not.toBeInTheDocument();
  });

  it("shows a server refusal without clearing it into success", async () => {
    load.mockResolvedValue(
      workspace({
        candidates: [
          {
            assetId: "asset-1",
            assetTag: "P-101",
            ready: true,
            gaps: [],
            fracasPackId: "pack-1",
            workOrderNumber: "WO-9",
            assignmentId: "assign-1",
            investigatorName: "A. Engineer",
            callerIsInvestigator: false,
            strategyAssessmentId: "assessment-1",
            recommendationKind: "evidence_gap",
            pmKernelVersion: "kernel-1",
            lifeReportId: "report-1",
            weibullMethod: "rank_regression",
            beta: 1.8,
            eta: 640,
            component: "impeller",
            lifeKernelVersion: "life-1",
          },
        ],
      }),
    );
    record.mockRejectedValue(
      new Error(
        "a Weibull fit is required; an unidentified distribution cannot govern defect elimination",
      ),
    );
    render(<DefectEliminationGovernance />);
    fireEvent.change(await screen.findByLabelText("Basis"), {
      target: {
        value:
          "This note is long enough for the client check and the server still refuses the fit.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record governance decision" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /unidentified distribution/i,
    );
  });
});
