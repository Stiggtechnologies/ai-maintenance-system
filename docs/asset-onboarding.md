# Autonomous Asset Onboarding

SyncAI onboards assets **autonomously**: the platform fills every checklist
item it can find or deduce, and asks a human only for what genuinely cannot be
found in the data. This implements the full SyncAI RAM onboarding checklist
(DoD RAM Guide aligned — reliability, availability, maintainability), sections
1–23.

## How the checklist maps into the product

| Checklist section                | Where it lives                                                         |
| -------------------------------- | ---------------------------------------------------------------------- |
| 1–19 (data sections)             | `onboarding_requirements` catalog → per-asset `asset_onboarding_items` |
| 20 (workflow sequence)           | The engine itself: seed → autofill → AI pass → HITL → gate             |
| 21 (minimum data before go-live) | `required_for_golive` flags checked by `get_golive_readiness()`        |
| 22 (onboarding template)         | The catalog is the template — rendered in the Asset Onboarding hub     |
| 23 (definition of done)          | `approve_asset_golive()` — Section-21 complete + SME sign-off → `live` |

## The autonomy ladder

Every requirement carries a `fill_strategy` that decides who answers it:

1. **`record`** — read directly from the asset register, components, sensors
   or integrations (name, tag, serial, hierarchy, thresholds, baselines…).
2. **`derived`** — computed from history: MTBF/failure rate from work-order
   events over time in service, MTTR from completed repair hours, availability
   estimate, bad-actor status, duplicate-tag check, alert-workflow proof.
3. **`library`** — deterministic engineering content: FMEA starters per asset
   class (`onboarding_fmea_library`, copied into
   `asset_failure_mode_libraries`) and the criticality/monitoring-based
   maintenance-strategy rule.
4. **`ai`** — deducible by a reliability engineer from asset class, OEM,
   model and context (primary function, failure definition, operating
   envelope, required skills, isolation, regulatory context…). The
   `onboarding-enrich` edge function answers these; **low-confidence answers
   are demoted to the human queue, never silently accepted**.
5. **`human`** — find-only facts autonomy must never invent: ownership,
   documents, redundancy design, stocking levels, hazardous-area class,
   warranty history. These are the human-in-the-loop queue.

Autonomy never overwrites a human answer, an accepted AI deduction, or a
not-applicable ruling (`fill_onboarding_item` precedence).

## Lifecycle

- **New assets self-onboard**: an `AFTER INSERT` trigger on `assets` runs
  `start_asset_onboarding()` + `run_onboarding_autofill()`.
- **AI deduction** runs every 15 minutes via pg_cron
  (`syncai-onboarding-enrich` → `trigger_onboarding_enrichment()` → pg_net →
  `onboarding-enrich`), or on demand from the hub
  (`request_onboarding_ai_pass()`). Fail-soft: no LLM configured → items stay
  answerable by humans; nothing blocks.
- **Humans** close gaps in the Asset Onboarding hub (`/onboarding`) —
  `provide_onboarding_item()` records the answer (or rules the item not
  applicable) and logs a learning event.
- **Go-live** (`approve_asset_golive()`) refuses until every Section-21
  requirement is satisfied, then records the SME decision in `decisions`
  (`decision_type = 'onboarding_gate'`) and marks the asset `live`.

## Cloud light-up

The deploy workflow ships migration 11 and the `onboarding-enrich` function
automatically. To enable the AI pass on a hosted project:

```bash
supabase secrets set ENRICH_SHARED_SECRET=<random>   # if not already set
# then, as service role (SQL editor):
select configure_onboarding_enrichment(
  'https://<project-ref>.supabase.co/functions/v1/onboarding-enrich',
  '<ENRICH_SHARED_SECRET value>'
);
```

The function uses the copilot's OpenAI key by default (`OPENAI_API_KEY`,
model `gpt-4o-mini`); override with `ONBOARD_LLM_BASE_URL` /
`ONBOARD_LLM_API_KEY` / `ONBOARD_LLM_MODEL` to run it on a different provider.

## Verifying locally

```bash
supabase db reset          # backfills onboarding for all seeded assets
npm run dev                # → /onboarding
npx playwright test        # test 6 covers autofill → HITL → gate
```
