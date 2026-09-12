import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExpenditureApprovalPanel } from "./ExpenditureApprovalPanel";

const getWorkspace = vi.fn();
const request = vi.fn();
const decide = vi.fn();
vi.mock("../services/expenditureApprovalService", () => ({
  getExpenditureApprovalWorkspace: () => getWorkspace(),
  requestExpenditureCommitment: (v: unknown) => request(v),
  decideExpenditureCommitment: (v: unknown) => decide(v),
}));
vi.mock("../services/developService", () => ({
  adoptAuthorityLimit: vi.fn(),
  draftAuthorityCeiling: vi.fn(),
  stateAuthorityCeiling: vi.fn(),
}));

const workspace = {
  callerRole: "executive",
  canRequest: true,
  control:
    "Approval authorizes only this bounded commitment. No payment is executed.",
  delegations: {
    callerRole: "executive",
    canState: true,
    refusal: null,
    note: "Adopted delegations are immutable.",
    delegations: [
      {
        id: "limit-1",
        roleKey: "executive",
        tierLabel: "Executive",
        actionType: "commit_expenditure",
        status: "adopted",
        orgNodeId: null,
        version: 1,
        maxCommitment: 500000,
        maxCommitmentCurrency: "CAD",
        maxRiskLevel: "High",
        escalatesToRole: "board",
        basis: "Board instrument",
        adoptedBy: "director@example.com",
        adoptedAt: "2026-09-12",
        isMyRole: true,
        ceilingRefusal: null,
        selfAdoptionRefusal: "You may not adopt your own ceiling.",
      },
    ],
  },
  commitments: [
    {
      id: "expense-1",
      title: "Critical pump replacement",
      purpose: "Replace a failed production-critical pump.",
      evidenceBasis: "Condition and failure evidence supports replacement.",
      consequenceOfWrong: "Capital may be misallocated and production exposed.",
      amount: 125000,
      currency: "CAD",
      status: "pending",
      requestedBy: "requester@example.com",
      requestedAt: "2026-09-12",
      approvalId: "approval-1",
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      authorityLimitId: null,
      authorityCeiling: null,
      authorityCurrency: null,
      isOwnRequest: false,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspace.mockResolvedValue(workspace);
  request.mockResolvedValue({ status: "pending" });
  decide.mockResolvedValue({ status: "approved" });
});

describe("ExpenditureApprovalPanel", () => {
  it("shows the amount, delegation, execution boundary and independent decision", async () => {
    render(<ExpenditureApprovalPanel />);
    expect(
      await screen.findByText("Critical pump replacement"),
    ).toBeInTheDocument();
    expect(screen.getByText("CAD 125,000")).toBeInTheDocument();
    expect(screen.getByText(/No payment is executed/)).toBeInTheDocument();
    expect(screen.getByText("CAD 500,000")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Decision basis for/), {
      target: {
        value: "Approved against the recorded evidence and delegation.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Approve within delegation" }),
    );
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(
        expect.objectContaining({ id: "expense-1", outcome: "approved" }),
      ),
    );
  });
  it("routes a fully stated request", async () => {
    render(<ExpenditureApprovalPanel />);
    await screen.findByText("Critical pump replacement");
    fireEvent.change(screen.getByPlaceholderText("Commitment title"), {
      target: { value: "Motor replacement" },
    });
    fireEvent.change(screen.getByPlaceholderText("Amount"), {
      target: { value: "40000" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Business purpose/), {
      target: {
        value: "Replace the failed motor and restore production capacity.",
      },
    });
    fireEvent.change(screen.getByPlaceholderText(/Evidence supporting/), {
      target: {
        value: "Inspection evidence confirms winding damage beyond repair.",
      },
    });
    fireEvent.change(screen.getByPlaceholderText(/Consequence if/), {
      target: {
        value: "A wrong decision would waste capital and prolong downtime.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Route for independent approval" }),
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({ amount: "40000", currency: "CAD" }),
      ),
    );
  });
});
