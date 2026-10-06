import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20270102390000_governed_survival_covariates.sql",
  "utf8",
).toLowerCase();
const edge = readFileSync(
  "supabase/functions/calculation-service/index.ts",
  "utf8",
);
const smoke = readFileSync("scripts/ci-survival-covariate-smoke.sh", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("C7.14 governed canonical covariates", () => {
  it("extends canonical life events, evidence, approvals and calculation lineage without a parallel store", () => {
    expect(sql).toContain("alter table public.component_life_events");
    expect(sql).toContain("public.evidence_items");
    expect(sql).toContain("insert into public.approvals");
    expect(sql).toContain("public.record_calculation_run(");
    expect(sql).not.toMatch(/create table/i);
  });
  it("requires exact-source independent human review and AAL2 for mutations", () => {
    expect(sql).toContain("survival_recorded_by=auth.uid()");
    expect(sql).toContain("public.app_current_aal() is distinct from 'aal2'");
    expect(sql).toContain(
      "v_current is distinct from e.survival_evidence_snapshot",
    );
    expect(sql).toContain("'kind','survival_covariate_overlay'");
    expect(sql).toContain("survival_version<>p_expected_version");
  });
  it("preserves quarantine, supersession, claim-purpose and tenant walls", () => {
    expect(sql).toContain("security_status in ('cleared','released')");
    expect(sql).toContain("superseded_by_document_id is null");
    expect(sql).toContain("public.get_kb_corpus_posture()");
    expect(sql).toContain("'failure_behaviour'=any(c.\"permittedclaims\")");
    expect(sql).toContain("s.review_state='approved'");
    expect(sql).toContain("s.superseded_by_source_id is null");
    expect(sql).toContain("organization_id=p_organization_id");
  });
  it("uses retained runs and adopted controls, including refusals, not model-created operational authority", () => {
    expect(sql).toContain("public.evaluate_agent_control_internal(");
    expect(sql).toContain("'analyse_censored_life_data'");
    expect(sql).toContain("insert into public.agent_runs");
    expect(sql).toContain("'may_change_pm_interval',false");
    expect(sql).toContain("'may_create_work',false");
    expect(sql).toContain("'may_accept_risk',false");
    expect(sql).toContain("'may_return_to_service',false");
    expect(sql).toContain("p_source_snapshot is distinct from v_source");
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended(");
  });
  it("executes server-derived observations through the qualified shared kernel and retains runtime proof", () => {
    expect(edge).toContain('body.action === "reliability_survival"');
    expect(edge).toContain("prepareSurvivalSource(source.events, covariates)");
    expect(edge).toMatch(/fitCox\(\s*prepared\.rows/);
    expect(edge).toContain('"record_survival_calculation"');
    expect(workflow).toContain("bash scripts/ci-survival-covariate-smoke.sh");
    for (const invariant of [
      "independent_exact_review=true",
      "tenant_wall=true",
      "retained_fit=true",
      "retained_refusal=true",
      "predictive_qualification=false",
      "operational_authority=false",
    ]) {
      expect(smoke).toContain(invariant);
    }
  });
});
