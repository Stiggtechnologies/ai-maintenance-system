-- Sync Develop Slice 8 / D4.15 — digital asset maintainability at handover.
--
-- Canonical extension only: the existing three configuration baselines remain
-- the asset definition, configuration_items remain their contents,
-- evidence_items remain the proof store, and system_handover_packages remain
-- the acceptance transaction. Unknown and not-applicable are deliberately
-- different states.

alter table public.configuration_baselines
  add column if not exists digital_maintainability_applicability text,
  add column if not exists digital_maintainability_basis text,
  add column if not exists digital_maintainability_evidence_item_id uuid references public.evidence_items(id),
  add column if not exists digital_maintainability_assessed_by uuid references auth.users(id),
  add column if not exists digital_maintainability_assessed_at timestamptz;

alter table public.configuration_baselines
  drop constraint if exists configuration_baselines_digital_applicability_check;
alter table public.configuration_baselines
  add constraint configuration_baselines_digital_applicability_check check (
    digital_maintainability_applicability is null or
    digital_maintainability_applicability in ('applicable','not_applicable')
  );
alter table public.configuration_baselines
  drop constraint if exists configuration_baselines_digital_assessment_check;
alter table public.configuration_baselines
  add constraint configuration_baselines_digital_assessment_check check (
    (digital_maintainability_applicability is null and digital_maintainability_basis is null
      and digital_maintainability_evidence_item_id is null and digital_maintainability_assessed_by is null
      and digital_maintainability_assessed_at is null)
    or
    (digital_maintainability_applicability is not null
      and length(btrim(digital_maintainability_basis)) >= 20
      and digital_maintainability_evidence_item_id is not null
      and digital_maintainability_assessed_by is not null
      and digital_maintainability_assessed_at is not null)
  );

alter table public.configuration_items
  add column if not exists dependency_manifest jsonb,
  add column if not exists license_inventory jsonb,
  add column if not exists patch_status text,
  add column if not exists vendor_support_horizon date,
  add column if not exists backup_evidence_item_id uuid references public.evidence_items(id),
  add column if not exists restore_procedure_evidence_item_id uuid references public.evidence_items(id),
  add column if not exists configuration_file_evidence_item_id uuid references public.evidence_items(id),
  add column if not exists digital_field_exemptions text[] not null default '{}'::text[],
  add column if not exists digital_maintainability_basis text,
  add column if not exists digital_record_evidence_item_id uuid references public.evidence_items(id),
  add column if not exists digital_recorded_by uuid references auth.users(id),
  add column if not exists digital_recorded_at timestamptz;

alter table public.configuration_items
  drop constraint if exists configuration_items_dependency_manifest_check;
alter table public.configuration_items
  add constraint configuration_items_dependency_manifest_check check (
    dependency_manifest is null or jsonb_typeof(dependency_manifest)='array'
  );
alter table public.configuration_items
  drop constraint if exists configuration_items_license_inventory_check;
alter table public.configuration_items
  add constraint configuration_items_license_inventory_check check (
    license_inventory is null or jsonb_typeof(license_inventory)='array'
  );
alter table public.configuration_items
  drop constraint if exists configuration_items_digital_exemptions_check;
alter table public.configuration_items
  add constraint configuration_items_digital_exemptions_check check (
    digital_field_exemptions <@ array[
      'firmware','software_version','dependencies','licenses','patches',
      'vendor_support_horizon','backup','restore_procedures','configuration_files'
    ]::text[]
  );

