import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaintenanceChangeControlPanel } from "./MaintenanceChangeControlPanel";

const getWorkspace = vi.fn();
const requestDeferral = vi.fn();
const requestCreate = vi.fn();
const requestReschedule = vi.fn();
const decide = vi.fn();

vi.mock("../services/maintenanceChangeControlService", () => ({
  getMaintenanceChangeControlWorkspace: () => getWorkspace(),
  requestCriticalWorkDeferral: (value: unknown) => requestDeferral(value),
  requestSafetyCriticalWork: (value: unknown) => requestCreate(value),
  requestSafetyCriticalReschedule: (value: unknown) =>
    requestReschedule(value),
  decideMaintenanceChangeControl: (value: unknown) => decide(value),
}));

const workspace = {
  callerRole: "maintenance_manager",
  canRequest: true,
  canDecide: true,
  control:
    "Approval changes only the bounded work record. It does not release a schedule, spend money, change an operating limit or return equipment to service.",
  workOrders: [
    {
      id: "wo-1",
      number: "WO-1001",
      title: "Inspect pressure safety valve",
      assetId: "asset-1",
      assetName: "Separator V-101",
      status: "scheduled",
      priority: "critical",
      safetyFlag: true,
      scheduledDate: "2026-10-10",
      dueDate: "2026-10-10T12:00:00Z",
      riskId: "risk-1",
      controlRevision: 3,
      deferredUntil: null,
    },
  ],
  assets: [{ id: "asset-1", name: "Separator V-101", tag: "V-101" }],
  requests: [
    {
      id: "approval-1",
      action: "defer_critical_work",
      status: "required",
      workOrderId: "wo-1",
      workOrderTitle: "Inspect pressure safety valve",
      requestedBy: "requester@example.com",
      requestedAt: "2026-10-02T00:00:00Z",
      proposedEffectiveAt: "2026-10-20T12:00:00Z",
      reason: "Required specialist is unavailable until the shutdown window.",
      consequenceOfWrong:
        "The safety barrier could remain impaired beyond the tolerable period.",
      requiredValidation:
        "Verify the valve before the approved deferred due date.",
      riskAcceptanceReady: true,
      isOwnRequest: false,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspace.mockResolvedValue(workspace);
  requestDeferral.mockResolvedValue({ approval_id: "approval-2" });
  requestCreate.mockResolvedValue({ approval_id: "approval-3" });
  requestReschedule.mockResolvedValue({ approval_id: "approval-4" });
  decide.mockResolvedValue({ status: "approved" });
});

describe("MaintenanceChangeControlPanel", () => {
  it("shows the execution boundary and independently decides a pending request", async () => {
    render(<MaintenanceChangeControlPanel />);
    expect(
      await screen.findByText("Inspect pressure safety valve"),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not release a schedule/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Decision basis for/), {
      target: {
        value:
          "Approved against the active risk acceptance and recorded controls.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalId: "approval-1",
          outcome: "approved",
        }),
      ),
    );
  });

  it("routes a critical-work deferral without pretending it is approved", async () => {
    render(<MaintenanceChangeControlPanel />);
    await screen.findByText("Inspect pressure safety valve");
    fireEvent.change(screen.getByLabelText("Governed action"), {
      target: { value: "defer_critical_work" },
    });
    fireEvent.change(screen.getByLabelText("Work order"), {
      target: { value: "wo-1" },
    });
    fireEvent.change(screen.getByLabelText("Proposed date"), {
      target: { value: "2026-10-20T12:00" },
    });
    fireEvent.change(screen.getByPlaceholderText("Why is this change needed?"), {
      target: {
        value: "Required specialist is unavailable until the shutdown window.",
      },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Consequence if the decision is wrong"),
      {
        target: {
          value:
            "The safety barrier could remain impaired beyond the tolerable period.",
        },
      },
    );
    fireEvent.change(screen.getByPlaceholderText("Required validation"), {
      target: {
        value: "Verify the valve before the approved deferred due date.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Route for independent approval" }),
    );
    await waitFor(() =>
      expect(requestDeferral).toHaveBeenCalledWith(
        expect.objectContaining({ workOrderId: "wo-1" }),
      ),
    );
  });
});
