import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafetyCriticalRegulatoryRegister } from "./SafetyCriticalRegulatoryRegister";

const getWorkspace = vi.fn();
const recordElement = vi.fn();
const linkObligation = vi.fn();

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role: "admin" } }),
}));
vi.mock("../services/safetyCriticalRegulatoryService", () => ({
  getSafetyCriticalRegulatoryWorkspace: (...args: unknown[]) =>
    getWorkspace(...args),
  recordSafetyCriticalElement: (...args: unknown[]) => recordElement(...args),
  linkSafetyCriticalRegulatoryObligation: (...args: unknown[]) =>
    linkObligation(...args),
}));

const workspace = {
  elements: [
    {
      id: 7,
      assetId: "asset-1",
      assetName: "Process pump P-101",
      reference: "SCE-P-101",
      label: "Emergency shutdown valve",
      barrierKind: "mechanical" as const,
      barrierRole: "preventive" as const,
      performanceStandard:
        "Close within five seconds and retain leak-tight isolation.",
      testIntervalMonths: 12,
      lastTestedOn: "2025-01-01",
      testStatus: "overdue" as const,
      evidenceItemId: "evidence-1",
      evidenceDescription: "Verified barrier performance standard",
      evidenceVerifiedBy: "reviewer-1",
      evidenceVerifiedAt: "2026-07-01T00:00:00Z",
      effectiveFrom: "2026-07-01",
      reviewDue: "2027-07-01",
      version: 2,
      updatedBy: "writer-1",
      updatedAt: "2026-07-01T00:00:00Z",
    },
  ],
  regulatoryRequirements: [
    {
      layerId: "layer-1",
      layerVersion: 4,
      layerTitle: "Alberta pressure requirements",
      jurisdiction: "Alberta",
      key: "pressure_shutdown_test",
      title: "Pressure shutdown functional test",
      domain: "pressure_regulation",
      requirementClass: "regulatory" as const,
      applicability: "applicable" as const,
      obligation: "mandatory" as const,
      authorityReference: "AB-PR-101",
      applicabilityBasis: "Registered pressure equipment is in scope.",
      mandatoryBasis: "The regulation requires the functional test.",
    },
    {
      layerId: "layer-1",
      layerVersion: 4,
      layerTitle: "Alberta pressure requirements",
      jurisdiction: "Alberta",
      key: "inspection_retention_review",
      title: "Inspection record retention applicability",
      domain: "retention",
      requirementClass: "regulatory" as const,
      applicability: "undetermined" as const,
      obligation: "advisory" as const,
      authorityReference: "AB-RET-20",
      applicabilityBasis: "Named legal review remains outstanding.",
      mandatoryBasis: null,
    },
  ],
  bindings: [
    {
      id: "binding-1",
      elementId: 7,
      elementVersion: 1,
      currentElementVersion: 2,
      layerId: "layer-1",
      layerVersion: 4,
      requirementKey: "pressure_shutdown_test",
      evidenceItemId: "evidence-1",
      evidenceDescription: "Verified barrier performance standard",
      basis: "Exact obligation applicability review.",
      linkedBy: "writer-1",
      linkedAt: "2026-07-01T00:00:00Z",
      current: false,
    },
  ],
  verifiedEvidence: [
    {
      id: "evidence-1",
      description: "Verified barrier performance standard",
      sourceSystem: "PSM register",
      assetId: "asset-1",
      verifiedBy: "reviewer-1",
      verifiedAt: "2026-07-01T00:00:00Z",
    },
    {
      id: "evidence-org",
      description: "Verified jurisdiction applicability review",
      sourceSystem: "Legal register",
      assetId: null,
      verifiedBy: "reviewer-1",
      verifiedAt: "2026-07-01T00:00:00Z",
    },
  ],
  assets: [{ id: "asset-1", name: "Process pump P-101", tag: "P-101" }],
  coverage: {
    elements: 1,
    elementsWithVerifiedEvidence: 1,
    overdueOrUntested: 1,
    mandatoryRegulatoryObligations: 1,
    currentBindings: 0,
    staleBindings: 1,
  },
  jurisdiction: "Alberta",
  decisionBoundary:
    "A registered element and linked obligation are controlled evidence, not a compliance finding.",
};

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspace.mockResolvedValue(workspace);
  recordElement.mockResolvedValue({
    id: 8,
    version: 1,
    status: "recorded",
    complianceEstablished: false,
    workAuthorized: false,
    riskAccepted: false,
    operatingLimitChanged: false,
    returnToServiceAuthorized: false,
  });
  linkObligation.mockResolvedValue({
    id: "binding-2",
    status: "obligation_linked",
    elementVersion: 2,
    layerVersion: 4,
    complianceEstablished: false,
    workAuthorized: false,
    riskAccepted: false,
    operatingLimitChanged: false,
    returnToServiceAuthorized: false,
  });
});

