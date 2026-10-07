# LLM enrichment for the continuous agent loop

> **Per-surface providers:** enrichment reads `ENRICH_LLM_BASE_URL` /
> `ENRICH_LLM_API_KEY` / `ENRICH_LLM_MODEL` (falls back to `LLM_*`). The
> interactive copilot (`ai-agent-processor`) uses `LLM_BASE_URL` (default
> OpenAI) + `OPENAI_API_KEY`. This lets background enrichment run on free
> Gemini Flash while the copilot stays on the model your testing validated.

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

## Current status — verified 2026-10-06

The prior statement that `stigg-ai-gateway.fly.dev` did not exist is stale. Its
public `/health` endpoint resolves and returns HTTP 401 without credentials,
which proves a deployed authentication boundary but not customer readiness,
upstream-provider health, model identity, price, or successful inference.

A names-only inventory of the active SyncAI project shows
`ENRICH_LLM_BASE_URL`, `ENRICH_LLM_API_KEY`, `ENRICH_LLM_MODEL`,
`LLM_BASE_URL`, `LLM_API_KEY`, and `OPENAI_API_KEY`. No secret value was read,
so the exact URL binding and model selection are not proven by that inventory.
The local Fly CLI has no authenticated control-plane session, and no gateway
invoice or pricing schedule is evidenced.

Do not call the pipeline active, dormant, priced, or commercially ready from
this document. The paid plan boundary treats the live route as gateway-first
because the shared provider chain leads with an external gateway when its URL
and key are present; a production cost multiplier of 1.0 remains ineligible
until a direct standard-rate route is independently proven or a sourced
gateway/tier schedule is approved.

The current commercial release candidate narrows only a bound paid-plan call:
after its quota reservation returns a commercial plan ID, the shared caller
uses the exact requested model on the canonical `openai-direct` endpoint and
refuses provider contact if that route is absent. The ordinary unbound
engineering path remains gateway-first. It also refuses paid requests above an
8,192-token output ceiling or a conservative 100,000-token total upper-bound
envelope, keeping the proposed GPT-5.6 models below their 272,000-input-token
long-context price tier and GPT-4o Mini below its smaller 128,000-token context
window. Bound paid calls also request `service_tier: default`, require the
successful response to report `default`, and disable GPT-5.6 implicit cache
writes with explicit mode and no breakpoint. A non-default or missing reported
tier withholds output, settles actual model and tokens as an unknown-price
pricing-mode breach, and freezes later paid calls for reconciliation. The
pre-call reservation uses the same conservative UTF-8 upper bound as the
standard-rate envelope rather than the looser engineering estimate.

The protected `ai-agent-processor` Reliability Engineer surface still owns a
legacy provider and fail-soft telemetry path. A bound commercial subscription
is therefore refused at the database quota gate before that surface contacts a
provider. This preserves the qualification baseline and prevents unpriced paid
traffic, but it is also a release blocker for any paid package that promises
that surface. A separately reviewed and qualified protected-surface change is
required before enabling it for paid customers. This code is not reviewed,
merged, deployed, or a production pricing witness.

## Governed verification and activation runbook

1. Under authorized Fly access, inspect the existing application, deployment
   revision, regions, health, upstream model mapping, usage and billing without
   copying secret values into tickets or logs.
2. Have the production secret owner verify the exact SyncAI gateway binding and
   virtual-key scope through a secure channel. Record only the provider class,
   model mapping, effective date and evidence reference.
3. Obtain the gateway and upstream-provider price schedule. Convert it to the
   approved `provider_cost_multiplier` and rerun every plan margin gate.
4. Run one bounded non-customer test that proves authenticated gateway success,
   returned canonical model identity, terminal token usage, ledger settlement
   and failure fallback.
5. Activate recurring enrichment only under separate deployment authority and
   verify that deterministic recommendations remain pending until human action.

## Historical model notes (observed 2026-07-06; not current-state proof)

- The July configuration was reported as enrichment on
  `gemini-flash-latest` through Google's OpenAI-compatible endpoint and copilot
  on direct OpenAI. The October secret-name inventory now contradicts the old
  `LLM_BASE_URL unset` assumption; current values and routing require privileged
  verification.
- `gemini-2.5-flash` is a _thinking_ model — its reasoning consumes the token
  budget and can return empty content. `gemini-2.0-flash` no longer has free
  quota. `gemini-flash-latest` returns clean JSON.
- Function reports `provider: {base, model, key_len}` and upstream error
  snippets in `failures` — a 14-char key means someone left the placeholder in.

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
