"""Two actual PostgreSQL sessions; fixed disposable loopback fixture only."""
import os
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor

if os.environ.get("PGHOST") != "127.0.0.1" or os.environ.get("PGDATABASE") not in {"implementation_fixture", "implementation_test"}:
    raise SystemExit("Refusing: only the fixed disposable loopback implementation fixture is allowed")

def query(sql):
    result = subprocess.run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout

query("""insert into billing_subscriptions(id,organization_id,plan,status,billing_source,current_period_end)
values('10000000-0000-4000-8000-000000000003','22222222-2222-4222-8222-222222222222','fixture','active','direct',now()+interval '1 day');""")

def start(_):
    return query("""begin; set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select command_implementation(gen_random_uuid(),'10000000-0000-4000-8000-000000000003',null,0,'start','{"outcome":"Concurrent fixture outcome"}');
select pg_sleep(0.5); commit;""")

with ThreadPoolExecutor(max_workers=2) as executor:
    results = list(executor.map(start, [0, 1]))
assert all('instanceId' in result for result in results)
query("""select test_assert((select count(*) from deployment_instances where implementation_billing_id='10000000-0000-4000-8000-000000000003')=1,'concurrent starts retain one canonical journey');
select test_assert((select count(*) from audit_events where entity_type='implementation_command' and event_data->'request'->>'billingId'='10000000-0000-4000-8000-000000000003')=2,'both concurrent callers get retained receipts');""")
print("Concurrent duplicate starts passed in two actual PostgreSQL sessions")

# The bounded preparation pass intentionally serializes legacy compiler writes.
# Prove it waits for a competing writer and continues after that transaction ends.
billing = "10000000-0000-4000-8000-000000000003"
query("""begin; set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select command_implementation(gen_random_uuid(),'%s',
 (select id from deployment_instances where implementation_billing_id='%s'),0,'configure',
 '{"assets":[{"assetId":"20000000-0000-4000-8000-000000000001","templateId":"30000000-0000-4000-8000-000000000001","mappingEvidenceId":"40000000-0000-4000-8000-000000000001"}],"runIds":[]}');
commit;""" % (billing, billing))
holder = subprocess.Popen(
    ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c",
     "begin; lock table asset_twin_instances in row exclusive mode; select pg_sleep(5); commit;"],
    env={**os.environ, "PGAPPNAME": "implementation_fixture_writer"},
    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
)


def observed(sql):
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        if query(sql).strip() == "t":
            return
        time.sleep(0.05)
    raise AssertionError("Expected actual database lock witness was not observed")


try:
    observed("""select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid
      where a.application_name='implementation_fixture_writer' and l.granted
      and l.relation='asset_twin_instances'::regclass and l.mode='RowExclusiveLock')""")
    preparer = subprocess.Popen(
        ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", """begin; set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select command_implementation(gen_random_uuid(),'%s',
 (select id from deployment_instances where implementation_billing_id='%s'),1,'prepare','{}');
commit;""" % (billing, billing)],
        env={**os.environ, "PGAPPNAME": "implementation_fixture_preparer"},
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
        observed("""select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid
          where a.application_name='implementation_fixture_preparer' and not l.granted
          and l.relation='asset_twin_instances'::regclass and l.mode='ShareRowExclusiveLock')""")
        assert query("select implementation->>'phase' from deployment_instances where implementation_billing_id='%s'" % billing).strip() == "planning"
        output, error = preparer.communicate(timeout=10)
        assert preparer.returncode == 0, error
        assert '"phase": "prepared"' in output
        assert query("select count(*) from asset_twin_instances").strip() == "1"
    finally:
        if preparer.poll() is None:
            preparer.terminate()
            preparer.communicate(timeout=5)
finally:
    if holder.poll() is None:
        holder.terminate()
    holder.communicate(timeout=5)
print("Preparation waited for actual competing compiler-table writer and resumed without duplicate twins")
