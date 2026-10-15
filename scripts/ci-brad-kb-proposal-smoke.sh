#!/usr/bin/env bash
set -Eeuo pipefail
# Proposal qualification only: local disposable CI database, one rolled-back
# transaction. This never copies proposal SQL into the active migration chain.
test "${GITHUB_ACTIONS:-}" = true || { echo 'This full-chain probe requires disposable GitHub Actions CI.' >&2; exit 1; }
test -f docs/qa/kb-security-integration-proposal-v2.patch
python3 - <<'PY' > /tmp/brad-kb-proposal-qualification.sql
from pathlib import Path
print("begin; set local statement_timeout='120s';")
print(Path('scripts/fixtures/brad-kb-proposal-seed.sql').read_text())
patch=Path('docs/qa/kb-security-integration-proposal-v2.patch').read_text()
for part in patch.split('--- /dev/null\n')[1:]:
    print('\n'.join(line[1:] for line in part.splitlines()[2:] if line.startswith('+')))
print(Path('scripts/fixtures/brad-kb-proposal-assertions.sql').read_text())
print("rollback; select 'Unapplied KB proposal: full-chain rollback probe passed';")
PY
PGPASSWORD=postgres psql -X -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/brad-kb-proposal-qualification.sql
