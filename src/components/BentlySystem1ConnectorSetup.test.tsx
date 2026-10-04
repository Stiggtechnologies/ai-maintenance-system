import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BentlySystem1ConnectorSetup } from "./BentlySystem1ConnectorSetup";

const auth = vi.hoisted(() => ({ role: "admin" }));
const actions = vi.hoisted(() => ({ configure: vi.fn(), pull: vi.fn() }));
const loadRegistry = vi.hoisted(() => vi.fn());

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role: auth.role } }),
}));
vi.mock("../services/bentlySystem1Read", async () => {
  const actual = await vi.importActual<
    typeof import("../services/bentlySystem1Read")
  >("../services/bentlySystem1Read");
  return { ...actual, bentlySystem1ReadActions: actions };
});
vi.mock("../services/conditionSensorRegistryService", () => ({
  loadConditionSensorRegistry: loadRegistry,
}));

beforeEach(() => {
  auth.role = "admin";
  actions.configure.mockReset().mockResolvedValue({ note: "saved" });
  actions.pull.mockReset().mockResolvedValue({
    raw_rows: 2,
    pages: 1,
    status: "success",
    records_accepted: 2,
    records_duplicate: 0,
    records_rejected: 0,
  });
  loadRegistry.mockReset().mockResolvedValue({
    sensors: [
      {
        sensorId: "11111111-1111-4111-8111-111111111111",
        assetTag: "P-101",
        sensorTag: "DE-VIB",
        name: "Drive-end vibration",
        unit: "mm/s",
        registryStatus: "active",
      },
    ],
  });
});

describe("Bently System 1 connector setup", () => {
  it("records exact OPC UA node, canonical sensor and unit bindings", async () => {
    const onConfigured = vi.fn().mockResolvedValue(undefined);
    render(<BentlySystem1ConnectorSetup onConfigured={onConfigured} />);
    await screen.findByText(/P-101 · DE-VIB/);
    fireEvent.change(screen.getByLabelText("System 1 connector key"), {
      target: { value: "north-system1" },
    });
    fireEvent.change(screen.getByPlaceholderText("System 1 display name"), {
      target: { value: "North System 1" },
    });
    fireEvent.change(screen.getByPlaceholderText(/syncai\/v1\/system1/), {
      target: {
        value:
          "https://gateway.example.com/syncai/v1/system1/readings",
      },
    });
    fireEvent.change(
      screen.getByPlaceholderText("vault://tenant/system1-gateway"),
      { target: { value: "vault://north/system1" } },
    );
    fireEvent.change(screen.getByLabelText("Approved System 1 node bindings"), {
      target: {
        value:
          "ns=2;s=North/P101/DE/Vibration | 11111111-1111-4111-8111-111111111111 | mm/s",
      },
    });
    fireEvent.change(screen.getByPlaceholderText(/Human approval basis/), {
      target: {
        value:
          "Reliability approved the exact gateway nodes, sensors and engineering units.",
      },
    });
    fireEvent.click(screen.getByLabelText(/Enable only after the gateway host/));
    fireEvent.click(
      screen.getByRole("button", { name: "Save governed System 1 source" }),
    );

    await waitFor(() => expect(actions.configure).toHaveBeenCalledTimes(1));
    expect(actions.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "north-system1",
        endpoint:
          "https://gateway.example.com/syncai/v1/system1/readings",
        enabled: true,
        bindings: [
          {
            nodeId: "ns=2;s=North/P101/DE/Vibration",
            sensorId: "11111111-1111-4111-8111-111111111111",
            unit: "mm/s",
          },
        ],
      }),
    );
    expect(onConfigured).toHaveBeenCalled();
  });

  it("lets an AI administrator dry-run but not configure or promote", async () => {
    auth.role = "ai_admin";
    render(<BentlySystem1ConnectorSetup onConfigured={vi.fn()} />);
    expect(screen.queryByPlaceholderText("System 1 display name")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Validate complete dry run" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Pull governed readings" }),
    ).toBeNull();
  });

  it("lets a named reliability engineer promote but not configure", () => {
    auth.role = "reliability_engineer";
    render(<BentlySystem1ConnectorSetup onConfigured={vi.fn()} />);
    expect(screen.queryByPlaceholderText("System 1 display name")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Pull governed readings" }),
    ).toBeInTheDocument();
  });
});
