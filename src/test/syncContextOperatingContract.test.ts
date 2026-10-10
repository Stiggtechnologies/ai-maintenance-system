import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20270103150000_sync_context_operating_contract.sql",
  "utf8",
).toLowerCase();
const smoke = readFileSync("scripts/ci-sync-context-contract-smoke.sh", "utf8");
const operatingSql = readFileSync(
  "supabase/migrations/20270103160000_sync_context_operating_picture.sql",
  "utf8",
).toLowerCase();

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

describe("SC-02 canonical scoped read contract (source assertions, not runtime proof)", () => {
  it("adds an authenticated read-only RPC without redefining producer or legacy contracts", () => {
    expect(operatingSql).toContain("auth.uid() is null");
    expect(operatingSql).toContain("u.organization_id=v_org and u.role=v_role");
    expect(operatingSql).toContain("set search_path=public");
    expect(operatingSql).toContain("from public,anon,service_role");
    expect(operatingSql).toContain("grant execute");
    expect(operatingSql).not.toMatch(
      /\b(?:insert into|update public|delete from|create table|create policy)\b/,
    );
    expect(operatingSql).not.toContain(
      "function public.get_sync_context_snapshot",
    );
    expect(operatingSql).not.toMatch(/to_jsonb\((?:l|c|w|ap)\)/);
  });
  it("shares canonical scoped eligibility across geometry, events and truthful count metadata", () => {
    for (const contract of [
      "raw_subjects as materialized",
      "consistent_links as materialized",
      "count(distinct site_id)<=1",
      "eligible_features as materialized",
      "from eligible_features",
      "order by observed_at desc,id asc limit p_object_limit",
      "order by occurred_at desc,id asc limit p_event_limit",
      "'rightsblocked'",
      "'healthblocked'",
      "'scopeconflict'",
      "'payloadblocked'",
      "'candidatecount'",
      "'eligiblecount'",
      "'operationalauthority',false",
      "not coalesce(enabled and status='active',false)",
      "f.observed_at<=f.verified_at",
      "e.verified_at<=f.verified_at",
      "octet_length(v_result::text)>8388608",
    ])
      expect(operatingSql).toContain(contract);
  });
  it("wires native and actual authenticated API qualification into the existing full-chain smoke", () => {
    expect(smoke).toContain(
      "bash scripts/ci-sync-context-operating-picture-smoke.sh",
    );
    const api = readFileSync(
      "scripts/ci-sync-context-operating-picture-smoke.sh",
      "utf8",
    );
    expect(api).toContain("get_sync_context_operating_picture");
    expect(api).toContain("verify_geospatial_feature");
    expect(api).toContain("transition_context_source_rights");
    expect(api).toContain(
      "-f scripts/tests/sync-context-operating-picture-gates.sql",
    );
    expect(api).toContain("READ_BEFORE");
    expect(api).toContain("READ_AFTER");
    const native = readFileSync(
      "scripts/tests/sync-context-operating-picture-gates.sql",
      "utf8",
    );
    for (const refusal of [
      "same-link asset/site contradiction accepted",
      "hidden-risk multi-subject link escaped",
      "work inherited recommendation risk leaked",
      "disabled connector emitted",
      "future evidence verification emitted",
      "oversized geometry silently emitted",
    ])
      expect(native).toContain(refusal);
    expect(native.trim()).toMatch(/rollback;$/);
  });
  it("bounds projections before allocation, not only after JSON aggregation", () => {
    expect(operatingSql).not.toContain("event_records as materialized");
    const candidates = operatingSql
      .split("), event_candidates as materialized (")[1]
      .split("), returned_event_candidates")[0]
      .replace(/--[^\n]*/g, "");
    expect(candidates).not.toMatch(
      /jsonb_build_object|title|evidence_item_ids/,
    );
    expect(operatingSql).toContain("from returned_event_features");
    expect(operatingSql).toContain("from returned_event_work");
    expect(operatingSql).toContain("b.payload_budget>131072");
    expect(operatingSql).toContain(
      "sum(payload_budget) from returned_features",
    );
    expect(operatingSql).toContain("octet_length(w.title)<=16384");
  });
  it("mirrors canonical risk-sensitive audit visibility and ordered evidence clocks", () => {
    expect(operatingSql).toContain("l.audit_event_id is null or exists");
    expect(operatingSql).toContain(
      "public.sync_text_as_uuid(e.event_data->>'risk_id')",
    );
    expect(operatingSql).toContain(
      "public.sync_text_as_uuid(e.event_data->>'parent_risk_id')",
    );
    expect(operatingSql).toContain("isfinite(e.ts)");
    expect(operatingSql).toContain("e.ts<=e.verified_at");
    expect(operatingSql).toContain(
      "c.context_rights_decided_at<=v_generated_at",
    );
  });
});
