import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  "scripts/tests/risk-uncertainty-analysis-concurrency-postgres.mjs",
  "utf8",
);
const fixture = script.slice(
  script.indexOf("async function visibilityFixture("),
  script.indexOf("const noWriter ="),
);

// Source contracts only; they do not prove PostgreSQL races or public RPC
// execution. The full-chain harness retains actual observed session barriers.
describe("U18 receipt-backed native concurrency fixtures", () => {
  it("uses genuine authenticated treatment receipts rather than preassigned lineage", () => {
    for (const witness of [
      "public.upsert_risk_objective(",
      "public.create_risk_criteria_version(",
      "public.update_risk_criteria_draft(",
      "public.adopt_risk_criteria(",
      "public.create_risk_treatment(",
      "receipt.secondary_risks",
      "receipt.scenario_id",
      "set local role authenticated",
      "reset role",
      "assertOriginTreatmentTransition(",
      "normalized, before",
    ])
      expect(fixture).toContain(witness);
    expect(fixture).not.toMatch(
      /insert into public\.(?:scenarios|audit_events)/,
    );
    expect(fixture).not.toContain("const ordered =");
    expect(fixture).not.toMatch(/disable trigger|session_replication_role/i);
  });

  it("creates overlap siblings together and restricts only ancestors after creation", () => {
    expect(fixture).toContain(
      "sibling ? [`${label} child`, `${label} sibling`]",
    );
    expect(fixture).toContain("child: generated[0]");
    expect(fixture).toContain("sibling: sibling ? generated[1] : null");
    expect(fixture).toContain("set information_sensitivity='restricted'");
    expect(fixture).toContain(
      "where id in ('${fixture.grandparent}','${fixture.parent}')",
    );
    expect(fixture).toContain("public.can_read_risk('${fixture.child}')");
  });

  it("keeps an explicit complete expected criterion across all downstream assertions", () => {
    const literal = script.match(
      /const visibilityDecisionThresholds = (\{[^]*?\n {4}\});/,
    )?.[1];
    expect(literal).toBeDefined();
    // Execute the actual fixture literal only, not the script or any SQL.
    const thresholds = new Function(`return (${literal})`)();
    expect(thresholds).toEqual({
      accept: 1,
      monitor: 5,
      investigate: 10,
      treat: 16,
      escalate: 24,
      escalateAbove: 16,
      stopAbove: 24,
    });
    expect(script).toContain(
      "persisted.decision_thresholds, visibilityDecisionThresholds",
    );
    expect(script).toContain(
      "destination.decision_thresholds, visibilityDecisionThresholds",
    );
    expect(script).toContain(
      "decisionThresholds: visibilityDecisionThresholds",
    );
  });

  it("retains target and ancestor races while explicitly proving ordered partial-lock release", () => {
    for (const phase of [
      "U18_WRITER_WINS_TARGET",
      "U18_WRITER_WINS_ANCESTOR",
      "U18_WRITER_WINS_VIEW",
      "U18_WRITER_WINS_SCENARIO",
      "U18_WRITER_WINS_MAX_ANCESTRY",
    ])
      expect(script).toContain(phase);
    expect(script).toContain(
      "[fixture.grandparent, fixture.parent, fixture.child].sort()",
    );
    expect(script).toContain("const partialProbe = orderedPath[0]");
    expect(script).toContain("assert(partialProbe < contendedRisk)");
    expect(script).toContain("id='${partialProbe}' for update nowait");
    expect(script).toContain("actorStateInsideRefusal");
    expect(script).toContain(
      "assert.deepEqual(actorStateInsideRefusal, before)",
    );
  });

  it("restores the fixture monitor's role and JWT context after committing setup", () => {
    expect(fixture).toContain("const callerContext = async () =>");
    expect(fixture).toContain("current_user");
    expect(fixture).toContain(
      "coalesce(current_setting('request.jwt.claim.sub',true),'')",
    );
    expect(fixture).toContain(
      "coalesce(current_setting('request.jwt.claims',true),'')",
    );
    expect(fixture).toContain("const originalContext = await callerContext()");
    expect(fixture).toContain(
      "assert.deepEqual(await callerContext(), originalContext)",
    );
  });

  it("requires the exact released row, preventing an RLS zero-row false positive", () => {
    const probe = script.slice(
      script.indexOf("const orderedPath ="),
      script.indexOf("const orderedPath =") + 2200,
    );
    expect(probe).toContain("reset role;");
    expect(probe).toContain("select current_user;");
    expect(probe).toContain(
      'assert.deepEqual(releasedRows, ["postgres", partialProbe, "released"])',
    );
    expect(probe).not.toMatch(/\)\.at\(-1\),\s*"released"/);
  });

  it("observes the exact owner-held contention row before invoking the actor", () => {
    expect(script).toContain("const expectedHeldId =");
    expect(script).toContain(
      "const heldRows = await barrier.query(`reset role;",
    );
    expect(script).toContain(
      'assert.deepEqual(heldRows, ["postgres", expectedHeldId])',
    );
  });

  it("verifies both child and sibling inspection through the canonical human writer", () => {
    expect(fixture).toContain("const verifyInspection = async (id) =>");
    expect(fixture).toContain("public.verify_evidence_item('${id}'");
    expect(fixture).toContain("verified_by: f.reviewer");
    expect(fixture).toContain('verification_status: "unverified"');
    expect(fixture).toContain("await verifyInspection(fixture.evidence)");
    expect(fixture).toContain(
      "await verifyInspection(fixture.siblingEvidence)",
    );
    expect(fixture).toContain("evidence_verification");
    expect(fixture).toContain("verificationSecurity");
    expect(fixture).toContain(
      "assert.deepEqual(normalized, beforeVerification)",
    );
    expect(fixture).not.toContain("'INSPECTED','verified'");
    expect(fixture).not.toContain("app.evidence_verification_write','granted'");
  });
});