create or replace function public.guard_digital_maintainability_baseline()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if ((tg_op='INSERT' and new.digital_maintainability_applicability is not null) or
     (tg_op='UPDATE' and (new.digital_maintainability_applicability,new.digital_maintainability_basis,
      new.digital_maintainability_evidence_item_id,new.digital_maintainability_assessed_by,
      new.digital_maintainability_assessed_at) is distinct from
     (old.digital_maintainability_applicability,old.digital_maintainability_basis,
      old.digital_maintainability_evidence_item_id,old.digital_maintainability_assessed_by,
      old.digital_maintainability_assessed_at)))
     and coalesce(current_setting('app.digital_maintainability_write',true),'')<>'allowed' then
    raise exception 'digital maintainability assessment may change only through the governed human workflow';
  end if;
  if new.digital_maintainability_evidence_item_id is not null and not exists (
    select 1 from public.evidence_items e where e.id=new.digital_maintainability_evidence_item_id
      and e.organization_id=new.organization_id
  ) then raise exception 'digital maintainability assessment evidence must remain in the baseline tenant'; end if;
  if new.digital_maintainability_assessed_by is not null and not exists (
    select 1 from public.user_profiles u where u.id=new.digital_maintainability_assessed_by
      and u.organization_id=new.organization_id and lower(coalesce(u.role,''))<>'ai_admin'
  ) then raise exception 'digital maintainability assessment requires a named human in the baseline tenant'; end if;
  return new;
end $$;

drop trigger if exists trg_guard_digital_maintainability_baseline on public.configuration_baselines;
create trigger trg_guard_digital_maintainability_baseline
  before insert or update of digital_maintainability_applicability,digital_maintainability_basis,
    digital_maintainability_evidence_item_id,digital_maintainability_assessed_by,
    digital_maintainability_assessed_at on public.configuration_baselines
  for each row execute function public.guard_digital_maintainability_baseline();
revoke all on function public.guard_digital_maintainability_baseline() from public,anon,authenticated;

create or replace function public.guard_digital_maintainability_item()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_evidence uuid; v_actor_role text;
begin
  if ((tg_op='INSERT' and (new.firmware_version is not null or new.software_version is not null
        or new.dependency_manifest is not null or new.license_inventory is not null
        or new.patch_status is not null or new.vendor_support_horizon is not null
        or new.backup_evidence_item_id is not null or new.restore_procedure_evidence_item_id is not null
        or new.configuration_file_evidence_item_id is not null or cardinality(new.digital_field_exemptions)>0
        or new.digital_record_evidence_item_id is not null or new.digital_recorded_by is not null))
      or (tg_op='UPDATE' and (new.firmware_version,new.software_version,new.dependency_manifest,new.license_inventory,new.patch_status,
        new.vendor_support_horizon,new.backup_evidence_item_id,new.restore_procedure_evidence_item_id,
        new.configuration_file_evidence_item_id,new.digital_field_exemptions,new.digital_maintainability_basis,
        new.digital_record_evidence_item_id,new.digital_recorded_by,new.digital_recorded_at) is distinct from
       (old.firmware_version,old.software_version,old.dependency_manifest,old.license_inventory,old.patch_status,old.vendor_support_horizon,
        old.backup_evidence_item_id,old.restore_procedure_evidence_item_id,old.configuration_file_evidence_item_id,
        old.digital_field_exemptions,old.digital_maintainability_basis,old.digital_record_evidence_item_id,
        old.digital_recorded_by,old.digital_recorded_at)))
     and coalesce(current_setting('app.digital_maintainability_write',true),'')<>'allowed' then
    raise exception 'digital configuration records may change only through the governed human workflow';
  end if;
  select organization_id into v_org from public.configuration_baselines where id=new.baseline_id;
  if v_org is null or v_org<>new.organization_id then raise exception 'configuration item must remain in its baseline tenant'; end if;
  foreach v_evidence in array array[new.backup_evidence_item_id,new.restore_procedure_evidence_item_id,
                                     new.configuration_file_evidence_item_id,new.digital_record_evidence_item_id] loop
    if v_evidence is not null and not exists (
      select 1 from public.evidence_items e where e.id=v_evidence and e.organization_id=new.organization_id
    ) then raise exception 'digital configuration evidence must remain in the item tenant'; end if;
  end loop;
  if new.digital_recorded_by is not null then
    select role into v_actor_role from public.user_profiles where id=new.digital_recorded_by and organization_id=new.organization_id;
    if v_actor_role is null or lower(v_actor_role)='ai_admin' then raise exception 'digital configuration requires a named human in the item tenant'; end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_digital_maintainability_item on public.configuration_items;
