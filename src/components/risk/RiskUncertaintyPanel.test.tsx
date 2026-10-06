import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RiskUncertaintyPanel } from "./RiskUncertaintyPanel";

const getWorkspace = vi.fn();
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ supabase: { rpc } }));

vi.mock("../../services/riskOperatingService", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/riskOperatingService")
  >("../../services/riskOperatingService");
  return {
    ...actual,
    getRiskUncertaintyWorkspace: () => getWorkspace(),
    submitRiskUncertaintyAnalysis: actual.submitRiskUncertaintyAnalysis,
    reviewRiskUncertaintyAnalysis: actual.reviewRiskUncertaintyAnalysis,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockReset();
  getWorkspace.mockResolvedValue({
    risk: {
      id: "risk-1",
      title: "Loss of cooling",
      status: "analyzed",
      currency: "CAD",
    },
    criteria: {
      id: "criteria-1",
      name: "Enterprise risk criteria",
      version: 3,
      status: "adopted",
      decisionThresholds: { escalateAbove: 16 },
    },
    evidence: [
      {
        id: "evidence-1",
        description: "Verified inspection and operating-history extract",
        sourceSystem: "CMMS",
        sourceReference: "WO-4401",
        verificationStatus: "verified",
        verifiedBy: "reviewer-1",
        verifiedAt: "2026-09-30T00:00:00Z",
        evidenceClass: "INSPECTED",
        qualityGrade: "high",
        applicabilityGrade: "direct",
      },
      {
        id: "evidence-2",
        description: "Unverified operator recollection",
        sourceSystem: "interview",
        sourceReference: null,
        verificationStatus: "unverified",
        verifiedBy: null,
        verifiedAt: null,
        evidenceClass: "EXPERT_JUDGEMENT",
        qualityGrade: null,
        applicabilityGrade: null,
      },
    ],
    analyses: [
      {
        id: "analysis-1",
        version: 2,
        validationStatus: "stale",
        method: "Three-point estimate",
        basis: "Based on the exact verified inspection and operating extract.",
        probability: { lower: 0.15, central: 0.3, upper: 0.55 },
        confidence: { level: 0.9, lower: 0.1, upper: 0.6 },
        lossCases: {
          best: 10000,
          expected: 60000,
          worst: 250000,
          currency: "CAD",
        },
        sensitivityInputs: [],
        sensitivityResults: [
          {
            name: "Startup exposure",
            basis: "Verified startup log",
            lowInput: 2,
            baseInput: 5,
            highInput: 8,
            lowOutput: 10000,
            baseOutput: 60000,
            highOutput: 180000,
            swing: 170000,
          },
        ],
        thresholdProfileId: "criteria-1",
        decisionThresholds: { escalateAbove: 16 },
        reassessmentTriggers: ["Two starts inside one operating shift"],
        reviewDueAt: "2026-11-01T00:00:00Z",
        valueOfInformation: {
          action: "Inspect seal system during the next outage",
          informationCost: 10000,
          decisionCostIfWrong: 250000,
          uncertaintyReduction: 0.5,
          probabilityDecisionChanges: 0.3,
          expectedValue: 37500,
          netValue: 27500,
          recommendation: "GATHER_INFORMATION",
        },
        analysisDigest: "a".repeat(64),
        currentDigest: "b".repeat(64),
        authorId: "author-1",
        createdAt: "2026-09-30T00:00:00Z",
        reviewerId: "reviewer-1",
        reviewedAt: "2026-10-01T00:00:00Z",
        reviewNote: "Exact packet independently reviewed.",
        approvalId: "approval-1",
        derivedEvidenceItemId: "evidence-3",
        evidenceItemIds: ["evidence-1"],
        operationalAuthorization: false,
      },
    ],
    boundary:
      "Independent review validates the analysis packet. It does not verify an unverified source, accept risk, authorize operation, release work or commit spend.",
    operationalAuthorization: false,
  });
});

