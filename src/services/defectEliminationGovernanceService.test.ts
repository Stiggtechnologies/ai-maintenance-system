import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc: rpcMock } }));

import {
  loadDefectEliminationGovernance,
  recordDefectEliminationGovernance,
} from "./defectEliminationGovernanceService";

const workspace = {
  basis: "Stage 3 freezes retained evidence.",
  boundaries: {
    mayCreateWork: false,
    mayChangePmInterval: false,
    mayApproveStrategy: false,
    mayAcceptRisk: false,
    mayCommitSpend: false,
    mayReturnToService: false,
  },
  reuse: {
    fracas: "packs",
    pmOptimization: "assessments",
    weibull: "reports",
    elimination: "metric",
  },
  elimination: {
    available: false,
    eliminationRatePct: null,
    basis: "No coded target yet.",
  },
  candidates: [],
  decisions: [],
};

describe("defect-elimination governance service", () => {
  beforeEach(() => rpcMock.mockReset());

  it("loads the tenant posture through the governed read", async () => {
    rpcMock.mockResolvedValue({ data: workspace, error: null });

    await expect(loadDefectEliminationGovernance()).resolves.toEqual(workspace);
    expect(rpcMock).toHaveBeenCalledWith("get_defect_elimination_governance");
  });

  it("surfaces a server refusal instead of treating it as a recorded decision", async () => {
    rpcMock.mockResolvedValue({
      data: {
        error:
          "the assigned RCA investigator cannot govern their own defect-elimination decision",
      },
      error: null,
    });

    await expect(
      recordDefectEliminationGovernance({
        assetId: "asset-1",
        fracasPackId: "pack-1",
        strategyAssessmentId: "assessment-1",
        lifeReportId: "report-1",
        disposition: "defer_for_evidence",
        basis:
          "The retained Weibull fit is identified but the investigator cannot self-govern.",
      }),
    ).rejects.toThrow(/assigned RCA investigator/i);
  });

  it("records only the evidence identifiers and the named disposition", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "decision-1", advisory: true },
      error: null,
    });

    await recordDefectEliminationGovernance({
      assetId: "asset-1",
      fracasPackId: "pack-1",
      strategyAssessmentId: "assessment-1",
      lifeReportId: "report-1",
      disposition: "pursue_elimination",
      basis:
        "Retained FRACAS, PM assessment and Weibull fit support pursuit without creating work.",
    });

    expect(rpcMock).toHaveBeenCalledWith(
      "record_defect_elimination_governance",
      {
        p_asset_id: "asset-1",
        p_fracas_pack_id: "pack-1",
        p_strategy_assessment_id: "assessment-1",
        p_life_report_id: "report-1",
        p_disposition: "pursue_elimination",
        p_basis:
          "Retained FRACAS, PM assessment and Weibull fit support pursuit without creating work.",
      },
    );
  });
});
