# AI Agents System

How SyncAI's 16 canonical agents (15 functional + 1 orchestrator) are
defined, invoked, and routed through the customer's connected AI provider.

## The 16 Agents

| Code | Name | Category | Default Autonomy | Default Model |
|---|---|---|---|---|
| `maintenance_strategy` | Maintenance Strategy | Strategic | advisory | claude-sonnet-4-6 |
| `asset_management` | Asset Management | Strategic | advisory | claude-sonnet-4-6 |
| `reliability_engineering` | Reliability Engineering | Strategic | advisory | claude-opus-4-7 |
| `planning_scheduling` | Planning & Scheduling | Operational | autonomous | claude-sonnet-4-6 |
| `work_order_management` | Work Order Management | Operational | autonomous | claude-sonnet-4-6 |
| `condition_monitoring` | Condition Monitoring | Operational | advisory | claude-sonnet-4-6 |
| `inventory_management` | Inventory Management | Operational | autonomous | claude-haiku-4-5-20251001 |
| `maintenance_operations` | Maintenance Operations | Operational | autonomous | claude-sonnet-4-6 |
| `quality_assurance` | Quality Assurance | Quality | advisory | claude-sonnet-4-6 |
| `compliance_auditing` | Compliance & Auditing | Quality | advisory | claude-opus-4-7 |
| `sustainability_esg` | Sustainability & ESG | Intelligence | advisory | claude-sonnet-4-6 |
| `data_analytics` | Data Analytics | Intelligence | advisory | claude-sonnet-4-6 |
| `continuous_improvement` | Continuous Improvement | Intelligence | advisory | claude-sonnet-4-6 |
| `training_workforce` | Training & Workforce | Intelligence | autonomous | claude-haiku-4-5-20251001 |
| `financial_contract` | Financial & Contract | Intelligence | advisory | claude-sonnet-4-6 |
| `central_coordination` | Central Coordination | Orchestration | advisory | claude-opus-4-7 |

Each agent has a system prompt grounded in domain standards (RCM, FMEA,
ISO 55000, API 580, OSHA PSM, ISO 50001, IEC 61511, GMP, etc.) and a
`capabilities` array describing what it does.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                              UI                                     │
│                                                                     │
│   AgentControlCenter ──reads──> v_agent_summary  (per-org metrics)  │
│         │                                                           │
│         └─ Run → AgentRunModal ──POST──> ai-agent-processor         │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│              ai-agent-processor Edge Function                       │
│                                                                     │
│   1. Resolve agent_definitions[code]                                │
│   2. Resolve LLM provider (precedence below)                        │
│   3. Call provider with system_prompt + user query                  │
│   4. Persist run to agent_runs (start → complete/fail)              │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    Anthropic / OpenAI APIs
```

## Provider resolution

The Edge Function resolves which AI provider to use in this order:

1. **Org's connected Anthropic integration** (preferred — the customer's own key)
   - Reads from `integrations` table where `catalog_code = 'anthropic'` and `status = 'connected'`
   - Decrypts credentials via `integration_read_credentials` RPC
2. **Platform Anthropic key** (`ANTHROPIC_API_KEY` env var)
3. **Per-request OpenAI key** (legacy v1 callers)
4. **Platform OpenAI key** (`OPENAI_API_KEY` env var)

If none are available, the request fails with a clear error pointing the
user to the Integrations page.

## Tables

### `agent_definitions` (global, public read)

The canonical 16-agent registry. Schema:

| column | type | notes |
|---|---|---|
| `code` | text unique | snake_case, stable id |
| `name` | text | display name |
| `role` | text | short role label |
| `category` | text | strategic\|operational\|quality\|intelligence\|orchestration |
| `system_prompt` | text | the LLM system prompt |
| `capabilities` | text[] | tags shown in UI |
| `default_autonomy` | text | manual\|advisory\|autonomous |
| `preferred_model` | text | Claude model code |
| `max_tokens` | integer | per-call cap |
| `is_active` | boolean | hide an agent without deleting it |
| `sort_order` | integer | display order |

### `agent_runs` (org-scoped, RLS)

Every invocation is logged here with full traceability:

| column | type | notes |
|---|---|---|
| `id` | uuid | run id |
| `organization_id` | uuid | RLS scope |
| `agent_code` | text | FK to `agent_definitions` |
| `user_id` | uuid | who initiated |
| `industry` | text | optional context |
| `query` | text | user input |
| `response` | text | LLM output |
| `model_used` | text | actual model that ran |
| `provider` | text | anthropic\|openai |
| `integration_id` | uuid | which Anthropic integration handled it (if any) |
| `status` | text | pending\|running\|succeeded\|failed |
| `latency_ms` | integer | end-to-end |
| `requires_approval` | boolean | for HITL flows |
| `approval_status` | text | null\|pending\|approved\|rejected |

### `v_agent_summary` (view, joins definitions + 24h metrics)

What the UI reads. Each row is one agent enriched with `runs_24h`,
`successes_24h`, `failures_24h`, `avg_latency_ms_24h`, `last_run_at`
(scoped to the caller's org by RLS on `agent_runs`).

## Edge Function: `ai-agent-processor`

```
POST /functions/v1/ai-agent-processor
Authorization: Bearer <user-jwt>

