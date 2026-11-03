import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpcUaReadConnectorSetup } from "./OpcUaReadConnectorSetup";

const auth = vi.hoisted(() => ({ role: "admin" }));
const actions = vi.hoisted(() => ({ configure: vi.fn(), pull: vi.fn() }));

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role: auth.role } }),
}));
vi.mock("../services/opcUaRead", () => ({
  opcUaReadActions: actions,
}));

beforeEach(() => {
  auth.role = "admin";
  actions.configure.mockReset().mockResolvedValue({ note: "saved" });
  actions.pull.mockReset().mockResolvedValue({
    mapped_rows: 2,
    status: "success",
    records_rejected: 0,
  });
});

describe("OPC-UA read connector setup", () => {
  it("records the endpoint, security selection, credential reference and node list", async () => {
    const onConfigured = vi.fn().mockResolvedValue(undefined);
    render(<OpcUaReadConnectorSetup onConfigured={onConfigured} />);
    fireEvent.change(screen.getByPlaceholderText("OPC-UA connector key"), {
      target: { value: "north-opcua" },
    });
    fireEvent.change(screen.getByPlaceholderText("OPC-UA display name"), {
      target: { value: "North OPC-UA" },
    });
    fireEvent.change(screen.getByLabelText("OPC-UA endpoint URL"), {
      target: { value: "opc.tcp://plant.example.com:4840" },
    });
    fireEvent.change(screen.getByLabelText("OPC-UA security mode"), {
      target: { value: "None" },
    });
    fireEvent.change(screen.getByLabelText("OPC-UA security policy"), {
      target: { value: "None" },
    });
    fireEvent.change(screen.getByLabelText("OPC-UA node ids"), {
      target: { value: "ns=2;s=Pump.Speed\ni=2258\n" },
    });
    fireEvent.change(screen.getByPlaceholderText("vault://tenant/opc-ua"), {
      target: { value: "vault://north/opc-ua" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "Activation authority and exact node-list basis (20+ characters)",
      ),
      {
        target: {
          value:
            "The reliability lead approved these two nodes as read-only evidence.",
        },
      },
    );
    fireEvent.click(
      screen.getByLabelText(/Enable only after the gateway host/i),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save and enable" }));

    await waitFor(() => expect(actions.configure).toHaveBeenCalledTimes(1));
    expect(actions.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "north-opcua",
        endpointUrl: "opc.tcp://plant.example.com:4840",
        securityMode: "None",
        securityPolicy: "None",
        authMode: "anonymous",
        nodeIds: ["ns=2;s=Pump.Speed", "i=2258"],
        credentialRef: "vault://north/opc-ua",
        enabled: true,
      }),
    );
    expect(onConfigured).toHaveBeenCalledTimes(1);
  });

  it("does not expose configuration to non-human administrators", () => {
    auth.role = "reliability_engineer";
    const { rerender } = render(
      <OpcUaReadConnectorSetup onConfigured={vi.fn()} />,
    );
    expect(
      screen.getByText(
        "An administrator must configure or enable this source.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("OPC-UA connector key")).toBeNull();

    auth.role = "ai_admin";
    rerender(<OpcUaReadConnectorSetup onConfigured={vi.fn()} />);
    expect(
      screen.getByText(
        "An administrator must configure or enable this source.",
      ),
    ).toBeInTheDocument();
  });
});
