import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPosture = vi.hoisted(() => vi.fn());
vi.mock("../services/securityPolicyService", () => ({
  getCurrentSecurityPosture: getPosture,
}));
vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ signOut: vi.fn() }),
}));
vi.mock("./BrandWordmark", () => ({
  BrandWordmark: () => <span>SyncAI</span>,
}));
vi.mock("./MfaManager", () => ({
  MfaManager: () => <div>Enrollment control</div>,
}));
vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      refreshSession: vi.fn(),
      mfa: { listFactors: vi.fn(), challenge: vi.fn(), verify: vi.fn() },
    },
  },
}));

import { MfaAccessGate } from "./MfaAccessGate";

describe("MfaAccessGate", () => {
  beforeEach(() => getPosture.mockReset());
  afterEach(() => cleanup());

  it("renders tenant content only after the server says assurance is satisfied", async () => {
    getPosture.mockResolvedValue({ satisfied: true });
    render(
      <MfaAccessGate>
        <div>Tenant workspace</div>
      </MfaAccessGate>,
    );
    expect(await screen.findByText("Tenant workspace")).toBeInTheDocument();
    expect(screen.queryByText(/Secure this account/i)).not.toBeInTheDocument();
  });

  it("routes an in-scope user without a factor into enrollment", async () => {
    getPosture.mockResolvedValue({
      satisfied: false,
      required: true,
      verifiedFactorCount: 0,
      reason: "factor_enrollment_required",
    });
    render(
      <MfaAccessGate>
        <div>Tenant workspace</div>
      </MfaAccessGate>,
    );
    expect(
      await screen.findByText("Secure this account before continuing"),
    ).toBeInTheDocument();
    expect(screen.getByText("Enrollment control")).toBeInTheDocument();
    expect(screen.queryByText("Tenant workspace")).not.toBeInTheDocument();
  });
});
