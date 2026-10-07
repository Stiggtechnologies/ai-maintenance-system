// Three real PostgreSQL participants plus observer, not a mock or production proof.
// NEW synthetic fixtures are committed so sessions can see them, then retained
// only in disposable CI until the existing job's Stop Supabase teardown.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

const allowedPhases = new Set([
  "U18_BOOTSTRAP",
  "U18_CRITERIA_AFTER_CHECK",
  "U18_CRITERIA_BEFORE_CHECK",
  "U18_WRITER_WINS_TARGET",
  "U18_WRITER_WINS_ANCESTOR",
  "U18_WRITER_WINS_VIEW",
  "U18_WRITER_WINS_SCENARIO",
  "U18_HELPER_WINS_ANCESTOR_WRITE",
  "U18_HELPER_WINS_VIEW_DELETE",
  "U18_HELPER_WINS_NEW_GRANT",
  "U18_HELPER_WINS_VIEW_REPOINT",
  "U18_HELPER_WINS_WRONG_ORG_CORRECTION",
  "U18_HELPER_WINS_SCENARIO_WRITE",
  "U18_SUBMIT_EVIDENCE_BARRIER",
  "U18_FINAL_PROFILE_REVALIDATION",
  "U18_REVERSE_CHILD_OVERLAP",
  "U18_REPLACEMENT_RISK_COMPETITION",
  "U18_REPLACEMENT_EVIDENCE_RESTORE",
  "U18_REPLACEMENT_AFTER_CHECK",
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
  "U18_OPEN_ANCESTOR_DELETE",
  "U18_COMPLETE",
]);
let currentPhase = "U18_BOOTSTRAP";
const markPhase = (phase) => {
  assert(allowedPhases.has(phase));
  currentPhase = phase;
};

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
      new Error(
        `U18 concurrent PostgreSQL qualification failed: ${currentPhase}`,
      );
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
      and to_regprocedure('public.replace_risk_uncertainty_analysis(uuid,text)') is not null
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
    const stateSQL = stateBody
      .replaceAll("(select org from u18_fixture)", `'${f.org}'::uuid`)
      .replaceAll(
        "(select foreign_org from u18_fixture)",
        `'${f.foreign_org}'::uuid`,
      );
    assert(!stateSQL.includes("u18_fixture"));
    const state = async (handle = monitor) =>
      json(await handle.query(stateSQL));
    const bindingSnapshot = async (risk, evidence) =>
      json(
        await monitor.query(
          `select public.risk_uncertainty_input_binding_snapshot('${f.org}','${risk}',array['${evidence}'::uuid])`,
        ),
      );
    const analysisDigest = async (analysis) =>
      (
        await monitor.query(
          `select public.risk_uncertainty_analysis_digest('${f.org}','${analysis}')`,
        )
      ).at(-1);
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
      assert.deepEqual(receipt.valueOfInformation, {
        informationCost: 10000,
        decisionCostIfWrong: 250000,
        uncertaintyReduction: 0.5,
        probabilityDecisionChanges: 0.3,
        expectedValue: 37500,
        netValue: 27500,
        recommendation: "GATHER_INFORMATION",
      });
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
    const submitSQLFor = (risk, evidence, user = f.author) => `reset role;
      set role authenticated;
      select set_config('request.jwt.claim.sub','${user}',false);
      select public.submit_risk_uncertainty_analysis('${risk}',${literal(JSON.stringify(f.input))}::jsonb,array['${evidence}'::uuid])`;
    const reviewSQLFor = (packet, user = f.reviewer) => `reset role;
      set role authenticated;
      select set_config('request.jwt.claim.sub','${user}',false);
      select public.review_risk_uncertainty_analysis('${packet.analysisId}','validated',
        'Synthetic independent visibility-context qualification, not customer approval or operational authority.')`;
    const delta = (after, before, key) =>
      (after[key]?.length ?? 0) - (before[key]?.length ?? 0);
    const wholeStateKeys = [
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
    ];
    const copy = (value) => JSON.parse(JSON.stringify(value));
    const byId = (snapshot, collection, id) =>
      snapshot[collection]?.find((row) => row.id === id);
    const restoreRow = (normalized, before, collection, id) => {
      const original = byId(before, collection, id);
      assert(original);
      const index = normalized[collection].findIndex((row) => row.id === id);
      if (index === -1) normalized[collection].push(copy(original));
      else normalized[collection][index] = copy(original);
      normalized[collection].sort((left, right) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
      );
    };
    function assertSubmitAck(receipt, fixture) {
      assert.deepEqual(
        Object.keys(receipt).sort(),
        [
          "analysisDigest",
          "analysisId",
          "operationalAuthorization",
          "riskId",
          "validationStatus",
          "valueOfInformation",
          "version",
        ].sort(),
      );
      assert.equal(receipt.riskId, fixture.child);
      assert.match(receipt.analysisId, uuid);
      assert.match(receipt.analysisDigest, /^[0-9a-f]{64}$/);
      assert.equal(receipt.version, 1);
      assert.equal(receipt.validationStatus, "pending_review");
      assert.equal(receipt.operationalAuthorization, false);
    }
    function assertSubmitState(
      receipt,
      fixture,
      before,
      after,
      expectedSnapshot,
      currentDigest,
      replacement = null,
    ) {
      const citedEvidence = replacement ? fixture.newEvidence : [fixture.evidence];
      assert.deepEqual(
        Object.fromEntries(
          [
            "packets",
            "bindings",
            "approvals",
            "evidence",
            "audit",
            "securityEvents",
            "decisions",
            "work",
          ].map((key) => [key, delta(after, before, key)]),
        ),
        {
          packets: 1,
          bindings: citedEvidence.length,
          approvals: 0,
          evidence: 0,
          audit: 1,
          securityEvents: replacement?.securityEventDelta ?? 0,
          decisions: 0,
          work: 0,
        },
      );
      const persisted = after.packets.find((a) => a.id === receipt.analysisId);
      assert.deepEqual(
        Object.keys(persisted).sort(),
        [
          "analysis_digest",
          "approval_id",
          "author_id",
          "basis",
          "best_case_loss",
          "confidence_interval_lower",
          "confidence_interval_upper",
          "confidence_level",
          "created_at",
          "currency",
          "decision_thresholds",
          "derived_evidence_item_id",
          "digest_version",
          "expected_case_loss",
          "id",
          "input_binding_snapshot",
          "method",
          "operational_authorization",
          "organization_id",
          "probability_central",
          "probability_lower",
          "probability_upper",
          "reassessment_triggers",
          "replaces_analysis_id",
          "replacement_intent_id",
          "replacement_request_fingerprint",
          "replacement_compare_and_swap",
          "replacement_reason",
          "review_due_at",
          "review_note",
          "reviewed_at",
          "reviewer_id",
          "risk_id",
          "sensitivity_inputs",
          "sensitivity_results",
          "status",
          "superseded_by_analysis_id",
          "superseded_at",
          "superseded_by_user_id",
          "threshold_profile_id",
          "version",
          "voi_action",
          "voi_decision_cost_if_wrong",
          "voi_expected_value",
          "voi_information_cost",
          "voi_net_value",
          "voi_probability_decision_changes",
          "voi_recommendation",
          "voi_uncertainty_reduction",
          "worst_case_loss",
        ].sort(),
      );
      assert.equal(persisted.organization_id, f.org);
      assert.equal(persisted.risk_id, fixture.child);
      assert.equal(persisted.version, replacement ? 2 : 1);
      assert.equal(persisted.status, "pending_review");
      assert.equal(persisted.author_id, f.author);
      assert.equal(persisted.reviewer_id, null);
      assert.equal(persisted.analysis_digest, receipt.analysisDigest);
      if (replacement?.expectStale) assert.notEqual(currentDigest, receipt.analysisDigest);
      else assert.equal(currentDigest, receipt.analysisDigest);
      assert.equal(persisted.replaces_analysis_id, replacement?.request.predecessor.analysisId ?? null);
      assert.equal(persisted.replacement_intent_id, replacement?.request.intentId ?? null);
      assert.equal(persisted.replacement_request_fingerprint, replacement?.fingerprint ?? null);
      assert.deepEqual(persisted.replacement_compare_and_swap, replacement ? {
        ...replacement.request.predecessor, policyDigest: replacement.request.policyDigest,
      } : null);
      assert.equal(persisted.replacement_reason, replacement?.request.reason ?? null);
      for (const key of ["superseded_by_analysis_id", "superseded_at", "superseded_by_user_id"])
        assert.equal(persisted[key], null);
      assert.equal(persisted.digest_version, 2);
      assert.deepEqual(persisted.input_binding_snapshot, expectedSnapshot);
      assert.equal(expectedSnapshot.organizationId, f.org);
      assert.equal(expectedSnapshot.riskId, fixture.child);
      assert.deepEqual(expectedSnapshot.expectedEvidenceIds, citedEvidence);
      assert.equal(expectedSnapshot.expectedEvidenceCount, citedEvidence.length);
      assert.equal(expectedSnapshot.foundEvidenceCount, citedEvidence.length);
      assert.equal(expectedSnapshot.bindingComplete, true);
      assert.equal(expectedSnapshot.currentCriteriaProfileId, fixture.criteria);
      assert.equal(expectedSnapshot.currentCriteria.id, fixture.criteria);
      assert.deepEqual(expectedSnapshot.evidence.map((item) => item.id), citedEvidence);
      for (const item of expectedSnapshot.evidence) assert.equal(item.riskId, fixture.child);
      assert.equal(persisted.method, f.input.method);
      assert.equal(persisted.basis, f.input.basis);
      for (const field of [
        "probability_lower",
        "probability_central",
        "probability_upper",
        "confidence_level",
        "confidence_interval_lower",
        "confidence_interval_upper",
        "best_case_loss",
        "expected_case_loss",
        "worst_case_loss",
      ])
        assert.equal(persisted[field], f.input[field]);
      assert.equal(persisted.currency, f.input.currency);
      assert.deepEqual(persisted.sensitivity_inputs, f.input.sensitivity);
      assert.deepEqual(persisted.sensitivity_results, [
        {
          name: "Startup exposure",
          basis:
            "Synthetic CI startup and inspection history for this exact risk.",
          lowInput: 2,
          baseInput: 5,
          highInput: 8,
          lowOutput: 10000,
          baseOutput: 60000,
          highOutput: 180000,
          swing: 170000,
        },
      ]);
      assert.equal(persisted.threshold_profile_id, fixture.criteria);
      assert.deepEqual(persisted.decision_thresholds, {
        escalateAbove: 16,
        stopAbove: 24,
      });
      assert.deepEqual(
        persisted.reassessment_triggers,
        f.input.reassessment_triggers,
      );
      assert.equal(
        new Date(persisted.review_due_at).getTime(),
        new Date(f.input.review_due_at).getTime(),
      );
      assert.equal(persisted.voi_action, f.input.voi_action);
      assert.equal(
        persisted.voi_information_cost,
        f.input.voi_information_cost,
      );
      assert.equal(
        persisted.voi_decision_cost_if_wrong,
        f.input.voi_decision_cost_if_wrong,
      );
      assert.equal(
        persisted.voi_uncertainty_reduction,
        f.input.voi_uncertainty_reduction,
      );
      assert.equal(
        persisted.voi_probability_decision_changes,
        f.input.voi_probability_decision_changes,
      );
      assert.equal(persisted.voi_expected_value, 37500);
      assert.equal(persisted.voi_net_value, 27500);
      assert.equal(persisted.voi_recommendation, "GATHER_INFORMATION");
      assert.match(persisted.created_at, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(persisted.operational_authorization, false);
      assert.equal(persisted.approval_id, null);
      assert.equal(persisted.derived_evidence_item_id, null);
      assert.deepEqual(
        after.bindings
          .filter((b) => b.analysis_id === receipt.analysisId)
          .map((b) => b.evidence_item_id),
        citedEvidence,
      );
      const audits = after.audit.filter(
        (a) => a.event_data.analysis_id === receipt.analysisId,
      );
      assert.equal(audits.length, 1);
      assert.equal(
        audits[0].entity_type,
        replacement ? "risk_uncertainty_analysis_replaced" : "risk_uncertainty_analysis_submitted",
      );
      assert.equal(audits[0].event_data.risk_id, fixture.child);
      assert.equal(
        audits[0].event_data.analysis_digest,
        receipt.analysisDigest,
      );
      assert.equal(audits[0].event_data.operational_authorization, false);
      const beforeRisk = byId(before, "risks", fixture.child);
      const afterRisk = byId(after, "risks", fixture.child);
      const voi = afterRisk.value_of_information;
      assert.equal(voi.analysis_id, receipt.analysisId);
      assert.equal(voi.validation_status, "pending_review");
      assert.equal(voi.operational_authorization, false);
      assert.equal(voi.recorded_at, afterRisk.updated_at);
      assert.deepEqual(afterRisk, {
        ...beforeRisk,
        value_of_information: {
          information_action: f.input.voi_action,
          information_cost: 10000,
          decision_cost_if_wrong: 250000,
          uncertainty_reduction: 0.5,
          probability_decision_changes: 0.3,
          expected_value: 37500,
          net_value: 27500,
          recommendation: "GATHER_INFORMATION",
          currency: "CAD",
          analysis_id: receipt.analysisId,
          validation_status: "pending_review",
          recorded_at: voi.recorded_at,
          human_decision_required: true,
          operational_authorization: false,
        },
        updated_at: afterRisk.updated_at,
      });
    }
    function assertSubmitStateTransition(
      receipt,
      fixture,
      before,
      after,
      writer,
      expectedSnapshot,
      currentDigest,
    ) {
      assertSubmitState(
        receipt,
        fixture,
        before,
        after,
        expectedSnapshot,
        currentDigest,
      );
      writer.verify(before, after, fixture);
      const normalized = copy(after);
      normalized.packets = normalized.packets.filter(
        (row) => row.id !== receipt.analysisId,
      );
      normalized.bindings = normalized.bindings.filter(
        (row) => row.analysis_id !== receipt.analysisId,
      );
      normalized.audit = normalized.audit.filter(
        (row) =>
          !(
            row.entity_type === "risk_uncertainty_analysis_submitted" &&
            row.event_data.analysis_id === receipt.analysisId
          ),
      );
      restoreRow(normalized, before, "risks", fixture.child);
      writer.normalize(normalized, before, fixture);
      assert.deepEqual(
        Object.keys(normalized).sort(),
        [...wholeStateKeys].sort(),
      );
      // U18_NORMALIZED_WHOLE_STATE: every unlisted row in all thirteen
      // collections and both fixture organizations must be byte-for-byte equal.
      assert.deepEqual(normalized, before);
    }
    function assertReviewAck(receipt, packet, fixture, before, after) {
      assert.deepEqual(
        Object.keys(receipt).sort(),
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
      assert.equal(receipt.riskId, fixture.child);
      assert.equal(receipt.analysisId, packet.analysisId);
      assert.equal(receipt.analysisDigest, packet.analysisDigest);
      assert.equal(receipt.decision, "validated");
      assert.equal(receipt.operationalAuthorization, false);
      assert.match(receipt.approvalId, uuid);
      assert.match(receipt.derivedEvidenceItemId, uuid);
      assert.deepEqual(
        Object.fromEntries(
          [
            "packets",
            "bindings",
            "approvals",
            "evidence",
            "audit",
            "securityEvents",
            "decisions",
            "work",
          ].map((key) => [key, delta(after, before, key)]),
        ),
        {
          packets: 0,
          bindings: 0,
          approvals: 1,
          evidence: 1,
          audit: 2,
          securityEvents: 0,
          decisions: 0,
          work: 0,
        },
      );
      const persisted = after.packets.find((a) => a.id === packet.analysisId);
      assert.equal(persisted.organization_id, f.org);
      assert.equal(persisted.risk_id, fixture.child);
      assert.equal(persisted.version, packet.version);
      assert.equal(persisted.status, "validated");
      assert.equal(persisted.author_id, f.author);
      assert.equal(persisted.reviewer_id, f.reviewer);
      assert.equal(persisted.analysis_digest, packet.analysisDigest);
      assert.equal(persisted.approval_id, receipt.approvalId);
      assert.equal(
        persisted.derived_evidence_item_id,
        receipt.derivedEvidenceItemId,
      );
      const originalPacket = before.packets.find(
        (row) => row.id === packet.analysisId,
      );
      assert.deepEqual(persisted, {
        ...originalPacket,
        status: "validated",
        reviewer_id: f.reviewer,
        reviewed_at: persisted.reviewed_at,
        review_note:
          "Synthetic independent visibility-context qualification, not customer approval or operational authority.",
        approval_id: receipt.approvalId,
        derived_evidence_item_id: receipt.derivedEvidenceItemId,
      });
      const approval = after.approvals.find((a) => a.id === receipt.approvalId);
      assert.equal(approval.status, "approved");
      assert.equal(approval.organization_id, f.org);
      assert.equal(approval.risk_id, fixture.child);
      assert.equal(approval.approver_user_id, f.reviewer);
      assert.equal(approval.approval_scope.kind, "risk_uncertainty_analysis");
      assert.equal(approval.approval_scope.analysisId, packet.analysisId);
      assert.equal(approval.approval_scope.riskId, fixture.child);
      assert.equal(approval.approval_scope.version, packet.version);
      assert.equal(
        approval.approval_scope.analysisDigest,
        packet.analysisDigest,
      );
      assert.equal(approval.approval_scope.operationalAuthorization, false);
      const derived = after.evidence.find(
        (e) => e.id === receipt.derivedEvidenceItemId,
      );
      assert.equal(derived.organization_id, f.org);
      assert.equal(derived.risk_id, fixture.child);
      assert.equal(derived.evidence_class, "CALCULATED");
      assert.equal(derived.verification_status, "unverified");
      assert.equal(derived.provenance.analysisId, packet.analysisId);
      assert.equal(derived.provenance.analysisDigest, packet.analysisDigest);
      assert.equal(derived.provenance.approvalId, receipt.approvalId);
      assert.equal(derived.provenance.reviewedBy, f.reviewer);
      assert.equal(derived.provenance.operationalAuthorization, false);
      const audits = after.audit.filter(
        (a) => a.event_data.analysis_id === packet.analysisId,
      );
      assert.deepEqual(audits.map((a) => a.entity_type).sort(), [
        "risk_uncertainty_analysis_reviewed",
        "risk_uncertainty_analysis_submitted",
      ]);
      const reviewAudit = audits.find(
        (a) => a.entity_type === "risk_uncertainty_analysis_reviewed",
      );
      assert.equal(reviewAudit.event_data.approval_id, receipt.approvalId);
      assert.equal(
        reviewAudit.event_data.derived_evidence_item_id,
        receipt.derivedEvidenceItemId,
      );
      const approvalAudits = after.audit.filter(
        (a) =>
          a.entity_type === "approval_decision" &&
          a.event_data.approval_id === receipt.approvalId,
      );
      assert.equal(approvalAudits.length, 1);
      assert.equal(approvalAudits[0].organization_id, f.org);
      assert.equal(approvalAudits[0].event_time, approval.decided_at);
      assert.equal(approvalAudits[0].new_state.status, "approved");
      assert.deepEqual(after.bindings, before.bindings);
      assert.deepEqual(
        after.evidence.filter(
          (row) => row.id !== receipt.derivedEvidenceItemId,
        ),
        before.evidence,
      );
      const beforeRisk = byId(before, "risks", fixture.child);
      const afterRisk = byId(after, "risks", fixture.child);
      const beforeVoi = beforeRisk.value_of_information;
      const afterVoi = afterRisk.value_of_information;
      // U18_REVIEW_VOI_INPUT_FIELDS_UNCHANGED
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
        assert.deepEqual(afterVoi[key], beforeVoi[key]);
      assert.equal(afterVoi.analysis_id, packet.analysisId);
      assert.equal(afterVoi.validation_status, "validated");
      assert.equal(afterVoi.reviewed_by, f.reviewer);
      assert.equal(afterVoi.reviewed_at, persisted.reviewed_at);
      assert.equal(afterVoi.operational_authorization, false);
      assert.deepEqual(afterRisk, {
        ...beforeRisk,
        value_of_information: {
          ...beforeVoi,
          analysis_id: packet.analysisId,
          validation_status: "validated",
          reviewed_at: afterVoi.reviewed_at,
          reviewed_by: f.reviewer,
          operational_authorization: false,
        },
        updated_at: afterRisk.updated_at,
      });
    }
    function assertReviewStateTransition(
      receipt,
      packet,
      fixture,
      before,
      after,
      writer,
    ) {
      assertReviewAck(receipt, packet, fixture, before, after);
      writer.verify(before, after, fixture);
      const normalized = copy(after);
      normalized.approvals = normalized.approvals.filter(
        (row) => row.id !== receipt.approvalId,
      );
      normalized.evidence = normalized.evidence.filter(
        (row) => row.id !== receipt.derivedEvidenceItemId,
      );
      normalized.audit = normalized.audit.filter(
        (row) =>
          !(
            row.entity_type === "risk_uncertainty_analysis_reviewed" &&
            row.event_data.analysis_id === packet.analysisId
          ) &&
          !(
            row.entity_type === "approval_decision" &&
            row.event_data.approval_id === receipt.approvalId
          ),
      );
      restoreRow(normalized, before, "packets", packet.analysisId);
      restoreRow(normalized, before, "risks", fixture.child);
      writer.normalize(normalized, before, fixture);
      assert.deepEqual(
        Object.keys(normalized).sort(),
        [...wholeStateKeys].sort(),
      );
      assert.deepEqual(normalized, before);
    }
    async function visibilityFixture(label, sibling = false, oldEvidenceId = null) {
      // U18_VISIBILITY_FIXTURE: UUID ordering is intentional. The helper must
      // release locks acquired on grandparent/parent before a max-UUID target
      // refusal becomes visible to a third real session.
      const ordered = [randomUUID(), randomUUID(), randomUUID()].sort();
      const fixture = {
        criteria: randomUUID(),
        grandparent: ordered[0],
        parent: ordered[1],
        child: ordered[2],
        sibling: sibling ? randomUUID() : null,
        grandScenario: randomUUID(),
        parentScenario: randomUUID(),
        evidence: oldEvidenceId ?? randomUUID(),
        siblingEvidence: sibling ? randomUUID() : null,
        parentView: randomUUID(),
        grandView: randomUUID(),
        wrongOrgView: randomUUID(),
      };
      const siblingRisk = sibling
        ? `insert into public.risks(id,organization_id,criteria_profile_id,title,status,value_currency,created_by,
            risk_owner_id,information_sensitivity,secondary_to_risk_id,arising_from_scenario_id)
          values('${fixture.sibling}','${f.org}','${fixture.criteria}',${literal(`${label} sibling`)},'draft','CAD','${f.author}',
            '${f.author}','internal','${fixture.parent}','${fixture.parentScenario}');
          insert into public.evidence_items(id,organization_id,risk_id,source_system,evidence_type,description,
            evidence_class,verification_status,verified_by,verified_at,verification_method,quality_grade,applicability_grade,revision)
          values('${fixture.siblingEvidence}','${f.org}','${fixture.sibling}','CMMS','inspection',
            'Synthetic verified sibling evidence for overlap qualification.','INSPECTED','verified','${f.reviewer}',now(),
            'Synthetic independent inspection fixture','high','direct','R1');`
        : "";
      await monitor.query(`begin;
        insert into public.risk_criteria_profiles(id,organization_id,name,version,status,
          consequence_dimensions,likelihood_scale,thresholds,scoring_weights,decision_thresholds,
          risk_capacity,aggregate_rules,time_factors,tolerance_statements,basis,adopted_by,adopted_at)
        select '${fixture.criteria}',organization_id,${literal(`${label} fresh adopted criteria`)},1,'adopted',
          consequence_dimensions,likelihood_scale,thresholds,scoring_weights,
          '{"escalateAbove":16,"stopAbove":24}'::jsonb,risk_capacity,aggregate_rules,time_factors,
          tolerance_statements,'Disposable visibility concurrency fixture only, not customer policy.',
          '${f.reviewer}',now()
        from public.risk_criteria_profiles where id='${f.criteria}';
        insert into public.risks(id,organization_id,criteria_profile_id,title,status,value_currency,created_by,
          risk_owner_id,information_sensitivity)
        values('${fixture.grandparent}','${f.org}','${fixture.criteria}',${literal(`${label} grandparent`)},'draft','CAD',
          '${f.author}','${f.author}','restricted');
        insert into public.scenarios(id,organization_id,risk_id,key,label)
        values('${fixture.grandScenario}','${f.org}','${fixture.grandparent}',${literal(`${label}-grand`)},
          ${literal(`${label} canonical grandparent treatment`)});
        insert into public.risks(id,organization_id,criteria_profile_id,title,status,value_currency,created_by,
          risk_owner_id,information_sensitivity,secondary_to_risk_id,arising_from_scenario_id)
        values('${fixture.parent}','${f.org}','${fixture.criteria}',${literal(`${label} parent`)},'draft','CAD',
          '${f.author}','${f.author}','restricted','${fixture.grandparent}','${fixture.grandScenario}');
        insert into public.scenarios(id,organization_id,risk_id,key,label)
        values('${fixture.parentScenario}','${f.org}','${fixture.parent}',${literal(`${label}-parent`)},
          ${literal(`${label} canonical parent treatment`)});
        insert into public.risks(id,organization_id,criteria_profile_id,title,status,value_currency,created_by,
          risk_owner_id,information_sensitivity,secondary_to_risk_id,arising_from_scenario_id)
        values('${fixture.child}','${f.org}','${fixture.criteria}',${literal(`${label} child`)},'draft','CAD',
          '${f.author}','${f.author}','internal','${fixture.parent}','${fixture.parentScenario}');
        ${siblingRisk}
        insert into public.risk_stakeholder_views(
          id,organization_id,stakeholder_user_id,risk_id,stakeholder_name,rationale)
        values('${fixture.parentView}','${f.org}','${f.reviewer}','${fixture.parent}',
          'Synthetic reviewer','Explicit restricted parent visibility for native qualification.'),
          ('${fixture.grandView}','${f.org}','${f.reviewer}','${fixture.grandparent}',
          'Synthetic reviewer','Explicit restricted grandparent visibility for native qualification.'),
          ('${fixture.wrongOrgView}','${f.foreign_org}','${f.foreign_user}','${fixture.parent}',
          'Synthetic foreign row','Deliberately wrong-org inverse reference; no content is exposed to RPC callers.');
        insert into public.evidence_items(id,organization_id,risk_id,source_system,evidence_type,description,
          evidence_class,verification_status,verified_by,verified_at,verification_method,quality_grade,applicability_grade,revision)
        values('${fixture.evidence}','${f.org}','${fixture.child}','CMMS','inspection',
          'Synthetic verified evidence for the exact visibility child.','INSPECTED','verified','${f.reviewer}',now(),
          'Synthetic independent inspection fixture','high','direct','R1');
        commit; select '${fixture.child}'`);
      return fixture;
    }
    const noWriter = {
      verify() {},
      normalize() {},
    };
    const replacementWriter = (collection, idFor, changesFor) => ({
      verify(before, after, fixture) {
        const id = idFor(fixture);
        const original = byId(before, collection, id);
        assert.deepEqual(byId(after, collection, id), {
          ...original,
          ...changesFor(original, fixture),
        });
      },
      normalize(normalized, before, fixture) {
        restoreRow(normalized, before, collection, idFor(fixture));
      },
    });
    const deletionWriter = (collection, idFor) => ({
      verify(before, after, fixture) {
        assert(byId(before, collection, idFor(fixture)));
        assert.equal(byId(after, collection, idFor(fixture)), undefined);
      },
      normalize(normalized, before, fixture) {
        restoreRow(normalized, before, collection, idFor(fixture));
      },
    });
    // AFTER-check: review reaches the real approval INSERT and holds the
    // criterion. A concurrent correction must wait for the reviewer to commit.
    markPhase("U18_CRITERIA_AFTER_CHECK");
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
    markPhase("U18_CRITERIA_BEFORE_CHECK");
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

    // Writer wins: pre-held canonical context rows make BOTH public mutation
    // RPCs return the same generic privacy refusal promptly. A third session
    // then locks an earlier risk NOWAIT, proving the helper exception released
    // every partial lock instead of waiting, deadlocking or leaking context.
    for (const writerCase of [
      {
        label: "U18_WRITER_WINS_TARGET",
        resource: (x) =>
          `select id from public.risks where id='${x.child}' for update`,
        operation: "submit",
      },
      {
        label: "U18_WRITER_WINS_ANCESTOR",
        resource: (x) =>
          `select id from public.risks where id='${x.parent}' for update`,
        operation: "submit",
      },
      {
        label: "U18_WRITER_WINS_VIEW",
        resource: (x) =>
          `select id from public.risk_stakeholder_views where id='${x.parentView}' for update`,
        operation: "review",
      },
      {
        label: "U18_WRITER_WINS_SCENARIO",
        resource: (x) =>
          `select id from public.scenarios where id='${x.parentScenario}' for update`,
        operation: "review",
      },
    ]) {
      markPhase(writerCase.label);
      const fixture = await visibilityFixture(writerCase.label);
      const packet =
        writerCase.operation === "review"
          ? await submitReceipt(fixture.child, fixture.evidence)
          : null;
      const before = await state();
      await barrier.query(`begin; ${writerCase.resource(fixture)}`);
      const writerWinsStarted = Date.now();
      const refused = json(
        await actor.query(
          `begin; ${
            writerCase.operation === "review"
              ? reviewSQLFor(packet)
              : submitSQLFor(fixture.child, fixture.evidence)
          }`,
        ),
      );
      const writerWinsElapsedMs = Date.now() - writerWinsStarted;
      assert(writerWinsElapsedMs < 5000);
      assert.deepEqual(refused, {
        error: "risk not found in this organization",
      });
      // U18_OUTER_REFUSAL_TRANSACTION_OPEN: inspect the actor's own
      // uncommitted view before proving partial row locks were released.
      const actorStateInsideRefusal = json(
        await actor.query(`reset role; ${stateSQL}`),
      );
      assert.deepEqual(actorStateInsideRefusal, before);
      assert.deepEqual(await state(), before);
      // U18_PARTIAL_LOCK_RELEASE
      assert.equal(
        (
          await changer.query(`begin;
            select id from public.risks where id='${fixture.grandparent}' for update nowait;
            commit; select 'released'`)
        ).at(-1),
        "released",
      );
      await actor.query("rollback");
      await barrier.query("rollback");
      assert.deepEqual(await state(), before);
    }

    // Helper wins: the real review reaches its approval INSERT barrier only
    // after holding every privacy dependency. Each legitimate outsider writer
    // must be observed waiting on the actor, then commit after the exact bound
    // review ACK. Snapshots include both fixture organizations and all artifacts.
    const lateGrantId = randomUUID();
    for (const helperCase of [
      {
        ...replacementWriter(
          "risks",
          (x) => x.parent,
          (row) => ({ title: `${row.title} checked` }),
        ),
        label: "U18_HELPER_WINS_ANCESTOR_WRITE",
        mutation: (x) =>
          `update public.risks set title=title||' checked' where id='${x.parent}' returning id`,
      },
      {
        ...deletionWriter("stakeholderViews", (x) => x.parentView),
        label: "U18_HELPER_WINS_VIEW_DELETE",
        mutation: (x) =>
          `delete from public.risk_stakeholder_views where id='${x.parentView}' returning id`,
      },
      {
        label: "U18_HELPER_WINS_NEW_GRANT",
        mutation: (x) =>
          `insert into public.risk_stakeholder_views(
            id,organization_id,stakeholder_user_id,risk_id,stakeholder_name,rationale)
          values('${lateGrantId}','${f.org}','${f.author}','${x.parent}',
            'Synthetic late grant','Concurrent grant must respect the visibility fence.') returning id`,
        verify(before, after, x) {
          assert.equal(
            byId(before, "stakeholderViews", lateGrantId),
            undefined,
          );
          const inserted = byId(after, "stakeholderViews", lateGrantId);
          assert.match(inserted.recorded_at, /^\d{4}-\d{2}-\d{2}T/);
          assert.deepEqual(
            { ...inserted, recorded_at: null },
            {
              id: lateGrantId,
              organization_id: f.org,
              risk_id: x.parent,
              stakeholder_user_id: f.author,
              stakeholder_name: "Synthetic late grant",
              stakeholder_role: null,
              view_kind: "technical",
              perceived_likelihood: null,
              perceived_consequence: null,
              concern_level: null,
              rationale: "Concurrent grant must respect the visibility fence.",
              assumptions: [],
              information_to_resolve: null,
              status: "open",
              resolved_by_view_id: null,
              recorded_at: null,
            },
          );
        },
        normalize(normalized) {
          normalized.stakeholderViews = normalized.stakeholderViews.filter(
            (row) => row.id !== lateGrantId,
          );
        },
      },
      {
        ...replacementWriter(
          "stakeholderViews",
          (x) => x.wrongOrgView,
          (_row, x) => ({ risk_id: x.child }),
        ),
        label: "U18_HELPER_WINS_VIEW_REPOINT",
        mutation: (x) =>
          `update public.risk_stakeholder_views set risk_id='${x.child}'
            where id='${x.wrongOrgView}' returning id`,
      },
      {
        ...replacementWriter(
          "stakeholderViews",
          (x) => x.wrongOrgView,
          () => ({
            organization_id: f.org,
            stakeholder_user_id: f.reviewer,
          }),
        ),
        label: "U18_HELPER_WINS_WRONG_ORG_CORRECTION",
        mutation: (x) =>
          `update public.risk_stakeholder_views
            set organization_id='${f.org}',stakeholder_user_id='${f.reviewer}'
            where id='${x.wrongOrgView}' returning id`,
      },
      {
        ...replacementWriter(
          "scenarios",
          (x) => x.parentScenario,
          (row) => ({ label: `${row.label} checked` }),
        ),
        label: "U18_HELPER_WINS_SCENARIO_WRITE",
        mutation: (x) =>
          `update public.scenarios set label=label||' checked'
            where id='${x.parentScenario}' returning id`,
      },
    ]) {
      markPhase(helperCase.label);
      const fixture = await visibilityFixture(helperCase.label);
      const packet = await submitReceipt(fixture.child, fixture.evidence);
      const before = await state();
      await barrier.query("begin; lock table public.approvals in share mode");
      const reviewing = actor.query(reviewSQLFor(packet));
      reviewing.catch(() => {});
      await blocked(actorPid, barrierPid);
      const changing = changer.query(
        `begin; ${helperCase.mutation(fixture)}; select 'changed'`,
      );
      changing.catch(() => {});
      await blocked(changerPid, actorPid);
      await barrier.query("commit");
      const reviewed = json(await reviewing);
      assert.equal((await changing).at(-1), "changed");
      await changer.query("commit");
      const after = await state();
      assertReviewStateTransition(
        reviewed,
        packet,
        fixture,
        before,
        after,
        helperCase,
      );
      if (helperCase.label === "U18_HELPER_WINS_VIEW_DELETE") {
        // U18_DELETED_VIEW_WORKSPACE_REFUSAL: reviewer is a restricted-parent
        // non-owner and the one qualifying view is now gone.
        const beforeRead = await state();
        assert.deepEqual(
          json(
            await actor.query(
              `select public.get_risk_uncertainty_workspace('${fixture.child}')`,
            ),
          ),
          { error: "risk not found in this organization" },
        );
        assert.deepEqual(await state(), beforeRead);
      }
    }

    // U18_SUBMIT_EVIDENCE_BARRIER: a real submit holds its complete visibility
    // context while waiting at the retained evidence FOR UPDATE barrier.
    {
      markPhase("U18_SUBMIT_EVIDENCE_BARRIER");
      const fixture = await visibilityFixture("U18_SUBMIT_EVIDENCE_BARRIER");
      const before = await state();
      const expectedSnapshot = await bindingSnapshot(
        fixture.child,
        fixture.evidence,
      );
      const writer = replacementWriter(
        "risks",
        (x) => x.parent,
        (row) => ({ title: `${row.title} after-submit` }),
      );
      await barrier.query(`begin;
        select id from public.evidence_items where id='${fixture.evidence}' for update`);
      const submitting = actor.query(
        submitSQLFor(fixture.child, fixture.evidence),
      );
      submitting.catch(() => {});
      await blocked(actorPid, barrierPid);
      const changing = changer.query(`begin;
        update public.risks set title=title||' after-submit'
          where id='${fixture.parent}' returning id;
        select 'changed'`);
      changing.catch(() => {});
      await blocked(changerPid, actorPid);
      await barrier.query("commit");
      const submitted = json(await submitting);
      assert.equal((await changing).at(-1), "changed");
      await changer.query("commit");
      const after = await state();
      assertSubmitAck(submitted, fixture);
      assertSubmitStateTransition(
        submitted,
        fixture,
        before,
        after,
        writer,
        expectedSnapshot,
        await analysisDigest(submitted.analysisId),
      );
    }

    // U18_FINAL_PROFILE_REVALIDATION: the profile is intentionally not locked
    // until all explicit input waits finish. A role change can commit first;
    // the waking submit must reread it and refuse without creating artifacts.
    {
      markPhase("U18_FINAL_PROFILE_REVALIDATION");
      const fixture = await visibilityFixture("U18_FINAL_PROFILE_REVALIDATION");
      await barrier.query(`begin;
        select id from public.evidence_items where id='${fixture.evidence}' for update`);
      const submitting = actor.query(
        submitSQLFor(fixture.child, fixture.evidence),
      );
      submitting.catch(() => {});
      await blocked(actorPid, barrierPid);
      await changer.query(`begin;
        update public.user_profiles set role='technician' where id='${f.author}' returning id;
        commit`);
      const roleChanged = await state();
      await barrier.query("commit");
      assert.deepEqual(json(await submitting), {
        error:
          "current named human engineering or management membership required",
      });
      assert.deepEqual(await state(), roleChanged);
      await monitor.query(
        `update public.user_profiles set role='admin' where id='${f.author}' returning id`,
      );
    }

    // U18_REVERSE_CHILD_OVERLAP: one child holds the shared typed ancestry
    // while blocked on its own evidence. The reverse child receives one clean
    // NOWAIT refusal; the first child then completes positively without a
    // deadlock, retry or ambiguous timeout.
    {
      markPhase("U18_REVERSE_CHILD_OVERLAP");
      const fixture = await visibilityFixture(
        "U18_REVERSE_CHILD_OVERLAP",
        true,
      );
      const before = await state();
      const expectedSnapshot = await bindingSnapshot(
        fixture.child,
        fixture.evidence,
      );
      await barrier.query(`begin;
        select id from public.evidence_items where id='${fixture.evidence}' for update`);
      const winning = actor.query(
        submitSQLFor(fixture.child, fixture.evidence),
      );
      winning.catch(() => {});
      await blocked(actorPid, barrierPid);
      const overlapStarted = Date.now();
      const refused = json(
        await changer.query(
          submitSQLFor(fixture.sibling, fixture.siblingEvidence),
        ),
      );
      assert(Date.now() - overlapStarted < 5000);
      assert.deepEqual(refused, {
        error: "risk not found in this organization",
      });
      await barrier.query("commit");
      const submitted = json(await winning);
      const after = await state();
      assertSubmitAck(submitted, fixture);
      assertSubmitStateTransition(
        submitted,
        fixture,
        before,
        after,
        noWriter,
        expectedSnapshot,
        await analysisDigest(submitted.analysisId),
      );
    }

    // U18_REPLACEMENT_CONCURRENCY BEGIN
    // The committed fixtures below belong only to this disposable CI database.
    // Every race uses the actual authenticated RPC, observed backend PIDs and
    // independently normalized before/after state, not a timeout or mock ACK.
    async function replacementFixture(label, rebound = false) {
      const evidenceIds = [randomUUID(), randomUUID(), randomUUID()].sort();
      const fixture = await visibilityFixture(label, false, evidenceIds[2]);
      fixture.newEvidence = evidenceIds.slice(0, 2);
      assert(fixture.newEvidence.every((id) => id < fixture.evidence));
      await monitor.query(`begin;
        insert into public.evidence_items(id,organization_id,risk_id,source_system,evidence_type,description,
          evidence_class,verification_status,verified_by,verified_at,verification_method,quality_grade,applicability_grade,revision)
        select id,'${f.org}','${fixture.child}','CMMS','inspection',
          'Synthetic independently verified replacement input for this exact child.',
          'INSPECTED','verified','${f.reviewer}',now(),'Synthetic independent replacement inspection',
          'high','direct','R1'
        from unnest(array[${fixture.newEvidence.map((id) => `'${id}'::uuid`).join(",")}]) id;
        commit`);
      fixture.packet = await submitReceipt(fixture.child, fixture.evidence);
      await monitor.query(rebound
        ? `update public.evidence_items set risk_id='${f.other_risk}' where id='${fixture.evidence}' returning id`
        : `update public.evidence_items set description=description||' Committed synthetic content drift.'
            where id='${fixture.evidence}' returning id`);
      const snapshot = await state();
      assert.equal(byId(snapshot, "evidence", fixture.evidence).risk_id,
        rebound ? f.other_risk : fixture.child);
      assert.notEqual(await analysisDigest(fixture.packet.analysisId), fixture.packet.analysisDigest);
      return fixture;
    }
    async function replacementRequest(fixture) {
      const predecessor = json(await monitor.query(`select jsonb_build_object(
        'analysisId',a.id,'version',a.version,'digestVersion',a.digest_version,
        'analysisDigest',a.analysis_digest,'currentDigest',public.risk_uncertainty_analysis_digest('${f.org}',a.id))
        from public.risk_uncertainty_analyses a
        where a.id='${fixture.packet.analysisId}' and a.organization_id='${f.org}' and a.risk_id='${fixture.child}'`));
      const policyDigest = (await monitor.query(
        `select public.risk_uncertainty_current_policy_digest('${f.org}','${fixture.child}')`,
      )).at(-1);
      assert.match(policyDigest, /^[0-9a-f]{64}$/);
      const request = {
        contractVersion: 1, action: "replace", intentId: randomUUID(),
        organizationId: f.org, actorId: f.author, riskId: fixture.child,
        predecessor, policyDigest,
        reason: "Synthetic native concurrency replacement after an actual committed input change.",
        analysis: copy(f.input), evidenceItemIds: fixture.newEvidence,
      };
      const text = JSON.stringify(request);
      const fingerprint = createHash("sha256").update(text, "utf8").digest("hex");
      return { request, text, fingerprint };
    }
    const replaceSQL = (fixture, info) => `reset role; set role authenticated;
      select set_config('request.jwt.claim.sub','${f.author}',false);
      select public.replace_risk_uncertainty_analysis('${fixture.child}',${literal(info.text)})`;
    async function replacementSnapshot(fixture) {
      return json(await monitor.query(`select public.risk_uncertainty_input_binding_snapshot(
        '${f.org}','${fixture.child}',array[${fixture.newEvidence.map((id) => `'${id}'::uuid`).join(",")}])`));
    }
    function assertNamedEvidenceChange(before, after, id, changes) {
      assert.deepEqual(byId(after, "evidence", id), {
        ...byId(before, "evidence", id), ...changes,
      });
      const normalized = copy(after);
      restoreRow(normalized, before, "evidence", id);
      assert.deepEqual(Object.keys(normalized).sort(), [...wholeStateKeys].sort());
      // This also freezes the old packet, bindings, digest, VOI, every audit,
      // approval and all foreign fixture rows; it is not merely a count check.
      assert.deepEqual(normalized, before);
    }
    function assertReplacementTransition(receipt, fixture, info, before, after,
      expectedSnapshot, currentDigest, writer = noWriter) {
      assert.deepEqual(Object.keys(receipt).sort(), [
        "commitStatus", "submittedStatus", "organizationId", "actorId", "riskId",
        "intentId", "requestFingerprint", "predecessorAnalysisId", "compareAndSwap",
        "analysisId", "version", "analysisDigest", "digestVersion", "digestCoverage",
        "valueOfInformation", "operationalAuthorization",
      ].sort());
      assert.equal(receipt.commitStatus, "committed");
      assert.equal(receipt.submittedStatus, "pending_review");
      assert.equal(receipt.organizationId, f.org);
      assert.equal(receipt.actorId, f.author);
      assert.equal(receipt.riskId, fixture.child);
      assert.equal(receipt.intentId, info.request.intentId);
      assert.equal(receipt.requestFingerprint, info.fingerprint);
      assert.equal(receipt.predecessorAnalysisId, fixture.packet.analysisId);
      assert.deepEqual(receipt.compareAndSwap, {
        ...info.request.predecessor, policyDigest: info.request.policyDigest,
      });
      assert.match(receipt.analysisId, uuid);
      assert.match(receipt.analysisDigest, /^[0-9a-f]{64}$/);
      assert.equal(receipt.version, 2);
      assert.equal(receipt.digestVersion, 2);
      assert.equal(receipt.digestCoverage, "evidence_content_and_current_criteria");
      assert.equal(receipt.operationalAuthorization, false);
      assert.deepEqual(receipt.valueOfInformation, {
        informationCost: 10000, decisionCostIfWrong: 250000,
        uncertaintyReduction: 0.5, probabilityDecisionChanges: 0.3,
        expectedValue: 37500, netValue: 27500, recommendation: "GATHER_INFORMATION",
      });
      assertSubmitState(receipt, fixture, before, after, expectedSnapshot, currentDigest,
        { ...info, expectStale: writer.expectStale ?? (writer !== noWriter),
          securityEventDelta: writer.securityEventDelta ?? 0 });
      const successor = byId(after, "packets", receipt.analysisId);
      assert.deepEqual(byId(after, "packets", fixture.packet.analysisId), {
        ...byId(before, "packets", fixture.packet.analysisId), status: "superseded",
        superseded_by_analysis_id: receipt.analysisId, superseded_at: successor.created_at,
        superseded_by_user_id: f.author,
      });
      const audits = after.audit.filter((row) => row.event_data.analysis_id === receipt.analysisId);
      assert.equal(audits.length, 1);
      const audit = audits[0];
      assert.equal(audit.entity_type, "risk_uncertainty_analysis_replaced");
      assert.equal(audit.organization_id, f.org);
      assert.equal(audit.actor, fixture.authorRole ?? "admin");
      assert.deepEqual(audit.event_data, {
        risk_id: fixture.child, analysis_id: receipt.analysisId, version: 2,
        analysis_digest: receipt.analysisDigest, evidence_item_ids: fixture.newEvidence,
        threshold_profile_id: fixture.criteria, operational_authorization: false,
        predecessor_analysis_id: fixture.packet.analysisId, replacement_intent_id: info.request.intentId,
        request_fingerprint: info.fingerprint, compare_and_swap: receipt.compareAndSwap,
        reason: info.request.reason,
      });
      writer.verify(before, after, fixture);
      const normalized = copy(after);
      normalized.packets = normalized.packets.filter((row) => row.id !== receipt.analysisId);
      normalized.bindings = normalized.bindings.filter((row) => row.analysis_id !== receipt.analysisId);
      normalized.audit = normalized.audit.filter((row) => row.id !== audit.id);
      restoreRow(normalized, before, "packets", fixture.packet.analysisId);
      restoreRow(normalized, before, "risks", fixture.child);
      writer.normalize(normalized, before, fixture);
      assert.deepEqual(Object.keys(normalized).sort(), [...wholeStateKeys].sort());
      assert.deepEqual(normalized, before);
    }

    // U18_REPLACEMENT_RISK_COMPETITION: one actual replacement holds the risk
    // at a criterion wait. A different-intent actual same-risk RPC must refuse
    // NOWAIT without a second successor; the first then commits positively.
    {
      markPhase("U18_REPLACEMENT_RISK_COMPETITION");
      const fixture = await replacementFixture("U18_REPLACEMENT_RISK_COMPETITION");
      const info = await replacementRequest(fixture);
      const competingInfo = await replacementRequest(fixture);
      assert.notEqual(info.request.intentId, competingInfo.request.intentId);
      const before = await state();
      const expectedSnapshot = await replacementSnapshot(fixture);
      await barrier.query(`begin; select id from public.risk_criteria_profiles
        where id='${fixture.criteria}' for update`);
      const replacing = actor.query(replaceSQL(fixture, info));
      replacing.catch(() => {});
      await blocked(actorPid, barrierPid);
      const started = Date.now();
      const refused = json(await changer.query(replaceSQL(fixture, competingInfo)));
      assert(Date.now() - started < 5000);
      assert.deepEqual(refused, { error: "risk not found in this organization" });
      assert.deepEqual(await state(), before);
      await barrier.query("commit");
      const receipt = json(await replacing);
      const after = await state();
      assertReplacementTransition(receipt, fixture, info, before, after, expectedSnapshot,
        await analysisDigest(receipt.analysisId));
    }

    // U18_REPLACEMENT_EVIDENCE_RESTORE: evidence UPDATE owns its tuple then
    // waits for the actor's risk FK KEY SHARE. The actor must refuse its union
    // NOWAIT promptly, not form a risk↔evidence deadlock or accept a timeout.
    {
      markPhase("U18_REPLACEMENT_EVIDENCE_RESTORE");
      const fixture = await replacementFixture("U18_REPLACEMENT_EVIDENCE_RESTORE", true);
      const info = await replacementRequest(fixture);
      const before = await state();
      await barrier.query(`begin; select id from public.risk_criteria_profiles
        where id='${fixture.criteria}' for update`);
      const replacing = actor.query(`begin; ${replaceSQL(fixture, info)}`);
      replacing.catch(() => {});
      await blocked(actorPid, barrierPid);
      const restoring = changer.query(`reset role; select set_config('request.jwt.claim.sub','',false);
        begin; update public.evidence_items set risk_id='${fixture.child}'
        where id='${fixture.evidence}' returning id; select 'restored'`);
      restoring.catch(() => {});
      await blocked(changerPid, actorPid);
      const releasedAt = Date.now();
      await barrier.query("commit");
      const refused = json(await replacing);
      assert(Date.now() - releasedAt < 5000);
      assert.deepEqual(refused, { error: "replacement evidence is busy; reload the governed workspace" });
      // U18_REPLACEMENT_OUTER_TX_WITNESS: the refusal is inspected while the
      // actor still holds its risk context. The waiting writer cannot finish yet.
      const context = json(await actor.query(`select jsonb_build_object(
        'marker',coalesce(current_setting('app.risk_uncertainty_write',true),''),
        'claim',current_setting('request.jwt.claim.sub',true),'actor',auth.uid(),
        'organization',public.app_current_org(),'role',current_user)`));
      assert.deepEqual(context, { marker: "", claim: f.author, actor: f.author,
        organization: f.org, role: "authenticated" });
      const actorVisibleRefusal = json(await actor.query(`reset role; ${stateSQL}`));
      assert.deepEqual(actorVisibleRefusal, before);
      assert.deepEqual(await state(), before);
      await blocked(changerPid, actorPid);
      // U18_REPLACEMENT_PARTIAL_UNION_RELEASE: both new IDs precede the busy
      // old row, so a third session proves the subtransaction released them.
      assert.equal((await barrier.query(`begin;
        ${fixture.newEvidence.map((id) => `select id from public.evidence_items where id='${id}' for update nowait`).join(";")};
        commit; select 'replacement partial union released'`)).at(-1), "replacement partial union released");
      await actor.query("rollback");
      assert.equal((await restoring).at(-1), "restored");
      await changer.query("commit");
      const after = await state();
      assertNamedEvidenceChange(before, after, fixture.evidence, { risk_id: fixture.child });
    }

    // U18_REPLACEMENT_AFTER_CHECK: replacement holds both old and new inputs
    // through its last actual audit INSERT. A legitimate content writer waits
    // until commit, then makes the immutable successor explicitly stale.
    {
      markPhase("U18_REPLACEMENT_AFTER_CHECK");
      const fixture = await replacementFixture("U18_REPLACEMENT_AFTER_CHECK");
      const info = await replacementRequest(fixture);
      const before = await state();
      const expectedSnapshot = await replacementSnapshot(fixture);
      const writer = replacementWriter("evidence", (x) => x.newEvidence[0],
        (row) => ({ description: `${row.description} After replacement commit.` }));
      await barrier.query("begin; lock table public.audit_events in share mode");
      const replacing = actor.query(replaceSQL(fixture, info));
      replacing.catch(() => {});
      await blocked(actorPid, barrierPid);
      const writing = changer.query(`reset role; select set_config('request.jwt.claim.sub','',false);
        begin; update public.evidence_items set description=description||' After replacement commit.'
        where id='${fixture.newEvidence[0]}' returning id; select 'replacement input changed'`);
      writing.catch(() => {});
      await blocked(changerPid, actorPid);
      await barrier.query("commit");
      const receipt = json(await replacing);
      assert.equal((await writing).at(-1), "replacement input changed");
      await changer.query("commit");
      const after = await state();
      assert.notEqual(await analysisDigest(receipt.analysisId), receipt.analysisDigest);
      assertReplacementTransition(receipt, fixture, info, before, after, expectedSnapshot,
        await analysisDigest(receipt.analysisId), writer);
    }
    // U18_REPLACEMENT_AUTHORITY_RACES BEGIN
    // Actual session barriers and explicit committed-before evidence controls.
    // A normal refusal must preserve all thirteen
    // collections; canonical service-side membership changes have their own
    // independently checked security event, never an uncertainty artifact.
    async function assertActorContext(handle, user = f.author, organization = f.org) {
      const context = json(await handle.query(`select jsonb_build_object(
        'marker',coalesce(current_setting('app.risk_uncertainty_write',true),''),
        'claim',current_setting('request.jwt.claim.sub',true),'actor',auth.uid(),
        'organization',public.app_current_org(),'role',current_user)`));
      assert.deepEqual(context, { marker: "", claim: user, actor: user,
        organization, role: "authenticated" });
    }
    function assertWholeStatePreserved(before, after, fixture, writer = noWriter) {
      writer.verify(before, after, fixture);
      const normalized = copy(after);
      writer.normalize(normalized, before, fixture);
      assert.deepEqual(Object.keys(normalized).sort(), [...wholeStateKeys].sort());
      assert.deepEqual(normalized, before);
    }
    async function promptRefusal(handle, sql, expected, user = f.author, organization = f.org) {
      const started = Date.now();
      assert.deepEqual(json(await handle.query(sql)), { error: expected });
      assert(Date.now() - started < 5000);
      await assertActorContext(handle, user, organization);
    }
    const serviceSQL = "reset role; select set_config('request.jwt.claim.sub','',false)";
    function profileWriter(field, value) {
      assert(["role", "organization_id"].includes(field));
      const changed = replacementWriter("profiles", () => f.author, () => ({ [field]: value }));
      const events = (before, after) => after.securityEvents.filter(
        (row) => !before.securityEvents.some((old) => old.id === row.id));
      return {
        expectStale: false, securityEventDelta: 1,
        verify(before, after, fixture) {
          changed.verify(before, after, fixture);
          assert.equal(delta(after, before, "securityEvents"), 1);
          const added = events(before, after);
          assert.equal(added.length, 1);
          const event = added[0];
          assert.match(event.id, uuid);
          assert.match(event.created_at, /^\d{4}-\d{2}-\d{2}T/);
          const old = byId(before, "profiles", f.author);
          const subject = old.email ?? old.id;
          assert.deepEqual(event, {
            id: event.id, created_at: event.created_at,
            organization_id: field === "organization_id" ? value : old.organization_id,
            actor_id: null, actor_label: null,
            event_type: field === "role" ? "role_changed" : "org_changed",
            severity: field === "role" && !["admin", "ai_admin"].includes(value) ? "notice" : "warning",
            detail: field === "role"
              ? `Role for ${subject} changed from ${old.role ?? "none"} to ${value}`
              : `Organization for ${subject} changed from ${old.organization_id ?? "none"} to ${value}`,
            ip: null, user_agent: null,
          });
        },
        normalize(normalized, before, fixture) {
          // Only the one exact event above is removed; old events stay frozen.
          const added = events(before, normalized);
          assert.equal(added.length, 1);
          normalized.securityEvents = normalized.securityEvents.filter((row) => row.id !== added[0].id);
          changed.normalize(normalized, before, fixture);
        },
      };
    }

    // Replacement's final audit INSERT holds the predecessor and risk context:
    // old-packet review and ordinary submit each refuse NOWAIT, then refuse their
    // lifecycle/pending gate after the winner has committed.
    for (const contender of [
      { phase: "U18_REPLACEMENT_VS_REVIEW", sql: (x) => reviewSQLFor(x.packet),
        user: f.reviewer, after: "same-tenant uncertainty analysis is not awaiting review" },
      { phase: "U18_REPLACEMENT_VS_SUBMIT", sql: (x) => submitSQLFor(x.child, x.evidence),
        user: f.author, after: "this risk already has an uncertainty analysis awaiting independent review" },
    ]) {
      markPhase(contender.phase);
      const fixture = await replacementFixture(contender.phase);
      const info = await replacementRequest(fixture);
      const before = await state();
      const expectedSnapshot = await replacementSnapshot(fixture);
      await barrier.query("begin; lock table public.audit_events in share mode");
      const replacing = actor.query(replaceSQL(fixture, info));
      replacing.catch(() => {});
      await blocked(actorPid, barrierPid);
      await promptRefusal(changer, contender.sql(fixture), "risk not found in this organization", contender.user);
      assertWholeStatePreserved(before, await state(), fixture);
      await barrier.query("commit");
      const receipt = json(await replacing);
      await assertActorContext(actor);
      const after = await state();
      assertReplacementTransition(receipt, fixture, info, before, after, expectedSnapshot,
        await analysisDigest(receipt.analysisId));
      await promptRefusal(changer, contender.sql(fixture), contender.after, contender.user);
      assertWholeStatePreserved(after, await state(), fixture);
    }

    // An actually successful predecessor review requires restored reviewable
    // inputs. A stale packet must never be called a positive review control.
    {
      markPhase("U18_REVIEW_VS_REPLACEMENT");
      const fixture = await replacementFixture("U18_REVIEW_VS_REPLACEMENT");
      const info = await replacementRequest(fixture);
      const drift = " Committed synthetic content drift.";
      const drifted = await state();
      const evidence = byId(drifted, "evidence", fixture.evidence);
      assert(evidence.description.endsWith(drift));
      const description = evidence.description.slice(0, -drift.length);
      await monitor.query(`update public.evidence_items set description=${literal(description)}
        where id='${fixture.evidence}' returning id`);
      const before = await state();
      assertWholeStatePreserved(drifted, before, fixture,
        replacementWriter("evidence", (x) => x.evidence, () => ({ description })));
      assert.equal(await analysisDigest(fixture.packet.analysisId), fixture.packet.analysisDigest);
      await barrier.query("begin; lock table public.approvals in share mode");
      const reviewing = actor.query(reviewSQLFor(fixture.packet));
      reviewing.catch(() => {});
      await blocked(actorPid, barrierPid);
      await promptRefusal(changer, replaceSQL(fixture, info), "risk not found in this organization");
      assertWholeStatePreserved(before, await state(), fixture);
      await barrier.query("commit");
      const receipt = json(await reviewing);
      await assertActorContext(actor, f.reviewer);
      const after = await state();
      assertReviewStateTransition(receipt, fixture.packet, fixture, before, after, noWriter);
      await promptRefusal(changer, replaceSQL(fixture, info),
        "replacement requires the current pending packet and its original human author");
      assertWholeStatePreserved(after, await state(), fixture);
    }

    // Ordinary submit reaches the policy wait BEFORE its pending-packet gate.
    // It can win contention, but cannot create a second pending proposal.
    {
      markPhase("U18_SUBMIT_VS_REPLACEMENT");
      const fixture = await replacementFixture("U18_SUBMIT_VS_REPLACEMENT");
      const info = await replacementRequest(fixture);
      const before = await state();
      await barrier.query(`begin; select id from public.risk_criteria_profiles
        where id='${fixture.criteria}' for update`);
      const submitting = actor.query(submitSQLFor(fixture.child, fixture.evidence));
      submitting.catch(() => {});
      await blocked(actorPid, barrierPid);
      await promptRefusal(changer, replaceSQL(fixture, info), "risk not found in this organization");
      assertWholeStatePreserved(before, await state(), fixture);
      await barrier.query("commit");
      assert.deepEqual(json(await submitting), {
        error: "this risk already has an uncertainty analysis awaiting independent review",
      });
      await assertActorContext(actor);
      assertWholeStatePreserved(before, await state(), fixture);
    }

    // BEFORE-policy: a committed raw policy-field correction invalidates frozen
    // CAS even with identical thresholds; draft policy refuses before CAS.
    for (const field of ["basis", "status"]) {
      markPhase("U18_REPLACEMENT_POLICY_BEFORE");
      const fixture = await replacementFixture(`U18_REPLACEMENT_POLICY_BEFORE_${field}`);
      const info = await replacementRequest(fixture);
      const before = await state();
      const value = field === "basis" ? `${byId(before, "criteria", fixture.criteria).basis} Corrected.` : "draft";
      const writer = replacementWriter("criteria", (x) => x.criteria, () => ({ [field]: value }));
      await barrier.query(`begin; update public.risk_criteria_profiles set ${field}=${literal(value)}
        where id='${fixture.criteria}' returning id`);
      const replacing = actor.query(replaceSQL(fixture, info));
      replacing.catch(() => {});
      await blocked(actorPid, barrierPid);
      assertWholeStatePreserved(before, await state(), fixture);
      await barrier.query("commit");
      assert.deepEqual(json(await replacing), { error: field === "basis"
        ? "replacement inputs or policy changed; reload the governed workspace"
        : "criteria profile must be adopted with decision thresholds before uncertainty analysis" });
      await assertActorContext(actor);
      assertWholeStatePreserved(before, await state(), fixture, writer);
    }
    {
      markPhase("U18_REPLACEMENT_POLICY_AFTER");
      const fixture = await replacementFixture("U18_REPLACEMENT_POLICY_AFTER");
      const info = await replacementRequest(fixture);
      const before = await state();
      const expectedSnapshot = await replacementSnapshot(fixture);
      const basis = `${byId(before, "criteria", fixture.criteria).basis} After replacement.`;
      const writer = replacementWriter("criteria", (x) => x.criteria, () => ({ basis }));
      await barrier.query("begin; lock table public.audit_events in share mode");
      const replacing = actor.query(replaceSQL(fixture, info));
      replacing.catch(() => {});
      await blocked(actorPid, barrierPid);
      const changing = changer.query(`${serviceSQL}; begin;
        update public.risk_criteria_profiles set basis=${literal(basis)}
        where id='${fixture.criteria}' returning id; select 'policy corrected'`);
      changing.catch(() => {});
      await blocked(changerPid, actorPid);
      assertWholeStatePreserved(before, await state(), fixture);
      await barrier.query("commit");
      const receipt = json(await replacing);
      await assertActorContext(actor);
      assert.equal((await changing).at(-1), "policy corrected");
      await changer.query("commit");
      const after = await state();
      assert.notEqual(await analysisDigest(receipt.analysisId), receipt.analysisDigest);
      assertReplacementTransition(receipt, fixture, info, before, after, expectedSnapshot,
        await analysisDigest(receipt.analysisId), writer);
    }

    // Service-side role/org correction, never a self-service membership bypass.
    // Each BEFORE and AFTER phase executes BOTH named membership dimensions.
    for (const field of ["role", "organization_id"]) {
      markPhase("U18_REPLACEMENT_PROFILE_BEFORE");
      const fixture = await replacementFixture(`U18_REPLACEMENT_PROFILE_BEFORE_${field}`);
      const info = await replacementRequest(fixture);
      const before = await state();
      const old = byId(before, "profiles", f.author);
      const value = field === "role" ? "technician" : f.foreign_org;
      const writer = profileWriter(field, value);
      await barrier.query(`begin; select id from public.risk_criteria_profiles
        where id='${fixture.criteria}' for update`);
      const replacing = actor.query(replaceSQL(fixture, info));
      replacing.catch(() => {});
      await blocked(actorPid, barrierPid);
      await changer.query(`${serviceSQL}; begin; update public.user_profiles
        set ${field}=${literal(value)} where id='${f.author}' returning id; commit`);
      const changed = await state();
      assertWholeStatePreserved(before, changed, fixture, writer);
      await barrier.query("commit");
      assert.deepEqual(json(await replacing), {
        error: "current named human engineering or management membership required",
      });
      await assertActorContext(actor, f.author, field === "organization_id" ? f.foreign_org : f.org);
      assertWholeStatePreserved(changed, await state(), fixture);
      await monitor.query(`update public.user_profiles set ${field}=${literal(old[field])}
        where id='${f.author}' returning id`);
      assertWholeStatePreserved(changed, await state(), fixture, profileWriter(field, old[field]));
    }
    for (const field of ["role", "organization_id"]) {
      markPhase("U18_REPLACEMENT_PROFILE_AFTER");
      const fixture = await replacementFixture(`U18_REPLACEMENT_PROFILE_AFTER_${field}`);
      const info = await replacementRequest(fixture);
      const before = await state();
      const old = byId(before, "profiles", f.author);
      const expectedSnapshot = await replacementSnapshot(fixture);
      const value = field === "role" ? "technician" : f.foreign_org;
      const writer = profileWriter(field, value);
      await barrier.query("begin; lock table public.audit_events in share mode");
      const replacing = actor.query(replaceSQL(fixture, info));
      replacing.catch(() => {});
      await blocked(actorPid, barrierPid);
      const changing = changer.query(`${serviceSQL}; begin; update public.user_profiles
        set ${field}=${literal(value)} where id='${f.author}' returning id; select 'membership corrected'`);
      changing.catch(() => {});
      await blocked(changerPid, actorPid);
      assertWholeStatePreserved(before, await state(), fixture);
      await barrier.query("commit");
      const receipt = json(await replacing);
      // Membership remains old until the separately blocked writer commits.
      await assertActorContext(actor);
      assert.equal((await changing).at(-1), "membership corrected");
      await changer.query("commit");
      const after = await state();
      assert.equal(await analysisDigest(receipt.analysisId), receipt.analysisDigest);
      assertReplacementTransition(receipt, fixture, info, before, after, expectedSnapshot,
        await analysisDigest(receipt.analysisId), writer);
      await monitor.query(`update public.user_profiles set ${field}=${literal(old[field])}
        where id='${f.author}' returning id`);
      assertWholeStatePreserved(after, await state(), fixture, profileWriter(field, old[field]));
    }

    async function replacementAuthorityFixture(label) {
      const fixture = await replacementFixture(label);
      fixture.authorRole = "reliability_engineer";
      // Only random fixture rows: remove BOTH owner and role shortcuts.
      await monitor.query(`begin; update public.user_profiles set role='reliability_engineer'
        where id='${f.author}';
        update public.risks set risk_owner_id='${f.reviewer}',decision_owner_id=null,
          information_sensitivity='restricted'
        where id in ('${fixture.parent}','${fixture.grandparent}');
        update public.risk_stakeholder_views set stakeholder_user_id='${f.author}'
        where id in ('${fixture.parentView}','${fixture.grandView}'); commit`);
      const ready = await state();
      assert.equal(byId(ready, "profiles", f.author).role, "reliability_engineer");
      for (const id of [fixture.parent, fixture.grandparent]) {
        const risk = byId(ready, "risks", id);
        assert.equal(risk.information_sensitivity, "restricted");
        assert.equal(risk.risk_owner_id, f.reviewer);
        assert.equal(risk.decision_owner_id, null);
        const grants = ready.stakeholderViews.filter((row) => row.risk_id === id &&
          row.organization_id === f.org && row.stakeholder_user_id === f.author);
        assert.equal(grants.length, 1);
        assert.equal(grants[0].id, id === fixture.parent ? fixture.parentView : fixture.grandView);
      }
      assert.deepEqual(json(await actor.query(`reset role; set role authenticated;
        select set_config('request.jwt.claim.sub','${f.author}',false);
        select jsonb_build_object('readable',public.can_read_risk('${fixture.child}'))`)), { readable: true });
      await assertActorContext(actor);
      assertWholeStatePreserved(ready, await state(), fixture);
      return fixture;
    }
    async function restoreAuthorityAuthorRole(fixture) {
      const before = await state();
      await monitor.query(`update public.user_profiles set role='admin' where id='${f.author}' returning id`);
      assertWholeStatePreserved(before, await state(), fixture, profileWriter("role", "admin"));
    }
    for (const kind of ["view", "scenario"]) {
      markPhase("U18_REPLACEMENT_VISIBILITY_BEFORE");
      const fixture = await replacementAuthorityFixture(`U18_REPLACEMENT_VISIBILITY_BEFORE_${kind}`);
      const info = await replacementRequest(fixture);
      const before = await state();
      const writer = kind === "view" ? deletionWriter("stakeholderViews", (x) => x.parentView)
        : replacementWriter("scenarios", (x) => x.parentScenario,
          (row) => ({ label: `${row.label} Corrected.` }));
      const mutation = kind === "view"
        ? `delete from public.risk_stakeholder_views where id='${fixture.parentView}' returning id`
        : `update public.scenarios set label=label||' Corrected.' where id='${fixture.parentScenario}' returning id`;
      await barrier.query(`${serviceSQL}; begin; ${mutation}`);
      await promptRefusal(actor, `begin; ${replaceSQL(fixture, info)}`, "risk not found in this organization");
      assert.deepEqual(json(await actor.query(`reset role; ${stateSQL}`)), before);
      assertWholeStatePreserved(before, await state(), fixture);
      // Earlier ancestry locks must be released even while the actor's outer
      // refusal transaction stays open and the view/scenario writer is pending.
      assert.equal((await changer.query(`${serviceSQL}; begin;
        select id from public.risks where id='${fixture.grandparent}' for update nowait;
        commit; select 'authority partial locks released'`)).at(-1), "authority partial locks released");
      await actor.query("rollback");
      await barrier.query("commit");
      const changed = await state();
      assertWholeStatePreserved(before, changed, fixture, writer);
      if (kind === "view") {
        await promptRefusal(actor, replaceSQL(fixture, info), "risk not found in this organization");
        await promptRefusal(actor, `select public.get_risk_uncertainty_workspace('${fixture.child}')`,
          "risk not found in this organization");
        assertWholeStatePreserved(changed, await state(), fixture);
      }
      await restoreAuthorityAuthorRole(fixture);
    }
    for (const kind of ["view", "scenario"]) {
      markPhase("U18_REPLACEMENT_VISIBILITY_AFTER");
      const fixture = await replacementAuthorityFixture(`U18_REPLACEMENT_VISIBILITY_AFTER_${kind}`);
      const info = await replacementRequest(fixture);
      const before = await state();
      const expectedSnapshot = await replacementSnapshot(fixture);
      const writer = { expectStale: false, ...(kind === "view"
        ? deletionWriter("stakeholderViews", (x) => x.parentView)
        : replacementWriter("scenarios", (x) => x.parentScenario,
          (row) => ({ label: `${row.label} Corrected.` }))) };
      const mutation = kind === "view"
        ? `delete from public.risk_stakeholder_views where id='${fixture.parentView}' returning id`
        : `update public.scenarios set label=label||' Corrected.' where id='${fixture.parentScenario}' returning id`;
      await barrier.query("begin; lock table public.audit_events in share mode");
      const replacing = actor.query(replaceSQL(fixture, info));
      replacing.catch(() => {});
      await blocked(actorPid, barrierPid);
      const changing = changer.query(`${serviceSQL}; begin; ${mutation}; select 'visibility corrected'`);
      changing.catch(() => {});
      await blocked(changerPid, actorPid);
      assertWholeStatePreserved(before, await state(), fixture);
      await barrier.query("commit");
      const receipt = json(await replacing);
      // The revocation is still uncommitted; the author is still readable here.
      await assertActorContext(actor);
      assert.equal((await changing).at(-1), "visibility corrected");
      await changer.query("commit");
      const after = await state();
      assert.equal(await analysisDigest(receipt.analysisId), receipt.analysisDigest);
      assertReplacementTransition(receipt, fixture, info, before, after, expectedSnapshot,
        await analysisDigest(receipt.analysisId), writer);
      if (kind === "view") {
        await promptRefusal(actor, `select public.get_risk_uncertainty_workspace('${fixture.child}')`,
          "risk not found in this organization");
        await promptRefusal(actor, `select public.get_risk_uncertainty_replacement_receipt(
          '${fixture.child}','${info.request.intentId}','${info.fingerprint}')`,
          "risk not found in this organization");
        assertWholeStatePreserved(after, await state(), fixture);
      }
      await restoreAuthorityAuthorRole(fixture);
    }
    // A prepared request freezes predecessor live-digest CAS, not previously
    // displayed contents of newly selected IDs. A committed OLD-only change
    // refuses; a committed NEW-only change is captured exactly, still pending
    // independent review and without approval/derived-evidence/work artifacts.
    for (const kind of ["old", "new"]) {
      markPhase(kind === "old" ? "U18_REPLACEMENT_OLD_EVIDENCE_BEFORE"
        : "U18_REPLACEMENT_NEW_EVIDENCE_BEFORE");
      const fixture = await replacementFixture(`U18_REPLACEMENT_${kind.toUpperCase()}_EVIDENCE_BEFORE`);
      const info = await replacementRequest(fixture);
      const before = await state();
      const id = kind === "old" ? fixture.evidence : fixture.newEvidence[0];
      const description = `${byId(before, "evidence", id).description} Corrected before replacement.`;
      const writer = replacementWriter("evidence", () => id, () => ({ description }));
      await changer.query(`${serviceSQL}; begin; update public.evidence_items
        set description=${literal(description)} where id='${id}' returning id; commit`);
      const changed = await state();
      assertWholeStatePreserved(before, changed, fixture, writer);
      if (kind === "old") {
        assert.notEqual(await analysisDigest(fixture.packet.analysisId), info.request.predecessor.currentDigest);
        await promptRefusal(actor, replaceSQL(fixture, info),
          "replacement inputs or policy changed; reload the governed workspace");
        assertWholeStatePreserved(changed, await state(), fixture);
      } else {
        assert.equal(await analysisDigest(fixture.packet.analysisId), info.request.predecessor.currentDigest);
        const expectedSnapshot = await replacementSnapshot(fixture);
        assert.equal(expectedSnapshot.evidence.find((row) => row.id === id).description, description);
        const receipt = json(await actor.query(replaceSQL(fixture, info)));
        await assertActorContext(actor);
        assertReplacementTransition(receipt, fixture, info, changed, await state(), expectedSnapshot,
          await analysisDigest(receipt.analysisId));
      }
    }
    // Instrumented statement-snapshot specification, NOT top-level HTTP
    // mid-read proof. This session-local STABLE gate has no writes and calls
    // the real public RPC. Its work_orders relation is planned INSIDE the
    // function, after the outer SELECT has acquired its statement snapshot.
    // A top-level CTE could instead wait during planning, before that snapshot.
    {
      markPhase("U18_REPLACEMENT_WORKSPACE_SNAPSHOT");
      const fixture = await replacementFixture("U18_REPLACEMENT_WORKSPACE_SNAPSHOT");
      const info = await replacementRequest(fixture);
      const before = await state();
      const expectedSnapshot = await replacementSnapshot(fixture);
      const priorWorkspace = json(await changer.query(`reset role; set role authenticated;
        select set_config('request.jwt.claim.sub','${f.author}',false);
        select public.get_risk_uncertainty_workspace('${fixture.child}')`));
      await assertActorContext(changer);
      assert.equal(priorWorkspace.analyses.length, 1);
      assert.equal(priorWorkspace.analyses[0].id, fixture.packet.analysisId);
      assert.equal(priorWorkspace.analyses[0].storedStatus, "pending_review");
      assert.equal(priorWorkspace.analyses[0].validationStatus, "stale");
      assert.equal(priorWorkspace.analyses[0].reviewStanding, "replacement_required");
      assert.equal(priorWorkspace.analyses[0].currentDigest, info.request.predecessor.currentDigest);
      assert.equal(priorWorkspace.criteria.policyDigest, info.request.policyDigest);
      assertWholeStatePreserved(before, await state(), fixture);
      await changer.query(`${serviceSQL};
        create function pg_temp.u18_workspace_snapshot_gate(p_risk_id uuid)
        returns jsonb language plpgsql stable set search_path=public as $$
        begin
          perform count(*) from public.work_orders
            where organization_id=public.app_current_org();
          return public.get_risk_uncertainty_workspace(p_risk_id);
        end $$;
        select jsonb_build_object(
          'rpcStable',(select provolatile='s' from pg_proc where oid=
            to_regprocedure('public.get_risk_uncertainty_workspace(uuid)')),
          'gateStable',(select provolatile='s' from pg_proc where oid=
            to_regprocedure('pg_temp.u18_workspace_snapshot_gate(uuid)')))`);
      const volatility = json(await changer.query(`select jsonb_build_object(
        'rpcStable',(select provolatile='s' from pg_proc where oid=
          to_regprocedure('public.get_risk_uncertainty_workspace(uuid)')),
        'gateStable',(select provolatile='s' from pg_proc where oid=
          to_regprocedure('pg_temp.u18_workspace_snapshot_gate(uuid)')))`));
      assert.deepEqual(volatility, { rpcStable: true, gateStable: true });
      assertWholeStatePreserved(before, await state(), fixture);
      await barrier.query("begin; lock table public.work_orders in access exclusive mode");
      const reading = changer.query(`reset role; set role authenticated;
        select set_config('request.jwt.claim.sub','${f.author}',false);
        select pg_temp.u18_workspace_snapshot_gate('${fixture.child}')`);
      reading.catch(() => {});
      await blocked(changerPid, barrierPid);
      const receipt = json(await actor.query(replaceSQL(fixture, info)));
      await assertActorContext(actor);
      // Replacement has actually committed while the earlier read is still
      // blocked on the observed gate. No timeout or fabricated response proves it.
      await blocked(changerPid, barrierPid);
      await barrier.query("commit");
      assert.deepEqual(json(await reading), priorWorkspace);
      await assertActorContext(changer);
      const after = await state();
      assertReplacementTransition(receipt, fixture, info, before, after, expectedSnapshot,
        await analysisDigest(receipt.analysisId));
      assert.equal(await analysisDigest(fixture.packet.analysisId), info.request.predecessor.currentDigest);
      const freshWorkspace = json(await changer.query(
        `select public.get_risk_uncertainty_workspace('${fixture.child}')`));
      await assertActorContext(changer);
      const successor = byId(after, "packets", receipt.analysisId);
      const predecessor = copy(priorWorkspace.analyses[0]);
      predecessor.storedStatus = "superseded";
      predecessor.supersession = {
        successorAnalysisId: receipt.analysisId, at: successor.created_at, byUserId: f.author,
      };
      // Exact new projection independently follows already-verified canonical
      // persisted fields and receipt, not a copy of the observed workspace.
      const projectedSuccessor = {
        id: receipt.analysisId, organizationId: f.org, riskId: fixture.child,
        version: 2, storedStatus: "pending_review", validationStatus: "pending_review",
        reviewStanding: "reviewable", method: f.input.method, basis: f.input.basis,
        probability: { lower: f.input.probability_lower, central: f.input.probability_central,
          upper: f.input.probability_upper },
        confidence: { level: f.input.confidence_level, lower: f.input.confidence_interval_lower,
          upper: f.input.confidence_interval_upper },
        lossCases: { best: f.input.best_case_loss, expected: f.input.expected_case_loss,
          worst: f.input.worst_case_loss, currency: f.input.currency },
        sensitivityInputs: f.input.sensitivity, sensitivityResults: successor.sensitivity_results,
        thresholdProfileId: fixture.criteria, decisionThresholds: { escalateAbove: 16, stopAbove: 24 },
        reassessmentTriggers: f.input.reassessment_triggers, reviewDueAt: successor.review_due_at,
        valueOfInformation: { action: f.input.voi_action, informationCost: 10000,
          decisionCostIfWrong: 250000, uncertaintyReduction: 0.5, probabilityDecisionChanges: 0.3,
          expectedValue: 37500, netValue: 27500, recommendation: "GATHER_INFORMATION" },
        analysisDigest: receipt.analysisDigest, currentDigest: receipt.analysisDigest,
        digestVersion: 2, digestCoverage: "evidence_content_and_current_criteria",
        authorId: f.author, createdAt: successor.created_at, reviewerId: null, reviewedAt: null,
        reviewNote: null, approvalId: null, derivedEvidenceItemId: null,
        replacement: { predecessorAnalysisId: fixture.packet.analysisId,
          intentId: info.request.intentId, requestFingerprint: info.fingerprint,
          compareAndSwap: receipt.compareAndSwap, reason: info.request.reason },
        supersession: null, evidenceItemIds: fixture.newEvidence, operationalAuthorization: false,
      };
      assert.deepEqual(freshWorkspace, {
        ...priorWorkspace, analyses: [projectedSuccessor, predecessor],
      });
      assert.equal(freshWorkspace.criteria.policyDigest, info.request.policyDigest);
      assertWholeStatePreserved(after, await state(), fixture);
      await changer.query(`${serviceSQL}; drop function pg_temp.u18_workspace_snapshot_gate(uuid)`);
      assertWholeStatePreserved(after, await state(), fixture);
    }
    // U18_REPLACEMENT_AUTHORITY_RACES END
    // U18_REPLACEMENT_CONCURRENCY END

    // U18_OPEN_ANCESTOR_DELETE: this is deliberately OPEN, not counted as a
    // helper-wins success. A legitimate delete cannot commit because canonical
    // provenance rejects its ON DELETE SET NULL child rewrite with the exact
    // "Secondary risk parent provenance cannot be severed or replaced" guard.
    markPhase("U18_OPEN_ANCESTOR_DELETE");
    assert.equal(
      (
        await monitor.query(`select position(
          'Secondary risk parent provenance cannot be severed or replaced' in
          pg_get_functiondef('public.enforce_secondary_risk_origin()'::regprocedure))>0`)
      ).at(-1),
      "t",
    );
    markPhase("U18_COMPLETE");
    console.log(
      "U18 concurrent criteria, typed visibility and replacement PASS: actual approval/evidence/audit barriers, exact bound ACKs, NOWAIT refusals, partial-lock release, inverse-view/scenario/profile/overlap, competing replacement and evidence FK-restoration witnesses with full two-org state preservation; ancestor deletion remains OPEN because canonical provenance forbids legitimate commit. NATIVE exact-head PostgreSQL only; NEW synthetic fixtures retained only in disposable CI until Stop Supabase. Not production qualification.",
    );
  } finally {
    await Promise.all(sessions.map((handle) => handle.close()));
  }
}

await qualify().catch(() => {
  throw new Error(
    `U18 concurrent PostgreSQL qualification failed: ${currentPhase}`,
  );
});
