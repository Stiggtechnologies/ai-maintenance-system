# SyncAI v2 - Required Secrets & Environment Variables

## ⚠️ SECURITY NOTICE

**CRITICAL:** The following API keys were found exposed in git history:
- OpenAI API key: `sk-proj-7nvWSx...` - **MUST BE REVOKED IMMEDIATELY**
- Stripe Live key: `pk_live_51RPclL...` - **MUST BE REVOKED IMMEDIATELY**

**Action Required:**
1. Go to OpenAI Dashboard and revoke the exposed key
2. Go to Stripe Dashboard and revoke the exposed key
3. Generate new keys and configure them in Supabase Edge Functions

---

## Frontend Environment Variables (.env)

These are loaded in the browser and should ONLY contain public keys:

```bash
# Supabase Connection (PUBLIC - safe to expose)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Note: NEVER add secret API keys to .env file
# All secrets must be configured in Supabase Edge Functions
```

---

## Edge Functions Secrets (Supabase Dashboard)

These are server-side secrets configured in Supabase Dashboard under Edge Functions → Secrets.

### Required Secrets

#### 1. Supabase Internal (Auto-Configured)
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_DB_URL=postgresql://postgres:[PASSWORD]@db.your-project.supabase.co:5432/postgres
```

#### 2. OpenAI API (Required)
```bash
OPENAI_API_KEY=sk-proj-XXXXXXXXXXXXX
```
**Used by:**
- `javis-orchestrator` - AI query processing
- `model-router` - Model selection and routing
- `ai-agent-processor` - Agent coordination
- `rag-semantic-search` - Semantic embeddings

**How to get:**
1. Go to https://platform.openai.com/api-keys
2. Create new secret key
3. Add to Supabase Edge Functions secrets

#### 3. Anthropic API (Optional)
```bash
ANTHROPIC_API_KEY=sk-ant-XXXXXXXXXXXXX
```
**Used by:**
- `model-router` - Alternative model provider

**How to get:**
1. Go to https://console.anthropic.com/
2. Create API key
3. Add to Supabase Edge Functions secrets

#### 4. Stripe API (Required for Billing)
```bash
STRIPE_SECRET_KEY=sk_live_XXXXXXXXXXXXX
STRIPE_WEBHOOK_SECRET=whsec_XXXXXXXXXXXXX
```
**Used by:**
- `stripe-checkout` - Create checkout sessions
- `stripe-webhook` - Handle payment events
- `billing-api` - Subscription management

**How to get:**
1. Go to https://dashboard.stripe.com/apikeys
2. Use **TEST** keys for development
3. Use **LIVE** keys only for production
4. Create webhook endpoint: https://your-project.supabase.co/functions/v1/stripe-webhook
5. Copy webhook signing secret

#### 5. Stripe Price IDs (Required for Billing)
```bash
STRIPE_STARTER_BASE_PRICE=price_XXXXXXXXXXXXX
STRIPE_STARTER_CREDITS_PRICE=price_XXXXXXXXXXXXX
STRIPE_PRO_BASE_PRICE=price_XXXXXXXXXXXXX
STRIPE_PRO_CREDITS_PRICE=price_XXXXXXXXXXXXX
STRIPE_ENTERPRISE_BASE_PRICE=price_XXXXXXXXXXXXX
STRIPE_ENTERPRISE_CREDITS_PRICE=price_XXXXXXXXXXXXX
```
**Used by:**
- `stripe-checkout` - Subscription pricing

**How to get:**
1. Go to https://dashboard.stripe.com/products
2. Create products for each tier (Starter, Pro, Enterprise)
3. Create prices for base subscription and credit packages
4. Copy price IDs (start with `price_`)

#### 6. Application URL (Required)
```bash
APP_BASE_URL=https://your-domain.com
```
**Used by:**
- `stripe-checkout` - Success/cancel redirects
- `openclaw-notifier` - Email links
- Various Edge Functions for callbacks

---

## Configuration Steps

### 1. Local Development Setup

```bash
# 1. Copy example file
cp .env.example .env

# 2. Add your Supabase credentials (from Supabase Dashboard)
# Edit .env and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 3. Install dependencies
npm install

# 4. Start development server
npm run dev
```

### 2. Configure Edge Function Secrets (Development)

```bash
# Using Supabase CLI (if available)
supabase secrets set OPENAI_API_KEY=sk-proj-XXXXXXXXXXXXX
supabase secrets set STRIPE_SECRET_KEY=sk_test_XXXXXXXXXXXXX
# ... etc

# OR use Supabase Dashboard:
# 1. Go to https://supabase.com/dashboard/project/YOUR_PROJECT/functions
# 2. Click "Edge Functions"
# 3. Click "Manage secrets"
# 4. Add each secret from the list above
```

### 3. Production Deployment

```bash
# 1. Generate new production API keys (NEVER reuse dev keys)
# 2. Configure all secrets in Supabase Dashboard for production project
# 3. Update Stripe webhook URL to production domain
# 4. Deploy Edge Functions
# 5. Deploy frontend with production Supabase URL
```

---

## Security Best Practices

### ✅ DO:
- Use test/sandbox API keys for development
- Use live API keys ONLY in production
- Rotate API keys every 90 days
- Use different keys for each environment
- Store secrets in Supabase Edge Functions secrets (server-side)
- Add .env.local to .gitignore

### ❌ DON'T:
- Commit API keys to git
- Share API keys in Slack/email
- Use live keys in development
- Hard-code secrets in source code
- Expose secrets in frontend JavaScript
- Reuse keys across projects

---

## Verification Checklist

Before deploying to production, verify:

- [ ] All secrets configured in Supabase Edge Functions
- [ ] Test keys used in development, live keys in production
- [ ] Stripe webhook URL configured correctly
- [ ] Stripe price IDs match your products
- [ ] APP_BASE_URL points to production domain
- [ ] Old/exposed API keys have been revoked
- [ ] .env file does NOT contain secrets
- [ ] .gitignore includes .env.local

---

## Troubleshooting

### "Missing API Key" Errors

**Symptom:** Edge Functions return 500 errors about missing keys

**Solution:**
1. Check Supabase Dashboard → Edge Functions → Secrets
2. Verify secret name matches exactly (case-sensitive)
3. Re-deploy Edge Functions after adding secrets

### Stripe Checkout Fails

**Symptom:** Checkout returns "Invalid price" or "Invalid API key"

**Solution:**
1. Verify STRIPE_SECRET_KEY is correct
2. Verify price IDs exist and are active
3. Ensure using test keys with test prices, or live keys with live prices
4. Check Stripe Dashboard logs

### OpenAI API Errors

**Symptom:** JAVIS returns "Invalid API key" or "Quota exceeded"

**Solution:**
1. Verify OPENAI_API_KEY is valid and active
2. Check OpenAI Dashboard usage limits
3. Ensure key has sufficient credits
4. Check rate limits (RPM/TPM)

---

## Support

For issues with secret configuration:
1. Check Supabase Edge Functions logs
2. Verify secrets are configured correctly
3. Test Edge Functions individually
4. Review this documentation

**Never share actual secret values in support requests!**
