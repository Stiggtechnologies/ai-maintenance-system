import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listAssetServiceLevels,
  listServiceLevelAssets,
  listServiceLevelEvidence,
  recordAssetServiceLevel,
  verifyAssetServiceLevel,
} from "../services/assetServiceLevelService";
import { ServiceLevelGovernancePanel } from "./ServiceLevelGovernancePanel";

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role: "reliability_engineer" } }),
}));

vi.mock("../services/assetServiceLevelService", () => ({
  listAssetServiceLevels: vi.fn(),
  listServiceLevelAssets: vi.fn(),
  listServiceLevelEvidence: vi.fn(),
  recordAssetServiceLevel: vi.fn(),
  verifyAssetServiceLevel: vi.fn(),
}));

const assetId = "11111111-1111-4111-8111-111111111111";
const evidenceId = "22222222-2222-4222-8222-222222222222";

const draft = {
  asset_id: assetId,
  service_name: "Process water delivery",
  beneficiary: "Operating plant",
  tolerable_downtime_hours: null,
  consequence_class: "production" as const,
  restoration_rank: null,
  notes: "Loss stops wash-plant production; time tolerance remains unknown.",
  basis: "Verified operating narrative; no approved tolerance is available.",
  evidence_item_id: evidenceId,
  status: "draft" as const,
  version: 1,
  recorded_by: "33333333-3333-4333-8333-333333333333",
  reviewed_by: null,
  reviewed_at: null,
  review_note: null,
  updated_at: "2026-10-03T00:00:00Z",
};

describe("ServiceLevelGovernancePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listServiceLevelAssets).mockResolvedValue([
      { id: assetId, tag: "PW-101", name: "Process water pump" },
    ]);
    vi.mocked(listServiceLevelEvidence).mockResolvedValue([
      {
        id: evidenceId,
        asset_id: assetId,
        description: "Verified process service narrative",
        source_system: "operations-manual",
        evidence_class: "DOCUMENTED",
      },
    ]);
    vi.mocked(recordAssetServiceLevel).mockResolvedValue({ status: "draft" });
    vi.mocked(verifyAssetServiceLevel).mockResolvedValue({
      status: "verified",
    });
  });

  it("records a draft while preserving unknown tolerance and restoration rank", async () => {
    vi.mocked(listAssetServiceLevels).mockResolvedValue([]);
    const onChanged = vi.fn();
    render(<ServiceLevelGovernancePanel onChanged={onChanged} />);

    await screen.findByRole("option", { name: /PW-101/ });
    fireEvent.change(screen.getByLabelText("Service name"), {
      target: { value: "Process water delivery" },
    });
    fireEvent.change(screen.getByLabelText("Beneficiary"), {
      target: { value: "Operating plant" },
    });
    fireEvent.change(screen.getByLabelText("Consequence notes"), {
      target: {
        value:
          "Loss stops wash-plant production; time tolerance remains unknown.",
      },
    });
    fireEvent.change(screen.getByLabelText("Evidence basis"), {
      target: {
        value:
          "Verified operating narrative; no approved tolerance is available.",
      },
    });
    fireEvent.change(await screen.findByLabelText("Verified evidence"), {
      target: { value: evidenceId },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Record draft service consequence",
      }),
    );

    await waitFor(() =>
      expect(recordAssetServiceLevel).toHaveBeenCalledWith({
        assetId,
        serviceName: "Process water delivery",
        beneficiary: "Operating plant",
        tolerableDowntimeHours: null,
        consequenceClass: "production",
        restorationRank: null,
        notes:
          "Loss stops wash-plant production; time tolerance remains unknown.",
        basis:
          "Verified operating narrative; no approved tolerance is available.",
        evidenceItemId: evidenceId,
        expectedVersion: 0,
      }),
    );
    expect(onChanged).toHaveBeenCalled();
    expect(
      screen.getByText(/remains outside cascade and restoration analysis/i),
    ).toBeInTheDocument();
  });

  it("sends the exact current version for independent verification", async () => {
    vi.mocked(listAssetServiceLevels).mockResolvedValue([draft]);
    const onChanged = vi.fn();
    render(<ServiceLevelGovernancePanel onChanged={onChanged} />);

    expect(
      await screen.findByText(
        /excluded from analysis pending independent verification/i,
      ),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Independent review note"), {
      target: {
        value:
          "Independent operations review confirms the stated service and preserves both unknown values.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Verify current version" }),
    );

    await waitFor(() =>
      expect(verifyAssetServiceLevel).toHaveBeenCalledWith(
        assetId,
        1,
        "Independent operations review confirms the stated service and preserves both unknown values.",
      ),
    );
    expect(onChanged).toHaveBeenCalled();
    expect(
      screen.getByText(
        /does not authorize work, operation, risk acceptance or restoration/i,
      ),
    ).toBeInTheDocument();
  });
});
