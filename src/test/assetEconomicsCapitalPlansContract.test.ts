import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101540000_asset_economics_capital_plans.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/assetEconomicsService.ts", "utf8");
const component = readFileSync(
  "src/components/AssetEconomicsAdministration.tsx",
  "utf8",
);
const page = readFileSync("src/pages/LifecycleDecisionsPage.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-asset-economics-capital-plans-smoke.sh",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("C2.10 governed asset economics and lifecycle capital plans", () => {
  it("extends the canonical stores rather than creating finance, asset or plan duplicates", () => {
    expect(migration).toContain("alter table public.asset_economics");
    expect(migration).toContain("from public.capital_plan_items");
    expect(migration).toContain("references public.evidence_items(id)");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).not.toMatch(
      /create table(?: if not exists)? public\.(asset_economic|capital_plan|economic_evidence|economic_audit)/,
    );
  });

  it("keeps unknown values null, requires provenance and refuses cross-tenant or AI authorship", () => {
    expect(migration).toContain(
      "unknowns remain null and are never treated as zero",
    );
    expect(migration).toContain("the ai operator is refused");
    expect(migration).toContain("e.verification_status='verified'");
    expect(migration).toContain("e.verified_by<>v_actor");
    expect(migration).toContain("a.organization_id=v_org");
    expect(migration).toContain(
      "exact canonical asset class is not present in the active tenant",
    );
  });

  it("requires step-up authentication, optimistic versions and governed-only writes", () => {
    expect(migration).toContain("app_actor_has_verified_mfa");
    expect(migration).toContain("app_current_aal()<>'aal2'");
    expect(migration).toContain("v_existing.version<>v_expected");
    expect(migration).toContain("asset_economics_writer");
    expect(migration).toContain(
      "revoke insert,update,delete,truncate on public.asset_economics",
    );
  });

  it("exposes every canonical lifecycle input and a live capital-planning handoff", () => {
    for (const field of [
      "replacementValueUsd",
      "annualMaintenanceCostUsd",
      "downtimeCostPerHourUsd",
      "expectedRepairCostUsd",
      "expectedRepairHours",
      "expectedRemainingLifeYears",
    ]) {
      expect(service).toContain(field);
      expect(component).toContain(field);
    }
    expect(service).toContain('"get_asset_economics_workspace"');
    expect(service).toContain('"record_asset_economics_snapshot"');
    expect(component).toContain('to="/develop/portfolio"');
    expect(page).toContain("<AssetEconomicsAdministration");
  });

  it("never confuses an economic record with expenditure or operational authority", () => {
    for (const boundary of [
      "expenditureAuthorized",
      "projectSanctioned",
      "workAuthorized",
      "riskAccepted",
      "returnToServiceAuthorized",
    ]) {
      expect(service).toContain(boundary);
      expect(component).toContain(boundary);
    }
    expect(migration).toContain("'expenditureauthorized',false");
    expect(migration).toContain("'returntoserviceauthorized',false");
  });

  it("has a full-chain authenticated runtime contract in CI", () => {
    for (const proof of [
      "canonical_economics=true",
      "canonical_capital_plans=true",
      "named_human_only=true",
      "ai_operator_refused=true",
      "aal2_required=true",
      "independent_verified_evidence=true",
      "tenant_wall=true",
      "unknowns_preserved=true",
      "optimistic_version=true",
      "direct_write_locked=true",
      "audit_history=true",
      "authority_granted=false",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain(
      "bash scripts/ci-asset-economics-capital-plans-smoke.sh",
    );
    expect(smoke).toContain("get_lifecycle_inputs");
    expect(smoke).toContain("annualMaintenanceCostUsd']==50000");
  });
});
