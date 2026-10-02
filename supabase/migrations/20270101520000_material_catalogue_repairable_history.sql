-- C2.07: customer-owned material master and serialized repairable / rotable
-- history. Canonical materials, stock, BOM, demand, component instances and
-- material events remain authoritative; this adds governed master revisions
-- plus the serialized unit identity that follows a rotable between assets and
-- through repair. No stock, supplier approval, repair outcome or turnaround is
-- inferred from a catalogue flag.

alter table public.materials
  add column if not exists repairable_classification text not null default 'unknown',
  add column if not exists master_version integer not null default 1,
  add column if not exists configured_by uuid references auth.users(id),
  add column if not exists configured_at timestamptz;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conrelid='public.materials'::regclass
      and conname='materials_repairable_classification_check'
  ) then
    alter table public.materials add constraint materials_repairable_classification_check
      check (repairable_classification in ('unknown','consumable','repairable','rotable'));
  end if;
  if not exists (
    select 1 from pg_constraint where conrelid='public.materials'::regclass
      and conname='materials_master_version_check'
  ) then
    alter table public.materials add constraint materials_master_version_check
      check (master_version>0);
  end if;
  if not exists (
    select 1 from pg_constraint where conrelid='public.materials'::regclass
      and conname='materials_lead_time_check'
  ) then
    alter table public.materials add constraint materials_lead_time_check
      check (lead_time_days is null or lead_time_days between 0 and 3650);
  end if;
  if not exists (
    select 1 from pg_constraint where conrelid='public.materials'::regclass
      and conname='materials_min_max_check'
  ) then
    alter table public.materials add constraint materials_min_max_check
      check (min_qty is null or min_qty>=0) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint where conrelid='public.materials'::regclass
      and conname='materials_max_qty_check'
  ) then
    alter table public.materials add constraint materials_max_qty_check
      check (max_qty is null or max_qty>=0) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint where conrelid='public.materials'::regclass
      and conname='materials_min_not_above_max_check'
  ) then
    alter table public.materials add constraint materials_min_not_above_max_check
      check (min_qty is null or max_qty is null or min_qty<=max_qty) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint where conrelid='public.materials'::regclass
      and conname='materials_unit_cost_check'
  ) then
    alter table public.materials add constraint materials_unit_cost_check
      check (unit_cost_usd is null or unit_cost_usd>=0) not valid;
  end if;
end $$;

update public.materials set
  repairable_classification=case when repairable then 'repairable' else 'unknown' end,
  master_version=greatest(coalesce(master_version,1),1)
where repairable_classification='unknown' and repairable;

create table if not exists public.material_master_revisions (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete restrict,
  version integer not null check (version>0),
  action text not null check (action in ('baseline','created','revised','source_sync')),
  configuration jsonb not null,
  basis text not null,
  actor_id uuid references auth.users(id),
  actor_role text,
  created_at timestamptz not null default now(),
  unique(material_id,version)
);
create index if not exists idx_material_master_revisions_org
  on public.material_master_revisions(organization_id,material_id,version desc);
alter table public.material_master_revisions enable row level security;
drop policy if exists material_master_revisions_org_read on public.material_master_revisions;
create policy material_master_revisions_org_read on public.material_master_revisions
  for select to authenticated using (organization_id=public.app_current_org());

create or replace function public.material_master_configuration(p_material public.materials)
returns jsonb language sql immutable set search_path=public as $$
  select jsonb_build_object(
    'materialId',p_material.id,'materialCode',p_material.material_code,
    'description',p_material.description,'category',p_material.category,
    'unitOfMeasure',p_material.unit_of_measure,
    'unitCostUsd',p_material.unit_cost_usd,
    'leadTimeDays',p_material.lead_time_days,
    'minimumQuantity',p_material.min_qty,'maximumQuantity',p_material.max_qty,
    'repairableClassification',p_material.repairable_classification,
    'legacyRepairable',p_material.repairable,
    'criticality',p_material.criticality,'isTemplate',p_material.is_template,
    'basis',p_material.basis,'sourceSystem',p_material.source_system,
    'masterVersion',p_material.master_version
  )
$$;

