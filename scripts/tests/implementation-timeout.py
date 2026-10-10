"""Exact native migration, PostgreSQL 17, disposable loopback databases only.

Use the same per-file transaction boundary as CLI 2.84.2 ExecBatch, including a
synthetic history insert. Delays are test statements, not production SQL changes.
Exercise the actual 2s/30s/60s budgets rather than replacing their values.
"""
import json
import os
from pathlib import Path
import subprocess
import time

if os.environ.get("PGHOST") != "127.0.0.1" or os.environ.get("PGDATABASE") not in {
    "implementation_fixture", "implementation_test"
}:
    raise SystemExit("Refusing: fixed disposable loopback fixture only")

root = Path(__file__).resolve().parents[2]
migration = root / "supabase/migrations/20270103140000_native_implementation_journey.sql"
fixture = root / "scripts/tests/implementation-fixture.sql"
base = ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-At"]


def run(args, env=os.environ, timeout=10, expected=True):
    result = subprocess.run(args, env=env, text=True, capture_output=True, timeout=timeout)
    if expected and result.returncode:
        raise AssertionError(result.stderr)
    return result


version = int(run(base + ["-c", "show server_version_num"]).stdout.strip())
assert 170000 <= version < 180000, "This migration contract requires PostgreSQL 17"

results = {"server_version_num": version}
for case in ("lock", "statement", "transaction", "success"):
    database = "implementation_timeout_" + case
    # Create must succeed: never delete/reuse an existing database by this name.
    run(["createdb", database])
    env = {**os.environ, "PGDATABASE": database}
    holder = None
    try:
        run(base + ["-f", str(fixture), "-c", "create table test_migration_history(version text primary key);"], env)
        if case == "lock":
            holder = subprocess.Popen(base + ["-c", "begin; lock table deployment_instances in access share mode; select pg_sleep(6); commit;"],
                env={**env, "PGAPPNAME": "implementation_timeout_holder"}, text=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            deadline = time.monotonic() + 4
            while True:
                witnessed = run(base + ["-c", "select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='implementation_timeout_holder' and l.granted and l.relation='deployment_instances'::regclass and l.mode='AccessShareLock')"], env).stdout.strip()
                if witnessed == "t":
                    break
                assert time.monotonic() < deadline, "actual lock holder was not observed"
                time.sleep(0.05)

        delays = {"lock": "select 1;", "statement": "select pg_sleep(31);",
                  "transaction": "select pg_sleep(20);" * 4, "success": "select 1;"}
        before = run(base + ["-c", "select json_build_array(current_setting('lock_timeout'),current_setting('statement_timeout'),current_setting('transaction_timeout'));"], env).stdout.strip()
        started = time.monotonic()
        # Explicit BEGIN/COMMIT models the verified pgconn per-file batch. The
        # history witness is committed with the exact migration, never before it.
        result = run(base + ["-c", "begin;", "-f", str(migration), "-c", delays[case],
            "-c", "insert into test_migration_history values('20270103140000'); commit; select json_build_array(current_setting('lock_timeout'),current_setting('statement_timeout'),current_setting('transaction_timeout'));"],
            env, timeout=75, expected=case == "success")
        elapsed = time.monotonic() - started
        if case == "success":
            assert result.stdout.strip().endswith(before), "LOCAL budgets leaked after commit in the same session"
        else:
            assert result.returncode, "expected timeout was absent"
            assert {"lock": "lock timeout", "statement": "statement timeout", "transaction": "transaction timeout"}[case] in result.stderr, result.stderr
            minimum, maximum = {"lock": (1.8, 4), "statement": (28, 40), "transaction": (58, 70)}[case]
            assert minimum <= elapsed < maximum, (case, elapsed)
            witness = run(base + ["-c", """select json_build_object(
 'columns',(select count(*) from information_schema.columns where table_schema='public' and table_name='deployment_instances' and column_name in ('implementation','implementation_billing_id')),
 'indexes',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('deployment_implementation_purchase_uq','audit_events_implementation_command_uq')),
 'functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='command_implementation'),
 'history',(select count(*) from test_migration_history));"""], env).stdout.strip()
            assert all(value == 0 for value in json.loads(witness).values()), witness
            assert run(base + ["-c", "select count(*) from pg_locks where relation in ('deployment_instances'::regclass,'audit_events'::regclass,'billing_subscriptions'::regclass) and mode in ('AccessExclusiveLock','ShareLock','ShareRowExclusiveLock');"], env).stdout.strip() == "0"
        results[case] = {"seconds": round(elapsed, 2), "rollback_or_local_restore_verified": True}
        print(case, results[case], flush=True)
    finally:
        if holder is not None:
            if holder.poll() is None:
                holder.terminate()
            holder.communicate(timeout=8)
        run(["dropdb", database])
print(json.dumps(results, sort_keys=True), flush=True)
