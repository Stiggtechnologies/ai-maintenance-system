import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SapS4MaintenanceOrderReadConnectorSetup } from "./SapS4MaintenanceOrderReadConnectorSetup";

const auth = vi.hoisted(() => ({ role: "admin" }));
const actions = vi.hoisted(() => ({ configure: vi.fn(), pull: vi.fn() }));
const listSites = vi.hoisted(() => vi.fn());

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role: auth.role } }),
}));
vi.mock("../services/sapS4MaintenanceOrderRead", () => ({
  sapS4MaintenanceOrderReadActions: actions,
  parseSapMaintenancePhaseMap: (value: string) =>
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [phaseCode, status] = line.split("|").map((part) => part.trim());
        return { phaseCode, status };
      }),
}));
vi.mock("../services/reliabilityCallers", () => ({ listSites }));

beforeEach(() => {
  auth.role = "admin";
  listSites
    .mockReset()
    .mockResolvedValue([{ id: "site-1", name: "North Plant" }]);
  actions.configure.mockReset().mockResolvedValue({ note: "saved" });
  actions.pull.mockReset().mockResolvedValue({
    raw_rows: 2,
    mapped_rows: 2,
    pages: 1,
    status: "success",
    records_rejected: 0,
  });
});

describe("SAP S/4HANA maintenance order connector setup", () => {
  it("records the planning plant, site and explicit phase map", async () => {
    const onConfigured = vi.fn().mockResolvedValue(undefined);
    render(
      <SapS4MaintenanceOrderReadConnectorSetup onConfigured={onConfigured} />,
    );
    await screen.findByRole("option", { name: "North Plant" });
    fireEvent.change(
      screen.getByPlaceholderText("SAP maintenance connector key"),
      { target: { value: "north-sap-pm" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText("SAP maintenance display name"),
      { target: { value: "North SAP PM" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        "https://sap.example.com/sap/opu/odata/sap/API_MAINTENANCEORDER",
      ),
      {
        target: {
          value:
            "https://north.example.com/sap/opu/odata/sap/API_MAINTENANCEORDER",
        },
      },
    );
    fireEvent.change(screen.getByLabelText("SAP MaintenancePlanningPlant"), {
      target: { value: "1710" },
    });
    fireEvent.change(screen.getByLabelText("Canonical maintenance site"), {
      target: { value: "site-1" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("vault://tenant/sap-s4-maintenance"),
      { target: { value: "vault://north/sap-s4-maintenance" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        "Activation authority and exact SAP planning-plant-to-site mapping basis (20+ characters)",
      ),
      {
        target: {
          value:
            "The maintenance manager approved planning plant 1710 as the North Plant source.",
        },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /Save disabled/ }));
    expect(actions.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        planningPlant: "1710",
        siteId: "site-1",
        phaseMap: [{ phaseCode: "09", status: "completed" }],
        enabled: false,
      }),
    );
  });

  it("hides configuration from a non-administrator", () => {
    auth.role = "planner";
    render(<SapS4MaintenanceOrderReadConnectorSetup onConfigured={vi.fn()} />);
    expect(
      screen.getByText(/administrator must configure or enable/i),
    ).toBeInTheDocument();
  });
});
