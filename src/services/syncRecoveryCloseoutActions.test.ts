import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  donorCandidatesFromPayload,
  economicAssumptionsReady,
  listRecoveryRecurrenceCandidates,
  recoveryActions,
} from "./syncRecoveryService";

const rpc = vi.fn();
const order = vi.fn();
const eqVerdict = vi.fn();
const eqEvent = vi.fn();
const select = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({ select }),
  },
}));

const readyEconomics = {
  regular: "80",
  overtime: "120",
  overtimeShare: "0.25",
  contractor: "0",
  logistics: "0",
  risk: "0",
  lifeCycle: "0",
  basis: "Rates stated by the planner for this event only.",
};

describe("recovery close-out actions still unexposed before this wiring", () => {
  beforeEach(() => {
    rpc.mockReset();
    order.mockReset();
    eqVerdict.mockReset();
    eqEvent.mockReset();
    select.mockReset();
    select.mockReturnValue({ eq: eqEvent });
    eqEvent.mockReturnValue({ eq: eqVerdict });
    eqVerdict.mockReturnValue({ order });
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it("keeps donor options that name both ids and drops the rest", () => {
    expect(
      donorCandidatesFromPayload({
        donor_candidates: [
          {
            work_order_material_id: "wom-1",
            donor_component_instance_id: "ci-1",
            required_material: "BRG-1",
            donor_asset: "Crusher 2",
            serial_number: "SN-9",
            donor_state: "down_unplanned",
          },
          { work_order_material_id: "wom-2" },
          "not-a-row",
        ],
      }),
    ).toEqual([
      {
        workOrderMaterialId: "wom-1",
        requiredMaterial: "BRG-1",
        donorComponentInstanceId: "ci-1",
        donorAsset: "Crusher 2",
        serialNumber: "SN-9",
        donorState: "down_unplanned",
      },
    ]);
    expect(donorCandidatesFromPayload(null)).toEqual([]);
  });

  it("treats a blank economic field as not ready and an explicit zero as ready", () => {
    expect(economicAssumptionsReady(readyEconomics)).toBe(true);
    expect(
      economicAssumptionsReady({ ...readyEconomics, contractor: "" }),
    ).toBe(false);
    expect(
      economicAssumptionsReady({ ...readyEconomics, overtimeShare: "1.1" }),
    ).toBe(false);
    expect(economicAssumptionsReady({ ...readyEconomics, regular: "-1" })).toBe(
      false,
    );
    expect(
      economicAssumptionsReady({ ...readyEconomics, basis: "too short" }),
    ).toBe(false);
  });

  it("records a work-zone relationship for the event site and refuses a thin basis", async () => {
    await recoveryActions.setWorkZoneRelationship({
      siteId: "site-1",
      zoneA: " bay-a ",
      zoneB: "bay-b",
      parallelAllowed: false,
      basis: "Drawing 14 shows these bays share a crane rail.",
      sourceRef: "DWG-14",
    });
    expect(rpc).toHaveBeenCalledWith("set_work_zone_relationship", {
      p_site_id: "site-1",
      p_zone_a: "bay-a",
      p_zone_b: "bay-b",
      p_parallel_allowed: false,
      p_basis: "Drawing 14 shows these bays share a crane rail.",
      p_source_ref: "DWG-14",
    });

    rpc.mockClear();
    await expect(
      recoveryActions.setWorkZoneRelationship({
        siteId: null,
        zoneA: "a",
        zoneB: "bay-b",
        parallelAllowed: true,
        basis: "short",
      }),
    ).rejects.toThrow("two zones and a substantive basis are required");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("classifies only a named candidate and does not send a thin basis", async () => {
    await recoveryActions.classifyRecurrence({
      linkId: "link-1",
      verdict: "rejected",
      basis: "The later fault is a different component.",
    });
    expect(rpc).toHaveBeenCalledWith("classify_recovery_recurrence", {
      p_link_id: "link-1",
      p_verdict: "rejected",
      p_basis: "The later fault is a different component.",
    });

    rpc.mockClear();
    await expect(
      recoveryActions.classifyRecurrence({
        linkId: "link-1",
        verdict: "confirmed",
        basis: "too short",
      }),
    ).rejects.toThrow("confirmed/rejected verdict and basis required");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lists only unclassified candidates for the event", async () => {
    order.mockResolvedValue({
      data: [
        {
          id: "link-1",
          notification_id: "note-1",
          created_at: "2026-09-01T00:00:00Z",
        },
      ],
      error: null,
    });
    await expect(listRecoveryRecurrenceCandidates("event-1")).resolves.toEqual([
      {
        id: "link-1",
        notificationId: "note-1",
        createdAt: "2026-09-01T00:00:00Z",
      },
    ]);
    expect(select).toHaveBeenCalledWith("id, notification_id, created_at");
    expect(eqEvent).toHaveBeenCalledWith("event_id", "event-1");
    expect(eqVerdict).toHaveBeenCalledWith("verdict", "candidate");
  });

  it("records human economic figures and refuses a blank treated as a number", async () => {
    await recoveryActions.setEconomicAssumptions({
      eventId: "event-1",
      regular: 80,
      overtime: 120,
      overtimeShare: 0.25,
      contractor: 0,
      logistics: 0,
      risk: 0,
      lifeCycle: 0,
      basis: readyEconomics.basis,
    });
    expect(rpc).toHaveBeenCalledWith("set_recovery_economic_assumptions", {
      p_event_id: "event-1",
      p_regular: 80,
      p_overtime: 120,
      p_overtime_share: 0.25,
      p_contractor: 0,
      p_logistics: 0,
      p_risk: 0,
      p_life_cycle: 0,
      p_basis: readyEconomics.basis,
    });

    rpc.mockClear();
    await expect(
      recoveryActions.setEconomicAssumptions({
        eventId: "event-1",
        regular: Number.NaN,
        overtime: 0,
        overtimeShare: 0,
        contractor: 0,
        logistics: 0,
        risk: 0,
        lifeCycle: 0,
        basis: readyEconomics.basis,
      }),
    ).rejects.toThrow(
      "non-negative costs, 0-1 overtime share and substantive basis required",
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("proposes a listed donor as pending approval and refuses an unnamed donor", async () => {
    rpc.mockResolvedValue({
      data: { ok: true, approval_required: true, executed: false },
      error: null,
    });
    const result = await recoveryActions.proposeCannibalization({
      eventId: "event-1",
      workOrderMaterialId: "wom-1",
      donorComponentInstanceId: "ci-1",
      basis: "Donor is already down and the bearing matches the short line.",
    });
    expect(result).toMatchObject({ executed: false, approval_required: true });
    expect(rpc).toHaveBeenCalledWith("propose_recovery_cannibalization", {
      p_event_id: "event-1",
      p_work_order_material_id: "wom-1",
      p_donor_component_instance_id: "ci-1",
      p_basis: "Donor is already down and the bearing matches the short line.",
    });

    rpc.mockClear();
    await expect(
      recoveryActions.proposeCannibalization({
        eventId: "event-1",
        workOrderMaterialId: "",
        donorComponentInstanceId: "ci-1",
        basis: "Donor is already down and the bearing matches the short line.",
      }),
    ).rejects.toThrow("No component is transferred");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces an in-band refusal without treating it as success", async () => {
    rpc.mockResolvedValue({
      data: { error: "donor asset is not recorded down/offline" },
      error: null,
    });
    await expect(
      recoveryActions.proposeCannibalization({
        eventId: "event-1",
        workOrderMaterialId: "wom-1",
        donorComponentInstanceId: "ci-1",
        basis: "Donor is already down and the bearing matches the short line.",
      }),
    ).rejects.toThrow("donor asset is not recorded down/offline");
  });
});
