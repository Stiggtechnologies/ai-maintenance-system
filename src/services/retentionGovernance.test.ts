import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

const { adoptRetentionPolicy, recordRetentionReview, setRetentionLegalHold } =
  await import("./retentionGovernance");

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: { outcome: "adopted", policy_id: "p1" },
    error: null,
  });
});

describe("retention governance callers", () => {
  it("adopts a period through adopt_retention_policy", async () => {
    await adoptRetentionPolicy({
      policyId: "p1",
      retainYears: 8,
      basis: "Corporate schedule adopted by the records officer.",
      commandId: "11111111-1111-4111-8111-111111111111",
    });
    expect(rpc).toHaveBeenCalledWith("adopt_retention_policy", {
      p_policy_id: "p1",
      p_retain_years: 8,
      p_basis: "Corporate schedule adopted by the records officer.",
      p_command_id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("places a hold through set_retention_legal_hold", async () => {
    await setRetentionLegalHold({
      policyId: "p1",
      hold: true,
      reason: "Litigation hold for the compressor failure claim.",
      commandId: "22222222-2222-4222-8222-222222222222",
    });
    expect(rpc).toHaveBeenCalledWith("set_retention_legal_hold", {
      p_policy_id: "p1",
      p_hold: true,
      p_reason: "Litigation hold for the compressor failure claim.",
      p_command_id: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("records a review through record_retention_review", async () => {
    await recordRetentionReview({
      policyId: "p1",
      note: "Reviewed the records beyond policy and left them in place.",
      commandId: "33333333-3333-4333-8333-333333333333",
    });
    expect(rpc).toHaveBeenCalledWith("record_retention_review", {
      p_policy_id: "p1",
      p_note: "Reviewed the records beyond policy and left them in place.",
      p_command_id: "33333333-3333-4333-8333-333333333333",
    });
  });

  it("surfaces an in-band refusal and does not treat it as success", async () => {
    rpc.mockResolvedValue({
      data: {
        error: "an ai or system identity may not determine records retention",
      },
      error: null,
    });
    await expect(
      adoptRetentionPolicy({
        policyId: "p1",
        retainYears: 7,
        basis: "Corporate schedule adopted by the records officer.",
      }),
    ).rejects.toThrow(/ai or system identity/);
  });

  it("supplies a command id when the caller does not", async () => {
    await adoptRetentionPolicy({
      policyId: "p1",
      retainYears: 7,
      basis: "Corporate schedule adopted by the records officer.",
    });
    const args = rpc.mock.calls[0]?.[1] as { p_command_id: string };
    expect(args.p_command_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