create trigger trg_guard_digital_maintainability_item
  before insert or update of firmware_version,software_version,dependency_manifest,license_inventory,patch_status,vendor_support_horizon,
    backup_evidence_item_id,restore_procedure_evidence_item_id,configuration_file_evidence_item_id,
    digital_field_exemptions,digital_maintainability_basis,digital_record_evidence_item_id,
    digital_recorded_by,digital_recorded_at on public.configuration_items
  for each row execute function public.guard_digital_maintainability_item();
revoke all on function public.guard_digital_maintainability_item() from public,anon,authenticated;

create or replace function public.assess_asset_digital_maintainability(
  p_asset_id uuid,p_baseline_kind text,p_applicability text,p_basis text,
  p_source_reference text,p_evidence_item_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_baseline_id bigint; v_revision int;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if lower(coalesce(v_role,'')) not in ('admin','engineer','maintenance_manager','planner','project_manager') then
    return jsonb_build_object('error','digital maintainability scope requires named human engineering, maintenance, planning, or administrative authority');
  end if;
  if p_baseline_kind not in ('as_designed','as_built','as_maintained') then return jsonb_build_object('error','unsupported configuration baseline kind'); end if;
  if p_applicability not in ('applicable','not_applicable') then return jsonb_build_object('error','applicability must be explicitly applicable or not applicable'); end if;
  if coalesce(length(btrim(p_basis)),0)<20 then return jsonb_build_object('error','a substantive digital maintainability applicability basis is required'); end if;
  if coalesce(length(btrim(p_source_reference)),0)<3 then return jsonb_build_object('error','the configuration source reference is required'); end if;
  if not exists(select 1 from public.assets a where a.id=p_asset_id and a.organization_id=v_org) then return jsonb_build_object('error','asset not found in current tenant'); end if;
  if not exists(select 1 from public.evidence_items e where e.id=p_evidence_item_id and e.organization_id=v_org) then return jsonb_build_object('error','same-tenant applicability evidence is required'); end if;
  select id into v_baseline_id from public.configuration_baselines
   where organization_id=v_org and asset_id=p_asset_id and baseline_kind=p_baseline_kind and is_current for update;
  if v_baseline_id is not null and p_applicability='not_applicable' and exists (
    select 1 from public.configuration_items i where i.baseline_id=v_baseline_id
      and (i.digital_record_evidence_item_id is not null or i.digital_recorded_at is not null)
  ) then return jsonb_build_object('error','an applicable digital estate with recorded items cannot be erased by changing scope to not applicable'); end if;
  perform set_config('app.digital_maintainability_write','allowed',true);
  if v_baseline_id is null then
    select coalesce(max(revision),0)+1 into v_revision from public.configuration_baselines
     where organization_id=v_org and asset_id=p_asset_id and baseline_kind=p_baseline_kind;
    insert into public.configuration_baselines(organization_id,asset_id,baseline_kind,revision,is_current,
      source_reference,established_by,digital_maintainability_applicability,digital_maintainability_basis,
      digital_maintainability_evidence_item_id,digital_maintainability_assessed_by,digital_maintainability_assessed_at)
    values(v_org,p_asset_id,p_baseline_kind,v_revision,true,btrim(p_source_reference),auth.uid(),p_applicability,
      btrim(p_basis),p_evidence_item_id,auth.uid(),now()) returning id into v_baseline_id;
  else
    update public.configuration_baselines set source_reference=btrim(p_source_reference),
      digital_maintainability_applicability=p_applicability,digital_maintainability_basis=btrim(p_basis),
      digital_maintainability_evidence_item_id=p_evidence_item_id,digital_maintainability_assessed_by=auth.uid(),
      digital_maintainability_assessed_at=now() where id=v_baseline_id;
  end if;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'configuration_baseline',v_role,jsonb_build_object('baseline_id',v_baseline_id,'asset_id',p_asset_id,
    'baseline_kind',p_baseline_kind,'action','digital_maintainability_assessed','applicability',p_applicability,
    'evidence_item_id',p_evidence_item_id));
  return jsonb_build_object('baselineId',v_baseline_id,'assetId',p_asset_id,'baselineKind',p_baseline_kind,
    'applicability',p_applicability,'decisionBoundary','This records the human assessment; it does not accept handover.');
