import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AzureIotOperationsConnectorSetup } from "./AzureIotOperationsConnectorSetup";

const status = vi.fn();
const configure = vi.fn();
let role = "admin";

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role } }),
}));
vi.mock("../services/azureIotOperations", () => ({
  azureIotOperationsActions: {
    status: (...args: unknown[]) => status(...args),
    configure: (...args: unknown[]) => configure(...args),
  },
}));

beforeEach(() => {
  role = "admin";
  vi.clearAllMocks();
  status.mockResolvedValue({
    configured: false,
    enabled: false,
    live: false,
    confirmed_tag_mappings: 0,
    unconfirmed_tag_mappings: 0,
    recent_runs: [],
    basis: "No live OPC UA telemetry claim is made.",
  });
  configure.mockResolvedValue({
    ok: true,
    note: "Saved disabled. Confirm tag mappings before enabling.",
  });
});

describe("AzureIotOperationsConnectorSetup", () => {
  it("keeps configuration behind named administrator authority", async () => {
    role = "reliability_engineer";
    render(
      <AzureIotOperationsConnectorSetup onConfigured={async () => undefined} />,
    );
    expect(
      await screen.findByText(/named administrator must configure/i),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Connector key/i)).toBeNull();
  });

  it("shows an honest unproven state and the read-only boundary", async () => {
    render(
      <AzureIotOperationsConnectorSetup onConfigured={async () => undefined} />,
    );
    expect(await screen.findByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText(/Plant writes, method calls/i)).toBeInTheDocument();
    expect(
      screen.getByText(/No live OPC UA telemetry claim/i),
    ).toBeInTheDocument();
  });

  it("saves the complete tenant authority and external-secret references", async () => {
    const onConfigured = vi.fn().mockResolvedValue(undefined);
    render(<AzureIotOperationsConnectorSetup onConfigured={onConfigured} />);
    await screen.findByText("Disabled");
    fireEvent.change(screen.getByPlaceholderText(/Connector key/i), {
      target: { value: "mine-a-aio" },
    });
    fireEvent.change(screen.getByPlaceholderText("Display name"), {
      target: { value: "Mine A OPC UA" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("namespace.servicebus.windows.net"),
      { target: { value: "mine-a-ops.servicebus.windows.net" } },
    );
    fireEvent.change(screen.getByPlaceholderText("Event Hub name"), {
      target: { value: "opcua-telemetry" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Ingress key ID/i), {
      target: { value: "mine-a-key" },
    });
    fireEvent.change(screen.getByPlaceholderText(/keyvault:/i), {
      target: { value: "keyvault://mine-a/syncai-relay" },
    });
    fireEvent.change(screen.getByPlaceholderText("Operational purpose"), {
      target: { value: "Condition monitoring evidence" },
    });
    fireEvent.change(screen.getByPlaceholderText(/rights reference/i), {
      target: { value: "DPA-2026-101" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Activation, data-rights/i), {
      target: {
        value:
          "Customer-authorized receiver-only telemetry for condition evidence; no plant control.",
      },
    });
    fireEvent.click(screen.getByText("Save disabled configuration"));
    await waitFor(() =>
      expect(configure).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "mine-a-aio",
          eventHubsNamespace: "mine-a-ops.servicebus.windows.net",
          eventHubName: "opcua-telemetry",
          ingressKeyId: "mine-a-key",
          enabled: false,
        }),
      ),
    );
    expect(onConfigured).toHaveBeenCalled();
  });
});
