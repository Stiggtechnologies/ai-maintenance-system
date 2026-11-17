import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  recordRepairableUnitEvent,
  registerRepairableUnit,
  upsertCatalogueMaterial,
} from "./repairableMaterialsService";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: vi.fn(),
  },
}));

describe("repairableMaterialsService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends a versioned material policy without tenant or authority inputs", async () => {
    rpc.mockResolvedValue({
      data: {
        materialId: "m-1",
        materialCode: "PUMP-1",
        masterVersion: 4,
        repairableClassification: "rotable",
        operationalAuthorization: false,
      },
      error: null,
    });
    await upsertCatalogueMaterial({
      materialId: "m-1",
      expectedVersion: 3,
      materialCode: " PUMP-1 ",
      description: " Process pump ",
      category: " Pumps ",
      unitOfMeasure: " each ",
      unitCostUsd: 12000,
      leadTimeDays: 60,
      minimumQuantity: 1,
      maximumQuantity: 2,
      repairableClassification: "rotable",
      criticality: "critical",
      sourceSystem: " SAP ",
      basis: " Approved material master revision 4. ",
    });
    expect(rpc).toHaveBeenCalledWith("upsert_catalogue_material", {
      p_material_id: "m-1",
      p_material_code: "PUMP-1",
      p_description: "Process pump",
      p_category: "Pumps",
      p_unit_of_measure: "each",
      p_unit_cost_usd: 12000,
      p_lead_time_days: 60,
      p_min_qty: 1,
      p_max_qty: 2,
      p_repairable_classification: "rotable",
      p_criticality: "critical",
      p_source_system: "SAP",
      p_basis: "Approved material master revision 4.",
      p_expected_version: 3,
    });
  });

  it("registers a serial through the named RPC", async () => {
    rpc.mockResolvedValue({
      data: {
        repairableUnitId: "u-1",
        version: 1,
        currentState: "available",
        operationalAuthorization: false,
      },
      error: null,
    });
    await registerRepairableUnit({
      materialId: "m-1",
      serialNumber: " SN-1 ",
      sourceSystem: " SAP ",
      sourceRef: " SER-1 ",
      basis: " Verified serial register record. ",
    });
    expect(rpc).toHaveBeenCalledWith("register_repairable_unit", {
      p_material_id: "m-1",
      p_serial_number: "SN-1",
      p_source_system: "SAP",
      p_basis: "Verified serial register record.",
      p_source_ref: "SER-1",
    });
  });

  it("preserves lifecycle evidence and expected version", async () => {
    rpc.mockResolvedValue({
      data: {
        repairableUnitId: "u-1",
        eventType: "installed",
        currentState: "installed",
        version: 2,
        sequence: 2,
        operationalAuthorization: false,
      },
      error: null,
    });
    await recordRepairableUnitEvent({
      repairableUnitId: "u-1",
      eventType: "installed",
      occurredAt: "2026-10-02T10:00:00Z",
      basis: " Installed under approved work package. ",
      expectedVersion: 1,
      sourceSystem: " SAP ",
      assetId: "a-1",
      component: " Final drive ",
      position: " Left rear ",
      meterHours: 200,
      evidenceRef: " WO-1 ",
    });
    expect(rpc).toHaveBeenCalledWith(
      "record_repairable_unit_event",
      expect.objectContaining({
        p_repairable_unit_id: "u-1",
        p_event_type: "installed",
        p_expected_version: 1,
        p_asset_id: "a-1",
        p_component: "Final drive",
        p_position: "Left rear",
        p_meter_hours: 200,
        p_evidence_ref: "WO-1",
      }),
    );
  });

  it("surfaces a governed RPC refusal", async () => {
    rpc.mockResolvedValue({
      data: { error: "event time precedes history" },
      error: null,
    });
    await expect(
      recordRepairableUnitEvent({
        repairableUnitId: "u-1",
        eventType: "removed",
        occurredAt: "2020-01-01T00:00:00Z",
        basis: "Backdated removal from an unverified note.",
        expectedVersion: 2,
        sourceSystem: "note",
      }),
    ).rejects.toThrow("precedes history");
  });
});