create or replace function public.capture_material_master_revision()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_action text;
begin
  if tg_op='UPDATE' then
    if row(
      new.material_code,new.description,new.category,new.unit_of_measure,
      new.unit_cost_usd,new.lead_time_days,new.min_qty,new.max_qty,
      new.repairable_classification,new.criticality,new.basis,new.source_system,
      new.is_template
    ) is not distinct from row(
      old.material_code,old.description,old.category,old.unit_of_measure,
      old.unit_cost_usd,old.lead_time_days,old.min_qty,old.max_qty,
      old.repairable_classification,old.criticality,old.basis,old.source_system,
      old.is_template
    ) then
      -- Version, actor and legacy repairable are derived fields. A direct
      -- writer cannot advance them without changing governed configuration.
      new.master_version:=old.master_version;
      new.configured_by:=old.configured_by;
      new.configured_at:=old.configured_at;
      new.repairable:=old.repairable_classification in ('repairable','rotable');
      return new;
    end if;
    new.master_version:=old.master_version+1;
    v_action:=case when auth.uid() is null then 'source_sync' else 'revised' end;
  else
    new.master_version:=1;
    v_action:=case when auth.uid() is null then 'source_sync' else 'created' end;
  end if;
  new.repairable:=new.repairable_classification in ('repairable','rotable');
  new.configured_by:=coalesce(auth.uid(),new.configured_by);
  new.configured_at:=now();
  perform set_config('app.material_revision_action',v_action,true);
  return new;
end $$;

create or replace function public.append_material_master_revision()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.material_master_revisions(
    organization_id,material_id,version,action,configuration,basis,
    actor_id,actor_role
  ) values(
    new.organization_id,new.id,new.master_version,
    coalesce(nullif(current_setting('app.material_revision_action',true),''),'source_sync'),
    public.material_master_configuration(new),
    coalesce(nullif(btrim(new.basis),''),'Source basis not recorded on legacy material.'),
    auth.uid(),public.app_current_role()
  ) on conflict(material_id,version) do nothing;
  return new;
end $$;

drop trigger if exists trg_material_master_version on public.materials;
create trigger trg_material_master_version before insert or update on public.materials
  for each row execute function public.capture_material_master_revision();
drop trigger if exists trg_material_master_revision on public.materials;
create trigger trg_material_master_revision after insert or update on public.materials
  for each row execute function public.append_material_master_revision();

insert into public.material_master_revisions(
  organization_id,material_id,version,action,configuration,basis,actor_id,actor_role)
select m.organization_id,m.id,m.master_version,'baseline',
  public.material_master_configuration(m),
  coalesce(nullif(btrim(m.basis),''),'Source basis not recorded on legacy material.'),
  m.configured_by,'migration'
from public.materials m
on conflict(material_id,version) do nothing;

create or replace function public.protect_material_master_history()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'material master history is append-only';
end $$;
drop trigger if exists trg_protect_material_master_revisions on public.material_master_revisions;
create trigger trg_protect_material_master_revisions before update or delete
  on public.material_master_revisions for each row
  execute function public.protect_material_master_history();

create or replace function public.material_master_human_role_allowed()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.user_profiles up
    where up.id=auth.uid() and up.organization_id=public.app_current_org()
      and coalesce(up.role,'')<>'ai_admin'
      and up.role in ('admin','executive','maintenance_manager',
        'reliability_engineer','planner','inventory_manager')
  )
$$;
revoke all on function public.material_master_human_role_allowed() from public,anon;
grant execute on function public.material_master_human_role_allowed() to authenticated;

