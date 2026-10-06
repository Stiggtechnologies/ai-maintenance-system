import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RiskUncertaintyPanel } from "./RiskUncertaintyPanel";

const getWorkspace = vi.fn();
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
const replacementIntentId = "a1820000-0000-4000-8000-000000000030";
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
  vi.stubGlobal("crypto", {
    subtle: webcrypto.subtle,
    randomUUID: vi.fn(() => replacementIntentId),
  });
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
      policyDigest: "c".repeat(64),
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
        digestVersion: 2,
        digestCoverage: "evidence_content_and_current_criteria",
        storedStatus: "validated",
        validationStatus: "stale",
        reviewStanding: "replacement_required",
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

afterEach(() => vi.unstubAllGlobals());

describe("RiskUncertaintyPanel", () => {
  it.each(["replacement_required", "policy_unavailable"])(
    "does not offer review for a legacy equal-digest packet with standing %s",
    async (reviewStanding) => {
      const data = await getWorkspace();
      Object.assign(data.analyses[0], {
        storedStatus: "pending_review",
        validationStatus: "pending_review",
        digestVersion: 1,
        digestCoverage: "legacy_metadata",
        currentDigest: data.analyses[0].analysisDigest,
        reviewStanding,
      });
      render(
        <RiskUncertaintyPanel
          currentOrganizationId="a1820000-0000-4000-8000-000000000020"
          riskId="risk-1"
          currentUserId="reviewer-1"
          currentUserRole="reliability_engineer"
        />,
      );
      await screen.findByText("v2");
      expect(
        screen.queryByRole("button", { name: "Review packet" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Submit a new version"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(
          reviewStanding === "policy_unavailable"
            ? /Current adopted threshold policy is unavailable/
            : /Pending packet requires governed replacement/,
        ),
      ).toBeInTheDocument();
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("does not offer ordinary submission over a digest-stale pending packet", async () => {
    const data = await getWorkspace();
    data.analyses[0].storedStatus = "pending_review";
    render(
      <RiskUncertaintyPanel
        currentOrganizationId="a1820000-0000-4000-8000-000000000020"
        riskId="risk-1"
        currentUserId="author-1"
        currentUserRole="reliability_engineer"
      />,
    );
    await screen.findByText("v2");
    expect(screen.queryByText("Submit a new version")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Pending packet requires governed replacement/),
    ).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not submit against adopted-but-empty current thresholds", async () => {
    const data = await getWorkspace();
    data.analyses = [];
    data.criteria.decisionThresholds = {};
    render(
      <RiskUncertaintyPanel
        currentOrganizationId="a1820000-0000-4000-8000-000000000020"
        riskId="risk-1"
        currentUserId="author-1"
        currentUserRole="reliability_engineer"
      />,
    );
    const button = await screen.findByRole("button", {
      name: "Submit for independent review",
    });
    fillSubmission(button.closest("form")!);
    expect(button).toBeDisabled();
    fireEvent.submit(button.closest("form")!);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows governed ranges, sensitivity, VOI, thresholds and stale state", async () => {
    render(
      <RiskUncertaintyPanel
        currentOrganizationId="a1820000-0000-4000-8000-000000000020"
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
        currentOrganizationId="a1820000-0000-4000-8000-000000000020"
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

  async function replacementWorkspace() {
    const data = await getWorkspace();
    const replacementRiskId = "a1820000-0000-4000-8000-000000000002";
    const replacementAnalysisId = "a1820000-0000-4000-8000-000000000010";
    const replacementEvidenceId = "a1820000-0000-4000-8000-000000000001";
    const replacementActorId = "a1820000-0000-4000-8000-000000000021";
    Object.assign(data.risk, {
      id: replacementRiskId,
      organizationId: "a1820000-0000-4000-8000-000000000020",
      status: "analyzed",
    });
    Object.assign(data.criteria, {
      id: "a1820000-0000-4000-8000-000000000003",
      organizationId: "a1820000-0000-4000-8000-000000000020",
    });
    Object.assign(data.evidence[0], {
      id: replacementEvidenceId,
      organizationId: "a1820000-0000-4000-8000-000000000020",
      riskId: replacementRiskId,
    });
    Object.assign(data.analyses[0], {
      id: replacementAnalysisId,
      organizationId: "a1820000-0000-4000-8000-000000000020",
      riskId: replacementRiskId,
      version: 2,
      storedStatus: "pending_review",
      validationStatus: "stale",
      reviewStanding: "replacement_required",
      authorId: replacementActorId,
      reviewerId: null,
      reviewedAt: null,
      reviewNote: null,
      approvalId: null,
      derivedEvidenceItemId: null,
      evidenceItemIds: [replacementEvidenceId],
      reviewDueAt: "2099-11-01T15:00:00Z",
      sensitivityInputs: [
        {
          name: "Startup exposure",
          basis: "Verified startup history and operating context.",
          low_input: 2,
          base_input: 5,
          high_input: 8,
          low_output: 10000,
          base_output: 60000,
          high_output: 180000,
        },
      ],
    });
    getWorkspace.mockResolvedValue(data);
    return {
      data,
      riskId: replacementRiskId,
      actorId: replacementActorId,
      analysisId: replacementAnalysisId,
      evidenceId: replacementEvidenceId,
    };
  }

  async function openReplacement() {
    const ids = await replacementWorkspace();
    const onChanged = vi.fn();
    const view = render(
      <RiskUncertaintyPanel
        currentOrganizationId="a1820000-0000-4000-8000-000000000020"
        riskId={ids.riskId}
        currentUserId={ids.actorId}
        currentUserRole="reliability_engineer"
        onChanged={onChanged}
      />,
    );
    expect(screen.queryByPlaceholderText("Method")).not.toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("button", { name: "Replace stale analysis" }),
    );
    const reason = screen.getByPlaceholderText(
      "Replacement reason (minimum 20 characters)",
    );
    const form = reason.closest("form")!;
    const submit = Array.from(form.querySelectorAll("button")).find(
      (button) => button.textContent === "Replace stale analysis",
    )!;
    return { ...ids, view, onChanged, reason, form, submit };
  }

  function replacementReceipt(requestText: string) {
    const request = JSON.parse(requestText);
    return {
      commitStatus: "committed",
      submittedStatus: "pending_review",
      organizationId: request.organizationId,
      actorId: request.actorId,
      riskId: request.riskId,
      intentId: request.intentId,
      requestFingerprint: createHash("sha256")
        .update(Buffer.from(requestText, "utf8"))
        .digest("hex"),
      predecessorAnalysisId: request.predecessor.analysisId,
      compareAndSwap: {
        ...request.predecessor,
        policyDigest: request.policyDigest,
      },
      analysisId: "a1820000-0000-4000-8000-000000000011",
      version: request.predecessor.version + 1,
      analysisDigest: "d".repeat(64),
      digestVersion: 2,
      digestCoverage: "evidence_content_and_current_criteria",
      valueOfInformation: {
        informationCost: request.analysis.voi_information_cost,
        decisionCostIfWrong: request.analysis.voi_decision_cost_if_wrong,
        uncertaintyReduction: request.analysis.voi_uncertainty_reduction,
        probabilityDecisionChanges:
          request.analysis.voi_probability_decision_changes,
        expectedValue: 37500,
        netValue: 27500,
        recommendation: "GATHER_INFORMATION",
      },
      operationalAuthorization: false,
    };
  }

  it("prefills stale authored inputs only after the explicit replacement action", async () => {
    const { reason, form, evidenceId } = await openReplacement();
    expect(screen.getByPlaceholderText("Method")).toHaveValue(
      "Three-point estimate",
    );
    expect(
      screen.getByPlaceholderText("Source, assumption and method basis"),
    ).toHaveValue(
      "Based on the exact verified inspection and operating extract.",
    );
    expect(reason).toHaveValue("");
    expect(form.querySelector(`input[type="checkbox"]`)).toBeChecked();
    expect(evidenceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["other_author", "policy_unavailable", "archived", "ai_admin"])(
    "does not offer replacement for %s",
    async (blocker) => {
      const ids = await replacementWorkspace();
      if (blocker === "other_author")
        ids.data.analyses[0].authorId = "a1820000-0000-4000-8000-000000000099";
      if (blocker === "policy_unavailable") {
        ids.data.analyses[0].reviewStanding = "policy_unavailable";
        ids.data.criteria.status = "draft";
      }
      if (blocker === "archived") ids.data.risk.status = "archived";
      render(
        <RiskUncertaintyPanel
          currentOrganizationId="a1820000-0000-4000-8000-000000000020"
          riskId={ids.riskId}
          currentUserId={ids.actorId}
          currentUserRole={
            blocker === "ai_admin" ? "ai_admin" : "reliability_engineer"
          }
        />,
      );
      await screen.findByText("v2");
      expect(
        screen.queryByRole("button", { name: "Replace stale analysis" }),
      ).not.toBeInTheDocument();
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it.each([
    "reliability_engineer",
    "maintenance_manager",
    "executive",
    "admin",
  ])(
    "offers replacement to the original author with human role %s",
    async (role) => {
      const ids = await replacementWorkspace();
      render(
        <RiskUncertaintyPanel
          currentOrganizationId="a1820000-0000-4000-8000-000000000020"
          riskId={ids.riskId}
          currentUserId={ids.actorId}
          currentUserRole={role}
        />,
      );
      expect(
        await screen.findByRole("button", { name: "Replace stale analysis" }),
      ).toBeEnabled();
    },
  );

  it("dispatches one exact replacement on a same-tick double submit", async () => {
    const { reason, form, submit, analysisId } = await openReplacement();
    fireEvent.change(reason, {
      target: {
        value: "New verified evidence requires this governed replacement.",
      },
    });
    rpc.mockImplementation(async (name, args) => {
      expect(name).toBe("replace_risk_uncertainty_analysis");
      const requestText = String(args?.p_request_text);
      return {
        data: replacementReceipt(requestText),
        error: null,
        status: 200,
      };
    });

    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await screen.findByText(/Stale analysis replaced with a new packet/);
    expect(rpc).toHaveBeenCalledTimes(1);
    fireEvent.submit(form);
    await waitFor(() => expect(submit).not.toHaveTextContent("Replacing…"));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(rpc.mock.calls[0][1].p_request_text));
    expect(request).toMatchObject({
      contractVersion: 1,
      action: "replace",
      intentId: replacementIntentId,
      predecessor: {
        analysisId,
        version: 2,
        digestVersion: 2,
        analysisDigest: "a".repeat(64),
        currentDigest: "b".repeat(64),
      },
      policyDigest: "c".repeat(64),
      reason: "New verified evidence requires this governed replacement.",
    });
  });

  it("keeps an unknown replacement locked until explicit read-only reconciliation", async () => {
    const { reason, form, onChanged } = await openReplacement();
    fireEvent.change(reason, {
      target: { value: "New verified evidence requires replacement now." },
    });
    let requestText = "";
    rpc.mockImplementation(async (name, args) => {
      if (name === "replace_risk_uncertainty_analysis") {
        requestText = String(args?.p_request_text);
        throw new Error("private network detail");
      }
      return {
        data: replacementReceipt(requestText),
        error: null,
        status: 200,
      };
    });
    fireEvent.submit(form);
    const reconcile = await screen.findByRole("button", {
      name: "Reconcile replacement",
    });
    expect(
      screen.queryByText(/private network detail/),
    ).not.toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(onChanged).not.toHaveBeenCalled();

    fireEvent.click(reconcile);
    await screen.findByText(/Committed replacement receipt reconciled/);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][0]).toBe(
      "get_risk_uncertainty_replacement_receipt",
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps an absent reconciliation unresolved without resending replacement", async () => {
    const { reason, form } = await openReplacement();
    fireEvent.change(reason, {
      target: { value: "New verified evidence requires replacement now." },
    });
    rpc
      .mockRejectedValueOnce(new Error("lost acknowledgement"))
      .mockResolvedValueOnce({
        data: { error: "private absence detail" },
        error: null,
        status: 200,
      });
    fireEvent.submit(form);
    fireEvent.click(
      await screen.findByRole("button", { name: "Reconcile replacement" }),
    );
    expect(
      await screen.findByText(/does not make the request safe to resend/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/private absence detail/),
    ).not.toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(
      rpc.mock.calls.filter(
        ([name]) => name === "replace_risk_uncertainty_analysis",
      ),
    ).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Do not resend it");
  });

  it("labels superseded replacement history separately from human rejection", async () => {
    const data = await getWorkspace();
    data.analyses.push({
      ...data.analyses[0],
      id: "analysis-superseded",
      version: 1,
      storedStatus: "superseded",
      validationStatus: "stale",
    });
    getWorkspace.mockResolvedValue(data);
    render(
      <RiskUncertaintyPanel
        currentOrganizationId="a1820000-0000-4000-8000-000000000020"
        riskId="risk-1"
        currentUserId="viewer-1"
        currentUserRole="viewer"
      />,
    );
    expect(
      await screen.findByText("Retained replacement history"),
    ).toBeInTheDocument();
    expect(screen.getByText(/not human-rejected packets/)).toBeInTheDocument();
    expect(screen.queryByText(/^rejected$/i)).not.toBeInTheDocument();
  });

  async function openReview(onChanged?: () => void | Promise<void>) {
    const riskId = "a1820000-0000-4000-8000-000000000002";
    const analysisId = "a1820000-0000-4000-8000-000000000010";
    const data = await getWorkspace();
    data.risk.id = riskId;
    Object.assign(data.analyses[0], {
      id: analysisId,
      storedStatus: "pending_review",
      validationStatus: "pending_review",
      reviewStanding: "reviewable",
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
        currentOrganizationId="a1820000-0000-4000-8000-000000000020"
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

  function fillSubmission(form: HTMLFormElement) {
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
  }

  async function openSubmission() {
    const data = await getWorkspace();
    const riskId = "a1820000-0000-4000-8000-000000000002";
    data.risk.id = riskId;
    Object.assign(data.analyses[0], {
      storedStatus: "validated",
      validationStatus: "validated",
      reviewStanding: "reviewable",
      currentDigest: data.analyses[0].analysisDigest,
    });
    const onChanged = vi
      .fn()
      .mockRejectedValue(new Error("view callback failed"));
    const view = render(
      <RiskUncertaintyPanel
        currentOrganizationId="a1820000-0000-4000-8000-000000000020"
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
    fillSubmission(form);
    const receipt = {
      riskId,
      analysisId: "a1820000-0000-4000-8000-000000000014",
      version: 3,
      analysisDigest: "c".repeat(64),
      validationStatus: "pending_review",
      valueOfInformation: {
        informationCost: 1,
        decisionCostIfWrong: 1,
        uncertaintyReduction: 1,
        probabilityDecisionChanges: 1,
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
          storedStatus: "validated",
          validationStatus: "validated",
          reviewStanding: "reviewable",
          analysisDigest: receipt.analysisDigest,
          currentDigest: receipt.analysisDigest,
        },
      ],
    });
    view.rerender(
      <RiskUncertaintyPanel
        currentOrganizationId="a1820000-0000-4000-8000-000000000020"
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
    const reassessmentForm = screen
      .getByRole("button", { name: "Submit for independent review" })
      .closest("form")!;
    // The observed role change correctly invalidates its prior draft. Re-enter
    // identical inputs for the newly reviewed canonical version; do not weaken
    // the original exact-payload or legitimate-reassessment assertion.
    expect(screen.getByPlaceholderText("Method")).toHaveValue("");
    fillSubmission(reassessmentForm);
    fireEvent.submit(reassessmentForm);
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
        currentOrganizationId="a1820000-0000-4000-8000-000000000020"
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
        currentOrganizationId="a1820000-0000-4000-8000-000000000020"
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
