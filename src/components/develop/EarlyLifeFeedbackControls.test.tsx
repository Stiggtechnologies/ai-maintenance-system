import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCaseEarlyLifeFeedbackWorkspace,
  linkCaseEarlyLifeFailure,
  type EarlyLifeFeedbackWorkspace,
  type TransitionFailure,
} from "../../services/syncTransitionService";
import { EarlyLifeFeedbackControls } from "./EarlyLifeFeedbackControls";

vi.mock("../../services/syncTransitionService", () => ({
  getCaseEarlyLifeFeedbackWorkspace: vi.fn(),
  linkCaseEarlyLifeFailure: vi.fn(),
}));

const failures: TransitionFailure[] = [
  {
    id: 41,
    assetId: "asset-1",
    assetName: "Pump P-101",
    assetTag: "P-101",
    occurredAt: "2026-09-01T12:00:00Z",
    monthsSinceHandover: 1,
    failureMode: "Seal leak after startup",
    attributedTo: "design",
    preventableBy: "Revised seal requirement",
    fedBackToDesign: false,
    workOrderId: null,
    sourceReference: "WO-1042",
    evidenceClass: "INSPECTED",
    assessmentBasis: "Inspection confirmed the seal leak after restart.",
    recordedBy: "human-1",
  },
  {
    id: 42,
    assetId: "asset-2",
    assetName: "Compressor K-05",
    assetTag: "K-05",
    occurredAt: "2026-09-02T12:00:00Z",
    monthsSinceHandover: 2,
    failureMode: "High vibration",
    attributedTo: "installation",
    preventableBy: "Alignment acceptance criterion",
    fedBackToDesign: true,
    workOrderId: null,
    sourceReference: "WO-1043",
    evidenceClass: "MEASURED",
    assessmentBasis: "Measured vibration exceeded the acceptance criterion.",
    recordedBy: "human-1",
  },
];

const workspace: EarlyLifeFeedbackWorkspace = {
  answered: true,
  boundary:
    "A retained link proves the observation reached design. Only verified requirements count as eliminated.",
  requirements: [
    {
      id: 101,
      requirementRef: "REQ-ELF-1",
      requirement:
        "Seal system shall survive five cold starts without leakage.",
      verificationStatus: "open",
    },
    {
      id: 102,
      requirementRef: "REQ-ELF-2",
      requirement: "Alignment shall meet the measured vibration criterion.",
      verificationStatus: "verified",
    },
  ],
  evidence: [{ id: "evidence-1", description: "Verified startup inspection" }],
  links: [
    {
      id: 501,
      failureId: 41,
      requirementId: 101,
      requirementRef: "REQ-ELF-1",
      verificationStatus: "open",
      eliminationStatus: "feedback_linked",
      basis:
        "The seal requirement directly addresses the observed startup leak.",
      evidenceItemId: "evidence-1",
      linkedBy: "human-1",
      linkedAt: "2026-09-03T12:00:00Z",
    },
    {
      id: 502,
      failureId: 42,
      requirementId: 102,
      requirementRef: "REQ-ELF-2",
      verificationStatus: "verified",
      eliminationStatus: "verified_eliminated",
      basis:
        "The verified alignment requirement addresses the measured vibration.",
      evidenceItemId: "evidence-1",
      linkedBy: "human-1",
      linkedAt: "2026-09-04T12:00:00Z",
    },
  ],
};

describe("EarlyLifeFeedbackControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCaseEarlyLifeFeedbackWorkspace).mockResolvedValue(workspace);
    vi.mocked(linkCaseEarlyLifeFailure).mockResolvedValue({
      answered: true,
      linkId: 503,
      failureId: 41,
      requirementId: 102,
      requirementRef: "REQ-ELF-2",
      eliminationStatus: "verified_eliminated",
      note: "The observed failure remains retained; verified evidence closes the requirement link.",
    });
  });

  it("distinguishes a retained feedback link from verified elimination", async () => {
    render(
      <EarlyLifeFeedbackControls caseId="case-1" failures={failures} canLink />,
    );

    expect(
      await screen.findByText("feedback linked; verification pending"),
    ).toBeInTheDocument();
    expect(screen.getByText("verified eliminated")).toBeInTheDocument();
    expect(
      screen.getByText(/Only verified requirements count/),
    ).toBeInTheDocument();
  });

  it("records a named requirement/evidence relationship rather than editing the observation", async () => {
    render(
      <EarlyLifeFeedbackControls caseId="case-1" failures={failures} canLink />,
    );
    const buttons = await screen.findAllByRole("button", {
      name: "Link retained evidence to a design requirement",
    });
    fireEvent.click(buttons[0]);
    fireEvent.change(screen.getByLabelText("Design requirement"), {
      target: { value: "102" },
    });
    fireEvent.change(screen.getByLabelText("Verified feedback evidence"), {
      target: { value: "evidence-1" },
    });
    fireEvent.change(screen.getByLabelText("Feedback linkage basis"), {
      target: {
        value:
          "Verified alignment evidence addresses the observed failure mode.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record feedback link" }),
    );

    await waitFor(() =>
      expect(linkCaseEarlyLifeFailure).toHaveBeenCalledWith({
        caseId: "case-1",
        failureId: 41,
        requirementId: 102,
        evidenceItemId: "evidence-1",
        basis:
          "Verified alignment evidence addresses the observed failure mode.",
      }),
    );
  });
});