end $$;
revoke all on function public.assess_asset_digital_maintainability(uuid,text,text,text,text,uuid) from public,anon;
grant execute on function public.assess_asset_digital_maintainability(uuid,text,text,text,text,uuid) to authenticated;

create or replace function public.record_digital_configuration_item(
  p_baseline_id bigint,p_position_ref text,p_firmware_version text,p_software_version text,
  p_dependency_manifest jsonb,p_license_inventory jsonb,p_patch_status text,p_vendor_support_horizon date,
  p_backup_evidence_item_id uuid,p_restore_procedure_evidence_item_id uuid,
  p_configuration_file_evidence_item_id uuid,p_field_exemptions text[],p_basis text,
  p_record_evidence_item_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; b public.configuration_baselines%rowtype; v_id bigint;
  v_allowed text[]:=array['firmware','software_version','dependencies','licenses','patches','vendor_support_horizon','backup','restore_procedures','configuration_files'];
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if lower(coalesce(v_role,'')) not in ('admin','engineer','maintenance_manager','planner','project_manager') then
    return jsonb_build_object('error','digital configuration requires named human engineering, maintenance, planning, or administrative authority');
  end if;
  select * into b from public.configuration_baselines where id=p_baseline_id and organization_id=v_org and is_current for update;
  if not found then return jsonb_build_object('error','current configuration baseline not found in current tenant'); end if;
  if b.digital_maintainability_applicability<>'applicable' then return jsonb_build_object('error','baseline must first be explicitly assessed as digitally applicable'); end if;
  if coalesce(length(btrim(p_position_ref)),0)<2 or coalesce(length(btrim(p_basis)),0)<20 then return jsonb_build_object('error','position and a substantive item basis are required'); end if;
  if p_dependency_manifest is not null and jsonb_typeof(p_dependency_manifest)<>'array' then return jsonb_build_object('error','dependency manifest must be a JSON array'); end if;
  if p_license_inventory is not null and jsonb_typeof(p_license_inventory)<>'array' then return jsonb_build_object('error','license inventory must be a JSON array'); end if;
  if not coalesce(p_field_exemptions,'{}'::text[]) <@ v_allowed then
    return jsonb_build_object('error','unsupported digital field exemption');
  end if;
  if not exists(select 1 from public.evidence_items e where e.id=p_record_evidence_item_id and e.organization_id=v_org) then return jsonb_build_object('error','same-tenant record evidence is required'); end if;
  if exists(select 1 from unnest(array[p_backup_evidence_item_id,p_restore_procedure_evidence_item_id,p_configuration_file_evidence_item_id]) e(id)
    where id is not null and not exists(select 1 from public.evidence_items x where x.id=e.id and x.organization_id=v_org)) then
    return jsonb_build_object('error','every artifact evidence reference must remain in the current tenant');
  end if;
  perform set_config('app.digital_maintainability_write','allowed',true);
  insert into public.configuration_items(organization_id,baseline_id,position_ref,firmware_version,software_version,
    dependency_manifest,license_inventory,patch_status,vendor_support_horizon,backup_evidence_item_id,
    restore_procedure_evidence_item_id,configuration_file_evidence_item_id,digital_field_exemptions,
    digital_maintainability_basis,digital_record_evidence_item_id,digital_recorded_by,digital_recorded_at)
  values(v_org,b.id,btrim(p_position_ref),nullif(btrim(p_firmware_version),''),nullif(btrim(p_software_version),''),
    p_dependency_manifest,p_license_inventory,nullif(btrim(p_patch_status),''),p_vendor_support_horizon,
    p_backup_evidence_item_id,p_restore_procedure_evidence_item_id,p_configuration_file_evidence_item_id,
    coalesce(p_field_exemptions,'{}'::text[]),btrim(p_basis),p_record_evidence_item_id,auth.uid(),now())
  on conflict (baseline_id,position_ref) do update set firmware_version=excluded.firmware_version,
    software_version=excluded.software_version,dependency_manifest=excluded.dependency_manifest,
    license_inventory=excluded.license_inventory,patch_status=excluded.patch_status,
    vendor_support_horizon=excluded.vendor_support_horizon,backup_evidence_item_id=excluded.backup_evidence_item_id,
    restore_procedure_evidence_item_id=excluded.restore_procedure_evidence_item_id,
    configuration_file_evidence_item_id=excluded.configuration_file_evidence_item_id,
    digital_field_exemptions=excluded.digital_field_exemptions,digital_maintainability_basis=excluded.digital_maintainability_basis,
    digital_record_evidence_item_id=excluded.digital_record_evidence_item_id,digital_recorded_by=excluded.digital_recorded_by,
    digital_recorded_at=excluded.digital_recorded_at returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'configuration_item',v_role,jsonb_build_object('configuration_item_id',v_id,'baseline_id',b.id,
    'asset_id',b.asset_id,'action','digital_maintainability_recorded','record_evidence_item_id',p_record_evidence_item_id));
  return jsonb_build_object('configurationItemId',v_id,'baselineId',b.id,'decisionBoundary','This records maintainability data and evidence; it does not approve a patch, license exception, or handover.');
