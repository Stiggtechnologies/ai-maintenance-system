#!/bin/bash
# Configure Supabase Production Secrets
# Run this after deploying to production

set -e

echo "🔐 SyncAI Production Secrets Configuration"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Load credentials from vault
CREDENTIALS_VAULT="/Users/orvilledavis/.openclaw/workspace/.credentials-vault.env"

if [ ! -f "$CREDENTIALS_VAULT" ]; then
    echo "❌ Error: Credentials vault not found at $CREDENTIALS_VAULT"
    exit 1
fi

# Source the credentials
source "$CREDENTIALS_VAULT"

echo "✅ Loaded credentials from vault"
echo ""

# Check if supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. Install with:"
    echo "   npm install -g supabase"
    exit 1
fi

echo "📦 Setting Supabase Edge Function secrets..."
echo ""

# Set OpenAI API Key
echo "Setting OPENAI_API_KEY..."
echo "$OPENAI_API_KEY_AXIUM" | supabase secrets set OPENAI_API_KEY --env-file /dev/stdin

# Set Stripe Secret Key (test for now)
echo "Setting STRIPE_SECRET_KEY (test)..."
echo "$STRIPE_SECRET_KEY_TEST" | supabase secrets set STRIPE_SECRET_KEY --env-file /dev/stdin

# Set Twilio API Key (optional)
echo "Setting TWILIO_API_KEY (optional)..."
echo "$TWILIO_API_KEY" | supabase secrets set TWILIO_API_KEY --env-file /dev/stdin

echo ""
echo -e "${GREEN}✅ All secrets configured successfully!${NC}"
echo ""
echo "Next steps:"
echo "1. Deploy edge functions: supabase functions deploy"
echo "2. Deploy frontend: vercel --prod"
echo "3. Run smoke tests: ./scripts/tests/smoke-test.sh"
echo ""
echo -e "${YELLOW}⚠️  Remember:${NC}"
echo "- Test keys are currently configured"
echo "- Switch to live Stripe keys before production launch"
echo "- Monitor API usage in OpenAI dashboard"
