# SyncAI Guard

**2026-10-06 — MVP, feature-flagged off.** This is a governed security module for SyncAI's own assistant and for seeded operational-technology telemetry. It does not command plant equipment. NVIDIA Morpheus is not used (end of support in NVIDIA AI Enterprise as of January 2026). The Python NeMo Guardrails process is not embedded in this app.

## What it does

Two jobs, both behind the organization flag `syncai_guard` (default **off**):

1. **Assistant rails.** When the flag is on, `sync-investigation-runtime` evaluates input before the model is reserved and output before the answer is shown or stored. A block is written to `audit_events` (`entity_type = syncai_guard_rail`) and the caller receives a refusal. An allow is logged the same way. Token deltas are held until the output rail allows them.
2. **Anomaly findings.** `raise_syncai_guard_findings` screens this organization's existing `condition_readings` and inserts pending `recommendations`, `evidence_items`, and `approvals` with status `required`. The Guard page approves or rejects through `approveRecommendation` and `setRecommendationStatus`, so the named human, decision, work action, and learning event stay on the existing operating loop. The function does not insert `work_orders`, `autonomous_actions`, or `autonomous_decisions`.

`agent_id` is left null. The agent-control trigger refuses an agent that has no adopted control profile, and this MVP does not invent that adoption.

## Canonical models reused

| Concern                          | Existing store                                                         |
| -------------------------------- | ---------------------------------------------------------------------- |
| Rollout                          | `feature_flags` key `syncai_guard`                                     |
| Rail evidence                    | `audit_events`                                                         |
| Finding                          | `recommendations` (`source_finding_id` prefix `syncai-guard:`)         |
| Cited reading or synthetic event | `evidence_items`                                                       |
| Named human decision             | `approvals`, then the operating-loop approve/reject path               |
| Telemetry                        | `condition_readings`, `sensors.alarm_limit`, `sensors.limit_direction` |

No new table, queue, audit log, or approval engine.

The flag is not one of the seven `sync_*` catalogue flags. Those stay exact. Administrators change this flag only through `set_syncai_guard_enabled`, which checks `admin` or `ai_admin` in `app_current_org()` and writes an audit row. A missing or unreadable flag is off.

## Where the rails run

Rails run on the Sync investigation assistant (`CopilotDock` → `sync-investigation-runtime`) and only when `syncai_guard` is enabled. The dock uses that runtime when `sync_global_shell` is also on. The older `ai-agent-processor` path (including Reliability Engineer turns that stay behind the RE-2026.08 gate) is **not** wrapped in this MVP. Wrapping it would edit protected baseline files.

The provider lives in `supabase/functions/_shared/syncai-guard.ts`.

- No `NVIDIA_API_KEY`: deterministic local mock (jailbreak patterns, a narrow content list, topic patterns that yield to industrial context, and credential patterns).
- Key present: NVIDIA Guardrails NIM over the hosted OpenAI-compatible API.
  - Content safety: `nvidia/llama-3.1-nemotron-safety-guard-8b-v3` at `/chat/completions`
  - Topic control: `nvidia/llama-3.1-nemoguard-8b-topic-control` at `/chat/completions`
  - Jailbreak: `nvidia/nemoguard-jailbreak-detect` at `/v1/classify`
- Default base URL: `https://integrate.api.nvidia.com/v1`
- A NIM transport or parse failure falls back to the local mock and labels the decision `nvidia-nim-degraded`. It does not fail open.
- Sensitive-data checks stay local. A matched secret is not copied into the audit excerpt.

`config/syncai-guard/config.yml` is the config a NeMo Guardrails server would load for the same model ids, topic policy, and jailbreak cutoff (`0.5`, a classifier setting, not an equipment limit). The app speaks the NIM HTTP contract directly.

## Anomaly rule `guard-anomaly-v1`

Screening only. Not an OEM limit and not a diagnosis.

- At least 8 earlier readings with `quality = 'good'`.
- Sample standard deviation (`stddev_samp`). Default z is 3. Allowed range is 2 through 6, a statistical screening constant.
- A limit breach uses only the sensor's stored `alarm_limit` and `limit_direction`.
- At most 20 findings per scan.
- The same sensor is not raised twice on the same UTC day (`source_finding_id`).
- One explicitly synthetic authentication-failure finding may be added so the approval loop can be exercised. It is labelled synthetic. It is not a live incident and not customer telemetry. It has no asset, so the existing recommendation contract refuses to approve it. Reject still works.
- Each finding also fills the five release-contract fields (`consequence_summary`, `alternatives_considered`, `required_completion_date`, `required_approver_role`, `verification_method`). The completion date is the next calendar day and is described as a review deadline, not an equipment interval. Consequence text says magnitude is not quantified.

