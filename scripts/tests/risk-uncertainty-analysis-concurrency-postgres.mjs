// Three real PostgreSQL participants plus observer, not a mock or production proof.
// NEW synthetic fixtures are committed so sessions can see them, then retained
// only in disposable CI until the existing job's Stop Supabase teardown.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

async function qualify() {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.deepEqual(process.argv.slice(2), ["--ci-uncertainty-concurrency"]);
  for (const key of [
    "PGHOSTADDR",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGPASSFILE",
    "PGOPTIONS",
    "PGHOST",
  ])
    assert.equal(process.env[key], undefined);
  // Reuse the exact random, canonical fixture and full-state projection. No
  // persistent helper, alternate evidence store or seeded/customer identity.
  const native = readFileSync(
    "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql",
    "utf8",
  );
  const seed = native.match(
    /-- U18 FIXTURE SEED BEGIN\n([^]*?)-- U18 FIXTURE SEED END/,
  )?.[1];
  const stateBody = native.match(
    /create function pg_temp\.u18_state\(\) returns jsonb language sql as \$\$([^]*?)\$\$/,
  )?.[1];
  assert(seed?.includes("create temporary table u18_fixture"));
  assert(seed.includes("gen_random_uuid()"));
  assert(stateBody?.includes("'securityEvents'"));
  assert(!/on conflict|11111111-1111|admin@syncai|demo@syncai/i.test(seed));
  // Cross-session setup commits this seed. Pin its reviewed statement set so
  // a future extra mutation cannot inherit permission to commit a wider scope.
  assert.equal(
    createHash("sha256").update(seed).digest("hex"),
    "1707a52effd3556b025cce99df081a360924d63904d604f94bec2e616f4ab379",
  );
  const sessions = [];
  const suffix = randomUUID();
  function session(name) {
    const child = spawn(
      "psql",
      [
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        "127.0.0.1",
        "-p",
        "54322",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-c",
        `set application_name='u18-criteria-${name}-${suffix}'`,
        "-f",
        "-",
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH,
          LC_ALL: "C",
          LANG: "C",
          PGPASSWORD: "postgres",
          PGHOSTADDR: "127.0.0.1",
          PGOPTIONS: "-c search_path=public -c statement_timeout=20000",
          PGSSLMODE: "disable",
        },
      },
    );
    let pending;
    let ended = false;
    let finish;
    const stopped = new Promise((resolve) => {
      finish = resolve;
    });
    const failure = () =>
      new Error("U18 concurrent PostgreSQL qualification failed");
    child.stderr.on("data", () => {}); // Never echo private server diagnostics.
    createInterface({ input: child.stdout }).on("line", (line) => {
      if (!pending) return;
      if (line === pending.marker) {
        const done = pending;
        pending = undefined;
        clearTimeout(done.timer);
        done.resolve(done.lines);
      } else pending.lines.push(line);
    });
    const refused = () => {
      if (!pending) return;
      const done = pending;
      pending = undefined;
      clearTimeout(done.timer);
      done.reject(failure());
    };
    child.on("error", refused);
    child.on("exit", refused);
    child.stdin.on("error", refused);
    child.once("close", () => {
      ended = true;
      refused();
      finish();
    });
    const handle = {
      query(sql) {
        assert.equal(pending, undefined);
        assert(!ended && child.exitCode === null && !child.stdin.destroyed);
        return new Promise((resolve, reject) => {
          const marker = `U18_END_${randomUUID()}`;
          const timer = setTimeout(() => {
            refused();
            child.kill("SIGTERM");
          }, 25000);
          pending = { marker, timer, lines: [], resolve, reject };
          try {
            child.stdin.write(`${sql};\nselect '${marker}';\n`, (error) => {
              if (error) refused();
            });
          } catch {
            refused();
          }
        });
      },
      async close() {
        child.stdin.end();
        if (!ended) child.kill("SIGTERM");
        const waitForStop = () =>
          new Promise((resolve) => {
            const timer = setTimeout(() => resolve(false), 3000);
            stopped.then(() => {
              clearTimeout(timer);
              resolve(true);
            });
          });
        if (!(await waitForStop())) {
          child.kill("SIGKILL");
          assert(await waitForStop());
        }
        assert(ended);
      },
    };
    sessions.push(handle);
    return handle;
  }
  const json = (lines) => JSON.parse(lines.at(-1));
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  try {
    const monitor = session("monitor");
    assert.equal(
      (
        await monitor.query(`select (current_database()='postgres'
      and current_user='postgres' and to_regclass('auth.users') is not null
      and to_regprocedure('public.review_risk_uncertainty_analysis(uuid,text,text)') is not null
      and pg_get_functiondef('auth.uid()'::regprocedure) not like '%test.uid%')::text`)
      ).at(-1),
      "true",
    );
    const f = json(
      await monitor.query(
        `begin; ${seed} commit; select to_jsonb(f) from u18_fixture f`,
      ),
    );
    for (const key of [
      "org",
      "foreign_org",
      "author",
      "reviewer",
      "foreign_user",
      "criteria",
      "risk",
      "other_risk",
      "verified",
      "unverified",
      "wrong_risk",
    ])
      assert.match(f[key], uuid);
    assert(f.input && typeof f.input === "object" && !Array.isArray(f.input));
    const stateSQL = stateBody.replaceAll(
      "(select org from u18_fixture)",
      `'${f.org}'::uuid`,
    );
    assert(!stateSQL.includes("u18_fixture"));
    const state = async (handle = monitor) =>
      json(await handle.query(stateSQL));
    const literal = (value) => `'${value.replaceAll("'", "''")}'`;
    const submit = (risk, evidence) => `set role authenticated;
      select set_config('request.jwt.claim.sub','${f.author}',false);
      select public.submit_risk_uncertainty_analysis('${risk}',${literal(JSON.stringify(f.input))}::jsonb,array['${evidence}'::uuid]);
      reset role; select set_config('request.jwt.claim.sub','',false)`;
    // Query the receipt separately: the final reset emits a line, so select the
    // actual receipt as JSON instead of treating a trailing set_config as ACK.
    const submitReceipt = async (risk, evidence) => {
      const lines = await monitor.query(submit(risk, evidence));
      const receipts = lines.filter(
        (line) => line.startsWith('{"') && line.includes('"analysisId"'),
      );
      assert.equal(receipts.length, 1);
      const receipt = JSON.parse(receipts[0]);
      assert.equal(receipt.riskId, risk);
      assert.match(receipt.analysisId, uuid);
      assert.match(receipt.analysisDigest, /^[0-9a-f]{64}$/);
      assert.equal(receipt.version, 1);
      assert.equal(receipt.validationStatus, "pending_review");
      assert.equal(receipt.operationalAuthorization, false);
      assert.equal(receipt.error, undefined);
      return receipt;
    };
    const barrier = session("barrier"),
      actor = session("reviewer"),
      changer = session("criterion-writer");
    const actorPid = Number(
      (await actor.query("select pg_backend_pid()")).at(-1),
    );
    const barrierPid = Number(
      (await barrier.query("select pg_backend_pid()")).at(-1),
    );
    const changerPid = Number(
      (await changer.query("select pg_backend_pid()")).at(-1),
    );
    const monitorPid = Number(
      (await monitor.query("select pg_backend_pid()")).at(-1),
    );
    for (const pid of [actorPid, barrierPid, changerPid, monitorPid])
      assert(Number.isSafeInteger(pid) && pid > 0);
    assert.equal(
      new Set([actorPid, barrierPid, changerPid, monitorPid]).size,
      4,
    );
    const reviewSQL = (packet) => `set role authenticated;
      select set_config('request.jwt.claim.sub','${f.reviewer}',false);
      select public.review_risk_uncertainty_analysis('${packet.analysisId}','validated',
        'Synthetic independent concurrent criteria qualification, not customer approval or operational authority.')`;
    async function blocked(waiter, blocker) {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        if (
          (
            await monitor.query(
              `select ${blocker}=any(pg_blocking_pids(${waiter}))`,
            )
          ).at(-1) === "t"
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.fail(
        "the intended real PostgreSQL resource did not block the competing session",
      );
    }
    // AFTER-check: review reaches the real approval INSERT and holds the
    // criterion. A concurrent correction must wait for the reviewer to commit.
    const firstPacket = await submitReceipt(f.risk, f.verified);
    const beforeReview = await state();
    await barrier.query(
      "begin; set local lock_timeout='2s'; lock table public.approvals in share mode",
    );
    const reviewing = actor.query(reviewSQL(firstPacket));
    reviewing.catch(() => {});
    await blocked(actorPid, barrierPid);
    const changing = changer.query(`begin; update public.risk_criteria_profiles
      set decision_thresholds='{"escalateAbove":99,"stopAbove":199}'::jsonb where id='${f.criteria}'
      returning id; ${stateSQL}`);
    changing.catch(() => {});
    await blocked(changerPid, actorPid);
    await barrier.query("commit");
    const reviewed = json(await reviewing);
    assert.deepEqual(
      Object.keys(reviewed).sort(),
      [
        "analysisDigest",
        "analysisId",
        "approvalId",
        "decision",
        "derivedEvidenceItemId",
        "operationalAuthorization",
        "riskId",
      ].sort(),
    );
    assert.equal(reviewed.error, undefined);
    assert.equal(reviewed.riskId, f.risk);
    assert.equal(reviewed.analysisId, firstPacket.analysisId);
    assert.equal(reviewed.analysisDigest, firstPacket.analysisDigest);
    assert.equal(reviewed.decision, "validated");
    assert.equal(reviewed.operationalAuthorization, false);
    assert.match(reviewed.approvalId, uuid);
    assert.match(reviewed.derivedEvidenceItemId, uuid);
    const expectedAfterCriteria = json(await changing);
    await changer.query("commit");
    const actualState = await state();
    assert.deepEqual(actualState, expectedAfterCriteria);
    const artifactDeltas = Object.fromEntries(
      [
        "packets",
        "bindings",
        "approvals",
        "evidence",
        "audit",
        "securityEvents",
        "decisions",
        "work",
      ].map((key) => [
        key,
        (actualState[key]?.length ?? 0) - (beforeReview[key]?.length ?? 0),
      ]),
    );
    assert.deepEqual(artifactDeltas, {
      packets: 0,
      bindings: 0,
      approvals: 1,
      evidence: 1,
      audit: 2,
      securityEvents: 0,
      decisions: 0,
      work: 0,
    });
    const persisted = actualState.packets.find(
      (a) => a.id === firstPacket.analysisId,
    );
    assert.equal(persisted.status, "validated");
    assert.equal(persisted.organization_id, f.org);
    assert.equal(persisted.risk_id, f.risk);
    assert.equal(persisted.version, firstPacket.version);
    assert.equal(persisted.author_id, f.author);
    assert.equal(persisted.reviewer_id, f.reviewer);
    assert.equal(persisted.analysis_digest, firstPacket.analysisDigest);
    assert.equal(persisted.approval_id, reviewed.approvalId);
    assert.equal(
      persisted.derived_evidence_item_id,
      reviewed.derivedEvidenceItemId,
    );
    const approval = actualState.approvals.find(
      (a) => a.id === reviewed.approvalId,
    );
    assert.equal(approval.status, "approved");
    assert.equal(approval.organization_id, f.org);
    assert.equal(approval.risk_id, f.risk);
    assert.equal(approval.approver_user_id, f.reviewer);
    assert.equal(approval.approval_scope.kind, "risk_uncertainty_analysis");
    assert.equal(approval.approval_scope.analysisId, firstPacket.analysisId);
    assert.equal(approval.approval_scope.riskId, f.risk);
    assert.equal(approval.approval_scope.version, firstPacket.version);
    assert.equal(
      approval.approval_scope.analysisDigest,
      firstPacket.analysisDigest,
    );
    assert.equal(approval.approval_scope.operationalAuthorization, false);
    const approvalAudits = actualState.audit.filter(
      (a) =>
        a.entity_type === "approval_decision" &&
        a.event_data.approval_id === reviewed.approvalId,
    );
    assert.equal(approvalAudits.length, 1);
    const approvalAudit = approvalAudits[0];
    assert.equal(approvalAudit.organization_id, f.org);
    assert.equal(approvalAudit.event_data.approval_id, reviewed.approvalId);
    assert.equal(approvalAudit.event_time, approval.decided_at);
    assert.equal(approvalAudit.new_state.status, "approved");
    const derived = actualState.evidence.find(
      (e) => e.id === reviewed.derivedEvidenceItemId,
    );
    assert.equal(derived.organization_id, f.org);
    assert.equal(derived.risk_id, f.risk);
    assert.equal(derived.evidence_class, "CALCULATED");
    assert.equal(derived.verification_status, "unverified");
    assert.equal(derived.provenance.analysisId, firstPacket.analysisId);
    assert.equal(derived.provenance.analysisDigest, firstPacket.analysisDigest);
    assert.equal(derived.provenance.approvalId, reviewed.approvalId);
    assert.equal(derived.provenance.reviewedBy, f.reviewer);
    assert.equal(derived.provenance.operationalAuthorization, false);
    assert.deepEqual(
      actualState.evidence.filter((e) => e.id !== derived.id),
      beforeReview.evidence,
    );
    assert.deepEqual(actualState.bindings, beforeReview.bindings);
    const packetAudit = actualState.audit.filter(
      (a) => a.event_data.analysis_id === firstPacket.analysisId,
    );
    assert.equal(packetAudit.length, 2);
    assert.deepEqual(packetAudit.map((a) => a.entity_type).sort(), [
      "risk_uncertainty_analysis_reviewed",
      "risk_uncertainty_analysis_submitted",
    ]);
    for (const event of packetAudit) {
      assert.equal(event.organization_id, f.org);
      assert.equal(event.event_data.risk_id, f.risk);
      assert.equal(
        event.event_data.analysis_digest,
        firstPacket.analysisDigest,
      );
      assert.equal(event.event_data.operational_authorization, false);
    }
    const reviewAudit = packetAudit.find(
      (a) => a.entity_type === "risk_uncertainty_analysis_reviewed",
    );
    assert.equal(reviewAudit.event_data.approval_id, reviewed.approvalId);
    assert.equal(
      reviewAudit.event_data.derived_evidence_item_id,
      reviewed.derivedEvidenceItemId,
    );
    const voi = actualState.risks.find(
      (r) => r.id === f.risk,
    ).value_of_information;
    assert.equal(voi.analysis_id, firstPacket.analysisId);
    assert.equal(voi.validation_status, "validated");
    assert.equal(voi.reviewed_by, f.reviewer);
    assert.equal(voi.operational_authorization, false);
    const beforeVoi = beforeReview.risks.find(
      (r) => r.id === f.risk,
    ).value_of_information;
    for (const key of [
      "information_action",
      "information_cost",
      "decision_cost_if_wrong",
      "uncertainty_reduction",
      "probability_decision_changes",
      "expected_value",
      "net_value",
      "recommendation",
      "currency",
    ])
      assert.deepEqual(voi[key], beforeVoi[key]);
    assert.equal(
      actualState.audit.filter(
        (a) =>
          a.event_data.analysis_id === firstPacket.analysisId &&
          a.entity_type === "risk_uncertainty_analysis_reviewed",
      ).length,
      1,
    );
    assert.equal(actualState.decisions, null);
    assert.equal(actualState.work, null);
    const workspace = json(
      await actor.query(
        `select public.get_risk_uncertainty_workspace('${f.risk}')`,
      ),
    );
    const stale = workspace.analyses.find(
      (a) => a.id === firstPacket.analysisId,
    );
    assert.equal(stale.storedStatus, "validated");
    assert.equal(stale.validationStatus, "stale");
    assert.notEqual(stale.currentDigest, firstPacket.analysisDigest);
    // BEFORE-check: current criteria become ineligible while the reviewer is
    // genuinely waiting for that exact row. On wake, refuse before ALL writes.
    const secondPacket = await submitReceipt(f.other_risk, f.wrong_risk);
    await barrier.query(`begin; update public.risk_criteria_profiles set status='draft'
      where id='${f.criteria}' returning id`);
    const expectedRefusalState = await state(barrier);
    const waiting = actor.query(reviewSQL(secondPacket));
    waiting.catch(() => {});
    await blocked(actorPid, barrierPid);
    await barrier.query("commit");
    assert.deepEqual(json(await waiting), {
      error:
        "analysis changed after submission; submit a new version against the current evidence and thresholds",
    });
    assert.deepEqual(await state(), expectedRefusalState);
    const remaining = expectedRefusalState.packets.find(
      (a) => a.id === secondPacket.analysisId,
    );
    assert.equal(remaining.status, "pending_review");
    assert.equal(remaining.reviewer_id, null);
    assert.equal(remaining.approval_id, null);
    assert.equal(remaining.derived_evidence_item_id, null);
    assert.equal(
      expectedRefusalState.audit.filter(
        (a) =>
          a.event_data.analysis_id === secondPacket.analysisId &&
          a.entity_type === "risk_uncertainty_analysis_reviewed",
      ).length,
      0,
    );
    console.log(
      "U18 concurrent criteria PASS: actual approval barrier and criterion row waits, exact bound review ACK, subsequent stale standing, current-criteria refusal and full artifact preservation; NEW synthetic fixtures retained only in disposable CI until Stop Supabase. Not privacy/source/production qualification.",
    );
  } finally {
    await Promise.all(sessions.map((handle) => handle.close()));
  }
}

await qualify().catch(() => {
  throw new Error("U18 concurrent PostgreSQL qualification failed");
});
