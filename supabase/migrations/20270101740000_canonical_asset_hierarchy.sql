-- ============================================================================
-- U3.17 — canonical asset hierarchy, composed from canonical records.
--
-- No generic shadow-node store is introduced. Enterprise identity stays in
-- organizations; service consequences stay in asset_service_levels; system,
-- location and asset identity stay in assets/sites; physical breakdown stays
-- in components; and failure-mode identity stays in the existing FMMEA family.
-- This migration adds only the missing parentage/provenance to components and
-- the missing component binding to asset_failure_mode_libraries, then exposes
-- one bounded resolver over those canonical homes.
-- ============================================================================

alter table public.components
  add column if not exists hierarchy_level text not null default 'component',
  add column if not exists parent_component_id uuid,
  add column if not exists hierarchy_basis text,
  add column if not exists hierarchy_evidence_item_id uuid,
  add column if not exists hierarchy_recorded_by uuid references auth.users(id) on delete restrict,
  add column if not exists hierarchy_recorded_at timestamptz;

alter table public.components
  drop constraint if exists components_hierarchy_level_check;
alter table public.components
  add constraint components_hierarchy_level_check
  check (hierarchy_level in ('assembly','maintainable_item','component'));

alter table public.components
  drop constraint if exists components_hierarchy_provenance_check;
alter table public.components
  add constraint components_hierarchy_provenance_check check (
    (hierarchy_recorded_at is null and hierarchy_level='component'
      and parent_component_id is null and hierarchy_basis is null
      and hierarchy_evidence_item_id is null and hierarchy_recorded_by is null)
    or
    (hierarchy_recorded_at is not null and length(btrim(hierarchy_basis)) >= 20
      and hierarchy_evidence_item_id is not null and hierarchy_recorded_by is not null)
  );

alter table public.components
  drop constraint if exists components_parent_not_self;
alter table public.components
  add constraint components_parent_not_self
  check (parent_component_id is null or parent_component_id <> id);

alter table public.components
  drop constraint if exists components_parent_tenant_asset_fk;
alter table public.components
  add constraint components_parent_tenant_asset_fk
  foreign key (organization_id, asset_id, parent_component_id)
  references public.components(organization_id, asset_id, id) on delete restrict;

alter table public.components
  drop constraint if exists components_hierarchy_evidence_tenant_fk;
alter table public.components
  add constraint components_hierarchy_evidence_tenant_fk
  foreign key (organization_id, hierarchy_evidence_item_id)
  references public.evidence_items(organization_id, id) on delete restrict;

create index if not exists idx_components_hierarchy_parent
  on public.components(organization_id, asset_id, parent_component_id)
  where parent_component_id is not null;

alter table public.asset_failure_mode_libraries
  add column if not exists hierarchy_component_id uuid,
  add column if not exists hierarchy_basis text,
  add column if not exists hierarchy_evidence_item_id uuid,
  add column if not exists hierarchy_recorded_by uuid references auth.users(id) on delete restrict,
  add column if not exists hierarchy_recorded_at timestamptz;

alter table public.asset_failure_mode_libraries
  drop constraint if exists failure_mode_hierarchy_component_fk;
alter table public.asset_failure_mode_libraries
  add constraint failure_mode_hierarchy_component_fk
  foreign key (organization_id, canonical_asset_id, hierarchy_component_id)
  references public.components(organization_id, asset_id, id) on delete restrict;

alter table public.asset_failure_mode_libraries
  drop constraint if exists failure_mode_hierarchy_evidence_fk;
alter table public.asset_failure_mode_libraries
  add constraint failure_mode_hierarchy_evidence_fk
  foreign key (organization_id, hierarchy_evidence_item_id)
  references public.evidence_items(organization_id, id) on delete restrict;

alter table public.asset_failure_mode_libraries
  drop constraint if exists failure_mode_hierarchy_provenance_check;
