import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetEconomicsAdministration } from "./AssetEconomicsAdministration";

const getWorkspace = vi.fn();
const recordEconomics = vi.fn();

vi.mock("../services/assetEconomicsService", () => ({
  getAssetEconomicsWorkspace: (...args: unknown[]) => getWorkspace(...args),
  recordAssetEconomics: (...args: unknown[]) => recordEconomics(...args),
}));

const workspace = {
  assets: [
    {
      id: "asset-1",
      name: "Process pump P-101",
      assetClass: "pump",
      criticality: "high",
    },
  ],
  economics: [
    {
      id: "economics-1",
      scope: "asset" as const,
      assetId: "asset-1",
      assetName: "Process pump P-101",
      assetClass: null,
      replacementValueUsd: 1_000_000,
      annualMaintenanceCostUsd: 90_000,
      downtimeCostPerHourUsd: null,
      expectedRepairCostUsd: 60_000,
      expectedRepairHours: 30,
      expectedRemainingLifeYears: 8,
      currency: "USD" as const,
      basis: "Approved lifecycle estimate with current asset-ledger evidence.",
      sourceSystem: "ERP-2026",
      evidenceItemId: "evidence-1",
      evidenceDescription: "Verified replacement estimate",
      evidenceVerifiedBy: "reviewer-1",
      evidenceVerifiedAt: "2026-09-01T00:00:00Z",
      effectiveFrom: "2026-09-01",
      reviewDue: "2027-09-01",
      version: 1,
      updatedBy: "writer-1",
      updatedAt: "2026-09-01T00:00:00Z",
    },
  ],
  verifiedEvidence: [
    {
      id: "evidence-1",
      description: "Verified replacement estimate",
      sourceSystem: "ERP-2026",
      assetId: "asset-1",
      verifiedBy: "reviewer-1",
      verifiedAt: "2026-09-01T00:00:00Z",
    },
  ],
  coverage: {
    assets: 1,
    assetsWithEconomics: 1,
    assetsWithCompleteEconomics: 0,
    snapshots: 1,
    overdueReviews: 0,
  },
  capitalPlans: [
    {
      planYear: 2027,
      itemCount: 2,
      mandatoryCount: 1,
      governedCandidateCount: 1,
      currency: "CAD",
      currencySpecified: true,
      totalCost: 2_000_000,
    },
    {
      planYear: 2027,
      itemCount: 1,
      mandatoryCount: 0,
      governedCandidateCount: 0,
      currency: null,
      currencySpecified: false,
      totalCost: null,
    },
  ],
  currency: "USD" as const,
  basis: "Explicit evidence only.",
  decisionBoundary:
    "Recording economics does not authorize expenditure or release work.",
};

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspace.mockResolvedValue(workspace);
  recordEconomics.mockResolvedValue({
    assetEconomicsId: "economics-1",
    version: 2,
    scope: "asset",
    currency: "USD",
    status: "recorded",
    expenditureAuthorized: false,
    projectSanctioned: false,
    workAuthorized: false,
    riskAccepted: false,
    returnToServiceAuthorized: false,
  });
});

describe("AssetEconomicsAdministration", () => {
  it("shows honest coverage, explicit unknowns and the canonical capital-plan route", async () => {
    render(
      <MemoryRouter>
        <AssetEconomicsAdministration canEdit={false} />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText("Asset economics and lifecycle capital plans"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Downtime Unknown/)).toBeInTheDocument();
    expect(screen.getByText(/2027 · CAD: 2 item/)).toHaveTextContent(
      /2,000,000 CAD total recorded cost/,
    );
    expect(screen.getByText(/2027 · currency unspecified/)).toHaveTextContent(
      /total withheld because currency is not recorded/,
    );
    expect(
      screen.getByRole("link", { name: /open governed capital planning/i }),
    ).toHaveAttribute("href", "/develop/portfolio");
    expect(
      screen.queryByRole("button", { name: /record economics/i }),
    ).not.toBeInTheDocument();
  });

  it("records a versioned snapshot and verifies the no-authority envelope", async () => {
    render(
      <MemoryRouter>
        <AssetEconomicsAdministration canEdit />
      </MemoryRouter>,
    );
    await screen.findByText("Asset economics and lifecycle capital plans");
    fireEvent.change(screen.getByLabelText("Asset"), {
      target: { value: "asset-1" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Record version 2" }),
    );
    await waitFor(() =>
      expect(recordEconomics).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: "asset-1",
          assetClass: null,
          replacementValueUsd: 1_000_000,
          downtimeCostPerHourUsd: null,
          evidenceItemId: "evidence-1",
          expectedVersion: 1,
        }),
      ),
    );
    expect(
      await screen.findByText(
        /no expenditure, project, work, risk or return-to-service authority/i,
      ),
    ).toBeInTheDocument();
  });
});
