import { describe, expect, it } from "vitest";
import {
  applyRecoveryMapping,
  autoMapRecoveryHeaders,
  extractRecoveryRows,
  isAllowedRecoveryEndpoint,
  RECOVERY_ACTIVATION_ENTITIES,
} from ".";

describe("Recovery activation mapping", () => {
  it("covers every first-tenant planning domain without a parallel model", () => {
    expect(RECOVERY_ACTIVATION_ENTITIES.map((entity) => entity.id)).toEqual([
      "site",
      "asset",
      "work_order",
      "material",
      "material_stock",
      "craft_capacity",
      "operating_state",
      "production_record",
    ]);
  });

  it("proposes aliases but leaves unmatched required fields visible", () => {
    const mapping = autoMapRecoveryHeaders("asset", [
      "Equipment ID",
      "Equipment Name",
      "Site Code",
      "Asset Type",
    ]);
    expect(mapping).toMatchObject({
      external_id: "Equipment ID",
      name: "Equipment Name",
      site_external_id: "Site Code",
      asset_class: "Asset Type",
    });
  });

  it("applies approved field, constant and vocabulary mappings deterministically", () => {
    expect(
      applyRecoveryMapping(
        {
          id: "WO-7",
          description: "Replace drive coupling",
          equipment: "CV-001",
          source_status: "REL",
        },
        {
          external_id: "id",
          title: "description",
          asset_external_id: "equipment",
          status: "source_status",
        },
        { status: { REL: "scheduled" } },
        { priority: "high" },
      ),
    ).toEqual({
      external_id: "WO-7",
      title: "Replace drive coupling",
      asset_external_id: "CV-001",
      status: "scheduled",
      priority: "high",
    });
  });

  it("extracts a configured JSON array path and rejects non-arrays", () => {
    expect(
      extractRecoveryRows({ result: { items: [{ id: 1 }] } }, "result.items"),
    ).toEqual([{ id: 1 }]);
    expect(() => extractRecoveryRows({ result: {} }, "result.items")).toThrow(
      /JSON array/i,
    );
  });

  it("fails closed for unallowlisted, credential-bearing and private endpoints", () => {
    expect(
      isAllowedRecoveryEndpoint("https://api.customer.example/v1/work-orders", [
        "api.customer.example",
      ]),
    ).toEqual({ allowed: true, hostname: "api.customer.example" });
    expect(
      isAllowedRecoveryEndpoint("https://api.customer.example@127.0.0.1/data", [
        "api.customer.example",
      ]).allowed,
    ).toBe(false);
    expect(
      isAllowedRecoveryEndpoint("https://api.customer.example/data", [])
        .allowed,
    ).toBe(false);
    expect(
      isAllowedRecoveryEndpoint("http://api.customer.example/data", [
        "api.customer.example",
      ]).allowed,
    ).toBe(false);
  });
});