alter table public.asset_failure_mode_libraries
  add constraint failure_mode_hierarchy_provenance_check check (
    (hierarchy_recorded_at is null and hierarchy_component_id is null
      and hierarchy_basis is null and hierarchy_evidence_item_id is null
      and hierarchy_recorded_by is null)
    or
    (hierarchy_recorded_at is not null and hierarchy_component_id is not null
      and canonical_asset_id is not null and mechanism_id is not null
      and length(btrim(hierarchy_basis)) >= 20
      and hierarchy_evidence_item_id is not null and hierarchy_recorded_by is not null)
  );

comment on column public.components.hierarchy_level is
  'U3.17 physical-breakdown level in the ONE components table. Existing ungoverned rows remain component leaves with missing parentage disclosed; governed writes enforce assembly → maintainable_item → component.';
comment on column public.asset_failure_mode_libraries.hierarchy_component_id is
  'U3.17 governed component binding for an existing FMMEA failure-mode identity. The binding does not adopt the mode, assert occurrence or authorize maintenance.';

create or replace function public.enforce_component_hierarchy_integrity()
returns trigger language plpgsql security definer set search_path=public as $$
declare p public.components%rowtype; bad_child public.components%rowtype;
begin
  if new.hierarchy_level='assembly' and new.parent_component_id is not null then
    raise exception 'an assembly is the physical root below its asset and cannot name a component parent'
      using errcode='check_violation';
  end if;
  if new.hierarchy_level in ('maintainable_item','component')
     and new.parent_component_id is not null then
    select * into p from public.components
    where id=new.parent_component_id and organization_id=new.organization_id
      and asset_id=new.asset_id;
    if not found then
      raise exception 'component parent must belong to the same tenant and canonical asset'
        using errcode='check_violation';
    end if;
    if new.hierarchy_level='maintainable_item' and p.hierarchy_level<>'assembly' then
      raise exception 'a maintainable item must sit directly below an assembly'
        using errcode='check_violation';
    end if;
    if new.hierarchy_level='component' and p.hierarchy_level<>'maintainable_item' then
      raise exception 'a component must sit directly below a maintainable item'
        using errcode='check_violation';
    end if;
  end if;
  if new.hierarchy_recorded_at is not null
     and new.hierarchy_level<>'assembly' and new.parent_component_id is null then
    raise exception 'a governed maintainable item or component must name its exact parent'
      using errcode='check_violation';
  end if;
  if tg_op='UPDATE' and (new.hierarchy_level,new.asset_id,new.organization_id)
      is distinct from (old.hierarchy_level,old.asset_id,old.organization_id) then
    if new.hierarchy_level<>'component' and exists(
      select 1 from public.asset_failure_mode_libraries f
      where f.organization_id=old.organization_id
        and f.hierarchy_component_id=old.id
        and f.hierarchy_recorded_at is not null) then
      raise exception 'a component with governed failure-mode leaves cannot be reclassified; bind those leaves to their correct component first'
        using errcode='check_violation';
    end if;
    select * into bad_child from public.components c
    where c.parent_component_id=new.id and (
      c.organization_id<>new.organization_id or c.asset_id<>new.asset_id or
      (c.hierarchy_level='maintainable_item' and new.hierarchy_level<>'assembly') or
      (c.hierarchy_level='component' and new.hierarchy_level<>'maintainable_item'))
    limit 1;
    if found then
      raise exception 'that change would invalidate an existing child hierarchy relationship'
        using errcode='check_violation';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.enforce_component_hierarchy_integrity()
  from public,anon,authenticated;
drop trigger if exists trg_component_hierarchy_integrity on public.components;
create trigger trg_component_hierarchy_integrity
  before insert or update of hierarchy_level,parent_component_id,asset_id,organization_id
  on public.components for each row execute function public.enforce_component_hierarchy_integrity();

