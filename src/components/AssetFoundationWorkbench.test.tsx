import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetFoundationWorkbench } from "./AssetFoundationWorkbench";

const load = vi.fn();
const proposeLocation = vi.fn();
const reviewLocation = vi.fn();
const proposeFoundation = vi.fn();
const reviewFoundation = vi.fn();

vi.mock("../services/assetFoundationService", () => ({
  loadAssetFoundationWorkspace: (...args: unknown[]) => load(...args),
  proposeAssetHierarchyNode: (...args: unknown[]) => proposeLocation(...args),
  reviewAssetHierarchyNode: (...args: unknown[]) => reviewLocation(...args),
  proposeAssetFoundation: (...args: unknown[]) => proposeFoundation(...args),
  reviewAssetFoundation: (...args: unknown[]) => reviewFoundation(...args),
}));

const evidence = [
  {
    id: "evidence-hierarchy",
    description: "Verified hierarchy drawing",
    evidenceClass: "DOCUMENTED",
    assetId: null,
    verifiedBy: "reviewer",
    verifiedAt: "2026-10-04T00:00:00Z",
    verificationMethod: "drawing review",
  },
  {
    id: "evidence-criticality",
    description: "Verified consequence study",
    evidenceClass: "ANALYZED",
    assetId: "asset-1",
    verifiedBy: "reviewer",
    verifiedAt: "2026-10-04T00:00:00Z",
    verificationMethod: "risk review",
  },
  {
    id: "evidence-boundary",
    description: "Verified isolation drawing",
    evidenceClass: "INSPECTED",
    assetId: "asset-1",
    verifiedBy: "reviewer",
    verifiedAt: "2026-10-04T00:00:00Z",
    verificationMethod: "field walkdown",
  },
];

const workspace = {
  model: {
    dimensions: [
      "safety",
      "environmental",
      "production",
      "financial",
      "regulatory",
    ],
    scale: "1 negligible to 5 catastrophic",
    rule: "The highest consequence governs.",
  },
  sites: [{ id: "site-1", name: "North plant" }],
  locations: [
    {
      id: "system-1",
      siteId: "site-1",
      parentLocationId: "area-1",
      kind: "system",
      code: "NP-AREA-SYS",
      name: "Cooling water system",
      description: "Verified cooling water system boundary.",
      evidenceItemId: "evidence-hierarchy",
      status: "verified",
      createdBy: "author",
      verifiedBy: "reviewer",
      verifiedAt: "2026-10-04T00:00:00Z",
      reviewNote: "Independently checked against the site drawing.",
    },
  ],
  assets: [
    {
      id: "asset-1",
      siteId: "site-1",
      tag: "P-101",
      name: "Cooling water pump",
      criticality: "medium",
      locationId: null,
      area: null,
      system: null,
      functionalLocation: null,
      foundationVerificationId: null,
      foundationVerifiedBy: null,
      foundationVerifiedAt: null,
    },
  ],
  proposals: [],
  verifiedEvidence: evidence,
  authority: {
    namedHumanVerification: true,
    segregationOfDuties: true,
    mayChangeWork: false,
    mayApprove: false,
    mayAcceptRisk: false,
    mayCommitSpend: false,
    mayChangeOperatingLimits: false,
    mayReturnToService: false,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  load.mockResolvedValue(workspace);
  proposeLocation.mockResolvedValue({
    locationId: "area-2",
    status: "proposed",
  });
  proposeFoundation.mockResolvedValue({
    verificationId: "foundation-1",
    status: "proposed",
    revision: 1,
    criticalityClass: "critical",
  });
});

describe("AssetFoundationWorkbench", () => {
  it("explains the one governed foundation and its authority boundary", async () => {
    render(<AssetFoundationWorkbench />);
    expect(
      await screen.findByText(
        "Verified hierarchy, criticality and equipment boundary",
      ),
    ).toBeVisible();
    expect(screen.getByText(/highest of five consequences/i)).toBeVisible();
    expect(
      screen.getByText(/never creates work, approves a recommendation/i),
    ).toBeVisible();
  });

  it("proposes an evidence-backed hierarchy node", async () => {
    render(<AssetFoundationWorkbench />);
    await screen.findByText("1. Propose hierarchy node");
    fireEvent.change(screen.getByLabelText("Location code"), {
      target: { value: "NP-AREA-2" },
    });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Process area 2" },
    });
    fireEvent.change(
      screen.getByLabelText("Description and structural basis"),
      {
        target: {
          value: "Area boundary reconciled to the verified site drawing.",
        },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Propose node" }));
    await waitFor(() =>
      expect(proposeLocation).toHaveBeenCalledWith(
        expect.objectContaining({
          siteId: "site-1",
          parentLocationId: null,
          kind: "area",
          code: "NP-AREA-2",
          evidenceItemId: "evidence-hierarchy",
        }),
      ),
    );
  });

  it("submits the deterministic criticality scores and explicit boundary", async () => {
    render(<AssetFoundationWorkbench />);
    await screen.findByText("3. Propose asset criticality and boundary");
    fireEvent.change(screen.getByLabelText("Safety consequence score"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("Criticality basis"), {
      target: {
        value: "Safety consequence is catastrophic if containment is lost.",
      },
    });
    fireEvent.change(screen.getByLabelText("Boundary name"), {
      target: { value: "P-101 maintainable boundary" },
    });
    fireEvent.change(
      screen.getByLabelText("Included equipment (comma-separated)"),
      {
        target: { value: "pump casing, motor, coupling" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("Excluded equipment (comma-separated)"),
      {
        target: { value: "upstream vessel" },
      },
    );
    fireEvent.change(screen.getByLabelText("Upstream interface"), {
      target: { value: "Suction flange F-101" },
    });
    fireEvent.change(screen.getByLabelText("Downstream interface"), {
      target: { value: "Discharge flange F-102" },
    });
    fireEvent.change(
      screen.getByLabelText("Isolation points (comma-separated)"),
      {
        target: { value: "XV-101, breaker MCC-4" },
      },
    );
    fireEvent.change(screen.getByLabelText("Boundary basis"), {
      target: {
        value:
          "Field walkdown and isolation drawing define the maintainable envelope.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Propose asset foundation" }),
    );
    await waitFor(() =>
      expect(proposeFoundation).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: "asset-1",
          hierarchyLocationId: "system-1",
          scores: expect.objectContaining({ safety: 5 }),
          hierarchyEvidenceItemId: "evidence-hierarchy",
          criticalityEvidenceItemId: "evidence-criticality",
          boundaryEvidenceItemId: "evidence-boundary",
          boundary: expect.objectContaining({
            includedEquipment: ["pump casing", "motor", "coupling"],
            isolationPoints: ["XV-101", "breaker MCC-4"],
          }),
        }),
      ),
    );
  });
});
