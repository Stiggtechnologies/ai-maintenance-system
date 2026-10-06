#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Governed risk decision preview smoke FAILED at line $LINENO"' ERR

# Synthetic, transaction-rolled-back fixtures on the fresh CI database only.
# This is not permission to seed a customer tenant or operate a production DB.
test "${GITHUB_ACTIONS:-}" = true
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -X -v ON_ERROR_STOP=1 -f scripts/tests/risk-decision-preview-postgres-tests.sql
node scripts/tests/risk-decision-preview-http-smoke.mjs
