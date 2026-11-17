import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IgnitionScadaReadConnectorSetup } from "./IgnitionScadaReadConnectorSetup";

const auth = vi.hoisted(() => ({ role: "admin" }));
const actions = vi.hoisted(() => ({ configure: vi.fn(), pull: vi.fn() }));

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role: auth.role } }),
}));
vi.mock("../services/ignitionScadaRead", () => ({
  ignitionScadaReadActions: actions,
}));

beforeEach(() => {
  auth.role = "admin";
  actions.configure.mockReset().mockResolvedValue({ note: "saved" });
  actions.pull.mockReset().mockResolvedValue({
    raw_rows: 2,
    pages: 2,
    status: "success",
    records_rejected: 0,
    tags: [
      { path: "[default]Plant/Temperature", value: 72.5, quality: "Good" },
    ],
  });
});

describe("Ignition SCADA connector setup", () => {
  it("records the WebDev resource and the explicit tag list", async () => {
    const onConfigured = vi.fn().mockResolvedValue(undefined);
    render(<IgnitionScadaReadConnectorSetup onConfigured={onConfigured} />);
    fireEvent.change(screen.getByPlaceholderText("Ignition connector key"), {
      target: { value: "north-ignition" },
    });
    fireEvent.change(screen.getByPlaceholderText("Ignition display name"), {
      target: { value: "North Ignition" },
    });
    fireEvent.change(screen.getByLabelText("Ignition WebDev resource URL"), {
      target: {
        value: "https://gateway.example.com/system/webdev/Plant/tags/read",
      },
    });
    fireEvent.change(screen.getByLabelText("Ignition tag paths"), {
      target: {
        value: "[default]Plant/Temperature\n[default]Plant/Pressure",
      },
    });
    fireEvent.change(
      screen.getByPlaceholderText("vault://tenant/ignition-scada"),
      {
        target: { value: "vault://north/ignition-scada" },
      },
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        "Activation authority and exact tag-list basis (20+ characters)",
      ),
      {
        target: {
          value:
            "Operations approved these two Ignition tags as the North read list.",
        },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Save disabled configuration/ }),
    );
    await waitFor(() => expect(screen.getByText("saved")).toBeTruthy());
    expect(actions.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "north-ignition",
        resourceUrl:
          "https://gateway.example.com/system/webdev/Plant/tags/read",
        tagPaths: ["[default]Plant/Temperature", "[default]Plant/Pressure"],
        enabled: false,
      }),
    );
  });

  it("does not offer configuration to a non-administrator", () => {
    auth.role = "reliability_engineer";
    render(<IgnitionScadaReadConnectorSetup onConfigured={vi.fn()} />);
    expect(screen.getByText(/administrator must configure/i)).toBeTruthy();
    expect(screen.queryByPlaceholderText("Ignition connector key")).toBeNull();
  });

  it("keeps the read disabled until the source is enabled", () => {
    render(<IgnitionScadaReadConnectorSetup onConfigured={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Dry-run tag read" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Read tag snapshot" }),
    ).toBeDisabled();
  });
});
