# Sync Runtime — End-to-End Implementation

**Branch:** `agent/sync-e2e-runtime`

**Baseline:** built on the post-Phase-0 architecture where the broken JAVIS runtime is retired and Sync uses the live `organization_id` / `app_current_org()` tenancy model.

## What this vertical implements

Sync is the interaction/orchestration layer around the existing governed industrial intelligence stack. It does **not** replace the Reliability Engineer, RAG, approval system, audit chain, provider resilience, or tenant controls.

### Phase 1 — global shell and persistence

- The existing `CopilotDock` remains the one global interaction surface.
- `sync_global_shell = false` preserves the pre-Sync Copilot path.
- `sync_global_shell = true` switches the dock to the authenticated `sync-runtime` SSE endpoint.
- Conversations resume from the canonical `cowork_workspaces` / `cowork_messages` store. No `sync_conversations` or parallel message store exists.
- Turns store structured blocks, evidence references, route/mode metadata, and application context snapshots.
- Stop and regenerate are user-visible controls.

### Phase 2 — voice

- Voice input reuses the browser speech-recognition adapter already present in the repository.
- Voice output is a browser `speechSynthesis` adapter behind `sync_voice_output`.
- Starting dictation stops active TTS first, providing a browser-level barge-in path.
- Unsupported browsers fail honestly by hiding the unavailable control.

### Application context

Every Sync turn can carry a bounded, permission-filtered context envelope:

- current route / application surface;
- current entity reference when the route has a stable UUID;
- interaction mode;
- role-aware operating KPI and open-recommendation context.

Context is useful evidence for the turn; it is never an authorization grant. Tool execution re-derives authorization server-side.

### Phase 4 — specialist routing

- `sync_agent_routing` activates the existing `selectReliabilitySpecialists()` registry/selector.
- The routed specialist brief is passed through the existing `ai-agent-processor` Reliability Engineer path.
- Sync does not call OpenAI or another model provider directly. Therefore the existing RAG, provider failover, model selection, daily organization quota reservation, usage settlement, and provider-health logging remain authoritative.

### Phase 5 — governed actions

The first production action vertical is `raise_maintenance_notification` on an asset context.

1. Sync may emit a typed `tool.proposed` event.
2. No write occurs from the proposal.
3. The user must press **Confirm action**.
4. `sync-runtime` verifies `sync_tools` again server-side.
5. The runtime reserves an organization-scoped idempotency/proposal key in the canonical `audit_events` chain.
6. Execution calls the existing `raise_maintenance_notification` SECURITY DEFINER RPC using the **caller's bearer token**, so `auth.uid()`, `app_current_org()` and the RPC's own refusal rules remain authoritative.
7. The typed stream reports `tool.started` / `tool.completed`; model prose cannot claim execution state.

The database has unique partial indexes for both proposal ID and idempotency key, preventing double-click/retry duplication.

### Phase 6 — meeting mode

`sync_meeting_mode` is checked on both client and server. The server-owned facilitation contract requires Sync to keep separate:

- confirmed facts;
- hypotheses / proposals;
- decisions explicitly made by participants;
- dissent and unresolved disagreement;
- actions / owners;
- missing evidence.

Sync does not infer speaker identity from audio/text and does not treat silence as consensus.

### Phase 7 — field mode

`sync_field_mode` is checked on both client and server. Its server-owned contract requires bounded, voice-friendly guidance and prohibits instructions to bypass:

- isolation / LOTO;
- interlocks and protective functions;
- approved procedures;
- OEM/site limits;
- permits;
- qualified human authority.

User and sensor observations remain evidence, not authorization. When a required procedure, limit, isolation state, or acceptance criterion is absent from approved evidence, the contract requires stopping that branch and identifying the qualified source/role needed.

## Tenant rollout controls

All seven Sync flags remain default OFF. No organization is enabled by migration.

Administrators (`admin`, `ai_admin`) get a **Settings → Sync** rollout surface. It calls `set_sync_feature_flag()` rather than writing `feature_flags` directly. The SECURITY DEFINER function independently checks the user's organization and role and records every change in `audit_events`.

Recommended canary order:

1. `sync_global_shell`
2. `sync_voice_input`, `sync_voice_output`
3. `sync_agent_routing`
4. `sync_tools`
5. `sync_meeting_mode`
6. `sync_field_mode`

The global shell is the master gate; all other capabilities are inert while it is off.

## Deployment

`sync-runtime` is now part of the explicit Edge Function boundary and the migration deploy workflow. It is **not** a `--no-verify-jwt` function.

## Validation added

`src/lib/sync/sync-runtime-contract.test.ts` structurally pins the following requirements:

- Sync does not create a direct/unmetered LLM rail;
- server-side feature gates exist;
- meeting/field boundaries are server-owned;
- canonical Cowork persistence is reused;
- confirmed action execution is human-initiated, user-scoped and idempotent;
- rollout mutation is admin-only and audited;
- the deployment boundary contains `sync-runtime`;
- the global shell exposes stream, stop/regenerate, voice and conversation resume.

## Known limitations — do not overclaim

1. **Model-token streaming:** the network transport is real SSE and retrieval/tool/turn state is typed, but the existing `ai-agent-processor` provider call is request/response. `sync-runtime` frames the completed governed answer into bounded `assistant.delta` events after the provider returns. True provider-token streaming should be added inside the existing provider/quota abstraction, not by bypassing it.
2. **Cancellation at the provider:** cancelling Sync aborts the edge-to-edge call and closes the stream. The current `ai-agent-processor` does not explicitly compose the inbound request abort signal into its model-provider fetch. Do not claim guaranteed token savings until that shared provider path is extended and regression-tested.
3. **Voice transport:** Phase 2 currently uses browser STT/TTS adapters. It is not yet a server speech platform, telephony layer, wake-word service, or wearable audio transport.
4. **Meeting capture:** meeting mode provides governed facilitation semantics; it does not yet provide authenticated multi-speaker capture/diarization, calendar joining, or a dedicated meeting-outcome persistence model.
5. **Field execution:** field mode is controlled conversational guidance; it is not an offline wearable procedure engine and does not create a control-system write path.
6. **Tool breadth:** one low-risk reporting tool is wired end-to-end. Additional tools must be registered only by wrapping existing governed RPCs and preserving their role/approval boundaries.

These limitations preserve the roadmap's architecture: expand the existing governed seams rather than creating a second assistant, second audit log, second persistence store, or unmetered model path.
