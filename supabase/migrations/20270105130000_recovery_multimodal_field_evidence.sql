-- ============================================================================
-- Sync Recovery — governed multimodal field evidence.
--
-- Extends the existing Recovery evidence row and the canonical Cowork
-- attachment store. It does not create a second file, evidence, approval or
-- audit model. Uploaded media remains creator-owned until it is explicitly
-- linked to a same-tenant Recovery event; linked bytes become readable to
-- authorized Recovery roles and can no longer be deleted by the uploader.
-- ============================================================================

alter table public.recovery_field_evidence
  drop constraint if exists recovery_field_evidence_evidence_kind_check;

alter table public.recovery_field_evidence
  add constraint recovery_field_evidence_evidence_kind_check
  check (evidence_kind in (
    'photo','video','voice','document','measurement','note',
    'checklist','scan','signature','location','drawing'
  ));

comment on column public.recovery_field_evidence.evidence_kind is
  'Human-recorded Recovery field input: photo, video, voice, document, measurement, note, checklist, barcode/QR/NFC scan, signature/attestation, location, or drawing/markup. A signature is evidence only and never an approval or release.';

create unique index if not exists idx_cowork_recovery_evidence_workspace
  on public.cowork_workspaces (
    organization_id,
    created_by,
    ((context_snapshot->>'recovery_event_id'))
  )
  where workspace_kind='recovery_evidence';

-- Recovery upload contexts contain event identifiers and must remain
-- creator-private. Existing Cowork RLS treats every non-Sync workspace as
-- tenant-wide, so explicitly remove this new kind from those permissive
-- policies before adding the narrower creator read path. Writes stay behind
-- the governed SECURITY DEFINER function below.
drop policy if exists cowork_workspaces_non_sync_org_rw
  on public.cowork_workspaces;
create policy cowork_workspaces_non_sync_org_rw
  on public.cowork_workspaces for all to authenticated
  using (
    organization_id=public.app_current_org()
    and workspace_kind not in ('sync','recovery_evidence')
  )
  with check (
    organization_id=public.app_current_org()
    and workspace_kind not in ('sync','recovery_evidence')
  );

drop policy if exists cowork_workspaces_recovery_evidence_read_own
  on public.cowork_workspaces;
create policy cowork_workspaces_recovery_evidence_read_own
  on public.cowork_workspaces for select to authenticated
  using (
    organization_id=public.app_current_org()
    and workspace_kind='recovery_evidence'
    and created_by=auth.uid()::text
  );

drop policy if exists cowork_messages_non_sync_org_rw
  on public.cowork_messages;
create policy cowork_messages_non_sync_org_rw
  on public.cowork_messages for all to authenticated
  using (
    organization_id=public.app_current_org()
    and (
      workspace_id is null
      or exists (
        select 1 from public.cowork_workspaces w
        where w.id=cowork_messages.workspace_id
          and w.organization_id=public.app_current_org()
          and w.workspace_kind not in ('sync','recovery_evidence')
      )
    )
  )
  with check (
    organization_id=public.app_current_org()
    and (
      workspace_id is null
      or exists (
        select 1 from public.cowork_workspaces w
        where w.id=cowork_messages.workspace_id
          and w.organization_id=public.app_current_org()
          and w.workspace_kind not in ('sync','recovery_evidence')
      )
    )
  );

