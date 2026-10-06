import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RiskUncertaintyReplacementOutcomeUnknownError } from "../../services/riskUncertaintyReplacementService";
import { RiskUncertaintyPanel } from "./RiskUncertaintyPanel";

const {
  workspace,
  rpc,
  prepareReplacement,
  replaceReplacement,
  reconcileReplacement,
} = vi.hoisted(() => ({
  workspace: vi.fn(),
  rpc: vi.fn(),
  prepareReplacement: vi.fn(),
  replaceReplacement: vi.fn(),
  reconcileReplacement: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("../../services/riskOperatingService", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../services/riskOperatingService")
  >()),
  getRiskUncertaintyWorkspace: workspace,
}));
vi.mock(
  "../../services/riskUncertaintyReplacementRequest",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../services/riskUncertaintyReplacementRequest")
    >()),
    prepareRiskUncertaintyReplacementRequest: prepareReplacement,
  }),
);
vi.mock(
  "../../services/riskUncertaintyReplacementService",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../services/riskUncertaintyReplacementService")
    >()),
    replaceRiskUncertaintyAnalysis: replaceReplacement,
    reconcileRiskUncertaintyReplacement: reconcileReplacement,
  }),
);

const riskId = "a1820000-0000-4000-8000-000000000002";
const organizationA = "a1820000-0000-4000-8000-000000000020";
const organizationB = "a1820000-0000-4000-8000-000000000021";
const analysisId = "a1820000-0000-4000-8000-000000000010";
const digest = "a".repeat(64);
const preparedReplacement = {
  requestText: "synthetic prepared replacement",
  requestFingerprint: "d".repeat(64),
  intentId: "a1820000-0000-4000-8000-000000000030",
  organizationId: organizationA,
  actorId: "reviewer-1",
  riskId,
  predecessor: {
    analysisId,
    version: 1,
    digestVersion: 2,
    analysisDigest: digest,
    currentDigest: "b".repeat(64),
  },
  policyDigest: "c".repeat(64),
  reason: "Synthetic replacement reason retained for reconciliation.",
  analysis: {},
  evidenceItemIds: ["a1820000-0000-4000-8000-000000000001"],
};

function packet(label: string) {
  return {
    risk: { id: riskId, title: label, status: "draft", currency: "CAD" },
    criteria: {
      id: "criteria-1",
      name: label,
      version: 1,
      status: "adopted",
      decisionThresholds: { escalateAbove: 16 },
      policyDigest: "c".repeat(64),
    },
    evidence: [],
    analyses: [
      {
        id: analysisId,
        version: 1,
        digestVersion: 2,
        digestCoverage: "evidence_content_and_current_criteria",
        storedStatus: "pending_review",
        validationStatus: "pending_review",
        reviewStanding: "reviewable",
        method: "Synthetic method",
        basis: label,
        probability: { lower: 0.1, central: 0.2, upper: 0.3 },
        confidence: { level: 0.9, lower: 0.1, upper: 0.3 },
        lossCases: { best: 1, expected: 2, worst: 3, currency: "CAD" },
        sensitivityInputs: [],
        sensitivityResults: [],
        thresholdProfileId: "criteria-1",
        decisionThresholds: { escalateAbove: 16 },
        reassessmentTriggers: ["Synthetic trigger"],
        reviewDueAt: "2026-11-01T00:00:00Z",
        valueOfInformation: {
          action: "Synthetic enquiry",
          informationCost: 1,
          decisionCostIfWrong: 2,
          uncertaintyReduction: 1,
          probabilityDecisionChanges: 1,
          expectedValue: 2,
          netValue: 1,
          recommendation: "GATHER_INFORMATION",
        },
        analysisDigest: digest,
        currentDigest: digest,
        authorId: "author-1",
        createdAt: "2026-10-01T00:00:00Z",
        reviewerId: null,
        reviewedAt: null,
        reviewNote: null,
        approvalId: null,
        derivedEvidenceItemId: null,
        evidenceItemIds: [],
        operationalAuthorization: false,
      },
    ],
    boundary: label,
    operationalAuthorization: false,
  };
}

