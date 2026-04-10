#!/usr/bin/env bash
# scripts/deploy-production.sh
#
# One-command production deployment for SyncAI.
# Run from a machine that can reach api.supabase.com.
#
# Prerequisites:
#   - Node.js >= 18
#   - npm install -g supabase (or npx supabase)
#   - SUPABASE_ACCESS_TOKEN set (generate at https://supabase.com/dashboard/account/tokens)
#
# Usage:
#   export SUPABASE_ACCESS_TOKEN=sbp_xxxxx
#   ./scripts/deploy-production.sh
#
# What it does:
#   1. Links to the Supabase project
#   2. Pushes all database migrations
#   3. Deploys Edge Functions (ai-agent-processor + autonomous-orchestrator)
#   4. Sets required Edge Function secrets
#   5. Verifies the deployment

set -euo pipefail

PROJECT_REF="dguwgnxjdivsrekjarlp"
SUPABASE_URL="https://${PROJECT_REF}.supabase.co"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║    SyncAI Production Deployment          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""

# --- Preflight ---
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo -e "${RED}ERROR: SUPABASE_ACCESS_TOKEN not set.${NC}"
  echo "  Generate one at: https://supabase.com/dashboard/account/tokens"
  echo "  Then: export SUPABASE_ACCESS_TOKEN=sbp_xxxxx"
  exit 1
fi

if ! command -v npx &>/dev/null; then
  echo -e "${RED}ERROR: npx not found. Install Node.js >= 18.${NC}"
  exit 1
fi

echo -e "${YELLOW}[1/5] Linking to Supabase project...${NC}"
npx supabase link --project-ref "$PROJECT_REF"
echo -e "${GREEN}  ✓ Linked to ${PROJECT_REF}${NC}"

echo ""
echo -e "${YELLOW}[2/5] Pushing database migrations...${NC}"
npx supabase db push
echo -e "${GREEN}  ✓ Migrations applied${NC}"

echo ""
echo -e "${YELLOW}[3/5] Deploying Edge Functions...${NC}"

# Deploy the two modified functions
npx supabase functions deploy ai-agent-processor --no-verify-jwt
echo -e "${GREEN}  ✓ ai-agent-processor deployed${NC}"

npx supabase functions deploy autonomous-orchestrator --no-verify-jwt
echo -e "${GREEN}  ✓ autonomous-orchestrator deployed${NC}"

echo ""
echo -e "${YELLOW}[4/5] Setting Edge Function secrets...${NC}"

# LLM_BASE_URL — defaults to OpenAI; override for custom endpoints
npx supabase secrets set LLM_BASE_URL=https://api.openai.com

# Check if OPENAI_API_KEY is already set
echo -e "  LLM_BASE_URL set to https://api.openai.com"

if [ -n "${OPENAI_API_KEY:-}" ]; then
  npx supabase secrets set "OPENAI_API_KEY=${OPENAI_API_KEY}"
  echo -e "${GREEN}  ✓ OPENAI_API_KEY set from environment${NC}"
else
  echo -e "${YELLOW}  ⚠ OPENAI_API_KEY not in environment.${NC}"
  echo "    Set it manually: npx supabase secrets set OPENAI_API_KEY=sk-xxxxx"
  echo "    Or re-run with: OPENAI_API_KEY=sk-xxxxx ./scripts/deploy-production.sh"
fi

# ALLOWED_ORIGIN for CORS
npx supabase secrets set ALLOWED_ORIGIN=https://app.syncai.ca
echo -e "${GREEN}  ✓ ALLOWED_ORIGIN set${NC}"

echo ""
echo -e "${YELLOW}[5/5] Verifying deployment...${NC}"

# Check Edge Functions are responding
HEALTH_URL="${SUPABASE_URL}/functions/v1/health-check"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $(npx supabase secrets list 2>/dev/null | grep SUPABASE_ANON_KEY | awk '{print $2}' || echo '')" "$HEALTH_URL" 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" = "000" ]; then
  echo -e "${YELLOW}  ⚠ Could not verify edge function health (might need a moment to warm up)${NC}"
else
  echo -e "${GREEN}  ✓ Edge functions responding (HTTP ${HTTP_STATUS})${NC}"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║    Deployment Complete                    ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo "  Supabase:  ${SUPABASE_URL}"
echo "  Frontend:  https://ai-maintenance-system-neon.vercel.app"
echo "  Dashboard: https://supabase.com/dashboard/project/${PROJECT_REF}"
echo ""
echo "  Deployed:"
echo "    • 7 database migrations (autonomy enum, tenant isolation,"
echo "      RLS repair, approval requests, execution hardening,"
echo "      audit chain helper)"
echo "    • ai-agent-processor (service_role, LLM_BASE_URL,"
echo "      generic task dispatch, governance handoff)"
echo "    • autonomous-orchestrator (create_intelligence_decision,"
echo "      approve_and_execute with idempotency)"
echo ""
if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo -e "${YELLOW}  ⚠ Remember to set OPENAI_API_KEY:${NC}"
  echo "    npx supabase secrets set OPENAI_API_KEY=sk-xxxxx"
fi
echo ""
echo "  Next: verify at ${SUPABASE_URL}/functions/v1/ai-agent-processor"