create or replace function public.guard_component_hierarchy_write()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if current_setting('syncai.asset_hierarchy_workflow',true)='1' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op='INSERT' and (new.parent_component_id is not null
      or new.hierarchy_level<>'component' or new.hierarchy_recorded_at is not null) then
    raise exception 'governed component hierarchy changes require record_component_hierarchy_node'
      using errcode='insufficient_privilege';
  elsif tg_op='UPDATE' and (
      (new.hierarchy_level,new.parent_component_id,new.hierarchy_basis,
       new.hierarchy_evidence_item_id,new.hierarchy_recorded_by,new.hierarchy_recorded_at)
        is distinct from
      (old.hierarchy_level,old.parent_component_id,old.hierarchy_basis,
       old.hierarchy_evidence_item_id,old.hierarchy_recorded_by,old.hierarchy_recorded_at)
      or (old.hierarchy_recorded_at is not null and
        (new.organization_id,new.asset_id,new.name,new.type) is distinct from
        (old.organization_id,old.asset_id,old.name,old.type))) then
    raise exception 'governed component hierarchy changes require record_component_hierarchy_node'
      using errcode='insufficient_privilege';
  elsif tg_op='DELETE' and old.hierarchy_recorded_at is not null then
    raise exception 'governed hierarchy nodes are retained; record a superseding structure instead'
      using errcode='insufficient_privilege';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.guard_component_hierarchy_write()
  from public,anon,authenticated;
drop trigger if exists trg_guard_component_hierarchy_write on public.components;
create trigger trg_guard_component_hierarchy_write
  before insert or update or delete on public.components
  for each row execute function public.guard_component_hierarchy_write();

create or replace function public.guard_failure_mode_hierarchy_write()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if current_setting('syncai.asset_hierarchy_workflow',true)='1' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op='INSERT' and (new.hierarchy_component_id is not null
      or new.hierarchy_basis is not null or new.hierarchy_evidence_item_id is not null
      or new.hierarchy_recorded_by is not null or new.hierarchy_recorded_at is not null) then
    raise exception 'failure-mode hierarchy changes require bind_failure_mode_to_component'
      using errcode='insufficient_privilege';
  elsif tg_op='UPDATE' and old.hierarchy_recorded_at is not null
      and (new.canonical_asset_id,new.mechanism_id,new.failure_mode) is distinct from
          (old.canonical_asset_id,old.mechanism_id,old.failure_mode) then
    new.hierarchy_component_id:=null;
    new.hierarchy_basis:=null;
    new.hierarchy_evidence_item_id:=null;
    new.hierarchy_recorded_by:=null;
    new.hierarchy_recorded_at:=null;
    insert into public.audit_events(organization_id,entity_type,actor,event_data)
    values(old.organization_id,'asset_hierarchy',coalesce(public.app_current_role(),'system'),
      jsonb_build_object('action','failure_mode_binding_invalidated',
        'failureModeId',old.id,'priorComponentId',old.hierarchy_component_id,
        'reason','canonical asset, mechanism or failure-mode identity changed'));
    return new;
  elsif tg_op='UPDATE' and
     (new.hierarchy_component_id,new.hierarchy_basis,new.hierarchy_evidence_item_id,
      new.hierarchy_recorded_by,new.hierarchy_recorded_at) is distinct from
     (old.hierarchy_component_id,old.hierarchy_basis,old.hierarchy_evidence_item_id,
      old.hierarchy_recorded_by,old.hierarchy_recorded_at) then
    raise exception 'failure-mode hierarchy changes require bind_failure_mode_to_component'
      using errcode='insufficient_privilege';
  elsif tg_op='DELETE' and old.hierarchy_recorded_at is not null then
    raise exception 'governed failure-mode hierarchy leaves are retained; record a superseding FMMEA identity instead'
      using errcode='insufficient_privilege';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.guard_failure_mode_hierarchy_write()
  from public,anon,authenticated;
drop trigger if exists trg_guard_failure_mode_hierarchy_write
  on public.asset_failure_mode_libraries;
create trigger trg_guard_failure_mode_hierarchy_write
  before insert or update or delete on public.asset_failure_mode_libraries
  for each row execute function public.guard_failure_mode_hierarchy_write();

