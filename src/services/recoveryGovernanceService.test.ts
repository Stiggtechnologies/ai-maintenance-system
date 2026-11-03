import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  getRecoveryPosture,
  recordRestoreVerification,
  stateRecoveryObjective,
} from "./recoveryGovernanceService";

describe("recoveryGovernanceService", () => {
  beforeEach(() => rpc.mockReset());

  it("refuses an in-band error instead of treating it as a posture", async () => {
    rpc.mockResolvedValue({
      data: { error: "forbidden" },
      error: null,
    });
    await expect(getRecoveryPosture()).rejects.toThrow("forbidden");
  });

  it("passes stated seconds through without adding a duration or an outcome", async () => {
    rpc.mockResolvedValue({
      data: { objective_id: "obj-1", status: "draft" },
      error: null,
    });
    await stateRecoveryObjective({
      rpoSeconds: "900",
      rtoSeconds: "3600",
      recoveryOwnerId: "owner-1",
      procedureReference: "scripts/database-restore-drill.mjs",
      basis: "Board minute 14 sets the recovery objective",
    });
    expect(rpc).toHaveBeenCalledWith("state_recovery_objective", {
      p_objective: {
        rpo_seconds: "900",
        rto_seconds: "3600",
        recovery_owner_id: "owner-1",
        procedure_reference: "scripts/database-restore-drill.mjs",
        basis: "Board minute 14 sets the recovery objective",
      },
    });

    rpc.mockResolvedValue({
      data: {
        verification_id: "ver-1",
        verification_outcome: "outside_objectives",
      },
      error: null,
    });
    await recordRestoreVerification({
      objectiveId: "obj-1",
      backupLabel: "local-drill-backup",
      restoreTarget: "isolated-target",
      evidenceReference: "private drill directory 2026-11-03",
      measuredDataLossSeconds: "120",
      measuredRestoreSeconds: "400",
      canonicalRowCheck: "matched",
      tenantIsolationWitness: "failed",
    });
    const payload = rpc.mock.calls.at(-1)?.[1] as {
      p_verification: Record<string, unknown>;
    };
    expect(payload.p_verification).not.toHaveProperty("verification_outcome");
    expect(payload.p_verification).not.toHaveProperty("within_rpo");
    expect(payload.p_verification.measured_data_loss_seconds).toBe("120");
  });
});
