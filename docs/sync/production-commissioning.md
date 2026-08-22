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
