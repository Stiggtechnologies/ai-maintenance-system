// Real PostgreSQL sessions, built-in Node only. Run AFTER the real HTTP smoke
// in disposable CI, never against a customer/production database. SQL role/claim
// setup tests native boundaries; real JWT authentication is proved ONLY by HTTP.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

assert(process.env.GITHUB_ACTIONS === "true", "Disposable CI required");
assert(process.argv.length === 3 && process.argv[2] === "--ci-service-level-concurrency", "Explicit concurrency invocation required");
for (const key of ["PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "PGOPTIONS", "PGHOST"])
  assert(process.env[key] === undefined, `Forbidden PostgreSQL override: ${key}`);
const org = "11111111-1111-1111-1111-111111111111";
const foreignOrg = "99999999-9999-4999-8999-999999999208";
const asset = "92080000-0000-4000-8000-000000000001";
const priorAsset = "92080000-0000-4000-8000-000000000002";
const evidence = "92080000-0000-4000-8000-000000000011";
const risk = "92080000-0000-4000-8000-000000000021";
const suffix = randomUUID();
let phase = "BOOTSTRAP";
const sessions = [];
const inFlight = new Set();
function track(promise) {
  // Attach immediately: failed barriers must not leave an unhandled rejection
  // capable of terminating Node before synthetic profile restoration.
  inFlight.add(promise);
  promise.then(() => inFlight.delete(promise), () => inFlight.delete(promise));
  return promise;
}

function session(name) {
  const child = spawn("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate", "-h", "127.0.0.1", "-p", "54322", "-U", "postgres", "-d", "postgres", "-c", `set application_name='u208-${name}-${suffix}'`, "-f", "-"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { PATH: process.env.PATH, LC_ALL: "C", LANG: "C", PGPASSWORD: "postgres", PGHOSTADDR: "127.0.0.1", PGOPTIONS: "-c search_path=public -c statement_timeout=15000", PGSSLMODE: "disable" },
  });
  let pending, ended = false, sqlState = null, errorLine = "";
  let stopped;
  const closed = new Promise(resolve => { stopped = resolve; });
  const failure = kind => Object.assign(new Error(`U2.08 native qualification failed: ${phase} (${kind})`), { sqlState });
  function rejectPending(kind) {
    if (!pending) return;
    const value = pending; pending = undefined;
    clearTimeout(value.timer); value.reject(failure(kind));
  }
  child.stderr.on("data", chunk => {
    for (const character of chunk.toString("utf8")) {
      if (character === "\n") {
        const code = errorLine.match(/(?:ERROR|FATAL):\s+([A-Z0-9]{5})\s*$/)?.[1];
        if (code && !sqlState) sqlState = code;
        errorLine = "";
      } else if (errorLine.length < 512) errorLine += character;
    }
  });
  createInterface({ input: child.stdout }).on("line", line => {
    if (!pending) return;
    if (line === pending.marker) {
      const value = pending; pending = undefined;
      clearTimeout(value.timer); value.resolve(value.lines);
    } else pending.lines.push(line);
  });
  child.on("error", () => rejectPending("process"));
  child.stdin.on("error", () => { if (!ended) child.kill("SIGTERM"); });
  child.once("close", () => { ended = true; rejectPending(sqlState ? "server" : "process"); stopped(); });
  const handle = {
    query(sql) {
      assert.equal(pending, undefined);
      assert(!ended && !child.stdin.destroyed);
      return new Promise((resolve, reject) => {
        const marker = `U208_END_${randomUUID()}`;
        sqlState = null;
        const timer = setTimeout(() => { rejectPending("watchdog"); child.kill("SIGTERM"); }, 20000);
        pending = { marker, lines: [], resolve, reject, timer };
        child.stdin.write(`${sql};\nselect '${marker}';\n`);
      });
    },
    async close() {
      if (ended) return;
      child.stdin.end();
      if (!ended) child.kill("SIGTERM");
      const stop = await Promise.race([closed.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 3000))]);
      if (!stop) { child.kill("SIGKILL"); await closed; }
    },
  };
  sessions.push(handle);
  return handle;
}
const json = lines => JSON.parse(lines.at(-1));
const literal = value => `'${value.replaceAll("'", "''")}'`;
const observer = session("observer"), holder = session("holder"), caller = session("caller"), changer = session("changer"), probe = session("probe");
let author, reviewer;
let originalRiskSensitivity, originalEvidenceRisk;
const originalProfiles = new Map();
const publicEvidence = randomUUID(), documentedEvidence = randomUUID(), aiEvidence = randomUUID(), stakeholder = randomUUID();
const derived = {
  asset: randomUUID(), evidence: randomUUID(), child: randomUUID(), parent: randomUUID(), grandparent: randomUUID(),
  childOrigin: randomUUID(), parentOrigin: randomUUID(), ancestorStakeholder: randomUUID(),
};
let derivedFixtureReady = false;

