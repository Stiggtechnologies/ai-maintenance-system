// Actual concurrent PostgreSQL sessions; synthetic identities, never production proof.
// Run after the isolated bootstrap/migration/history/revision fixtures. Records are retained.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { userInfo } from "node:os";

const [marker, host, port, database, fixtureConnector, fixtureKey] =
  process.argv.slice(2);
const ci = marker === "--ci-clock-fixture";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
if (ci) {
  assert.equal(
    process.env.GITHUB_ACTIONS,
    "true",
    "CI fixtures never run against production",
  );
  assert.equal(host, "127.0.0.1");
  assert.equal(port, "54322");
  assert.equal(database, "postgres");
  assert.match(fixtureConnector ?? "", uuid);
  assert.match(fixtureKey ?? "", /^e12-time-local-[0-9a-f-]{36}$/);
} else {
  assert.equal(marker, "--disposable-clock-fixture");
  assert.match(host ?? "", /^\/private\/tmp\/syncai-clock-pg\.[A-Za-z0-9]+$/);
  assert.match(database ?? "", /^clock_[a-z0-9_]+$/);
}
assert.match(port ?? "", /^[0-9]{1,5}$/);
assert(Number(port) > 0 && Number(port) <= 65535);
const sessions = [];
function session(name) {
  const child = spawn(
    "psql",
    [
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-h",
      host,
      "-p",
      port,
      "-U",
      ci ? "postgres" : userInfo().username,
      "-d",
      database,
      "-c",
      `set application_name='clock-concurrency-${name}'`,
      "-f",
      "-",
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: ci ? { ...process.env, PGPASSWORD: "postgres" } : process.env,
    },
  );
  let pending;
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (!pending) return;
    if (line === pending.marker) {
      const done = pending;
      pending = undefined;
      clearTimeout(done.timer);
      done.resolve(done.lines);
    } else pending.lines.push(line);
  });
  child.on("error", (error) => pending?.reject(error));
  child.on("exit", (code) => {
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`psql ${name} exited ${code}: ${errors}`));
      pending = undefined;
    }
  });
  const handle = {
    query(sql) {
      assert.equal(pending, undefined, "one query per session at a time");
      return new Promise((resolve, reject) => {
        const end = `CLOCK_END_${randomUUID()}`;
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`bounded PostgreSQL witness timed out: ${name}`));
        }, 15000);
        pending = { marker: end, timer, lines: [], resolve, reject };
        child.stdin.write(`${sql};\nselect '${end}';\n`);
      });
    },
    close() {
      child.stdin.end();
    },
  };
  sessions.push(handle);
  return handle;
}
const org = ci
  ? "11111111-1111-1111-1111-111111111111"
  : "11111111-1111-4111-8111-111111111111";
const connector = ci
  ? fixtureConnector
  : "33333333-3333-4333-8333-333333333333";
const sourceKey = ci ? fixtureKey : "local";
let human;
const identity = () =>
  ci
    ? `select set_config('request.jwt.claims','{"sub":"${human}","role":"authenticated"}',false)`
    : `select set_config('test.org','${org}',false),
  set_config('test.uid','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false),
  set_config('test.profile_role','admin',false)`;
const configure = (
  label,
  intent = randomUUID(),
  target = connector,
) => `${ci ? `set role authenticated; ${identity()}` : "select set_config('test.jwt_role','authenticated',false)"};
  select configure_connector_time_assurance('${target}','ntp',
    'Synthetic concurrent reference ${label}',5,10,'SYNTHETIC-CLOCK-${label}',
    'Concurrent disposable fixture only; engineering approval is not claimed.','${intent}')`;
const observe = (
  delivery,
  revision,
) => `${ci ? "set role service_role; select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)" : "select set_config('test.jwt_role','service_role',false)"};
  select record_connector_time_observation('${org}','${sourceKey}','${delivery}',
    t.ref,t.ref,0,0,'SYNTHETIC-CONCURRENT-OBSERVATION',repeat('9',64),${revision})
    from (select clock_timestamp() ref) t`;
const json = (lines) => JSON.parse(lines.at(-1));

