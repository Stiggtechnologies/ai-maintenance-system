"""Two actual PostgreSQL sessions; fixed disposable loopback fixture only."""
import os
import subprocess
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