async function state(connection = observer) {
  return json(await connection.query(`select jsonb_build_object(
    'service',(select to_jsonb(s) from public.asset_service_levels s where organization_id='${org}' and asset_id='${asset}'),
    'services',coalesce((select jsonb_agg(to_jsonb(s) order by s.asset_id) from public.asset_service_levels s where organization_id='${org}'),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from public.audit_events a where a.organization_id='${org}'),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from public.audit_events a where a.organization_id='${org}' and a.entity_type in ('asset_service_level','asset_service_level_verification')),'[]'::jsonb),
    'approvals',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.approvals a where a.organization_id='${org}'),'[]'::jsonb),
    'workOrders',coalesce((select jsonb_agg(to_jsonb(w) order by w.id) from public.work_orders w where w.organization_id='${org}'),'[]'::jsonb))`));
}
async function beginCaller(actor = author, retained = false) {
  await caller.query("reset role; begin");
  if (retained) {
    const locked = await caller.query(`select id from public.assets where id='${priorAsset}' and organization_id='${org}' for update`);
    assert.equal(locked.at(-1), priorAsset); // Not zero/wrong-row lock proof.
    await caller.query("select set_config('app.u208_retained_context','retained',true)");
  }
  await caller.query(`set local role authenticated; select set_config('request.jwt.claim.sub','${actor}',true); select set_config('request.jwt.claims',${literal(JSON.stringify({ sub: actor, role: "authenticated" }))},true)`);
}
const sqlValue = value => value === null ? "null" : typeof value === "number" ? String(value) : literal(value);
function target(operation, changes = {}) {
  const request = operation === "record" ? {
    p_asset_id: asset, p_service_name: " Synthetic process water delivery ", p_beneficiary: "Synthetic test wash plant",
    p_tolerable_downtime_hours: null, p_consequence_class: "production", p_restoration_rank: null,
    p_notes: "Declared synthetic inspection; no normative tolerance or operational authority.",
    p_basis: "Canonical inspected capture; primary normative limits are unknown.", p_evidence_item_id: evidence,
    p_expected_version: 5, p_command_id: randomUUID(), p_observed_actor_id: author, p_observed_organization_id: org,
  } : { p_asset_id: asset, p_expected_version: 5,
    p_review_note: " Named independent review of the exact current synthetic inspection basis. ",
    p_command_id: randomUUID(), p_observed_actor_id: reviewer, p_observed_organization_id: org };
  Object.assign(request, changes);
  return { operation, request, sql: `select public.${operation === "record" ? "record" : "verify"}_asset_service_level(${Object.entries(request).map(([key, value]) => `${key}=>${sqlValue(value)}`).join(",")})` };
}
function assertReceipt(value, command) {
  assert.equal(value.outcome, "committed");
  assert.equal(value.command_id, command.request.p_command_id);
  assert.equal(value.actor_id, command.request.p_observed_actor_id);
  assert.equal(value.organization_id, org); assert.equal(value.operation, command.operation);
  assert.equal(value.asset_id, command.request.p_asset_id);
  assert.equal(value.version, (command.request.p_expected_version ?? 0) + 1);
  assert.equal(value.status, command.operation === "record" ? "draft" : "verified");
  assert.deepEqual(value.request, command.request); // Untrimmed original request.
}
function assertTransition(before, after, command) {
  assert.deepEqual(after.approvals, before.approvals); assert.deepEqual(after.workOrders, before.workOrders);
  assert.deepEqual(after.audit.slice(0, -1), before.audit);
  assert.equal(after.audit.length, before.audit.length + 1);
  assert.deepEqual(after.history.slice(0, -1), before.history);
  const receipt = after.history.at(-1);
  assert.equal(after.history.length, before.history.length + 1);
  assert.equal(receipt.actor, command.request.p_observed_actor_id);
  assert.equal(receipt.event_data.command_id, command.request.p_command_id);
  assert.deepEqual(receipt.event_data.request, command.request);
  assert.equal(receipt.entity_type, command.operation === "record" ? "asset_service_level" : "asset_service_level_verification");
  assert.deepEqual(receipt.previous_state, before.services.find(s => s.asset_id === command.request.p_asset_id) ?? null);
  assert.deepEqual(receipt.new_state, after.services.find(s => s.asset_id === command.request.p_asset_id));
}
async function assertNoWrite(before) {
  // Observe the caller's OWN uncommitted writes with owner visibility before
  // any rollback; revoked/sensitive RLS cannot hide an accidental mutation.
  await caller.query("reset role");
  const ownState = await state(caller);
  await caller.query("set local role authenticated");
  assert.deepEqual(ownState, before);
  assert.deepEqual(await state(), before);
}
async function assertRetained(actor = author) {
  const context = json(await caller.query(`select jsonb_build_object('actor',auth.uid(),'org',public.app_current_org(),'role',current_user,'retained',current_setting('app.u208_retained_context',true))`));
  assert.deepEqual(context, { actor, org, role: "authenticated", retained: "retained" });
  await probe.query(`begin; do $probe$ begin
    begin perform 1 from public.assets where id='${priorAsset}' for update nowait;
      raise exception 'retained caller lock was lost' using errcode='P0001';
    exception when lock_not_available then null; end;
  end $probe$; rollback`);
}
async function assertNewLocksReleased(actor, excluded = []) {
  await probe.query("begin");
  for (const [table, key, id] of [
    ["public.assets", "id", asset], ["public.asset_service_levels", "asset_id", asset],
    ["public.evidence_items", "id", evidence], ["public.risks", "id", risk],
    ["public.risk_stakeholder_views", "id", stakeholder], ["public.user_profiles", "id", actor],
    ["auth.users", "id", actor], ["public.organizations", "id", org],
  ]) {
    if (excluded.includes(table)) continue;
    assert.equal((await probe.query(`select ${key} from ${table} where ${key}='${id}' for update nowait`)).at(-1), id);
  }
  await probe.query("rollback");
}
async function waitForBlock(callerPid, holderPid) {
  for (let pass = 0; pass < 100; pass++) {
    const blocked = (await observer.query(`select exists(select 1 from pg_stat_activity where pid=${callerPid} and wait_event_type='Lock' and ${holderPid}=any(pg_blocking_pids(pid)))`)).at(-1);
    if (blocked === "t") return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`U2.08 actual lock barrier was not observed: ${phase}`);
}
async function busyBefore(table, key, operation, inverse = false) {
  const before = await state();
  assert.equal((await holder.query(`begin; select 1 from public.${table} where ${key} for update`)).at(-1), "1");
  const command = target(operation), actor = command.request.p_observed_actor_id;
  await beginCaller(actor, true);
  const result = json(await caller.query(command.sql));
  assert.equal(result.outcome, "refused");
  assert.match(result.error, /busy/);
  assert.equal(result.command_id, command.request.p_command_id);
  assert.equal(result.actor_id, actor); assert.equal(result.organization_id, org);
  await assertNoWrite(before);
  await assertNewLocksReleased(actor, [`public.${table}`]);
  await assertRetained(actor);
  if (inverse) {
    // Actual inverse writer already owns evidence/risk and now requires asset.
    // This MUST complete while the caller's outer transaction is still open.
    await holder.query(`update public.assets set name=name||' synthetic inverse probe' where id='${asset}'`);
  }
  await holder.query("rollback");
  await assertNewLocksReleased(actor);
  await assertRetained(actor);
  await caller.query("rollback; reset role");
  assert.deepEqual(await state(), before);
  console.log(`U2.08 ${phase} PASS ${new Date().toISOString()}`);
}
async function expectRefusal(command, pattern) {
  const before = await state();
  await beginCaller(command.request.p_observed_actor_id);
  const result = json(await caller.query(command.sql));
  assert.equal(result.outcome, "refused");
  assert.equal(result.command_id, command.request.p_command_id);
  assert.equal(result.actor_id, command.request.p_observed_actor_id);
  assert.equal(result.organization_id, org);
  assert.match(result.error, pattern);
  await assertNoWrite(before);
  await caller.query("commit; reset role"); // A refused request may safely commit.
  assert.deepEqual(await state(), before);
  console.log(`U2.08 ${phase} PASS ${new Date().toISOString()}`);
}
async function successfulFence(operation) {
  phase = `${operation.toUpperCase()}_SUCCESSFUL_SOURCE_AND_MEMBERSHIP_FENCES`;
  const before = await state();
  const command = target(operation,{p_expected_version:before.service.version});
  const actor = command.request.p_observed_actor_id;
  await beginCaller(actor,true);
  const callerPid = Number((await caller.query("select pg_backend_pid()")).at(-1));
  assertReceipt(json(await caller.query(command.sql)),command);
  await assertRetained(actor);
  // Observe actual conflicting lock waits for real synthetic no-op writers.
  // Key-share locks intentionally block key/delete strength, not ordinary edits.
  const competitors = [];
  for (const [name, id, sql] of [
    ["asset",asset,`update public.assets set name=name where id='${asset}' returning id`],
    ["evidence",evidence,`update public.evidence_items set description=description where id='${evidence}' returning id`],
    ["risk",risk,`update public.risks set information_sensitivity=information_sensitivity where id='${risk}' returning id`],
    ["stakeholder",stakeholder,`update public.risk_stakeholder_views set rationale=rationale where id='${stakeholder}' returning id`],
    ["profile",actor,`update public.user_profiles set role=role where id='${actor}' returning id`],
    ["auth-user-key",actor,`select id from auth.users where id='${actor}' for update`],
    // Only record explicitly acquires this key-share fence. Verify's unchanged
    // organization FK does not justify claiming a new organization-row lock.
    ...(operation === "record" ? [["organization-key",org,`select id from public.organizations where id='${org}' for update`]] : []),
    ["service",asset,`select asset_id from public.asset_service_levels where asset_id='${asset}' for update`],
  ]) {
    const contender = session(`fence-${name}`);
    const pid = Number((await contender.query("begin; select pg_backend_pid()")).at(-1));
    const pending = track(contender.query(sql));
    competitors.push({contender,pending,id});
    await waitForBlock(pid,callerPid);
  }
  assert.deepEqual(await state(),before); // Successful RPC still uncommitted.
  await caller.query("commit; reset role");
  for (const {contender,pending,id} of competitors) {
    assert.equal((await pending).at(-1),id);
    await contender.query("rollback");
    await contender.close();
  }
  const after = await state();
  assertTransition(before,after,command);
  await assertNewLocksReleased(actor);
  console.log(`U2.08 ${phase} PASS ${new Date().toISOString()}`);
}
async function forbiddenTruncate(role) {
  phase = `${role.toUpperCase()}_TRUNCATE_STATE_AND_HISTORY_BACKSTOP`;
  const before = await state(), attempt = session(`truncate-${role}`);
  if (role !== "owner") await attempt.query(`begin; set local role ${role}; select set_config('request.jwt.claim.sub','${author}',true)`);
  else await attempt.query("begin");
  // CASCADE avoids mistaking the legacy U13 FK's RESTRICT error for a backstop.
  // The unconditional new statement trigger must reject the owner too.
  let rejected = false;
  try { await attempt.query("truncate public.asset_service_levels cascade"); }
  catch (error) { assert.equal(error.sqlState,"42501"); rejected = true; }
  finally { await attempt.close(); }
  assert(rejected,"TRUNCATE unexpectedly admitted");
  assert.deepEqual(await state(),before);
  console.log(`U2.08 ${phase} PASS ${new Date().toISOString()}`);
}

