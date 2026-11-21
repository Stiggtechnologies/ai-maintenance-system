import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  decideSystemKpiOptimization,
  getSystemKpiOptimizationWorkspace,
  proposeSystemKpiOptimization,
} from "./systemKpiOptimizationService";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("systemKpiOptimizationService", () => {
  it("loads the tenant workspace through the canonical reader", async () => {
    rpc.mockResolvedValue({
      data: {
        boundary: "Acceptance does not approve work.",
        catalog: [],
        pages: [],
        assessments: [],
      },
      error: null,
    });

    const workspace = await getSystemKpiOptimizationWorkspace();
    expect(workspace.assessments).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("get_system_kpi_optimization_workspace");
  });

  it("sends the focal KPI and every recorded effect without adding a score", async () => {
    rpc.mockResolvedValue({
      data: {
        optimizationId: "opt-1",
        status: "proposed",
        safetyKpiWorsens: true,
        operationalAuthorization: false,
      },
      error: null,
    });
    const effects = [
      {
        kpiKey: "oee",
        page: "executive",
        effect: "improves" as const,
        basis:
          "The proposal is aimed at demonstrated packing-line effectiveness.",
      },
      {
        kpiKey: "critical_control_compliance",
        page: "risk_safety",
        effect: "worsens" as const,
        basis:
          "The shorter inspection window reduces a critical-control check.",
      },
    ];

    const result = await proposeSystemKpiOptimization({
      focalKpiKey: "oee",
      intent:
        "Raise packing-line effectiveness without hiding the other pages.",
      effects,
      recommendationId: null,
    });

    expect(result.operationalAuthorization).toBe(false);
    expect(rpc).toHaveBeenCalledWith("propose_system_kpi_optimization", {
      p_focal_kpi_key: "oee",
      p_intent:
        "Raise packing-line effectiveness without hiding the other pages.",
      p_effects: effects,
      p_recommendation_id: null,
    });
    expect(JSON.stringify(rpc.mock.calls[0][1])).not.toMatch(/score|weight/i);
  });

  it("surfaces a server refusal and keeps the decision on the governed RPC", async () => {
    rpc.mockResolvedValueOnce({
      data: { error: "single-KPI optimization refused" },
      error: null,
    });
    await expect(
      proposeSystemKpiOptimization({
        focalKpiKey: "oee",
        intent:
          "Raise packing-line effectiveness without hiding the other pages.",
        effects: [],
      }),
    ).rejects.toThrow(/single-KPI optimization refused/);

    rpc.mockResolvedValueOnce({
      data: {
        optimizationId: "opt-1",
        status: "accepted",
        safetyKpiWorsens: false,
        operationalAuthorization: false,
      },
      error: null,
    });
    const decided = await decideSystemKpiOptimization({
      optimizationId: "opt-1",
      decision: "accepted",
      note: "The other catalog pages are explicit and none are hidden.",
    });
    expect(decided.status).toBe("accepted");
    expect(decided.operationalAuthorization).toBe(false);
    expect(rpc).toHaveBeenCalledWith("decide_system_kpi_optimization", {
      p_optimization_id: "opt-1",
      p_decision: "accepted",
      p_note: "The other catalog pages are explicit and none are hidden.",
      p_escalation_note: null,
    });
  });
});
