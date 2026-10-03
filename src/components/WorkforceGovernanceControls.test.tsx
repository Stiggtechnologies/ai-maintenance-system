import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideLabourRule,
  getWorkforceGovernanceWorkspace,
  recordLabourRule,
  transitionTrainingPlan,
  type WorkforceGovernanceWorkspace,
} from "../services/workforceGovernanceService";
import { WorkforceGovernanceControls } from "./WorkforceGovernanceControls";

vi.mock("../services/workforceGovernanceService", () => ({
  decideLabourRule: vi.fn(),
  getWorkforceGovernanceWorkspace: vi.fn(),
  recordLabourRule: vi.fn(),
  transitionTrainingPlan: vi.fn(),
}));

const workspace: WorkforceGovernanceWorkspace = {
  answered: true,
  effectiveRuleCount: 1,
  boundary:
    "Training completion records delivery only and never grants competency.",
  trainingPlans: [
    {
      planId: 12,
      memberId: 7,
      memberName: "A. Technician",
      competencyId: 9,
      competencyTitle: "Confined-space entrant",
      planKind: "requalification",
      targetDate: "2027-03-01",
      status: "in_progress",
      driver: "Annual certification renewal",
      version: 2,
      lifecycleBasis: "Instructor confirmed the scheduled cohort started.",
      completionEvidenceReference: null,
      supersedesPlanId: null,
      supersededByPlanId: null,
      createdAt: "2027-01-01T00:00:00Z",
      updatedAt: "2027-01-02T00:00:00Z",
    },
  ],
  labourRules: [
    {
      ruleId: 21,
      ruleKey: "collective-rest-window",
      title: "Collective agreement rest window",
      source: "labour_agreement",
      limitKind: "min_rest_hours_between_shifts",
      limitValue: 12,
      appliesToCraft: null,
      reference: "CBA 2027 article 14",
      status: "draft",
      version: 2,
      basis: "The ratified agreement requires twelve hours between shifts.",
      evidenceReference: "CBA-2027-ART-14",
      effectiveFrom: "2027-01-01",
      effectiveUntil: null,
      recordedBy: "11111111-1111-1111-1111-111111111111",
      adoptedBy: null,
      adoptedAt: null,
      retiredAt: null,
      decisionBasis: null,
      supersedesRuleId: 20,
    },
  ],
};

describe("WorkforceGovernanceControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWorkforceGovernanceWorkspace).mockResolvedValue(workspace);
    vi.mocked(transitionTrainingPlan).mockResolvedValue({
      answered: true,
      note: "Training delivery recorded without granting competency.",
      competencyGranted: false,
    });
    vi.mocked(recordLabourRule).mockResolvedValue({
      answered: true,
      note: "Draft recorded for independent adoption.",
    });
    vi.mocked(decideLabourRule).mockResolvedValue({
      answered: true,
      note: "Labour-rule decision recorded.",
    });
  });

  it("makes governed training and labour-rule lifecycle controls customer-reachable", async () => {
    render(<WorkforceGovernanceControls />);
    fireEvent.click(screen.getByText("Govern training and labour rules"));

    expect(
      await screen.findByRole("button", {
        name: "Record training lifecycle act",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record labour-rule draft" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record labour-rule decision" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /training completion records delivery only—it never declares/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/a draft author cannot adopt their own rule/i),
    ).toBeInTheDocument();
  });

  it("records training completion with evidence and optimistic versioning", async () => {
    const onChanged = vi.fn();
    render(<WorkforceGovernanceControls onChanged={onChanged} />);
    fireEvent.click(screen.getByText("Govern training and labour rules"));
    await screen.findByRole("button", {
      name: "Record training lifecycle act",
    });

    fireEvent.change(screen.getByLabelText("Training plan"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("Training lifecycle action"), {
      target: { value: "complete" },
    });
    fireEvent.change(screen.getByLabelText("Training lifecycle basis"), {
      target: {
        value:
          "Instructor and supervisor reconciled the completed delivery roster.",
      },
    });
    fireEvent.change(screen.getByLabelText("Training completion evidence"), {
      target: { value: "LMS-ATTENDANCE-2027-0042" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record training lifecycle act" }),
    );

    await waitFor(() =>
      expect(transitionTrainingPlan).toHaveBeenCalledWith({
        planId: 12,
        action: "complete",
        basis:
          "Instructor and supervisor reconciled the completed delivery roster.",
        evidenceReference: "LMS-ATTENDANCE-2027-0042",
        replacementTargetDate: undefined,
        replacementDriver: undefined,
        expectedVersion: 2,
      }),
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("authors a dated labour-rule draft for a separate human decision", async () => {
    render(<WorkforceGovernanceControls />);
    fireEvent.click(screen.getByText("Govern training and labour rules"));
    await screen.findByRole("button", { name: "Record labour-rule draft" });

    fireEvent.change(screen.getByLabelText("Labour rule key"), {
      target: { value: "night-shift-cap" },
    });
    fireEvent.change(screen.getByLabelText("Labour rule title"), {
      target: { value: "Night-shift sequence cap" },
    });
    fireEvent.change(screen.getByLabelText("Labour rule source"), {
      target: { value: "fatigue_science" },
    });
    fireEvent.change(screen.getByLabelText("Labour rule limit kind"), {
      target: { value: "max_consecutive_nights" },
    });
    fireEvent.change(screen.getByLabelText("Labour rule limit value"), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText("Labour rule evidence reference"), {
      target: { value: "FATIGUE-STANDARD-2027-04" },
    });
    fireEvent.change(screen.getByLabelText("Labour rule effective from"), {
      target: { value: "2027-02-01" },
    });
    fireEvent.change(screen.getByLabelText("Labour rule basis"), {
      target: {
        value: "Approved fatigue standard limits consecutive night exposure.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record labour-rule draft" }),
    );

    await waitFor(() =>
      expect(recordLabourRule).toHaveBeenCalledWith({
        ruleKey: "night-shift-cap",
        title: "Night-shift sequence cap",
        source: "fatigue_science",
        limitKind: "max_consecutive_nights",
        limitValue: "4",
        appliesToCraft: undefined,
        reference: undefined,
        basis: "Approved fatigue standard limits consecutive night exposure.",
        evidenceReference: "FATIGUE-STANDARD-2027-04",
        effectiveFrom: "2027-02-01",
        effectiveUntil: undefined,
      }),
    );
  });

  it("routes adoption through an explicit independent decision", async () => {
    render(<WorkforceGovernanceControls />);
    fireEvent.click(screen.getByText("Govern training and labour rules"));
    await screen.findByRole("button", { name: "Record labour-rule decision" });

    fireEvent.change(screen.getByLabelText("Labour rule version"), {
      target: { value: "21" },
    });
    fireEvent.change(screen.getByLabelText("Labour rule decision basis"), {
      target: {
        value: "Independent review confirmed the ratified agreement wording.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record labour-rule decision" }),
    );

    await waitFor(() =>
      expect(decideLabourRule).toHaveBeenCalledWith({
        ruleId: 21,
        decision: "adopt",
        note: "Independent review confirmed the ratified agreement wording.",
      }),
    );
  });
});