try {
  const monitor = session("monitor");
  // Reject application/GoTrue databases and TCP-enabled clusters before writes.
  const guard = await monitor.query(`select (${
    ci
      ? "to_regclass('auth.users') is not null and pg_get_functiondef('auth.uid()'::regprocedure) not like '%test.uid%'"
      : "to_regclass('auth.users') is null and pg_get_functiondef('auth.uid()'::regprocedure) like '%test.uid%' and current_setting('listen_addresses')=''"
  }
    and exists(select 1 from connectors where id='${connector}'
      and organization_id='${org}' and connector_key='${sourceKey}'
      and time_assurance_revision > 0))::text`);
  assert.equal(
    guard.at(-1),
    "true",
    "only an explicitly guarded synthetic fixture is allowed",
  );
  if (ci) {
    human = (
      await monitor.query(
        `select time_configured_by from connectors where id='${connector}'`,
      )
    ).at(-1);
    assert.match(human, uuid);
  }
  await monitor.query(identity());
  const first = session("first");
  const second = session("second");
  await first.query(identity());
  await second.query(identity());
  const firstPid = Number(
    (await first.query("select pg_backend_pid()")).at(-1),
  );
  const secondPid = Number(
    (await second.query("select pg_backend_pid()")).at(-1),
  );
  const revision = Number(
    (
      await monitor.query(
        `select time_assurance_revision from connectors where id='${connector}'`,
      )
    ).at(-1),
  );
  const count = Number(
    (
      await monitor.query(
        `select count(*) from connector_time_observations where connector_id='${connector}'`,
      )
    ).at(-1),
  );
  const suffix = randomUUID();
  async function assertBlocked() {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const state = (
        await monitor.query(
          `select ${firstPid}=any(pg_blocking_pids(${secondPid}))`,
        )
      ).at(-1);
      if (state === "t") return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail(
      "competing governed RPC never waited on the shared connector lock",
    );
  }

  // Configuration wins: a measurement already naming the old revision must wait,
  // then be refused after commit, even though its delivery ID is entirely new.
  await first.query("begin");
  const configured = json(
    await first.query(configure(`CONFIG-WINS-${suffix}`)),
  );
  assert.equal(configured.configuration_revision, revision + 1);
  const delayed = second.query(
    observe(`concurrent-delayed-${suffix}`, revision),
  );
  delayed.catch(() => {}); // Retain the rejection for await without an unhandled race on test failure.
  await assertBlocked();
  await first.query("commit");
  const refused = json(await delayed);
  assert.equal(
    typeof refused.error,
    "string",
    `configuration won but the older measurement was accepted: ${JSON.stringify(refused)}`,
  );
  assert.match(refused.error, /superseded clock-contract revision/);
  assert.equal(
    Number(
      (
        await monitor.query(
          `select count(*) from connector_time_observations where connector_id='${connector}'`,
        )
      ).at(-1),
    ),
    count,
  );

  // Observation wins: accept the original declared revision and retain it. The
  // waiting reconfiguration may not reinterpret it as evidence for its new revision.
  await first.query("begin");
  const delivery = `concurrent-observation-wins-${suffix}`;
  const measured = json(await first.query(observe(delivery, revision + 1)));
  assert.equal(measured.configuration_revision, revision + 1);
  assert.equal(measured.state, "synchronized");
  assert.equal(measured.eligible_for_time_sensitive_evidence, false);
  const competing = second.query(configure(`OBS-WINS-${suffix}`));
  competing.catch(() => {});
  await assertBlocked();
  await first.query("commit");
  assert.equal(json(await competing).configuration_revision, revision + 2);
  assert.equal(
    Number(
      (
        await monitor.query(`select configuration_revision
    from connector_time_observations where connector_id='${connector}'
    and delivery_id='${delivery}'`)
      ).at(-1),
    ),
    revision + 1,
  );
  const posture = json(
    await monitor.query("select get_connector_time_assurance()"),
  );
  const row = posture.connectors.find(
    (value) => value.connectorId === connector,
  );
  assert.equal(row.configurationRevision, revision + 2);
  assert.equal(row.state, "unproven");
  assert.equal(row.observationId, null);
  assert.equal(row.eligibleForTimeSensitiveEvidence, false);
  assert.equal(
    Number(
      (
        await monitor.query(
          `select count(*) from connector_time_observations where connector_id='${connector}'`,
        )
      ).at(-1),
    ),
    count + 1,
  );
  // Two connectors share a tenant operation namespace. The competing intent
  // must wait on the same key BEFORE it can lock/change its own connector.
  const other = randomUUID();
  const otherKey = `e12-intent-concurrency-${randomUUID()}`;
  await monitor.query(
    ci
      ? `insert into connectors(id,organization_id,connector_key,name,connector_type,system_kind,status,enabled,direction,write_enabled)
        values('${other}','${org}','${otherKey}','Synthetic intent competitor','OPC-UA','historian','active',true,'read_only',false)`
      : `insert into connectors(id,organization_id,connector_key,name) values('${other}','${org}','${otherKey}','Synthetic intent competitor')`,
  );
  const intent = randomUUID();
  const nextRevision = revision + 3;
  await first.query("begin");
  const original = json(
    await first.query(configure(`INTENT-${suffix}`, intent)),
  );
  assert.equal(original.configuration_revision, nextRevision);
  const collision = second.query(configure(`INTENT-${suffix}`, intent, other));
  collision.catch(() => {});
  await assertBlocked();
  await first.query("commit");
  assert.match(
    json(await collision).error,
    /different actor, connector or contract/,
  );
  assert.equal(
    (
      await monitor.query(
        `select time_assurance_revision from connectors where id='${other}'`,
      )
    ).at(-1),
    "0",
  );
  assert.equal(
    (
      await monitor.query(`select count(*) from audit_events where organization_id='${org}'
    and entity_type='connector_time_assurance_configuration' and event_data->>'idempotency_key'='${intent}'`)
    ).at(-1),
    "1",
  );
  const retried = json(
    await second.query(configure(`INTENT-${suffix}`, intent)),
  );
  assert.equal(retried.replay, true);
  assert.equal(retried.audit_id, original.audit_id);
  assert.equal(retried.configuration_revision, nextRevision);
  // A reserved but rolled-back intent is not a recorded action. A waiting exact
  // retry can commit ONCE, rather than returning a nonexistent receipt.
  const rollbackIntent = randomUUID();
  await first.query("begin");
  const aborted = json(
    await first.query(configure(`ROLLBACK-${suffix}`, rollbackIntent)),
  );
  const waiting = second.query(configure(`ROLLBACK-${suffix}`, rollbackIntent));
  waiting.catch(() => {});
  await assertBlocked();
  await first.query("rollback");
  const committed = json(await waiting);
  assert.equal(committed.replay, false);
  assert.equal(committed.configuration_revision, nextRevision + 1);
  assert.notEqual(committed.audit_id, aborted.audit_id);
  assert.equal(
    (
      await monitor.query(`select count(*) from audit_events where organization_id='${org}'
    and entity_type='connector_time_assurance_configuration' and event_data->>'idempotency_key'='${rollbackIntent}'`)
    ).at(-1),
    "1",
  );
  // Current authority is checked again AFTER a waiting replay acquires locks.
  // The CI service fixture respects the canonical profile pin (auth.uid=NULL).
  const profileActor = ci ? human : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const serviceProfileIdentity = ci
    ? "select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)"
    : "select set_config('test.uid','',false)";
  await first.query("begin");
  assert.equal(
    json(await first.query(configure(`INTENT-${suffix}`, intent))).replay,
    true,
  );
  const waitingReplay = second.query(configure(`INTENT-${suffix}`, intent));
  waitingReplay.catch(() => {});
  let authorityTransactionOpen = true;
  try {
    await assertBlocked();
    await monitor.query(`${serviceProfileIdentity};
      do $$ begin assert auth.uid() is null; end $$;
      update user_profiles set role='planner' where id='${profileActor}';
      select role from user_profiles where id='${profileActor}'`);
    assert.equal(
      (
        await monitor.query(
          `select role from user_profiles where id='${profileActor}'`,
        )
      ).at(-1),
      "planner",
    );
    await first.query("commit");
    authorityTransactionOpen = false;
    const noAuthority = json(await waitingReplay);
    assert.match(
      noAuthority.error,
      /authorization changed while configuration waited for serialization/,
    );
    assert.equal(
      (
        await monitor.query(
          `select time_assurance_revision from connectors where id='${connector}'`,
        )
      ).at(-1),
      String(nextRevision + 1),
    );
  } finally {
    if (authorityTransactionOpen) await first.query("rollback");
    await monitor.query(`${serviceProfileIdentity};
      update user_profiles set role='admin' where id='${profileActor}'`);
    await monitor.query(identity());
  }
  console.log(
    "Concurrent configuration/observation, cross-connector intent, exact replay, rollback-retry and post-wait authority assertions passed; no collector, approved evidence or production qualification claimed.",
  );
} finally {
  for (const handle of sessions) handle.close();
}