create or replace function public.record_component_hierarchy_node(
  p_asset_id uuid,p_component_id uuid,p_name text,p_type text,
  p_hierarchy_level text,p_parent_component_id uuid,p_basis text,
  p_evidence_item_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_id uuid;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','asset hierarchy authoring requires a named same-tenant reliability, maintenance or administrator role');
  end if;
  if coalesce(p_hierarchy_level,'') not in ('assembly','maintainable_item','component') then
    return jsonb_build_object('error','hierarchy level must be assembly, maintainable_item or component');
  end if;
  if coalesce(length(btrim(p_name)),0)<2 or coalesce(length(btrim(p_basis)),0)<20 then
    return jsonb_build_object('error','record a node name and at least 20 characters of hierarchy basis');
  end if;
  if not exists(select 1 from public.assets where id=p_asset_id and organization_id=v_org) then
    return jsonb_build_object('error','canonical asset not found in this organization');
  end if;
  if not exists(select 1 from public.evidence_items e where e.id=p_evidence_item_id
      and e.organization_id=v_org and e.verification_status='verified'
      and (e.asset_id is null or e.asset_id=p_asset_id)) then
    return jsonb_build_object('error','verified same-tenant evidence applicable to this asset is required');
  end if;
  if p_component_id is not null and not exists(select 1 from public.components
      where id=p_component_id and organization_id=v_org and asset_id=p_asset_id) then
    return jsonb_build_object('error','component node not found on this canonical asset');
  end if;
  perform set_config('syncai.asset_hierarchy_workflow','1',true);
  if p_component_id is null then
    insert into public.components(organization_id,asset_id,name,type,hierarchy_level,
      parent_component_id,hierarchy_basis,hierarchy_evidence_item_id,
      hierarchy_recorded_by,hierarchy_recorded_at)
    values(v_org,p_asset_id,btrim(p_name),nullif(btrim(coalesce(p_type,'')),''),
      p_hierarchy_level,p_parent_component_id,btrim(p_basis),p_evidence_item_id,
      auth.uid(),now()) returning id into v_id;
  else
    update public.components set name=btrim(p_name),type=nullif(btrim(coalesce(p_type,'')),''),
      hierarchy_level=p_hierarchy_level,parent_component_id=p_parent_component_id,
      hierarchy_basis=btrim(p_basis),hierarchy_evidence_item_id=p_evidence_item_id,
      hierarchy_recorded_by=auth.uid(),hierarchy_recorded_at=now()
    where id=p_component_id and organization_id=v_org and asset_id=p_asset_id
    returning id into v_id;
  end if;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'asset_hierarchy',v_role,jsonb_build_object('action','component_node_recorded',
    'assetId',p_asset_id,'componentId',v_id,'level',p_hierarchy_level,
    'parentComponentId',p_parent_component_id,'evidenceItemId',p_evidence_item_id,
    'basis',btrim(p_basis),'recordedBy',auth.uid()));
  return jsonb_build_object('componentId',v_id,'assetId',p_asset_id,
    'hierarchyLevel',p_hierarchy_level,'parentComponentId',p_parent_component_id,
    'status','recorded','authority','Structure and provenance only; no condition, failure occurrence, work, operating or risk-acceptance decision is asserted.');
exception when check_violation then
  return jsonb_build_object('error',sqlerrm);
end $$;