The TypeScript spec is `supabase/functions/_shared/syncai-guard-anomaly.ts`. The SQL function is the one the page calls.

## Garak

`.github/workflows/garak.yml` runs `scripts/garak-scan.sh` on pull requests and on manual dispatch. The script exits 0 when `NVIDIA_API_KEY` is unset or the `garak` CLI is not installed, and it never prints the key. Probes are `promptinject` and `dan` (`config/syncai-guard/garak-probes.txt`). This workflow is not a required check and does not change the production flag.

## How to turn it on

Production stays off until both of the following are true. This pull request does not change deploy configuration.

1. Create an NVIDIA account at [build.nvidia.com](https://build.nvidia.com) and generate an API key for the hosted NIM catalog (`integrate.api.nvidia.com`).
2. Set the key as a **server** secret on the `sync-investigation-runtime` edge function. Do not put it in a `VITE_` variable or in the repository.
   - `NVIDIA_API_KEY` (required for live NIM; omit it to keep the local mock)
   - `NVIDIA_GUARDRAILS_BASE_URL` (optional; default `https://integrate.api.nvidia.com/v1`; point this at a self-hosted NIM under NVIDIA AI Enterprise later)
   - `NVIDIA_JAILBREAK_BASE_URL` (optional; defaults to the same base; jailbreak detect uses `/classify` on this host)
3. An administrator or AI administrator opens **SyncAI Guard** (`/guard`) and turns the flag on, or calls `set_syncai_guard_enabled(true)` in that organization's session.
4. For the assistant rails to be on the path users actually hit, `sync_global_shell` must also be enabled. That flag is a separate, existing rollout control and stays off until someone turns it on.
5. Optional Garak: install the `garak` CLI in the job environment, set the `NVIDIA_API_KEY` repository secret, and run the workflow or `bash scripts/garak-scan.sh`.

With the flag on and no key, rails still run. They use the local mock.

## What is real and what is mocked

| Piece                                                | State in this MVP                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Provider interface, NIM HTTP client, degrade-to-mock | Real code. Live NIM runs only when `NVIDIA_API_KEY` is set.                                                                    |
| NeMo `config.yml`                                    | Real config for a future NeMo Guardrails server. No Python runtime in the app.                                                 |
| Local mock rails                                     | Real and deterministic. They are the no-key provider and the NIM failure fallback. They are pattern gates, not the NIM models. |
| Rail audit rows                                      | Real inserts into `audit_events` when the flag is on and a turn is evaluated.                                                  |
| Anomaly SQL and findings                             | Real writes into recommendations, evidence, and approvals, from this tenant's seeded or simulated readings.                    |
| Synthetic auth-burst                                 | Explicitly synthetic.                                                                                                          |
| Garak                                                | Real script and workflow. Skipped until a key and the CLI exist.                                                               |
| Morpheus                                             | Not used.                                                                                                                      |
| `ai-agent-processor` / RE baseline path              | Not wrapped.                                                                                                                   |
| Plant or OT commands                                 | Not implemented. `plant_execution` on these records is `disabled`.                                                             |

## Governance

- Safety-critical and operational action stays human-approved. Approval uses the existing operating-loop function, which records the signed-in user as the human actor. Approval is not outcome verification.
- Tenant scope is `app_current_org()` inside both security-definer functions. Both revoke `public` and `anon` and grant `authenticated`.
- The page is on the AI Workforce nav group. Admin and AI-admin roles see the full nav. Other role allow-lists are unchanged, so this MVP does not widen their menus. Server-side RLS and the flag RPC remain the authority.
- No customer, operator, OEM, site, or vendor data is added. Findings describe the tenant's existing seeded telemetry or say they are synthetic.

## Rollback

Turn the flag off. The assistant path stops calling the rails; existing recommendations remain ordinary pending or decided rows. The migration is additive (one flag seed, two functions). Dropping the functions and deleting the flag row reverses it. Do not delete audit rows; the ledger is append-only.

## Tests

- `src/test/syncaiGuard.test.ts` — mock rails, NIM client, degrade path, anomaly rule, SQL and wiring contracts.
- `src/pages/SyncAiGuardPage.test.tsx` — rail list, approve via the operating loop, fail-closed flag read.
- `src/lib/roleNavigation.test.ts` — `/guard` is on the shell, palette, and router.
