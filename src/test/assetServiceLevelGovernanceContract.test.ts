import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101720000_governed_asset_service_levels.sql",
  "utf8",
);
const service = readFileSync(
  "src/services/assetServiceLevelService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/ServiceLevelGovernancePanel.tsx",
  "utf8",
);
const workspace = readFileSync(
  "src/components/AssetInterdependency.tsx",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

describe("U2.08 governed service-level consequence contract", () => {
  it("extends the canonical model with versioned evidence and independent review", () => {
    expect(migration).toContain("alter table public.asset_service_levels");
    expect(migration).toContain("evidence_item_id uuid");
    expect(migration).toContain("recorded_by uuid");
    expect(migration).toContain("reviewed_by uuid");
    expect(migration).toContain("reviewed_by <> recorded_by");
    expect(migration).toContain("p_expected_version");
    expect(migration).toContain("insert into public.audit_events");
  });

  it("fails closed on tenant, role, evidence and analysis-admission boundaries", () => {
    expect(migration).toContain("public.app_current_org()");
    expect(migration).toContain("public.app_current_role()");
    expect(migration).toContain("asset_service_levels_asset_tenant_fk");
    expect(migration).toContain("asset_service_levels_evidence_tenant_fk");
    expect(migration).toContain("e.verification_status = 'verified'");
    expect(migration).toContain("e.evidence_class in");
    expect(migration).toContain("and sl.status = 'verified'");
    expect(migration).toContain("from public, anon, authenticated");
  });

  it("preserves unknowns and does not grant operational authority", () => {
    expect(migration).toContain("or left unknown");
    expect(migration).toContain(
      "grants no work, operating, risk-acceptance or restoration authority",
    );
    expect(panel).toContain("unknown values are never invented");
    expect(panel).toContain("Any edit invalidates this verification");
  });

  it("is customer reachable and clean-database exercised", () => {
    expect(service).toContain('supabase.rpc("record_asset_service_level"');
    expect(service).toContain('supabase.rpc("verify_asset_service_level"');
    expect(workspace).toContain("<ServiceLevelGovernancePanel");
    expect(ci).toContain("bash scripts/ci-asset-service-level-smoke.sh");
  });
});
