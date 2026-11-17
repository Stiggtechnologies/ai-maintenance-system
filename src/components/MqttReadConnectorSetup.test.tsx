import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MqttReadConnectorSetup } from "./MqttReadConnectorSetup";

const auth = vi.hoisted(() => ({ role: "admin" }));
const actions = vi.hoisted(() => ({ configure: vi.fn(), pull: vi.fn() }));

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role: auth.role } }),
}));
vi.mock("../services/mqttRead", () => ({
  mqttReadActions: actions,
}));

beforeEach(() => {
  auth.role = "admin";
  actions.configure.mockReset().mockResolvedValue({ note: "saved" });
  actions.pull.mockReset().mockResolvedValue({
    messages: 2,
    bytes: 16,
    status: "success",
    records_rejected: 0,
    truncated: false,
  });
});

describe("MQTT read connector setup", () => {
  it("records a TLS WebSocket broker, topic filters, and subscribe bounds", async () => {
    const onConfigured = vi.fn().mockResolvedValue(undefined);
    render(<MqttReadConnectorSetup onConfigured={onConfigured} />);
    fireEvent.change(screen.getByPlaceholderText("MQTT connector key"), {
      target: { value: "north-mqtt" },
    });
    fireEvent.change(screen.getByPlaceholderText("MQTT display name"), {
      target: { value: "North MQTT" },
    });
    fireEvent.change(screen.getByLabelText("MQTT broker URL"), {
      target: { value: "wss://broker.example.com/mqtt" },
    });
    fireEvent.change(screen.getByLabelText("MQTT topic filters"), {
      target: { value: "plant/line1/#\nplant/line1/status" },
    });
    fireEvent.change(screen.getByLabelText("MQTT listen window seconds"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("Maximum MQTT messages"), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByLabelText("MQTT subscribe QoS"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByPlaceholderText("vault://tenant/mqtt-read"), {
      target: { value: "vault://north/mqtt-read" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "Activation authority and broker/topic basis (20+ characters)",
      ),
      {
        target: {
          value:
            "The administrator approved the north broker and plant/line1 filters.",
        },
      },
    );
    fireEvent.click(
      screen.getByLabelText(/Enable only after the exact broker host/i),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save and enable" }));

    await waitFor(() => expect(actions.configure).toHaveBeenCalledTimes(1));
    expect(actions.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "north-mqtt",
        brokerUrl: "wss://broker.example.com/mqtt",
        topicFilters: ["plant/line1/#", "plant/line1/status"],
        windowSeconds: 10,
        maxMessages: 25,
        subscribeQos: 1,
        enabled: true,
      }),
    );
    expect(onConfigured).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/never publishes/i)).toBeInTheDocument();
    expect(
      screen.getByText(/not certified against a live broker/i),
    ).toBeInTheDocument();
  });

  it("does not expose configuration to non-human administrators", () => {
    auth.role = "reliability_engineer";
    const { rerender } = render(
      <MqttReadConnectorSetup onConfigured={vi.fn()} />,
    );
    expect(
      screen.getByText(
        "An administrator must configure or enable this source.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("MQTT connector key")).toBeNull();

    auth.role = "ai_admin";
    rerender(<MqttReadConnectorSetup onConfigured={vi.fn()} />);
    expect(screen.queryByPlaceholderText("MQTT connector key")).toBeNull();
  });
});
