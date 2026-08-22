-- ============================================================================
-- Sync Investigation Runtime v2 — canonical Cowork attachment + conversation controls.
--
-- This migration extends the existing creator-private Sync/Cowork model. It does
-- NOT create a second conversation, message, evidence, audit or workflow store.
-- Files are source material referenced from Cowork turns; engineering evidence
-- continues to use Sync EvidenceReference / the canonical evidence model.
--
-- Direct writes to Sync workspaces/messages remain server-owned. Conversation
-- lifecycle mutations are SECURITY DEFINER RPCs that verify current org +
-- creator. Attachment metadata may be inserted by the creator after the private
-- storage object is uploaded. Storage keys are org/user/workspace/object.
-- ============================================================================

create table if not exists public.cowork_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.cowork_workspaces(id) on delete cascade,
  message_id uuid references public.cowork_messages(id) on delete set null,
  uploaded_by uuid not null references public.user_profiles(id) on delete cascade,
  file_name text not null,
  mime_type text,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  object_path text not null,
  content_sha256 text,
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending','extracting','ready','unsupported','failed')),
  extracted_text text,
  extraction_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, object_path)
);

comment on table public.cowork_attachments is
  'Creator-private source files attached to canonical Cowork/Sync workspaces; not a parallel evidence or RAG store.';
comment on column public.cowork_attachments.extracted_text is
  'Permission-scoped text extraction used only as turn context; source object remains authoritative.';

create index if not exists idx_cowork_attachments_workspace
  on public.cowork_attachments (workspace_id, created_at desc)
  where deleted_at is null;

alter table public.cowork_attachments enable row level security;

drop policy if exists cowork_attachments_sync_read_own on public.cowork_attachments;
create policy cowork_attachments_sync_read_own
  on public.cowork_attachments for select to authenticated
  using (
    organization_id = public.app_current_org()
    and uploaded_by = auth.uid()
    and exists (
      select 1 from public.cowork_workspaces w
      where w.id = workspace_id
        and w.organization_id = public.app_current_org()
        and w.workspace_kind = 'sync'
        and w.created_by = auth.uid()::text
    )
  );

drop policy if exists cowork_attachments_sync_insert_own on public.cowork_attachments;
create policy cowork_attachments_sync_insert_own
  on public.cowork_attachments for insert to authenticated
  with check (
    organization_id = public.app_current_org()
    and uploaded_by = auth.uid()
    and exists (
      select 1 from public.cowork_workspaces w
      where w.id = workspace_id
        and w.organization_id = public.app_current_org()
        and w.workspace_kind = 'sync'
        and w.created_by = auth.uid()::text
    )
  );

-- Browser clients cannot write extracted text/status. The edge runtime uses the
-- service role after re-validating workspace ownership. Deletion is represented
-- by object removal plus a server-side tombstone, not arbitrary client UPDATE.

insert into storage.buckets (id, name, public, file_size_limit)
values ('sync-attachments', 'sync-attachments', false, 26214400)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit;

-- Storage key: organization_id / user_id / workspace_id / generated-file-name.
drop policy if exists sync_attachments_read_own on storage.objects;
create policy sync_attachments_read_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'sync-attachments'
    and (storage.foldername(name))[1] = public.app_current_org()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists sync_attachments_insert_own on storage.objects;
create policy sync_attachments_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sync-attachments'
    and (storage.foldername(name))[1] = public.app_current_org()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists sync_attachments_delete_own on storage.objects;
create policy sync_attachments_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'sync-attachments'
    and (storage.foldername(name))[1] = public.app_current_org()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create or replace function public.create_sync_conversation(
  p_title text default 'New Sync conversation',
  p_mode text default 'conversation'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_id uuid;
  v_mode text := case when p_mode in ('conversation','meeting','field') then p_mode else 'conversation' end;
begin
  if v_org is null or auth.uid() is null then
    raise exception 'Authenticated organization context required';
  end if;

  insert into public.cowork_workspaces (
    organization_id, title, objective, status, agents, created_by,
    workspace_kind, mode, retention_policy, context_snapshot, last_turn_at
  ) values (
    v_org,
    left(coalesce(nullif(btrim(p_title),''),'New Sync conversation'), 90),
    'Governed Sync conversation',
    'active',
    array['sync','reliability-engineer']::text[],
    auth.uid()::text,
    'sync',
    v_mode,
    'tenant_default',
    '{}'::jsonb,
    now()
  ) returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.create_sync_conversation(text,text) from public;
grant execute on function public.create_sync_conversation(text,text) to authenticated;

create or replace function public.rename_sync_conversation(
  p_workspace_id uuid,
  p_title text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
begin
  if nullif(btrim(p_title),'') is null then raise exception 'Title is required'; end if;
  update public.cowork_workspaces
     set title = left(btrim(p_title), 90), updated_at = now()
   where id = p_workspace_id
     and organization_id = v_org
     and workspace_kind = 'sync'
     and created_by = auth.uid()::text;
  if not found then raise exception 'Sync conversation not found'; end if;
end;
$$;
revoke all on function public.rename_sync_conversation(uuid,text) from public;
grant execute on function public.rename_sync_conversation(uuid,text) to authenticated;

create or replace function public.archive_sync_conversation(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
begin
  update public.cowork_workspaces
     set status = 'completed', updated_at = now()
   where id = p_workspace_id
     and organization_id = v_org
     and workspace_kind = 'sync'
     and created_by = auth.uid()::text;
  if not found then raise exception 'Sync conversation not found'; end if;
end;
$$;
revoke all on function public.archive_sync_conversation(uuid) from public;
grant execute on function public.archive_sync_conversation(uuid) to authenticated;

create or replace function public.restore_sync_conversation(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
begin
  update public.cowork_workspaces
     set status = 'active', updated_at = now()
   where id = p_workspace_id
     and organization_id = v_org
     and workspace_kind = 'sync'
     and created_by = auth.uid()::text;
  if not found then raise exception 'Sync conversation not found'; end if;
end;
$$;
revoke all on function public.restore_sync_conversation(uuid) from public;
grant execute on function public.restore_sync_conversation(uuid) to authenticated;

create or replace function public.delete_sync_conversation(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
begin
  -- Storage objects are removed by the client/edge path before this call; the
  -- DB cascade removes attachment/message references. No cross-user deletion.
  delete from public.cowork_workspaces
   where id = p_workspace_id
     and organization_id = v_org
     and workspace_kind = 'sync'
     and created_by = auth.uid()::text;
  if not found then raise exception 'Sync conversation not found'; end if;
end;
$$;
revoke all on function public.delete_sync_conversation(uuid) from public;
grant execute on function public.delete_sync_conversation(uuid) to authenticated;