create or replace function public.bind_failure_mode_to_component(
  p_failure_mode_id uuid,p_component_id uuid,p_basis text,p_evidence_item_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text;
  f public.asset_failure_mode_libraries%rowtype; c public.components%rowtype;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','failure-mode hierarchy binding requires a named same-tenant reliability, maintenance or administrator role');
  end if;
  if coalesce(length(btrim(p_basis)),0)<20 then
    return jsonb_build_object('error','record at least 20 characters of component-binding basis');
  end if;
  select * into f from public.asset_failure_mode_libraries
  where id=p_failure_mode_id and organization_id=v_org;
  if not found or f.canonical_asset_id is null or f.mechanism_id is null then
    return jsonb_build_object('error','an existing FMMEA row with canonical asset and mechanism is required');
  end if;
  select * into c from public.components where id=p_component_id
    and organization_id=v_org and asset_id=f.canonical_asset_id
    and hierarchy_level='component' and hierarchy_recorded_at is not null;
  if not found then return jsonb_build_object('error','governed component leaf not found on the FMMEA asset'); end if;
  if not exists(select 1 from public.evidence_items e where e.id=p_evidence_item_id
      and e.organization_id=v_org and e.verification_status='verified'
      and (e.asset_id is null or e.asset_id=f.canonical_asset_id)) then
    return jsonb_build_object('error','verified same-tenant evidence applicable to the FMMEA asset is required');
  end if;
  perform set_config('syncai.asset_hierarchy_workflow','1',true);
  update public.asset_failure_mode_libraries set
    hierarchy_component_id=c.id,hierarchy_basis=btrim(p_basis),
    hierarchy_evidence_item_id=p_evidence_item_id,hierarchy_recorded_by=auth.uid(),
    hierarchy_recorded_at=now(),updated_at=now()
  where id=f.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'asset_hierarchy',v_role,jsonb_build_object('action','failure_mode_bound',
    'assetId',f.canonical_asset_id,'componentId',c.id,'failureModeId',f.id,
    'mechanismId',f.mechanism_id,'evidenceItemId',p_evidence_item_id,
    'basis',btrim(p_basis),'recordedBy',auth.uid()));
  return jsonb_build_object('failureModeId',f.id,'componentId',c.id,
    'status','bound','authority','Hierarchy relation only; occurrence, probability, condition, task and approval remain unasserted.');
end $$;

revoke all on function public.record_component_hierarchy_node(uuid,uuid,text,text,text,uuid,text,uuid)
  from public,anon,service_role;
grant execute on function public.record_component_hierarchy_node(uuid,uuid,text,text,text,uuid,text,uuid)
  to authenticated;
revoke all on function public.bind_failure_mode_to_component(uuid,uuid,text,uuid)
  from public,anon,service_role;
grant execute on function public.bind_failure_mode_to_component(uuid,uuid,text,uuid)
  to authenticated;

-- Keep the existing Data Steward source fingerprint aligned with this
-- canonical extension. A parentage or FMMEA-leaf change must alter the
-- snapshot even when the component name and type stay unchanged.
create or replace function public.sync_data_steward_source_snapshot(p_org uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'capturedAt',now(),
    'assets',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'site',site_id,'tag',tag,'enterpriseId',enterprise_asset_id,
        'functionalLocation',functional_location,'area',area,'system',system,
        'class',asset_class)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.assets where organization_id=p_org),
    'components',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'assetId',asset_id,'name',name,'type',type,
        'hierarchyLevel',hierarchy_level,'parentComponentId',parent_component_id,
        'hierarchyEvidenceItemId',hierarchy_evidence_item_id,
        'hierarchyRecordedAt',hierarchy_recorded_at)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.components where organization_id=p_org),
    'failureModeHierarchy',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'assetId',canonical_asset_id,'mechanismId',mechanism_id,
        'failureMode',failure_mode,'componentId',hierarchy_component_id,
        'hierarchyEvidenceItemId',hierarchy_evidence_item_id,
        'hierarchyRecordedAt',hierarchy_recorded_at)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.asset_failure_mode_libraries where organization_id=p_org),
    'correctiveWork',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'assetId',asset_id,'sourceLabel',actual_failure_mode,
        'systemGroup',system_group,'mechanismId',failure_mechanism_id)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.work_orders where organization_id=p_org and work_type='corrective'),
    'failureCodeMap',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'sourceLabel',source_label,'kind',label_kind,'reviewedAt',reviewed_at)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.failure_code_map where organization_id=p_org),
    'dataDomains',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'key',domain_key,'ownerRole',owner_role,'owner',owner_user_id,
        'stewardRole',steward_role,'version',version)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.data_domains where organization_id=p_org),
    'dataQualitySlas',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'domainId',domain_id,'metric',metric,'targetPct',target_pct,
        'targetLagHours',target_lag_hours,'measuredPct',measured_pct,
        'measuredLagHours',measured_lag_hours,'measuredOn',measured_on)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.data_quality_slas where organization_id=p_org),
    'sensors',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',s.id,'assetId',s.asset_id,'signal',s.signal_type,'unit',s.unit,
        'validationRule',r.sensor_id is not null)::text,'|' order by s.id),'empty'),'sha256'),'hex'))
      from public.sensors s left join public.sensor_validation_rules r
        on r.sensor_id=s.id and r.organization_id=s.organization_id
      where s.organization_id=p_org),
    'calibrations',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'sensorId',sensor_id,'assetId',asset_id,'instrument',instrument_ref,
        'date',calibrated_on,'intervalMonths',interval_months,
        'asFound',as_found_within_tolerance,'asLeft',as_left_within_tolerance,
        'certificate',certificate_reference)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.instrument_calibrations where organization_id=p_org),
    'historianMappings',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'tag',historian_tag,'assetId',asset_id,'sensorId',sensor_id,
        'measurement',measurement,'unit',unit,'confirmedAt',confirmed_at,
        'source',source_system,'version',version)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.historian_tag_map where organization_id=p_org),
    'archiveRegister',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'class',record_class,'reference',reference,'date',archived_on,
        'disposition',disposition,'retentionUntil',retention_until)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.archive_records where organization_id=p_org)
  )
