import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270103050000_risk_uncertainty_analysis.sql",
  "utf8",
);
const http = readFileSync(
  "scripts/tests/risk-uncertainty-analysis-http-smoke.mjs",
  "utf8",
);
const native = readFileSync(
  "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql",
  "utf8",
);
function body(name: string) {
  const value = migration.match(
    new RegExp(
      `create or replace function public\\.${name}\\([^]*?as \\$\\$([^]*?)\\$\\$;`,
    ),
  )?.[1];
  expect(value, `${name} is implemented`).toBeDefined();
  return value?.replace(/--[^\n]*/g, "").replace(/\s+/g, " ") ?? "";
}

// Source contracts only. Public execution, actual locks, rollback and transport
// reconciliation must also qualify in isolated PostgreSQL/GoTrue/PostgREST.
describe("U18 atomic uncertainty replacement source contract", () => {
  it("specifies archived, independently reviewed and superseded predecessor refusals", () => {
    const block =
      native
        .split("-- U18 REPLACEMENT AUTHORITY REFUSALS BEGIN")[1]
        ?.split("-- U18 REPLACEMENT AUTHORITY REFUSALS END")[0] ?? "";
    for (const mode of ["archived", "validated", "rejected", "superseded"])
      expect(block).toContain(`('${mode}')`);
    expect(block).toContain("if attempts<>13");
    expect(block).toContain(
      "public.review_risk_uncertainty_analysis(packet,mode",
    );
  });
  it("specifies an actual three-packet reciprocal middle chain with forced deferred checks and rollback", () => {
    const block =
      native
        .split("-- U18 MIDDLE REPLACEMENT CHAIN BEGIN")[1]
        ?.split("-- U18 MIDDLE REPLACEMENT CHAIN END")[0] ?? "";
    expect(block).not.toBe("");
    expect(block).toContain("public.replace_risk_uncertainty_analysis");
    expect(block).toContain("set constraints all immediate");
    expect(block).toContain("middle->>'replaces_analysis_id'");
    expect(block).toContain("middle->>'superseded_by_analysis_id'");
    expect(block).toContain("pg_temp.u18_history_refusals(successor,true)");
    expect(block).toContain(
      "pg_temp.u18_state() is distinct from chain_baseline",
    );
  });
  it("specifies real HTTP lost-body reconciliation and immutable replay after the actual due date", () => {
    const block =
      http
        .split("// U18 ATOMIC REPLACEMENT HTTP BEGIN")[1]
        ?.split("// U18 ATOMIC REPLACEMENT HTTP END")[0] ?? "";
    expect(block).not.toBe("");
    expect(block).toContain("droppedResponse.body.cancel()");
    expect(block).toContain('rpc("get_risk_uncertainty_replacement_receipt"');
    expect(block).toContain('rpc("replace_risk_uncertainty_analysis"');
    expect(block).toContain("Date.now() > Date.parse(replacementDueAt)");
    expect(block).toContain(
      "assert.deepEqual(replacementState(), committedState)",
    );
    expect(http).toContain("const replacementState = () =>");
    expect(block).toContain(
      "assert.deepEqual(replacement, expectedReplacement)",
    );
    expect(block).toContain("Date.parse(replacement.review_due_at)");
    expect(block).toContain("Object.keys(receipt).sort()");
    expect(block).toContain(
      "assert.deepEqual(receipt.compareAndSwap, expectedCas)",
    );
  });
  it("hashes the exact bounded UTF-8 text and parses that same request", () => {
    const replace = body("replace_risk_uncertainty_analysis");
    expect(replace).toContain(
      "octet_length(convert_to(p_request_text,'UTF8'))>1048576",
    );
    expect(replace).toContain(
      "extensions.digest(convert_to(p_request_text,'UTF8'),'sha256')",
    );
    expect(replace).toContain("v_request:=p_request_text::jsonb");
    expect(replace).toContain(
      "v_request->'contractVersion' is distinct from '1'::jsonb",
    );
    expect(replace).toContain(
      "v_request->>'action' is distinct from 'replace'",
    );
    expect(replace).toContain(
      "public.submit_risk_uncertainty_analysis_internal(",
    );
  });

  it("shares submission validation and resolves durable committed intents before live pending/CAS gates", () => {
    const writer = body("submit_risk_uncertainty_analysis_internal");
    expect(writer).toContain("replacement_intent_id=v_intent");
    const replay = writer.indexOf(
      "replacement_request_fingerprint is distinct from v_fingerprint",
    );
    const pending = writer.indexOf(
      "v_predecessor.status is distinct from 'pending_review'",
    );
    const snapshot = writer.indexOf(
      "v_predecessor.analysis_digest is distinct from",
    );
    const future = writer.indexOf("v_review_due<=now()");
    expect(replay).toBeGreaterThan(-1);
    expect(pending).toBeGreaterThan(replay);
    expect(snapshot).toBeGreaterThan(replay);
    expect(future).toBeGreaterThan(replay);
    expect(writer).toContain("v_predecessor.author_id is distinct from v_user");
    expect(writer).toContain(
      "public.risk_uncertainty_review_standing(v_org,v_predecessor.id) is distinct from 'replacement_required'",
    );
  });

  it("locks the sorted union of trusted predecessor bindings and new scoped evidence before current-profile recheck", () => {
    const writer = body("submit_risk_uncertainty_analysis_internal");
    expect(writer).toContain("b.analysis_id=v_predecessor.id");
    expect(writer).toContain("e.id=any(v_lock_evidence_ids)");
    expect(writer).toContain("order by e.id for update of e");
    const locks = writer.indexOf("e.id=any(v_lock_evidence_ids)");
    expect(locks).toBeGreaterThan(-1);
    expect(
      writer.indexOf(
        "select organization_id,role into v_locked_org,v_role",
        locks,
      ),
    ).toBeGreaterThan(locks);
    expect(writer).toContain(
      "public.risk_uncertainty_current_policy_digest(v_org,r.id) is distinct from p_replacement->>'policyDigest'",
    );
    expect(writer).toContain(
      "public.risk_uncertainty_analysis_digest(v_org,v_predecessor.id) is distinct from",
    );
  });

  it("supersedes only after validation and creates exactly one replacement audit after canonical writes", () => {
    const writer = body("submit_risk_uncertainty_analysis_internal");
    const validation = writer.indexOf(
      "v_input_binding_snapshot->'bindingComplete'",
    );
    const transition = writer.indexOf("set status='superseded'");
    const insert = writer.indexOf(
      "insert into public.risk_uncertainty_analyses",
    );
    const audit = writer.indexOf("'risk_uncertainty_analysis_replaced'");
    expect(validation).toBeGreaterThan(-1);
    expect(transition).toBeGreaterThan(validation);
    expect(insert).toBeGreaterThan(transition);
    expect(audit).toBeGreaterThan(
      writer.indexOf("update public.risks set value_of_information"),
    );
    // The one policy-contention handler unwinds the entire function block;
    // no normal return after DML may acknowledge an error/partial commit.
    const policyRollback = writer.lastIndexOf(
      "exception when sqlstate 'U1801'",
    );
    expect(policyRollback).toBeGreaterThan(transition);
    const afterTransition = writer.slice(transition, policyRollback);
    expect(afterTransition).not.toMatch(/return jsonb_build_object\('error'/);
    expect(afterTransition).toContain("raise exception");
    expect(writer.slice(policyRollback).trim()).toBe(
      "exception when sqlstate 'U1801' then return jsonb_build_object('error','criteria profile is busy; reload the governed workspace'); end",
    );
    expect(writer).not.toMatch(
      /insert into public\.(?:approvals|evidence_items|decisions|work_orders)/,
    );
    expect(migration).toContain("'risk_uncertainty_analysis_replaced'");
  });

  it("refuses replacement evidence contention before DML to avoid inverse risk-FK restoration deadlocks", () => {
    const writer = body("submit_risk_uncertainty_analysis_internal");
    expect(writer).toMatch(
      /if p_replacement is not null then begin perform 1 from public\.evidence_items e where e\.id=any\(v_lock_evidence_ids\) order by e\.id for update of e nowait; exception when lock_not_available then return jsonb_build_object\('error','replacement evidence is busy; reload the governed workspace'\); end; else/,
    );
    const evidenceAcquisition = writer.indexOf(
      "if p_replacement is not null then begin perform 1 from public.evidence_items",
    );
    expect(evidenceAcquisition).toBeGreaterThan(-1);
    expect(
      writer.indexOf(
        "exception when lock_not_available then",
        evidenceAcquisition,
      ),
    ).toBeLessThan(writer.indexOf("set status='superseded'"));
  });

  it("exposes a read-only exact-scope intent reconciliation without retry or mutation authority", () => {
    const reconcile = body("get_risk_uncertainty_replacement_receipt");
    expect(reconcile).toContain("auth.uid()");
    expect(reconcile).toContain("public.app_current_org()");
    expect(reconcile).toContain("public.can_read_risk(p_risk_id)");
    expect(reconcile).toContain("a.author_id=v_user");
    expect(reconcile).toContain("a.replacement_intent_id=p_intent_id");
    expect(reconcile).toContain(
      "a.replacement_request_fingerprint=p_request_fingerprint",
    );
    expect(reconcile).not.toMatch(
      /\b(?:insert|update|delete)\b|submit_risk_uncertainty_analysis_internal\(/,
    );
    expect(migration).toContain(
      "grant execute on function public.get_risk_uncertainty_replacement_receipt(uuid,uuid,text) to authenticated;",
    );
    expect(migration).toContain(
      "revoke all on function public.replace_risk_uncertainty_analysis(uuid,text) from public,anon,service_role;",
    );
  });
});
