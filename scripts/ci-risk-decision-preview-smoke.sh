#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Governed risk decision preview smoke FAILED at line $LINENO"' ERR

# Synthetic, transaction-rolled-back fixtures on the fresh CI database only.
# This is not permission to seed a customer tenant or operate a production DB.
test "${GITHUB_ACTIONS:-}" = true
# An additive early, rollback-only SQL preflight catches fixture defects before
# the longer smoke sequence. The original default still requires real HTTP.
case "$#:${1:-}" in
  0:) ;;
  1:--sql-preflight) ;;
  *) printf '%s\n' 'Unsupported risk smoke arguments' >&2; exit 2 ;;
esac
env -i PATH="$PATH" LC_ALL=C LANG=C PGPASSWORD=postgres \
  PGHOSTADDR=127.0.0.1 PGOPTIONS='-c search_path=public' PGSSLMODE=disable \
  psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -X -v ON_ERROR_STOP=1 -f scripts/tests/risk-decision-preview-postgres-tests.sql
if [[ "${1:-}" != --sql-preflight ]]; then
  node scripts/tests/risk-decision-preview-http-smoke.mjs
fi