function replacementPacket(label: string) {
  const data = packet(label);
  return {
    ...data,
    risk: {
      ...data.risk,
      organizationId: organizationA,
      status: "analyzed",
    },
    criteria: {
      ...data.criteria,
      id: "a1820000-0000-4000-8000-000000000003",
      organizationId: organizationA,
    },
    evidence: [
      {
        id: "a1820000-0000-4000-8000-000000000001",
        organizationId: organizationA,
        riskId,
        description: "Synthetic verified evidence",
        sourceSystem: "synthetic",
        sourceReference: null,
        verificationStatus: "verified",
        verifiedBy: "reviewer-2",
        verifiedAt: "2026-09-30T00:00:00Z",
        evidenceClass: "MEASURED",
        qualityGrade: "high",
        applicabilityGrade: "direct",
      },
    ],
    analyses: [
      {
        ...data.analyses[0],
        organizationId: organizationA,
        riskId,
        storedStatus: "pending_review",
        validationStatus: "stale",
        reviewStanding: "replacement_required",
        authorId: "reviewer-1",
        currentDigest: "b".repeat(64),
        evidenceItemIds: ["a1820000-0000-4000-8000-000000000001"],
        sensitivityInputs: [
          {
            name: "Synthetic factor",
            basis: "Synthetic measured replacement input basis.",
            low_input: 1,
            base_input: 2,
            high_input: 3,
            low_output: 1,
            base_output: 2,
            high_output: 3,
          },
        ],
        reviewDueAt: "2099-11-01T00:00:00Z",
      },
    ],
  };
}

const receipt = {
  riskId,
  analysisId,
  analysisDigest: digest,
  decision: "validated",
  approvalId: "a1820000-0000-4000-8000-000000000012",
  derivedEvidenceItemId: "a1820000-0000-4000-8000-000000000013",
  operationalAuthorization: false,
};

function panel(organizationId: string | null, onChanged = vi.fn()) {
  return (
    <RiskUncertaintyPanel
      riskId={riskId}
      currentUserId="reviewer-1"
      currentUserRole="reliability_engineer"
      currentOrganizationId={organizationId}
      onChanged={onChanged}
    />
  );
}

async function openReview() {
  fireEvent.click(await screen.findByRole("button", { name: "Review packet" }));
  const note = screen.getByPlaceholderText(
    "Independent review basis (minimum 20 characters)",
  );
  fireEvent.change(note, {
    target: { value: "Independent frozen synthetic evidence review." },
  });
  return screen.getByRole("button", { name: "Record review" }).closest("form")!;
}

async function openReplacementDraft() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Replace stale analysis" }),
  );
  const reason = screen.getByPlaceholderText(
    "Replacement reason (minimum 20 characters)",
  );
  fireEvent.change(reason, {
    target: { value: "Synthetic replacement reason for tenant test." },
  });
  return reason.closest("form")!;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => preparedReplacement.intentId),
  });
  workspace.mockReset().mockResolvedValue(packet("Organization A packet"));
  rpc.mockReset().mockResolvedValue({ data: receipt, error: null });
  prepareReplacement.mockReset().mockResolvedValue(preparedReplacement);
  replaceReplacement
    .mockReset()
    .mockResolvedValue({ commitStatus: "committed" });
  reconcileReplacement
    .mockReset()
    .mockResolvedValue({ commitStatus: "committed" });
});

afterEach(() => vi.unstubAllGlobals());

