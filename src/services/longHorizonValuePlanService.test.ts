import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  adoptLongHorizonPlan,
  getLongHorizonValuePlan,
  recordLongHorizonPlan,
} from "./longHorizonValuePlanService";

beforeEach(() => vi.clearAllMocks());

describe("longHorizonValuePlanService", () => {
  it("loads the tenant value-plan workspace", async () => {
    rpc.mockResolvedValue({
      data: {
        plans: [],
        selected: null,
        decisionBoundary: "No expenditure authority.",
      },
      error: null,
    });
    const result = await getLongHorizonValuePlan();
    expect(result.selected).toBeNull();
    expect(rpc).toHaveBeenCalledWith("get_long_horizon_value_plan", {
      p_plan_id: null,
    });
  });

  it("records a draft without sending an invented maintenance amount", async () => {
    rpc.mockResolvedValue({
      data: {
        planId: "plan-1",
        planCode: "SITE-A",
        version: 1,
        status: "draft",
        expenditureAuthorized: false,
      },
      error: null,
    });
    await recordLongHorizonPlan({
      planCode: "SITE-A",
      startYear: 2027,
      endYear: 2028,
      currency: "CAD",
      forecastMethod: "recorded_only",
      statedAnnualMaintenance: null,
      statedAnnualBasis: null,
      evidenceItemId: "evidence-1",
      basis: "Horizon covers the two recorded capital years.",
    });
    expect(rpc).toHaveBeenCalledWith("record_long_horizon_plan", {
      p_plan: expect.objectContaining({
        forecastMethod: "recorded_only",
        statedAnnualMaintenance: null,
      }),
    });
  });

  it("surfaces a server refusal instead of treating it as adoption", async () => {
    rpc.mockResolvedValue({
      data: { error: "the author cannot adopt their own long-horizon plan" },
      error: null,
    });
    await expect(
      adoptLongHorizonPlan(
        "plan-1",
        "Reviewed the recorded years and withheld totals.",
      ),
    ).rejects.toThrow(/author cannot adopt/);
  });
});
