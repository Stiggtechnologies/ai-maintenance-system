import { describe, expect, it } from "vitest";
import {
  mapSapMaintenanceOrders,
  normalizeSapMaintenanceOrderPullRequest,
  readSapODataPage,
  sapMaintenanceOrderUrl,
  validateSapNextUrl,
} from "../../supabase/functions/_shared/sap-s4-maintenance-order-read";

const root = new URL(
  "https://sap.example.com/sap/opu/odata/sap/API_MAINTENANCEORDER",
);
const scope = {
  planningPlant: "1710",
  siteId: "00000000-0000-4000-8000-000000000001",
  observedAt: "2026-10-02T12:00:00Z",
  maxRows: 100,
  phaseMap: [{ phaseCode: "09", status: "completed" }],
};

describe("SAP S/4HANA maintenance order mapper", () => {
  it("normalizes only a bounded object request with an explicit boolean mode", () => {
    expect(
      normalizeSapMaintenanceOrderPullRequest({
        connector_key: " north-pm ",
        dry_run: false,
      }),
    ).toEqual({ connectorKey: "north-pm", dryRun: false });
    expect(
      normalizeSapMaintenanceOrderPullRequest({ connector_key: "north-pm" }),
    ).toEqual({ connectorKey: "north-pm", dryRun: true });
    expect(() => normalizeSapMaintenanceOrderPullRequest(null)).toThrow(
      /JSON object/,
    );
  });

  it("builds the exact MaintenanceOrder query for one planning plant", () => {
    const url = sapMaintenanceOrderUrl(root, "1710", 200);
    expect(url.pathname).toBe(
      "/sap/opu/odata/sap/API_MAINTENANCEORDER/MaintenanceOrder",
    );
    expect(url.searchParams.get("$filter")).toBe(
      "MaintenancePlanningPlant eq '1710'",
    );
    expect(url.searchParams.get("$select")).toContain("Equipment");
    expect(url.searchParams.get("$orderby")).toBe("MaintenanceOrder");
    expect(url.search).not.toContain("$expand");
  });

  it("maps a published-shape order onto a canonical header without inventing closeout", () => {
    const page = readSapODataPage({
      d: {
        results: [
          {
            MaintenanceOrder: "4000000",
            MaintenanceOrderDesc: "Mechanical Inspection for Pump",
            MaintenancePlanningPlant: "1710",
            Equipment: "217100002",
            TechnicalObjectLabel: "217100002",
            MaintOrdProcessPhaseCode: "09",
            MaintOrdBasicStartDate: "2017-07-26T09:00:00+09:00",
            MaintOrdBasicEndDate: "2017-07-27T09:00:00+09:00",
          },
        ],
      },
    });
    expect(mapSapMaintenanceOrders(page.rows, scope)).toEqual([
      expect.objectContaining({
        external_id: "1710:4000000",
        wo_number: "4000000",
        equipment: "217100002",
        status: "completed",
        title: "Mechanical Inspection for Pump",
      }),
    ]);
  });

  it("leaves status unasserted when SAP sends an empty process phase", () => {
    expect(
      mapSapMaintenanceOrders(
        [
          {
            MaintenanceOrder: "4000000",
            MaintenanceOrderDesc: "Mechanical Inspection for Pump",
            MaintenancePlanningPlant: "1710",
            Equipment: "217100002",
            TechnicalObjectLabel: "217100002",
            MaintOrdProcessPhaseCode: "",
            MaintOrdBasicStartDate: "2017-07-26T09:00:00+09:00",
            MaintOrdBasicEndDate: "",
          },
        ],
        scope,
      )[0],
    ).toEqual(expect.objectContaining({ status: null, basic_end: null }));
  });

  it("refuses scope escape, disagreeing equipment identity, unmapped phases and empty plants", () => {
    expect(() => mapSapMaintenanceOrders([], scope)).toThrow(/empty plant/i);
    expect(() =>
      mapSapMaintenanceOrders(
        [
          {
            MaintenanceOrder: "4000001",
            MaintenanceOrderDesc: "Other plant",
            MaintenancePlanningPlant: "1720",
            Equipment: "217100002",
            MaintOrdProcessPhaseCode: "",
          },
        ],
        scope,
      ),
    ).toThrow(/escaped/i);
    expect(() =>
      mapSapMaintenanceOrders(
        [
          {
            MaintenanceOrder: "4000002",
            MaintenanceOrderDesc: "Identity mismatch",
            MaintenancePlanningPlant: "1710",
            Equipment: "217100002",
            TechnicalObjectLabel: "217100003",
            MaintOrdProcessPhaseCode: "",
          },
        ],
        scope,
      ),
    ).toThrow(/disagree/i);
    expect(() =>
      mapSapMaintenanceOrders(
        [
          {
            MaintenanceOrder: "4000003",
            MaintenanceOrderDesc: "Unmapped phase",
            MaintenancePlanningPlant: "1710",
            Equipment: "217100002",
            MaintOrdProcessPhaseCode: "02",
          },
        ],
        scope,
      ),
    ).toThrow(/no administrator status mapping/i);
  });

  it("keeps OData pagination on the approved resource and query", () => {
    const first = sapMaintenanceOrderUrl(root, "1710", 200);
    const next = new URL(first);
    next.searchParams.set("$skiptoken", "opaque");
    expect(validateSapNextUrl(next.href, first).href).toBe(next.href);
    const widened = new URL(next);
    widened.searchParams.set("$filter", "MaintenancePlanningPlant ne ''");
    expect(() => validateSapNextUrl(widened.href, first)).toThrow(/filter/i);
  });
});
