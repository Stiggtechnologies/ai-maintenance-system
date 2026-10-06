import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  "scripts/tests/risk-uncertainty-analysis-concurrency-postgres.mjs",
  "utf8",
);

// Source and containment contracts only. This suite never substitutes mocked
// SQL for the exact-head disposable PostgreSQL concurrency qualification.
describe("U18 native visibility-context concurrency harness", () => {
  it("retains the reviewed seed, narrow CI entry point and four real-session protocol", () => {
    for (const witness of [
      'assert.equal(process.env.GITHUB_ACTIONS, "true")',
      '"1707a52effd3556b025cce99df081a360924d63904d604f94bec2e616f4ab379"',
      'session("monitor")',
      'session("barrier")',
      'session("reviewer")',
      'session("criterion-writer")',
      "pg_backend_pid()",
      "pg_blocking_pids",
      "SIGKILL",
      "assert(ended)",
    ])
      expect(script).toContain(witness);
    expect(script).toContain('"(select org from u18_fixture)"');
    expect(script).toContain('"(select foreign_org from u18_fixture)"');
    expect(script).toContain("const allowedPhases = new Set([");
    expect(script).toContain("assert(allowedPhases.has(phase))");
    expect(script).toContain("markPhase(writerCase.label)");
    expect(script).toContain("markPhase(helperCase.label)");
    expect(script).toContain("failed: ${currentPhase}");
    expect(script).not.toMatch(/disable trigger|session_replication_role/i);
  });

  it("uses fresh typed privacy fixtures and the real public mutation RPCs", () => {
    for (const witness of [
      "U18_VISIBILITY_FIXTURE",
      "risk_criteria_profiles",
      "secondary_to_risk_id",
      "arising_from_scenario_id",
      "information_sensitivity",
      "risk_stakeholder_views",
      "organization_id,stakeholder_user_id,risk_id",
      "public.submit_risk_uncertainty_analysis",
      "public.review_risk_uncertainty_analysis",
      "Synthetic independent visibility-context qualification",
    ])
      expect(script).toContain(witness);
  });

  it("qualifies writer-wins NOWAIT refusals and partial-lock release without treating timeout as success", () => {
    const writer = script.slice(
      script.indexOf("// Writer wins:"),
      script.indexOf("// Helper wins:"),
    );
    for (const witness of [
      "U18_WRITER_WINS_TARGET",
      "U18_WRITER_WINS_ANCESTOR",
      "U18_WRITER_WINS_VIEW",
      "U18_WRITER_WINS_SCENARIO",
      "risk not found in this organization",
      "for update nowait",
      "writerWinsElapsedMs",
      "U18_PARTIAL_LOCK_RELEASE",
    ])
      expect(script).toContain(witness);
    expect(writer).toContain("assert(writerWinsElapsedMs < 5000)");
    expect(writer).toContain('operation: "submit"');
    expect(writer).toContain('operation: "review"');
    expect(writer).toContain("assert.deepEqual(await state(), before)");
    expect(writer).toContain("begin; ${");
    expect(writer).toContain("U18_OUTER_REFUSAL_TRANSACTION_OPEN");
    expect(writer).toContain("actorStateInsideRefusal");
    expect(writer).toContain("await actor.query(`reset role; ${stateSQL}`)");
    expect(writer).toContain(
      "assert.deepEqual(actorStateInsideRefusal, before)",
    );
    expect(writer).toContain("await changer.query(`begin;");
    expect(writer).toContain("for update nowait");
    expect(writer.indexOf("for update nowait")).toBeLessThan(
      writer.indexOf('await actor.query("rollback")'),
    );
    expect(writer).toContain('await actor.query("rollback")');
    expect(writer).toContain("assert.deepEqual(await state(), before)");
    expect(writer).toContain('await barrier.query("rollback")');
    expect(script).not.toMatch(/timeout[^\n]*(?:pass|success)/i);
  });

  it("qualifies helper-wins review and submit barriers with exact artifacts and no authority", () => {
    const helper = script.slice(
      script.indexOf("// Helper wins:"),
      script.indexOf("// U18_SUBMIT_EVIDENCE_BARRIER"),
    );
    for (const witness of [
      "U18_HELPER_WINS_ANCESTOR_WRITE",
      "U18_HELPER_WINS_VIEW_DELETE",
      "U18_HELPER_WINS_NEW_GRANT",
      "U18_HELPER_WINS_VIEW_REPOINT",
      "U18_HELPER_WINS_WRONG_ORG_CORRECTION",
      "U18_HELPER_WINS_SCENARIO_WRITE",
      "U18_SUBMIT_EVIDENCE_BARRIER",
      "lock table public.approvals in share mode",
      "approvalId",
      "derivedEvidenceItemId",
      "operationalAuthorization",
      "risk_uncertainty_analysis_reviewed",
      "risk_uncertainty_analysis_submitted",
    ])
      expect(script).toContain(witness);
    expect(helper).toContain("await blocked(actorPid, barrierPid)");
    expect(helper).toContain("await blocked(changerPid, actorPid)");
    expect(helper).not.toContain("${stateSQL}");
    expect(helper).not.toContain("const expected = json(await changing)");
    expect(helper).toContain("assertReviewStateTransition(");
    expect(script).toContain("U18_NORMALIZED_WHOLE_STATE");
    expect(script).toContain("assert.deepEqual(normalized, before)");
    for (const key of [
      "risks",
      "packets",
      "bindings",
      "approvals",
      "audit",
      "evidence",
      "criteria",
      "securityEvents",
      "decisions",
      "work",
      "stakeholderViews",
      "scenarios",
      "profiles",
    ])
      expect(script).toContain(`"${key}"`);
    expect(script).toContain("approvalAudits.length, 1");
    expect(script).toContain("reviewAudit.event_data.approval_id");
    expect(script).toContain("approval.approval_scope.kind");
    expect(script).toContain("approval.approval_scope.version");
    expect(script).toContain("approval.approval_scope.analysisDigest");
    expect(script).toContain('derived.verification_status, "unverified"');
    expect(script).toContain("derived.provenance.analysisDigest");
    expect(script).toContain("derived.provenance.operationalAuthorization");
    expect(script).toContain("U18_REVIEW_VOI_INPUT_FIELDS_UNCHANGED");
    expect(script).toContain("assertSubmitStateTransition(");
    expect(script).toContain("risk_uncertainty_input_binding_snapshot");
    expect(script).toContain("risk_uncertainty_analysis_digest");
    expect(script).toContain(
      "persisted.input_binding_snapshot, expectedSnapshot",
    );
    expect(script).toContain("Object.keys(persisted).sort()");
    expect(script).toContain("U18_DELETED_VIEW_WORKSPACE_REFUSAL");
    expect(script).toContain("public.get_risk_uncertainty_workspace");
  });

  it("covers final-profile revalidation and overlapping ancestry, and keeps forbidden deletion explicitly open", () => {
    for (const witness of [
      "U18_FINAL_PROFILE_REVALIDATION",
      "current named human engineering or management membership required",
      "U18_REVERSE_CHILD_OVERLAP",
      "U18_OPEN_ANCESTOR_DELETE",
      "Secondary risk parent provenance cannot be severed or replaced",
      "NATIVE exact-head PostgreSQL only",
    ])
      expect(script).toContain(witness);
  });
});
