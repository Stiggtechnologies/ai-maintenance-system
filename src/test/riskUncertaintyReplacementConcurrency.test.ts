import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  "scripts/tests/risk-uncertainty-analysis-concurrency-postgres.mjs",
  "utf8",
);
const replacement =
  script
    .split("// U18_REPLACEMENT_CONCURRENCY BEGIN")[1]
    ?.split("// U18_REPLACEMENT_CONCURRENCY END")[0] ?? "";
const authorityRaces =
  script
    .split("// U18_REPLACEMENT_AUTHORITY_RACES BEGIN")[1]
    ?.split("// U18_REPLACEMENT_AUTHORITY_RACES END")[0] ?? "";

// Source specifications only; no mock, elapsed timeout or source substring
// qualifies actual PostgreSQL FK/tuple races. Exact-head native CI is required.
describe("U18 replacement native concurrency source contract", () => {
  it("keeps the opposite-order policy writer progressing while the refused caller transaction stays open", () => {
    const opposite =
      authorityRaces
        .split("// U18_REPLACEMENT_POLICY_OPPOSITE BEGIN")[1]
        ?.split("// U18_REPLACEMENT_POLICY_OPPOSITE END")[0] ?? "";
    expect(opposite).toContain(
      "criteria profile is busy; reload the governed workspace",
    );
    expect(opposite).toContain("assertPolicyFenceReleased(actor,");
    expect(opposite).toContain("public.risk_criteria_profiles");
    expect(opposite).toContain("update public.risks");
    expect(opposite).toContain(
      "assertWholeStatePreserved(before, after, fixture, writer)",
    );
    expect(opposite.indexOf('await barrier.query("commit")')).toBeLessThan(
      opposite.indexOf('await actor.query("rollback")'),
    );
    expect(opposite).not.toMatch(
      /40P01|57014|deadlock_detected|query_canceled/,
    );
  });
  it("uses non-policy barriers for retained risk and old-evidence competition coverage", () => {
    const competition =
      replacement
        .split("// U18_REPLACEMENT_RISK_COMPETITION")[1]
        ?.split("// U18_REPLACEMENT_EVIDENCE_RESTORE")[0] ?? "";
    const restore =
      replacement
        .split("// U18_REPLACEMENT_EVIDENCE_RESTORE")[1]
        ?.split("// U18_REPLACEMENT_AFTER_CHECK")[0] ?? "";
    expect(competition).toContain("public.user_profiles");
    expect(restore).toContain("public.risk_uncertainty_analyses");
    expect(competition).not.toContain("public.risk_criteria_profiles");
    expect(restore).not.toContain("public.risk_criteria_profiles");
  });
  it("uses the profile-owning service session to commit membership drift at final revalidation", () => {
    const profile =
      authorityRaces
        .split('markPhase("U18_REPLACEMENT_PROFILE_BEFORE")')[1]
        ?.split('markPhase("U18_REPLACEMENT_PROFILE_AFTER")')[0] ?? "";
    expect(profile).toContain("public.user_profiles");
    expect(profile).toContain(
      "await barrier.query(`${serviceSQL}; update public.user_profiles",
    );
    expect(profile).toContain(
      "assertWholeStatePreserved(before, changed, fixture, writer)",
    );
    expect(profile).not.toContain("public.risk_criteria_profiles");
  });
  it("specifies after-lock criteria-pointer drift as two separately verified commits without weakening the replacement delta", () => {
    const pointer =
      authorityRaces
        .split("// U18_REPLACEMENT_POINTER_AFTER BEGIN")[1]
        ?.split("// U18_REPLACEMENT_POINTER_AFTER END")[0] ?? "";
    expect(pointer).not.toBe("");
    expect(script).toContain('"U18_REPLACEMENT_POINTER_AFTER"');
    expect(pointer).toContain('for (const kind of ["adopted", "missing"])');
    expect(pointer).toContain(
      "assert.equal(destination.organization_id, f.org)",
    );
    expect(pointer).toContain('assert.equal(destination.status, "adopted")');
    expect(pointer).toContain("lock table public.audit_events in share mode");
    expect(pointer).toContain("await blocked(actorPid, barrierPid)");
    expect(pointer).toContain("await blocked(changerPid, actorPid)");
    expect(pointer).toContain("update public.risks set criteria_profile_id=");
    expect(pointer).toContain(
      "assertWholeStatePreserved(before, await state(), fixture)",
    );
    expect(pointer).toContain(
      "assertReplacementTransition(receipt, fixture, info, before, replacementState,",
    );
    expect(pointer.indexOf("assertReplacementTransition(")).toBeLessThan(
      pointer.indexOf('await changer.query("commit")'),
    );
    expect(pointer).toContain(
      "assertWholeStatePreserved(replacementState, after, fixture, writer)",
    );
    expect(pointer).toContain("criteria_profile_id: destinationId");
    expect(pointer).not.toMatch(
      /delete from|truncate|disable trigger|session_replication_role|catch[^]*?(?:deadlock_detected|query_canceled)/i,
    );
  });

  it("keeps the original replacement receipt and history immutable while live pointer drift removes review standing", () => {
    const pointer =
      authorityRaces
        .split("// U18_REPLACEMENT_POINTER_AFTER BEGIN")[1]
        ?.split("// U18_REPLACEMENT_POINTER_AFTER END")[0] ?? "";
    for (const witness of [
      "assert.notEqual(currentDigest, receipt.analysisDigest)",
      'assert.deepEqual(byId(after, "packets", receipt.analysisId), successor)',
      "assert.equal(successor.threshold_profile_id, fixture.criteria)",
      "assert.deepEqual(successor.input_binding_snapshot, expectedSnapshot)",
      "public.get_risk_uncertainty_workspace",
      'assert.equal(current.validationStatus, "stale")',
      'kind === "adopted" ? "replacement_required" : "policy_unavailable"',
      "assert.equal(workspace.operationalAuthorization, false)",
      "reviewSQLFor({ analysisId: receipt.analysisId })",
      "analysis changed after submission; submit a new version against the current evidence and thresholds",
      "assert.deepEqual(json(await actor.query(replaceSQL(fixture, info))), receipt)",
      "assertWholeStatePreserved(after, await state(), fixture)",
    ])
      expect(pointer).toContain(witness);
  });

  it("specifies replacement authority races separately from earlier ordinary-submit/review coverage", () => {
    expect(authorityRaces).not.toBe("");
    for (const phase of [
      "U18_REPLACEMENT_VS_REVIEW",
      "U18_REVIEW_VS_REPLACEMENT",
      "U18_REPLACEMENT_VS_SUBMIT",
      "U18_SUBMIT_VS_REPLACEMENT",
      "U18_REPLACEMENT_POLICY_BEFORE",
      "U18_REPLACEMENT_POLICY_AFTER",
      "U18_REPLACEMENT_PROFILE_BEFORE",
      "U18_REPLACEMENT_PROFILE_AFTER",
      "U18_REPLACEMENT_VISIBILITY_BEFORE",
      "U18_REPLACEMENT_VISIBILITY_AFTER",
      "U18_REPLACEMENT_OLD_EVIDENCE_BEFORE",
      "U18_REPLACEMENT_NEW_EVIDENCE_BEFORE",
      "U18_REPLACEMENT_WORKSPACE_SNAPSHOT",
    ]) {
      expect(script).toContain(`"${phase}"`);
      expect(authorityRaces).toContain(`"${phase}"`);
    }
    expect(authorityRaces).toContain("await blocked(");
    expect(authorityRaces).toContain("replaceSQL(");
    expect(authorityRaces).toContain("assertReplacementTransition(");
    expect(authorityRaces).not.toMatch(
      /disable trigger|session_replication_role|catch[^]*?(?:deadlock_detected|query_canceled)/i,
    );
  });

  it("removes restricted-ancestor owner and privileged-role shortcuts from replacement visibility fixtures", () => {
    const fixture =
      authorityRaces
        .split("async function replacementAuthorityFixture(")[1]
        ?.split("async function restoreAuthorityAuthorRole(")[0] ?? "";
    expect(fixture).not.toBe("");
    expect(fixture).toContain("role='reliability_engineer'");
    expect(fixture).toContain(
      "risk_owner_id='${f.reviewer}',decision_owner_id=null",
    );
    expect(fixture).toContain(
      'assert.equal(risk.information_sensitivity, "restricted")',
    );
    expect(fixture).toContain("assert.equal(risk.risk_owner_id, f.reviewer)");
    expect(fixture).toContain("assert.equal(risk.decision_owner_id, null)");
    expect(fixture).toContain("assert.equal(grants.length, 1)");
    expect(fixture).toContain("row.stakeholder_user_id === f.author");
    expect(fixture).toContain("public.can_read_risk");
    expect(fixture).toContain("assertWholeStatePreserved(ready");
  });

  it("allows only the independently checked canonical membership event while retaining zero-event defaults", () => {
    const writer =
      authorityRaces
        .split("function profileWriter(")[1]
        ?.split("// Replacement's final audit INSERT")[0] ?? "";
    expect(writer).not.toBe("");
    expect(writer).toContain("securityEventDelta: 1");
    expect(writer).toContain(
      'assert.equal(delta(after, before, "securityEvents"), 1)',
    );
    expect(writer).toContain("assert.deepEqual(event, {");
    expect(writer).toContain('"role_changed" : "org_changed"');
    expect(writer).toContain("actor_id: null, actor_label: null");
    expect(writer).toContain("Role for ${subject} changed from ${old.role");
    expect(writer).toContain(
      "Organization for ${subject} changed from ${old.organization_id",
    );
    expect(writer).toContain(
      "normalized.securityEvents.filter((row) => row.id !== added[0].id)",
    );
    expect(script).toContain(
      "securityEvents: replacement?.securityEventDelta ?? 0",
    );
    expect(script).toContain("writer.expectStale ?? (writer !== noWriter)");
    expect(script).toContain("writer.securityEventDelta ?? 0");
  });
  it("retains the isolated pinned seed/four-session observer and finite diagnostics", () => {
    expect(script).toContain(
      '"1707a52effd3556b025cce99df081a360924d63904d604f94bec2e616f4ab379"',
    );
    expect(script).toContain(
      'assert.equal(process.env.GITHUB_ACTIONS, "true")',
    );
    expect(script).toContain("assert(allowedPhases.has(phase))");
    for (const phase of [
      "U18_REPLACEMENT_RISK_COMPETITION",
      "U18_REPLACEMENT_EVIDENCE_RESTORE",
      "U18_REPLACEMENT_AFTER_CHECK",
    ])
      expect(script).toContain(`"${phase}"`);
    expect(script).toContain("pg_blocking_pids");
    expect(script).toContain("SIGKILL");
    expect(script).not.toMatch(/disable trigger|session_replication_role/i);
  });

  it("builds actual public replacement requests from the scoped packet/live policy, not mocked ACKs", () => {
    expect(replacement).not.toBe("");
    expect(replacement).toContain("public.replace_risk_uncertainty_analysis");
    expect(replacement).toContain(
      "public.risk_uncertainty_current_policy_digest",
    );
    expect(replacement).toContain("public.risk_uncertainty_analysis_digest");
    expect(replacement).toContain('createHash("sha256").update(text, "utf8")');
    expect(replacement).toContain("contractVersion: 1");
    expect(replacement).toContain('action: "replace"');
    expect(replacement).toContain("intentId: randomUUID()");
    expect(replacement).toContain("evidenceItemIds: fixture.newEvidence");
  });

  it("observes predecessor-packet and FK waits then demands an exact prompt busy refusal with the actor transaction still open", () => {
    const restore =
      replacement
        .split("// U18_REPLACEMENT_EVIDENCE_RESTORE")[1]
        ?.split("// U18_REPLACEMENT_AFTER_CHECK")[0] ?? "";
    expect(restore).toContain("await blocked(actorPid, barrierPid)");
    expect(restore).toContain("await blocked(changerPid, actorPid)");
    expect(restore).toContain("update public.evidence_items set risk_id=");
    expect(restore).toContain(
      "replacement evidence is busy; reload the governed workspace",
    );
    expect(restore).toContain("assert(Date.now() - releasedAt < 5000)");
    expect(restore).toContain("U18_REPLACEMENT_OUTER_TX_WITNESS");
    expect(restore).toContain("assert.deepEqual(actorVisibleRefusal, before)");
    expect(restore).toContain("app.risk_uncertainty_write");
    expect(restore).toContain("request.jwt.claim.sub");
    expect(restore).not.toMatch(
      /catch[^]*?(?:deadlock_detected|query_canceled)/,
    );
  });

  it("proves partial union locks release before actor rollback using a third real session", () => {
    const restore =
      replacement
        .split("// U18_REPLACEMENT_EVIDENCE_RESTORE")[1]
        ?.split("// U18_REPLACEMENT_AFTER_CHECK")[0] ?? "";
    expect(restore).toContain("U18_REPLACEMENT_PARTIAL_UNION_RELEASE");
    expect(restore).toContain("for update nowait");
    expect(restore).toContain("fixture.newEvidence.map");
    expect(restore.indexOf("for update nowait")).toBeGreaterThan(-1);
    expect(restore.indexOf("for update nowait")).toBeLessThan(
      restore.indexOf('await actor.query("rollback")'),
    );
    expect(restore).toContain(
      "assertNamedEvidenceChange(before, after, fixture.evidence",
    );
  });

  it("uses actual same-risk public RPC contention rather than elapsed-time success", () => {
    const competition =
      replacement
        .split("// U18_REPLACEMENT_RISK_COMPETITION")[1]
        ?.split("// U18_REPLACEMENT_EVIDENCE_RESTORE")[0] ?? "";
    expect(competition).toContain("await blocked(actorPid, barrierPid)");
    expect(competition).toContain("await changer.query(replaceSQL");
    expect(competition).toContain(
      'error: "risk not found in this organization"',
    );
    expect(competition).toContain("assert(Date.now() - started < 5000)");
    expect(competition).toContain("assertReplacementTransition(");
  });

  it("observes replacement holding evidence through the last audit barrier and verifies subsequent digest drift", () => {
    const afterCheck =
      replacement
        .split("// U18_REPLACEMENT_AFTER_CHECK")[1]
        ?.split("// U18_REPLACEMENT_AUTHORITY_RACES BEGIN")[0] ?? "";
    expect(afterCheck).toContain(
      "lock table public.audit_events in share mode",
    );
    expect(afterCheck).toContain("await blocked(actorPid, barrierPid)");
    expect(afterCheck).toContain("await blocked(changerPid, actorPid)");
    expect(afterCheck).toContain("assertReplacementTransition(");
    expect(afterCheck).toContain(
      "assert.notEqual(await analysisDigest(receipt.analysisId), receipt.analysisDigest)",
    );
  });

  it("binds the full replacement history/receipt and normalizes every allowed artifact without absorbing arbitrary state", () => {
    for (const witness of [
      "assertReplacementTransition",
      "assertNamedEvidenceChange",
      "predecessorAnalysisId",
      "requestFingerprint",
      "compareAndSwap",
      "digestVersion",
      "digestCoverage",
      "superseded_by_analysis_id",
      "superseded_by_user_id",
      "risk_uncertainty_analysis_replaced",
      "operationalAuthorization",
      "assert.deepEqual(normalized, before)",
      "assert.deepEqual(Object.keys(normalized).sort(), [...wholeStateKeys].sort())",
    ])
      expect(replacement).toContain(witness);
    // The replacement delegates complete proposal/snapshot checks to the
    // existing actual submit-state assertion rather than inventing a second
    // expected-state model. Inspect that implementation, not a comment label.
    const shared = script.slice(
      script.indexOf("function assertSubmitState("),
      script.indexOf("function assertSubmitStateTransition("),
    );
    expect(replacement).toContain(
      "assertSubmitState(receipt, fixture, before, after",
    );
    expect(shared).toContain("persisted.replaces_analysis_id");
    expect(shared).toContain("persisted.replacement_request_fingerprint");
    expect(shared).toContain(
      "persisted.input_binding_snapshot, expectedSnapshot",
    );
    expect(replacement).not.toContain("const expected = json(await changing)");
    expect(script).toContain('"securityEvents"');
    expect(script).toContain('"stakeholderViews"');
    expect(script).toContain('"profiles"');
    expect(script).toContain('"(select foreign_org from u18_fixture)"');
  });
});