// Privileged disposable setup below exercises canonical typed ancestry, not
// creation/treatment workflow or audited source-correction acceptance. Never
// fabricate an origin receipt: these synthetic rows have no ledger origin.
async function derivedSources(connection = observer) {
  return json(await connection.query(`select jsonb_build_object(
    'risks',(select jsonb_agg(to_jsonb(r) order by r.id) from public.risks r where id in ('${derived.child}','${derived.parent}','${derived.grandparent}')),
    'scenarios',(select jsonb_agg(to_jsonb(s) order by s.id) from public.scenarios s where id in ('${derived.childOrigin}','${derived.parentOrigin}')),
    'evidence',(select to_jsonb(e) from public.evidence_items e where id='${derived.evidence}'),
    'stakeholder',(select to_jsonb(sv) from public.risk_stakeholder_views sv where id='${derived.ancestorStakeholder}'))`));
}
async function assertDerivedNoWrite(before, sources) {
  await assertNoWrite(before);
  await caller.query("reset role");
  assert.deepEqual(await derivedSources(caller), sources);
  await caller.query("set local role authenticated");
  assert.deepEqual(await derivedSources(), sources);
}
async function assertDerivedAccess(connection, actor, readable, evidenceRisk = derived.child) {
  const access = json(await connection.query(`select jsonb_build_object(
    'actor',auth.uid(),'org',public.app_current_org(),'sqlRole',current_user,
    'profile',(select jsonb_build_object('role',role,'org',organization_id) from public.user_profiles where id=auth.uid()),
    'read',jsonb_build_array(public.can_read_risk('${derived.child}'),public.can_read_risk('${derived.parent}'),public.can_read_risk('${derived.grandparent}')),
    'riskRows',(select count(*) from public.risks where id in ('${derived.child}','${derived.parent}','${derived.grandparent}')),
    'scenarioRows',(select count(*) from public.scenarios where id in ('${derived.childOrigin}','${derived.parentOrigin}')),
    'evidenceRows',(select count(*) from public.evidence_items where id='${derived.evidence}' and risk_id='${evidenceRisk}'))`));
  assert.deepEqual(access, { actor, org, sqlRole: "authenticated", profile: { role: "reliability_engineer", org },
    read: [readable,readable,readable], riskRows: readable ? 3 : 0, scenarioRows: readable ? 2 : 0,
    // A synthetic live rebind can be readable while its captured ancestor is not.
    evidenceRows: readable || evidenceRisk === risk ? 1 : 0 });
}
const derivedLocks = actor => [
  ["public.assets","id",derived.asset], ["public.asset_service_levels","asset_id",derived.asset],
  ["public.evidence_items","id",derived.evidence],
  ...[derived.child,derived.parent,derived.grandparent].map(id => ["public.risks","id",id]),
  ...[derived.childOrigin,derived.parentOrigin].map(id => ["public.scenarios","id",id]),
  ["public.risk_stakeholder_views","id",derived.ancestorStakeholder],
  ["public.user_profiles","id",actor], ["auth.users","id",actor], ["public.organizations","id",org],
];
async function assertDerivedLocksReleased(actor, excludedId = null) {
  await probe.query("begin");
  for (const [table,key,id] of [...derivedLocks(actor),
    // Captured-root schedules also acquire the different live root; replacement
    // can acquire the separately readable evidence before refusing the old basis.
    ["public.risks","id",risk], ["public.risk_stakeholder_views","id",stakeholder],
    ["public.evidence_items","id",publicEvidence],
  ]) {
    if (id === excludedId) continue;
    assert.equal((await probe.query(`select ${key} from ${table} where ${key}='${id}' for update nowait`)).at(-1),id);
  }
  await probe.query("rollback");
}
async function derivedCommand(operation, changes = {}) {
  const version = Number((await observer.query(`select version from public.asset_service_levels where asset_id='${derived.asset}' and organization_id='${org}'`)).at(-1));
  assert(Number.isInteger(version) && version > 0);
  return target(operation,{p_asset_id:derived.asset,p_expected_version:version,
    ...(operation === "record" ? {p_evidence_item_id:derived.evidence} : {}),...changes});
}
async function derivedBusy(operation, table, id, captured = false) {
  phase = `${operation.toUpperCase()}_${captured ? "CAPTURED" : "LIVE"}_DERIVED_${table.toUpperCase()}_${id === derived.grandparent ? "GRANDPARENT" : id === derived.parent ? "PARENT" : "ORIGIN"}_BUSY_RELEASE`;
  const before = await state(), sources = await derivedSources();
  const command = await derivedCommand(operation), actor = command.request.p_observed_actor_id;
  await beginCaller(actor,true);
  await assertDerivedAccess(caller,actor,true,captured ? risk : derived.child);
  assert.equal((await holder.query(`begin; select id from public.${table} where id='${id}' and organization_id='${org}' for update`)).at(-1),id);
  const refused = json(await caller.query(command.sql));
  assert.equal(refused.outcome,"refused"); assert.match(refused.error,/busy/);
  assert.equal(refused.command_id,command.request.p_command_id);
  assert.equal(refused.actor_id,actor); assert.equal(refused.organization_id,org);
  await assertDerivedNoWrite(before,sources);
  await assertRetained(actor);
  await assertDerivedLocksReleased(actor,id);
  // Real inverse writer owns the ancestor/scenario and requires the new asset.
  // Completion while the caller is still open proves no new asset lock leaked.
  assert.equal((await holder.query(`update public.assets set name=name where id='${derived.asset}' returning id`)).at(-1),derived.asset);
  await holder.query("commit");
  await assertDerivedLocksReleased(actor);
  await assertRetained(actor);
  await assertDerivedNoWrite(before,sources);
  await caller.query("commit; reset role");
  assert.deepEqual(await state(),before); assert.deepEqual(await derivedSources(),sources);
  console.log(`U2.08 ${phase} PASS ${new Date().toISOString()}`);
}
async function derivedVisibilityAfterWait(operation, captured) {
  phase = `${operation.toUpperCase()}_${captured ? "CAPTURED" : "LIVE"}_GRANDPARENT_VISIBILITY_AFTER_ASSET_WAIT`;
  const command = await derivedCommand(operation,captured && operation === "record" ? {p_evidence_item_id:publicEvidence} : {});
  const actor = command.request.p_observed_actor_id, before = await state();
  const capturedReplacement = captured && operation === "record";
  const priorSources = capturedReplacement ? await derivedSources() : null;
  async function admissibleReplacement(connection, expected = null) {
    assert.equal(command.request.p_evidence_item_id,publicEvidence);
    assert.equal(command.request.p_tolerable_downtime_hours,null);
    assert.equal(command.request.p_restoration_rank,null);
    const basis = json(await connection.query(`select jsonb_build_object(
      'standing',public.asset_service_level_evidence_standing('${org}','${derived.asset}','${publicEvidence}'),
      'snapshot',(select to_jsonb(e) from public.evidence_items e where id='${publicEvidence}' and organization_id='${org}'))`));
    assert.equal(basis.standing,true);
    assert.equal(basis.snapshot.document_id,null);
    assert.equal(basis.snapshot.evidence_class,"INSPECTED");
    assert.equal(basis.snapshot.verification_status,"verified");
    if (expected) assert.deepEqual(basis.snapshot,expected);
    return basis.snapshot;
  }
  await beginCaller(actor,true);
  await assertDerivedAccess(caller,actor,true,captured ? risk : derived.child);
  const replacementSnapshot = capturedReplacement ? await admissibleReplacement(caller) : null;
  if (capturedReplacement) {
    assert.equal(priorSources.evidence.risk_id,risk);
    assert.equal(before.services.find(row => row.asset_id === derived.asset).evidence_snapshot.risk_id,derived.child);
  }
  const callerPid = Number((await caller.query("select pg_backend_pid()")).at(-1));
  const holderPid = Number((await holder.query(`begin; select id from public.assets where id='${derived.asset}' for update; select pg_backend_pid()`)).at(-1));
  const pending = track(caller.query(command.sql));
  await waitForBlock(callerPid,holderPid);
  await changer.query(`update public.risks set information_sensitivity='restricted' where id='${derived.grandparent}' and organization_id='${org}'`);
  const sources = await derivedSources();
  if (capturedReplacement) {
    // Counterfactual isolation: only the captured grandparent's sensitivity
    // (and its canonical update timestamp) changed; current/captured evidence,
    // typed origin/scenario tuples and every other risk field remain exact.
    for (const field of ["scenarios","evidence","stakeholder"]) assert.deepEqual(sources[field],priorSources[field]);
    for (const current of sources.risks) {
      const prior = priorSources.risks.find(row => row.id === current.id);
      if (current.id !== derived.grandparent) assert.deepEqual(current,prior);
      else {
        assert.equal(prior.information_sensitivity,"public"); assert.equal(current.information_sensitivity,"restricted");
        const oldFields = {...prior}, newFields = {...current};
        for (const field of ["information_sensitivity","updated_at"]) { delete oldFields[field]; delete newFields[field]; }
        assert.deepEqual(newFields,oldFields);
      }
    }
    assert.deepEqual(await state(),before);
  }
  const witness = session("derived-permission-witness");
  await witness.query(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${actor}',true);
    select set_config('request.jwt.claims',${literal(JSON.stringify({sub:actor,role:"authenticated"}))},true)`);
  await assertDerivedAccess(witness,actor,false,captured ? risk : derived.child);
  if (capturedReplacement) await admissibleReplacement(witness,replacementSnapshot);
  await witness.query("commit"); await witness.close();
  await holder.query("commit");
  const refused = json(await pending);
  assert.equal(refused.outcome,"refused"); assert.match(refused.error,/basis|evidence|available|visib/);
  if (capturedReplacement) assert.equal(refused.error,"current service consequence is unavailable for replacement");
  assert.equal(refused.command_id,command.request.p_command_id); assert.equal(refused.actor_id,actor); assert.equal(refused.organization_id,org);
  await assertDerivedAccess(caller,actor,false,captured ? risk : derived.child);
  const hidden = json(await caller.query(`select public.get_asset_service_level_editor('${actor}','${org}','levels',null)`));
  assert(Array.isArray(hidden.rows)); assert(!hidden.rows.some(row => row.asset_id === derived.asset));
  await assertDerivedNoWrite(before,sources); await assertRetained(actor);
  // A semantic refusal may retain its protecting locks until the outer commit;
  // only the busy exception promises immediate subtransaction lock release.
  await caller.query("commit; reset role");
  await assertDerivedLocksReleased(actor);
  assert.deepEqual(await state(),before); assert.deepEqual(await derivedSources(),sources);
  await changer.query(`update public.risks set information_sensitivity='public' where id='${derived.grandparent}' and organization_id='${org}'`);
  console.log(`U2.08 ${phase} PASS ${new Date().toISOString()}`);
}
async function derivedSuccessfulFence(operation) {
  phase = `${operation.toUpperCase()}_DERIVED_ANCESTOR_SCENARIO_COMMIT_FENCES`;
  const before = await state(), sources = await derivedSources(), command = await derivedCommand(operation);
  const actor = command.request.p_observed_actor_id;
  await beginCaller(actor,true); await assertDerivedAccess(caller,actor,true);
  const callerPid = Number((await caller.query("select pg_backend_pid()")).at(-1));
  assertReceipt(json(await caller.query(command.sql)),command); await assertRetained(actor);
  const competitors = [];
  for (const [table,key,id] of derivedLocks(actor).filter(([table]) => ["public.risks","public.scenarios","public.risk_stakeholder_views"].includes(table))) {
    const contender = session("derived-fence");
    const pid = Number((await contender.query("begin; select pg_backend_pid()")).at(-1));
    const pending = track(contender.query(`select ${key} from ${table} where ${key}='${id}' for update`));
    competitors.push({contender,pending,id});
    await waitForBlock(pid,callerPid);
  }
  assert.deepEqual(await state(),before); assert.deepEqual(await derivedSources(),sources);
  await caller.query("reset role"); assertTransition(before,await state(caller),command);
  await caller.query("set local role authenticated"); await assertRetained(actor);
  await caller.query("commit; reset role");
  for (const {contender,pending,id} of competitors) {
    assert.equal((await pending).at(-1),id);
    await contender.query("commit"); await contender.close();
  }
  assertTransition(before,await state(),command); assert.deepEqual(await derivedSources(),sources);
  await assertDerivedLocksReleased(actor);
  console.log(`U2.08 ${phase} PASS ${new Date().toISOString()}`);
}
async function derivedMatrix() {
  phase = "PRIVILEGED_SYNTHETIC_TYPED_DERIVED_FIXTURE";
  await observer.query(`begin;
    insert into public.assets(id,organization_id,name,tag) values('${derived.asset}','${org}','Synthetic native ancestry fence asset; not customer state','U208-NATIVE-DERIVED');
    insert into public.risks(id,organization_id,title,information_sensitivity) values('${derived.grandparent}','${org}','Synthetic ancestry root; no operational assertion','public');
    insert into public.scenarios(id,organization_id,risk_id,key,label) values('${derived.parentOrigin}','${org}','${derived.grandparent}','synthetic_native_origin','Synthetic typed ancestry origin, not selected treatment');
    insert into public.risks(id,organization_id,title,information_sensitivity,secondary_to_risk_id,arising_from_scenario_id)
      values('${derived.parent}','${org}','Synthetic ancestry parent','public','${derived.grandparent}','${derived.parentOrigin}');
    insert into public.scenarios(id,organization_id,risk_id,key,label) values('${derived.childOrigin}','${org}','${derived.parent}','synthetic_native_origin','Synthetic typed child origin, not selected treatment');
    insert into public.risks(id,organization_id,title,information_sensitivity,risk_owner_id,secondary_to_risk_id,arising_from_scenario_id)
      values('${derived.child}','${org}','Synthetic ancestry child; child ownership does not declassify ancestors','public','${author}','${derived.parent}','${derived.childOrigin}');
    insert into public.risk_stakeholder_views(id,organization_id,risk_id,stakeholder_user_id,stakeholder_name,rationale)
      values('${derived.ancestorStakeholder}','${org}','${derived.grandparent}',null,'Synthetic ancestor lock only','No sensitivity access grant');
    insert into public.evidence_items(id,organization_id,asset_id,risk_id,source_system,evidence_type,description,evidence_class)
      values('${derived.evidence}','${org}','${derived.asset}','${derived.child}','synthetic-native-fixture','synthetic_fixture','Privileged synthetic ancestry fixture, not governed capture or audited source correction.','INSPECTED');
    commit`);
  derivedFixtureReady = true;
  for (const actor of [author,reviewer]) await observer.query(`update public.user_profiles set role='reliability_engineer' where id='${actor}' and organization_id='${org}'`);
  const origins = json(await observer.query(`select jsonb_build_object(
    'child',(select public.get_risk_secondary_origin_internal(r) from public.risks r where id='${derived.child}'),
    'parent',(select public.get_risk_secondary_origin_internal(r) from public.risks r where id='${derived.parent}'),
    'root',(select public.get_risk_secondary_origin_internal(r) from public.risks r where id='${derived.grandparent}'),
    'receipts',(select count(*) from public.audit_events where entity_type='risk_secondary_created' and event_data->>'risk_id' in ('${derived.child}','${derived.parent}')))`));
  assert.deepEqual(origins,{child:{valid:true,derived:true,parent_id:derived.parent,scenario_id:derived.childOrigin},
    parent:{valid:true,derived:true,parent_id:derived.grandparent,scenario_id:derived.parentOrigin},
    root:{valid:true,derived:false,parent_id:null,scenario_id:null},receipts:0});
  await beginCaller(reviewer); await assertDerivedAccess(caller,reviewer,true);
  assert(!json(await caller.query(`select public.verify_evidence_item('${derived.evidence}','Named inspection of labelled synthetic ancestry fixture','verified','No customer fact or normative source claim')`)).error);
  await caller.query("commit; reset role");
  const before = await state();
  await beginCaller(author); await assertDerivedAccess(caller,author,true);
  const seed = target("record",{p_asset_id:derived.asset,p_evidence_item_id:derived.evidence,p_expected_version:0});
  assertReceipt(json(await caller.query(seed.sql)),seed); await caller.query("commit; reset role");
  assertTransition(before,await state(),seed);
  const dependencies = [["risks",derived.parent],["risks",derived.grandparent],
    ["scenarios",derived.childOrigin],["scenarios",derived.parentOrigin],["risk_stakeholder_views",derived.ancestorStakeholder]];
  for (const captured of [false,true]) {
    if (captured) {
      // Live rebind is an explicit privileged test control, NOT audited correction.
      // The governed service's original snapshot must continue fencing ancestry.
      await observer.query(`update public.evidence_items set risk_id='${risk}' where id='${derived.evidence}' and organization_id='${org}'`);
      assert.equal((await observer.query(`select evidence_snapshot->>'risk_id' from public.asset_service_levels where asset_id='${derived.asset}'`)).at(-1),derived.child);
    }
    for (const operation of ["record","verify"]) {
      for (const [table,id] of dependencies) await derivedBusy(operation,table,id,captured);
      await derivedVisibilityAfterWait(operation,captured);
    }
    if (captured) await observer.query(`update public.evidence_items set risk_id='${derived.child}' where id='${derived.evidence}' and organization_id='${org}'`);
  }
  phase = "SCENARIO_TYPED_ORIGIN_IMMUTABILITY_REFUSAL";
  const originState = await state(), originSources = await derivedSources();
  for (const scenario of [derived.childOrigin,derived.parentOrigin]) {
    await observer.query(`begin; do $origin$ declare refusal text; begin
      begin update public.scenarios set risk_id=null where id='${scenario}';
        raise exception 'synthetic origin reparent admitted' using errcode='P0001';
      exception when check_violation then
        get stacked diagnostics refusal=message_text;
        if refusal <> 'A secondary risk treatment origin identity, tenant and parent are immutable' then raise; end if;
      end;
      begin delete from public.scenarios where id='${scenario}';
        raise exception 'synthetic origin deletion admitted' using errcode='P0001';
      exception when check_violation then
        get stacked diagnostics refusal=message_text;
        if refusal <> 'A secondary risk treatment origin cannot be deleted' then raise; end if;
      end;
    end $origin$; commit`);
  }
  assert.deepEqual(await state(),originState); assert.deepEqual(await derivedSources(),originSources);
  console.log(`U2.08 ${phase} PASS ${new Date().toISOString()}`);
  await derivedSuccessfulFence("record"); await derivedSuccessfulFence("verify");
  for (const actor of [author,reviewer]) await observer.query(`update public.user_profiles set role=${literal(originalProfiles.get(actor).role)} where id='${actor}'`);
}

try {
  const members = json(await observer.query(`select jsonb_build_object('author',(select id from public.user_profiles where email='manager@syncai.ca'),'reviewer',(select id from public.user_profiles where email='admin@syncai.ca'))`));
  author = members.author; reviewer = members.reviewer;
  assert.match(author, /^[0-9a-f-]{36}$/); assert.match(reviewer, /^[0-9a-f-]{36}$/);
  assert.notEqual(author, reviewer);
  for (const actor of [author, reviewer]) {
    const profile = json(await observer.query(`select jsonb_build_object('role',role,'organization_id',organization_id) from public.user_profiles where id='${actor}'`));
    assert.equal(profile.organization_id, org);
    originalProfiles.set(actor, profile);
  }
  // Explicit privileged synthetic fixture setup, not governed source capture.
  await observer.query(`insert into public.risk_stakeholder_views(id,organization_id,risk_id,stakeholder_user_id,stakeholder_name,rationale)
    values('${stakeholder}','${org}','${risk}','${author}','Synthetic lock-fence stakeholder','Synthetic native lock fixture only')`);
  for (const [id, evidenceClass] of [[publicEvidence,"INSPECTED"],[documentedEvidence,"DOCUMENTED"],[aiEvidence,"AI_INFERENCE"]]) {
    await observer.query(`insert into public.evidence_items(id,organization_id,source_system,evidence_type,description,evidence_class)
      values('${id}','${org}','synthetic-native-fixture','synthetic_fixture','Declared synthetic applicability fixture; not a normative source claim.','${evidenceClass}')`);
    await beginCaller(reviewer);
    const verified = json(await caller.query(`select public.verify_evidence_item('${id}','Named review of synthetic fixture class and provenance','verified','Synthetic fixture only; no customer observation or normative claim')`));
    assert(!verified.error);
    await caller.query("commit; reset role");
  }
  const initial = await state();
  assert.equal(initial.service.version, 5); assert.equal(initial.service.status, "draft");
  assert.equal(initial.service.evidence_item_id, evidence);
  assert.equal(initial.service.evidence_snapshot.risk_id, risk);
  originalRiskSensitivity = (await observer.query(`select information_sensitivity from public.risks where id='${risk}' and organization_id='${org}'`)).at(-1);
  originalEvidenceRisk = (await observer.query(`select risk_id from public.evidence_items where id='${evidence}' and organization_id='${org}'`)).at(-1);
  for (const role of ["owner","authenticated","service_role"]) await forbiddenTruncate(role);
  for (const operation of ["record","verify"]) {
    for (const [table,id] of [["evidence_items",evidence],["risks",risk],["risk_stakeholder_views",stakeholder],["user_profiles",operation === "record" ? author : reviewer]]) {
      phase = `${operation.toUpperCase()}_${table.toUpperCase()}_BUSY_RETAINED_CALLER`;
      await busyBefore(table, `id='${id}'`, operation, table !== "user_profiles");
    }
  }

  const callerPid = Number((await caller.query("select pg_backend_pid()")).at(-1));
  const holderPid = Number((await holder.query("select pg_backend_pid()")).at(-1));
  for (const operation of ["record","verify"]) for (const change of ["role", "organization"]) {
    phase = `${operation.toUpperCase()}_FINAL_CURRENT_${change.toUpperCase()}_AFTER_ASSET_WAIT`;
    const before = await state();
    await holder.query(`begin; select id from public.assets where id='${asset}' for update`);
    const command = target(operation), actor = command.request.p_observed_actor_id;
    await beginCaller(actor);
    const pending = track(caller.query(command.sql));
    await waitForBlock(callerPid, holderPid);
    const assignment = change === "role" ? "role='technician'" : `organization_id='${foreignOrg}'`;
    await changer.query(`update public.user_profiles set ${assignment} where id='${actor}'`);
    await holder.query("rollback");
    const refused = json(await pending);
    assert.equal(refused.outcome, "refused"); assert.match(refused.error, /current named same-tenant/);
    await assertNoWrite(before);
    await caller.query("rollback; reset role");
    const originalProfile = originalProfiles.get(actor);
    await changer.query(`update public.user_profiles set role=${literal(originalProfile.role)},organization_id='${originalProfile.organization_id}' where id='${actor}'`);
    assert.deepEqual(await state(), before);
    console.log(`U2.08 ${phase} PASS ${new Date().toISOString()}`);
  }

  for (const operation of ["record","verify"]) {
    phase = `${operation.toUpperCase()}_RISK_VISIBILITY_REVOKED_DURING_ASSET_WAIT`;
    // An admin always reads restricted risks; use a still-authorized distinct
    // human engineering role for the verification sensitivity schedule.
    if (operation === "verify") await observer.query(`update public.user_profiles set role='reliability_engineer' where id='${reviewer}'`);
    const beforeVisibility = await state(), command = target(operation);
    await holder.query(`begin; select id from public.assets where id='${asset}' for update`);
    await beginCaller(command.request.p_observed_actor_id);
    const pendingVisibility = track(caller.query(command.sql));
    await waitForBlock(callerPid,holderPid);
    await changer.query(`update public.risks set information_sensitivity='restricted' where id='${risk}' and organization_id='${org}'`);
    const refusedActor = command.request.p_observed_actor_id;
    // Remove the synthetic stakeholder grant too, without fabricating origin history.
    await changer.query(`update public.risk_stakeholder_views set stakeholder_user_id=null where id='${stakeholder}'`);
    await holder.query("rollback");
    const refused = json(await pendingVisibility);
    assert.equal(refused.outcome,"refused"); assert.equal(refused.actor_id,refusedActor);
    assert.match(refused.error,/evidence|basis|visib|available/);
    await assertNoWrite(beforeVisibility);
    await caller.query("commit; reset role");
    await observer.query(`update public.risks set information_sensitivity=${literal(originalRiskSensitivity)} where id='${risk}' and organization_id='${org}';
      update public.risk_stakeholder_views set stakeholder_user_id='${author}' where id='${stakeholder}'`);
    if (operation === "verify") await observer.query(`update public.user_profiles set role=${literal(originalProfiles.get(reviewer).role)} where id='${reviewer}'`);
    console.log(`U2.08 ${phase} PASS ${new Date().toISOString()}`);
  }

  // Positive typed document/source/obligation admission remains UNIMPLEMENTED.
  // These are refusal tests, never substitutes for that full acceptance scope.
  for (const [name, changes, pattern] of [
    ["DOCUMENT_CLASS",{p_evidence_item_id:documentedEvidence},/document|standing|pending/],
    ["VERIFIED_AI",{p_evidence_item_id:aiEvidence},/non-AI|evidence/],
    ["DOWNTIME",{p_tolerable_downtime_hours:1},/obligation|unknown|pending/],
    ["RESTORATION_RANK",{p_restoration_rank:1},/obligation|unknown|pending/],
    ["NONFINITE_DOWNTIME",{p_tolerable_downtime_hours:"NaN"},/finite/],
    ["NEGATIVE_DOWNTIME",{p_tolerable_downtime_hours:-1},/finite|non-negative/],
    ["INVALID_RANK",{p_restoration_rank:0},/positive/],
  ]) {
    phase = `FAIL_CLOSED_${name}`;
    await expectRefusal(target("record",changes),pattern);
  }
  for (const operation of ["record","verify"]) {
    phase = `${operation.toUpperCase()}_AI_OPERATOR_IDENTITY_REFUSAL`;
    const actor = operation === "record" ? author : reviewer;
    await observer.query(`update public.user_profiles set role='ai_admin' where id='${actor}'`);
    await expectRefusal(target(operation),/named|independent|role|AI/);
    await observer.query(`update public.user_profiles set role=${literal(originalProfiles.get(actor).role)} where id='${actor}'`);
  }
  phase = "CURRENT_RESTRICTED_BASIS_NO_BLIND_REPLACEMENT";
  // Canonical can_read_risk grants stakeholder access even to restricted risks.
  // Remove that synthetic grant for BOTH unreadable-basis preconditions.
  await observer.query(`update public.risk_stakeholder_views set stakeholder_user_id=null where id='${stakeholder}' and organization_id='${org}'`);
  await observer.query(`update public.risks set information_sensitivity='restricted' where id='${risk}' and organization_id='${org}'`);
  await beginCaller();
  assert.equal((await caller.query(`select public.can_read_risk('${risk}')`)).at(-1),"f");
  const hidden = json(await caller.query(`select public.get_asset_service_level_editor('${author}','${org}','levels',null)`));
  assert(Array.isArray(hidden.rows)); assert(!hidden.rows.some(row => row.asset_id === asset));
  await caller.query("rollback; reset role");
  await expectRefusal(target("record",{p_evidence_item_id:publicEvidence}),/basis|evidence|unavailable|visibility/);
  phase = "CAPTURED_RESTRICTED_BASIS_SURVIVES_LIVE_REBIND";
  // Privileged synthetic rebind only. The captured risk must still constrain
  // replacement even after the live evidence row is no longer risk-linked.
  await observer.query(`update public.evidence_items set risk_id=null where id='${evidence}' and organization_id='${org}'`);
  await beginCaller();
  assert.equal((await caller.query(`select public.can_read_risk('${risk}')`)).at(-1),"f");
  const capturedHidden = json(await caller.query(`select public.get_asset_service_level_editor('${author}','${org}','levels',null)`));
  assert(Array.isArray(capturedHidden.rows)); assert(!capturedHidden.rows.some(row => row.asset_id === asset));
  await caller.query("rollback; reset role");
  await expectRefusal(target("record",{p_evidence_item_id:publicEvidence}),/basis|evidence|unavailable|visibility/);
  await observer.query(`update public.evidence_items set risk_id='${originalEvidenceRisk}' where id='${evidence}' and organization_id='${org}'`);
  await observer.query(`update public.risks set information_sensitivity=${literal(originalRiskSensitivity)} where id='${risk}' and organization_id='${org}'`);
  await observer.query(`update public.risk_stakeholder_views set stakeholder_user_id='${author}' where id='${stakeholder}' and organization_id='${org}'`);

  phase = "EVIDENCE_AMENDMENT_DURING_VERIFY_ASSET_WAIT";
  const before = await state();
  await holder.query(`begin; select id from public.assets where id='${asset}' for update`);
  await beginCaller(reviewer);
  const pendingReview = track(caller.query(target("verify").sql));
  await waitForBlock(callerPid, holderPid);
  // Privileged synthetic description mutation, NOT an audited correction rail.
  await changer.query(`set role service_role;
    update public.evidence_items set description=description||' Synthetic concurrent inspection correction.' where id='${evidence}';
    reset role`);
  await holder.query("rollback");
  const stale = json(await pendingReview);
  assert.equal(stale.outcome, "refused"); assert.match(stale.error, /no longer verified and applicable/);
  await assertNoWrite(before);
  await caller.query("rollback; reset role");
  assert.deepEqual(await state(), before);
  console.log(`U2.08 ${phase} PASS ${new Date().toISOString()}`);

  phase = "EXPLICIT_MANUAL_FRESH_BASIS_RETRY";
  await beginCaller();
  const fresh = target("record");
  const submitted = json(await caller.query(fresh.sql));
  assertReceipt(submitted, fresh);
  await caller.query("commit; reset role");
  const final = await state();
  assertTransition(initial, final, fresh);
  assert.deepEqual(final.approvals, initial.approvals);
  assert.deepEqual(final.workOrders, initial.workOrders);
  assert.deepEqual(final.history.slice(0, -1), initial.history);
  assert.equal(final.history.length, initial.history.length + 1);
  assert.equal(final.service.version, 6); assert.equal(final.service.status, "draft");
  assert.equal(final.service.tolerable_downtime_hours, null); assert.equal(final.service.restoration_rank, null);
  assert.deepEqual(final.history.at(-1).previous_state, initial.service);
  assert.deepEqual(final.history.at(-1).new_state, final.service);
  console.log(`U2.08 ${phase} PASS ${new Date().toISOString()}`);

  phase = "SAME_COMMAND_COMMITS_DURING_ASSET_WAIT";
  const command = randomUUID();
  await holder.query(`begin; select id from public.assets where id='${asset}' for update`);
  await beginCaller(author, true);
  const duplicate = target("record", {p_command_id:command,p_expected_version:6,p_service_name:"Different duplicate payload"});
  const waitingDuplicate = track(caller.query(duplicate.sql));
  await waitForBlock(callerPid, holderPid);
  await holder.query(`set local role authenticated; select set_config('request.jwt.claim.sub','${author}',true); select set_config('request.jwt.claims',${literal(JSON.stringify({ sub: author, role: "authenticated" }))},true)`);
  const original = target("record", {p_command_id:command,p_expected_version:6});
  const originalCommit = json(await holder.query(original.sql));
  assertReceipt(originalCommit, original);
  await holder.query("commit; reset role");
  const uncertain = json(await waitingDuplicate);
  assert.deepEqual(uncertain, { outcome: "unknown", command_id: command, actor_id: author, organization_id: org });
  const committedOriginal = await state();
  await assertNoWrite(committedOriginal);
  await assertRetained();
  await caller.query("rollback; reset role");
  const afterDuplicate = await state();
  assertTransition(final, afterDuplicate, original);
  assert.deepEqual(afterDuplicate.approvals, initial.approvals);
  assert.deepEqual(afterDuplicate.workOrders, initial.workOrders);
  assert.deepEqual(afterDuplicate.history.slice(0, -1), final.history);
  assert.equal(afterDuplicate.history.length, final.history.length + 1);
  assert.equal(afterDuplicate.service.version, 7);
  assert.deepEqual(afterDuplicate.history.at(-1).previous_state, final.service);
  assert.deepEqual(afterDuplicate.history.at(-1).new_state, afterDuplicate.service);
  assert.equal(afterDuplicate.history.at(-1).event_data.command_id, command);
  console.log(`U2.08 ${phase} PASS ${new Date().toISOString()}`);

  phase = "DUPLICATE_CROSS_ASSET_ACTOR_OPERATION_RECONCILIATION";
  for (const duplicate of [
    target("record",{p_command_id:command,p_asset_id:priorAsset,p_evidence_item_id:publicEvidence,p_expected_version:0}),
    target("record",{p_command_id:command,p_observed_actor_id:reviewer,p_expected_version:7}),
    target("verify",{p_command_id:command,p_expected_version:7}),
  ]) {
    const beforeDuplicate = await state();
    await beginCaller(duplicate.request.p_observed_actor_id);
    const unknown = json(await caller.query(duplicate.sql));
    assert.deepEqual(unknown,{outcome:"unknown",command_id:command,actor_id:duplicate.request.p_observed_actor_id,organization_id:org});
    await assertNoWrite(beforeDuplicate);
    const reconciled = json(await caller.query(`select public.get_asset_service_level_command('${command}','${duplicate.request.p_observed_actor_id}','${org}')`));
    if (duplicate.request.p_observed_actor_id === author) assertReceipt(reconciled,original);
    else assert.deepEqual(reconciled,unknown); // Another actor's receipt remains invisible.
    await caller.query("commit; reset role");
    assert.deepEqual(await state(),beforeDuplicate);
  }
  console.log(`U2.08 ${phase} PASS ${new Date().toISOString()}`);
  phase = "SAME_COMMAND_CROSS_ASSET_CROSS_ACTOR_UNIQUE_RECEIPT_RACE";
  const beforeRace = await state(), sharedCommand = randomUUID();
  await holder.query(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${author}',true);
    select set_config('request.jwt.claims',${literal(JSON.stringify({sub:author,role:"authenticated"}))},true)`);
  const winner = target("record",{p_expected_version:beforeRace.service.version,p_command_id:sharedCommand});
  assertReceipt(json(await holder.query(winner.sql)),winner);
  await beginCaller(reviewer);
  const loser = target("record",{p_asset_id:priorAsset,p_expected_version:0,p_evidence_item_id:publicEvidence,p_command_id:sharedCommand,p_observed_actor_id:reviewer});
  const loserPending = track(caller.query(loser.sql));
  // Different asset/evidence: this observed wait is receipt-index contention,
  // not the already-covered same-asset input serialization.
  await waitForBlock(callerPid,holderPid);
  await holder.query("commit; reset role");
  assert.deepEqual(json(await loserPending),{outcome:"unknown",command_id:sharedCommand,actor_id:reviewer,organization_id:org});
  const committedRace = await state();
  assertTransition(beforeRace,committedRace,winner);
  await assertNoWrite(committedRace);
  assert.equal((await probe.query(`begin; select id from public.assets where id='${priorAsset}' for update nowait`)).at(-1),priorAsset);
  assert.equal((await probe.query(`select id from public.evidence_items where id='${publicEvidence}' for update nowait`)).at(-1),publicEvidence);
  await probe.query("rollback");
  await caller.query("commit; reset role");
  assert.deepEqual(await state(),committedRace);
  console.log(`U2.08 ${phase} PASS ${new Date().toISOString()}`);
  phase = "SAME_COMMAND_RECORD_VERIFY_CROSS_OPERATION_ASSET_WAIT";
  const beforeOperationRace = await state(), operationCommand = randomUUID();
  await holder.query(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${author}',true);
    select set_config('request.jwt.claims',${literal(JSON.stringify({sub:author,role:"authenticated"}))},true)`);
  const recordWinner = target("record",{p_expected_version:beforeOperationRace.service.version,p_command_id:operationCommand});
  assertReceipt(json(await holder.query(recordWinner.sql)),recordWinner);
  await beginCaller(reviewer,true);
  const verifyLoser = target("verify",{p_expected_version:beforeOperationRace.service.version,p_command_id:operationCommand});
  const crossOperationPending = track(caller.query(verifyLoser.sql));
  await waitForBlock(callerPid,holderPid);
  await holder.query("commit; reset role");
  assert.deepEqual(json(await crossOperationPending),{outcome:"unknown",command_id:operationCommand,actor_id:reviewer,organization_id:org});
  const afterOperationRace = await state();
  assertTransition(beforeOperationRace,afterOperationRace,recordWinner);
  await assertNoWrite(afterOperationRace);
  await assertRetained(reviewer);
  await caller.query("commit; reset role");
  assert.deepEqual(await state(),afterOperationRace);
  console.log(`U2.08 ${phase} PASS ${new Date().toISOString()}`);
  await successfulFence("record");
  await successfulFence("verify");
  await derivedMatrix();

  phase = "ERROR_PATH_PENDING_SESSION_CLEANUP";
  const beforeFailure = await state();
  const failureHolder = session("cleanup-holder"), failureCaller = session("cleanup-caller");
  await failureHolder.query(`begin; select id from public.assets where id='${priorAsset}' for update`);
  const holdingPid = Number((await failureHolder.query("select pg_backend_pid()")).at(-1));
  const waitingPid = Number((await failureCaller.query("begin; select pg_backend_pid()")).at(-1));
  const abandoned = track(failureCaller.query(`select id from public.assets where id='${priorAsset}' for update`));
  await waitForBlock(waitingPid,holdingPid);
  await failureCaller.close(); // Deliberately interrupt a pending query, not a customer request.
  const settled = await Promise.allSettled([abandoned]);
  assert.equal(settled[0].status,"rejected");
  await failureHolder.close();
  assert.equal((await probe.query(`begin; select id from public.assets where id='${priorAsset}' for update nowait; rollback`)).at(-1),priorAsset);
  assert.deepEqual(await state(),beforeFailure);
  console.log(`U2.08 ${phase} PASS ${new Date().toISOString()}`);
  console.log("U2.08 bounded native matrix completed; full document/source/quarantine/supersession/primary-obligation positive standing and real browser qualification remain PENDING");
} catch (error) {
  console.error(`U2.08 concurrent PostgreSQL qualification FAILED: ${phase}${error?.sqlState ? ` SQLSTATE=${error.sqlState}` : ""}`);
  process.exitCode = 1;
} finally {
  // Release every test participant before restoring profile, including failures
  // during an inverse wait; a still-held profile lock must not block cleanup.
  await Promise.allSettled(sessions.filter(handle => handle !== observer).map(handle => handle.close()));
  await Promise.allSettled([...inFlight]);
  // Fixture profile mutations must not survive a failed barrier schedule.
  // Restore ONLY the exact synthetic CI member, never delete/rewind audit.
  for (const [actor, originalProfile] of originalProfiles) {
    try { await observer.query(`update public.user_profiles set role=${literal(originalProfile.role)},organization_id='${originalProfile.organization_id}' where id='${actor}'`); }
    catch { process.exitCode = 1; }
  }
  if (originalEvidenceRisk) {
    try { await observer.query(`update public.evidence_items set risk_id='${originalEvidenceRisk}' where id='${evidence}' and organization_id='${org}'`); }
    catch { process.exitCode = 1; }
  }
  if (originalRiskSensitivity) {
    try { await observer.query(`update public.risks set information_sensitivity=${literal(originalRiskSensitivity)} where id='${risk}' and organization_id='${org}'`); }
    catch { process.exitCode = 1; }
  }
  if (author) {
    try { await observer.query(`update public.risk_stakeholder_views set stakeholder_user_id='${author}' where id='${stakeholder}' and organization_id='${org}'`); }
    catch { process.exitCode = 1; }
  }
  if (derivedFixtureReady) {
    // Restore only our synthetic controls after EVERY participant has settled.
    // No delete, audit rewrite or false governing correction receipt.
    try { await observer.query(`update public.risks set information_sensitivity='public' where id='${derived.grandparent}' and organization_id='${org}';
      update public.evidence_items set risk_id='${derived.child}' where id='${derived.evidence}' and organization_id='${org}'`); }
    catch { process.exitCode = 1; }
  }
  await observer.close();
}
