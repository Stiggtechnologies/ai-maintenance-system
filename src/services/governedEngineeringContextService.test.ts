import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));

import { buildGovernedEngineeringContext } from "./governedEngineeringContextService";

const result = {
  tenantId: "org",
  assetTwinId: "",
  assetClassCode: "",
  componentCodes: [],
  candidateFailureModeCodes: [],
  physicsCapabilityCodes: [],
  evidenceIds: [],
  sourceIds: [],
  sourceConflictIds: [],
  missingEvidence: [],
  retrieved: [],
  physicsResults: [],
  conflicts: [],
  unverifiedChunkIds: [],
  unverifiedEvidenceIds: [],
  humanApprovalRequired: true,
  autonomousOperationalActionAllowed: false,
  grantsWorkRelease: false,
  grantsApprovalAuthority: false,
  grantsApproval: false,
  decisionBoundary: "no authority",
};

describe("governed engineering context service", () => {
  beforeEach(() => rpc.mockReset());

  it("calls the package RPC and refuses an authorizing payload", async () => {
    rpc.mockResolvedValue({ data: result, error: null });
    await buildGovernedEngineeringContext({
      claimType: "failure_behaviour",
      query: "cavitation",
    });
    expect(rpc).toHaveBeenCalledWith("build_governed_engineering_context", {
      p_claim_type: "failure_behaviour",
      p_query: "cavitation",
      p_asset_class: null,
      p_asset_twin_id: null,
      p_component_codes: [],
      p_failure_mode_codes: [],
      p_physics_capability_codes: [],
      p_retrieved_chunk_ids: [],
      p_physics_results: [],
      p_evidence_ids: [],
    });

    rpc.mockResolvedValue({
      data: { ...result, grantsWorkRelease: true },
      error: null,
    });
    await expect(
      buildGovernedEngineeringContext({ claimType: "failure_behaviour" }),
    ).rejects.toThrow(/must not grant authority/);
  });
});
