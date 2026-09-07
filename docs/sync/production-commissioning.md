# Sync Production Commissioning

A Sync release is not closed at merge time. It is closed only when production evidence proves the backend release, rollout state, runtime execution, trace truthfulness, latency baseline, and Recovery/governance compatibility.

## Required gates

1. Protected `main` contains the intended release commit.
2. Production migrations are current: `supabase db push --dry-run --include-all` reports the linked project is up to date after deploy.
3. `sync-investigation-runtime` is reachable at the production Edge Function boundary. An unauthenticated POST must return `401` (deployed and JWT-protected), not `404`.
4. The commissioning organization has `sync_global_shell` enabled. Additional `sync_*` flags are enabled only as required by the acceptance scope.
5. Real authenticated acceptance passes in `https://app.syncai.ca`: lightweight chat, capability conversation, investigation, engineering diagnosis, attachment grounding, conversation lifecycle, Stop/Regenerate, governed action confirmation/execution, persistent `What Sync checked`, provenance chips, and expanded mode.
6. Persisted investigation checks correspond to actual server-side work and attached evidence; decorative progress is a release blocker.
7. Per-turn telemetry captures first activity, first evidence, first token, retrieval, specialist, model, and total latency. A commissioning baseline is recorded from real production turns.
8. Recovery and Investigation Runtime v2 coexist without fallback regression; governance/approval boundaries remain enforced.

## Evidence packet

For each commissioning investigation retain: release SHA, organization ID, conversation/workspace ID, turn/request ID, runtime path/version, feature-flag snapshot, activity/evidence events, persisted `What Sync checked`, evidence references, specialist/tool execution, approval record when applicable, latency telemetry, and final outcome.

## Closure rule

`merged -> backend verified -> tenant enabled -> real production investigation succeeds -> trace/evidence verified -> latency measured -> Recovery/governance regression check passes`.

No gate may be marked green from UI appearance alone.

## Observation-vs-fault classifier recheck (issue #251 / PR #256)

Unit tests prove the shared classifier keeps an explicit observation when later prose mentions "fault". Live production still requires an Orville-authenticated proposal-only check after `sync-investigation-runtime` deploys from the #256 merge. Do not confirm or execute the action.

### Preconditions

1. PR #256 is merged to protected `main`.
2. Deploy workflow `Deploy migrations` has deployed `sync-investigation-runtime` for that SHA. Confirm the unauthenticated POST to `https://pjvoswbwomesuwhygpby.supabase.co/functions/v1/sync-investigation-runtime` returns `401`, not `404`.
3. Operator is Orville (`admin` / `ai_admin`) on the seeded demo tenant in `https://app.syncai.ca`.
4. Seeded demo asset Conveyor C-22 (`aaaaaaaa-0000-0000-0000-000000000001`) is reachable.

### Exact steps

1. Open `/settings` → Sync. Record the current tenant `Governed actions` (`sync_tools`) state.
2. If `sync_tools` is disabled, enable it for this check only. `sync_global_shell` must already be on.
3. Open `/assets/aaaaaaaa-0000-0000-0000-000000000001` (Conveyor C-22) so Sync has asset context (`entity.type = asset`).
4. Send this exact prompt and do not press Confirm:

   `Create a maintenance notification observation for this asset: synthetic acceptance only; no real equipment fault exists.`

5. Pass only if the proposal title is `Report this observation on Conveyor C-22` (or `... on the current asset`) and `notificationType` is `observation`. Fail if the title is `Report this fault...`.
6. Dismiss the proposal. Do not confirm, execute, or create a maintenance notification.
7. Restore `Governed actions` (`sync_tools`) to disabled immediately if it was disabled before the check.

### Evidence template

```
#251 observation-vs-fault production recheck
Date / operator:
main SHA:
Deploy run URL:
Runtime unauthenticated POST status (expect 401):
Organization ID:
Asset: Conveyor C-22 / aaaaaaaa-0000-0000-0000-000000000001
Conversation / workspace ID:
Turn / request ID:
sync_global_shell:
sync_tools before / during / after (must return to prior state):
Exact prompt used:
Proposal title observed:
Proposal notificationType observed:
Confirmed / executed? (must be no):
Result: PASS observation | FAIL fault or no proposal
Notes:
```
