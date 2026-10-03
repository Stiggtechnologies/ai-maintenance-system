import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SapS4FinancialReadConnectorSetup } from "./SapS4FinancialReadConnectorSetup";

const auth = vi.hoisted(() => ({ role: "admin" }));
const actions = vi.hoisted(() => ({ configure: vi.fn(), pull: vi.fn() }));
const listDevelopmentCases = vi.hoisted(() => vi.fn());
const listCaseCostItemRefs = vi.hoisted(() => vi.fn());

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role: auth.role } }),
}));
vi.mock("../services/sapS4FinancialRead", async () => {
  const actual = await vi.importActual<
    typeof import("../services/sapS4FinancialRead")
  >("../services/sapS4FinancialRead");
  return { ...actual, sapS4FinancialReadActions: actions };
});
vi.mock("../services/developService", () => ({
  listDevelopmentCases,
  listCaseCostItemRefs,
}));

beforeEach(() => {
  auth.role = "admin";
  listDevelopmentCases
    .mockReset()
    .mockResolvedValue([{ id: "case-1", title: "North Expansion" }]);
  listCaseCostItemRefs
    .mockReset()
    .mockResolvedValue([
      { ref: "CIVIL", description: "Civil works", currency: "CAD" },
    ]);
  actions.configure.mockReset().mockResolvedValue({ note: "saved" });
  actions.pull.mockReset().mockResolvedValue({
    raw_rows: 3,
    mapped_rows: 1,
    pages: 1,
    status: "success",
    missing_mappings: [],
  });
});

describe("SAP S/4 financial connector setup", () => {
  it("records an exact source scope and approved mapping", async () => {
    const onConfigured = vi.fn().mockResolvedValue(undefined);
    render(<SapS4FinancialReadConnectorSetup onConfigured={onConfigured} />);
    await screen.findByRole("option", { name: "North Expansion" });
    fireEvent.change(screen.getByPlaceholderText("SAP finance connector key"), {
      target: { value: "north-sap-gl" },
    });
    fireEvent.change(screen.getByPlaceholderText("SAP finance display name"), {
      target: { value: "North SAP Actuals" },
    });
    fireEvent.change(screen.getByPlaceholderText(/API_GLACCOUNTLINEITEM_SRV/), {
      target: {
        value:
          "https://north.example.com/sap/opu/odata/sap/API_GLACCOUNTLINEITEM_SRV",
      },
    });
    fireEvent.change(screen.getByLabelText("Development case"), {
      target: { value: "case-1" },
    });
    await screen.findByText(/CIVIL \(CAD\)/);
    fireEvent.change(screen.getByLabelText("SAP company code"), {
      target: { value: "CA01" },
    });
    fireEvent.change(screen.getByLabelText("Company-code currency"), {
      target: { value: "CAD" },
    });
    fireEvent.change(screen.getByLabelText("Cumulative posting start date"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(
      screen.getByLabelText("Approved SAP WBS and G/L mappings"),
      { target: { value: "WB0001 | 0041000000 | CIVIL" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText("vault://tenant/sap-s4-finance"),
      { target: { value: "vault://north/sap-finance" } },
    );
    fireEvent.change(screen.getByPlaceholderText(/Activation authority/), {
      target: {
        value:
          "Finance approved ledger 0L and company CA01 from project inception.",
      },
    });
    fireEvent.click(
      screen.getByLabelText(/Enable only after the exact SAP host/i),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save governed source" }),
    );

    await waitFor(() => expect(actions.configure).toHaveBeenCalledTimes(1));
    expect(actions.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "north-sap-gl",
        developmentCaseId: "case-1",
        ledger: "0L",
        companyCode: "CA01",
        currency: "CAD",
        postingStartDate: "2026-01-01",
        costMappings: [
          {
            wbsElementInternalId: "WB0001",
            glAccount: "0041000000",
            costItemRef: "CIVIL",
          },
        ],
        enabled: true,
      }),
    );
    expect(onConfigured).toHaveBeenCalled();
  });

  it("keeps configuration administrator-only", () => {
    auth.role = "planner";
    render(<SapS4FinancialReadConnectorSetup onConfigured={vi.fn()} />);
    expect(
      screen.getByText(
        "An administrator must configure or enable this source.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("SAP finance connector key"),
    ).toBeNull();
  });
});