$$;
revoke all on function public.sync_data_steward_source_snapshot(uuid)
  from public,anon,authenticated;

create or replace function public.get_canonical_asset_hierarchy_workspace()
returns jsonb language sql stable security definer set search_path=public as $$
with asset_facts as (
  select a.*,s.name site_name,o.name enterprise_name,
    sl.service_name,sl.status service_status,
    exists(select 1 from public.components x where x.organization_id=a.organization_id
      and x.asset_id=a.id and x.hierarchy_level='assembly' and x.parent_component_id is null
      and x.hierarchy_recorded_at is not null) has_assembly,
    exists(select 1 from public.components m join public.components assembly
      on assembly.id=m.parent_component_id and assembly.organization_id=m.organization_id
      and assembly.asset_id=m.asset_id and assembly.hierarchy_level='assembly'
      where m.organization_id=a.organization_id and m.asset_id=a.id
        and m.hierarchy_level='maintainable_item' and m.hierarchy_recorded_at is not null) has_maintainable,
    exists(select 1 from public.components c join public.components m
      on m.id=c.parent_component_id and m.organization_id=c.organization_id and m.asset_id=c.asset_id
      join public.components assembly on assembly.id=m.parent_component_id
      and assembly.organization_id=m.organization_id and assembly.asset_id=m.asset_id
      where c.organization_id=a.organization_id and c.asset_id=a.id
        and c.hierarchy_level='component' and c.hierarchy_recorded_at is not null
        and m.hierarchy_level='maintainable_item' and assembly.hierarchy_level='assembly') has_component,
    exists(select 1 from public.asset_failure_mode_libraries f
      join public.components c on c.id=f.hierarchy_component_id
      and c.organization_id=f.organization_id and c.asset_id=f.canonical_asset_id
      join public.components m on m.id=c.parent_component_id and m.organization_id=c.organization_id
      join public.components assembly on assembly.id=m.parent_component_id and assembly.organization_id=m.organization_id
      where f.organization_id=a.organization_id and f.canonical_asset_id=a.id
        and f.hierarchy_recorded_at is not null and c.hierarchy_level='component'
        and m.hierarchy_level='maintainable_item' and assembly.hierarchy_level='assembly') has_failure
  from public.assets a
  join public.organizations o on o.id=a.organization_id
  left join public.sites s on s.id=a.site_id and s.organization_id=a.organization_id
  left join public.asset_service_levels sl on sl.asset_id=a.id
    and sl.organization_id=a.organization_id and sl.status='verified'
  where a.organization_id=public.app_current_org()
  order by coalesce(a.tag,a.name)
  limit 200
), scored as (
  select f.*,
    service_name is not null and service_status='verified' has_service,
    nullif(btrim(system),'') is not null has_system,
    site_id is not null and nullif(btrim(functional_location),'') is not null has_location
  from asset_facts f
)
select case when public.app_current_org() is null or auth.uid() is null
  then jsonb_build_object('error','forbidden')