create or replace function public.get_or_create_recovery_evidence_workspace(
  p_event_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_actor uuid:=auth.uid();
  v_event public.restoration_events%rowtype;
  v_workspace_id uuid;
begin
  if v_org is null or v_actor is null then
    raise exception using errcode='42501',message='Authenticated organization context required';
  end if;
  if not public.recovery_role_allowed(array[
    'technician','supervisor','maintenance_manager','operator',
    'reliability_engineer','admin','ai_admin'
  ]) then
    raise exception using errcode='42501',message='Field evidence authority denied';
  end if;

  select * into v_event
  from public.restoration_events
  where id=p_event_id and organization_id=v_org;
  if not found then
    raise exception using errcode='P0002',message='Recovery event not found in this tenant';
  end if;

  -- Serialize the one private capture workspace per actor/event. The workspace
  -- is only an upload context; Recovery remains the owner of field evidence.
  perform pg_advisory_xact_lock(hashtextextended(
    v_org::text||':'||v_actor::text||':'||p_event_id::text,0
  ));

  select id into v_workspace_id
  from public.cowork_workspaces
  where organization_id=v_org
    and created_by=v_actor::text
    and workspace_kind='recovery_evidence'
    and context_snapshot->>'recovery_event_id'=p_event_id::text
  order by created_at
  limit 1;

  if v_workspace_id is null then
    insert into public.cowork_workspaces(
      organization_id,asset_id,title,objective,status,agents,created_by,
      workspace_kind,mode,retention_policy,context_snapshot,last_turn_at
    ) values (
      v_org,v_event.asset_id,
      left('Recovery evidence · '||v_event.event_code,90),
      'Private upload context for governed Recovery field evidence',
      'active','{}'::text[],v_actor::text,
      'recovery_evidence','field','tenant_default',
      jsonb_build_object('recovery_event_id',p_event_id),now()
    ) returning id into v_workspace_id;
  end if;

  return v_workspace_id;
end $$;

revoke all on function public.get_or_create_recovery_evidence_workspace(uuid)
  from public,anon;
grant execute on function public.get_or_create_recovery_evidence_workspace(uuid)
  to authenticated;

-- The creator can upload attachment metadata into either a Sync conversation
-- or the private Recovery capture workspace. No other workspace is admitted.
drop policy if exists cowork_attachments_sync_read_own
  on public.cowork_attachments;
create policy cowork_attachments_sync_read_own
  on public.cowork_attachments for select to authenticated
  using (
    organization_id=public.app_current_org()
    and uploaded_by=auth.uid()
    and exists (
      select 1 from public.cowork_workspaces w
      where w.id=workspace_id
        and w.organization_id=public.app_current_org()
        and w.workspace_kind in ('sync','recovery_evidence')
        and w.created_by=auth.uid()::text
    )
  );

drop policy if exists cowork_attachments_sync_insert_own
  on public.cowork_attachments;
create policy cowork_attachments_sync_insert_own
  on public.cowork_attachments for insert to authenticated
  with check (
    organization_id=public.app_current_org()
    and uploaded_by=auth.uid()
    and exists (
      select 1 from public.cowork_workspaces w
      where w.id=workspace_id
        and w.organization_id=public.app_current_org()
        and w.workspace_kind in ('sync','recovery_evidence')
        and w.created_by=auth.uid()::text
    )
  );

create or replace function public.can_read_recovery_field_object(
  p_object_path text
)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select public.recovery_role_allowed(array[
    'technician','supervisor','maintenance_manager','operator','planner',
    'reliability_engineer','admin','ai_admin'
  ]) and exists (
    select 1
    from public.cowork_attachments a
    join public.recovery_field_evidence f
      on f.attachment_id=a.id and f.organization_id=a.organization_id
    where a.organization_id=public.app_current_org()
      and a.object_path=p_object_path
      and a.deleted_at is null
  )
$$;

create or replace function public.recovery_field_object_is_linked(
  p_object_path text
)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select exists (
    select 1
    from public.cowork_attachments a
    join public.recovery_field_evidence f
      on f.attachment_id=a.id and f.organization_id=a.organization_id
    where a.organization_id=public.app_current_org()
      and a.object_path=p_object_path
      and a.deleted_at is null
  )
$$;

revoke all on function public.can_read_recovery_field_object(text)
  from public,anon;
revoke all on function public.recovery_field_object_is_linked(text)
  from public,anon;
grant execute on function public.can_read_recovery_field_object(text)
  to authenticated;
grant execute on function public.recovery_field_object_is_linked(text)
  to authenticated;

drop policy if exists cowork_attachments_recovery_evidence_read
  on public.cowork_attachments;
create policy cowork_attachments_recovery_evidence_read
  on public.cowork_attachments for select to authenticated
  using (
    organization_id=public.app_current_org()
    and deleted_at is null
    and public.recovery_role_allowed(array[
      'technician','supervisor','maintenance_manager','operator','planner',
      'reliability_engineer','admin','ai_admin'
    ])
    and exists (
      select 1 from public.recovery_field_evidence f
      where f.attachment_id=cowork_attachments.id
        and f.organization_id=public.app_current_org()
    )
  );

drop policy if exists sync_attachments_recovery_read on storage.objects;
create policy sync_attachments_recovery_read
  on storage.objects for select to authenticated
  using (
    bucket_id='sync-attachments'
    and public.can_read_recovery_field_object(name)
  );

-- Once bytes are part of governed event evidence, the uploader cannot erase
-- them through the creator-owned storage delete policy.
drop policy if exists sync_attachments_delete_own on storage.objects;
create policy sync_attachments_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id='sync-attachments'
    and (storage.foldername(name))[1]=public.app_current_org()::text
    and (storage.foldername(name))[2]=auth.uid()::text
    and not public.recovery_field_object_is_linked(name)
  );

