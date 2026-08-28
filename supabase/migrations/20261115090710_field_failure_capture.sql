-- ============================================================================
-- Field failure capture — C2.15 companion, E6.13 first slice
--
-- The field demo loop: scan the asset QR -> report the failure with a camera
-- photo -> the photo lands as governed evidence in the tenant boundary.
--
-- Storage: bucket 'failure-evidence', keys begin with organization_id/.
-- Policies mirror the ria-source-files pattern (20260918100000): folder name
-- IS the tenant, enforced on select/insert/delete.
--
-- The photo register (failure_report_photos) has NO direct-write policy:
-- rows are created only through attach_failure_photo (SECURITY DEFINER),
-- which verifies the notification belongs to the caller's organization.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('failure-evidence', 'failure-evidence', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists failure_evidence_read on storage.objects;
create policy failure_evidence_read on storage.objects for select to authenticated
using (
  bucket_id = 'failure-evidence'
  and (storage.foldername(name))[1] = public.app_current_org()::text
);

drop policy if exists failure_evidence_insert on storage.objects;
create policy failure_evidence_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'failure-evidence'
  and (storage.foldername(name))[1] = public.app_current_org()::text
);

drop policy if exists failure_evidence_delete on storage.objects;
create policy failure_evidence_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'failure-evidence'
  and (storage.foldername(name))[1] = public.app_current_org()::text
);

-- ---------------------------------------------------------------------------
-- The photo register.
-- ---------------------------------------------------------------------------
create table if not exists public.failure_report_photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  notification_id uuid references maintenance_notifications(id) on delete cascade,
  storage_path text not null,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_failure_photos_notif
  on public.failure_report_photos(notification_id);
create index if not exists idx_failure_photos_org
  on public.failure_report_photos(organization_id);

alter table public.failure_report_photos enable row level security;

drop policy if exists failure_report_photos_read on public.failure_report_photos;
create policy failure_report_photos_read on public.failure_report_photos
  for select to authenticated
  using (organization_id = public.app_current_org());

-- No insert/update/delete policies: writes go through attach_failure_photo.

-- ---------------------------------------------------------------------------
-- attach_failure_photo — the governed write path.
-- ---------------------------------------------------------------------------
create or replace function public.attach_failure_photo(
  p_notification_id uuid,
  p_asset_id uuid,
  p_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
    ('admin', 'ai_admin', 'reliability_engineer', 'maintenance_manager',
     'supervisor', 'technician', 'planner', 'operator') then
    return jsonb_build_object('error', 'not authorized to attach field photos');
  end if;

  if p_storage_path is null
    or (storage.foldername(p_storage_path))[1] <> v_org::text then
    return jsonb_build_object('error', 'photo path must live in the caller organization folder');
  end if;

  if not exists (
    select 1 from maintenance_notifications n
    where n.id = p_notification_id
      and n.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'notification not found in this organization');
  end if;

  if not exists (
    select 1 from assets a where a.id = p_asset_id and a.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'asset not found in this organization');
  end if;

  insert into failure_report_photos
    (organization_id, asset_id, notification_id, storage_path, uploaded_by)
  values
    (v_org, p_asset_id, p_notification_id, p_storage_path, auth.uid());

  return jsonb_build_object('attached', p_storage_path);
end
$$;

revoke execute on function public.attach_failure_photo(uuid, uuid, text) from public, anon;
grant execute on function public.attach_failure_photo(uuid, uuid, text) to authenticated;
