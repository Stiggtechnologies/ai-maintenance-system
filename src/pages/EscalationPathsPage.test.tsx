import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EscalationPathsPage } from "./EscalationPathsPage";
import type { EscalationPaths } from "../services/escalationPathService";

const getEscalationPaths = vi.fn();
const proposeEscalationRule = vi.fn();
const adoptEscalationRule = vi.fn();
const raiseSubjectEscalation = vi.fn();
const acknowledgeSubjectEscalation = vi.fn();
const recordOnCallDuty = vi.fn();

vi.mock("../services/escalationPathService", () => ({
  getEscalationPaths: () => getEscalationPaths(),
  proposeEscalationRule: (...args: unknown[]) => proposeEscalationRule(...args),
  adoptEscalationRule: (...args: unknown[]) => adoptEscalationRule(...args),
  retireEscalationRule: vi.fn(),
  recordOnCallDuty: (...args: unknown[]) => recordOnCallDuty(...args),
  endOnCallDuty: vi.fn(),
  raiseSubjectEscalation: (...args: unknown[]) =>
    raiseSubjectEscalation(...args),
  acknowledgeSubjectEscalation: (...args: unknown[]) =>
    acknowledgeSubjectEscalation(...args),
  withdrawSubjectEscalation: vi.fn(),
}));

const PATHS: EscalationPaths = {
  callerRole: "maintenance_manager",
  canAuthor: true,
  control:
    "Acknowledgement does not approve a decision, release work, clear an alert, or grant authority.",
  ladderRoles: ["maintenance_manager", "executive"],
  members: [
    {
      userId: "11111111-1111-1111-1111-111111111111",
      role: "maintenance_manager",
      name: "Alex",
    },
  ],
  rules: [
    {
      id: "rule-draft",
      ruleKey: "blocked_work",
      version: 1,
      subjectKind: "work_order",
      conditionKind: "blocked",
      incidentPath: true,
      responseWindowHours: null,
      escalatesToRole: "maintenance_manager",
      basis: "Blocked work waits on the site maintenance manager.",
      status: "draft",
      proposedBy: "someone-else",
      isOwnDraft: false,
    },
    {
      id: "rule-live",
      ruleKey: "blocked_work",
      version: 1,
      subjectKind: "work_order",
      conditionKind: "blocked",
      incidentPath: true,
      responseWindowHours: null,
      escalatesToRole: "maintenance_manager",
      basis: "Blocked work is an incident when it stops the line.",
      status: "adopted",
      proposedBy: "someone-else",
      isOwnDraft: false,
    },
  ],
  duties: [],
  escalations: [
    {
      id: "esc-1",
      ruleId: "rule-live",
      subjectKind: "work_order",
      subjectId: "22222222-2222-2222-2222-222222222222",
      conditionKind: "blocked",
      incidentPath: true,
      escalatesToRole: "maintenance_manager",
      onCallUserId: "11111111-1111-1111-1111-111111111111",
      stateBasis: "Work order status is blocked and it is not complete.",
      raiseNote: "The pump job has been blocked since the night shift.",
      status: "open",
      isOwnRaise: false,
    },
  ],
  candidates: [
    {
      ruleId: "rule-live",
      subjectKind: "work_order",
      subjectId: "33333333-3333-3333-3333-333333333333",
      conditionKind: "blocked",
      incidentPath: true,
      stateBasis: "Work order status is blocked and it is not complete.",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  getEscalationPaths.mockResolvedValue(PATHS);
  proposeEscalationRule.mockResolvedValue({
    ruleId: "new",
    status: "draft",
    version: 1,
  });
  adoptEscalationRule.mockResolvedValue({
    ruleId: "rule-draft",
    status: "adopted",
  });
  raiseSubjectEscalation.mockResolvedValue({
    escalationId: "esc-2",
    status: "open",
    idempotent: false,
  });
  acknowledgeSubjectEscalation.mockResolvedValue({
    escalationId: "esc-1",
    status: "acknowledged",
    grantsAuthority: false,
  });
  recordOnCallDuty.mockResolvedValue({ dutyId: "duty-1" });
});

describe("EscalationPathsPage", () => {
  it("loads the tenant paths and states the authority boundary", async () => {
    render(<EscalationPathsPage />);
    expect(
      await screen.findByText(
        /Acknowledging an escalation does not approve a decision/i,
      ),
    ).toBeInTheDocument();
    expect(getEscalationPaths).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/incident \/ on-call/i).length).toBeGreaterThan(
      0,
    );
  });

  it("raises a qualifying subject through raiseSubjectEscalation", async () => {
    render(<EscalationPathsPage />);
    const note = await screen.findByLabelText("Escalation note");
    fireEvent.change(note, {
      target: { value: "Night shift cannot clear the blocked pump job." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Raise this subject" }));
    await waitFor(() => {
      expect(raiseSubjectEscalation).toHaveBeenCalledWith({
        ruleId: "rule-live",
        subjectId: "33333333-3333-3333-3333-333333333333",
        note: "Night shift cannot clear the blocked pump job.",
      });
    });
  });

  it("acknowledges an open escalation without treating that as approval", async () => {
    render(<EscalationPathsPage />);
    const note = await screen.findByLabelText("Escalation note");
    fireEvent.change(note, {
      target: { value: "I am the on-call manager and I have the blocked job." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Acknowledge escalation" }),
    );
    await waitFor(() => {
      expect(acknowledgeSubjectEscalation).toHaveBeenCalledWith({
        escalationId: "esc-1",
        note: "I am the on-call manager and I have the blocked job.",
      });
    });
  });

  it("proposes a rule through proposeEscalationRule", async () => {
    render(<EscalationPathsPage />);
    await screen.findByLabelText("Rule key");
    fireEvent.change(screen.getByLabelText("Rule key"), {
      target: { value: "overdue_work" },
    });
    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "work_order" },
    });
    fireEvent.change(screen.getByLabelText("Condition"), {
      target: { value: "overdue" },
    });
    fireEvent.change(screen.getByLabelText("Escalates to role"), {
      target: { value: "executive" },
    });
    fireEvent.change(screen.getByLabelText("Basis"), {
      target: {
        value:
          "Overdue work escalates to the executive when the due date has passed.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Propose escalation rule" }),
    );
    await waitFor(() => {
      expect(proposeEscalationRule).toHaveBeenCalledWith(
        expect.objectContaining({
          ruleKey: "overdue_work",
          subjectKind: "work_order",
          conditionKind: "overdue",
          incidentPath: true,
          responseWindowHours: null,
          escalatesToRole: "executive",
        }),
      );
    });
  });
});
