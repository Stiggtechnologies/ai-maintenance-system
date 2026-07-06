# LLM enrichment for the continuous agent loop

The deterministic agent loop (`run_agent_loop`, every 5 min) raises pending
recommendations from live sensor state. The **enrichment pipeline** upgrades
those with real model reasoning through the **Stigg AI Gateway** (LiteLLM,
per-app virtual keys for cost attribution).

```
pg_cron (*/10) → trigger_agent_enrichment() → pg_net POST
  → edge function agent-loop-enrich (service-role only)
    → Stigg AI Gateway /v1/chat/completions (model: stigg/fast)
      → rationale + confidence updated on PENDING recommendations only
      → agent_runs logged
```

**Human-in-the-loop is preserved by construction**: enrichment only edits
rationale/confidence on `pending` recommendations. It never changes status,
never approves, never creates work.

**Fail-soft at every layer** (all verified):

| Condition                                          | Behavior                                         |
| -------------------------------------------------- | ------------------------------------------------ |
| No cron config (`private.enrichment_config` empty) | cron no-ops (`skipped: not_configured`)          |
| No `LLM_BASE_URL`/`LLM_API_KEY` function secrets   | function returns `skipped: llm_not_configured`   |
| Gateway/network error                              | recommendation keeps its deterministic rationale |
| Non-service-role caller                            | 401                                              |

## Current status

The pipeline is fully deployed and **dormant**: the Stigg AI Gateway itself is
not yet deployed (`stigg-ai-gateway.fly.dev` does not exist; the repo at
`~/stigg-ai-gateway` is ready-to-deploy IaC). The virtual keys
`ai-maintenance-system-staging` / `-prod` are already defined in its
`config/virtual-keys.yaml`.

## Light-up runbook (one-time, ~15 min, requires your credentials)

1. **Deploy the gateway** (needs your Fly login + provider API keys):

   ```bash
   brew install flyctl
   fly auth login
   cd ~/stigg-ai-gateway
   cp .env.example .env   # fill LITELLM_MASTER_KEY, ANTHROPIC/OPENAI/GOOGLE keys
   ./scripts/bootstrap-complete.sh
   ```

   This seeds every virtual key and prints the key values.

2. **Set the SyncAI function secrets** (from repo root, project already linked):

   ```bash
   supabase secrets set \
     LLM_BASE_URL=https://stigg-ai-gateway.fly.dev \
     LLM_API_KEY=<ai-maintenance-system-staging virtual key>
   ```

That's it — the cron plumbing is already configured on the cloud project.
Within 10 minutes, loop-raised recommendations start carrying
`AI analysis (stigg/fast): …` rationale, visible in Mission Control, and each
enrichment logs an `agent_runs` row.

## Verify

```bash
# invoke on demand (service key from `supabase projects api-keys`)
curl -X POST https://pjvoswbwomesuwhygpby.supabase.co/functions/v1/agent-loop-enrich \
  -H "Authorization: Bearer <service_role_key>" -d '{}'
# → {"enriched":N,"of":N,"failures":[]}
```

Local dev: `node scripts/mock-llm.mjs 54400` +
`supabase functions serve agent-loop-enrich --env-file <envfile>` with
`LLM_BASE_URL=http://host.docker.internal:54400`.
