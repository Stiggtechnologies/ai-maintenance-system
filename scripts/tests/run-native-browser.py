"""Run against a fresh local stack using its existing public demo seed fixtures.

No credential is created, embedded, printed, or retained in browser traces.
The canonical repository seed remains the sole fixture definition.
"""
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlparse


def required(match, name):
    if not match:
        raise SystemExit(f"Disposable fixture unavailable: {name}")
    return match.group(1)


root = Path(__file__).resolve().parents[2]
status = subprocess.run(
    ["supabase", "status", "-o", "json"], cwd=root,
    capture_output=True, text=True,
)
if status.returncode:
    raise SystemExit("Disposable local Supabase status unavailable")
try:
    values = json.loads(status.stdout)
    database = urlparse(values["DB_URL"])
    if values["API_URL"] != "http://127.0.0.1:54321" or (
        database.hostname != "127.0.0.1" or database.port != 54322
        or database.username != "postgres" or database.path != "/postgres"
    ):
        raise SystemExit("Refusing non-loopback disposable fixture")
    anon = values["ANON_KEY"]
    password = database.password
except (KeyError, ValueError):
    raise SystemExit("Disposable local Supabase fixture metadata unavailable") from None
if not anon or not password:
    raise SystemExit("Disposable fixture credentials unavailable")
demo = (root / "supabase/migrations/00000000000004_demo_seed.sql").read_text()
personas = (root / "supabase/migrations/00000000000016_persona_accounts.sql").read_text()
admin = required(re.search(r"extensions\.crypt\('([^']+)'", demo), "admin seed")
reviewer = required(
    re.search(r"'manager@syncai\.ca',\s*'([^']+)'", personas), "reviewer seed"
)
environment = {
    **os.environ,
    "E2E_SUPABASE_URL": values["API_URL"],
    "E2E_SUPABASE_ANON_KEY": anon,
    "E2E_FIXTURE_DB_PASSWORD": password,
    "E2E_FIXTURE_ADMIN_PASSWORD": admin,
    "E2E_FIXTURE_REVIEWER_PASSWORD": reviewer,
}
raise SystemExit(subprocess.run(
    ["npx", "playwright", "test", "tests/e2e/native-implementation.spec.ts"],
    cwd=root, env=environment,
).returncode)
