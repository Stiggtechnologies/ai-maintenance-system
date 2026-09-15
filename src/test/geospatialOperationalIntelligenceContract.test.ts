import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20261219360000_geospatial_operational_intelligence.sql",
  "utf8",
).toLowerCase();
const service = readFileSync(
  "src/services/geospatialOperationalIntelligenceService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/GeospatialOperationalIntelligencePanel.tsx",
  "utf8",
);
const page = readFileSync("src/components/AssetOntology.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-geospatial-operational-intelligence-smoke.sh",
  "utf8",
);

describe("U10.01 governed geospatial operational intelligence", () => {
  it("reuses canonical operational identities", () => {
    for (const model of [
      "references public.assets",
      "references public.sites",
      "references public.linear_asset_routes",
      "references public.linear_segments",
      "references public.recommendations",
      "references public.crew_templates",
      "references public.materials",
      "from public.material_stock",
      "from public.operational_constraint_signals",
      "public.evidence_items",
    ])
      expect(sql).toContain(model);
    expect(sql).not.toContain(
      "create table if not exists public.geospatial_recommendations",
    );
    expect(sql).not.toContain(
      "create table if not exists public.geospatial_work_orders",
    );
  });

  it("covers every named U10 decision context", () => {
    for (const kind of [
      "weather_hazard_exposure",
      "access_route",
      "crew_travel",
      "remote_logistics",
      "regional_spares",
      "failure_clustering",
      "hazard_overlay",
      "linear_reference",
      "receptor",
    ])
      expect(sql).toContain(kind);
  });

  it("preserves source, freshness and evidence provenance", () => {
    expect(sql).toContain("source-supplied geojson");
    expect(sql).toContain("syncai will not invent coordinates");
    expect(sql).toContain(
      "syncai will not infer exposure, travel, stock or clustering",
    );
    expect(sql).toContain("e.verification_status<>'verified'");
    expect(sql).toContain("f.valid_until<=now()");
    expect(sql).toContain("missing_evidence");
  });

  it("enforces tenant isolation and independent named-human verification", () => {
    expect(sql).toContain("organization_id=public.app_current_org()");
    expect(sql).toContain("ai identity is not accepted");
    expect(sql).toContain("recorded_by=auth.uid()");
    expect(sql).toContain("author cannot independently verify");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke insert,update,delete,truncate");
    expect(smoke).toContain("foreign");
    expect(smoke).toContain("author cannot independently verify");
  });

  it("cannot dispatch, approve or release work", () => {
    expect(sql).toContain(
      "no crew dispatch, route release, recommendation approval or work authorization",
    );
    expect(sql).toContain(
      "never dispatches crews, approves a route or recommendation, or releases work",
    );
    expect(sql).not.toContain("insert into public.approvals");
    expect(sql).not.toContain("insert into public.work_orders");
    expect(sql).not.toMatch(/update public\.recommendations\s+set\s+status/);
  });

  it("is reachable from the canonical asset ontology workspace", () => {
    expect(page).toContain("<GeospatialOperationalIntelligencePanel />");
    expect(panel).toContain("Geospatial operational intelligence");
    expect(panel).toContain(
      "No map position, exposure, journey or stock conclusion is inferred",
    );
    for (const rpc of [
      "record_geospatial_feature",
      "verify_geospatial_feature",
      "link_geospatial_subject",
      "record_geospatial_operational_assessment",
      "verify_geospatial_operational_assessment",
      "get_geospatial_operational_workspace",
    ])
      expect(service).toContain(`"${rpc}"`);
    expect(sql).toContain("notify pgrst");
  });
});
