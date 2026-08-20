-- ============================================================================
-- Sync security hardening — creator-private conversations + issued proposals.
--
-- The canonical Cowork tables historically use organization-wide CRUD RLS.
-- That remains appropriate for Cowork, but a Sync conversation can contain
-- role-scoped context and evidence. Sync rows are therefore readable only by
-- their creator, while writes remain server-owned through sync-runtime.
--
-- Tool confirmation is also a two-step server contract: Sync records the exact
-- proposal it issued before it can be confirmed. Only a matching, unexpired,
-- same-user proposal may reach the existing governed application RPC.
-- ============================================================================

-- Preserve existing organization-wide Cowork behavior for non-Sync workspaces,
-- while making Sync conversations creator-private and server-written.
drop policy if exists cowork_workspaces_org_rw on public.cowork_workspaces;
drop policy if exists cowork_workspaces_non_sync_org_rw on public.cowork_workspaces;
drop policy if exists cowork_workspaces_sync_read_own on public.cowork_workspaces;

create policy cowork_workspaces_non_sync_org_rw
  on public.cowork_workspaces
  for all to authenticated
  using (
    organization_id = app_current_org()
    and workspace_kind <> 'sync'
  )
  with check (
    organization_id = app_current_org()
    and workspace_kind <> 'sync'
  );

create policy cowork_workspaces_sync_read_own
  on public.cowork_workspaces
  for select to authenticated
  using (
    organization_id = app_current_org()
    and workspace_kind = 'sync'
    and created_by = auth.uid()::text
  );

-- Messages inherit Sync visibility through their owning workspace. Non-Sync
-- rows keep the prior organization-wide behavior, including legacy rows with
-- no workspace_id.
drop policy if exists cowork_messages_org_rw on public.cowork_messages;
drop policy if exists cowork_messages_non_sync_org_rw on public.cowork_messages;
drop policy if exists cowork_messages_sync_read_own on public.cowork_messages;

create policy cowork_messages_non_sync_org_rw
  on public.cowork_messages
  for all to authenticated
  using (
    organization_id = app_current_org()
    and (
      workspace_id is null
      or exists (
        select 1
        from public.cowork_workspaces w
        where w.id = cowork_messages.workspace_id
          and w.organization_id = app_current_org()
          and w.workspace_kind <> 'sync'
      )
    )
  )
  with check (
    organization_id = app_current_org()
    and (
      workspace_id is null
      or exists (
        select 1
        from public.cowork_workspaces w
        where w.id = cowork_messages.workspace_id
          and w.organization_id = app_current_org()
          and w.workspace_kind <> 'sync'
      )
    )
  );

create policy cowork_messages_sync_read_own
  on public.cowork_messages
  for select to authenticated
  using (
    organization_id = app_current_org()
    and exists (
      select 1
      from public.cowork_workspaces w
      where w.id = cowork_messages.workspace_id
        and w.organization_id = app_current_org()
        and w.workspace_kind = 'sync'
        and w.created_by = auth.uid()::text
    )
  );

-- A proposal is recorded before it is emitted to the caller. Store only the
-- hash of parameters rather than the raw payload because audit_events remains
-- an organization-level audit surface.
create unique index if not exists idx_audit_sync_tool_proposal_issued
  on public.audit_events (
    organization_id,
    ((event_data ->> 'proposal_id'))
  )
  where entity_type = 'sync_tool_proposal'
    and event_data ? 'proposal_id';
