import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270103050000_risk_uncertainty_analysis.sql",
  "utf8",
);
const definition = (name: string) => {
  // Substantive writer invariants inspect the actual private implementation;
  // the public signature/auth/delegation/body parity have a separate contract.
  const implementation =
    name === "submit_risk_uncertainty_analysis"
      ? "submit_risk_uncertainty_analysis_internal"
      : name;
  return (
    migration.match(
      new RegExp(
        `create or replace function public\\.${implementation}\\([^]*?\\$\\$;`,
      ),
    )?.[0] ?? ""
  );
};
const helper = definition("risk_uncertainty_lock_visibility_context");

// These are source contracts, not proof of PostgreSQL scheduling or privacy.
// Native qualification must use the actual canonical rules and mutations.
describe("uncertainty canonical visibility-context serialization", () => {
  it("keeps the scoped helper private, volatile and non-definer without leaking a dependency projection", () => {
    expect(helper).toMatch(/returns boolean language plpgsql volatile/);
    expect(helper).not.toMatch(/security definer/i);
    expect(helper).not.toMatch(
      /return (?:jsonb_build_object|v_path|v_origins)/,
    );
    expect(migration).toContain(
      "revoke all on function public.risk_uncertainty_lock_visibility_context(uuid,uuid) from public,anon,authenticated,service_role",
    );
    expect(helper).toContain("auth.uid() is null");
    expect(helper).toContain("public.app_current_org() is distinct from p_org");
    expect(helper).toContain(
      "public.can_read_risk(p_risk_id) is distinct from true",
    );
  });

  it("walks every current canonical origin and refuses missing, invalid or cyclic lineage without an invented permission model", () => {
    for (const witness of [
      "public.get_risk_secondary_origin_internal(v_row)",
      "where id=v_cursor and organization_id=p_org",
      "v_cursor=any(v_path)",
      "v_origin->'valid' is distinct from 'true'::jsonb",
      "public.sync_text_as_uuid(v_origin->>'parent_id')",
    ])
      expect(helper).toContain(witness);
    expect(helper).not.toMatch(
      /risk_stakeholders|view\.status|v_pass in 1\.\.64/i,
    );
    expect(helper).not.toMatch(/information_sensitivity\s*(?:in|=)/i);
  });

  it("takes the complete deterministic same-org risk UPDATE fence before stakeholder or scenario locks", () => {
    const risks = helper.indexOf("perform r.id from public.risks r");
    const views = helper.indexOf(
      "perform sv.id from public.risk_stakeholder_views sv",
    );
    const scenarios = helper.indexOf("perform s.id from public.scenarios s");
    expect(risks).toBeGreaterThan(-1);
    expect(views).toBeGreaterThan(risks);
    expect(scenarios).toBeGreaterThan(views);
    expect(helper.slice(risks, views)).toContain(
      "where r.organization_id=p_org and r.id=any(v_path)",
    );
    expect(helper.slice(risks, views)).toContain(
      "order by r.id for update of r nowait",
    );
    expect(helper.slice(risks, views)).toContain(
      "v_locked<>cardinality(v_path)",
    );
  });

  it("locks all inverse view references to scoped canonical risks, including rows whose user/org could be corrected without rechecking their risk FK", () => {
    const views = helper.slice(
      helper.indexOf("perform sv.id from public.risk_stakeholder_views sv"),
      helper.indexOf("perform s.id from public.scenarios s"),
    );
    expect(views).toContain("join public.risks r on r.id=sv.risk_id");
    expect(views).toContain(
      "where r.organization_id=p_org and r.id=any(v_path)",
    );
    expect(views).toContain("order by sv.id for share of sv nowait");
    expect(views).not.toMatch(
      /sv\.(?:organization_id|stakeholder_user_id)\s*=/,
    );
    expect(views).not.toMatch(/to_jsonb|jsonb_agg|return/);
  });

  it("freezes scoped origin scenarios and recollects the full ordered lineage after all locks", () => {
    expect(helper).toContain(
      "where s.organization_id=p_org and s.id=any(v_scenarios)",
    );
    expect(helper).toContain("order by s.id for share of s nowait");
    expect(helper).toContain("for v_pass in 1..2 loop");
    expect(helper).toContain("v_path is distinct from v_initial_path");
    expect(helper).toContain("v_origins is distinct from v_initial_origins");
    expect(helper).toContain("return public.can_read_risk(p_risk_id) is true");
  });

  it("refuses lock contention in a prewrite subtransaction without retry, unrelated generic exceptions or new advisory-lock ordering", () => {
    expect(helper).toContain("exception when lock_not_available then");
    expect(helper).toContain("return false;");
    expect(helper).not.toMatch(
      /when others|pg_advisory|pg_sleep|\b(?:insert into|update|delete from) public\./i,
    );
  });

  it.each([
    "submit_risk_uncertainty_analysis",
    "review_risk_uncertainty_analysis",
  ])(
    "%s stabilizes visibility before its original target-only lock and retains final actor/visibility checks",
    (name) => {
      const body = definition(name);
      const visibility = body.indexOf(
        "public.risk_uncertainty_lock_visibility_context(",
      );
      const risk = body.indexOf("select * into r from public.risks");
      const actor = body.indexOf("where id=v_user for share");
      const write = body.indexOf(
        name.startsWith("submit")
          ? "insert into public.risk_uncertainty_analyses"
          : "insert into public.approvals",
      );
      expect(visibility).toBeGreaterThan(-1);
      expect(risk).toBeGreaterThan(visibility);
      expect(actor).toBeGreaterThan(risk);
      expect(write).toBeGreaterThan(actor);
      expect(body.slice(actor, write)).toContain(
        "public.can_read_risk(r.id) is distinct from true",
      );
      expect(body.slice(visibility, risk)).toContain(
        "'risk not found in this organization'",
      );
    },
  );

  it("specifies actual canonical visibility branches, two-tenant snapshots, private ACLs and complete rollback without pretending these are concurrency execution", () => {
    const native = readFileSync(
      "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql",
      "utf8",
    );
    const control =
      native
        .split("-- U18 VISIBILITY CONTROLS BEGIN")[1]
        ?.split("-- U18 VISIBILITY CONTROLS END")[0] ?? "";
    for (const witness of [
      "public.risk_uncertainty_lock_visibility_context(f.org,child)",
      "'public','internal','confidential'",
      "risk_owner_id=f.reviewer",
      "decision_owner_id=f.reviewer",
      "status='withdrawn'",
      "organization_id=f.foreign_org",
      "public.submit_risk_uncertainty_analysis(child",
      "public.review_risk_uncertainty_analysis(packet",
      "has_function_privilege",
      "'anon','authenticated','service_role'",
      "pg_temp.u18_state() is distinct from snapshot",
      "pg_temp.u18_state() is distinct from baseline",
      "errcode='ZX014'",
    ])
      expect(control).toContain(witness);
    expect(native).toContain("'stakeholderViews'");
    expect(native).toContain("'scenarios'");
    expect(native).toContain("'profiles'");
    expect(native).toContain("(select foreign_org from u18_fixture)");
    const concurrency = readFileSync(
      "scripts/tests/risk-uncertainty-analysis-concurrency-postgres.mjs",
      "utf8",
    );
    expect(concurrency).toContain('"(select foreign_org from u18_fixture)"');
    expect(concurrency).toContain("f.foreign_org");
  });
});
