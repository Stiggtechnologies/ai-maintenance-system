# Integrations System

How SyncAI's integration platform is wired end-to-end, and how to add a new
integration vendor without touching the UI.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           UI (React + Supabase)                     │
│                                                                     │
│   IntegrationsDashboard ──reads──> v_integrations_for_org           │
│         │                ──reads──> integration_catalog             │
│         │                                                           │
│         ├─ Connect ──POST──> integration-connect Edge Function      │
│         ├─ Test    ──POST──> integration-test Edge Function         │
│         └─ Disconnect ─POST─> integration-disconnect Edge Function  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Postgres (Supabase) + RLS                       │
│                                                                     │
│   integration_catalog   (global, public)    26 vendors seeded       │
│   integrations          (org-scoped)        per-customer instances  │
│   integration_events    (org-scoped)        connect/test/sync log   │
│                                                                     │
│   Encrypted credentials via pgcrypto (pgp_sym_encrypt) using key    │
│   from app.integration_encryption_key database setting.             │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    External vendor APIs
                 (Anthropic, OpenAI, SAP, etc.)
```

## Tables

| Table | Scope | Purpose |
|---|---|---|
| `integration_catalog` | global, public read | Catalog of integration *types* — vendor + product combos with credential schemas |
| `integrations` | org-scoped (RLS) | Per-customer integration *instances* with encrypted credentials |
| `integration_events` | org-scoped (RLS) | Audit log of every connect/test/sync event |

The data model intentionally separates **catalog** (recommendations, what's
available) from **instances** (what an organization has actually
configured). The marketing site can read the catalog; the product can
read both.

The view `v_integrations_for_org` joins instances with their catalog
entries and exposes everything except the encrypted credentials column —
that never leaves Postgres.

## Encryption

Credentials are encrypted at rest with `pgcrypto`'s `pgp_sym_encrypt`
(AES-256). The key is stored as a per-database setting:

```sql
ALTER DATABASE postgres SET app.integration_encryption_key = '<32+ char secret>';
```

Without this set, `integration_upsert_with_credentials()` raises an
exception — the system fails closed, never silently storing plaintext.

`integration_encrypt_credentials` and `integration_decrypt_credentials`
are SECURITY DEFINER functions revoked from PUBLIC and only granted to
`service_role`. The Edge Functions call them via RPC.

## Edge Functions

### `integration-connect`

```
POST /functions/v1/integration-connect
Authorization: Bearer <user-jwt>
Body: {
  catalog_code: "anthropic",
  name: "Production Claude",
  credentials: { api_key: "sk-ant-...", model: "claude-sonnet-4-6" },
  config?: { ... }
}
```

Flow:

1. Auth user → resolve `organization_id`
2. Fetch catalog entry; reject if inactive or unknown
3. Validate `credentials` against `credentials_schema` (partial JSON Schema)
4. Call `integration_upsert_with_credentials` RPC — encrypts credentials inside Postgres
5. If `has_test_endpoint = true`, run a real round-trip test
6. Record outcome via `integration_record_result` RPC
7. Return `{ ok, integration_id, status, test_result? }`

### `integration-test`

```
POST /functions/v1/integration-test
Body: { integration_id: "<uuid>" }
```

1. Verify requester has access to the integration's organization
2. Read decrypted credentials via `integration_read_credentials` RPC
3. Run a real test (Anthropic & OpenAI today; placeholder for others)
4. Record `test_success` / `test_failure` event
5. Return latency + status

### `integration-disconnect`

```
POST /functions/v1/integration-disconnect
Body: { integration_id: "<uuid>", hard_delete?: boolean }
```

Clears the `credentials_encrypted` column and sets status to
`disconnected`. If `hard_delete=true`, the row is removed entirely.

## How to add a new integration vendor

Three changes — only one of them is code.

### 1. Add a row to `integration_catalog`

```sql
INSERT INTO integration_catalog (code, vendor, product, category,
                                 description, auth_type,
                                 credentials_schema, has_test_endpoint,
                                 sort_order)
VALUES (
  'newvendor_product',
  'NewVendor',
  'NewProduct',
  'erp_cmms',           -- group it under one of the existing categories
  'Short description shown to customers',
  'api_key',            -- api_key | oauth2 | connection_string | ssh_keys | none
  '{"type":"object","required":["api_key"],"properties":{"api_key":{"type":"string","format":"password","title":"API key"}}}'::jsonb,
  false,                -- true if you also implement a real adapter (step 3)
  100
);
```

Once the row exists, the catalog appears in the "Add Integration" picker
and the credentials form renders automatically from `credentials_schema`.

### 2. (Optional) Add a credential icon / docs URL

```sql
UPDATE integration_catalog
SET docs_url = 'https://newvendor.com/docs/api',
    logo_url = 'https://newvendor.com/logo.svg'
WHERE code = 'newvendor_product';
```

### 3. (When you have a real adapter) Add a test handler

In `supabase/functions/integration-connect/index.ts` and
`supabase/functions/integration-test/index.ts`, add a branch to the
`runConnectivityTest` / `runTest` function:

```ts
if (catalogCode === 'newvendor_product') {
  const apiKey = credentials.api_key as string;
  const res = await fetch('https://api.newvendor.com/v1/health', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return { ok: false, latency_ms: ..., error: `HTTP ${res.status}` };
  return { ok: true, latency_ms: ... };
}
```

Then update the catalog row to set `has_test_endpoint = true`.

## Required one-time setup

After applying migration 013, set the encryption key:

```bash
psql "$SUPABASE_DB_URL" -c "ALTER DATABASE postgres SET app.integration_encryption_key = '<random 32+ char secret>';"
```

Or via the Supabase Studio SQL editor.

Then deploy the three Edge Functions:

```bash
supabase functions deploy integration-connect
supabase functions deploy integration-test
supabase functions deploy integration-disconnect
```

## Security model

- **Catalog reads**: public — no sensitive data in the catalog
- **Instance reads/writes**: RLS enforces `organization_id = current_user_org_id()`
- **Credential reads**: only via `integration_read_credentials` RPC (service_role only) — UI never touches encrypted column
- **Encryption at rest**: pgcrypto AES-256 with a per-database key
- **Audit trail**: every connect/test/disconnect event logged to `integration_events`

## Testing

- **Unit tests** for `ConnectIntegrationModal` schema parsing and form behavior:
  `src/components/__tests__/ConnectIntegrationModal.test.tsx`
- **Component tests** for `IntegrationsDashboard` with mocked Supabase client:
  `src/components/__tests__/IntegrationsDashboard.test.tsx`
- **Validation tests** for the Edge Function's schema validator:
  `supabase/functions/integration-connect/_test/validation.test.ts`

Run with:

```bash
npm test                    # one-shot
npm run test:watch          # watch mode
npm run test:ui             # browser UI
```

## Related

- Migration: [`supabase/migrations/013_integrations.sql`](../supabase/migrations/013_integrations.sql)
- Templates use `integration_catalog` codes in the `template_config.integrations` array — see [`012_industry_templates_expanded.sql`](../supabase/migrations/012_industry_templates_expanded.sql)
