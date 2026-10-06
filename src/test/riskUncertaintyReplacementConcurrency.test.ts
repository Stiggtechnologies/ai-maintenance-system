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

// Source specifications only; no mock, elapsed timeout or source substring
// qualifies actual PostgreSQL FK/tuple races. Exact-head native CI is required.
describe("U18 replacement native concurrency source contract", () => {
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

  it("observes criteria and FK waits then demands an exact prompt busy refusal with the actor transaction still open", () => {
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
      replacement.split("// U18_REPLACEMENT_AFTER_CHECK")[1] ?? "";
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
