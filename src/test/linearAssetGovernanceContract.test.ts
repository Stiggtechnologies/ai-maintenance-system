import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101700000_governed_linear_asset_routing.sql",
  "utf8",
);
const service = readFileSync("src/services/assetOntologyService.ts", "utf8");
const panel = readFileSync(
  "src/components/LinearAssetGovernancePanel.tsx",
  "utf8",
);
const ontology = readFileSync("src/components/AssetOntology.tsx", "utf8");
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

describe("U3.03 governed linear asset contract", () => {
  it("extends the canonical route, section, defect, evidence and audit models", () => {
    expect(migration).toContain("alter table public.linear_asset_routes");
    expect(migration).toContain("alter table public.linear_segments");
    expect(migration).toContain("alter table public.linear_defects");
    expect(migration).toContain(
      "references public.evidence_items(organization_id, id)",
    );
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).not.toMatch(/create table/i);
  });

  it("enforces tenant, role, class, evidence and route-bound walls", () => {
    expect(migration).toContain("public.app_current_org()");
    expect(migration).toContain("public.app_current_role()");
    expect(migration).toContain("c.class_key = 'linear'");
    expect(migration).toContain("e.verification_status = 'verified'");
    expect(migration).toContain(
      "('MEASURED', 'INSPECTED', 'DOCUMENTED', 'EXPERT_JUDGEMENT')",
    );
    expect(migration).toContain("p_from_measure < s.to_measure");
    expect(migration).toContain("p_at_measure > v_route.end_measure");
    expect(migration).toContain("from public, anon");
  });

  it("keeps route truth separate from engineering and operating authority", () => {
    expect(migration).toContain(
      "does not establish condition, capacity, an operating limit, work, a recommendation, repair completion, or approval",
    );
    expect(migration).toContain(
      "does not determine fitness for service or repair",
    );
    expect(panel).toContain("Authority retained by people");
    expect(panel).toContain("Route length is location, not exposure by itself");
  });

  it("makes all three governed write paths customer reachable and CI exercised", () => {
    expect(service).toContain('supabase.rpc("record_linear_asset_route"');
    expect(service).toContain('supabase.rpc("record_linear_segment"');
    expect(service).toContain('supabase.rpc("record_linear_defect"');
    expect(ontology).toContain("<LinearAssetGovernancePanel");
    expect(ci).toContain("bash scripts/ci-linear-asset-routing-smoke.sh");
  });
});
