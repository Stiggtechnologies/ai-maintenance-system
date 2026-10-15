import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20270103050000_risk_uncertainty_analysis.sql",
  "utf8",
);
const definition = (name: string) =>
  sql.match(
    new RegExp(`create or replace function public\\.${name}\\([^]*?\\$\\$;`),
  )?.[0] ?? "";
const standing = definition("risk_uncertainty_review_standing");
const policy = definition("risk_uncertainty_current_policy_digest");
const native = readFileSync(
  "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql",
  "utf8",
);

// Source contracts only. The public reader and real legacy policy-drift
// witness still require fresh native execution, not this substring suite.
describe("uncertainty structural input/policy standing", () => {
  it("keeps both read-only helpers private without inventing human or source authority", () => {
    for (const name of [
      "risk_uncertainty_review_standing",
      "risk_uncertainty_current_policy_digest",
    ]) {
      expect(definition(name)).toMatch(/returns text language plpgsql stable/);
      expect(sql).toContain(
        `revoke all on function public.${name}(uuid,uuid) from public,anon,authenticated,service_role`,
      );
    }
    expect(standing).not.toMatch(
      /insert into|update public|delete from|review_due_at|security definer|role\s+(?:in|=)/i,
    );
  });

  it("binds policy digest to the existing scoped UTC projection rather than lossy client JSON", () => {
    expect(policy).toContain("public.risk_uncertainty_input_binding_snapshot");
    expect(policy).toContain("'currentCriteria'");
    expect(policy).toContain("'currentCriteriaProfileId'");
    expect(policy).toContain("'organizationId',p_org,'riskId',p_risk_id");
    expect(policy).toContain("extensions.digest");
    expect(policy).toContain("'sha256'");
    expect(policy).toContain("return null;");
    expect(policy).not.toMatch(
      /can_read_risk|approval|source_reference|::numeric/,
    );
  });

  it("uses only the actual same-org packet, risk pointer and current canonical adopted policy", () => {
    expect(standing).toContain(
      "where id=p_analysis_id and organization_id=p_org",
    );
    expect(standing).toContain("select cp.* into c");
    expect(standing).toContain("cp.id=r.criteria_profile_id");
    expect(standing).toContain("cp.organization_id=p_org");
    expect(standing).not.toContain("select c.* into c");
    expect(standing).toContain("r.organization_id=p_org");
    expect(standing).toContain("c.status is distinct from 'adopted'");
    expect(standing).toContain("c.decision_thresholds='{}'::jsonb");
    expect(standing).toContain("return 'policy_unavailable';");
  });

  it("separates equal legacy metadata digest from mismatched current policy", () => {
    expect(standing).toContain("c.id is distinct from a.threshold_profile_id");
    expect(standing).toContain(
      "c.decision_thresholds is distinct from a.decision_thresholds",
    );
    expect(standing).toContain("return 'replacement_required';");
    expect(standing).not.toContain("digest_version=2");
    expect(standing).not.toContain("risk_uncertainty_analysis_digest_v1");
  });

  it("requires actual current verified same-risk bindings and live digest before structural reviewability", () => {
    expect(standing).toContain("v_count not between 1 and 20");
    expect(standing).toContain(
      "b.organization_id=p_org and b.analysis_id=a.id",
    );
    expect(standing).toContain(
      "e.organization_id=p_org and e.risk_id=a.risk_id",
    );
    expect(standing).toContain("e.verification_status='verified'");
    expect(standing).toContain(
      "public.risk_uncertainty_analysis_digest(p_org,a.id)",
    );
    expect(standing).toContain("is distinct from a.analysis_digest");
    expect(standing).toContain("return 'reviewable';");
  });

  it("exposes policy CAS and per-packet standing from private server projections", () => {
    const reader = definition("get_risk_uncertainty_workspace");
    expect(reader).toContain(
      "'policyDigest',public.risk_uncertainty_current_policy_digest(v_org,r.id)",
    );
    expect(reader).toContain("'reviewStanding',a.review_standing");
    expect(reader).toContain(
      "public.risk_uncertainty_review_standing(v_org,x.id) as review_standing",
    );
    expect(reader).toContain(
      "when a.analysis_digest is distinct from v_current then 'stale'",
    );
    expect(reader).toContain("'operationalAuthorization',false");
  });

  it("reuses the predicate in independent review after existing waits while retaining specific refusal checks", () => {
    const review = definition("review_risk_uncertainty_analysis");
    const check = review.indexOf(
      "public.risk_uncertainty_review_standing(v_org,a.id)",
    );
    expect(check).toBeGreaterThan(review.indexOf("where id=v_user for share"));
    expect(check).toBeLessThan(review.indexOf("insert into public.approvals"));
    expect(review).toContain("v_current is distinct from a.analysis_digest");
    expect(review).toContain(
      "linked evidence is no longer verified; submit a new analysis version",
    );
    expect(review).toContain(
      "analysis author cannot independently review the same packet",
    );
  });

  it("specifies real public/legacy reads, exact private ACL refusals and rollback probes without treating source as execution", () => {
    const controls =
      native
        .split("-- U18 REVIEW STANDING CONTROLS BEGIN")[1]
        ?.split("-- U18 REVIEW STANDING CONTROLS END")[0] ?? "";
    expect(controls).toContain(
      "array['draft','superseded','empty','missing','threshold','evidence']",
    );
    expect(controls).toContain("public.get_risk_uncertainty_workspace(f.risk)");
    expect(controls).toContain("array['anon','authenticated','service_role']");
    expect(controls).toContain("permission denied for function ");
    expect(controls).toContain("current_user is distinct from original_role");
    expect(controls).toContain("Pacific/Honolulu");
    expect(controls).toContain("pg_temp.u18_state() is distinct from baseline");
    expect(controls).toContain("ZX015");
    expect(controls).not.toMatch(
      /disable trigger|session_replication_role|app\.risk_uncertainty_write/,
    );
    const legacy =
      native
        .split("-- U18 LEGACY CRITERIA REFUSAL BEGIN")[1]
        ?.split("-- U18 LEGACY CRITERIA REFUSAL END")[0] ?? "";
    expect(legacy).toContain(
      "legacy_item->>'reviewStanding' is distinct from 'replacement_required'",
    );
    expect(legacy).toContain(
      "legacy_item->>'validationStatus' is distinct from 'pending_review'",
    );
    expect(legacy).toContain(
      "legacy_item->>'currentDigest' is distinct from current_digest",
    );
    expect(legacy).toContain("policyDigest");
  });
});
