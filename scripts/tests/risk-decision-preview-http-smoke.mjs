import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// Disposable CI fixtures only. Never accept a remote/customer API or DB URL.
assert.equal(
  process.env.GITHUB_ACTIONS,
  "true",
  "CI-only risk HTTP qualification",
);
const status = spawnSync("supabase", ["status", "-o", "env"], {
  encoding: "utf8",
});
assert.equal(status.status, 0, "local Supabase status failed");
const config = Object.fromEntries(
  [...status.stdout.matchAll(/^(API_URL|ANON_KEY)="([^"\n]*)"$/gm)].map(
    (match) => [match[1], match[2]],
  ),
);
assert.equal(
  config.API_URL,
  "http://127.0.0.1:54321",
  "risk smoke requires the CI loopback API",
);
assert.ok(config.ANON_KEY, "local anonymous fixture key missing");
const org = "11111111-1111-1111-1111-111111111111";
const risk = "98901000-0000-0000-0000-000000000001";
const criteria = "98901000-0000-0000-0000-000000000002";
const objective = "98901000-0000-0000-0000-000000000003";
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
    { encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" } },
  );
  assert.equal(result.status, 0, `isolated CI SQL failed: ${result.stderr}`);
  return result.stdout.trim();
}
async function login(email, password) {
  const response = await fetch(
    `${config.API_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: { apikey: config.ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  );
  assert.equal(response.status, 200, "real GoTrue fixture login failed");
  const body = await response.json();
  assert.equal(
    typeof body.access_token,
    "string",
    "fixture login lacks access token",
  );
  assert.ok(body.access_token.length > 0, "fixture login lacks access token");
  return body.access_token;
}
async function rpc(name, token, args) {
  const response = await fetch(`${config.API_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      apikey: config.ANON_KEY,
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(args),
  });
  return { status: response.status, body: await response.json() };
}
const admin = await login("admin@syncai.ca", "Admin123!@#");
const ordinary = await login("demo@syncai.ca", "Demo123!@#");
// All three rows are new, fixed-name synthetic CI fixtures. No existing row is
// updated and no adopted criteria, operational approval or customer fact is invented.
sql(`insert into risk_objectives(id,organization_id,owner_id,objective_level,description,target,measurement,timeframe,tolerance)
select '${objective}','${org}',id,'task','Risk HTTP qualification objective','Privacy retained','CI checks','CI run','No operational authority'
from user_profiles where email='admin@syncai.ca' and organization_id='${org}';
insert into risk_criteria_profiles(id,organization_id,name,status,likelihood_scale,consequence_dimensions,thresholds,
scoring_weights,decision_thresholds,time_factors,basis) values('${criteria}','${org}','Synthetic HTTP draft criteria','draft','[5]','["safety"]',
'{"low":10,"medium":40,"high":60,"critical":80}','{"inherent":1,"exposure":0,"uncertainty":0,"connectivity":0,"velocity":0,"capacity":0}',
'{"accept":0,"monitor":10,"investigate":40,"treat":60,"escalate":80}','{"weight":0}','Synthetic CI boundary, not approved engineering policy');
insert into risks(id,organization_id,objective_id,criteria_profile_id,title,information_sensitivity,risk_owner_id,decision_owner_id,created_by)
select '${risk}','${org}','${objective}','${criteria}','Restricted synthetic HTTP risk','restricted',id,id,id
from user_profiles where email='admin@syncai.ca' and organization_id='${org}';`);
const before = sql(
  `select to_jsonb(r)::text||'|'||(select count(*) from audit_events where organization_id='${org}') from risks r where id='${risk}'`,
);
const anonymous = await rpc("get_risk_decision_preview_context", null, {
  p_risk_id: risk,
});
assert.equal(
  anonymous.status,
  401,
  "anonymous preview must be denied before execution",
);
const context = await rpc("get_risk_decision_preview_context", admin, {
  p_risk_id: risk,
});
assert.equal(context.status, 200);
assert.equal(context.body.risk_id, risk);
assert.equal(context.body.criteria.id, criteria);
assert.equal(context.body.criteria.status, "draft");
assert.equal(context.body.advisory_only, true);
assert.equal(context.body.human_decision_required, true);
assert.ok(Array.isArray(context.body.active_competencies));
const analysis = {
  analysis_level: "semi_quantitative",
  analysis_method: "risk_matrix",
  likelihood: 3,
  consequences: { safety: 5 },
  control_effectiveness: 0,
  uncertainty: 0,
  confidence: 70,
  complexity: 0,
  connectivity: 0,
  exposure: 75,
  capacity_load: 0,
  velocity: 0,
  time_to_unacceptable_days: null,
  opportunity_value: 80,
};
const preview = await rpc("get_risk_analysis_preview", admin, {
  p_risk_id: risk,
  p_analysis: analysis,
});
assert.equal(preview.status, 200);
assert.equal(preview.body.risk_id, risk);
assert.equal(preview.body.criteria_id, criteria);
assert.deepEqual(preview.body.analysis, analysis);
assert.equal(preview.body.current_score, 60);
assert.equal(preview.body.level, "High");
assert.equal(preview.body.recommended_action, "INVESTIGATE");
assert.equal(preview.body.authoritative, false);
assert.equal(preview.body.advisory_only, true);
assert.equal(preview.body.human_decision_required, true);
for (const name of [
  "get_risk_decision_preview_context",
  "get_risk_analysis_preview",
]) {
  const denied = await rpc(name, ordinary, {
    p_risk_id: risk,
    ...(name.includes("analysis") ? { p_analysis: analysis } : {}),
  });
  assert.equal(denied.status, 200);
  assert.deepEqual(denied.body, { error: "risk not available to this user" });
  const foreign = await rpc(name, admin, {
    p_risk_id: "98900000-0000-0000-0000-000000000002",
    ...(name.includes("analysis") ? { p_analysis: analysis } : {}),
  });
  assert.equal(foreign.status, 200);
  assert.deepEqual(foreign.body, { error: "risk not available to this user" });
}
assert.equal(
  sql(
    `select to_jsonb(r)::text||'|'||(select count(*) from audit_events where organization_id='${org}') from risks r where id='${risk}'`,
  ),
  before,
);
console.log(
  "risk HTTP preview: real GoTrue/PostgREST PASS; exact draft criteria and canonical numeric/echo PASS; anonymous/ordinary/foreign denials PASS; no preview mutation PASS. New synthetic HTTP fixture rows remain only in disposable CI until Stop Supabase.",
);
