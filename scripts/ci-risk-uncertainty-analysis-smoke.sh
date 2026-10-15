#!/usr/bin/env bash
set -euo pipefail
trap 'echo "U18.02 isolated CI smoke FAILED at line $LINENO"' ERR

# Disposable CI qualification only, never a production seeding tool.
test "${GITHUB_ACTIONS:-}" = true
case "$#:${1:-}" in
  0:) ;;
  1:--sql-preflight) ;;
  *) printf '%s\n' 'Unsupported uncertainty smoke arguments' >&2; exit 2 ;;
esac
env -i PATH="$PATH" LC_ALL=C LANG=C PGPASSWORD=postgres \
  PGHOSTADDR=127.0.0.1 PGOPTIONS='-c search_path=public' PGSSLMODE=disable \
  psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -X -v ON_ERROR_STOP=1 -f scripts/tests/risk-uncertainty-analysis-postgres-tests.sql
if [[ "${1:-}" != --sql-preflight ]]; then
  node scripts/tests/risk-uncertainty-analysis-http-smoke.mjs
  node scripts/tests/risk-uncertainty-analysis-concurrency-postgres.mjs --ci-uncertainty-concurrency
fi
