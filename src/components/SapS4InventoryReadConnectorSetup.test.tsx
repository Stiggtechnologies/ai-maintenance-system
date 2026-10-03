import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SapS4InventoryReadConnectorSetup } from "./SapS4InventoryReadConnectorSetup";

const auth = vi.hoisted(() => ({ role: "admin" }));
const actions = vi.hoisted(() => ({ configure: vi.fn(), pull: vi.fn() }));
const listSites = vi.hoisted(() => vi.fn());

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role: auth.role } }),
}));
vi.mock("../services/sapS4InventoryRead", () => ({
  sapS4InventoryReadActions: actions,
}));
vi.mock("../services/reliabilityCallers", () => ({ listSites }));

beforeEach(() => {
  auth.role = "admin";
  listSites
    .mockReset()
    .mockResolvedValue([{ id: "site-1", name: "North Plant" }]);
  actions.configure.mockReset().mockResolvedValue({ note: "saved" });
  actions.pull.mockReset().mockResolvedValue({
    raw_rows: 4,
    mapped_rows: 3,
    pages: 1,
    status: "success",
  });
});

describe("SAP S/4HANA inventory connector setup", () => {
  it("records the exact plant, storage location and tenant site mapping", async () => {
    const onConfigured = vi.fn().mockResolvedValue(undefined);
    render(<SapS4InventoryReadConnectorSetup onConfigured={onConfigured} />);
    await screen.findByRole("option", { name: "North Plant" });
    fireEvent.change(
      screen.getByPlaceholderText("SAP inventory connector key"),
      {
        target: { value: "north-sap-stock" },
      },
    );
    fireEvent.change(
      screen.getByPlaceholderText("SAP inventory display name"),
      {
        target: { value: "North SAP Stock" },
      },
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        "https://sap.example.com/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV",
      ),
      {
        target: {
          value:
            "https://north.example.com/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV",
        },
      },
    );
    fireEvent.change(screen.getByLabelText("SAP Plant"), {
      target: { value: "1000" },
    });
    fireEvent.change(screen.getByLabelText("SAP StorageLocation"), {
      target: { value: "0001" },
    });
    fireEvent.change(screen.getByLabelText("Canonical inventory site"), {
      target: { value: "site-1" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("vault://tenant/sap-s4-inventory"),
      { target: { value: "vault://north/sap-s4-inventory" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        "Activation authority and exact SAP plant/storage-to-site mapping basis (20+ characters)",
      ),
      {
        target: {
          value:
            "The inventory manager approved Plant 1000 storage 0001 as the North Plant source.",
        },
      },
    );
    fireEvent.click(
      screen.getByLabelText(/Enable only after the exact SAP host/i),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save and enable" }));

    await waitFor(() => expect(actions.configure).toHaveBeenCalledTimes(1));
    expect(actions.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "north-sap-stock",
        plant: "1000",
        storageLocation: "0001",
        siteId: "site-1",
        maxRows: 25000,
        pageSize: 1000,
        maxPages: 50,
        enabled: true,
      }),
    );
    expect(onConfigured).toHaveBeenCalledTimes(1);
  });

  it("does not expose configuration to non-administrators", () => {
    auth.role = "inventory_manager";
    render(<SapS4InventoryReadConnectorSetup onConfigured={vi.fn()} />);
    expect(
      screen.getByText(
        "An administrator must configure or enable this source.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("SAP inventory connector key"),
    ).toBeNull();
  });
});
