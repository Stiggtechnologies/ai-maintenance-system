import { describe, expect, it, vi } from "vitest";
import { dataResidencyDenial } from "../../../supabase/functions/_shared/data-residency-guard";

describe("data residency refusal", () => {
  it("returns the region mismatch and does not treat it as permission", async () => {
    const reason = await dataResidencyDenial(
      {
        rpc: async () => ({
          data: { allowed: false, reason: "residency_region_mismatch" },
          error: null,
        }),
      },
      "ai_provider",
      "api.openai.com",
    );
    expect(reason).toBe("residency_region_mismatch");
  });

  it("refuses a connector, storage or processing path when authorization is unavailable", async () => {
    const reason = await dataResidencyDenial(
      {
        rpc: async () => ({
          data: null,
          error: { message: "database offline" },
        }),
      },
      "connector",
      "mine-maximo",
    );
    expect(reason).toContain("residency_authorization_unavailable");
  });

  it("refuses an unbound processing route", async () => {
    const reason = await dataResidencyDenial(
      {
        rpc: async () => ({
          data: { allowed: false, reason: "residency_path_unbound" },
          error: null,
        }),
      },
      "processing",
      "calculation-service",
    );
    expect(reason).toBe("residency_path_unbound");
  });

  it("uses the service decision when the caller names a tenant", async () => {
    const rpc = vi.fn(async () => ({
      data: { allowed: true, reason: "current_binding_matches" },
      error: null,
    }));
    const reason = await dataResidencyDenial(
      { rpc },
      "storage",
      "account.dfs.core.windows.net",
      {
        organizationId: "11111111-1111-4111-8111-111111111111",
        serviceLabel: "data-lake-read-pull",
      },
    );
    expect(reason).toBeNull();
    expect(rpc).toHaveBeenCalledWith("authorize_service_data_residency", {
      p_organization_id: "11111111-1111-4111-8111-111111111111",
      p_path_kind: "storage",
      p_path_ref: "account.dfs.core.windows.net",
      p_service_label: "data-lake-read-pull",
    });
  });
});
