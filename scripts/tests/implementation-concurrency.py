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
# Prove finite acquisition, rollback, caller-budget preservation and safe retry.
billing = "10000000-0000-4000-8000-000000000003"
query("""begin; set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select command_implementation(gen_random_uuid(),'%s',
 (select id from deployment_instances where implementation_billing_id='%s'),0,'configure',
 '{"assets":[{"assetId":"20000000-0000-4000-8000-000000000001","templateId":"30000000-0000-4000-8000-000000000001","mappingEvidenceId":"40000000-0000-4000-8000-000000000001"}],"runIds":[]}');
commit;""" % (billing, billing))
holder = subprocess.Popen(
    ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c",
     "begin; lock table asset_twin_instances in row exclusive mode; select pg_sleep(8); commit;"],
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
    command_id = "50000000-0000-4000-8000-000000000001"
    prepare_sql = """select command_implementation('%s','%s',
 (select id from deployment_instances where implementation_billing_id='%s'),1,'prepare','{}');""" % (command_id, billing, billing)

    def bounded_refusal(caller_budget, minimum, maximum):
        started = time.monotonic()
        output = query("""begin; set role authenticated; set local lock_timeout='%s';
set local statement_timeout='8s';
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $test$ begin
 begin
  %s
  raise exception 'acquisition unexpectedly succeeded';
 exception when lock_not_available then null;
 end;
 perform test_assert(current_setting('lock_timeout')='%s','caller lock budget restored on timeout');
 perform test_assert(current_setting('statement_timeout')='8s','outer statement budget untouched');
end $test$;
select test_assert((select implementation->>'phase' from deployment_instances where implementation_billing_id='%s')='planning','timeout retains planning phase');
select test_assert((select implementation->>'revision' from deployment_instances where implementation_billing_id='%s')='1','timeout retains revision');
select test_assert(not exists(select 1 from audit_events where event_data->>'commandId'='%s'),'timeout cannot manufacture receipt');
select test_assert(current_setting('lock_timeout')='%s','later statement in same pooled session retains caller budget');
commit;""" % (caller_budget, prepare_sql.replace('select command_', 'perform command_'), caller_budget, billing, billing, command_id, caller_budget))
        elapsed = time.monotonic() - started
        assert minimum <= elapsed < maximum, (caller_budget, elapsed, output)
        return elapsed

    long_budget_elapsed = bounded_refusal('7s', 1.8, 4)
    short_budget_elapsed = bounded_refusal('250ms', 0.20, 1.5)
    output, error = holder.communicate(timeout=10)
    assert holder.returncode == 0, error
    # The exact same command has no retained receipt after acquisition failure.
    output = query("""begin; set role authenticated; set local lock_timeout='7s';
set local statement_timeout='8s';
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
%s
select test_assert(current_setting('lock_timeout')='7s','caller budget restored after success');
select test_assert(current_setting('statement_timeout')='8s','success retains outer request deadline');
commit;
show lock_timeout;""" % prepare_sql)
    assert '"phase": "prepared"' in output
    assert output.strip().endswith('0'), output
    assert query("select count(*) from asset_twin_instances").strip() == "1"
    assert query("select count(*) from audit_events where event_data->>'commandId'='%s'" % command_id).strip() == "1"
finally:
    if holder.poll() is None:
        holder.terminate()
    holder.communicate(timeout=5)
print("Preparation acquisition bounded to %.2fs, stricter caller preserved at %.2fs; settings restored and same-intent retry retained one twin/receipt" % (long_budget_elapsed, short_budget_elapsed))

# An outer statement timeout is set BEFORE the RPC statement begins. Cancellation
# must roll back the fixture onboarding write and leave no new receipt/revision.
query("""begin; set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select command_implementation(gen_random_uuid(),'%s',
 (select id from deployment_instances where implementation_billing_id='%s'),2,'configure',
 '{"assets":[{"assetId":"20000000-0000-4000-8000-000000000001","templateId":"30000000-0000-4000-8000-000000000001","mappingEvidenceId":"40000000-0000-4000-8000-000000000001"}],"runIds":[]}');
commit;""" % (billing, billing))
cancelled_id = "50000000-0000-4000-8000-000000000002"
cancelled_prepare = """select command_implementation('%s','%s',
 (select id from deployment_instances where implementation_billing_id='%s'),3,'prepare','{}');""" % (cancelled_id, billing, billing)
started = time.monotonic()
query("""begin; set role authenticated; set local lock_timeout='7s';
set local statement_timeout='250ms';
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select set_config('test.delay_onboarding','on',true);
do $test$ begin
 begin
  %s
  raise exception 'outer deadline did not cancel preparation';
 exception when query_canceled then null;
 end;
 perform test_assert(current_setting('lock_timeout')='7s','lock budget restored before outer cancellation');
 perform test_assert(current_setting('statement_timeout')='250ms','outer deadline was never widened');
 perform test_assert(not exists(select 1 from asset_onboarding_items where requirement_key='timeout_fixture'),'cancelled preparation write rolled back');
end $test$;
select test_assert((select implementation->>'revision' from deployment_instances where implementation_billing_id='%s')='3','cancelled RPC retains revision');
select test_assert(not exists(select 1 from audit_events where event_data->>'commandId'='%s'),'cancelled RPC retains no false receipt');
commit;""" % (cancelled_prepare.replace('select command_', 'perform command_'), billing, cancelled_id))
elapsed = time.monotonic() - started
assert 0.20 <= elapsed < 1.5, elapsed
output = query("""begin; set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
%s
commit;""" % cancelled_prepare)
assert '"phase": "prepared"' in output
assert query("select count(*) from asset_twin_instances").strip() == "1"
print("Outer statement deadline cancelled at %.2fs, rolled back onboarding writes, and allowed the exact intent to resume" % elapsed)
