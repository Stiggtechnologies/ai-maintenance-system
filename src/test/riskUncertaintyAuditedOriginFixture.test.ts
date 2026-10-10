import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const native = readFileSync(
  "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql",
  "utf8",
);
const privacy = native
  .split("-- U18 VISIBILITY CONTROLS BEGIN")[1]
  .split("-- U18 VISIBILITY CONTROLS END")[0];
const stateBody = native.match(
  /create function pg_temp\.u18_state\(\) returns jsonb language sql as \$\$([^]*?)\$\$/,
)![1];

// These are source contracts, not native PostgreSQL execution receipts. The
// unchanged full-chain CI entry point must execute the entire privacy matrix.
describe("U18 actual receipt-backed privacy qualification fixture", () => {
  it("creates both ancestry edges through the actual authenticated treatment writer", () => {
    expect(privacy).toContain("for generation in 1..2 loop");
    expect(privacy).toContain(
      "public.create_risk_treatment(origin_parent,option,false)",
    );
    expect(privacy).toContain("execute 'set local role authenticated'");
    expect(privacy).toContain("execute 'reset role'");
    expect(privacy).not.toMatch(/insert into public\.scenarios/i);
    expect(privacy).not.toMatch(/insert into public\.audit_events/i);
    expect(privacy).not.toMatch(/disable trigger|session_replication_role/i);
    expect(privacy).toContain(
      "parent:=origin_child; parent_scenario:=origin_scenario",
    );
    expect(privacy).toContain(
      "child:=origin_child; child_scenario:=origin_scenario",
    );
  });

  it("uses actual context, objective and fresh synthetic criteria adoption without changing the seed policy", () => {
    for (const writer of [
      "upsert_risk_context",
      "adopt_risk_context",
      "upsert_risk_objective",
      "adopt_risk_objective",
      "create_risk_criteria_version",
      "update_risk_criteria_draft",
      "adopt_risk_criteria",
    ])
      expect(privacy).toContain(`public.${writer}(`);
    expect(privacy).toContain(
      "'U18 audited privacy criteria '||grandparent::text",
    );
    expect(privacy).toContain("context_id,objective_id,criteria_profile_id");
    expect(privacy).toContain(
      "'risk_owner_id',case when generation=1 then f.author else f.reviewer end",
    );
  });

  it("asserts the exact returned and persisted origin receipts and all unexplained state changes", () => {
    for (const witness of [
      "origin_receipt_ids",
      "'risk_secondary_created'",
      "'risk_treatment'",
      "'previous_state'",
      "'new_state'",
      "'advisory_only'",
      "'human_decision_required'",
      "'recommendation_id'",
      "'approval_id'",
      "public.get_risk_secondary_origin_internal(origin_row)",
      "normalized_origin_state is distinct from origin_before",
      "not (x->>'id'=any(origin_receipt_ids))",
      "jsonb_agg(x order by x->>'id')",
      "pg_temp.u18_state() is distinct from baseline",
      "errcode='ZX014'",
    ])
      expect(privacy).toContain(witness);
    expect(privacy).toContain(
      "projection-only; not persisted cleared-link qualification",
    );
    expect(privacy).toContain("projected_origin.secondary_to_risk_id:=null");
    expect(privacy).toContain(
      "projected_origin.arising_from_scenario_id:=null",
    );
    expect(privacy).toContain(
      "contradictory typed-origin projection was accepted",
    );
  });

  it("extends both native and concurrent preservation oracles to context, objectives and recommendations", () => {
    const concurrent = readFileSync(
      "scripts/tests/risk-uncertainty-analysis-concurrency-postgres.mjs",
      "utf8",
    );
    for (const [key, table] of [
      ["contexts", "risk_context_nodes"],
      ["objectives", "risk_objectives"],
      ["recommendations", "recommendations"],
    ]) {
      expect(stateBody).toContain(`'${key}'`);
      expect(stateBody).toContain(`from ${table} `);
      expect(concurrent).toContain(`"${key}"`);
    }
  });

  it("executes public privacy mutations and foreign reads as authenticated, restoring the owner for complete-state witnesses", () => {
    const authenticatedCalls = privacy.matchAll(
      /execute 'set local role authenticated';\s*receipt:=(public\.(?:submit_risk_uncertainty_analysis|review_risk_uncertainty_analysis|get_risk_uncertainty_workspace)\([^]*?);\s*execute 'reset role';/g,
    );
    expect([...authenticatedCalls]).toHaveLength(5);
    expect(privacy).toContain(
      "receipt is distinct from jsonb_build_object('error','risk not found in this organization')",
    );
  });

  it("records inspection verification through the named human writer and accounts for its exact audit/security deltas", () => {
    expect(privacy).toContain("public.verify_evidence_item(evidence,");
    expect(privacy).toContain("'INSPECTED','unverified','high','direct','R2'");
    expect(privacy).not.toContain("'INSPECTED','verified',f.reviewer,now()");
    expect(privacy).toContain("'verified_by',f.reviewer");
    expect(privacy).toContain("'evidence_verification'");
    expect(privacy).toContain("verification_security_ids");
    expect(privacy).toContain(
      "normalized_verification_state is distinct from verification_before",
    );
    expect(privacy).not.toContain(
      "'app.evidence_verification_write','granted'",
    );
  });
});