else jsonb_build_object(
  'summary',jsonb_build_object(
    'assets',coalesce((select count(*) from scored),0),
    'completePaths',coalesce((select count(*) from scored where has_service and has_system
      and has_location and has_assembly and has_maintainable and has_component and has_failure),0),
    'boundedAt',200,
    'basis','Canonical composition only: organizations → verified asset service → recorded system and location → asset → evidenced component breakdown → governed FMMEA component binding.'),
  'assets',coalesce((select jsonb_agg(jsonb_build_object(
    'id',f.id,'tag',f.tag,'name',f.name,'enterprise',f.enterprise_name,
    'service',f.service_name,'serviceStatus',f.service_status,'system',f.system,
    'location',nullif(concat_ws(' · ',nullif(f.site_name,''),nullif(f.area,''),nullif(f.functional_location,'')),''),
    'functionalLocation',f.functional_location,
    'complete',f.has_service and f.has_system and f.has_location and f.has_assembly
      and f.has_maintainable and f.has_component and f.has_failure,
    'gaps',(select coalesce(jsonb_agg(gap),'[]'::jsonb) from unnest(array[
      case when not f.has_service then 'verified service' end,
      case when not f.has_system then 'system' end,
      case when not f.has_location then 'site and functional location' end,
      case when not f.has_assembly then 'evidenced assembly' end,
      case when not f.has_maintainable then 'evidenced maintainable item under assembly' end,
      case when not f.has_component then 'evidenced component under maintainable item' end,
      case when not f.has_failure then 'governed FMMEA failure mode bound to component' end
    ]) gap where gap is not null),
    'components',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'name',c.name,'type',c.type,'level',c.hierarchy_level,
      'parentComponentId',c.parent_component_id,'basis',c.hierarchy_basis,
      'evidenceItemId',c.hierarchy_evidence_item_id,'recordedAt',c.hierarchy_recorded_at)
      order by case c.hierarchy_level when 'assembly' then 1 when 'maintainable_item' then 2 else 3 end,c.name)
      from public.components c where c.organization_id=f.organization_id and c.asset_id=f.id),'[]'::jsonb),
    'failureModes',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'failureMode',m.failure_mode,'mechanism',dm.name,
      'componentId',m.hierarchy_component_id,'basis',m.hierarchy_basis,
      'evidenceItemId',m.hierarchy_evidence_item_id,'recordedAt',m.hierarchy_recorded_at)
      order by m.failure_mode)
      from public.asset_failure_mode_libraries m
      left join public.damage_mechanisms dm on dm.id=m.mechanism_id and dm.organization_id=m.organization_id
      where m.organization_id=f.organization_id and m.canonical_asset_id=f.id
        and m.mechanism_id is not null),'[]'::jsonb)
  ) order by coalesce(f.tag,f.name)) from scored f),'[]'::jsonb),
  'evidence',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'assetId',e.asset_id,
    'description',e.description,'evidenceClass',e.evidence_class,'sourceSystem',e.source_system)
    order by e.ts desc) from (select * from public.evidence_items
      where organization_id=public.app_current_org() and verification_status='verified'
      order by ts desc limit 100) e),'[]'::jsonb),
  'authority','Hierarchy records identity, parentage and evidence only. It does not prove condition, failure occurrence, capacity, service achievement, maintenance need, operating permission, risk acceptance or approval.'
) end
$$;

revoke all on function public.get_canonical_asset_hierarchy_workspace()
  from public,anon,service_role;
grant execute on function public.get_canonical_asset_hierarchy_workspace()
  to authenticated;

notify pgrst, 'reload schema';
