import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: { rpc: rpcMock, from: fromMock },
}));

import {
  listProductionLossUnitValues,
  operativeProductionLossValues,
  recordProductionLossUnitValue,
  validateProductionLossUnitValue,
  valueMeasuredProductionLoss,
  type ProductionLossUnitValue,
} from "./valueGovernanceService";

const rate: ProductionLossUnitValue = {
  id: 4,
  assumptionKey: "production_loss_unit_value:t",
  unitOfMeasure: "t",
  currency: "USD",
  valuePerUnit: 80,
  unit: "USD/t",
  source: "Mine plan realised margin",
  effectiveFrom: "2026-10-01",
  reviewDue: null,
  label: "Lost production value per t",
};

describe("production-loss unit value", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  it("refuses an unsourced, zero, or mismatched rate before any write", async () => {
    expect(
      validateProductionLossUnitValue({
        unitOfMeasure: "t",
        currency: "usd",
        valuePerUnit: 0,
        source: "Mine plan realised margin",
      }).ok,
    ).toBe(false);
    expect(
      validateProductionLossUnitValue({
        unitOfMeasure: "t/h",
        currency: "USD",
        valuePerUnit: 12,
        source: "Mine plan realised margin",
      }).ok,
    ).toBe(false);
    const missingSource = validateProductionLossUnitValue({
      unitOfMeasure: "t",
      currency: "USD",
      valuePerUnit: 12,
      source: "ore",
    });
    expect(missingSource.ok).toBe(false);
    await expect(
      recordProductionLossUnitValue({
        unitOfMeasure: "t",
        currency: "USD",
        valuePerUnit: 12,
        source: "ore",
      }),
    ).rejects.toThrow(/unsourced price/);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("writes a new dated version through the canonical financial-assumption door", async () => {
    rpcMock.mockResolvedValue({ data: { version_id: 19 }, error: null });
    const recorded = await recordProductionLossUnitValue({
      unitOfMeasure: " t ",
      currency: "usd",
      valuePerUnit: 80,
      source: "  Mine plan realised margin  ",
      effectiveFrom: "2026-11-01",
    });
    expect(recorded).toEqual({
      version_id: 19,
      assumption_key: "production_loss_unit_value:t",
    });
    expect(rpcMock).toHaveBeenCalledWith("upsert_financial_assumption", {
      p_key: "production_loss_unit_value:t",
      p_label: "Lost production value per t",
      p_value: 80,
      p_unit: "USD/t",
      p_source: "Mine plan realised margin",
      p_kind: "general",
      p_effective_from: "2026-11-01",
      p_review_due: null,
    });
  });

  it("keeps the latest operative version and ignores a future-dated one", () => {
    const values = operativeProductionLossValues(
      [
        {
          id: 2,
          assumption_key: "production_loss_unit_value:t",
          label: "older",
          value: "70",
          unit: "USD/t",
          source: "2025 mine plan",
          effective_from: "2025-01-01",
          review_due: null,
        },
        {
          id: 9,
          assumption_key: "production_loss_unit_value:t",
          label: "future",
          value: 120,
          unit: "USD/t",
          source: "next year's plan",
          effective_from: "2027-01-01",
          review_due: null,
        },
        {
          id: 4,
          assumption_key: "production_loss_unit_value:t",
          label: "current",
          value: 80,
          unit: "USD/t",
          source: "Mine plan realised margin",
          effective_from: "2026-10-01",
          review_due: null,
        },
        {
          id: 5,
          assumption_key: "production_loss_unit_value:bbl",
          label: "wrong shape",
          value: 10,
          unit: "USD",
          source: "no unit binding",
          effective_from: "2026-10-01",
          review_due: null,
        },
      ],
      "2026-11-03",
    );
    expect(values).toEqual([
      expect.objectContaining({
        id: 4,
        unitOfMeasure: "t",
        valuePerUnit: 80,
      }),
    ]);
  });

  it("prices a matching measured loss and leaves every other unit unvalued", () => {
    const priced = valueMeasuredProductionLoss(
      { unitOfMeasure: "t", estimatedUnitsLost: 12.5, events: 2 },
      rate,
    );
    expect(priced.status).toBe("valued");
    if (priced.status === "valued") {
      expect(priced.amount).toBe(1000);
      expect(priced.reason).toMatch(/source: Mine plan realised margin/);
    }
    const other = valueMeasuredProductionLoss(
      { unitOfMeasure: "bbl", estimatedUnitsLost: 4, events: 1 },
      rate,
    );
    expect(other.status).toBe("unvalued");
    if (other.status === "unvalued") {
      expect(other.reason).toMatch(/No sourced unit value is recorded for bbl/);
    }
    const missing = valueMeasuredProductionLoss(
      { unitOfMeasure: "t", estimatedUnitsLost: null, events: 1 },
      rate,
    );
    expect(missing.status).toBe("unvalued");
  });

  it("reads the assumption series through the tenant select path", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      like: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      returns: vi.fn().mockResolvedValue({
        data: [
          {
            id: 4,
            assumption_key: "production_loss_unit_value:t",
            label: "current",
            value: 80,
            unit: "USD/t",
            source: "Mine plan realised margin",
            effective_from: "2026-10-01",
            review_due: null,
          },
        ],
        error: null,
      }),
    };
    fromMock.mockReturnValue(query);
    const values = await listProductionLossUnitValues("2026-11-03");
    expect(fromMock).toHaveBeenCalledWith("financial_assumptions");
    expect(query.like).toHaveBeenCalledWith(
      "assumption_key",
      "production_loss_unit_value:%",
    );
    expect(values[0]?.assumptionKey).toBe("production_loss_unit_value:t");
  });
});
