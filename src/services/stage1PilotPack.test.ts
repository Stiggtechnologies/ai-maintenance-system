import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));

import {
  adoptAuthorityLimit,
  getKpiNamedOwners,
  getStage1ImportStatus,
  nameKpiOwner,
  stateAuthorityCeiling,
} from "./stage1PilotPack";

function countQuery(n: number) {
  const row = { count: n, error: null };
  return {
    select: () => ({
      eq: () => Promise.resolve(row),
      then: (resolve: (v: typeof row) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(row).then(resolve, reject),
    }),
  };
}

describe("stage1PilotPack service", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
  });

  it("unwraps in-band RPC refusals rather than claiming success", async () => {
    rpc.mockResolvedValue({
      data: { error: "naming a KPI owner requires a signed-in human" },
      error: null,
    });
    await expect(
      nameKpiOwner({
        kpiKey: "oee",
        slot: "accountable",
        ownerName: "A. Person",
        basis: "Site RACI instrument dated 2026-09-01",
      }),
    ).rejects.toThrow(/signed-in human/);
  });

  it("calls the existing DoA RPCs — no parallel authority store", async () => {
    rpc.mockResolvedValue({
      data: { adopted: "lim-1", role_key: "planner" },
      error: null,
    });
    await adoptAuthorityLimit({
      limitId: "lim-1",
      note: "Customer DoA instrument §4.2",
    });
    expect(rpc).toHaveBeenCalledWith("adopt_authority_limit", {
      p_id: "lim-1",
      p_note: "Customer DoA instrument §4.2",
    });

    rpc.mockResolvedValue({
      data: { limit_id: "lim-1", next: "adopt_authority_limit" },
      error: null,
    });
    await stateAuthorityCeiling({
      limitId: "lim-1",
      maxCommitment: "5000",
      currency: "USD",
      basis: "Customer DoA instrument §4.2 restated",
    });
    expect(rpc).toHaveBeenCalledWith("state_authority_ceiling", {
      p_id: "lim-1",
      p_ceiling: {
        max_commitment: "5000",
        currency: "USD",
        basis: "Customer DoA instrument §4.2 restated",
      },
    });
  });

  it("reports honest empty import counts", async () => {
    from.mockImplementation(() => countQuery(0));
    const status = await getStage1ImportStatus();
    expect(status.workOrders).toBe(0);
    expect(status.hasWorkHistory).toBe(false);
    expect(status.honesty).toMatch(/No work-order history/);
    expect(status.honesty).not.toMatch(/AHS|case study|26-unit/i);
  });

  it("returns catalog overlay rows without fabricating owners", async () => {
    rpc.mockResolvedValue({
      data: {
        role: "reliability_engineer",
        owners: [
          {
            kpi_key: "oee",
            name: "Overall Equipment Effectiveness",
            named_accountable: null,
            named_responsible: null,
          },
        ],
      },
      error: null,
    });
    const r = await getKpiNamedOwners();
    expect(r.owners[0]?.named_accountable).toBeNull();
    expect(rpc).toHaveBeenCalledWith("get_kpi_named_owners");
  });
});

describe("stage1PilotPack callers are mounted", () => {
  it("AccountabilityCascade calls adopt and state", () => {
    const src = readFileSync(
      "src/components/AccountabilityCascade.tsx",
      "utf8",
    );
    expect(src).toContain("adoptAuthorityLimit");
    expect(src).toContain("stateAuthorityCeiling");
    expect(src).toContain("stage1-doa-adopt");
  });

  it("Stage1KpiOwners calls nameKpiOwner", () => {
    const src = readFileSync("src/components/Stage1KpiOwners.tsx", "utf8");
    expect(src).toContain("nameKpiOwner");
    expect(src).toContain("getKpiNamedOwners");
    expect(src).toContain("No named human recorded");
  });

  it("Stage1ImportLivePath reuses ContractImport and CMMS deep-link", () => {
    const src = readFileSync("src/components/Stage1ImportLivePath.tsx", "utf8");
    expect(src).toContain("ContractImport");
    expect(src).toContain('initialEntity="maintenance_plan"');
    expect(src).toContain('navigate("/integrations")');
    expect(src).toContain("No parallel historian or CMMS");
  });
});