end $$;
revoke all on function public.record_digital_configuration_item(bigint,text,text,text,jsonb,jsonb,text,date,uuid,uuid,uuid,text[],text,uuid) from public,anon;
grant execute on function public.record_digital_configuration_item(bigint,text,text,text,jsonb,jsonb,text,date,uuid,uuid,uuid,text[],text,uuid) to authenticated;

create or replace function public.get_asset_digital_maintainability(p_asset_id uuid,p_baseline_kind text default 'as_built')
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare v_org uuid:=public.app_current_org(); b public.configuration_baselines%rowtype; i public.configuration_items%rowtype;
  v_items jsonb:='[]'::jsonb; v_gaps jsonb:='[]'::jsonb; v_missing jsonb; v_total int:=0; v_ready int:=0;
begin
  if not exists(select 1 from public.assets a where a.id=p_asset_id and a.organization_id=v_org) then return jsonb_build_object('error','asset not found in current tenant'); end if;
  select * into b from public.configuration_baselines where organization_id=v_org and asset_id=p_asset_id and baseline_kind=p_baseline_kind and is_current;
  if not found then return jsonb_build_object('assetId',p_asset_id,'baselineKind',p_baseline_kind,'status','NOT_ASSESSED','applicability',null,'items','[]'::jsonb,'gaps',jsonb_build_array('No current '||replace(p_baseline_kind,'_','-')||' configuration baseline is recorded.'),'decisionBoundary','Unknown is not not-applicable and cannot satisfy handover.'); end if;
  if b.digital_maintainability_applicability is null then return jsonb_build_object('assetId',p_asset_id,'baselineId',b.id,'baselineKind',p_baseline_kind,'status','NOT_ASSESSED','applicability',null,'items','[]'::jsonb,'gaps',jsonb_build_array('Digital maintainability applicability has not been assessed by a named human with evidence.'),'decisionBoundary','Unknown is not not-applicable and cannot satisfy handover.'); end if;
  if b.digital_maintainability_applicability='not_applicable' then return jsonb_build_object('assetId',p_asset_id,'baselineId',b.id,'baselineKind',p_baseline_kind,'status','NOT_APPLICABLE','applicability','not_applicable','basis',b.digital_maintainability_basis,'assessmentEvidenceItemId',b.digital_maintainability_evidence_item_id,'items','[]'::jsonb,'gaps','[]'::jsonb,'decisionBoundary','Not-applicable is an explicit, evidenced human assessment; this read does not accept handover.'); end if;
  for i in select * from public.configuration_items where organization_id=v_org and baseline_id=b.id order by position_ref loop
    v_total:=v_total+1; v_missing:='[]'::jsonb;
    if coalesce(length(btrim(i.firmware_version)),0)=0 and not ('firmware'=any(i.digital_field_exemptions)) then v_missing:=v_missing||jsonb_build_array('firmware'); end if;
    if coalesce(length(btrim(i.software_version)),0)=0 and not ('software_version'=any(i.digital_field_exemptions)) then v_missing:=v_missing||jsonb_build_array('software_version'); end if;
    if i.dependency_manifest is null and not ('dependencies'=any(i.digital_field_exemptions)) then v_missing:=v_missing||jsonb_build_array('dependencies'); end if;
    if i.license_inventory is null and not ('licenses'=any(i.digital_field_exemptions)) then v_missing:=v_missing||jsonb_build_array('licenses'); end if;
    if coalesce(length(btrim(i.patch_status)),0)=0 and not ('patches'=any(i.digital_field_exemptions)) then v_missing:=v_missing||jsonb_build_array('patches'); end if;
    if i.vendor_support_horizon is null and not ('vendor_support_horizon'=any(i.digital_field_exemptions)) then v_missing:=v_missing||jsonb_build_array('vendor_support_horizon'); end if;
    if i.backup_evidence_item_id is null and not ('backup'=any(i.digital_field_exemptions)) then v_missing:=v_missing||jsonb_build_array('backup'); end if;
    if i.restore_procedure_evidence_item_id is null and not ('restore_procedures'=any(i.digital_field_exemptions)) then v_missing:=v_missing||jsonb_build_array('restore_procedures'); end if;
    if i.configuration_file_evidence_item_id is null and not ('configuration_files'=any(i.digital_field_exemptions)) then v_missing:=v_missing||jsonb_build_array('configuration_files'); end if;
    if i.digital_record_evidence_item_id is null or coalesce(length(btrim(i.digital_maintainability_basis)),0)<20 then v_missing:=v_missing||jsonb_build_array('record_provenance'); end if;
    if jsonb_array_length(v_missing)=0 then v_ready:=v_ready+1; else v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object('configurationItemId',i.id,'positionRef',i.position_ref,'missing',v_missing)); end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('configurationItemId',i.id,'positionRef',i.position_ref,'firmware',i.firmware_version,'softwareVersion',i.software_version,'dependencies',i.dependency_manifest,'licenses',i.license_inventory,'patches',i.patch_status,'vendorSupportHorizon',i.vendor_support_horizon,'backupEvidenceItemId',i.backup_evidence_item_id,'restoreProcedureEvidenceItemId',i.restore_procedure_evidence_item_id,'configurationFileEvidenceItemId',i.configuration_file_evidence_item_id,'exemptions',to_jsonb(i.digital_field_exemptions),'complete',jsonb_array_length(v_missing)=0));
  end loop;
  if v_total=0 then v_gaps:=v_gaps||jsonb_build_array('The applicable baseline has no configuration items.'); end if;
  return jsonb_build_object('assetId',p_asset_id,'baselineId',b.id,'baselineKind',p_baseline_kind,'status',case when v_total>0 and v_ready=v_total then 'READY' else 'NOT_READY' end,'applicability','applicable','basis',b.digital_maintainability_basis,'assessmentEvidenceItemId',b.digital_maintainability_evidence_item_id,'completeItems',v_ready,'totalItems',v_total,'items',v_items,'gaps',v_gaps,'fieldContract',jsonb_build_array('firmware','software_version','dependencies','licenses','patches','vendor_support_horizon','backup','restore_procedures','configuration_files'),'decisionBoundary','Completeness reports evidence-backed records; it does not approve patch posture, support risk, or handover.');
