import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CLIMATE_DECISION_FAMILIES,
  CLIMATE_EXPOSURE_HAZARDS,
} from "../services/climateHazardExposureService";

const sql = readFileSync(
  "supabase/migrations/20261219370000_climate_hazard_exposure.sql",
  "utf8",
).toLowerCase();
const service = readFileSync(
  "src/services/climateHazardExposureService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/ClimateHazardExposurePanel.tsx",
  "utf8",
);
const page = readFileSync("src/components/AssetOntology.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-climate-hazard-exposure-smoke.sh",
  "utf8",
);

describe("U15.01 governed natural-hazard and climate exposure", () => {
  it("covers exactly the thirteen registered operational hazards", () => {
    expect(CLIMATE_EXPOSURE_HAZARDS).toHaveLength(13);
    expect(CLIMATE_EXPOSURE_HAZARDS).toEqual([
      "heat",
      "cold",
      "flood",
      "wildfire",
      "wind",
      "ice",
      "drought",
      "sea_level",
      "permafrost",
      "seismic",
      "landslide",
      "storm_surge",
      "water_scarcity",
    ]);
    for (const hazard of CLIMATE_EXPOSURE_HAZARDS)
      expect(sql).toContain(hazard);
  });

  it("requires a stated effect on every named decision family", () => {
    expect(CLIMATE_DECISION_FAMILIES).toEqual([
      "design",
      "maintenance_interval",
      "spares",
      "emergency_plan",
      "renewal",
    ]);
    for (const family of CLIMATE_DECISION_FAMILIES) {
      expect(sql).toContain(family);
      expect(service).toContain(family);
    }
    expect(sql).toContain("all thirteen hazards and five decision effects");
  });

  it("extends the canonical climate family and canonical subject records", () => {
    expect(sql).toContain("alter table public.climate_resilience_assessments");
    expect(sql).toContain(
      "alter table public.climate_resilience_hazard_assessments",
    );
    expect(sql).toContain("references public.assets");
    expect(sql).toContain("references public.sites");
    expect(sql).toContain("references public.risks");
    expect(sql).toContain("references public.recommendations");
    expect(sql).toContain("evidence_items");
    expect(sql).toContain("geospatial_features");
    expect(sql).not.toContain(
      "create table if not exists public.climate_hazard",
    );
  });

  it("preserves historical eight-hazard assessments without reinterpretation", () => {
    expect(sql).toContain("'concept_v1','operational_v1'");
    expect(sql).toContain("historical concept vocabulary");
    expect(sql).toContain("assessment_kind='concept_v1'");
    expect(sql).toContain("assessment_kind='operational_v1'");
  });

  it("enforces tenant, provenance, freshness and independent-review controls", () => {
    expect(sql).toContain("organization_id=public.app_current_org()");
    expect(sql).toContain("e.verification_status<>'verified'");
    expect(sql).toContain("f.valid_until<=now()");
    expect(sql).toContain("author cannot perform the independent review");
    expect(sql).toContain("missing_evidence");
    expect(smoke.toLowerCase()).toContain("foreign climate site");
    expect(smoke).toContain("author cannot perform the independent review");
  });

  it("retains human authority and is customer reachable", () => {
    expect(sql).toContain("no design, interval, stock, emergency, renewal");
    expect(sql).not.toContain("insert into approvals");
    expect(sql).not.toContain("insert into work_orders");
    expect(sql).not.toMatch(/update recommendations\s+set\s+status/);
    expect(page).toContain("<ClimateHazardExposurePanel />");
    expect(panel).toContain("Natural-hazard and climate exposure");
    for (const rpc of [
      "create_climate_hazard_exposure",
      "record_climate_hazard_exposure",
      "review_climate_hazard_exposure",
      "get_climate_hazard_exposure_workspace",
    ])
      expect(service).toContain(`"${rpc}"`);
  });
});
