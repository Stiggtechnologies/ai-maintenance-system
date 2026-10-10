import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270103050000_risk_uncertainty_analysis.sql",
  "utf8",
);
const review =
  migration.match(
    /create or replace function public\.review_risk_uncertainty_analysis\([^]*?\$\$;/,
  )?.[0] ?? "";
const scriptPath =
  "scripts/tests/risk-uncertainty-analysis-concurrency-postgres.mjs";
const script = existsSync(scriptPath) ? readFileSync(scriptPath, "utf8") : "";
const shell = readFileSync(
  "scripts/ci-risk-uncertainty-analysis-smoke.sh",
  "utf8",
);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const execute = new AsyncFunction(
  "assert",
  "createHash",
  "readFileSync",
  "spawn",
  "randomUUID",
  "createInterface",
  "process",
  "console",
  script.replace(/^import[^\n]*\n/gm, ""),
);

// Source contracts and actual-script containment, not execution of concurrent
// SQL. Only the exact-head disposable PostgreSQL witness can qualify races.
describe("U18 review criteria serialization", () => {
  it("acquires and verifies the synthetic caller's prior lock as owner before the authenticated RPC", async () => {
    const helper = script.match(
      /async function beginPolicyCaller\(handle, priorRisk\) \{([^]*?)\n {4}\}\n {4}\/\/ U18 PRIOR CALLER LOCK END/,
    )?.[1];
    expect(helper).toBeDefined();
    const run = new AsyncFunction("assert", "handle", "priorRisk", helper!);
    const priorRisk = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const query = vi.fn().mockResolvedValue(["retained", priorRisk]);
    await run(assert, { query }, priorRisk);
    expect(query).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/^reset role;\s*begin;/);
    expect(sql).toContain("app.u18_policy_caller");
    expect(sql).toContain(`where id='${priorRisk}' for update`);
    expect(sql).not.toContain("set role authenticated");
    for (const rows of [[], ["retained"], ["different-risk"]]) {
      await expect(
        run(assert, { query: vi.fn().mockResolvedValue(rows) }, priorRisk),
      ).rejects.toThrow();
    }
    const before =
      script.split("// BEFORE-check:")[1]?.split("// Writer wins:")[0] ?? "";
    expect(
      before.indexOf("await beginPolicyCaller(actor, f.risk)"),
    ).toBeGreaterThan(-1);
    expect(
      before.indexOf("await beginPolicyCaller(actor, f.risk)"),
    ).toBeLessThan(before.indexOf("actor.query(reviewSQL(secondPacket))"));
    expect(before).not.toContain("for update;");
    const replacementBefore =
      script
        .split("// BEFORE-policy:")[1]
        ?.split("// U18_REPLACEMENT_POLICY_OPPOSITE END")[0] ?? "";
    expect(
      replacementBefore.match(
        /await beginPolicyCaller\(actor, f.other_risk\)/g,
      ),
    ).toHaveLength(2);
    expect(replacementBefore).not.toContain("for update;");
  });
  it("keeps busy-policy review and post-commit stale review as distinct actual RPC calls", () => {
    const before =
      script.split("// BEFORE-check:")[1]?.split("// Writer wins:")[0] ?? "";
    expect(before).toContain(
      "criteria profile is busy; reload the governed workspace",
    );
    expect(before).toContain(
      "assertPolicyFenceReleased(actor, [f.other_risk], secondPacket.analysisId, f.reviewer)",
    );
    expect(before).toContain("await beginPolicyCaller(actor, f.risk)");
    expect(before).toContain('await actor.query("rollback")');
    expect(before).toContain(
      "json(await actor.query(reviewSQL(secondPacket)))",
    );
    expect(before).toContain(
      "assert.deepEqual(await state(), expectedRefusalState)",
    );
    expect(before).not.toContain("await blocked(actorPid, barrierPid)");
  });
  it("proves policy-busy rollback releases new canonical locks while retaining caller context", () => {
    const release =
      script
        .split("async function assertPolicyFenceReleased(")[1]
        ?.split("// U18 POLICY FENCE RELEASE END")[0] ?? "";
    expect(release).toContain("for update nowait");
    expect(release).toContain("public.risk_uncertainty_analyses");
    expect(release).toContain("for update of sv nowait");
    expect(release).toContain("for update of s nowait");
    expect(release).toContain("public.get_risk_secondary_origin_internal(r)");
    expect(release).toContain("await assertActorContext(handle, user)");
    expect(release).toContain("U18 policy fence released");
    expect(release).not.toMatch(/40P01|57014|deadlock_detected|query_canceled/);
  });
  it("locks the current canonical same-org criterion before evidence, actor and digest/approval", () => {
    const packet = review.indexOf(
      "where id=p_analysis_id and organization_id=v_org and risk_id=r.id for update",
    );
    const criterion = review.indexOf(
      "select * into c from public.risk_criteria_profiles",
    );
    const evidence = review.indexOf("perform 1 from public.evidence_items");
    const actor = review.indexOf("where id=v_user for share");
    const digest = review.indexOf(
      "v_current:=public.risk_uncertainty_analysis_digest(",
    );
    const approval = review.indexOf("insert into public.approvals");
    expect(packet).toBeGreaterThan(-1);
    expect(criterion).toBeGreaterThan(packet);
    expect(evidence).toBeGreaterThan(criterion);
    expect(actor).toBeGreaterThan(evidence);
    expect(digest).toBeGreaterThan(actor);
    expect(approval).toBeGreaterThan(digest);
    expect(review.slice(criterion, evidence)).toContain(
      "where id=r.criteria_profile_id and organization_id=v_org for share",
    );
  });

  it("refuses missing, nonadopted, rebound or different submitted threshold policy before writes", () => {
    const criterion = review.indexOf(
      "select * into c from public.risk_criteria_profiles",
    );
    const evidence = review.indexOf("perform 1 from public.evidence_items");
    const standing = review.slice(criterion, evidence);
    expect(criterion).toBeGreaterThan(-1);
    expect(standing).toContain("if not found");
    expect(standing).toContain("c.status is distinct from 'adopted'");
    expect(standing).toContain("c.id is distinct from a.threshold_profile_id");
    expect(standing).toContain("c.decision_thresholds='{}'::jsonb");
    expect(standing).toContain(
      "c.decision_thresholds is distinct from a.decision_thresholds",
    );
    expect(standing).toContain(
      "analysis changed after submission; submit a new version against the current evidence and thresholds",
    );
    expect(standing).not.toMatch(
      /\b(?:insert into|update|delete from) public\./i,
    );
  });

  it("retains final actor/visibility/digest checks and no independent operational authority", () => {
    expect(review).toContain("auth.uid() is distinct from v_user");
    expect(review).toContain(
      "public.can_read_risk(r.id) is distinct from true",
    );
    expect(review).toContain("v_current is distinct from a.analysis_digest");
    expect(review).toContain("'operationalAuthorization',false");
  });

  it("wires real disposable concurrency qualification into the existing full smoke, not the rollback-only preflight", () => {
    expect(shell).toContain(
      "node scripts/tests/risk-uncertainty-analysis-concurrency-postgres.mjs --ci-uncertainty-concurrency",
    );
    expect(shell.indexOf("--ci-uncertainty-concurrency")).toBeGreaterThan(
      shell.indexOf('if [[ "${1:-}" != --sql-preflight ]]'),
    );
    for (const witness of [
      "pg_blocking_pids",
      "pg_backend_pid()",
      "public.review_risk_uncertainty_analysis",
      "lock table public.approvals in share mode",
      "set local lock_timeout='2s'",
      "risk_criteria_profiles",
      "decision_thresholds",
      "status='draft'",
      "assert.deepEqual",
      "expectedAfterCriteria",
      "actualState",
      "set role authenticated",
      "create temporary table u18_fixture",
      "Stop Supabase",
      "retained only in disposable CI",
    ])
      expect(script).toContain(witness);
    expect(script).not.toMatch(/disable trigger|session_replication_role/i);
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const job =
      workflow.split("\n  migrations:")[1]?.split("\n  e2e:")[0] ?? "";
    const smoke = job.indexOf(
      "run: bash scripts/ci-risk-uncertainty-analysis-smoke.sh\n",
    );
    const cleanup = job.match(
      /\n {6}- name: Stop Supabase\n {8}if: always\(\)\n {8}run: supabase stop --no-backup(?: \|\| true)?/,
    );
    expect(smoke).toBeGreaterThan(-1);
    expect(cleanup).not.toBeNull();
    expect(cleanup!.index).toBeGreaterThan(smoke);
  });

  it.each([undefined, "false"])(
    "rejects non-CI %s before filesystem or database access",
    async (ci) => {
      const read = vi.fn();
      const spawn = vi.fn();
      await expect(
        execute(
          assert,
          createHash,
          read,
          spawn,
          vi.fn(),
          vi.fn(),
          {
            env: ci === undefined ? {} : { GITHUB_ACTIONS: ci },
            argv: ["node", "script", "--ci-uncertainty-concurrency"],
          },
          { log: vi.fn() },
        ),
      ).rejects.toThrow();
      expect(read).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it.each([
    "PGHOSTADDR",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGPASSFILE",
    "PGOPTIONS",
    "PGHOST",
  ])("rejects ambient %s before filesystem or database access", async (key) => {
    const read = vi.fn();
    const spawn = vi.fn();
    await expect(
      execute(
        assert,
        createHash,
        read,
        spawn,
        vi.fn(),
        vi.fn(),
        {
          env: { GITHUB_ACTIONS: "true", [key]: "unsafe-ambient-target" },
          argv: ["node", "script", "--ci-uncertainty-concurrency"],
        },
        { log: vi.fn() },
      ),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    "select '11111111-1111-1111-1111-111111111111'::uuid;",
    "-- on conflict must not reuse a seeded identity",
    "update public.risks set status='archived';",
    "delete from public.evidence_items;",
    "insert into public.organizations(name) values('unreviewed fixture insert');",
  ])(
    "rejects unsafe fixture source %s before any database process",
    async (unsafe) => {
      const native = readFileSync(
        "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql",
        "utf8",
      );
      const read = vi.fn(() =>
        native.replace(
          "-- U18 FIXTURE SEED END",
          `${unsafe}\n-- U18 FIXTURE SEED END`,
        ),
      );
      const spawn = vi.fn();
      await expect(
        execute(
          assert,
          createHash,
          read,
          spawn,
          vi.fn(),
          vi.fn(),
          {
            env: { GITHUB_ACTIONS: "true" },
            argv: ["node", "script", "--ci-uncertainty-concurrency"],
          },
          { log: vi.fn() },
        ),
      ).rejects.toThrow("U18 concurrent PostgreSQL qualification failed");
      expect(read).toHaveBeenCalledTimes(1);
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it("pins the exact reviewed random seed before committing it across sessions", () => {
    const native = readFileSync(
      "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql",
      "utf8",
    );
    const seed = native.match(
      /-- U18 FIXTURE SEED BEGIN\n([^]*?)-- U18 FIXTURE SEED END/,
    )?.[1];
    expect(seed).toBeDefined();
    const sha = createHash("sha256").update(seed!).digest("hex");
    expect(script).toContain('createHash("sha256").update(seed).digest("hex")');
    expect(script).toContain(sha);
    expect(script.indexOf(sha)).toBeLessThan(
      script.indexOf('session("monitor")'),
    );
  });

  it("requires exact concurrent ACK keys, artifact deltas and full canonical linkage", () => {
    for (const witness of [
      "Object.keys(reviewed).sort()",
      "beforeReview",
      "artifactDeltas",
      "approval.organization_id",
      "approval.risk_id",
      "approval.approval_scope.kind",
      "approval.approval_scope.analysisId",
      "approval.approval_scope.version",
      "derived.organization_id",
      "derived.risk_id",
      "derived.evidence_class",
      "derived.verification_status",
      "derived.provenance.approvalId",
      "derived.provenance.analysisDigest",
      "derived.provenance.reviewedBy",
      "voi.analysis_id",
      "voi.validation_status",
      "voi.operational_authorization",
    ])
      expect(script).toContain(witness);
  });

  it("handles stdin failure and confirms bounded subprocess termination", () => {
    expect(script).toContain('child.stdin.on("error", processFailed)');
    expect(script).not.toContain('child.on("exit", refused)');
    expect(script).toContain(
      'refused(sqlState === null ? "process" : "server")',
    );
    expect(script).toContain('child.once("close"');
    expect(script).toContain('child.kill("SIGKILL")');
    expect(script).toContain(
      "await Promise.all(sessions.map((handle) => handle.close()))",
    );
  });

  it("includes the canonical automatic approval-decision audit alongside the explicit review audit", () => {
    expect(script).toMatch(/audit: 2,/);
    for (const witness of [
      'a.entity_type === "approval_decision"',
      "approvalAudit.organization_id, f.org",
      "approvalAudit.event_data.approval_id, reviewed.approvalId",
      "approvalAudit.event_time, approval.decided_at",
      'approvalAudit.new_state.status, "approved"',
    ])
      expect(script).toContain(witness);
  });

  it("admits the exact reviewed seed up to one controlled database process, without private diagnostic disclosure", async () => {
    const native = readFileSync(
      "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql",
      "utf8",
    );
    const read = vi.fn(() => native);
    const spawn = vi.fn((...parameters: [string, string[], unknown]) => {
      expect(parameters[0]).toBe("psql");
      throw new Error("private provider diagnostic");
    });
    await expect(
      execute(
        assert,
        createHash,
        read,
        spawn,
        vi.fn(() => "00000000-0000-4000-8000-000000000001"),
        vi.fn(),
        {
          env: { GITHUB_ACTIONS: "true", PATH: "/synthetic/bin" },
          argv: ["node", "script", "--ci-uncertainty-concurrency"],
        },
        { log: vi.fn() },
      ),
    ).rejects.toThrow("U18 concurrent PostgreSQL qualification failed");
    expect(read).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][0]).toBe("psql");
  });

  it("specifies legacy policy refusal even when the byte-preserved metadata digest stays equal", () => {
    const native = readFileSync(
      "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql",
      "utf8",
    );
    const control = native
      .split("-- U18 LEGACY CRITERIA REFUSAL BEGIN")[1]
      ?.split("-- U18 LEGACY CRITERIA REFUSAL END")[0];
    expect(control).toBeDefined();
    for (const witness of [
      "public.risk_uncertainty_analysis_digest(f.org,packet) is distinct from current_digest",
      "public.review_risk_uncertainty_analysis(packet,'validated'",
      "legacy_review is distinct from jsonb_build_object('error'",
      "pg_temp.u18_state() is distinct from snapshot",
      "analysis changed after submission; submit a new version against the current evidence and thresholds",
    ])
      expect(control).toContain(witness);
  });
});
