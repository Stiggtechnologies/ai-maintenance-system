-- ============================================================================
-- Sync conversation persistence — extend the canonical Cowork store.
--
-- Sync Phase 0's gap map explicitly rejected a parallel sync_conversations /
-- sync_messages store while cowork_workspaces + cowork_messages can carry the
-- same identity. This migration therefore extends those canonical tables with
-- only the metadata Sync needs for resumable, structured turns.
--
-- Tenancy does not move: both tables already have organization_id NOT NULL,
-- RLS enabled, and organization_id = app_current_org() FOR ALL policies. No
-- policy, grant, approval boundary or autonomous action is widened here.
--
-- Tool idempotency also reuses the canonical audit_events chain rather than
-- introducing a Sync-only execution ledger. The partial unique index turns an
-- idempotency key into an organization-scoped reservation before any governed
-- RPC is called, so concurrent confirms cannot both perform the same action.
-- ============================================================================

alter table public.cowork_workspaces
  add column if not exists workspace_kind text not null default 'cowork',
  add column if not exists mode text not null default 'conversation',
  add column if not exists retention_policy text not null default 'tenant_default',
  add column if not exists context_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists last_turn_at timestamptz;

comment on column public.cowork_workspaces.workspace_kind is
  'Canonical workspace discriminator. Sync conversations use sync; existing Cowork rows remain cowork.';
comment on column public.cowork_workspaces.context_snapshot is
  'Permission-filtered application context captured for continuity; never an authorization grant.';

alter table public.cowork_messages
  add column if not exists turn_id uuid,
  add column if not exists delivery_status text not null default 'complete',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists blocks jsonb not null default '[]'::jsonb,
  add column if not exists evidence_refs jsonb not null default '[]'::jsonb;

comment on column public.cowork_messages.blocks is
  'Structured Sync assistant blocks; prose is still stored in message for backwards-compatible readers.';
comment on column public.cowork_messages.evidence_refs is
  'Evidence references emitted with the turn. References, not copied source documents.';

create index if not exists idx_cowork_workspaces_sync_recent
  on public.cowork_workspaces (organization_id, workspace_kind, updated_at desc);
create index if not exists idx_cowork_messages_turn
  on public.cowork_messages (workspace_id, turn_id, created_at);

create unique index if not exists idx_audit_sync_tool_idempotency
  on public.audit_events (
    organization_id,
    ((event_data ->> 'idempotency_key'))
  )
  where entity_type = 'sync_tool_execution'
    and event_data ? 'idempotency_key';