end $$;
revoke all on function public.get_asset_digital_maintainability(uuid,text) from public,anon;
grant execute on function public.get_asset_digital_maintainability(uuid,text) to authenticated;

create or replace function public.get_system_digital_maintainability(p_system_id bigint)
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare v_org uuid:=public.app_current_org(); r record; v_result jsonb; v_assets jsonb:='[]'::jsonb; v_gaps jsonb:='[]'::jsonb; v_total int:=0; v_ready int:=0;
begin
  if not exists(select 1 from public.commissioning_systems s where s.id=p_system_id and s.organization_id=v_org) then return jsonb_build_object('error','commissioning system not found'); end if;
  for r in select a.asset_id,x.name from public.commissioning_system_assets a join public.assets x on x.id=a.asset_id where a.organization_id=v_org and a.commissioning_system_id=p_system_id order by x.name loop
    v_total:=v_total+1; v_result:=public.get_asset_digital_maintainability(r.asset_id,'as_built');
    if v_result->>'status' in ('READY','NOT_APPLICABLE') then v_ready:=v_ready+1; else v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object('assetId',r.asset_id,'asset',r.name,'status',v_result->>'status','gaps',v_result->'gaps')); end if;
    v_assets:=v_assets||jsonb_build_array(jsonb_build_object('assetId',r.asset_id,'asset',r.name,'readiness',v_result));
  end loop;
  if v_total=0 then v_gaps:=v_gaps||jsonb_build_array('No assets are bound to the commissioning system, so digital maintainability cannot be assessed.'); end if;
  return jsonb_build_object('systemId',p_system_id,'status',case when v_total>0 and v_ready=v_total then 'READY' when v_total=0 then 'NOT_ASSESSED' else 'NOT_READY' end,'readyAssets',v_ready,'totalAssets',v_total,'assets',v_assets,'gaps',v_gaps,'source','configuration_baselines + configuration_items + evidence_items','decisionBoundary','This readiness result cannot accept handover.');
