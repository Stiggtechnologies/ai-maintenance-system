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
  it("reconciles legacy whitespace variants instead of silently shrinking the population", () => {
    expect(sql).toContain(
      "lower(btrim(e.component))=lower(btrim(p_component))",
    );
    expect(sql).toContain("lower(btrim(component))");
    expect(sql).toContain("btrim(survival_overlay->>'liferef')");
    expect(sql).not.toContain("lower(e.component)=lower(btrim(p_component))");
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
  it("proves edge authorization with authenticated sessions, not incidental authentication failures", () => {
    expect(edge).toContain("userClient.auth.getUser()");
    expect(smoke).toContain("/auth/v1/token?grant_type=password");
    expect(smoke).toContain("/auth/v1/user");
    expect(smoke).toContain('authenticated "$FOREIGN_SESSION" "$FOREIGN"');
    expect(smoke).toContain("test \"$status\" = '403'");
    expect(smoke).toContain('analysis_denied "$AI_SESSION"');
    expect(smoke).toContain('analysis_denied "$FOREIGN_SESSION"');
    expect(smoke).toContain('FITTED=$(calculate "$AUTHOR_SESSION")');
    expect(smoke).not.toContain('denied "$(calculate');
    expect(smoke).toContain("mfa_enrollment_verified=false");
    expect(smoke).toContain("auth.identities");
    expect(smoke).toContain("factor_type,status,secret,created_at,updated_at");
  });
  it("distinguishes client RLS zero-row refusal from the privileged metadata-trigger refusal", () => {
    expect(smoke).toContain("CLIENT_STATUS=${CLIENT_FORGE##*$'\\n'}");
    expect(smoke).toContain("200) test \"$CLIENT_BODY\" = '[]'");
    expect(smoke).toContain(
      "select survival_version from component_life_events",
    );
    expect(smoke).toContain(
      'FORGE=$(sql_must_fail "update component_life_events',
    );
    expect(smoke).not.toContain('FORGE=$(sql_must_fail "begin; set local role');
  });
});
