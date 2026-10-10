import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

// Real GoTrue/PostgREST qualification on disposable CI only. No retries,
// production URL, existing-user UPSERT, or fabricated source-standing link.
async function run() {
  assert.equal(process.env.GITHUB_ACTIONS, "true", "CI-only uncertainty smoke");
  assert.equal(
    Object.keys(process.env).some((name) => name.startsWith("PG")),
    false,
    "ambient PostgreSQL connection environment is prohibited",
  );
  assert.equal(
    Object.keys(process.env).some(
      (name) => name.startsWith("DOCKER") || name.startsWith("CONTAINER_"),
    ),
    false,
    "ambient container transport configuration is prohibited",
  );
  const status = spawnSync("supabase", ["status", "-o", "env"], {
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    // Hosted Linux CI only: never discover credentials via an inherited remote
    // Docker context, proxy, certificate configuration or child-process hook.
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LC_ALL: "C",
      LANG: "C",
      DOCKER_HOST: "unix:///var/run/docker.sock",
    },
  });
  assert.equal(status.status, 0, "local status failed");
  assert.equal(typeof status.stdout, "string");
  const config = {};
  for (const line of status.stdout.split(/\r?\n/)) {
    if (!/^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=/.test(line)) continue;
    const match = line.match(
      /^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)="([^"\n]*)"$/,
    );
    assert.ok(match, "malformed local configuration");
    assert.equal(
      Object.hasOwn(config, match[1]),
      false,
      "duplicate local configuration",
    );
    config[match[1]] = match[2];
  }
  assert.equal(
    config.API_URL,
    "http://127.0.0.1:54321",
    "CI loopback API required",
  );
  for (const key of ["ANON_KEY", "SERVICE_ROLE_KEY"])
    assert.match(
      config[key] ?? "",
      /^[A-Za-z0-9._-]+$/,
      "missing/invalid local fixture key",
    );

  function sql(statement) {
    const result = spawnSync(
      "psql",
      [
        "-h",
        "127.0.0.1",
        "-p",
        "54322",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        statement,
      ],
      {
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        env: {
          PATH: process.env.PATH,
          LC_ALL: "C",
          LANG: "C",
          PGPASSWORD: "postgres",
          PGHOSTADDR: "127.0.0.1",
          PGOPTIONS: "-c search_path=public",
          PGSSLMODE: "disable",
        },
      },
    );
    assert.equal(result.status, 0, "isolated SQL failed");
    assert.equal(typeof result.stdout, "string");
    return result.stdout.trim();
  }
  const fixtureFile = readFileSync(
    "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql",
    "utf8",
  );
  const start = fixtureFile.split("-- U18 FIXTURE SEED BEGIN\n");
  assert.equal(start.length, 2, "unique seed start required");
  const end = start[1].split("-- U18 FIXTURE SEED END");
  assert.equal(end.length, 2, "unique seed end required");
  assert.equal(
    /\b(?:begin|commit|rollback);/i.test(end[0]),
    false,
    "seed cannot escape transaction",
  );
  // HTTP requires committed fixtures visible to another connection. Only this
  // new synthetic tenant is persisted, until the workflow's Stop Supabase.
  // The separate full native transcript above remains BEGIN -> ROLLBACK.
  const f = JSON.parse(
    sql(
      `begin;\n${end[0]}\nselect row_to_json(u18_fixture) from u18_fixture;\ncommit;`,
    ),
  );
  const uuid = (value) =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value,
    );
  const names = [
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
  ];
  assert.ok(f && typeof f === "object" && !Array.isArray(f));
  assert.ok(
    names.every((key) => uuid(f[key])),
    "fixture identity is not canonical",
  );
  assert.equal(
    new Set(names.map((key) => f[key])).size,
    names.length,
    "fixture identities must be distinct",
  );
  assert.ok(f.input && typeof f.input === "object" && !Array.isArray(f.input));

  async function request(path, key, token, args) {
    const response = await fetch(`${config.API_URL}${path}`, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
      headers: {
        apikey: key,
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(args),
    });
    return { status: response.status, body: await response.json() };
  }
  async function login(id) {
    const response = await request(
      "/auth/v1/token?grant_type=password",
      config.ANON_KEY,
      null,
      { email: `${id}@syncai-ci.invalid`, password: "U18Synthetic123!@#" },
    );
    assert.equal(response.status, 200, "real synthetic GoTrue login failed");
    assert.equal(typeof response.body?.access_token, "string");
    assert.ok(response.body.access_token.length > 0);
    return response.body.access_token;
  }
  const author = await login(f.author);
  const reviewer = await login(f.reviewer);
  const foreign = await login(f.foreign_user);
  const rpc = (name, token, args) =>
    request(`/rest/v1/rpc/${name}`, config.ANON_KEY, token, args);
  const submit = (input, evidence) =>
    rpc("submit_risk_uncertainty_analysis", author, {
      p_risk_id: f.risk,
      p_analysis: input,
      p_evidence_item_ids: [evidence],
    });
  const read = (token) =>
    rpc("get_risk_uncertainty_workspace", token, { p_risk_id: f.risk });
  const good = (response) => {
    assert.equal(response.status, 200);
    assert.ok(
      response.body &&
        typeof response.body === "object" &&
        !Array.isArray(response.body),
    );
    assert.equal(Object.hasOwn(response.body, "error"), false);
    return response.body;
  };
  const refused = (response, message) => {
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { error: message });
  };
  const state = () =>
    JSON.parse(
      sql(`select jsonb_build_object(
    'risk',(select to_jsonb(r) from risks r where id='${f.risk}' and organization_id='${f.org}'),
    'packets',(select jsonb_agg(to_jsonb(a) order by a.id) from risk_uncertainty_analyses a where organization_id='${f.org}'),
    'bindings',(select jsonb_agg(to_jsonb(b) order by b.analysis_id,b.evidence_item_id) from risk_uncertainty_analysis_evidence b where organization_id='${f.org}'),
    'approvals',(select jsonb_agg(to_jsonb(a) order by a.id) from approvals a where organization_id='${f.org}'),
    'audit',(select jsonb_agg(to_jsonb(a) order by a.id) from audit_events a where organization_id='${f.org}'),
    'evidence',(select jsonb_agg(to_jsonb(e) order by e.id) from evidence_items e where organization_id='${f.org}'),
    'decisions',(select count(*) from decisions where organization_id='${f.org}'),
    'work',(select count(*) from work_orders where organization_id='${f.org}'))`),
    );
  let before = state();
  // Whole-row, two-tenant ledger witness. No count-only replacement proof.
  const replacementState = () =>
    JSON.parse(
      sql(`select jsonb_build_object(
      'risks',(select jsonb_agg(to_jsonb(r) order by r.id) from risks r where organization_id in('${f.org}','${f.foreign_org}')),
      'packets',(select jsonb_agg(to_jsonb(a) order by a.id) from risk_uncertainty_analyses a where organization_id in('${f.org}','${f.foreign_org}')),
      'bindings',(select jsonb_agg(to_jsonb(b) order by b.analysis_id,b.evidence_item_id) from risk_uncertainty_analysis_evidence b where organization_id in('${f.org}','${f.foreign_org}')),
      'approvals',(select jsonb_agg(to_jsonb(a) order by a.id) from approvals a where organization_id in('${f.org}','${f.foreign_org}')),
      'audit',(select jsonb_agg(to_jsonb(a) order by a.id) from audit_events a where organization_id in('${f.org}','${f.foreign_org}')),
      'evidence',(select jsonb_agg(to_jsonb(e) order by e.id) from evidence_items e where organization_id in('${f.org}','${f.foreign_org}')),
      'criteria',(select jsonb_agg(to_jsonb(c) order by c.id) from risk_criteria_profiles c where organization_id in('${f.org}','${f.foreign_org}')),
      'securityEvents',(select jsonb_agg(to_jsonb(s) order by s.id) from security_events s where organization_id in('${f.org}','${f.foreign_org}')),
      'decisions',(select jsonb_agg(to_jsonb(d) order by d.id) from decisions d where organization_id in('${f.org}','${f.foreign_org}')),
      'work',(select jsonb_agg(to_jsonb(w) order by w.id) from work_orders w where organization_id in('${f.org}','${f.foreign_org}')),
      'stakeholderViews',(select jsonb_agg(to_jsonb(s) order by s.id) from risk_stakeholder_views s where organization_id in('${f.org}','${f.foreign_org}')),
      'scenarios',(select jsonb_agg(to_jsonb(s) order by s.id) from scenarios s where organization_id in('${f.org}','${f.foreign_org}')),
      'profiles',(select jsonb_agg(to_jsonb(p) order by p.id) from user_profiles p where organization_id in('${f.org}','${f.foreign_org}')))`),
    );
  // U18 CANONICAL VOI FINITE HTTP BEGIN
  // Keep quoted specials intact; JS NaN/Infinity would stringify to null.
  let canonicalFiniteRefusals = 0;
  for (const field of [
    "information_cost",
    "decision_cost_if_wrong",
    "uncertainty_reduction",
    "probability_decision_changes",
  ]) {
    for (const special of ["NaN", "+Infinity", "-Infinity"]) {
      const response = await rpc("record_risk_value_of_information", author, {
        p_risk_id: f.risk,
        p_analysis: {
          information_action: "Synthetic public finite-input refusal witness",
          information_cost: 10,
          decision_cost_if_wrong: 250000,
          uncertainty_reduction: 0.5,
          probability_decision_changes: 0.3,
          currency: "CAD",
          [field]: special,
        },
      });
      assert.equal(response.status, 200);
      assert.ok(response.body && typeof response.body === "object");
      assert.equal(Array.isArray(response.body), false);
      assert.deepEqual(Object.keys(response.body), ["error"]);
      assert.equal(typeof response.body.error, "string");
      assert.ok(response.body.error.trim());
      const expectedError =
        ["information_cost", "decision_cost_if_wrong"].includes(field) &&
        ["NaN", "+Infinity"].includes(special)
          ? "value-of-information inputs must be finite numbers"
          : "costs must be non-negative and probability inputs must be between 0 and 1";
      refused(response, expectedError);
      assert.deepEqual(
        state(),
        before,
        "canonical finite refusal created artifacts",
      );
      canonicalFiniteRefusals += 1;
    }
  }
  assert.equal(canonicalFiniteRefusals, 12);
  // U18 CANONICAL VOI FINITE HTTP END
  refused(
    await submit(
      {
        ...f.input,
        probability_lower: 0.7,
        probability_central: 0.3,
        probability_upper: 0.5,
      },
      f.verified,
    ),
    "probability range must satisfy 0 <= lower <= central <= upper <= 1",
  );
  assert.deepEqual(state(), before, "ordering refusal created artifacts");
  for (const evidence of [f.unverified, f.wrong_risk]) {
    refused(
      await submit(f.input, evidence),
      "all cited inputs must be verified evidence linked to this exact risk",
    );
    assert.deepEqual(state(), before, "evidence refusal created artifacts");
  }
  const submitted = good(await submit(f.input, f.verified));
  assert.equal(submitted.riskId, f.risk);
  assert.ok(uuid(submitted.analysisId));
  assert.match(submitted.analysisDigest ?? "", /^[0-9a-f]{64}$/);
  assert.equal(submitted.version, 1);
  assert.equal(submitted.validationStatus, "pending_review");
  assert.equal(submitted.operationalAuthorization, false);
  assert.deepEqual(submitted.valueOfInformation, {
    informationCost: 10000,
    decisionCostIfWrong: 250000,
    uncertaintyReduction: 0.5,
    probabilityDecisionChanges: 0.3,
    expectedValue: 37500,
    netValue: 27500,
    recommendation: "GATHER_INFORMATION",
  });
  before = state();
  refused(
    await rpc("review_risk_uncertainty_analysis", author, {
      p_analysis_id: submitted.analysisId,
      p_decision: "validated",
      p_review_note:
        "The author cannot independently review their own synthetic packet.",
    }),
    "analysis author cannot independently review the same packet",
  );
  assert.deepEqual(state(), before, "self-review refusal created artifacts");
  const service = await request(
    "/rest/v1/rpc/get_risk_uncertainty_workspace",
    config.SERVICE_ROLE_KEY,
    config.SERVICE_ROLE_KEY,
    { p_risk_id: f.risk },
  );
  assert.ok(
    [403, 404].includes(service.status),
    "service role must be privilege/cache refused",
  );
  assert.ok(
    ["42501", "PGRST202"].includes(service.body?.code),
    "exact service refusal required",
  );
  // Native transcript proves existence/ACL and both trigger guards. It runs
  // first; do not perform whole-table TRUNCATE in the committed HTTP fixture.
  const review = good(
    await rpc("review_risk_uncertainty_analysis", reviewer, {
      p_analysis_id: submitted.analysisId,
      p_decision: "validated",
      p_review_note:
        "Independent review confirms frozen inputs, evidence, thresholds, derivations and limitations.",
    }),
  );
  assert.equal(review.riskId, f.risk);
  assert.equal(review.analysisId, submitted.analysisId);
  assert.equal(review.analysisDigest, submitted.analysisDigest);
  assert.equal(review.decision, "validated");
  assert.ok(uuid(review.approvalId) && uuid(review.derivedEvidenceItemId));
  assert.equal(review.operationalAuthorization, false);
  const workspace = good(await read(author));
  assert.equal(workspace.organizationId, f.org);
  assert.equal(workspace.actorId, f.author);
  assert.equal(workspace.risk.id, f.risk);
  assert.equal(workspace.risk.organizationId, f.org);
  assert.equal(workspace.criteria.id, f.criteria);
  assert.equal(workspace.criteria.organizationId, f.org);
  assert.equal(workspace.criteria.status, "adopted");
  assert.match(workspace.criteria.policyDigest, /^[0-9a-f]{64}$/);
  assert.ok(Array.isArray(workspace.evidence));
  assert.ok(workspace.evidence.some((evidence) => evidence.id === f.verified));
  for (const evidence of workspace.evidence) {
    assert.equal(evidence.organizationId, f.org);
    assert.equal(evidence.riskId, f.risk);
  }
  const item = workspace.analyses.find(
    (packet) => packet.id === submitted.analysisId,
  );
  assert.ok(item);
  assert.equal(item.validationStatus, "validated");
  assert.equal(item.storedStatus, "validated");
  assert.equal(item.reviewStanding, "reviewable");
  assert.equal(item.digestVersion, 2);
  assert.equal(item.digestCoverage, "evidence_content_and_current_criteria");
  assert.equal(item.organizationId, f.org);
  assert.equal(item.riskId, f.risk);
  assert.deepEqual(item.decisionThresholds, {
    escalateAbove: 16,
    stopAbove: 24,
  });
  assert.deepEqual(item.probability, {
    lower: 0.15,
    central: 0.3,
    upper: 0.55,
  });
  assert.equal(item.sensitivityResults[0].name, "Startup exposure");
  assert.equal(item.sensitivityResults[0].swing, 170000);
  assert.equal(item.valueOfInformation.netValue, 27500);
  assert.equal(item.derivedEvidenceItemId, review.derivedEvidenceItemId);
  assert.equal(item.approvalId, review.approvalId);
  assert.equal(workspace.operationalAuthorization, false);
  assert.ok(
    workspace.boundary.includes("does not verify an unverified source"),
  );
  assert.equal(
    sql(`with changed as (update evidence_items set quality_grade='moderate'
    where id='${f.verified}' and organization_id='${f.org}' and quality_grade='high' returning id)
    select count(*) from changed`),
    "1",
    "stale witness requires one actual synthetic edit",
  );
  const stale = good(await read(author)).analyses.find(
    (packet) => packet.id === submitted.analysisId,
  );
  assert.ok(stale);
  assert.equal(stale.validationStatus, "stale");
  assert.equal(stale.storedStatus, "validated");
  assert.equal(stale.reviewStanding, "replacement_required");
  assert.equal(stale.digestVersion, 2);
  assert.equal(stale.digestCoverage, "evidence_content_and_current_criteria");
  assert.equal(stale.organizationId, f.org);
  assert.equal(stale.riskId, f.risk);
  assert.notEqual(stale.analysisDigest, stale.currentDigest);
  before = state();
  refused(await read(foreign), "risk not found in this organization");
  assert.deepEqual(state(), before, "foreign read changed authority");
  const counts = sql(`select concat_ws('|',
    (select count(*) from approvals where organization_id='${f.org}' and risk_id='${f.risk}' and approval_scope->>'kind'='risk_uncertainty_analysis' and status='approved'),
    (select count(*) from audit_events where organization_id='${f.org}' and entity_type in ('risk_uncertainty_analysis_submitted','risk_uncertainty_analysis_reviewed') and event_data->>'analysis_id'='${submitted.analysisId}'),
    (select count(*) from evidence_items where id='${review.derivedEvidenceItemId}' and evidence_class='CALCULATED' and verification_status='unverified'),
    (select count(*) from decisions where organization_id='${f.org}' and risk_id='${f.risk}'),
    (select count(*) from work_orders where organization_id='${f.org}' and risk_id='${f.risk}'))`);
  assert.equal(counts, "1|2|1|0|0", "canonical ledger/authority count parity");
  assert.equal(
    sql(`select count(*) from risks where id in('${f.risk}','${f.other_risk}')
    and organization_id='${f.org}' and status='draft'`),
    "2",
  );
  // Broader claim-purpose/source approval requires the separate owning lane.
  // U18 READ REPRESENTATION HTTP BEGIN
  // Separate pre-existing synthetic CI risk, not a customer, operational action
  // or rewrite of the reviewed primary packet. Retain it only until CI cleanup.
  const representation = good(
    await rpc("submit_risk_uncertainty_analysis", author, {
      p_risk_id: f.other_risk,
      p_analysis: {
        ...f.input,
        confidence_level: "1e-999",
        review_due_at: "280000-01-01T00:00:00+00:00",
      },
      p_evidence_item_ids: [f.wrong_risk],
    }),
  );
  assert.equal(representation.riskId, f.other_risk);
  assert.ok(uuid(representation.analysisId));
  assert.match(representation.analysisDigest ?? "", /^[0-9a-f]{64}$/);
  assert.equal(representation.version, 1);
  assert.equal(representation.validationStatus, "pending_review");
  assert.equal(representation.operationalAuthorization, false);
  const representationWorkspace = good(
    await rpc("get_risk_uncertainty_workspace", author, {
      p_risk_id: f.other_risk,
    }),
  );
  assert.equal(representationWorkspace.organizationId, f.org);
  assert.equal(representationWorkspace.actorId, f.author);
  assert.equal(representationWorkspace.risk.id, f.other_risk);
  const representationPacket = representationWorkspace.analyses.find(
    (packet) => packet.id === representation.analysisId,
  );
  assert.ok(representationPacket);
  assert.equal(representationPacket.organizationId, f.org);
  assert.equal(representationPacket.riskId, f.other_risk);
  assert.equal(representationPacket.validationStatus, "pending_review");
  assert.equal(representationPacket.storedStatus, "pending_review");
  assert.equal(representationPacket.reviewStanding, "reviewable");
  assert.equal(representationPacket.confidence.level, 0);
  assert.equal(representationPacket.reviewDueAt, "280000-01-01T00:00:00+00:00");
  assert.equal(representationPacket.operationalAuthorization, false);
  assert.equal(
    sql(`select count(*) from risk_uncertainty_analyses where id='${representation.analysisId}'
    and organization_id='${f.org}' and risk_id='${f.other_risk}' and author_id='${f.author}'
    and confidence_level=1e-999::numeric and review_due_at='280000-01-01T00:00:00+00:00'::timestamptz`),
    "1",
  );
  assert.equal(
    sql(`select concat_ws('|',
    (select count(*) from risk_uncertainty_analyses where id='${representation.analysisId}' and organization_id='${f.org}' and risk_id='${f.other_risk}' and status='pending_review'),
    (select count(*) from audit_events where organization_id='${f.org}' and entity_type='risk_uncertainty_analysis_submitted' and event_data->>'analysis_id'='${representation.analysisId}'),
    (select count(*) from approvals where organization_id='${f.org}' and risk_id='${f.other_risk}'),
    (select count(*) from decisions where organization_id='${f.org}' and risk_id='${f.other_risk}'),
    (select count(*) from work_orders where organization_id='${f.org}' and risk_id='${f.other_risk}'))`),
    "1|1|0|0|0",
    "representation-only pending authority ledger",
  );
  // U18 READ REPRESENTATION HTTP END
  // U18 ATOMIC REPLACEMENT HTTP BEGIN
  // The old validated packet stays immutable. A new pending proposal is made
  // stale by an actual governed evidence-content change, never by editing its
  // stored snapshot/digest or pretending a review was granted.
  const pending = good(await submit(f.input, f.verified));
  assert.equal(pending.version, 2);
  assert.equal(
    sql(`with changed as (update evidence_items set quality_grade='high'
    where id='${f.verified}' and organization_id='${f.org}' and quality_grade='moderate' returning id)
    select count(*) from changed`),
    "1",
  );
  const predecessor = good(await read(author)).analyses.find(
    (a) => a.id === pending.analysisId,
  );
  assert.ok(predecessor);
  assert.equal(predecessor.storedStatus, "pending_review");
  assert.equal(predecessor.reviewStanding, "replacement_required");
  assert.notEqual(predecessor.analysisDigest, predecessor.currentDigest);
  const policyDigest = sql(
    `select public.risk_uncertainty_current_policy_digest('${f.org}','${f.risk}')`,
  );
  assert.match(policyDigest, /^[0-9a-f]{64}$/);
  const replacementDueAt = new Date(Date.now() + 10_000).toISOString();
  const intentId = randomUUID();
  const replacementRequest = {
    contractVersion: 1,
    action: "replace",
    intentId,
    organizationId: f.org,
    actorId: f.author,
    riskId: f.risk,
    predecessor: {
      analysisId: predecessor.id,
      version: predecessor.version,
      digestVersion: predecessor.digestVersion,
      analysisDigest: predecessor.analysisDigest,
      currentDigest: predecessor.currentDigest,
    },
    policyDigest,
    reason:
      "Synthetic CI evidence change; explicitly replace this stale proposal",
    analysis: { ...f.input, review_due_at: replacementDueAt },
    evidenceItemIds: [f.verified],
  };
  const requestText = JSON.stringify(replacementRequest);
  const requestFingerprint = createHash("sha256")
    .update(requestText, "utf8")
    .digest("hex");
  const beforeReplacement = replacementState();
  const expectedSnapshot = JSON.parse(
    sql(`select public.risk_uncertainty_input_binding_snapshot(
    '${f.org}','${f.risk}',array['${f.verified}'::uuid])`),
  );
  const expectedCas = { ...replacementRequest.predecessor, policyDigest };
  // Simulate losing the successful response body, not a timeout retry. Headers
  // alone grant no commit authority. Reconciliation uses the durable exact
  // actor/org/risk/intent/fingerprint tuple via a separate HTTP transaction.
  const droppedResponse = await fetch(
    `${config.API_URL}/rest/v1/rpc/replace_risk_uncertainty_analysis`,
    {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
      headers: {
        apikey: config.ANON_KEY,
        authorization: `Bearer ${author}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_risk_id: f.risk, p_request_text: requestText }),
    },
  );
  assert.equal(droppedResponse.status, 200);
  assert.ok(droppedResponse.body);
  await droppedResponse.body.cancel();
  const committedState = replacementState();
  const successor = committedState.packets.filter(
    (a) => a.replacement_intent_id === intentId,
  );
  assert.equal(
    successor.length,
    1,
    "exactly one durable intent after the lost body",
  );
  const replacement = successor[0];
  assert.equal(replacement.organization_id, f.org);
  assert.equal(replacement.risk_id, f.risk);
  assert.equal(replacement.author_id, f.author);
  assert.equal(replacement.status, "pending_review");
  assert.equal(replacement.version, 3);
  assert.equal(replacement.digest_version, 2);
  assert.equal(replacement.replacement_request_fingerprint, requestFingerprint);
  assert.equal(replacement.replaces_analysis_id, predecessor.id);
  assert.equal(replacement.reviewer_id, null);
  assert.equal(replacement.approval_id, null);
  assert.equal(replacement.derived_evidence_item_id, null);
  const oldPacket = beforeReplacement.packets.find(
    (a) => a.id === predecessor.id,
  );
  const superseded = committedState.packets.find(
    (a) => a.id === predecessor.id,
  );
  const stripSupersession = ({
    status,
    superseded_by_analysis_id,
    superseded_at,
    superseded_by_user_id,
    ...rest
  }) => rest;
  assert.ok(oldPacket);
  assert.equal(
    Date.parse(replacement.review_due_at),
    Date.parse(replacementDueAt),
  );
  assert.ok(Number.isFinite(Date.parse(replacement.created_at)));
  assert.ok(Date.parse(replacement.created_at) < Date.parse(replacementDueAt));
  assert.match(replacement.analysis_digest, /^[0-9a-f]{64}$/);
  assert.notEqual(replacement.analysis_digest, "0".repeat(64));
  assert.equal(
    sql(
      `select public.risk_uncertainty_analysis_digest('${f.org}','${replacement.id}')`,
    ),
    replacement.analysis_digest,
  );
  const expectedReplacement = {
    ...oldPacket,
    id: replacement.id,
    version: 3,
    created_at: replacement.created_at,
    review_due_at: replacement.review_due_at,
    analysis_digest: replacement.analysis_digest,
    digest_version: 2,
    input_binding_snapshot: expectedSnapshot,
    replaces_analysis_id: predecessor.id,
    replacement_intent_id: intentId,
    replacement_request_fingerprint: requestFingerprint,
    replacement_compare_and_swap: expectedCas,
    replacement_reason: replacementRequest.reason,
  };
  assert.deepEqual(replacement, expectedReplacement);
  assert.deepEqual(
    committedState.bindings.filter((b) => b.analysis_id === replacement.id),
    [
      {
        organization_id: f.org,
        analysis_id: replacement.id,
        evidence_item_id: f.verified,
        created_at: replacement.created_at,
      },
    ],
  );
  assert.deepEqual(stripSupersession(superseded), stripSupersession(oldPacket));
  assert.equal(superseded.status, "superseded");
  assert.equal(superseded.superseded_by_analysis_id, replacement.id);
  assert.equal(superseded.superseded_at, replacement.created_at);
  assert.equal(superseded.superseded_by_user_id, f.author);
  assert.equal(
    committedState.packets.length,
    beforeReplacement.packets.length + 1,
  );
  assert.equal(
    committedState.bindings.length,
    beforeReplacement.bindings.length + 1,
  );
  assert.equal(committedState.audit.length, beforeReplacement.audit.length + 1);
  const replacementAudit = committedState.audit.find(
    (a) => !beforeReplacement.audit.some((b) => b.id === a.id),
  );
  assert.equal(
    replacementAudit.entity_type,
    "risk_uncertainty_analysis_replaced",
  );
  assert.equal(replacementAudit.event_data.replacement_intent_id, intentId);
  assert.ok(uuid(replacementAudit.id));
  assert.equal(replacementAudit.organization_id, f.org);
  assert.equal(replacementAudit.actor, "admin");
  assert.equal(replacementAudit.created_at, replacement.created_at);
  assert.equal(replacementAudit.event_time, replacement.created_at);
  assert.deepEqual(replacementAudit.event_data, {
    risk_id: f.risk,
    analysis_id: replacement.id,
    version: 3,
    analysis_digest: replacement.analysis_digest,
    evidence_item_ids: [f.verified],
    threshold_profile_id: f.criteria,
    operational_authorization: false,
    predecessor_analysis_id: predecessor.id,
    replacement_intent_id: intentId,
    request_fingerprint: requestFingerprint,
    compare_and_swap: expectedCas,
    reason: replacementRequest.reason,
  });
  const oldAudit = beforeReplacement.audit.find(
    (a) => a.entity_type === "risk_uncertainty_analysis_submitted",
  );
  assert.ok(oldAudit);
  assert.deepEqual(replacementAudit, {
    ...oldAudit,
    id: replacementAudit.id,
    created_at: replacement.created_at,
    event_time: replacement.created_at,
    actor: "admin",
    entity_type: "risk_uncertainty_analysis_replaced",
    event_data: replacementAudit.event_data,
  });
  const normalizedCommitted = structuredClone(committedState);
  normalizedCommitted.packets = normalizedCommitted.packets
    .filter((a) => a.id !== replacement.id)
    .map((a) => (a.id === predecessor.id ? oldPacket : a));
  normalizedCommitted.bindings = normalizedCommitted.bindings.filter(
    (b) => b.analysis_id !== replacement.id,
  );
  normalizedCommitted.audit = normalizedCommitted.audit.filter(
    (a) => a.id !== replacementAudit.id,
  );
  normalizedCommitted.risks = normalizedCommitted.risks.map((r) => {
    if (r.id !== f.risk) return r;
    const old = beforeReplacement.risks.find((a) => a.id === f.risk);
    assert.equal(r.value_of_information.analysis_id, replacement.id);
    assert.equal(r.value_of_information.validation_status, "pending_review");
    assert.equal(r.value_of_information.operational_authorization, false);
    assert.equal(r.updated_at, replacement.created_at);
    assert.deepEqual(r.value_of_information, {
      information_action: f.input.voi_action.trim(),
      information_cost: 10000,
      decision_cost_if_wrong: 250000,
      uncertainty_reduction: 0.5,
      probability_decision_changes: 0.3,
      expected_value: 37500,
      net_value: 27500,
      recommendation: "GATHER_INFORMATION",
      currency: "CAD",
      analysis_id: replacement.id,
      validation_status: "pending_review",
      recorded_at: replacement.created_at,
      human_decision_required: true,
      operational_authorization: false,
    });
    return {
      ...r,
      value_of_information: old.value_of_information,
      updated_at: old.updated_at,
    };
  });
  assert.deepEqual(
    normalizedCommitted,
    beforeReplacement,
    "only the exact reciprocal pair, binding, VOI projection and audit may change",
  );
  for (const key of [
    "approvals",
    "evidence",
    "criteria",
    "securityEvents",
    "decisions",
    "work",
    "stakeholderViews",
    "scenarios",
    "profiles",
  ])
    assert.deepEqual(committedState[key], beforeReplacement[key]);
  const receiptArgs = {
    p_risk_id: f.risk,
    p_intent_id: intentId,
    p_request_fingerprint: requestFingerprint,
  };
  const receipt = good(
    await rpc("get_risk_uncertainty_replacement_receipt", author, receiptArgs),
  );
  assert.deepEqual(
    Object.keys(receipt).sort(),
    [
      "commitStatus",
      "submittedStatus",
      "organizationId",
      "actorId",
      "riskId",
      "intentId",
      "requestFingerprint",
      "predecessorAnalysisId",
      "compareAndSwap",
      "analysisId",
      "version",
      "analysisDigest",
      "digestVersion",
      "digestCoverage",
      "valueOfInformation",
      "operationalAuthorization",
    ].sort(),
  );
  assert.equal(receipt.commitStatus, "committed");
  assert.equal(receipt.submittedStatus, "pending_review");
  assert.equal(receipt.organizationId, f.org);
  assert.equal(receipt.actorId, f.author);
  assert.equal(receipt.riskId, f.risk);
  assert.equal(receipt.intentId, intentId);
  assert.equal(receipt.requestFingerprint, requestFingerprint);
  assert.equal(receipt.predecessorAnalysisId, predecessor.id);
  assert.equal(receipt.analysisId, replacement.id);
  assert.equal(receipt.version, 3);
  assert.equal(receipt.analysisDigest, replacement.analysis_digest);
  assert.equal(receipt.digestVersion, 2);
  assert.equal(receipt.digestCoverage, "evidence_content_and_current_criteria");
  assert.equal(receipt.operationalAuthorization, false);
  assert.deepEqual(receipt.compareAndSwap, expectedCas);
  assert.deepEqual(receipt.valueOfInformation, pending.valueOfInformation);
  assert.deepEqual(replacementState(), committedState);
  for (const [token, args, error] of [
    [
      reviewer,
      receiptArgs,
      "no matching committed replacement receipt is visible",
    ],
    [foreign, receiptArgs, "risk not found in this organization"],
    [
      author,
      { ...receiptArgs, p_request_fingerprint: "0".repeat(64) },
      "no matching committed replacement receipt is visible",
    ],
    [
      author,
      { ...receiptArgs, p_intent_id: randomUUID() },
      "no matching committed replacement receipt is visible",
    ],
  ]) {
    const result = await rpc(
      "get_risk_uncertainty_replacement_receipt",
      token,
      args,
    );
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { error });
    assert.deepEqual(replacementState(), committedState);
  }
  // Real wall-clock expiry, bounded by this known ten-second due date. These
  // are explicit qualification requests, not application automatic retries.
  const waitDeadline = Date.now() + 12_000;
  while (!(Date.now() > Date.parse(replacementDueAt))) {
    assert.ok(Date.now() < waitDeadline, "bounded actual due-date expiry");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.deepEqual(
    good(
      await rpc(
        "get_risk_uncertainty_replacement_receipt",
        author,
        receiptArgs,
      ),
    ),
    receipt,
  );
  assert.deepEqual(replacementState(), committedState);
  assert.deepEqual(
    good(
      await rpc("replace_risk_uncertainty_analysis", author, {
        p_risk_id: f.risk,
        p_request_text: requestText,
      }),
    ),
    receipt,
  );
  assert.deepEqual(replacementState(), committedState);
  // U18 ATOMIC REPLACEMENT HTTP END
  console.log(
    "U18 isolated HTTP baseline PASS: real GoTrue/PostgREST; original evidence/order/self-review/tenant refusals without artifacts; exact threshold/probability/sensitivity/VOI and bound receipts; native guard gate retained; 1|2|1|0|0 authority ledger. New synthetic tenants remain only in disposable CI until Stop Supabase; broader U18 qualification remains partial.",
  );
}

// Never publish a returned provider message, credential, fixture ID or SQL body
// in a failing qualification log. A failed or uncertain write is never retried.
await run().catch(() => {
  throw new Error("U18.02 isolated CI qualification failed");
});
