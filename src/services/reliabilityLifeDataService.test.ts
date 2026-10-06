import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LifeEventIdentityCollisionError,
  recordComponentLifeEvent,
  type LifeEventInput,
} from "./reliabilityLifeDataService";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));

const input: LifeEventInput = {
  assetId: "synthetic-asset",
  component: "synthetic component",
  hoursAtChangeOut: 1200,
  eventKind: "failure",
  eventDate: "2026-09-02",
  workOrderRef: "second-explicit-physical-life",
  sourceReference: "Independent synthetic removal record",
  evidenceBasis: "Explicit synthetic exposure evidence, not customer data.",
};

describe("life capture collision boundary", () => {
  beforeEach(() => vi.resetAllMocks());
  it("returns only the canonical event identity after an actual successful receipt", async () => {
    rpc.mockResolvedValue({ data: { event_id: 42 }, error: null });
    expect(await recordComponentLifeEvent(input)).toBe(42);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_component_life_event", {
      p_asset_id: input.assetId,
      p_component: input.component,
      p_hours_at_change_out: 1200,
      p_event_kind: "failure",
      p_event_date: input.eventDate,
      p_planned_interval_hours: null,
      p_symptom: null,
      p_work_order_ref: input.workOrderRef,
      p_source_file: input.sourceReference,
      p_source_basis: input.evidenceBasis,
    });
  });
  it("recognizes only the known legacy collision, preserves all source values and never retries or invents an ID", async () => {
    rpc.mockResolvedValue({
      data: { error: "this component life event is already recorded" },
      error: null,
    });
    const frozen = structuredClone(input);
    const error = await recordComponentLifeEvent(input).catch(
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(LifeEventIdentityCollisionError);
    expect(error).toMatchObject({ code: "legacy_physical_life_collision" });
    const message = (error as Error).message;
    expect(message).toContain("Life event was not recorded");
    expect(message).toContain("retry or a different physical life");
    expect(message).toContain(
      "Do not alter measured hours, dates or asset identity",
    );
    expect(message).toContain("Do not omit the unresolved life");
    expect(input).toEqual(frozen);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("does not misclassify authorization failures or unrelated database errors as life collisions", async () => {
    for (const message of [
      "asset not found",
      "authentication required",
      "Covariate capture requires verified MFA and AAL2",
    ]) {
      rpc.mockResolvedValue({ data: { error: message }, error: null });
      const error = await recordComponentLifeEvent(input).catch(
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(LifeEventIdentityCollisionError);
      expect((error as Error).message).toBe(message);
    }
    rpc.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "unrelated constraint violation" },
    });
    await expect(recordComponentLifeEvent(input)).rejects.toThrow(
      "unrelated constraint violation",
    );
  });
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses invalid exposure %s before any capture RPC",
    async (hoursAtChangeOut) => {
      await expect(
        recordComponentLifeEvent({ ...input, hoursAtChangeOut }),
      ).rejects.toThrow("Operating hours must be a positive number");
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it("does not report success when the service returns no canonical identity", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await expect(recordComponentLifeEvent(input)).rejects.toThrow(
      "No life-event identity was returned",
    );
  });
});
