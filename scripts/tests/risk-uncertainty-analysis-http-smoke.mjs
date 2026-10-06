import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Real GoTrue/PostgREST qualification on disposable CI only. No retries,
// production URL, existing-user UPSERT, or fabricated source-standing link.
async function run() {
  assert.equal(process.env.GITHUB_ACTIONS, "true", "CI-only uncertainty smoke");
  assert.equal(
    Object.keys(process.env).some((name) => name.startsWith("PG")),
    false,
    "ambient PostgreSQL connection environment is prohibited",
  );
  const status = spawnSync("supabase", ["status", "-o", "env"], {
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
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
  assert.equal(workspace.risk.id, f.risk);
  assert.equal(workspace.criteria.id, f.criteria);
  assert.equal(workspace.criteria.status, "adopted");
  const item = workspace.analyses.find(
    (packet) => packet.id === submitted.analysisId,
  );
  assert.ok(item);
  assert.equal(item.validationStatus, "validated");
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
  // TODO: inherited sensitive reads, source standing, post-wait authority and
  // stale replacement require coordinated backend tests. No false completion.
  console.log(
    "U18 isolated HTTP baseline PASS: real GoTrue/PostgREST; original evidence/order/self-review/tenant refusals without artifacts; exact threshold/probability/sensitivity/VOI and bound receipts; native guard gate retained; 1|2|1|0|0 authority ledger. New synthetic tenants remain only in disposable CI until Stop Supabase; broader U18 qualification remains partial.",
  );
}

// Never publish a returned provider message, credential, fixture ID or SQL body
// in a failing qualification log. A failed or uncertain write is never retried.
await run().catch(() => {
  throw new Error("U18.02 isolated CI qualification failed");
});
