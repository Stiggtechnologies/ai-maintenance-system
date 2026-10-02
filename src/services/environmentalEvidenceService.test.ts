import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  getEnvironmentalEvidenceWorkspace,
  recordEnvironmentalEvidence,
} from "./environmentalEvidenceService";

beforeEach(() => vi.clearAllMocks());

describe("environmentalEvidenceService", () => {
  it("loads the tenant environmental evidence workspace", async () => {
    rpc.mockResolvedValue({
      data: {
        canRecord: true,
        requiredAal: "aal2",
        assets: [],
        sites: [],
        verifiedEvidence: [],
        emissionFactors: [],
        baselines: [],
        hazardousInventory: [],
        decisionBoundary: "Evidence only.",
      },
      error: null,
    });
    const result = await getEnvironmentalEvidenceWorkspace();
    expect(result.requiredAal).toBe("aal2");
    expect(rpc).toHaveBeenCalledWith(
      "get_environmental_evidence_workspace",
      {},
    );
  });

  it("sends a sourced lubricant-loss record without inventing compliance", async () => {
    rpc.mockResolvedValue({
      data: {
        id: 14,
        kind: "environmental_activity",
        status: "recorded",
        complianceCertified: false,
        workAuthorized: false,
        riskAccepted: false,
        returnToServiceAuthorized: false,
        reportableInventory: false,
      },
      error: null,
    });
    const result = await recordEnvironmentalEvidence("environmental_activity", {
      activityKind: "lubricant_loss",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-01",
      quantity: 18,
      unit: "L",
      substance: "ISO VG 46 hydraulic oil",
      maintenanceAttributable: true,
      basis:
        "Measured recovered volume and reservoir top-up after the seal leak.",
      sourceReference: "INC-2026-0091",
      evidenceItemId: "evidence-1",
    });
    expect(rpc).toHaveBeenCalledWith("record_environmental_evidence", {
      p_kind: "environmental_activity",
      p_record: expect.objectContaining({
        activityKind: "lubricant_loss",
        quantity: 18,
        evidenceItemId: "evidence-1",
      }),
    });
    expect(result.complianceCertified).toBe(false);
    expect(result.workAuthorized).toBe(false);
  });

  it("refuses malformed or unevidenced records before the RPC", async () => {
    await expect(
      recordEnvironmentalEvidence("efficiency_baseline", {
        assetId: "asset-1",
        metric: "specific energy",
        unit: "kWh/t",
        designValue: Number.NaN,
        establishedOn: "2026-09-01",
        basis: "short",
        sourceReference: "",
        evidenceItemId: "",
        expectedVersion: 0,
      }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces fail-closed database refusal envelopes", async () => {
    rpc.mockResolvedValue({
      data: { error: "verified environmental evidence is required" },
      error: null,
    });
    await expect(
      recordEnvironmentalEvidence("emission_factor", {
        factorKey: "diesel_stationary",
        label: "Stationary diesel combustion",
        activityUnit: "L",
        factor: 2.7,
        factorUnit: "kg CO2e/L",
        validFrom: "2026-01-01",
        basis:
          "Published factor transcribed exactly for the governed reporting period.",
        sourceReference: "REGULATOR-FACTOR-2026",
        evidenceItemId: "evidence-1",
      }),
    ).rejects.toThrow(/verified environmental evidence/i);
  });

  it("refuses an incomplete hazardous-material control record before the RPC", async () => {
    await expect(
      recordEnvironmentalEvidence("hazardous_inventory", {
        inventoryRef: "BAT-001",
        expectedVersion: 0,
        substance: "Lithium battery",
        category: "battery",
        location: "",
        handlingRequirements:
          "Isolate terminals and follow the controlled handling procedure.",
        emergencyResponseReference: "",
        regulatoryReference: "",
        disposalRouteRequired: "",
        endOfLifePlanned: false,
        basis:
          "Deliberately incomplete hazardous-material record for refusal proof.",
        sourceReference: "BAT-REGISTER-2026",
        evidenceItemId: "evidence-1",
      }),
    ).rejects.toThrow(/Controlled location/i);
    expect(rpc).not.toHaveBeenCalled();
  });
});
