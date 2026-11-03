import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecoveryPosture } from "../services/recoveryGovernanceService";

const load = vi.fn();
const state = vi.fn();
const adopt = vi.fn();
const withdraw = vi.fn();
const verify = vi.fn();

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "human-2" },
    profile: { role: "executive", full_name: "Blair Executive" },
  }),
}));
vi.mock("../services/recoveryGovernanceService", () => ({
  getRecoveryPosture: () => load(),
  stateRecoveryObjective: (...args: unknown[]) => state(...args),
  adoptRecoveryObjective: (...args: unknown[]) => adopt(...args),
  withdrawRecoveryObjectiveDraft: (...args: unknown[]) => withdraw(...args),
  recordRestoreVerification: (...args: unknown[]) => verify(...args),
}));

import { RecoveryObjectivesPanel } from "./RecoveryObjectivesPanel";

const empty: RecoveryPosture = {
  role: "executive",
  viewer_id: "human-2",
  viewer_name: "Blair Executive",
  draft: null,
  adopted: null,
  verifications: [],
  candidates: [
    { id: "owner-1", full_name: "Casey Owner", role: "maintenance_manager" },
  ],
  documentation: {
    database_drill: "scripts/database-restore-drill.mjs",
    runbook: "docs/enterprise-readiness/database-restore-drill.md",
    policy_template:
      "docs/compliance/policies/05-business-continuity-dr-policy.md",
    local_drill_is_not_an_approved_rto: true,
    production_pitr_proven: false,
    storage_object_bytes_proven: false,
    vault_root_key_proven: false,
    edge_secrets_proven: false,
    boundary:
      "Measured local database-drill durations are not an approved recovery-time objective.",
  },
};

describe("RecoveryObjectivesPanel", () => {
  beforeEach(() => {
    load.mockReset();
    state.mockReset();
    adopt.mockReset();
    withdraw.mockReset();
    verify.mockReset();
    load.mockResolvedValue(empty);
    state.mockResolvedValue({ objective_id: "obj-1", status: "draft" });
    verify.mockResolvedValue({
      verification_id: "ver-1",
      verification_outcome: "checks_not_run",
    });
  });

  it("starts with empty durations and does not claim production recovery", async () => {
    render(<RecoveryObjectivesPanel />);
    expect(
      await screen.findByText(/There is no platform default RPO or RTO/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("recovery-rpo")).toHaveValue("");
    expect(screen.getByTestId("recovery-rto")).toHaveValue("");
    expect(screen.getByText(/Production PITR proven: no/)).toBeInTheDocument();
    expect(screen.getByText(/Storage bytes proven: no/)).toBeInTheDocument();
    expect(screen.getByText(/Vault root proven: no/)).toBeInTheDocument();
  });

  it("submits the typed objective and shows the server verification outcome", async () => {
    const adopted = {
      ...empty,
      adopted: {
        id: "obj-1",
        version: 1,
        status: "adopted" as const,
        rpo_seconds: 900,
        rto_seconds: 3600,
        recovery_owner_id: "owner-1",
        recovery_owner_name: "Casey Owner",
        procedure_reference: "scripts/database-restore-drill.mjs",
        basis: "Board minute adopting the recovery objective",
        stated_by: "human-1",
        stated_by_name: "Ada Admin",
        stated_at: "2026-11-03T00:00:00Z",
        adopted_by: "human-2",
        adopted_at: "2026-11-03T01:00:00Z",
      },
    };
    load.mockResolvedValueOnce(empty).mockResolvedValue(adopted);
    render(<RecoveryObjectivesPanel />);
    await screen.findByTestId("recovery-rpo");

    fireEvent.change(screen.getByTestId("recovery-rpo"), {
      target: { value: "900" },
    });
    fireEvent.change(screen.getByTestId("recovery-rto"), {
      target: { value: "3600" },
    });
    fireEvent.change(screen.getByTestId("recovery-owner"), {
      target: { value: "owner-1" },
    });
    fireEvent.change(screen.getByTestId("recovery-procedure"), {
      target: { value: "scripts/database-restore-drill.mjs" },
    });
    fireEvent.change(screen.getByTestId("recovery-basis"), {
      target: { value: "Board minute 14 sets the recovery objective" },
    });
    fireEvent.click(screen.getByTestId("recovery-state"));

    await waitFor(() => expect(state).toHaveBeenCalledOnce());
    expect(state).toHaveBeenCalledWith({
      rpoSeconds: "900",
      rtoSeconds: "3600",
      recoveryOwnerId: "owner-1",
      procedureReference: "scripts/database-restore-drill.mjs",
      basis: "Board minute 14 sets the recovery objective",
    });

    fireEvent.change(await screen.findByTestId("recovery-backup"), {
      target: { value: "local-drill-backup" },
    });
    fireEvent.change(screen.getByTestId("recovery-target"), {
      target: { value: "isolated-target" },
    });
    fireEvent.change(screen.getByTestId("recovery-loss"), {
      target: { value: "120" },
    });
    fireEvent.change(screen.getByTestId("recovery-duration"), {
      target: { value: "400" },
    });
    fireEvent.change(screen.getByTestId("recovery-rows"), {
      target: { value: "not_run" },
    });
    fireEvent.change(screen.getByTestId("recovery-witness"), {
      target: { value: "passed" },
    });
    fireEvent.change(screen.getByTestId("recovery-evidence"), {
      target: { value: "private drill directory 2026-11-03" },
    });
    fireEvent.click(screen.getByTestId("recovery-verify"));

    expect(
      await screen.findByText("Checks not run — not a pass"),
    ).toBeInTheDocument();
    expect(verify).toHaveBeenCalledWith(
      expect.not.objectContaining({
        verificationOutcome: expect.anything(),
      }),
    );
  });
});
