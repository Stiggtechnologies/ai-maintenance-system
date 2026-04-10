#!/usr/bin/env bash
# scripts/dev-full.sh — Start the full local dev environment for E2E tests.
#
# Starts: Supabase local dev + Vite dev server + LLM mock server
# Seeds:  Demo data + test user
# Cleans up all child processes on exit (SIGTERM/SIGINT/ERR).
#
# Usage:
#   ./scripts/dev-full.sh           # happy path (mock LLM returns 200)
#   LLM_MOCK_FAIL=1 ./scripts/dev-full.sh  # failure path (mock LLM returns 500)
#
# Prerequisites:
#   - supabase CLI installed (https://supabase.com/docs/guides/cli)
#   - node >= 18
#   - npm dependencies installed (npm install)

set -euo pipefail

# --- Cleanup trap: kill all child processes on exit ---
PIDS=()
cleanup() {
  echo ""
  echo "[dev-full] Shutting down..."
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  # Also stop supabase if we started it
  if [ "${SUPABASE_STARTED:-0}" = "1" ]; then
    supabase stop 2>/dev/null || true
  fi
  echo "[dev-full] Cleanup complete."
}
trap cleanup EXIT SIGTERM SIGINT

# --- Preflight checks ---
if ! command -v supabase &>/dev/null; then
  echo "[dev-full] ERROR: supabase CLI not found."
  echo "  Install: https://supabase.com/docs/guides/cli"
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "[dev-full] ERROR: node not found."
  exit 1
fi

if [ ! -f "node_modules/.package-lock.json" ]; then
  echo "[dev-full] Installing npm dependencies..."
  npm install --no-audit --no-fund
fi

# --- Start Supabase local dev ---
echo "[dev-full] Starting Supabase local dev..."
supabase start
SUPABASE_STARTED=1

# Extract keys from supabase status
SUPABASE_URL=$(supabase status --output json 2>/dev/null | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const j=JSON.parse(d);console.log(j.API_URL||'http://localhost:54321')" 2>/dev/null || echo "http://localhost:54321")
SUPABASE_ANON_KEY=$(supabase status --output json 2>/dev/null | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const j=JSON.parse(d);console.log(j.ANON_KEY||'')" 2>/dev/null || echo "")
SUPABASE_SERVICE_ROLE_KEY=$(supabase status --output json 2>/dev/null | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const j=JSON.parse(d);console.log(j.SERVICE_ROLE_KEY||'')" 2>/dev/null || echo "")

export SUPABASE_URL
export SUPABASE_ANON_KEY
export SUPABASE_SERVICE_ROLE_KEY

echo "[dev-full] Supabase URL: $SUPABASE_URL"

# --- Run seeds ---
echo "[dev-full] Running seeds..."
for seed_file in supabase/seed/001_core_seed_data.sql supabase/seed/demo-seed.sql; do
  if [ -f "$seed_file" ]; then
    supabase db execute --file "$seed_file" 2>/dev/null || echo "[dev-full] Warning: seed $seed_file may have already been applied"
  fi
done

# --- Create test user ---
echo "[dev-full] Setting up test user..."
SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  npx tsx tests/e2e/fixtures/setup-test-user.ts

# --- Start LLM mock server ---
echo "[dev-full] Starting LLM mock server (fail=${LLM_MOCK_FAIL:-0})..."
LLM_MOCK_FAIL="${LLM_MOCK_FAIL:-0}" npx tsx tests/e2e/fixtures/llm-mock-server.ts &
PIDS+=($!)
sleep 1

# Verify mock server is up
if ! curl -s http://localhost:54400/v1/chat/completions -X POST -d '{}' -H 'Content-Type: application/json' -o /dev/null; then
  echo "[dev-full] ERROR: LLM mock server failed to start"
  exit 1
fi
echo "[dev-full] LLM mock server ready on http://localhost:54400"

# --- Start Vite dev server ---
echo "[dev-full] Starting Vite dev server..."
VITE_SUPABASE_URL="$SUPABASE_URL" \
VITE_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
  npx vite --port 5173 &
PIDS+=($!)

# Wait for Vite to be ready
echo "[dev-full] Waiting for Vite (http://localhost:5173)..."
for i in $(seq 1 30); do
  if curl -s http://localhost:5173 -o /dev/null 2>/dev/null; then
    break
  fi
  sleep 1
done

echo ""
echo "============================================"
echo "[dev-full] Environment ready!"
echo ""
echo "  App:         http://localhost:5173"
echo "  Supabase:    $SUPABASE_URL"
echo "  Mock LLM:    http://localhost:54400"
echo "  Test user:   test@syncai.test / Test1234!"
echo ""
echo "  Run tests:   npm run test:e2e"
echo "  Ctrl+C to stop all services."
echo "============================================"
echo ""

# Keep running until interrupted
wait
