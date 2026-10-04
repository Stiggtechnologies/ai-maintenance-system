import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnterpriseAssetLifecycleRisk } from "./EnterpriseAssetLifecycleRisk";

const load = vi.fn();
const record = vi.fn();
const navigate = vi.fn();

vi.mock("../services/enterpriseAssetLifecycleRiskService", () => ({
  getEnterpriseAssetLifecycleRisk: () => load(),
  recordInitialAssetLifecycleState: (...args: unknown[]) => record(...args),
}));
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return { ...actual, useNavigate: () => navigate };
});

const position = {
  detailAccess: false,
  detailRestriction: "Aggregate lifecycle-risk posture only for this role.",
  index: {
    indexComputable: false,
    value: null,
    unit: "score" as const,
    formula: "Mean of each asset maximum.",
    basis:
      "No enterprise index is published until coverage and comparability are complete.",
    criteriaProfile: null,
  },
  coverage: {
    assets: 4,
    assetsWithoutCurrentLifecycle: 1,
    assetsWithoutCurrentRisk: 2,
    openRiskRecords: 2,
    contractedRiskRecords: 1,
    incompleteRiskRecords: 1,
    staleOrUndatedRiskRecords: 0,
    distinctCriteriaProfiles: 1,
    assetsWithVerifiedCondition: 2,
    assetsWithCurrentEconomics: 1,
    assetsWithLifecycleEvaluation: 1,
  },
  evidenceGaps: ["2 asset(s) have no complete current risk assessment."],
  riskLevels: [{ level: "High" as const, records: 1 }],
  lifecycleStages: [
    {
      stageKey: "operation",
      stageLabel: "Operation",
      phase: "in_service",
      assets: 3,
      assetsWithCurrentRisk: 1,
    },
  ],
  assets: [],
  basis: "Canonical evidence only.",
  decisionBoundary: "This posture does not accept risk or authorize work.",
  initialStateSetup: {
    canRecord: false,
    requiredAal: "aal2" as const,
    assets: [],
    stages: [],
    evidence: [],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  load.mockResolvedValue(position);
});

describe("EnterpriseAssetLifecycleRisk", () => {
  it("withholds an unqualified index and names the gaps", async () => {
    render(<EnterpriseAssetLifecycleRisk />);
    expect(await screen.findByText("Asset lifecycle risk")).toBeVisible();
    expect(screen.getByText("No enterprise index is published")).toBeVisible();
    expect(
      screen.getByText(/2 asset\(s\) have no complete current risk/i),
    ).toBeVisible();
    expect(screen.getByText("3 / 4")).toBeVisible();
    expect(screen.getByText("2 / 4")).toBeVisible();
  });

  it("routes people to the canonical authoring workspaces", async () => {
    render(<EnterpriseAssetLifecycleRisk />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Open risk workspace/i }),
    );
    expect(navigate).toHaveBeenCalledWith("/risk");
    fireEvent.click(
      screen.getByRole("button", { name: /Open lifecycle decisions/i }),
    );
    expect(navigate).toHaveBeenCalledWith("/lifecycle/decisions");
  });

  it("shows exact assets only when the server grants detail access", async () => {
    load.mockResolvedValue({
      ...position,
      detailAccess: true,
      detailRestriction: null,
      assets: [
        {
          id: "asset-1",
          name: "Pump P-101",
          tag: "P-101",
          siteId: "site-1",
          siteName: "North plant",
          assetClass: "pump",
          criticality: "high",
          lifecycleStatus: "active",
          lifecycle: {
            stageKey: "operation",
            stageLabel: "Operation",
            phase: "in_service",
            enteredAt: "2026-01-01T00:00:00Z",
            expectedExit: null,
            inherited: false,
          },
          assetRiskScore: 72,
          conditionKnowledgeState: "known",
          condition: null,
          economics: null,
          latestLifecycleEvaluation: null,
          currentRiskRecords: [],
          restrictedRiskRecords: 1,
          evidenceGaps: ["governed economic evidence missing"],
        },
      ],
    });
    render(<EnterpriseAssetLifecycleRisk />);
    expect(await screen.findByText("Pump P-101")).toBeVisible();
    expect(screen.getByText("1 restricted record")).toBeVisible();
  });

  it("records a missing initial stage only with asset-specific evidence", async () => {
    record.mockResolvedValue(undefined);
    load.mockResolvedValue({
      ...position,
      initialStateSetup: {
        canRecord: true,
        requiredAal: "aal2",
        assets: [{ id: "asset-1", name: "Pump P-101", tag: "P-101" }],
        stages: [
          {
            stageKey: "operation",
            label: "Operation",
            phase: "in_service",
            decisionOwned: "Is it inside its design envelope?",
          },
        ],
        evidence: [
          {
            id: "evidence-1",
            assetId: "asset-1",
            description: "Verified commissioning dossier",
            sourceSystem: "DMS",
            evidenceClass: "DOCUMENTED",
            verifiedAt: "2026-10-01T00:00:00Z",
          },
        ],
      },
    });
    render(<EnterpriseAssetLifecycleRisk />);
    fireEvent.change(await screen.findByLabelText(/Asset without/i), {
      target: { value: "asset-1" },
    });
    fireEvent.change(screen.getByLabelText(/Canonical lifecycle stage/i), {
      target: { value: "operation" },
    });
    fireEvent.change(
      screen.getByLabelText(/Independently verified evidence/i),
      {
        target: { value: "evidence-1" },
      },
    );
    fireEvent.change(screen.getByLabelText(/Lifecycle basis/i), {
      target: {
        value: "Verified commissioning dossier establishes current operation.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Record initial lifecycle state/i }),
    );
    expect(record).toHaveBeenCalledWith({
      assetId: "asset-1",
      stageKey: "operation",
      evidenceItemId: "evidence-1",
      basis: "Verified commissioning dossier establishes current operation.",
    });
    expect(
      await screen.findByText(/Initial canonical lifecycle state recorded/i),
    ).toBeVisible();
  });
});
