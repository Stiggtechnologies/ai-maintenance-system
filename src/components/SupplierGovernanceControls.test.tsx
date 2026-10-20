import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assessVendorAdvisory,
  getSupplierGovernanceWorkspace,
  recordSupplierDelivery,
  recordSuspectPartCase,
  recordVendorAdvisory,
  type SupplierGovernanceWorkspace,
} from "../services/supplierGovernanceService";
import { SupplierGovernanceControls } from "./SupplierGovernanceControls";

vi.mock("../services/supplierGovernanceService", () => ({
  assessVendorAdvisory: vi.fn(),
  getSupplierGovernanceWorkspace: vi.fn(),
  recordSupplierDelivery: vi.fn(),
  recordSuspectPartCase: vi.fn(),
  recordVendorAdvisory: vi.fn(),
}));

const workspace: SupplierGovernanceWorkspace = {
  answered: true,
  boundary: "Observed supplier evidence informs human decisions.",
  suppliers: [
    {
      id: 7,
      supplierCode: "SUP-7",
      name: "Northern Rotating Equipment",
      kind: "repair_vendor",
      approvedVendor: true,
    },
  ],
  materials: [
    { id: "material-1", materialCode: "BRG-6205", description: "Bearing" },
  ],
  evidence: [{ id: "evidence-1", description: "Verified receiving report" }],
  deliveries: [],
  suspectCases: [],
  advisories: [],
  contractPackages: [
    {
      id: 5,
      packageCode: "PKG-5",
      title: "Pump overhaul",
      developmentCaseId: "case-1",
      supplierId: 7,
      scopeComplete: true,
      scopeGaps: {},
    },
  ],
  performancePeriods: [],
  warranties: [],
};

describe("SupplierGovernanceControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSupplierGovernanceWorkspace).mockResolvedValue(workspace);
    for (const action of [
      assessVendorAdvisory,
      recordSupplierDelivery,
      recordSuspectPartCase,
      recordVendorAdvisory,
    ]) {
      vi.mocked(action).mockResolvedValue({ answered: true, note: "Recorded" });
    }
  });

  async function open() {
    render(
      <MemoryRouter>
        <SupplierGovernanceControls />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Supplier & contractor governance"));
    await screen.findByRole("button", { name: "Record delivery" });
  }

  it("records an immutable delivery event against verified evidence", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Delivery reference"), {
      target: { value: "RCV-1042" },
    });
    fireEvent.change(screen.getByLabelText("Delivery supplier"), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByLabelText("Delivery material"), {
      target: { value: "material-1" },
    });
    fireEvent.change(screen.getByLabelText("Ordered on"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.change(screen.getByLabelText("Promised on"), {
      target: { value: "2026-09-15" },
    });
    fireEvent.change(screen.getByLabelText("Received on"), {
      target: { value: "2026-09-16" },
    });
    fireEvent.change(screen.getByLabelText("Delivery evidence basis"), {
      target: { value: "Receiving inspection and signed packing record." },
    });
    fireEvent.change(screen.getByLabelText("Delivery evidence"), {
      target: { value: "evidence-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record delivery" }));
    await waitFor(() =>
      expect(recordSupplierDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryReference: "RCV-1042",
          supplierId: "7",
          materialId: "material-1",
          promisedOn: "2026-09-15",
          receivedOn: "2026-09-16",
          evidenceItemId: "evidence-1",
        }),
      ),
    );
  });

  it("opens a suspect-part case quarantined rather than declaring counterfeit", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Suspect-part case reference"), {
      target: { value: "SP-2026-14" },
    });
    fireEvent.change(screen.getByLabelText("Suspect-part material"), {
      target: { value: "material-1" },
    });
    fireEvent.change(screen.getByLabelText("Suspect-part detection date"), {
      target: { value: "2026-09-20" },
    });
    fireEvent.change(screen.getByLabelText("Suspect-part evidence basis"), {
      target: {
        value: "Receiving inspection found inconsistent trace markings.",
      },
    });
    fireEvent.change(screen.getByLabelText("Suspect-part evidence"), {
      target: { value: "evidence-1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Open quarantined case" }),
    );
    await waitFor(() =>
      expect(recordSuspectPartCase).toHaveBeenCalledWith(
        expect.objectContaining({
          caseReference: "SP-2026-14",
          status: "open",
          quarantined: true,
          evidenceItemId: "evidence-1",
        }),
      ),
    );
  });

  it("records the vendor source as unassessed before any human disposition", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Advisory reference"), {
      target: { value: "SB-2026-09" },
    });
    fireEvent.change(screen.getByLabelText("Advisory supplier"), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByLabelText("Advisory issued on"), {
      target: { value: "2026-09-10" },
    });
    fireEvent.change(screen.getByLabelText("Advisory title"), {
      target: { value: "Bearing cage inspection bulletin" },
    });
    fireEvent.change(screen.getByLabelText("Advisory model"), {
      target: { value: "NR-400" },
    });
    fireEvent.change(screen.getByLabelText("Advisory source basis"), {
      target: { value: "Verified original bulletin received from the vendor." },
    });
    fireEvent.change(screen.getByLabelText("Advisory evidence"), {
      target: { value: "evidence-1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record unassessed advisory" }),
    );
    await waitFor(() =>
      expect(recordVendorAdvisory).toHaveBeenCalledWith(
        expect.objectContaining({
          advisoryReference: "SB-2026-09",
          supplierId: "7",
          appliesToModel: "NR-400",
          evidenceItemId: "evidence-1",
        }),
      ),
    );
  });
});
