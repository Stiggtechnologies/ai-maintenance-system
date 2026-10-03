import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101690000_governed_asset_classification.sql",
  "utf8",
);
const service = readFileSync("src/services/assetOntologyService.ts", "utf8");
const panel = readFileSync(
  "src/components/AssetClassGovernancePanel.tsx",
  "utf8",
);
const ontology = readFileSync("src/components/AssetOntology.tsx", "utf8");
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

describe("U3.05 governed civil and structural asset support", () => {
  it("extends canonical models without introducing parallel asset or evidence stores", () => {
    expect(migration).toContain("alter table public.asset_class_assignments");
    expect(migration).toContain(
      "references public.evidence_items(organization_id, id)",
    );
    expect(migration).toContain(
      "asset_condition_assessments remains the condition-rating overlay",
    );
    expect(migration).not.toMatch(/create table/i);
    expect(migration).toContain("insert into public.audit_events");
  });

  it("requires a named same-tenant human and verified non-AI evidence", () => {
    expect(migration).toContain("public.app_current_org()");
    expect(migration).toContain("public.app_current_role()");
    expect(migration).toContain("and organization_id = v_org");
    expect(migration).toContain("verification_status = 'verified'");
    expect(migration).toContain(
      "('MEASURED', 'INSPECTED', 'DOCUMENTED', 'EXPERT_JUDGEMENT')",
    );
    expect(migration).not.toContain("'ai_admin'");
    expect(migration).toContain("asset_id is null or asset_id = p_asset_id");
    expect(migration).toContain(
      "revoke all on function public.assign_asset_class_profile",
    );
    expect(migration).toContain("from public, anon");
  });

  it("makes classification and the structural rate refusal customer reachable", () => {
    expect(service).toContain('"assign_asset_class_profile"');
    expect(panel).toContain("normaliseRate(");
    expect(panel).toContain("Civil and structural operating path");
    expect(panel).toContain('to="/reliability"');
    expect(panel).toContain('to="/risk"');
    expect(ontology).toContain("<AssetClassGovernancePanel");
  });

  it("runs the tenant and evidence walls against a clean migrated database in CI", () => {
    expect(ci).toContain("bash scripts/ci-asset-classification-smoke.sh");
  });
});