Body:
  {
    "agent_code": "reliability_engineering",
    "query": "Walk me through an RCA for repeated bearing failures.",
    "industry": "oil & gas"
  }

Response:
  {
    "ok": true,
    "run_id": "uuid",
    "response": "...",
    "model_used": "claude-opus-4-7",
    "provider": "anthropic",
    "latency_ms": 1820,
    "agent": { "code": "...", "name": "...", "role": "..." }
  }
```

Legacy v1 callers may pass `agentType` (camelCase) and `openaiKey` —
both are honored; agentType is mapped to canonical codes via
`LEGACY_AGENT_MAP`.

## How to add a new agent

```sql
INSERT INTO agent_definitions (code, name, role, category, description,
                               system_prompt, capabilities,
                               default_autonomy, preferred_model,
                               max_tokens, sort_order)
VALUES (
  'safety_inspector',
  'Safety Inspector',
  'Hazard Detection',
  'quality',
  'Continuously screens work orders, JSAs, and incident reports for unaddressed hazards.',
  'You are a world-class Safety Inspector Agent...',
  ARRAY['hazard_detection','jsa_review','incident_pattern_analysis'],
  'advisory',
  'claude-sonnet-4-6',
  1000,
  95
);
```

The agent appears in `v_agent_summary` immediately and the UI renders
it on next refresh — no UI code change required.

## How to update a system prompt

```sql
UPDATE agent_definitions
SET system_prompt = '... new prompt ...', updated_at = NOW()
WHERE code = 'reliability_engineering';
```

Effective on the next run — no Edge Function redeploy needed.

## Required setup

Migration 014 must be applied:

```bash
supabase db push   # or run 014_ai_agents.sql via Studio
```

For the Edge Function to call Anthropic, either:

- **Customer-side (preferred)**: connect Anthropic via Integrations →
  Add Integration → search "Anthropic" → enter API key → Connect.
  The Edge Function will use this org's key for all agent runs.
- **Platform-side**: set `ANTHROPIC_API_KEY` in the Edge Function secrets.

## Testing

- **Component**: `src/components/__tests__/AgentControlCenter.test.tsx` (6 tests)
- **Modal**: `src/components/__tests__/AgentRunModal.test.tsx` (9 tests)

Both test files run under Vitest 3 + jsdom + @testing-library/react.

## Related

- Migration: [`supabase/migrations/014_ai_agents.sql`](../supabase/migrations/014_ai_agents.sql)
- Edge Function: [`supabase/functions/ai-agent-processor/index.ts`](../supabase/functions/ai-agent-processor/index.ts)
- Integrations system (provider plumbing): [`docs/integrations.md`](./integrations.md)
- Templates referencing agent priorities: [`supabase/migrations/012_industry_templates_expanded.sql`](../supabase/migrations/012_industry_templates_expanded.sql)