create or replace function public.add_recovery_field_evidence(
  p_event_id uuid,
  p_event_work_id uuid,
  p_kind text,
  p_note text,
  p_attachment_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_client_command_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_id uuid;
  v_existing public.recovery_field_evidence%rowtype;
  v_attachment public.cowork_attachments%rowtype;
  v_object_size bigint;
  v_object_mime text;
  v_metadata jsonb:=coalesce(p_metadata,'{}'::jsonb);
  v_command_id text:=nullif(btrim(coalesce(p_client_command_id,'')),'');
  v_replayed boolean:=false;
  v_lat numeric;
  v_lon numeric;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authenticated organization context required');
  end if;
  if not public.recovery_role_allowed(array[
    'technician','supervisor','maintenance_manager','operator',
    'reliability_engineer','admin','ai_admin'
  ]) then
    return jsonb_build_object('error','field evidence authority denied');
  end if;
  if p_kind is null or p_kind not in (
    'photo','video','voice','document','measurement','note',
    'checklist','scan','signature','location','drawing'
  ) or coalesce(length(btrim(p_note)),0)<3 then
    return jsonb_build_object('error','supported evidence kind and note required');
  end if;
  if jsonb_typeof(v_metadata)<>'object' then
    return jsonb_build_object('error','field evidence metadata must be an object');
  end if;
  if not exists (
    select 1 from public.restoration_events
    where id=p_event_id and organization_id=v_org
  ) then
    return jsonb_build_object('error','event not found');
  end if;
  if p_event_work_id is not null and not exists (
    select 1 from public.restoration_event_work
    where id=p_event_work_id
      and event_id=p_event_id
      and organization_id=v_org
  ) then
    return jsonb_build_object('error','event work is not part of this event');
  end if;

  if p_attachment_id is not null then
    select a.* into v_attachment
    from public.cowork_attachments a
    join public.cowork_workspaces w
      on w.id=a.workspace_id and w.organization_id=a.organization_id
    where a.id=p_attachment_id
      and a.organization_id=v_org
      and a.uploaded_by=auth.uid()
      and a.deleted_at is null
      and w.workspace_kind='recovery_evidence'
      and w.created_by=auth.uid()::text
      and w.context_snapshot->>'recovery_event_id'=p_event_id::text;
    if not found then
      return jsonb_build_object('error','attachment is not an active Recovery upload for this user and event');
    end if;

    -- Attachment metadata is not proof that bytes exist. Bind the row to the
    -- exact tenant / actor / capture-workspace storage key, then require the
    -- private object itself and reconcile its bounded size and content type.
    -- This prevents a client from turning a fabricated metadata row into
    -- governed Recovery evidence.
    if coalesce(array_length(storage.foldername(v_attachment.object_path),1),0)<>3
      or (storage.foldername(v_attachment.object_path))[1] is distinct from v_org::text
      or (storage.foldername(v_attachment.object_path))[2] is distinct from auth.uid()::text
      or (storage.foldername(v_attachment.object_path))[3] is distinct from v_attachment.workspace_id::text then
      return jsonb_build_object('error','attachment object path is not bound to this tenant, user and Recovery upload context');
    end if;

    select
      case when coalesce(o.metadata->>'size','') ~ '^[0-9]+$'
        then (o.metadata->>'size')::bigint else 0 end,
      coalesce(o.metadata->>'mimetype',o.metadata->>'contentType','')
    into v_object_size,v_object_mime
    from storage.objects o
    where o.bucket_id='sync-attachments'
      and o.name=v_attachment.object_path;
    if not found
      or v_object_size not between 1 and 26214400
      or v_attachment.size_bytes is distinct from v_object_size then
      return jsonb_build_object('error','attachment bytes are missing, empty, oversized or inconsistent with their metadata');
    end if;
    if coalesce(v_attachment.mime_type,'')<>''
      and lower(v_attachment.mime_type) is distinct from lower(v_object_mime) then
      return jsonb_build_object('error','attachment content type does not match the private stored object');
    end if;
    if coalesce(v_attachment.content_sha256,'') !~ '^[0-9a-f]{64}$' then
      return jsonb_build_object('error','attachment requires a lowercase client-computed SHA-256 provenance value');
    end if;
    v_metadata:=v_metadata||jsonb_build_object(
      'attachment_provenance',jsonb_build_object(
        'object_path',v_attachment.object_path,
        'size_bytes',v_object_size,
        'mime_type',v_object_mime,
        'content_sha256',v_attachment.content_sha256,
        'content_hash_verification','client_computed_unverified'
      )
    );
  end if;

  if p_kind in ('photo','video','voice','document','signature','drawing')
    and p_attachment_id is null then
    return jsonb_build_object('error',p_kind||' evidence requires a governed attachment');
  end if;
  if p_kind='photo' and coalesce(v_attachment.mime_type,'') not like 'image/%' then
    return jsonb_build_object('error','photo evidence requires an image attachment');
  elsif p_kind='video' and coalesce(v_attachment.mime_type,'') not like 'video/%' then
    return jsonb_build_object('error','video evidence requires a video attachment');
  elsif p_kind='voice' and coalesce(v_attachment.mime_type,'') not like 'audio/%' then
    return jsonb_build_object('error','voice evidence requires an audio attachment');
  elsif p_kind in ('signature','drawing') and not (
    coalesce(v_attachment.mime_type,'') like 'image/%'
    or v_attachment.mime_type='application/pdf'
  ) then
    return jsonb_build_object('error',p_kind||' evidence requires an image or PDF attachment');
  end if;

  if p_kind='measurement' then
    if not(v_metadata ? 'value')
      or coalesce(length(btrim(v_metadata->>'value')),0)=0
      or coalesce(length(btrim(v_metadata->>'unit')),0)=0 then
      return jsonb_build_object('error','measurement evidence requires the observed value and unit');
    end if;
  elsif p_kind='checklist' then
    if jsonb_typeof(v_metadata->'items') is distinct from 'array' then
      return jsonb_build_object('error','checklist evidence requires one or more recorded observations');
    end if;
    if jsonb_array_length(v_metadata->'items')=0 or exists (
      select 1 from jsonb_array_elements(v_metadata->'items') item
      where jsonb_typeof(item)<>'object'
        or coalesce(length(btrim(item->>'observation')),0)=0
    ) then
      return jsonb_build_object('error','checklist evidence requires one or more recorded observations');
    end if;
  elsif p_kind='scan' and coalesce(length(btrim(v_metadata->>'code')),0)=0 then
    return jsonb_build_object('error','scan evidence requires the observed barcode, QR, Data Matrix, RFID or NFC value');
  elsif p_kind='location' then
    if jsonb_typeof(v_metadata->'latitude')<>'number'
      or jsonb_typeof(v_metadata->'longitude')<>'number' then
      return jsonb_build_object('error','location evidence requires numeric latitude and longitude');
    end if;
    v_lat:=(v_metadata->>'latitude')::numeric;
    v_lon:=(v_metadata->>'longitude')::numeric;
    if v_lat not between -90 and 90 or v_lon not between -180 and 180 then
      return jsonb_build_object('error','location evidence is outside valid latitude/longitude bounds');
    end if;
  end if;

  if p_kind='signature' then
    v_metadata:=v_metadata||jsonb_build_object(
      'authority_boundary','evidence_only_not_approval_or_release'
    );
  elsif p_kind='scan' then
    v_metadata:=v_metadata||jsonb_build_object(
      'verification_state','observed_identifier_not_verified_master_data'
    );
  elsif p_kind='location' then
    v_metadata:=v_metadata||jsonb_build_object(
      'verification_state','reported_device_or_manual_location'
    );
  end if;

  insert into public.recovery_field_evidence(
    organization_id,event_id,event_work_id,attachment_id,evidence_kind,
    note,metadata,client_command_id,captured_by
  ) values (
    v_org,p_event_id,p_event_work_id,p_attachment_id,p_kind,
    btrim(p_note),v_metadata,v_command_id,auth.uid()
  )
  on conflict(organization_id,client_command_id) do nothing
  returning id into v_id;

  if v_id is null and v_command_id is not null then
    select * into v_existing
    from public.recovery_field_evidence
    where organization_id=v_org and client_command_id=v_command_id;
    if not found then
      return jsonb_build_object('error','field evidence idempotency reservation failed');
    end if;
    if v_existing.event_id is distinct from p_event_id
      or v_existing.event_work_id is distinct from p_event_work_id
      or v_existing.attachment_id is distinct from p_attachment_id
      or v_existing.evidence_kind is distinct from p_kind
      or v_existing.note is distinct from btrim(p_note)
      or v_existing.metadata is distinct from v_metadata then
      return jsonb_build_object('error','client command id is already bound to different field evidence');
    end if;
    v_id:=v_existing.id;
    v_replayed:=true;
  end if;

  if not v_replayed then
    insert into public.audit_events(
      organization_id,entity_type,actor,event_data
    ) values (
      v_org,'recovery_field_evidence',auth.uid()::text,
      jsonb_build_object(
        'eventId',p_event_id,'eventWorkId',p_event_work_id,
        'evidenceId',v_id,'kind',p_kind,'attachmentId',p_attachment_id,
        'clientCommandId',v_command_id,
        'authorityBoundary',case when p_kind='signature'
          then 'evidence_only_not_approval_or_release' end
      )
    );
  end if;

  return jsonb_build_object(
    'ok',true,'evidence_id',v_id,'replayed',v_replayed,
    'kind',p_kind,'attachment_id',p_attachment_id
  );
end $$;

revoke all on function public.add_recovery_field_evidence(
  uuid,uuid,text,text,uuid,jsonb,text
) from public,anon;
grant execute on function public.add_recovery_field_evidence(
  uuid,uuid,text,text,uuid,jsonb,text
) to authenticated;

notify pgrst,'reload schema';
