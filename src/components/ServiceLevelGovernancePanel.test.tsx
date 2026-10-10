import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listAssetServiceLevels,
  listServiceLevelAssets,
  listServiceLevelEvidence,
  listServiceLevelHistory,
  recordAssetServiceLevel,
  verifyAssetServiceLevel,
  reconcileAssetServiceLevelCommand,
} from "../services/assetServiceLevelService";
import { ServiceLevelGovernancePanel } from "./ServiceLevelGovernancePanel";

const auth = vi.hoisted(() => ({
  user: { id: "33333333-3333-4333-8333-333333333333" } as { id: string } | null,
  profile: {
    id: "33333333-3333-4333-8333-333333333333",
    organization_id: "44444444-4444-4444-8444-444444444444",
    role: "reliability_engineer",
  } as { id: string; organization_id: string; role: string } | null,
}));
vi.mock("./AuthProvider", () => ({ useAuth: () => auth }));

vi.mock("../services/assetServiceLevelService", () => ({
  listAssetServiceLevels: vi.fn(),
  listServiceLevelAssets: vi.fn(),
  listServiceLevelEvidence: vi.fn(),
  listServiceLevelHistory: vi.fn(),
  recordAssetServiceLevel: vi.fn(),
  verifyAssetServiceLevel: vi.fn(),
  reconcileAssetServiceLevelCommand: vi.fn(),
  ServiceLevelRefusal: class ServiceLevelRefusal extends Error {},
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
  analysis_eligible: false,
};

describe("ServiceLevelGovernancePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = { id: "33333333-3333-4333-8333-333333333333" };
    auth.profile = {
      id: auth.user.id,
      organization_id: "44444444-4444-4444-8444-444444444444",
      role: "reliability_engineer",
    };
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
    vi.mocked(listServiceLevelHistory).mockResolvedValue([]);
    vi.mocked(recordAssetServiceLevel).mockResolvedValue({ status: "draft" });
    vi.mocked(verifyAssetServiceLevel).mockResolvedValue({
      status: "verified",
    });
    vi.mocked(reconcileAssetServiceLevelCommand).mockResolvedValue({
      outcome: "committed",
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
      expect(recordAssetServiceLevel).toHaveBeenCalledWith(expect.objectContaining({
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
        observedActorId: auth.user!.id,
        observedOrganizationId: auth.profile!.organization_id,
      })),
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
        expect.any(String),
        { actorId: auth.user!.id, organizationId: auth.profile!.organization_id },
      ),
    );
    expect(onChanged).toHaveBeenCalled();
    expect(
      screen.getByText(
        /does not authorize work, operation, risk acceptance or restoration/i,
      ),
    ).toBeInTheDocument();
  });

  it("clears unsaved engineering input when switching between two assets without rows", async () => {
    const secondAsset = "11111111-1111-4111-8111-111111111112";
    vi.mocked(listServiceLevelAssets).mockResolvedValue([
      { id: assetId, tag: "PW-101", name: "Process water pump" },
      { id: secondAsset, tag: "PW-102", name: "Backup pump" },
    ]);
    vi.mocked(listAssetServiceLevels).mockResolvedValue([]);
    render(<ServiceLevelGovernancePanel onChanged={vi.fn()} />);
    await screen.findByRole("option", { name: /PW-102/ });
    fireEvent.change(screen.getByLabelText("Service name"), {
      target: { value: "Unsaved service for first asset" },
    });
    fireEvent.change(screen.getByLabelText("Asset"), { target: { value: secondAsset } });
    await waitFor(() => expect(screen.getByLabelText("Service name")).toHaveValue(""));
  });

  it("discards deferred evidence from the previously selected asset", async () => {
    const secondAsset = "11111111-1111-4111-8111-111111111112";
    let release!: (value: Awaited<ReturnType<typeof listServiceLevelEvidence>>) => void;
    vi.mocked(listServiceLevelAssets).mockResolvedValue([
      { id: assetId, tag: "PW-101", name: "Process water pump" },
      { id: secondAsset, tag: "PW-102", name: "Backup pump" },
    ]);
    vi.mocked(listAssetServiceLevels).mockResolvedValue([]);
    vi.mocked(listServiceLevelEvidence).mockImplementation((id) =>
      id === assetId ? new Promise(resolve => { release = resolve; }) : Promise.resolve([]),
    );
    render(<ServiceLevelGovernancePanel onChanged={vi.fn()} />);
    await waitFor(() => expect(release).toBeDefined());
    fireEvent.change(screen.getByLabelText("Asset"), { target: { value: secondAsset } });
    await waitFor(() => expect(listServiceLevelEvidence).toHaveBeenCalledWith(secondAsset, { actorId: auth.user!.id, organizationId: auth.profile!.organization_id }));
    await act(async () => release([{ id: evidenceId, asset_id: assetId, description: "Wrong asset deferred evidence", source_system: "manual", evidence_class: "DOCUMENTED" }]));
    expect(screen.queryByRole("option", { name: "Wrong asset deferred evidence" })).not.toBeInTheDocument();
  });

  it("discards deferred workspace rows after the observed actor signs out", async () => {
    let release!: (value: Awaited<ReturnType<typeof listServiceLevelAssets>>) => void;
    vi.mocked(listServiceLevelAssets).mockReturnValue(new Promise(resolve => { release = resolve; }));
    vi.mocked(listAssetServiceLevels).mockResolvedValue([]);
    const view = render(<ServiceLevelGovernancePanel onChanged={vi.fn()} />);
    auth.user = null;
    auth.profile = null;
    view.rerender(<ServiceLevelGovernancePanel onChanged={vi.fn()} />);
    await act(async () => release([{ id: assetId, tag: "SECRET", name: "Previous actor asset" }]));
    expect(screen.queryByRole("option", { name: /SECRET/ })).not.toBeInTheDocument();
  });

  it("treats a lost write acknowledgement as unknown and reconciles read-only without replay", async () => {
    vi.mocked(listAssetServiceLevels).mockResolvedValue([draft]);
    vi.mocked(verifyAssetServiceLevel).mockRejectedValueOnce(new Error("Connection lost after submission"));
    render(<ServiceLevelGovernancePanel onChanged={vi.fn()} />);
    await screen.findByText(/excluded from analysis pending independent verification/i);
    fireEvent.change(screen.getByLabelText("Independent review note"), {
      target: { value: "Independent review against the exact current draft basis." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify current version" }));
    await screen.findByText(/outcome is unknown/i);
    expect(screen.getByRole("button", { name: "Verify current version" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reconcile submission" }));
    await waitFor(() => expect(reconcileAssetServiceLevelCommand).toHaveBeenCalledTimes(1));
    expect(verifyAssetServiceLevel).toHaveBeenCalledTimes(1);
    expect(recordAssetServiceLevel).not.toHaveBeenCalled();
  });

  it("does not notify the new workspace when an old successful verification's refresh finishes", async () => {
    vi.mocked(listAssetServiceLevels).mockResolvedValue([draft]);
    const onChanged = vi.fn();
    const view = render(<ServiceLevelGovernancePanel onChanged={onChanged} />);
    await screen.findByText(/excluded from analysis pending independent verification/i);
    let release!: (value: Awaited<ReturnType<typeof listServiceLevelAssets>>) => void;
    vi.mocked(listServiceLevelAssets).mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    fireEvent.change(screen.getByLabelText("Independent review note"), { target: { value: "Independent operations review against exact draft." } });
    fireEvent.click(screen.getByRole("button", { name: "Verify current version" }));
    await waitFor(() => expect(release).toBeDefined());
    auth.profile = { ...auth.profile!, organization_id: "44444444-4444-4444-8444-444444444445" };
    view.rerender(<ServiceLevelGovernancePanel onChanged={onChanged} />);
    await act(async () => release([{ id: assetId, tag: "OLD", name: "Old workspace asset" }]));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.queryByRole("option", { name: /OLD/ })).not.toBeInTheDocument();
  });

  it("retains a known committed receipt rather than calling a refresh failure an unknown write", async () => {
    vi.mocked(listAssetServiceLevels).mockResolvedValue([draft]);
    render(<ServiceLevelGovernancePanel onChanged={vi.fn()} />);
    await screen.findByText(/excluded from analysis pending independent verification/i);
    vi.mocked(listServiceLevelAssets).mockRejectedValueOnce(new Error("Read unavailable"));
    fireEvent.change(screen.getByLabelText("Independent review note"), { target: { value: "Independent operations review against exact draft." } });
    fireEvent.click(screen.getByRole("button", { name: "Verify current version" }));
    await screen.findByText(/committed.*refresh failed/i);
    expect(screen.queryByText(/submission outcome is unknown/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify current version" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reconcile submission" })).toBeInTheDocument();
  });

  it("does not label a historically verified row admitted when current evidence standing is lost", async () => {
    vi.mocked(listAssetServiceLevels).mockResolvedValue([{ ...draft, status: "verified", analysis_eligible: false }]);
    render(<ServiceLevelGovernancePanel onChanged={vi.fn()} />);
    await screen.findByText(/current evidence standing is not established/i);
    expect(screen.queryByText("Included in analysis")).not.toBeInTheDocument();
  });

  it.each(["unknown", "throw"])("preserves an acknowledged commitment when reconciliation returns %s after refresh failure", async (result) => {
    vi.mocked(listAssetServiceLevels).mockResolvedValue([draft]);
    const onChanged = vi.fn();
    render(<ServiceLevelGovernancePanel onChanged={onChanged} />);
    await screen.findByText(/excluded from analysis pending independent verification/i);
    vi.mocked(listServiceLevelAssets).mockRejectedValueOnce(new Error("Read unavailable"));
    fireEvent.change(screen.getByLabelText("Independent review note"), { target: { value: "Independent operations review against exact draft." } });
    fireEvent.click(screen.getByRole("button", { name: "Verify current version" }));
    await screen.findByText(/committed.*refresh failed/i);
    if (result === "unknown") vi.mocked(reconcileAssetServiceLevelCommand).mockResolvedValueOnce({ outcome: "unknown" });
    else vi.mocked(reconcileAssetServiceLevelCommand).mockRejectedValueOnce(new Error("Receipt read unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Reconcile submission" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/committed.*reconciliation/i));
    expect(screen.queryByText(/submission outcome is unknown/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Independently verified\./)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify current version" })).toBeDisabled();
    expect(verifyAssetServiceLevel).toHaveBeenCalledTimes(1);
    expect(recordAssetServiceLevel).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("retains commitment learned from read-only reconciliation when its refresh fails", async () => {
    vi.mocked(listAssetServiceLevels).mockResolvedValue([draft]);
    vi.mocked(verifyAssetServiceLevel).mockRejectedValueOnce(new Error("Lost acknowledgement"));
    const onChanged = vi.fn();
    render(<ServiceLevelGovernancePanel onChanged={onChanged} />);
    await screen.findByText(/excluded from analysis pending independent verification/i);
    fireEvent.change(screen.getByLabelText("Independent review note"), { target: { value: "Independent operations review against exact draft." } });
    fireEvent.click(screen.getByRole("button", { name: "Verify current version" }));
    await screen.findByText(/submission outcome is unknown/i);
    vi.mocked(listServiceLevelAssets).mockRejectedValueOnce(new Error("Refresh unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Reconcile submission" }));
    await screen.findByText(/committed.*refresh failed/i);
    vi.mocked(reconcileAssetServiceLevelCommand).mockRejectedValueOnce(new Error("Receipt unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Reconcile submission" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/committed.*reconciliation/i));
    expect(screen.queryByText(/submission outcome is unknown/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify current version" })).toBeDisabled();
    expect(verifyAssetServiceLevel).toHaveBeenCalledTimes(1);
    expect(recordAssetServiceLevel).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("shows canonical attributed full before and after records without truncating to latest version", async () => {
    vi.mocked(listAssetServiceLevels).mockResolvedValue([draft]);
    vi.mocked(listServiceLevelHistory).mockResolvedValue([{
      id: "77777777-7777-4777-8777-777777777777", created_at: "2026-10-03T00:00:00Z",
      entity_type: "asset_service_level", actor: draft.recorded_by,
      previous_state: { service_name: "Earlier exact consequence", version: 2 },
      new_state: { service_name: "Current exact consequence", version: 3 },
      event_data: { command_id: "55555555-5555-4555-8555-555555555555" }, approval_reference: null,
    }]);
    render(<ServiceLevelGovernancePanel onChanged={vi.fn()} />);
    await screen.findByText(/Earlier exact consequence/);
    expect(screen.getByText(/Current exact consequence/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(draft.recorded_by))).toBeInTheDocument();
    expect(listServiceLevelHistory).toHaveBeenCalledWith(assetId, { actorId: auth.user!.id, organizationId: auth.profile!.organization_id });
  });
});
