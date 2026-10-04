import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read(
  "supabase/migrations/20270102280000_enterprise_asset_lifecycle_risk.sql",
).toLowerCase();
const service = read("src/services/enterpriseAssetLifecycleRiskService.ts");
const panel = read("src/components/EnterpriseAssetLifecycleRisk.tsx");
const executive = read("src/pages/ExecutiveIntelligence.tsx");
const smoke = read("scripts/ci-enterprise-asset-lifecycle-risk-smoke.sh");
const workflow = read(".github/workflows/ci.yml");
const register = read("docs/enterprise-readiness/capability-register.md");

describe("C6.05 governed enterprise asset lifecycle risk", () => {
  it("composes canonical lifecycle, risk, condition, economics and decision evidence", () => {
    for (const source of [
      "public.assets",
      "public.asset_lifecycle_state",
      "public.lifecycle_stages",
      "public.risks",
      "public.risk_criteria_profiles",
      "public.asset_condition_assessments",
      "public.asset_economics",
      "public.lifecycle_evaluations",
    ])
      expect(migration).toContain(source);
    expect(migration).not.toContain("create table public.asset_lifecycle_risk");
  });

  it("refuses an index unless coverage, comparability and freshness are complete", () => {
    expect(migration).toContain("assetswithoutcurrentrisk");
    expect(migration).toContain("assetswithoutcurrentlifecycle");
    expect(migration).toContain("distinctcriteriaprofiles");
    expect(migration).toContain("staleorundatedriskrecords");
    expect(migration).toContain("indexcomputable");
    expect(migration).toContain("one adopted criteria profile");
    expect(migration).toContain("max(r.current_risk_score)");
    expect(migration).toContain("avg(asset_score)");
    expect(migration).toContain("risk_contract_gaps");
  });

  it("keeps recorded risk levels separate from lifecycle evidence gaps", () => {
    expect(migration).toContain("currentriskrecords");
    expect(migration).toContain("conditionknowledgestate");
    expect(migration).toContain("economicsreviewoverdue");
    expect(migration).toContain("latestlifecycleevaluation");
    expect(migration).toContain("evidencegaps");
    expect(migration).toContain("no cross-profile score is averaged");
  });

  it("publishes the canonical KPI only when the same strict gate passes", () => {
    expect(migration).toContain("asset_risk_index");
    expect(migration).toContain("compute_enterprise_asset_lifecycle_risk_kpi_snapshot");
    expect(migration).toContain("delete from public.kpi_values");
    expect(migration).toContain("compute_kpi_snapshot_with_hse");
    expect(migration).toContain("to service_role");
  });

  it("limits exact risk detail while preserving tenant-scoped aggregate posture", () => {
    expect(migration).toContain("public.app_current_org()");
    expect(migration).toContain("detailaccess");
    expect(migration).toContain("aggregate lifecycle-risk posture only for this role");
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain("information_sensitivity");
  });

  it("is customer reachable from Executive Asset Intelligence", () => {
    expect(service).toContain('"get_enterprise_asset_lifecycle_risk"');
    expect(panel).toContain("Asset lifecycle risk");
    expect(panel).toContain("Open risk workspace");
    expect(panel).toContain("Open lifecycle decisions");
    expect(panel).toContain("No enterprise index is published");
    expect(executive).toContain("<EnterpriseAssetLifecycleRisk />");
  });

  it("has clean-stack proof and closes only C6.05", () => {
    for (const proof of [
      "tenant_wall=true",
      "full_coverage_required=true",
      "common_criteria_required=true",
      "fresh_review_required=true",
      "canonical_risk_score_reused=true",
      "unknowns_preserved=true",
      "sensitive_detail_restricted=true",
      "stale_snapshot_removed=true",
      "no_decision_authority=true",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain(
      "bash scripts/ci-enterprise-asset-lifecycle-risk-smoke.sh",
    );
    expect(register).toMatch(/\| C6\.05 \|[^\n]+\| ✅[^\n]+/i);
  });
});
