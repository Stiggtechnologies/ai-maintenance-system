import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SapS4WriteConnectorSetup } from "./SapS4WriteConnectorSetup";

const auth = vi.hoisted(() => ({ role: "admin", userId: "user-admin" }));
const actions = vi.hoisted(() => ({
  setEnabled: vi.fn(),
  configure: vi.fn(),
  propose: vi.fn(),
  decide: vi.fn(),
  execute: vi.fn(),
  workspace: vi.fn(),
}));

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({
    profile: { role: auth.role },
    user: { id: auth.userId },
  }),
}));
vi.mock("../services/sapS4Write", () => ({
  sapS4WriteActions: actions,
}));

const pending = {
  id: "00000000-0000-4000-8000-000000000010",
  operation: "maintenance_notification_create",
  serviceName: "API_MAINTNOTIFICATION",
  entityName: "MaintenanceNotification",
  httpMethod: "POST",
  status: "pending",
  payload: { NotificationType: "M1", NotificationText: "Pump seal leak" },
  payloadSha256: "a".repeat(64),
  requestedBy: "00000000-0000-4000-8000-000000000099",
  sapHttpStatus: null,
  sapError: null,
};

beforeEach(() => {
  auth.role = "admin";
  auth.userId = "user-admin";
  actions.setEnabled.mockReset().mockResolvedValue({ note: "flag saved" });
  actions.configure.mockReset().mockResolvedValue({ note: "connector saved" });
  actions.propose.mockReset().mockResolvedValue({ note: "proposed" });
  actions.decide.mockReset().mockResolvedValue({ note: "decided" });
  actions.execute
    .mockReset()
    .mockResolvedValue({ note: "executed", sap_called: true });
  actions.workspace.mockReset().mockResolvedValue({
    tenantWriteEnabled: false,
    canApprove: false,
    callerId: auth.userId,
    requests: [pending],
  });
});

describe("SAP S/4HANA write-back setup", () => {
  it("keeps the tenant write flag off until an administrator checks it", async () => {
    render(<SapS4WriteConnectorSetup onConfigured={vi.fn()} />);
    const box = await screen.findByRole("checkbox", {
      name: "Enable SAP writes for this tenant",
    });
    expect(box).not.toBeChecked();
    expect(
      screen.getByText(/not certified against a customer SAP tenant/i),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Save tenant write flag" }),
    );
    expect(actions.setEnabled).not.toHaveBeenCalled();
    fireEvent.change(
      screen.getByPlaceholderText(/Basis for the tenant write flag/i),
      {
        target: {
          value:
            "Named administrator keeps SAP writes disabled until a witnessed pilot.",
        },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save tenant write flag" }),
    );
    await waitFor(() => {
      expect(actions.setEnabled).toHaveBeenCalledWith(
        false,
        "Named administrator keeps SAP writes disabled until a witnessed pilot.",
      );
    });
  });

  it("hides approve and execute from a caller without approval rights", async () => {
    render(<SapS4WriteConnectorSetup onConfigured={vi.fn()} />);
    expect(
      await screen.findByText(/API_MAINTNOTIFICATION\/MaintenanceNotification/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Execute approved write" }),
    ).not.toBeInTheDocument();
    expect(actions.execute).not.toHaveBeenCalled();
  });

  it("lets an approver decide a request they did not author", async () => {
    actions.workspace.mockResolvedValue({
      tenantWriteEnabled: true,
      canApprove: true,
      callerId: "approver-1",
      requests: [pending],
    });
    auth.userId = "approver-1";
    render(<SapS4WriteConnectorSetup onConfigured={vi.fn()} />);
    expect(
      await screen.findByRole("button", { name: "Approve" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Decision basis"), {
      target: {
        value:
          "Independent maintenance manager accepts this notification text.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(actions.decide).toHaveBeenCalledWith(
        pending.id,
        "approved",
        "Independent maintenance manager accepts this notification text.",
      );
    });
    expect(actions.execute).not.toHaveBeenCalled();
  });
});
