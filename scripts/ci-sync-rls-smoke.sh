#!/usr/bin/env bash
set -euo pipefail

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
begin;

select id as org_id
from public.organizations
order by created_at, id
limit 1
\gset

insert into public.user_profiles (id, organization_id, email, role)
values
  ('11111111-1111-4111-8111-111111111111', :'org_id', 'sync-rls-a@example.invalid', 'reliability_engineer'),
  ('22222222-2222-4222-8222-222222222222', :'org_id', 'sync-rls-b@example.invalid', 'planner');

insert into public.cowork_workspaces (
  id, organization_id, title, objective, status, agents, created_by,
  workspace_kind, mode, retention_policy, context_snapshot
)
values
  (
    '11111111-aaaa-4aaa-8aaa-111111111111', :'org_id', 'Sync A', 'RLS smoke', 'active',
    array['sync'], '11111111-1111-4111-8111-111111111111', 'sync', 'conversation',
    'tenant_default', '{"role_scoped":"A"}'::jsonb
  ),
  (
    '22222222-bbbb-4bbb-8bbb-222222222222', :'org_id', 'Sync B', 'RLS smoke', 'active',
    array['sync'], '22222222-2222-4222-8222-222222222222', 'sync', 'conversation',
    'tenant_default', '{"role_scoped":"B"}'::jsonb
  ),
  (
    '33333333-cccc-4ccc-8ccc-333333333333', :'org_id', 'Cowork shared', 'RLS smoke', 'active',
    array['reliability-engineer'], '22222222-2222-4222-8222-222222222222', 'cowork', 'conversation',
    'tenant_default', '{}'::jsonb
  );

insert into public.cowork_messages (
  id, organization_id, workspace_id, role, message, delivery_status
)
values
  (
    '11111111-dddd-4ddd-8ddd-111111111111', :'org_id',
    '11111111-aaaa-4aaa-8aaa-111111111111', 'agent', 'private-A', 'complete'
  ),
  (
    '22222222-eeee-4eee-8eee-222222222222', :'org_id',
    '22222222-bbbb-4bbb-8bbb-222222222222', 'agent', 'private-B', 'complete'
  ),
  (
    '33333333-ffff-4fff-8fff-333333333333', :'org_id',
    '33333333-cccc-4ccc-8ccc-333333333333', 'agent', 'shared-cowork', 'complete'
  );

