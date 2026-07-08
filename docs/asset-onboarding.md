# Autonomous Asset Onboarding

SyncAI onboards assets **autonomously**: the platform fills every checklist
item it can find or deduce, and asks a human only for what genuinely cannot be
found in the data. This implements the full SyncAI RAM onboarding checklist
(DoD RAM Guide aligned — reliability, availability, maintainability), sections
1–23.

Onboarding covers four layers (RAM guide: reliability management is a
lifecycle activity):

| Layer                 | Sections      | Purpose                                 |
| --------------------- | ------------- | --------------------------------------- |
| Asset master data     | 1–8           | What the asset is                       |
| Reliability strategy  | 9–19          | How it fails and how it is maintained   |
| Data & AI readiness   | 20, 23–25, 27 | How SyncAI monitors and learns          |
| Governance & workflow | 22, 26, 28–32 | How insights become action, audit-ready |

## How the checklist maps into the product

| Checklist section           | Where it lives                                                         |
| --------------------------- | ---------------------------------------------------------------------- |
| 1–19 + 20–32 (data)         | `onboarding_requirements` catalog → per-asset `asset_onboarding_items` |
| Workflow sequence           | The engine: seed → autofill → governance pass → AI pass → HITL → gate  |
| Minimum data before go-live | `required_for_golive` flags checked by `get_golive_readiness()`        |
| Onboarding template         | The catalog is the template — rendered in the Asset Onboarding hub     |
| Definition of done          | `approve_asset_golive()` — all required flags + SME sign-off → `live`  |

## Governance & lifecycle layer (migration 12)

- **Data quality gate (S20)** — 8 automated checks (tag accuracy, duplicates,
  required fields, unit consistency, sensor validation, time alignment, data
  gaps, bad-data rules). The gate item is **required for go-live**; failing
  checks route it to the human queue with the failures listed.
- **Asset boundary (S2, upgraded)** — AI drafts an explicit boundary
  statement; now required for go-live.
- **Failure coding standard (S22)** — mode/cause/effect/remedy/detection
  taxonomies assigned deterministically from the FMEA library; FRACAS loop
  documented (MIL-HDBK-338B).
- **Operating context (S23)** — duty, severity, process fluid, contamination,
  cycling, load profile, abnormal modes. AI deduces what an engineer could;
  start/stop frequency stays human (site-specific).
- **AI model governance (S24)** — purpose, training window, exclusions, alert
  confidence levels, false-positive/negative processes, review cycle and
  change log — auto-filled from the platform's real posture.
- **Alert response playbook (S25)** — advisory→monitor … false→feedback,
  encoded per asset.
- **Closeout discipline (S26)** — `close_work_order()` refuses completion
  without failure mode, cause, corrective action, labour and downtime hours;
  AI-generated work also asks "was the SyncAI alert useful?", writing
  accepted/false-positive learning events.
- **Reliability targets (S27)** — AI-suggested per class/criticality, human
  overridable.
- **Lifecycle status (S28)** — `assets.lifecycle_status`
  (new/active/standby/mothballed/obsolete/end_of_life/decommissioned).
- **Management of change (S29)** — sensor/component configuration changes
  fire triggers that re-run the autonomous review and log an MOC learning
  event.
- **Cybersecurity & access (S30)** — RLS/roles/audit/backup posture
  auto-documented; network zone and remote access stay human.
- **Training (S31)** — role-training record, human.
- **Audit & approval trail (S32)** — operations, maintenance, reliability,
  data/IT and HSE approvals are individual **go-live-required** human items;
  the asset owner's final business approval is the SME go-live action itself.

**Revised definition of done:** an asset is not fully onboarded until its
asset boundary, data quality, failure coding, AI governance, alert-response
workflow, closeout requirements, lifecycle status, cybersecurity access and
five-role approval trail are complete — enforced automatically because the
go-live gate derives from the `required_for_golive` flags.

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