describe("SafetyCriticalRegulatoryRegister", () => {
  it("shows evidence coverage, overdue testing and stale exact-version links", async () => {
    render(<SafetyCriticalRegulatoryRegister />);
    expect(
      await screen.findByText(
        "Safety-critical equipment and regulatory obligations",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Test status: overdue/)).toBeInTheDocument();
    expect(screen.getByText(/stale: element is now v2/)).toBeInTheDocument();
    expect(
      screen.getByText(/named legal or regulatory review remains open/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/not a compliance finding/i)).toBeInTheDocument();
  });

  it("records a new canonical element with verified evidence", async () => {
    render(<SafetyCriticalRegulatoryRegister />);
    await screen.findByText(
      "Safety-critical equipment and regulatory obligations",
    );
    fireEvent.change(screen.getByLabelText("Element reference"), {
      target: { value: "SCE-P-102" },
    });
    fireEvent.change(screen.getByLabelText("Element label"), {
      target: { value: "High-high pressure trip" },
    });
    fireEvent.change(
      screen.getByLabelText("Asset (optional for non-equipment barriers)"),
      { target: { value: "asset-1" } },
    );
    fireEvent.change(screen.getByLabelText("Testable performance standard"), {
      target: {
        value: "Trip before the approved high-high pressure limit is exceeded.",
      },
    });
    fireEvent.change(screen.getByLabelText("Independently verified evidence"), {
      target: { value: "evidence-1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record safety-critical element" }),
    );
    await waitFor(() =>
      expect(recordElement).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: "asset-1",
          reference: "SCE-P-102",
          evidenceItemId: "evidence-1",
          expectedVersion: 0,
        }),
      ),
    );
    expect(
      await screen.findByText(/no compliance or operational authority/i),
    ).toBeInTheDocument();
  });

  it("links the exact element and adopted requirement versions", async () => {
    render(<SafetyCriticalRegulatoryRegister />);
    await screen.findByText(
      "Safety-critical equipment and regulatory obligations",
    );
    fireEvent.change(screen.getByLabelText("Evidence-backed element"), {
      target: { value: "7" },
    });
    fireEvent.change(
      screen.getByLabelText("Applicable mandatory requirement"),
      { target: { value: "layer-1::pressure_shutdown_test" } },
    );
    fireEvent.change(
      screen.getByLabelText("Independently verified linkage evidence"),
      { target: { value: "evidence-1" } },
    );
    fireEvent.change(screen.getByLabelText("Applicability basis"), {
      target: {
        value:
          "The adopted pressure requirement applies to this exact shutdown barrier.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Link obligation" }));
    await waitFor(() =>
      expect(linkObligation).toHaveBeenCalledWith(
        expect.objectContaining({
          safetyCriticalElementId: 7,
          expectedElementVersion: 2,
          capabilityPackLayerId: "layer-1",
          expectedLayerVersion: 4,
          requirementKey: "pressure_shutdown_test",
          evidenceItemId: "evidence-1",
        }),
      ),
    );
    expect(
      await screen.findByText(/this is not a compliance finding/i),
    ).toBeInTheDocument();
  });
});