describe("uncertainty observed canonical tenant scope", () => {
  it("does not request or expose a packet without canonical organization context", async () => {
    render(panel(null));
    await screen.findByText(/canonical organization context/i);
    expect(workspace).not.toHaveBeenCalled();
    expect(screen.queryAllByText(/Organization A packet/)).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Review packet" }),
    ).not.toBeInTheDocument();
  });

  it("invalidates same-user/same-role cached packet and controls on an organization switch", async () => {
    const view = render(panel(organizationA));
    const oldForm = await openReview();
    workspace.mockImplementation(() => new Promise(() => {}));
    view.rerender(panel(organizationB));
    expect(screen.queryAllByText(/Organization A packet/)).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Record review" }),
    ).not.toBeInTheDocument();
    fireEvent.submit(oldForm);
    expect(rpc).not.toHaveBeenCalled();
    await waitFor(() => expect(workspace).toHaveBeenCalledTimes(2));
  });

  it("does not expose a late workspace response from the previous organization", async () => {
    let oldRead!: (data: ReturnType<typeof packet>) => void;
    workspace.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          oldRead = resolve;
        }),
    );
    const view = render(panel(organizationA));
    workspace.mockImplementation(() => new Promise(() => {}));
    view.rerender(panel(organizationB));
    await act(async () => oldRead(packet("Organization A late read")));
    expect(screen.queryAllByText(/Organization A late read/)).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Review packet" }),
    ).not.toBeInTheDocument();
  });

  it("suppresses a previous-organization ACK and callback after a switch", async () => {
    let finish!: (data: unknown) => void;
    rpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const onChanged = vi.fn();
    const view = render(panel(organizationA, onChanged));
    fireEvent.submit(await openReview());
    workspace.mockResolvedValue(packet("Organization B packet"));
    view.rerender(panel(organizationB, onChanged));
    await screen.findByText("Organization B packet · v1");
    await act(async () => finish({ data: receipt, error: null }));
    expect(onChanged).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/Independent packet review recorded/),
    ).not.toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not resurrect an old ACK after A to B to A, while retaining known-ACK resend protection", async () => {
    let finish!: (data: unknown) => void;
    rpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const onChanged = vi.fn();
    const view = render(panel(organizationA, onChanged));
    fireEvent.submit(await openReview());
    workspace.mockResolvedValue(packet("Organization B packet"));
    view.rerender(panel(organizationB, onChanged));
    await screen.findByText("Organization B packet · v1");
    workspace.mockResolvedValue(packet("Organization A fresh packet"));
    view.rerender(panel(organizationA, onChanged));
    await screen.findByText("Organization A fresh packet · v1");
    await act(async () => finish({ data: receipt, error: null }));
    expect(onChanged).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/Independent packet review recorded/),
    ).not.toBeInTheDocument();
    const reopen = screen.getByRole("button", { name: "Review packet" });
    expect(reopen).toBeDisabled();
    fireEvent.click(reopen);
    expect(
      screen.queryByRole("button", { name: "Record review" }),
    ).not.toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("retains an unknown outcome hold through organization changes and return", async () => {
    let finish!: (data: unknown) => void;
    rpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(panel(organizationA));
    fireEvent.submit(await openReview());
    workspace.mockResolvedValue(packet("Organization B packet"));
    view.rerender(panel(organizationB));
    await screen.findByText("Organization B packet · v1");
    await act(async () => finish({ data: {}, error: null }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "An earlier uncertainty action has an unresolved outcome",
    );
    expect(
      screen.getByRole("button", { name: "Review packet" }),
    ).toBeDisabled();
    workspace.mockResolvedValue(packet("Organization A return packet"));
    view.rerender(panel(organizationA));
    await screen.findByText("Organization A return packet · v1");
    expect(screen.getByRole("alert")).toHaveTextContent("Do not resend it");
    expect(
      screen.getByRole("button", { name: "Review packet" }),
    ).toBeDisabled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("clears tenant-bound draft inputs instead of carrying them into the next organization", async () => {
    workspace.mockResolvedValue({
      ...packet("Organization A draft"),
      analyses: [],
    });
    const view = render(panel(organizationA));
    fireEvent.change(await screen.findByPlaceholderText("Method"), {
      target: { value: "Organization A private method" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Source, assumption and method basis"),
      {
        target: { value: "Organization A private basis" },
      },
    );
    fireEvent.change(screen.getByLabelText("Review due"), {
      target: { value: "2026-11-01T09:00" },
    });
    workspace.mockResolvedValue({
      ...packet("Organization B draft"),
      analyses: [],
    });
    view.rerender(panel(organizationB));
    expect(await screen.findByPlaceholderText("Method")).toHaveValue("");
    expect(
      screen.getByPlaceholderText("Source, assumption and method basis"),
    ).toHaveValue("");
    expect(screen.getByLabelText("Review due")).toHaveValue("");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("suppresses a late refusal after A to B to A without inventing an unknown outcome", async () => {
    let finish!: (data: unknown) => void;
    rpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const onChanged = vi.fn();
    const view = render(panel(organizationA, onChanged));
    fireEvent.submit(await openReview());
    workspace.mockResolvedValue(packet("Organization B packet"));
    view.rerender(panel(organizationB, onChanged));
    await screen.findByText("Organization B packet · v1");
    workspace.mockResolvedValue(packet("Organization A current packet"));
    view.rerender(panel(organizationA, onChanged));
    await screen.findByText("Organization A current packet · v1");
    await act(async () =>
      finish({ data: { error: "prior-context refusal" }, error: null }),
    );
    expect(screen.queryByText(/prior-context refusal/)).not.toBeInTheDocument();
    expect(screen.queryByText(/outcome is unknown/i)).not.toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    // A precise pre-write refusal is retryable only from the fresh current view.
    fireEvent.submit(await openReview());
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("cannot display an original A response over the newer A generation", async () => {
    let finish!: (data: ReturnType<typeof packet>) => void;
    workspace.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(panel(organizationA));
    workspace.mockResolvedValue(packet("Organization B packet"));
    view.rerender(panel(organizationB));
    await screen.findByText("Organization B packet · v1");
    workspace.mockResolvedValue(packet("Organization A new generation"));
    view.rerender(panel(organizationA));
    await screen.findByText("Organization A new generation · v1");
    await act(async () => finish(packet("Organization A original read")));
    expect(screen.queryAllByText(/Organization A original read/)).toHaveLength(
      0,
    );
    expect(
      screen.getByText("Organization A new generation · v1"),
    ).toBeInTheDocument();
  });

  it("does not dispatch a replacement prepared for an earlier A generation after A to B to A", async () => {
    let finish!: (value: typeof preparedReplacement) => void;
    prepareReplacement.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    workspace.mockResolvedValue(
      replacementPacket("Organization A replacement"),
    );
    const onChanged = vi.fn();
    const view = render(panel(organizationA, onChanged));
    fireEvent.submit(await openReplacementDraft());
    await waitFor(() => expect(prepareReplacement).toHaveBeenCalledTimes(1));

    workspace.mockResolvedValue(packet("Organization B packet"));
    view.rerender(panel(organizationB, onChanged));
    await screen.findByText("Organization B packet · v1");
    workspace.mockResolvedValue(
      replacementPacket("Organization A fresh replacement"),
    );
    view.rerender(panel(organizationA, onChanged));
    await screen.findByText("Organization A fresh replacement · v1");
    await act(async () => finish(preparedReplacement));

    expect(replaceReplacement).not.toHaveBeenCalled();
    expect(reconcileReplacement).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/Stale analysis replaced with a new packet/),
    ).not.toBeInTheDocument();
  });

  it("suppresses a late replacement ACK after A to B to A and keeps known-ACK resend protection", async () => {
    let finish!: (value: { commitStatus: "committed" }) => void;
    vi.mocked(globalThis.crypto.randomUUID)
      .mockReturnValueOnce(
        preparedReplacement.intentId as `${string}-${string}-${string}-${string}-${string}`,
      )
      .mockReturnValueOnce("a1820000-0000-4000-8000-000000000031");
    prepareReplacement.mockImplementation(async (input) => ({
      ...preparedReplacement,
      intentId: input.intentId,
      requestFingerprint:
        input.intentId === preparedReplacement.intentId
          ? preparedReplacement.requestFingerprint
          : "e".repeat(64),
    }));
    replaceReplacement.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    workspace.mockResolvedValue(
      replacementPacket("Organization A replacement"),
    );
    const onChanged = vi.fn();
    const view = render(panel(organizationA, onChanged));
    fireEvent.submit(await openReplacementDraft());
    await waitFor(() => expect(replaceReplacement).toHaveBeenCalledTimes(1));

    workspace.mockResolvedValue(packet("Organization B packet"));
    view.rerender(panel(organizationB, onChanged));
    await screen.findByText("Organization B packet · v1");
    workspace.mockResolvedValue(
      replacementPacket("Organization A current replacement"),
    );
    view.rerender(panel(organizationA, onChanged));
    await screen.findByText("Organization A current replacement · v1");
    await act(async () => finish({ commitStatus: "committed" }));

    expect(onChanged).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/Stale analysis replaced with a new packet/),
    ).not.toBeInTheDocument();

    fireEvent.submit(await openReplacementDraft());
    await waitFor(() => expect(prepareReplacement).toHaveBeenCalledTimes(2));
    expect(replaceReplacement).toHaveBeenCalledTimes(1);
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(2);
  });

  it("does not clear a replacement unknown lock from a late A to B to A reconciliation", async () => {
    let finish!: (value: { commitStatus: "committed" }) => void;
    replaceReplacement.mockRejectedValueOnce(
      new RiskUncertaintyReplacementOutcomeUnknownError(),
    );
    reconcileReplacement.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    workspace.mockResolvedValue(
      replacementPacket("Organization A replacement"),
    );
    const onChanged = vi.fn();
    const view = render(panel(organizationA, onChanged));
    fireEvent.submit(await openReplacementDraft());
    fireEvent.click(
      await screen.findByRole("button", { name: "Reconcile replacement" }),
    );
    await waitFor(() => expect(reconcileReplacement).toHaveBeenCalledTimes(1));

    workspace.mockResolvedValue(packet("Organization B packet"));
    view.rerender(panel(organizationB, onChanged));
    await screen.findByText("Organization B packet · v1");
    workspace.mockResolvedValue(
      replacementPacket("Organization A current replacement"),
    );
    view.rerender(panel(organizationA, onChanged));
    await screen.findByText("Organization A current replacement · v1");
    await act(async () => finish({ commitStatus: "committed" }));

    expect(onChanged).not.toHaveBeenCalled();
    expect(replaceReplacement).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole("button", { name: "Reconcile replacement" }),
    ).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Do not resend it");
    expect(
      screen.queryByText(/Committed replacement receipt reconciled/),
    ).not.toBeInTheDocument();
  });
});
