import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  getSafetyCriticalRegulatoryWorkspace,
  linkSafetyCriticalRegulatoryObligation,
  recordSafetyCriticalElement,
} from "./safetyCriticalRegulatoryService";

beforeEach(() => vi.clearAllMocks());

describe("safetyCriticalRegulatoryService", () => {
  it("loads the canonical element, jurisdiction and binding workspace", async () => {
    rpc.mockResolvedValue({
      data: {
        elements: [],
        regulatoryRequirements: [],
        bindings: [],
        verifiedEvidence: [],
        assets: [],
        coverage: {
          elements: 0,
          elementsWithVerifiedEvidence: 0,
          overdueOrUntested: 0,
          mandatoryRegulatoryObligations: 0,
          currentBindings: 0,
          staleBindings: 0,
        },
        jurisdiction: "Alberta",
        decisionBoundary: "No compliance finding.",
      },
      error: null,
    });
    const result = await getSafetyCriticalRegulatoryWorkspace();
    expect(result.jurisdiction).toBe("Alberta");
    expect(rpc).toHaveBeenCalledWith(
      "get_safety_critical_regulatory_workspace",
      {},
    );
  });

  it("records a versioned evidence-backed element", async () => {
    rpc.mockResolvedValue({
      data: {
        id: 7,
        version: 2,
        status: "recorded",
        complianceEstablished: false,
        workAuthorized: false,
        riskAccepted: false,
        operatingLimitChanged: false,
        returnToServiceAuthorized: false,
      },
      error: null,
    });
    await recordSafetyCriticalElement({
      id: 7,
      assetId: "asset-1",
      reference: "SCE-P-101",
      label: "Emergency shutdown valve",
      barrierKind: "mechanical",
      barrierRole: "preventive",
      performanceStandard:
        "Close within five seconds and retain leak-tight isolation.",
      testIntervalMonths: 12,
      lastTestedOn: "2026-08-01",
      evidenceItemId: "evidence-1",
      effectiveFrom: "2026-08-01",
      reviewDue: "2027-08-01",
      expectedVersion: 1,
    });
    expect(rpc).toHaveBeenCalledWith("record_safety_critical_element", {
      p_record: expect.objectContaining({
        id: 7,
        asset_id: "asset-1",
        evidence_item_id: "evidence-1",
        expected_version: 1,
      }),
    });
  });

  it("links an exact adopted obligation with explicit non-authority", async () => {
    rpc.mockResolvedValue({
      data: {
        id: "binding-1",
        status: "obligation_linked",
        elementVersion: 2,
        layerVersion: 4,
        complianceEstablished: false,
        workAuthorized: false,
        riskAccepted: false,
        operatingLimitChanged: false,
        returnToServiceAuthorized: false,
      },
      error: null,
    });
    await linkSafetyCriticalRegulatoryObligation({
      safetyCriticalElementId: 7,
      expectedElementVersion: 2,
      capabilityPackLayerId: "layer-1",
      expectedLayerVersion: 4,
      requirementKey: "pressure_shutdown_test",
      evidenceItemId: "evidence-2",
      basis:
        "The adopted pressure regulation applies to this exact shutdown barrier.",
    });
    expect(rpc).toHaveBeenCalledWith(
      "link_safety_critical_regulatory_obligation",
      {
        p_link: expect.objectContaining({
          safety_critical_element_id: 7,
          expected_element_version: 2,
          capability_pack_layer_id: "layer-1",
          expected_layer_version: 4,
          requirement_key: "pressure_shutdown_test",
          evidence_item_id: "evidence-2",
        }),
      },
    );
  });

  it("refuses malformed records before the RPC and surfaces database refusals", async () => {
    await expect(
      recordSafetyCriticalElement({
        reference: "S",
        label: "x",
        barrierKind: "mechanical",
        barrierRole: "preventive",
        performanceStandard: "short",
        evidenceItemId: "",
        effectiveFrom: "2026-08-01",
        expectedVersion: 0,
      }),
    ).rejects.toThrow(/reference and descriptive label/i);
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValue({
      data: { error: "Safety-critical element changed after it was loaded" },
      error: null,
    });
    await expect(
      recordSafetyCriticalElement({
        id: 7,
        reference: "SCE-7",
        label: "Shutdown barrier",
        barrierKind: "instrumented",
        barrierRole: "preventive",
        performanceStandard:
          "Trip before the owner-approved high-high process limit.",
        evidenceItemId: "evidence-1",
        effectiveFrom: "2026-08-01",
        expectedVersion: 1,
      }),
    ).rejects.toThrow(/changed after it was loaded/i);
  });
});
