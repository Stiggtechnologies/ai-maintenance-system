import { describe, expect, it } from "vitest";
import {
  mapSapApmIndicators,
  normalizeSapApmIndicatorPullRequest,
  readSapApmIndicatorPage,
  sapApmIndicatorUrl,
  validateSapApmNextUrl,
} from "../../supabase/functions/_shared/sap-apm-indicator-read";

const root = new URL("https://api-apm.example.com/IndicatorService/v1");
const sensorId = "00000000-0000-4000-8000-0000000000aa";
const scope = {
  technicalObjectNumber: "217100092",
  siteId: "00000000-0000-4000-8000-000000000001",
  observedAt: "2026-10-02T12:00:00Z",
  maxRows: 100,
  bindings: [
    {
      characteristicsInternalId: "53",
      positionId: "24aa638b97194cb8b9d0cf4c2a46eb95",
      categoryName: "M",
      technicalObjectType: "EQUI",
      sensorId,
    },
  ],
};

describe("SAP APM indicator mapper", () => {
  it("defaults to a dry run and builds only the documented filter", () => {
    expect(
      normalizeSapApmIndicatorPullRequest({ connector_key: " apm-north " }),
    ).toEqual({ connectorKey: "apm-north", dryRun: true });
    const url = sapApmIndicatorUrl(root, "217100092");
    expect(url.pathname).toBe("/IndicatorService/v1/Indicators");
    expect(url.searchParams.get("$filter")).toBe(
      "technicalObject_number eq '217100092'",
    );
    expect(url.searchParams.get("$select")).toBeNull();
    expect(url.searchParams.get("$top")).toBeNull();
  });

  it("accepts the camelCase identity fields documented as the Indicator API result", () => {
    const page = readSapApmIndicatorPage({
      value: [
        {
          SSID: "S4HCLNT100",
          technicalObjectType: "EQUI",
          technicalObjectNumber: "217100092",
          categoryName: "M",
          positionID: "24aa638b97194cb8b9d0cf4c2a46eb95",
          characteristicsInternalId: "53",
        },
      ],
    });
    expect(mapSapApmIndicators(page.rows, scope)).toEqual([
      expect.objectContaining({
        sensor_id: sensorId,
        technical_object_number: "217100092",
        characteristics_internal_id: "53",
      }),
    ]);
  });

  it("also accepts the underscore field names from the SAP samples indicator body", () => {
    const page = readSapApmIndicatorPage({
      d: {
        results: [
          {
            technicalObject_type: "EQUI",
            technicalObject_number: "217100092",
            category_name: "M",
            positionDetails_ID: "24aa638b97194cb8b9d0cf4c2a46eb95",
            characteristics_characteristicsInternalId: "53",
          },
        ],
      },
    });
    expect(mapSapApmIndicators(page.rows, scope)).toHaveLength(1);
  });

  it("refuses measurements, missing bindings, extra indicators and a mixed envelope", () => {
    expect(() => mapSapApmIndicators([], scope)).toThrow(/missing indicator/i);
    expect(() =>
      mapSapApmIndicators(
        [
          {
            technicalObjectType: "EQUI",
            technicalObjectNumber: "217100092",
            categoryName: "M",
            positionID: "24aa638b97194cb8b9d0cf4c2a46eb95",
            characteristicsInternalId: "53",
            value: "45",
          },
        ],
        scope,
      ),
    ).toThrow(/measurement/i);
    expect(() =>
      mapSapApmIndicators(
        [
          {
            technicalObjectType: "EQUI",
            technicalObjectNumber: "999",
            categoryName: "M",
            positionID: "24aa638b97194cb8b9d0cf4c2a46eb95",
            characteristicsInternalId: "53",
          },
        ],
        scope,
      ),
    ).toThrow(/escaped/i);
    expect(() =>
      readSapApmIndicatorPage({ value: [], d: { results: [] } }),
    ).toThrow(/either an OData V4/i);
  });

  it("keeps a next link on the same indicator resource and filter", () => {
    const first = sapApmIndicatorUrl(root, "217100092");
    const next = new URL(first);
    next.searchParams.set("$skiptoken", "opaque");
    expect(validateSapApmNextUrl(next.href, first).href).toBe(next.href);
    const widened = new URL(next);
    widened.searchParams.set("$filter", "technicalObject_number ne ''");
    expect(() => validateSapApmNextUrl(widened.href, first)).toThrow(/filter/i);
  });
});
