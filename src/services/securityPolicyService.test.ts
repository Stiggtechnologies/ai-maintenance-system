import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));

import {
  decideOrganizationMfaPolicy,
  getCurrentSecurityPosture,
  proposeOrganizationMfaPolicy,
} from "./securityPolicyService";

describe("securityPolicyService", () => {
  beforeEach(() => rpc.mockReset());

  it("reads the pre-workspace security posture", async () => {
    rpc.mockResolvedValue({
      data: {
        authenticated: true,
        workspaceMember: true,
        role: "admin",
        required: true,
        verifiedFactorCount: 1,
        currentAal: "aal2",
        satisfied: true,
        reason: "satisfied",
      },
      error: null,
    });
    await expect(getCurrentSecurityPosture()).resolves.toMatchObject({
      required: true,
      satisfied: true,
    });
    expect(rpc).toHaveBeenCalledWith("get_current_security_posture");
  });

  it("passes proposal and independent decision parameters without client authority", async () => {
    rpc.mockResolvedValue({ data: { status: "proposed" }, error: null });
    await proposeOrganizationMfaPolicy({
      scope: "privileged_roles",
      privilegedRoles: ["admin", "executive"],
      effectiveAt: "2027-01-02T12:00:00.000Z",
      reason: "Protect privileged tenant access with verified assurance.",
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "propose_organization_mfa_policy",
      expect.objectContaining({
        p_enforcement_scope: "privileged_roles",
        p_privileged_roles: ["admin", "executive"],
      }),
    );

    rpc.mockResolvedValue({ data: { status: "adopted" }, error: null });
    await decideOrganizationMfaPolicy({
      policyId: "policy-1",
      decision: "adopt",
      reason: "Independent review confirms the controlled rollout basis.",
    });
    expect(rpc).toHaveBeenLastCalledWith("decide_organization_mfa_policy", {
      p_policy_id: "policy-1",
      p_decision: "adopt",
      p_reason: "Independent review confirms the controlled rollout basis.",
    });
  });

  it("fails closed on RPC and governed envelope errors", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "denied" } });
    await expect(getCurrentSecurityPosture()).rejects.toThrow("denied");
    rpc.mockResolvedValueOnce({
      data: { error: "independent review required" },
      error: null,
    });
    await expect(
      decideOrganizationMfaPolicy({
        policyId: "policy-1",
        decision: "adopt",
        reason: "The proposer cannot approve this governed security policy.",
      }),
    ).rejects.toThrow("independent review required");
  });
});
