import { describe, expect, it } from "vitest";
import {
  mapSapMaterialStock,
  readSapODataPage,
  sapMaterialStockUrl,
  validateSapNextUrl,
} from "../../supabase/functions/_shared/sap-s4-inventory-read";

const root = new URL(
  "https://sap.example.com/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV",
);

describe("SAP S/4HANA material stock mapper", () => {
  it("builds the exact unrestricted non-special stock query", () => {
    const url = sapMaterialStockUrl(root, "1000", "0001", 500);
    expect(url.pathname).toBe(
      "/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod",
    );
    expect(url.searchParams.get("$filter")).toContain(
      "InventoryStockType eq '01'",
    );
    expect(url.searchParams.get("$filter")).toContain(
      "InventorySpecialStockType eq ''",
    );
    expect(url.searchParams.get("$orderby")).toBe("Material,MaterialBaseUnit");
  });

  it("parses OData V2 and aggregates exact material/UOM rows", () => {
    const page = readSapODataPage({
      d: {
        results: [
          {
            Material: "MAT-1",
            Plant: "1000",
            StorageLocation: "0001",
            InventoryStockType: "01",
            InventorySpecialStockType: "",
            MaterialBaseUnit: "EA",
            MatlWrhsStkQtyInMatlBaseUnit: "2.5",
          },
          {
            Material: "MAT-1",
            Plant: "1000",
            StorageLocation: "0001",
            InventoryStockType: "01",
            InventorySpecialStockType: "",
            MaterialBaseUnit: "EA",
            MatlWrhsStkQtyInMatlBaseUnit: 3,
          },
        ],
      },
    });
    expect(
      mapSapMaterialStock(page.rows, {
        plant: "1000",
        storageLocation: "0001",
        siteId: "00000000-0000-0000-0000-000000000001",
        observedAt: "2026-10-02T12:00:00Z",
        maxRows: 100,
      }),
    ).toEqual([
      expect.objectContaining({
        external_id: "1000:0001:MAT-1",
        material_code: "MAT-1",
        unit_of_measure: "EA",
        qty_on_hand: 5.5,
      }),
    ]);
  });

  it("refuses scope escape, unavailable stock and empty snapshots", () => {
    const scope = {
      plant: "1000",
      storageLocation: "0001",
      siteId: "site",
      observedAt: "2026-10-02T12:00:00Z",
      maxRows: 100,
    };
    expect(() => mapSapMaterialStock([], scope)).toThrow(/infer zero/i);
    expect(() =>
      mapSapMaterialStock(
        [
          {
            Material: "MAT-1",
            Plant: "2000",
            StorageLocation: "0001",
            InventoryStockType: "01",
            InventorySpecialStockType: "",
            MaterialBaseUnit: "EA",
            MatlWrhsStkQtyInMatlBaseUnit: "1",
          },
        ],
        scope,
      ),
    ).toThrow(/escaped/i);
    expect(() =>
      mapSapMaterialStock(
        [
          {
            Material: "MAT-1",
            Plant: "1000",
            StorageLocation: "0001",
            InventoryStockType: "07",
            InventorySpecialStockType: "",
            MaterialBaseUnit: "EA",
            MatlWrhsStkQtyInMatlBaseUnit: "1",
          },
        ],
        scope,
      ),
    ).toThrow(/not unrestricted/i);
  });

  it("keeps OData pagination on the approved resource and query", () => {
    const first = sapMaterialStockUrl(root, "1000", "0001", 500);
    const next = new URL(first);
    next.searchParams.set("$skiptoken", "opaque");
    expect(validateSapNextUrl(next.href, first).href).toBe(next.href);
    const escaped = new URL(next);
    escaped.hostname = "evil.example";
    expect(() => validateSapNextUrl(escaped.href, first)).toThrow(/approved/i);
    const widened = new URL(next);
    widened.searchParams.set("$filter", "Plant ne ''");
    expect(() => validateSapNextUrl(widened.href, first)).toThrow(/filter/i);
  });
});