end $$;
revoke all on function public.get_system_digital_maintainability(bigint) from public,anon;
grant execute on function public.get_system_digital_maintainability(bigint) to authenticated;

do $$ begin
  if to_regprocedure('public.get_system_handover_readiness_pre_digital(bigint,bigint)') is null then
    alter function public.get_system_handover_readiness(bigint,bigint) rename to get_system_handover_readiness_pre_digital;
  end if;
end $$;

create or replace function public.get_system_handover_readiness(p_system_id bigint,p_package_id bigint default null)
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare v_base jsonb; v_digital jsonb; v_blockers jsonb;
begin
  v_base:=public.get_system_handover_readiness_pre_digital(p_system_id,p_package_id);
  if v_base ? 'error' then return v_base; end if;
  v_digital:=public.get_system_digital_maintainability(p_system_id);
  v_blockers:=coalesce(v_base->'blockers','[]'::jsonb);
  if coalesce(v_digital->>'status','')<>'READY' then
    v_blockers:=v_blockers||jsonb_build_array('Digital asset maintainability is not complete for every system asset.');
  end if;
  return jsonb_set(jsonb_set(jsonb_set(v_base,'{digitalMaintainability}',v_digital,true),'{blockers}',v_blockers,true),'{canAccept}',to_jsonb(jsonb_array_length(v_blockers)=0),true);
end $$;
revoke all on function public.get_system_handover_readiness(bigint,bigint) from public,anon;
grant execute on function public.get_system_handover_readiness(bigint,bigint) to authenticated;

comment on function public.get_asset_digital_maintainability(uuid,text) is 'D4.15 exact nine-field, evidence-backed digital maintainability completeness on canonical configuration items; unknown never equals not-applicable.';
comment on function public.get_system_digital_maintainability(bigint) is 'D4.15 system rollup consumed by the canonical handover acceptance wall.';

notify pgrst, 'reload schema';