create or replace function public.upsert_catalogue_material(
  p_material_id uuid,p_material_code text,p_description text,p_category text,
  p_unit_of_measure text,p_unit_cost_usd numeric,p_lead_time_days integer,
  p_min_qty numeric,p_max_qty numeric,p_repairable_classification text,
  p_criticality text,p_source_system text,p_basis text,
  p_expected_version integer default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_material public.materials%rowtype;
  v_existing public.materials%rowtype; v_previous jsonb;
begin
  if not public.material_master_human_role_allowed() then
    return jsonb_build_object('error','a named human materials, planning, engineering or governance role is required');
  end if;
  if coalesce(length(btrim(p_material_code)),0)<1
     or coalesce(length(btrim(p_description)),0)<2
     or coalesce(length(btrim(p_unit_of_measure)),0)<1
     or coalesce(length(btrim(p_basis)),0)<20 then
    return jsonb_build_object('error','code, description, unit and a basis of at least 20 characters are required');
  end if;
  if p_repairable_classification is null or p_repairable_classification not in
      ('unknown','consumable','repairable','rotable') then
    return jsonb_build_object('error','repairable classification is explicitly unknown until a human selects consumable, repairable or rotable');
  end if;
  if p_criticality is not null and p_criticality not in ('critical','essential','routine') then
    return jsonb_build_object('error','invalid material criticality');
  end if;
  if p_unit_cost_usd<0 or p_lead_time_days<0 or p_lead_time_days>3650
     or p_min_qty<0 or p_max_qty<0
     or (p_min_qty is not null and p_max_qty is not null and p_max_qty<p_min_qty) then
    return jsonb_build_object('error','cost, lead time and min/max must be non-negative and maximum cannot be below minimum');
  end if;

  if p_material_id is null then
    insert into public.materials(
      organization_id,material_code,description,category,unit_of_measure,
      unit_cost_usd,lead_time_days,min_qty,max_qty,repairable_classification,
      criticality,is_template,basis,source_system,configured_by
    ) values(
      v_org,btrim(p_material_code),btrim(p_description),nullif(btrim(coalesce(p_category,'')),''),
      btrim(p_unit_of_measure),p_unit_cost_usd,p_lead_time_days,p_min_qty,p_max_qty,
      p_repairable_classification,p_criticality,false,btrim(p_basis),
      coalesce(nullif(btrim(coalesce(p_source_system,'')),''),'customer_catalogue'),auth.uid()
    ) returning * into v_material;
  else
    select * into v_existing from public.materials
    where id=p_material_id and organization_id=v_org and not is_template
    for update;
    if not found or v_existing.master_version<>p_expected_version then
      return jsonb_build_object('error',
        'material changed after it was loaded, is a template, or is outside the active tenant');
    end if;
    v_previous:=public.material_master_configuration(v_existing);
    update public.materials set
      material_code=btrim(p_material_code),description=btrim(p_description),
      category=nullif(btrim(coalesce(p_category,'')),''),
      unit_of_measure=btrim(p_unit_of_measure),unit_cost_usd=p_unit_cost_usd,
      lead_time_days=p_lead_time_days,min_qty=p_min_qty,max_qty=p_max_qty,
      repairable_classification=p_repairable_classification,
      criticality=p_criticality,basis=btrim(p_basis),
      source_system=coalesce(nullif(btrim(coalesce(p_source_system,'')),''),source_system)
    where id=p_material_id and organization_id=v_org and not is_template
    returning * into v_material;
  end if;

  insert into public.audit_events(organization_id,entity_type,actor,event_data,
    previous_state,new_state)
  values(v_org,'material_catalogue',public.app_current_role(),jsonb_build_object(
    'action',case when p_material_id is null then 'created'
      when v_material.master_version=p_expected_version then 'unchanged'
      else 'revised' end,
    'actorId',auth.uid(),'materialId',v_material.id,
    'masterVersion',v_material.master_version,'basis',btrim(p_basis),
    'sourceSystem',v_material.source_system,'operationalAuthorization',false),
    v_previous,public.material_master_configuration(v_material));
  return jsonb_build_object('materialId',v_material.id,
    'materialCode',v_material.material_code,'masterVersion',v_material.master_version,
    'repairableClassification',v_material.repairable_classification,
    'operationalAuthorization',false);
exception when unique_violation then
  return jsonb_build_object('error','this material code already exists in the active tenant');
end $$;
revoke all on function public.upsert_catalogue_material(
  uuid,text,text,text,text,numeric,integer,numeric,numeric,text,text,text,text,integer)
  from public,anon,service_role;
grant execute on function public.upsert_catalogue_material(
  uuid,text,text,text,text,numeric,integer,numeric,numeric,text,text,text,text,integer)
  to authenticated;

-- Preserve the old narrow contract while routing it through governed versioning.
create or replace function public.create_catalogue_material(
  p_material_code text,p_description text,p_unit_of_measure text,p_basis text
)
returns jsonb language sql security definer set search_path=public as $$
  select public.upsert_catalogue_material(
    null,p_material_code,p_description,null,p_unit_of_measure,null,null,null,null,
    'unknown',null,'customer_catalogue',p_basis,null)
$$;
revoke all on function public.create_catalogue_material(text,text,text,text)
  from public,anon,service_role;
grant execute on function public.create_catalogue_material(text,text,text,text)
  to authenticated;

create table if not exists public.repairable_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete restrict,
  serial_number text not null,
  current_state text not null default 'available' check (current_state in
    ('available','installed','removed','in_repair','quarantined','scrapped')),
  current_component_instance_id uuid references public.component_instances(id) on delete restrict,
  version integer not null default 1 check (version>0),
  source_system text not null,
  source_ref text,
  basis text not null check (length(btrim(basis))>=20),
  registered_by uuid not null references auth.users(id),
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_repairable_units_org_serial
  on public.repairable_units(organization_id,material_id,lower(btrim(serial_number)));
create index if not exists idx_repairable_units_state
  on public.repairable_units(organization_id,current_state,material_id);

create table if not exists public.repairable_unit_events (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  repairable_unit_id uuid not null references public.repairable_units(id) on delete restrict,
  sequence integer not null check (sequence>0),
  event_type text not null check (event_type in (
    'registered','installed','removed','sent_for_repair','received_from_repair',
    'quarantined','released_from_quarantine','scrapped')),
  from_state text,
  to_state text not null,
  occurred_at timestamptz not null,
  component_instance_id uuid references public.component_instances(id) on delete restrict,
  work_order_id uuid references public.work_orders(id) on delete restrict,
  supplier_id bigint references public.suppliers(id) on delete restrict,
  meter_hours numeric check (meter_hours is null or meter_hours>=0),
  repair_cost_usd numeric check (repair_cost_usd is null or repair_cost_usd>=0),
  repair_order_ref text,
  evidence_ref text,
  source_system text not null,
  basis text not null check (length(btrim(basis))>=20),
  actor_id uuid not null references auth.users(id),
  evidence_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(repairable_unit_id,sequence)
);
create index if not exists idx_repairable_unit_events_history
  on public.repairable_unit_events(organization_id,repairable_unit_id,occurred_at,sequence);

alter table public.repairable_units enable row level security;
alter table public.repairable_unit_events enable row level security;
drop policy if exists repairable_units_org_read on public.repairable_units;
create policy repairable_units_org_read on public.repairable_units
  for select to authenticated using (organization_id=public.app_current_org());
drop policy if exists repairable_unit_events_org_read on public.repairable_unit_events;
create policy repairable_unit_events_org_read on public.repairable_unit_events
  for select to authenticated using (organization_id=public.app_current_org());

create or replace function public.protect_repairable_unit_events()
returns trigger language plpgsql set search_path=public as $$
begin raise exception 'repairable unit events are append-only'; end $$;
drop trigger if exists trg_protect_repairable_unit_events on public.repairable_unit_events;
create trigger trg_protect_repairable_unit_events before update or delete
  on public.repairable_unit_events for each row
  execute function public.protect_repairable_unit_events();

create or replace function public.register_repairable_unit(
  p_material_id uuid,p_serial_number text,p_source_system text,p_basis text,
  p_source_ref text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_unit public.repairable_units%rowtype;
  v_material public.materials%rowtype;
begin
  if not public.material_master_human_role_allowed() then return jsonb_build_object(
    'error','a named human materials, planning, engineering or governance role is required'); end if;
  if coalesce(length(btrim(p_serial_number)),0)<2
     or coalesce(length(btrim(p_source_system)),0)<2
     or coalesce(length(btrim(p_basis)),0)<20 then return jsonb_build_object(
       'error','serial, source and basis must be at least 20 characters for the basis'); end if;
  select * into v_material from public.materials m where m.id=p_material_id
    and m.organization_id=v_org and not m.is_template
    and m.repairable_classification in ('repairable','rotable');
  if not found then
    return jsonb_build_object('error','repairable material is outside the active tenant or is not classified repairable/rotable');
  end if;
  insert into public.repairable_units(
    organization_id,material_id,serial_number,current_state,source_system,
    source_ref,basis,registered_by)
  values(v_org,p_material_id,btrim(p_serial_number),'available',btrim(p_source_system),
    nullif(btrim(coalesce(p_source_ref,'')),''),btrim(p_basis),auth.uid())
  returning * into v_unit;
  insert into public.repairable_unit_events(
    organization_id,repairable_unit_id,sequence,event_type,from_state,to_state,
    occurred_at,source_system,evidence_ref,basis,actor_id,evidence_snapshot)
  values(v_org,v_unit.id,1,'registered',null,'available',v_unit.registered_at,
    v_unit.source_system,v_unit.source_ref,v_unit.basis,auth.uid(),
    jsonb_build_object(
      'material',jsonb_build_object('id',v_material.id,'code',v_material.material_code,
        'description',v_material.description,
        'repairableClassification',v_material.repairable_classification,
        'masterVersion',v_material.master_version),
      'unit',jsonb_build_object('id',v_unit.id,'serialNumber',v_unit.serial_number,
        'state','available','version',1),
      'sourceSystem',v_unit.source_system,'sourceRef',v_unit.source_ref));
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'repairable_unit',public.app_current_role(),jsonb_build_object(
    'action','registered','repairableUnitId',v_unit.id,'materialId',p_material_id,
    'actorId',auth.uid(),'operationalAuthorization',false));
  return jsonb_build_object('repairableUnitId',v_unit.id,'version',1,
    'currentState','available','operationalAuthorization',false);
exception when unique_violation then return jsonb_build_object(
  'error','this serialized repairable already exists for the material in the active tenant');
end $$;
revoke all on function public.register_repairable_unit(uuid,text,text,text,text)
  from public,anon,service_role;
grant execute on function public.register_repairable_unit(uuid,text,text,text,text)
  to authenticated;

create or replace function public.record_repairable_unit_event(
  p_repairable_unit_id uuid,p_event_type text,p_occurred_at timestamptz,
  p_basis text,p_expected_version integer,p_source_system text,
  p_asset_id uuid default null,p_component text default null,p_position text default null,
  p_meter_hours numeric default null,p_work_order_id uuid default null,
  p_supplier_id bigint default null,p_repair_cost_usd numeric default null,
  p_repair_order_ref text default null,p_evidence_ref text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_unit public.repairable_units%rowtype;
  v_from text; v_to text; v_sequence integer; v_component uuid;
  v_component_row public.component_instances%rowtype; v_last_occurred timestamptz;
  v_asset uuid; v_repair_supplier bigint; v_repair_order text;
  v_quarantine_origin text;
  v_material public.materials%rowtype; v_asset_row public.assets%rowtype;
  v_supplier public.suppliers%rowtype; v_work public.work_orders%rowtype;
begin
  if not public.material_master_human_role_allowed() then return jsonb_build_object(
    'error','a named human materials, planning, engineering or governance role is required'); end if;
  if coalesce(length(btrim(p_basis)),0)<20 then return jsonb_build_object(
    'error','event basis must be at least 20 characters'); end if;
  if coalesce(length(btrim(p_source_system)),0)<2 or p_occurred_at is null
     or p_occurred_at>now()+interval '1 hour' then return jsonb_build_object(
       'error','a source and credible event time are required'); end if;
  if p_meter_hours<0 or p_repair_cost_usd<0 then return jsonb_build_object(
    'error','meter and repair cost cannot be negative'); end if;

  select * into v_unit from public.repairable_units
  where id=p_repairable_unit_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','repairable unit is outside the active tenant'); end if;
  if v_unit.version<>p_expected_version then return jsonb_build_object(
    'error','repairable unit changed after it was loaded; refresh before recording an event'); end if;
  select * into v_material from public.materials m
  where m.id=v_unit.material_id and m.organization_id=v_org;
  if not found then return jsonb_build_object('error','material evidence is outside the active tenant'); end if;
  if p_work_order_id is not null then
    select * into v_work from public.work_orders w
    where w.id=p_work_order_id and w.organization_id=v_org;
    if not found then return jsonb_build_object('error','work order is outside the active tenant'); end if;
  end if;
  if p_supplier_id is not null then
    select * into v_supplier from public.suppliers s
    where s.id=p_supplier_id and s.organization_id=v_org;
    if not found then return jsonb_build_object('error','supplier is outside the active tenant'); end if;
  end if;

  select max(e.occurred_at) into v_last_occurred
  from public.repairable_unit_events e
  where e.repairable_unit_id=v_unit.id and e.organization_id=v_org;
  if v_last_occurred is not null and p_occurred_at<v_last_occurred then
    return jsonb_build_object('error','event time cannot precede the latest recorded lifecycle event');
  end if;

  v_from:=v_unit.current_state;
  if p_event_type='released_from_quarantine' then
    select e.from_state into v_quarantine_origin
    from public.repairable_unit_events e
    where e.repairable_unit_id=v_unit.id and e.organization_id=v_org
      and e.event_type='quarantined'
    order by e.sequence desc limit 1;
    if v_quarantine_origin not in ('available','removed','in_repair') then
      return jsonb_build_object('error','quarantine origin evidence is missing or invalid');
    end if;
  end if;
  v_to:=case p_event_type
    when 'installed' then 'installed'
    when 'removed' then 'removed'
    when 'sent_for_repair' then 'in_repair'
    when 'received_from_repair' then 'available'
    when 'quarantined' then 'quarantined'
    when 'released_from_quarantine' then v_quarantine_origin
    when 'scrapped' then 'scrapped'
    else null end;
  if v_to is null or not (
    (v_from='available' and p_event_type in ('installed','quarantined','scrapped')) or
    (v_from='installed' and p_event_type='removed') or
    (v_from='removed' and p_event_type in ('sent_for_repair','quarantined','scrapped')) or
    (v_from='in_repair' and p_event_type in ('received_from_repair','quarantined','scrapped')) or
    (v_from='quarantined' and p_event_type in ('released_from_quarantine','scrapped'))
  ) then return jsonb_build_object('error',format(
    'invalid repairable-unit transition: %s cannot follow %s',p_event_type,v_from)); end if;

  select coalesce(max(sequence),0)+1 into v_sequence from public.repairable_unit_events
  where repairable_unit_id=v_unit.id;

  if p_event_type='installed' then
    if p_asset_id is null or coalesce(length(btrim(p_component)),0)<2
       or coalesce(length(btrim(p_position)),0)<1 then return jsonb_build_object(
         'error','installation requires a tenant asset, component and position'); end if;
    select * into v_asset_row from public.assets a
    where a.id=p_asset_id and a.organization_id=v_org;
    if not found then return jsonb_build_object('error','asset is outside the active tenant'); end if;
    if exists(select 1 from public.component_instances ci where ci.organization_id=v_org
      and ci.asset_id=p_asset_id and lower(ci.component)=lower(btrim(p_component))
      and lower(ci.position)=lower(btrim(p_position)) and ci.state='installed') then
      return jsonb_build_object('error','an installed component already occupies this position'); end if;
    insert into public.component_instances(
      organization_id,asset_id,component,position,material_id,serial_number,
      installed_at,installed_meter_hours,state,source_system,source_ref,basis,recorded_by)
    values(v_org,p_asset_id,btrim(p_component),btrim(p_position),v_unit.material_id,
      v_unit.serial_number,p_occurred_at,p_meter_hours,'installed',btrim(p_source_system),
      p_evidence_ref,btrim(p_basis),auth.uid()) returning * into v_component_row;
    v_component:=v_component_row.id;
    v_asset:=p_asset_id;
  elsif p_event_type='removed' then
    select * into v_component_row from public.component_instances
    where id=v_unit.current_component_instance_id and organization_id=v_org
      and state='installed' for update;
    if not found then return jsonb_build_object('error','installed canonical component instance is missing'); end if;
    if p_occurred_at<v_component_row.installed_at
       or (v_component_row.installed_meter_hours is not null and p_meter_hours is not null
         and p_meter_hours<v_component_row.installed_meter_hours) then return jsonb_build_object(
           'error','removal cannot precede installation time or meter'); end if;
    update public.component_instances set state='removed',removed_at=p_occurred_at,
      removed_meter_hours=p_meter_hours,basis=basis||' | Removed: '||btrim(p_basis)
    where id=v_component_row.id;
    v_component:=v_component_row.id;
    v_asset:=v_component_row.asset_id;
    select * into v_asset_row from public.assets a
    where a.id=v_asset and a.organization_id=v_org;
  else
    v_component:=v_unit.current_component_instance_id;
  end if;

  if p_event_type='sent_for_repair' and (
      p_supplier_id is null
      or coalesce(length(btrim(coalesce(p_repair_order_ref,''))),0)<2
    ) then return jsonb_build_object(
      'error','sent-for-repair requires a tenant supplier and repair-order reference'); end if;

  if p_event_type='received_from_repair' and coalesce(length(btrim(coalesce(p_evidence_ref,''))),0)<3
    then return jsonb_build_object('error','received-from-repair requires inspection or repair evidence reference'); end if;
  if p_event_type='sent_for_repair' then
    v_repair_supplier:=p_supplier_id;
    v_repair_order:=nullif(btrim(coalesce(p_repair_order_ref,'')),'');
  elsif p_event_type='received_from_repair' or v_from='in_repair' or v_to='in_repair' then
    select e.supplier_id,e.repair_order_ref
      into v_repair_supplier,v_repair_order
    from public.repairable_unit_events e
    where e.repairable_unit_id=v_unit.id and e.organization_id=v_org
      and e.event_type='sent_for_repair'
    order by e.sequence desc limit 1;
    if v_repair_supplier is null or v_repair_order is null then
      return jsonb_build_object('error','repair lifecycle has no preceding repair dispatch evidence');
    end if;
    if p_event_type='received_from_repair'
       and p_supplier_id is not null and p_supplier_id<>v_repair_supplier then
      return jsonb_build_object('error','receipt supplier conflicts with the preceding repair dispatch');
    end if;
    if p_event_type='received_from_repair'
       and nullif(btrim(coalesce(p_repair_order_ref,'')),'') is not null
       and btrim(p_repair_order_ref)<>v_repair_order then
      return jsonb_build_object('error','receipt repair order conflicts with the preceding repair dispatch');
    end if;
    select * into v_supplier from public.suppliers s
    where s.id=v_repair_supplier and s.organization_id=v_org;
  else
    v_repair_supplier:=p_supplier_id;
    v_repair_order:=nullif(btrim(coalesce(p_repair_order_ref,'')),'');
  end if;

  update public.repairable_units set current_state=v_to,
    current_component_instance_id=case
      when p_event_type='installed' then v_component
      when p_event_type='removed' then null
      else current_component_instance_id end,
    version=version+1,updated_at=now()
  where id=v_unit.id returning * into v_unit;

  insert into public.repairable_unit_events(
    organization_id,repairable_unit_id,sequence,event_type,from_state,to_state,
    occurred_at,component_instance_id,work_order_id,supplier_id,meter_hours,
    repair_cost_usd,repair_order_ref,evidence_ref,source_system,basis,actor_id,
    evidence_snapshot)
  values(v_org,v_unit.id,v_sequence,p_event_type,v_from,v_to,p_occurred_at,
    v_component,p_work_order_id,v_repair_supplier,p_meter_hours,p_repair_cost_usd,
    v_repair_order,
    nullif(btrim(coalesce(p_evidence_ref,'')),''),btrim(p_source_system),
    btrim(p_basis),auth.uid(),jsonb_build_object(
      'material',jsonb_build_object('id',v_material.id,'code',v_material.material_code,
        'description',v_material.description,
        'repairableClassification',v_material.repairable_classification,
        'masterVersion',v_material.master_version),
      'unit',jsonb_build_object('id',v_unit.id,'serialNumber',v_unit.serial_number,
        'fromState',v_from,'toState',v_to,'version',v_unit.version),
      'componentInstance',case when v_component is null then null else jsonb_build_object(
        'id',v_component,'component',coalesce(v_component_row.component,p_component),
        'position',coalesce(v_component_row.position,p_position),
        'installedAt',coalesce(v_component_row.installed_at,
          case when p_event_type='installed' then p_occurred_at else null end)) end,
      'asset',case when v_asset is null then null else jsonb_build_object(
        'id',v_asset,'tag',v_asset_row.tag,'name',v_asset_row.name) end,
      'workOrder',case when p_work_order_id is null then null else jsonb_build_object(
        'id',p_work_order_id,'number',v_work.wo_number,'title',v_work.title) end,
      'supplier',case when v_repair_supplier is null then null else jsonb_build_object(
        'id',v_repair_supplier,'code',v_supplier.supplier_code,'name',v_supplier.name) end,
      'meterHours',p_meter_hours,'repairCostUsd',p_repair_cost_usd,
      'repairOrderRef',v_repair_order,'evidenceRef',p_evidence_ref,
      'sourceSystem',p_source_system));
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'repairable_unit',public.app_current_role(),jsonb_build_object(
    'action',p_event_type,'repairableUnitId',v_unit.id,'fromState',v_from,
    'toState',v_to,'sequence',v_sequence,'actorId',auth.uid(),
    'operationalAuthorization',false));
  return jsonb_build_object('repairableUnitId',v_unit.id,'eventType',p_event_type,
    'currentState',v_to,'version',v_unit.version,'sequence',v_sequence,
    'operationalAuthorization',false);
end $$;
revoke all on function public.record_repairable_unit_event(
  uuid,text,timestamptz,text,integer,text,uuid,text,text,numeric,uuid,bigint,numeric,text,text)
  from public,anon,service_role;
grant execute on function public.record_repairable_unit_event(
  uuid,text,timestamptz,text,integer,text,uuid,text,text,numeric,uuid,bigint,numeric,text,text)
  to authenticated;

create or replace function public.get_repairable_unit_register()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_units jsonb; v_materials jsonb; v_assets jsonb; v_suppliers jsonb;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',u.id,'materialId',u.material_id,'materialCode',m.material_code,
    'description',m.description,'classification',m.repairable_classification,
    'serialNumber',u.serial_number,'currentState',u.current_state,
    'version',u.version,'sourceSystem',u.source_system,'sourceRef',u.source_ref,
    'basis',u.basis,'registeredAt',u.registered_at,
    'currentComponentInstanceId',u.current_component_instance_id,
    'currentAssetId',ci.asset_id,'currentAsset',a.name,
    'currentComponent',ci.component,'currentPosition',ci.position,
    'repairTurnaroundHours',turnaround.hours,
    'turnaroundBasis',case when turnaround.hours is null
      then 'Repair turnaround is not measurable until a sent-for-repair event is followed by received-from-repair evidence.'
      else 'Latest completed sent-for-repair to received-from-repair interval.' end,
    'events',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'sequence',e.sequence,'eventType',e.event_type,
      'fromState',e.from_state,'toState',e.to_state,'occurredAt',e.occurred_at,
      'componentInstanceId',e.component_instance_id,'workOrderId',e.work_order_id,
      'supplierId',e.supplier_id,'meterHours',e.meter_hours,
      'repairCostUsd',e.repair_cost_usd,'repairOrderRef',e.repair_order_ref,
      'evidenceRef',e.evidence_ref,'sourceSystem',e.source_system,
      'basis',e.basis,'actor',up.full_name)
      order by e.sequence desc)
      from public.repairable_unit_events e
      left join public.user_profiles up on up.id=e.actor_id and up.organization_id=v_org
      where e.repairable_unit_id=u.id),'[]'::jsonb)
  ) order by m.material_code,u.serial_number),'[]'::jsonb)
  into v_units
  from public.repairable_units u
  join public.materials m on m.id=u.material_id and m.organization_id=v_org
  left join public.component_instances ci on ci.id=u.current_component_instance_id
    and ci.organization_id=v_org
  left join public.assets a on a.id=ci.asset_id and a.organization_id=v_org
  left join lateral (
    select round(extract(epoch from (received.occurred_at-sent.occurred_at))/3600.0,1) hours
    from public.repairable_unit_events received
    join lateral (
      select s.occurred_at from public.repairable_unit_events s
      where s.repairable_unit_id=u.id and s.event_type='sent_for_repair'
        and s.occurred_at<=received.occurred_at
      order by s.occurred_at desc,s.sequence desc limit 1
    ) sent on true
    where received.repairable_unit_id=u.id and received.event_type='received_from_repair'
    order by received.occurred_at desc,received.sequence desc limit 1
  ) turnaround on true
  where u.organization_id=v_org;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'materialCode',m.material_code,'description',m.description,
    'classification',m.repairable_classification,'masterVersion',m.master_version,
    'leadTimeDays',m.lead_time_days,'criticality',m.criticality,
    'stockRows',(select count(*) from public.material_stock s where s.organization_id=v_org and s.material_id=m.id),
    'bomRows',(select count(*) from public.bom_lines b where b.organization_id=v_org and b.material_id=m.id)
  ) order by m.material_code),'[]'::jsonb) into v_materials
  from public.materials m where m.organization_id=v_org and not m.is_template
    and m.repairable_classification in ('repairable','rotable');
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'tag',a.tag,'name',a.name)
    order by a.name),'[]'::jsonb) into v_assets from public.assets a where a.organization_id=v_org;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'code',s.supplier_code,'name',s.name)
    order by s.name),'[]'::jsonb) into v_suppliers from public.suppliers s where s.organization_id=v_org;
  return jsonb_build_object('units',v_units,'materials',v_materials,
    'assets',v_assets,'suppliers',v_suppliers,
    'authority','Human evidence recording only; no stock receipt, supplier approval, work release, installation approval or repair acceptance is inferred.');
end $$;
revoke all on function public.get_repairable_unit_register() from public,anon,service_role;
grant execute on function public.get_repairable_unit_register() to authenticated;

revoke insert,update,delete,truncate on public.materials
  from public,anon,authenticated,service_role;
revoke insert,update,delete,truncate on public.material_master_revisions
  from public,anon,authenticated,service_role;
revoke insert,update,delete,truncate on public.repairable_units
  from public,anon,authenticated,service_role;
revoke insert,update,delete,truncate on public.repairable_unit_events
  from public,anon,authenticated,service_role;
grant select on public.material_master_revisions,public.repairable_units,
  public.repairable_unit_events to authenticated;

comment on table public.repairable_units is
  'C2.07 serialized repairable/rotable identity that follows a unit across assets and repair cycles.';
comment on function public.get_repairable_unit_register() is
  'C2.07 tenant materials and serialized repairable evidence; turnaround remains null without a complete observed repair pair.';

notify pgrst,'reload schema';