describe("RiskUncertaintyPanel", () => {
  it("shows governed ranges, sensitivity, VOI, thresholds and stale state", async () => {
    render(
      <RiskUncertaintyPanel
        riskId="risk-1"
        currentUserId="viewer-1"
        currentUserRole="viewer"
      />,
    );

    expect(
      await screen.findByText("Probability and confidence"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Probability 0.15–0.55/)).toBeInTheDocument();
    expect(screen.getByText("Sensitivity ranking")).toBeInTheDocument();
    expect(
      screen.getByText(/Startup exposure · swing 170000/),
    ).toBeInTheDocument();
    expect(screen.getByText("Value of information")).toBeInTheDocument();
    expect(screen.getByText("stale")).toBeInTheDocument();
    expect(
      screen.getByText(/Enterprise risk criteria · v3/),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 unverified and excluded/)).toBeInTheDocument();
  });

  it("keeps viewer and author boundaries visible and non-operational", async () => {
    render(
      <RiskUncertaintyPanel
        riskId="risk-1"
        currentUserId="viewer-1"
        currentUserRole="viewer"
      />,
    );

    expect(
      await screen.findByText(/does not accept risk or authorize operation/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Submit a new version")).not.toBeInTheDocument();
    expect(screen.queryByText("Review packet")).not.toBeInTheDocument();
  });

  async function openReview(onChanged?: () => void | Promise<void>) {
    const riskId = "a1820000-0000-4000-8000-000000000002";
    const analysisId = "a1820000-0000-4000-8000-000000000010";
    const data = await getWorkspace();
    data.risk.id = riskId;
    Object.assign(data.analyses[0], {
      id: analysisId,
      validationStatus: "pending_review",
      currentDigest: "a".repeat(64),
      reviewerId: null,
      reviewedAt: null,
      reviewNote: null,
      approvalId: null,
      derivedEvidenceItemId: null,
    });
    getWorkspace.mockResolvedValue(data);
    const view = render(
      <RiskUncertaintyPanel
        riskId={riskId}
        currentUserId="reviewer-1"
        currentUserRole="reliability_engineer"
        onChanged={onChanged}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Review packet" }),
    );
    const note = screen.getByPlaceholderText(
      "Independent review basis (minimum 20 characters)",
    );
    fireEvent.change(note, {
      target: { value: "Independent review of the frozen evidence packet." },
    });
    const button = screen.getByRole("button", { name: "Record review" });
    const form = button.closest("form")!;
    const receipt = {
      riskId,
      analysisId,
      analysisDigest: "a".repeat(64),
      decision: "validated",
      approvalId: "a1820000-0000-4000-8000-000000000012",
      derivedEvidenceItemId: "a1820000-0000-4000-8000-000000000013",
      operationalAuthorization: false,
    };
    return { view, riskId, analysisId, note, button, form, receipt, data };
  }

  async function openSubmission() {
    const data = await getWorkspace();
    const riskId = "a1820000-0000-4000-8000-000000000002";
    data.risk.id = riskId;
    Object.assign(data.analyses[0], {
      validationStatus: "validated",
      currentDigest: data.analyses[0].analysisDigest,
    });
    const onChanged = vi
      .fn()
      .mockRejectedValue(new Error("view callback failed"));
    const view = render(
      <RiskUncertaintyPanel
        riskId={riskId}
        currentUserId="author-1"
        currentUserRole="reliability_engineer"
        onChanged={onChanged}
      />,
    );
    const button = await screen.findByRole("button", {
      name: "Submit for independent review",
    });
    const form = button.closest("form")!;
    for (const placeholder of [
      "Method",
      "Source, assumption and method basis",
      "Factor name",
      "Evidence or assumption basis",
      "One measurable reassessment trigger per line",
      "Information-gathering action",
    ]) {
      fireEvent.change(screen.getByPlaceholderText(placeholder), {
        target: {
          value: "Synthetic named-evidence basis for this client-only test.",
        },
      });
    }
    for (const input of form.querySelectorAll("input[type=number]"))
      fireEvent.change(input, { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Review due"), {
      target: { value: "2026-11-01T09:00" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    const receipt = {
      riskId,
      analysisId: "a1820000-0000-4000-8000-000000000014",
      version: 3,
      analysisDigest: "c".repeat(64),
      validationStatus: "pending_review",
      valueOfInformation: {
        expectedValue: 1,
        netValue: 0,
        recommendation: "DECIDE_WITH_CURRENT_INFORMATION",
      },
      operationalAuthorization: false,
    };
    rpc.mockResolvedValue({ data: receipt, error: null });
    return { view, form, receipt, data, riskId, onChanged };
  }

  it("blocks an acknowledged identical submission against an unchanged stale read view", async () => {
    const { form } = await openSubmission();
    fireEvent.submit(form);
    expect(
      await screen.findByText(/qualified receipt is retained/),
    ).toBeInTheDocument();
    fireEvent.submit(form);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("allows identical-input reassessment after the canonical packet advances to a reviewed version", async () => {
    const { view, form, receipt, data, riskId, onChanged } =
      await openSubmission();
    fireEvent.submit(form);
    await screen.findByText(/qualified receipt is retained/);
    const firstArgs = rpc.mock.calls[0];
    getWorkspace.mockResolvedValue({
      ...data,
      analyses: [
        {
          ...data.analyses[0],
          id: receipt.analysisId,
          version: receipt.version,
          validationStatus: "validated",
          analysisDigest: receipt.analysisDigest,
          currentDigest: receipt.analysisDigest,
        },
      ],
    });
    view.rerender(
      <RiskUncertaintyPanel
        riskId={riskId}
        currentUserId="author-1"
        currentUserRole="maintenance_manager"
        onChanged={onChanged}
      />,
    );
    await screen.findByText("v3");
    rpc.mockResolvedValue({
      data: {
        ...receipt,
        analysisId: "a1820000-0000-4000-8000-000000000015",
        version: 4,
      },
      error: null,
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Submit for independent review" })
        .closest("form")!,
    );
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(rpc.mock.calls[1]).toEqual(firstArgs);
  });

  it("keeps a qualified receipt scoped while an asynchronous callback is pending", async () => {
    let finishCallback!: () => void;
    const onChanged = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCallback = resolve;
        }),
    );
    const { view, form, receipt, data } = await openReview(onChanged);
    rpc.mockResolvedValue({ data: receipt, error: null });
    fireEvent.submit(form);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/Independent packet review recorded/),
    ).toBeInTheDocument();
    const nextRisk = "a1820000-0000-4000-8000-000000000011";
    getWorkspace.mockResolvedValue({
      ...data,
      risk: { ...data.risk, id: nextRisk },
      analyses: [],
    });
    view.rerender(
      <RiskUncertaintyPanel
        riskId={nextRisk}
        currentUserId="reviewer-1"
        currentUserRole="reliability_engineer"
        onChanged={onChanged}
      />,
    );
    await screen.findByText("No analysis submitted.");
    expect(
      screen.queryByText(/Independent packet review recorded/),
    ).not.toBeInTheDocument();
    await act(async () => finishCallback());
    expect(
      screen.queryByText(/Independent packet review recorded/),
    ).not.toBeInTheDocument();
  });

  it("does not invoke late refresh callbacks after unmounting a pending action", async () => {
    let complete!: (value: unknown) => void;
    rpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const onChanged = vi.fn();
    const { view, form, receipt } = await openReview(onChanged);
    const readCount = getWorkspace.mock.calls.length;
    fireEvent.submit(form);
    view.unmount();
    await act(async () => complete({ data: receipt, error: null }));
    expect(onChanged).not.toHaveBeenCalled();
    expect(getWorkspace).toHaveBeenCalledTimes(readCount);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not resend an acknowledged packet when the callback fails and the read view stays pending", async () => {
    const onChanged = vi
      .fn()
      .mockRejectedValue(new Error("view refresh failed"));
    const { form, receipt } = await openReview(onChanged);
    rpc.mockResolvedValue({ data: receipt, error: null });
    fireEvent.submit(form);
    expect(
      await screen.findByText(/qualified receipt is retained/),
    ).toBeInTheDocument();
    const reopen = screen.getByRole("button", { name: "Review packet" });
    expect(reopen).toBeDisabled();
    fireEvent.click(reopen);
    fireEvent.submit(form);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Record review" }),
    ).not.toBeInTheDocument();
  });

  it("prevents same-tick duplicate review dispatch and freezes pending inputs", async () => {
    let complete!: (value: unknown) => void;
    rpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const { form, note, receipt } = await openReview();
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(note).toBeDisabled();
    await act(async () => complete({ data: receipt, error: null }));
    expect(
      await screen.findByText(/Independent packet review recorded/),
    ).toBeInTheDocument();
  });

  it("keeps a lost acknowledgement locked instead of enabling an unchanged retry", async () => {
    rpc.mockRejectedValue(new Error("connection lost after dispatch"));
    const { form, button, note } = await openReview();
    fireEvent.submit(form);
    expect(await screen.findByText(/outcome is unknown/i)).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(note).toBeDisabled();
    fireEvent.submit(form);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not turn an empty acknowledgement into success or close the review", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const { form, button } = await openReview();
    fireEvent.submit(form);
    expect(await screen.findByText(/outcome is unknown/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/Independent packet review recorded/),
    ).not.toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  it("does not dispatch against retained workspace data after the risk prop changes", async () => {
    const { view, form } = await openReview();
    getWorkspace.mockImplementation(() => new Promise(() => {}));
    view.rerender(
      <RiskUncertaintyPanel
        riskId="a1820000-0000-4000-8000-000000000011"
        currentUserId="reviewer-1"
        currentUserRole="reliability_engineer"
      />,
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Record review" }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.submit(form);
    expect(rpc).not.toHaveBeenCalled();
  });
});
