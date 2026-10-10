import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20270103150000_sync_context_operating_contract.sql",
  "utf8",
).toLowerCase();
const smoke = readFileSync("scripts/ci-sync-context-contract-smoke.sh", "utf8");

describe("SC-02 server coordinate prerequisites (source assertions, not runtime proof)", () => {
  it("extends canonical models without rewriting historical provenance or rights/RLS", () => {
    expect(sql).toContain("alter table public.geospatial_features");
    expect(sql).toContain("geospatial_verified_coordinate_contract");
    expect(sql).toContain(") not valid;");
    expect(sql).not.toMatch(/create (?:table|policy)/);
    expect(sql).not.toMatch(
      /update public\.geospatial_features set (?:coordinate|horizontal)/,
    );
    expect(sql).not.toContain(
      "create or replace function public.sync_context_source_rights_permit",
    );
    expect(sql).not.toContain("disable row level security");
  });
  it("persists explicit coordinates through the existing governed human draft writer", () => {
    for (const field of [
      "coordinate_reference_system",
      "coordinate_axis_order",
      "coordinate_basis",
      "horizontal_accuracy_m",
    ])
      expect(sql).toContain(field);
    expect(sql).toContain("not v_coordinate?'horizontalaccuracym'");
    expect(sql).toContain("auth.uid() is null");
    expect(sql).toContain("organization_id=v_org");
    expect(sql).toContain("public.sync_context_source_rights_permit(v_source)");
    expect(sql).toContain("left join public.evidence_items");
    expect(sql).toContain("insert into public.audit_events");
    expect(sql).toContain("'status','draft'");
    expect(sql).toContain("'operational_authority',false");
    expect(sql).not.toContain("insert into public.work_orders");
    expect(sql).not.toContain("insert into public.approvals");
  });
  it("runs the native geometry/health assertions on CI's canonical migrated schema", () => {
    expect(smoke).toContain(
      "-f scripts/tests/sync-context-operating-gates.sql",
    );
    expect(smoke).toContain("ON_ERROR_STOP=1");
  });
  it("updates every existing successful geometry fixture without weakening its gates", () => {
    for (const path of [
      "scripts/ci-geospatial-operational-intelligence-smoke.sh",
      "scripts/ci-sync-context-contract-smoke.sh",
      "scripts/ci-climate-hazard-exposure-smoke.sh",
    ]) {
      const script = readFileSync(path, "utf8");
      const successfulWrites = script
        .split("\n")
        .filter(
          (line) =>
            line.includes("record_geospatial_feature") &&
            line.includes("source_connector_id"),
        );
      expect(successfulWrites.length).toBeGreaterThan(0);
      for (const line of successfulWrites)
        expect(line).toContain("$COORDINATE,");
      expect(script).toContain('"horizontalAccuracyM":null');
      expect(script).toContain("set -euo pipefail");
    }
  });
});
