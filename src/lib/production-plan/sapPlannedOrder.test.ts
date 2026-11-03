import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SAP_PLANNED_ORDER_FIXTURE,
  parseSapPlannedOrderPayload,
  sha256Hex,
} from "./sapPlannedOrder";

describe("mocked SAP planned-order document", () => {
  it("reads the local A_PlannedOrder fixture and does not assign an asset", () => {
    const parsed = parseSapPlannedOrderPayload(SAP_PLANNED_ORDER_FIXTURE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.orders).toHaveLength(2);
    expect(parsed.orders[0]).toMatchObject({
      plannedOrder: "000001234567",
      material: "FG-100",
      productionPlant: "1000",
      totalQuantity: 1250.5,
      baseUnit: "TO",
      windowStart: "2026-12-01T00:00:00.000Z",
      windowEnd: "2026-12-15T00:00:00.000Z",
    });
    expect(parsed.orders[1].windowStart).toBe("2026-12-05T06:00:00.000Z");
    expect(parsed.orders[1].windowEnd).toBe("2026-12-20T18:00:00.000Z");
    expect(parsed.orders[0]).not.toHaveProperty("assetId");
    expect(parsed.canonical).toContain("FG-110");
  });

  it("accepts an OData date and refuses a partial, duplicate or unreadable document", () => {
    const dated = parseSapPlannedOrderPayload({
      d: {
        PlannedOrder: "39",
        Material: "FG-1",
        ProductionPlant: "1000",
        TotalQuantity: 20,
        BaseUnit: "PC",
        PlndOrderPlannedStartDate: "/Date(1487116800000)/",
        PlndOrderPlannedEndDate: "/Date(1487203200000)/",
      },
    });
    expect(dated.ok).toBe(true);
    if (dated.ok) {
      expect(dated.orders[0].windowStart).toBe("2017-02-15T00:00:00.000Z");
    }

    expect(parseSapPlannedOrderPayload({ d: { results: [] } }).ok).toBe(false);
    expect(
      refusal({
        d: {
          results: [
            {
              PlannedOrder: "1",
              Material: "FG-1",
              ProductionPlant: "1000",
              TotalQuantity: "0",
              BaseUnit: "TO",
              PlndOrderPlannedStartDate: "2026-12-01",
              PlndOrderPlannedEndDate: "2026-12-02",
            },
          ],
        },
      }),
    ).toMatch(/positive number/);
    expect(
      refusal({
        d: {
          results: [
            order("1", "2026-12-01", "2026-12-03"),
            order("1", "2026-12-02", "2026-12-04"),
          ],
        },
      }),
    ).toMatch(/more than once/);
    expect(
      refusal({ d: { results: [order("1", "2026-12-01", "2026-12-01")] } }),
    ).toMatch(/will not invent a shift length/);
    expect(
      refusal({
        d: {
          results: [
            {
              ...order("1", "2026-12-01", "2026-12-02"),
              PlndOrderPlannedStartTime: "6am",
            },
          ],
        },
      }),
    ).toMatch(/will not drop it/);
  });

  it("hashes the canonical document locally and the module has no transport", async () => {
    const parsed = parseSapPlannedOrderPayload(SAP_PLANNED_ORDER_FIXTURE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const hash = await sha256Hex(parsed.canonical);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex(parsed.canonical)).toBe(hash);
    const source = readFileSync(
      "src/lib/production-plan/sapPlannedOrder.ts",
      "utf8",
    );
    expect(source).not.toMatch(/fetch\s*\(|XMLHttpRequest|axios|https?:\/\//);
  });
});

function refusal(payload: unknown): string {
  const parsed = parseSapPlannedOrderPayload(payload);
  if (parsed.ok) throw new Error("expected the SAP document to be refused");
  return parsed.error;
}

function order(id: string, start: string, end: string) {
  return {
    PlannedOrder: id,
    Material: "FG-1",
    ProductionPlant: "1000",
    TotalQuantity: "10",
    BaseUnit: "TO",
    PlndOrderPlannedStartDate: start,
    PlndOrderPlannedEndDate: end,
  };
}