insert into public.cowork_attachments (
  id, organization_id, workspace_id, uploaded_by, file_name, mime_type,
  size_bytes, object_path, extraction_status, extracted_text
)
values
  (
    '11111111-1234-4234-8234-111111111111', :'org_id',
    '11111111-aaaa-4aaa-8aaa-111111111111',
    '11111111-1111-4111-8111-111111111111', 'a.csv', 'text/csv', 10,
    :'org_id' || '/11111111-1111-4111-8111-111111111111/11111111-aaaa-4aaa-8aaa-111111111111/a.csv',
    'ready', 'private attachment A'
  ),
  (
    '22222222-1234-4234-8234-222222222222', :'org_id',
    '22222222-bbbb-4bbb-8bbb-222222222222',
    '22222222-2222-4222-8222-222222222222', 'b.csv', 'text/csv', 10,
    :'org_id' || '/22222222-2222-4222-8222-222222222222/22222222-bbbb-4bbb-8bbb-222222222222/b.csv',
    'ready', 'private attachment B'
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

DO $$
declare
  own_sync integer;
  other_sync integer;
  own_messages integer;
  other_messages integer;
  shared_cowork integer;
  updated_sync integer;
  own_attachments integer;
  other_attachments integer;
  updated_attachment integer;
  cross_user_blocked boolean := false;
  deleted_path text;
begin
  select count(*) into own_sync
  from public.cowork_workspaces
  where id = '11111111-aaaa-4aaa-8aaa-111111111111';

  select count(*) into other_sync
  from public.cowork_workspaces
  where id = '22222222-bbbb-4bbb-8bbb-222222222222';

  select count(*) into shared_cowork
  from public.cowork_workspaces
  where id = '33333333-cccc-4ccc-8ccc-333333333333';

  select count(*) into own_messages
  from public.cowork_messages
  where id = '11111111-dddd-4ddd-8ddd-111111111111';

  select count(*) into other_messages
  from public.cowork_messages
  where id = '22222222-eeee-4eee-8eee-222222222222';

  select count(*) into own_attachments
  from public.cowork_attachments
  where id = '11111111-1234-4234-8234-111111111111';

  select count(*) into other_attachments
  from public.cowork_attachments
  where id = '22222222-1234-4234-8234-222222222222';

  with changed as (
    update public.cowork_workspaces
    set title = 'client-mutated-sync'
    where id = '11111111-aaaa-4aaa-8aaa-111111111111'
    returning id
  )
  select count(*) into updated_sync from changed;

  with changed as (
    update public.cowork_attachments
    set extracted_text = 'client-mutated-extraction'
    where id = '11111111-1234-4234-8234-111111111111'
    returning id
  )
  select count(*) into updated_attachment from changed;

  perform public.rename_sync_conversation(
    '11111111-aaaa-4aaa-8aaa-111111111111',
    'Owner rename works'
  );
  perform public.archive_sync_conversation('11111111-aaaa-4aaa-8aaa-111111111111');
  perform public.restore_sync_conversation('11111111-aaaa-4aaa-8aaa-111111111111');

  begin
    perform public.rename_sync_conversation(
      '22222222-bbbb-4bbb-8bbb-222222222222',
      'Cross-user rename must fail'
    );
  exception when others then
    cross_user_blocked := true;
  end;

  if own_sync <> 1 then raise exception 'Sync RLS smoke: creator cannot read own Sync workspace'; end if;
  if other_sync <> 0 then raise exception 'Sync RLS smoke: cross-user Sync workspace leaked'; end if;
  if own_messages <> 1 then raise exception 'Sync RLS smoke: creator cannot read own Sync message'; end if;
  if other_messages <> 0 then raise exception 'Sync RLS smoke: cross-user Sync message leaked'; end if;
  if shared_cowork <> 1 then raise exception 'Sync RLS smoke: non-Sync Cowork behavior regressed'; end if;
  if updated_sync <> 0 then raise exception 'Sync RLS smoke: authenticated client mutated server-owned Sync workspace'; end if;
  if own_attachments <> 1 then raise exception 'Sync RLS smoke: creator cannot read own attachment'; end if;
  if other_attachments <> 0 then raise exception 'Sync RLS smoke: cross-user attachment leaked'; end if;
  if updated_attachment <> 0 then raise exception 'Sync RLS smoke: client wrote server-owned extracted attachment content'; end if;
  if not cross_user_blocked then raise exception 'Sync RLS smoke: conversation lifecycle RPC crossed creator boundary'; end if;

  deleted_path := public.delete_sync_attachment('11111111-1234-4234-8234-111111111111');
  if deleted_path is null then raise exception 'Sync RLS smoke: owner attachment delete returned no storage path'; end if;
  if exists (
    select 1 from public.cowork_attachments
    where id = '11111111-1234-4234-8234-111111111111'
      and deleted_at is null
  ) then
    raise exception 'Sync RLS smoke: attachment delete did not tombstone source';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

DO $$
declare
  own_sync integer;
  other_sync integer;
  own_messages integer;
  other_messages integer;
  own_attachments integer;
  cross_delete_blocked boolean := false;
begin
  select count(*) into own_sync
  from public.cowork_workspaces
  where id = '22222222-bbbb-4bbb-8bbb-222222222222';

  select count(*) into other_sync
  from public.cowork_workspaces
  where id = '11111111-aaaa-4aaa-8aaa-111111111111';

  select count(*) into own_messages
  from public.cowork_messages
  where id = '22222222-eeee-4eee-8eee-222222222222';

  select count(*) into other_messages
  from public.cowork_messages
  where id = '11111111-dddd-4ddd-8ddd-111111111111';

  select count(*) into own_attachments
  from public.cowork_attachments
  where id = '22222222-1234-4234-8234-222222222222';

  begin
    perform public.delete_sync_attachment('11111111-1234-4234-8234-111111111111');
  exception when others then
    cross_delete_blocked := true;
  end;

  if own_sync <> 1 or own_messages <> 1 then raise exception 'Sync RLS smoke: second creator cannot read own conversation'; end if;
  if other_sync <> 0 or other_messages <> 0 then raise exception 'Sync RLS smoke: second user can read first user conversation'; end if;
  if own_attachments <> 1 then raise exception 'Sync RLS smoke: second creator cannot read own attachment'; end if;
  if not cross_delete_blocked then raise exception 'Sync RLS smoke: cross-user attachment delete was not blocked'; end if;
end $$;

reset role;
rollback;
SQL

echo "Sync RLS smoke passed: creator-private conversations + attachments + shared non-Sync Cowork + server-owned writes"
