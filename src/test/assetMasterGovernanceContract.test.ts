import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101780000_asset_master_governance.sql",
  "utf8",
).toLowerCase();
const service = readFileSync(
  "src/services/assetMasterGovernanceService.ts",
  "utf8",
);
const workbench = readFileSync(
  "src/components/AssetMasterGovernanceWorkbench.tsx",
  "utf8",
);
const page = readFileSync("src/pages/AssetTwinsPage.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-asset-master-governance-smoke.sh",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("E12.01 / E12.02 asset-master governance", () => {
  it("extends canonical records instead of creating a parallel asset model", () => {
    for (const canonical of [
      "public.asset_twin_templates",
      "public.asset_class_aliases",
      "public.asset_class_twin_map",
      "public.unit_numbering_rules",
      "public.asset_twin_instances",
      "public.audit_events",
    ])
      expect(migration).toContain(canonical);
    expect(migration).toContain("public.apply_unit_numbering");
    expect(migration).not.toMatch(
      /create table if not exists public\.(asset|twin|audit)/,
    );
  });

  it("keeps tenant templates private and closes legacy definer bypasses", () => {
    expect(migration).toContain(
      "sharing_scope='shared' or owner_organization_id=public.app_current_org()",
    );
    expect(migration).toContain("sharing_scope','tenant_private'");
    expect(migration).toContain(
      "revoke all on function public.compile_asset_twin",
    );
    expect(migration).toContain(
      "revoke all on function public.provision_twin_instances",
    );
    expect(migration).toContain(
      "revoke all on function public.apply_unit_numbering",
    );
    expect(migration).toContain(
      "revoke all on function public.promote_structural_contribution",
    );
    expect(migration).toContain(
      "revoke insert,update,delete on public.asset_twin_instances",
    );
  });

  it("requires evidence and independent review before mapping or provisioning", () => {
    expect(migration).toContain(
      "a canonical template requires at least one component",
    );
    expect(migration).toContain(
      "template payload must describe a class, not identify a tenant asset",
    );
    expect(migration).toContain(
      "independent review requires a reviewer other than the author",
    );
    expect(migration).toContain(
      "independent review requires accountable engineering authority",
    );
    expect(migration).toContain(
      "template key does not resolve to a reviewed template visible to this tenant",
    );
    expect(migration).toContain(
      "x.maturity in ('engineer_reviewed','field_validated','approved')",
    );
  });

  it("keeps naming conservative and draft-only", () => {
    expect(migration).toContain(
      "a model cannot be asserted without a manufacturer",
    );
    expect(migration).toContain("public.apply_unit_numbering(not p_apply)");
    expect(migration).toContain(
      "draft instances only; no oem overlay or active status granted",
    );
  });

  it("is customer reachable from Twin & Naming Coverage", () => {
    for (const rpc of [
      "get_asset_master_governance_workspace",
      "record_tenant_asset_twin_template",
      "review_tenant_asset_twin_template",
      "record_asset_class_governance",
      "record_unit_numbering_rule",
      "run_governed_unit_numbering",
      "run_governed_twin_provisioning",
    ])
      expect(service).toContain(`"${rpc}"`);
    expect(workbench).toContain("Record private draft");
    expect(workbench).toContain("Record governed mapping");
    expect(workbench).toContain("Record numbering rule");
    expect(workbench).toContain("Provision draft twins");
    expect(page).toContain("<AssetMasterGovernanceWorkbench />");
  });

  it("has runtime proof and closes both register rows", () => {
    for (const proof of [
      "tenant_wall=true",
      "direct_write_closed=true",
      "named_human=true",
      "independent_review=true",
      "engineering_authority=true",
      "private_template=true",
      "class_mapping=true",
      "numbering_fill_only=true",
      "mismatch_not_corrected=true",
      "draft_twins=true",
      "no_oem_invention=true",
      "audit_provenance=true",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain(
      "bash scripts/ci-asset-master-governance-smoke.sh",
    );
    expect(register).toMatch(/\| E12\.01 \|[^\n]+\| ✅[^\n]+/i);
    expect(register).toMatch(/\| E12\.02 \|[^\n]+\| ✅[^\n]+/i);
  });
});
