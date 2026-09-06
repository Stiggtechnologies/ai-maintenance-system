-- ============================================================================
-- Sync Recovery full close-out — OPTIMIZE
--
-- Adds reproducible empirical uncertainty, what-if analysis, component age/life,
-- governed donor/substitution trade studies, material condition/certification,
-- multi-event scarce-craft allocation, historical sequence patterns and crew
-- productivity normalization. All outputs expose evidence sufficiency and never
-- manufacture history, inventory, life or uncertainty.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Canonical component state + meter history (component_life_events remains the
-- historical failure/censoring source).
-- ---------------------------------------------------------------------------
create table if not exists asset_meter_readings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  meter_kind text not null default 'operating_hours',
  value numeric not null check (value >= 0),
  recorded_at timestamptz not null,
  source_system text not null,
  source_ref text,
  basis text not null,
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_asset_meter_latest on asset_meter_readings(organization_id,asset_id,meter_kind,recorded_at desc);

create table if not exists component_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  component text not null,
  position text not null default 'default',
  material_id uuid references materials(id) on delete set null,
  serial_number text,
  installed_at timestamptz not null,
  installed_meter_hours numeric check (installed_meter_hours is null or installed_meter_hours >= 0),
  removed_at timestamptz,
  removed_meter_hours numeric check (removed_meter_hours is null or removed_meter_hours >= 0),
  state text not null default 'installed' check (state in ('installed','removed','quarantined')),
  source_system text not null,
  source_ref text,
  basis text not null,
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists uq_component_active_position on component_instances(organization_id,asset_id,component,position) where state='installed';

-- ---------------------------------------------------------------------------
-- Material condition/certification + governed alternatives.
-- ---------------------------------------------------------------------------
create table if not exists material_stock_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  site_id uuid references sites(id) on delete cascade,
  lot_ref text not null,
  qty numeric not null check (qty >= 0),
  condition text not null check (condition in ('serviceable','inspection_required','unserviceable','unknown')),
  certification_status text not null default 'unknown' check (certification_status in ('not_required','valid','missing','expired','unknown')),
  certification_ref text,
  staged_for_work_order_id uuid references work_orders(id) on delete set null,
  location text,
  expires_at timestamptz,
  source_system text not null,
  basis text not null,
  updated_at timestamptz not null default now(),
  unique(organization_id,material_id,site_id,lot_ref)
);

create table if not exists material_substitutions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  substitute_material_id uuid not null references materials(id) on delete cascade,
  substitution_type text not null check (substitution_type in ('approved_alternate','repairable_exchange','temporary_engineering_substitution')),
  approval_status text not null check (approval_status in ('approved','pending','rejected')),
  basis text not null,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (material_id <> substitute_material_id),
  unique(organization_id,material_id,substitute_material_id)
);

-- ---------------------------------------------------------------------------
-- Immutable optimization evidence runs.
-- ---------------------------------------------------------------------------
create table if not exists recovery_plan_risk_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  plan_id uuid not null references restoration_plan_versions(id) on delete cascade,
  iterations int not null check (iterations between 100 and 10000),
  method text not null,
  result jsonb not null,
  generated_by uuid references auth.users(id),
  generated_at timestamptz not null default now()
);

create table if not exists recovery_fleet_optimization_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id) on delete cascade,
  algorithm text not null,
  result jsonb not null,
  generated_by uuid references auth.users(id),
  generated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tenant read policies; writes remain RPC-only.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['asset_meter_readings','component_instances','material_stock_lots','material_substitutions','recovery_plan_risk_runs','recovery_fleet_optimization_runs'] loop
    execute format('alter table %I enable row level security',t);
    execute format('drop policy if exists %I on %I',t||'_org_read',t);
    execute format('create policy %I on %I for select to authenticated using (organization_id=public.app_current_org())',t||'_org_read',t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Component and material authoring.
-- ---------------------------------------------------------------------------
create or replace function public.record_asset_meter_reading(p_asset_id uuid,p_value numeric,p_recorded_at timestamptz,p_source_system text,p_basis text,p_meter_kind text default 'operating_hours',p_source_ref text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_id uuid; v_prev numeric;
begin
  if not public.recovery_role_allowed(array['technician','planner','supervisor','maintenance_manager','reliability_engineer','operator','admin','ai_admin']) then return jsonb_build_object('error','meter authority denied'); end if;
  if p_value<0 or coalesce(length(trim(p_source_system)),0)<2 or coalesce(length(trim(p_basis)),0)<10 then return jsonb_build_object('error','non-negative meter, source and basis required'); end if;
  if not exists(select 1 from assets where id=p_asset_id and organization_id=v_org) then return jsonb_build_object('error','asset not found'); end if;
  select value into v_prev from asset_meter_readings where organization_id=v_org and asset_id=p_asset_id and meter_kind=p_meter_kind and recorded_at<=p_recorded_at order by recorded_at desc limit 1;
  if v_prev is not null and p_value<v_prev then return jsonb_build_object('error','meter rollback refused; use a separate meter kind or correct the source'); end if;
  insert into asset_meter_readings(organization_id,asset_id,meter_kind,value,recorded_at,source_system,source_ref,basis,recorded_by)
  values(v_org,p_asset_id,coalesce(nullif(trim(p_meter_kind),''),'operating_hours'),p_value,p_recorded_at,trim(p_source_system),p_source_ref,trim(p_basis),auth.uid()) returning id into v_id;
  return jsonb_build_object('ok',true,'meter_reading_id',v_id,'value',p_value);
end $$;

create or replace function public.record_component_installation(p_asset_id uuid,p_component text,p_position text,p_installed_at timestamptz,p_installed_meter_hours numeric,p_source_system text,p_basis text,p_material_id uuid default null,p_serial_number text default null,p_source_ref text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_id uuid;
begin
  if not public.recovery_role_allowed(array['planner','supervisor','maintenance_manager','reliability_engineer','admin','ai_admin']) then return jsonb_build_object('error','component-history authority denied'); end if;
  if coalesce(length(trim(p_component)),0)<2 or coalesce(length(trim(p_position)),0)<1 or coalesce(length(trim(p_basis)),0)<10 then return jsonb_build_object('error','component, position and basis required'); end if;
  if not exists(select 1 from assets where id=p_asset_id and organization_id=v_org) then return jsonb_build_object('error','asset not found'); end if;
  if exists(select 1 from component_instances where organization_id=v_org and asset_id=p_asset_id and lower(component)=lower(trim(p_component)) and lower(position)=lower(trim(p_position)) and state='installed') then return jsonb_build_object('error','an installed component already occupies this position; record its removal first'); end if;
  insert into component_instances(organization_id,asset_id,component,position,material_id,serial_number,installed_at,installed_meter_hours,state,source_system,source_ref,basis,recorded_by)
  values(v_org,p_asset_id,trim(p_component),trim(p_position),p_material_id,nullif(trim(coalesce(p_serial_number,'')),''),p_installed_at,p_installed_meter_hours,'installed',trim(p_source_system),p_source_ref,trim(p_basis),auth.uid()) returning id into v_id;
  return jsonb_build_object('ok',true,'component_instance_id',v_id);
end $$;

create or replace function public.record_component_removal(p_component_instance_id uuid,p_removed_at timestamptz,p_removed_meter_hours numeric,p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); c component_instances%rowtype;
begin
  if not public.recovery_role_allowed(array['planner','supervisor','maintenance_manager','reliability_engineer','admin','ai_admin']) then return jsonb_build_object('error','component-history authority denied'); end if;
  select * into c from component_instances where id=p_component_instance_id and organization_id=v_org and state='installed'; if not found then return jsonb_build_object('error','installed component not found'); end if;
  if p_removed_at<c.installed_at or (c.installed_meter_hours is not null and p_removed_meter_hours is not null and p_removed_meter_hours<c.installed_meter_hours) or coalesce(length(trim(p_basis)),0)<10 then return jsonb_build_object('error','valid removal date/meter and basis required'); end if;
  update component_instances set state='removed',removed_at=p_removed_at,removed_meter_hours=p_removed_meter_hours,basis=basis||' | Removed: '||trim(p_basis) where id=c.id;
  return jsonb_build_object('ok',true,'component_instance_id',c.id,'life_hours',case when c.installed_meter_hours is not null and p_removed_meter_hours is not null then p_removed_meter_hours-c.installed_meter_hours end);
end $$;

create or replace function public.upsert_material_stock_lot(p_material_id uuid,p_site_id uuid,p_lot_ref text,p_qty numeric,p_condition text,p_certification_status text,p_source_system text,p_basis text,p_certification_ref text default null,p_staged_for_work_order_id uuid default null,p_location text default null,p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_id uuid;
begin
  if not public.recovery_role_allowed(array['planner','supervisor','maintenance_manager','technician','admin','ai_admin']) then return jsonb_build_object('error','stock-lot authority denied'); end if;
  if p_qty<0 or p_condition not in ('serviceable','inspection_required','unserviceable','unknown') or p_certification_status not in ('not_required','valid','missing','expired','unknown') or coalesce(length(trim(p_basis)),0)<10 then return jsonb_build_object('error','valid quantity, condition, certification and basis required'); end if;
  if not exists(select 1 from materials where id=p_material_id and organization_id=v_org) then return jsonb_build_object('error','material not found'); end if;
  insert into material_stock_lots(organization_id,material_id,site_id,lot_ref,qty,condition,certification_status,certification_ref,staged_for_work_order_id,location,expires_at,source_system,basis)
  values(v_org,p_material_id,p_site_id,trim(p_lot_ref),p_qty,p_condition,p_certification_status,p_certification_ref,p_staged_for_work_order_id,p_location,p_expires_at,trim(p_source_system),trim(p_basis))
  on conflict(organization_id,material_id,site_id,lot_ref) do update set qty=excluded.qty,condition=excluded.condition,certification_status=excluded.certification_status,certification_ref=excluded.certification_ref,staged_for_work_order_id=excluded.staged_for_work_order_id,location=excluded.location,expires_at=excluded.expires_at,source_system=excluded.source_system,basis=excluded.basis,updated_at=now()
  returning id into v_id;
  return jsonb_build_object('ok',true,'stock_lot_id',v_id);
end $$;

create or replace function public.set_material_substitution(p_material_id uuid,p_substitute_material_id uuid,p_type text,p_status text,p_basis text,p_valid_until timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_id uuid;
begin
  if not public.recovery_role_allowed(array['maintenance_manager','reliability_engineer','admin','ai_admin']) then return jsonb_build_object('error','substitution authority denied'); end if;
  if p_material_id=p_substitute_material_id or p_type not in ('approved_alternate','repairable_exchange','temporary_engineering_substitution') or p_status not in ('approved','pending','rejected') or coalesce(length(trim(p_basis)),0)<15 then return jsonb_build_object('error','valid substitution and engineering basis required'); end if;
  if not exists(select 1 from materials where id=p_material_id and organization_id=v_org) or not exists(select 1 from materials where id=p_substitute_material_id and organization_id=v_org) then return jsonb_build_object('error','material not found'); end if;
  insert into material_substitutions(organization_id,material_id,substitute_material_id,substitution_type,approval_status,basis,valid_until,approved_by)
  values(v_org,p_material_id,p_substitute_material_id,p_type,p_status,trim(p_basis),p_valid_until,case when p_status='approved' then auth.uid() end)
  on conflict(organization_id,material_id,substitute_material_id) do update set substitution_type=excluded.substitution_type,approval_status=excluded.approval_status,basis=excluded.basis,valid_until=excluded.valid_until,approved_by=case when excluded.approval_status='approved' then auth.uid() end
  returning id into v_id;
  return jsonb_build_object('ok',true,'substitution_id',v_id,'status',p_status);
end $$;

-- ---------------------------------------------------------------------------
-- Component-life context: current age is only computed when both installation
-- meter and a current asset meter exist. Historical failure/suspension evidence
-- remains component_life_events.
-- ---------------------------------------------------------------------------
create or replace function public.get_recovery_component_life_context(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); e restoration_events%rowtype;
begin
  select * into e from restoration_events where id=p_event_id and organization_id=v_org; if not found then return jsonb_build_object('error','event not found'); end if;
  return jsonb_build_object('event_id',e.id,'components',coalesce((
    select jsonb_agg(jsonb_build_object(
      'event_work_id',q.event_work_id,'component',q.component,
      'active_instance_id',q.instance_id,'serial_number',q.serial_number,
      'current_meter_hours',q.current_meter,'installed_meter_hours',q.installed_meter,
      'current_component_age_hours',case when q.current_meter is not null and q.installed_meter is not null then greatest(0,q.current_meter-q.installed_meter) end,
      'historical_events',q.hist_n,'failure_events',q.failure_n,'censored_scheduled_events',q.censored_n,
      'historical_median_life_hours',q.median_life,'planned_interval_hours',q.planned_interval,
      'age_pct_of_interval',case when q.current_meter is not null and q.installed_meter is not null and q.planned_interval>0 then round(100*(q.current_meter-q.installed_meter)/q.planned_interval,1) end,
      'evidence_status',case when q.hist_n=0 then 'no_history' when q.current_meter is null or q.installed_meter is null then 'history_available_current_age_unknown' else 'age_and_history_available' end)
      order by q.component) from (
        select ew.id event_work_id,ew.component_scope component,ci.id instance_id,ci.serial_number,ci.installed_meter_hours installed_meter,
          mr.value current_meter,count(cle.*) hist_n,count(cle.*) filter(where cle.event_kind='failure') failure_n,count(cle.*) filter(where cle.event_kind='scheduled') censored_n,
          percentile_disc(0.5) within group(order by cle.hours_at_change_out) filter(where cle.event_kind='failure') median_life,
          max(cle.planned_interval_hours) planned_interval
        from restoration_event_work ew
        left join component_instances ci on ci.organization_id=v_org and ci.asset_id=e.asset_id and ci.state='installed' and lower(ci.component)=lower(ew.component_scope)
        left join lateral (select value from asset_meter_readings m where m.organization_id=v_org and m.asset_id=e.asset_id and m.meter_kind='operating_hours' order by recorded_at desc limit 1) mr on true
        left join component_life_events cle on cle.organization_id=v_org and lower(cle.component)=lower(ew.component_scope)
        where ew.organization_id=v_org and ew.event_id=e.id and ew.component_scope is not null
        group by ew.id,ew.component_scope,ci.id,ci.serial_number,ci.installed_meter_hours,mr.value
      ) q),'[]'::jsonb),
    'policy','Scheduled change-outs are censored evidence; current age is never inferred without installation and current meter readings.');
end $$;

-- ---------------------------------------------------------------------------
-- Parts risk and cannibalization/alternate trade studies.
-- ---------------------------------------------------------------------------
create or replace function public.get_recovery_parts_risk(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); e restoration_events%rowtype;
begin
  select * into e from restoration_events where id=p_event_id and organization_id=v_org; if not found then return jsonb_build_object('error','event not found'); end if;
  return jsonb_build_object('event_id',e.id,'lines',coalesce((select jsonb_agg(jsonb_build_object(
    'work_order_id',w.id,'wo_number',w.wo_number,'material_id',mat.id,'material_code',mat.material_code,'description',mat.description,
    'required',wm.qty_required,'reserved',wm.qty_reserved,'issued',wm.qty_issued,'status',wm.status,'criticality',mat.criticality,'repairable',mat.repairable,
    'site_on_hand',ms.qty_on_hand,'site_reserved',ms.qty_reserved,'site_on_order',ms.qty_on_order,'expected_receipt_date',ms.expected_receipt_date,'lead_time_days',mat.lead_time_days,
    'serviceable_certified_qty',coalesce(lot.good_qty,0),'staged_qty',coalesce(lot.staged_qty,0),'approved_alternates',coalesce(alt.alt_n,0),
    'risk',case when wm.status in ('requested','short') then 'not_ready' when coalesce(lot.bad_n,0)>0 then 'condition_or_certification_attention' when wm.status='reserved' and coalesce(lot.staged_qty,0)<wm.qty_required then 'not_staged' else 'ready' end,
    'basis','Demand: work_order_materials; aggregate stock: material_stock; condition/certification/staging: material_stock_lots; alternatives: approved material_substitutions.') order by mat.criticality desc nulls last,mat.material_code)
    from restoration_event_work ew join work_orders w on w.id=ew.work_order_id join work_order_materials wm on wm.work_order_id=w.id join materials mat on mat.id=wm.material_id
    left join material_stock ms on ms.material_id=mat.id and (ms.site_id=e.site_id or (ms.site_id is null and e.site_id is null))
    left join lateral (select sum(l.qty) filter(where l.condition='serviceable' and l.certification_status in ('valid','not_required') and (l.expires_at is null or l.expires_at>=now())) good_qty,sum(l.qty) filter(where l.staged_for_work_order_id=w.id and l.condition='serviceable' and l.certification_status in ('valid','not_required')) staged_qty,count(*) filter(where l.condition<>'serviceable' or l.certification_status in ('missing','expired','unknown')) bad_n from material_stock_lots l where l.organization_id=v_org and l.material_id=mat.id and (l.site_id=e.site_id or l.site_id is null)) lot on true
    left join lateral (select count(*) alt_n from material_substitutions a where a.organization_id=v_org and a.material_id=mat.id and a.approval_status='approved' and (a.valid_until is null or a.valid_until>=now())) alt on true
    where ew.organization_id=v_org and ew.event_id=e.id and ew.plan_state='included'),'[]'::jsonb));
end $$;

create or replace function public.get_recovery_cannibalization_options(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); e restoration_events%rowtype;
begin
  select * into e from restoration_events where id=p_event_id and organization_id=v_org; if not found then return jsonb_build_object('error','event not found'); end if;
  return jsonb_build_object('event_id',e.id,
    'approved_alternates',coalesce((select jsonb_agg(jsonb_build_object('work_order_material_id',wm.id,'material_code',m.material_code,'substitute_code',sm.material_code,'type',s.substitution_type,'basis',s.basis)) from restoration_event_work ew join work_order_materials wm on wm.work_order_id=ew.work_order_id join materials m on m.id=wm.material_id join material_substitutions s on s.material_id=m.id and s.organization_id=v_org and s.approval_status='approved' and (s.valid_until is null or s.valid_until>=now()) join materials sm on sm.id=s.substitute_material_id where ew.event_id=e.id and ew.organization_id=v_org and wm.status in ('requested','short')),'[]'::jsonb),
    'donor_candidates',coalesce((select jsonb_agg(jsonb_build_object('work_order_material_id',wm.id,'required_material',m.material_code,'donor_component_instance_id',ci.id,'donor_asset_id',da.id,'donor_asset',da.name,'serial_number',ci.serial_number,'donor_state',os.state,'basis','Candidate only: donor component matches the repairable material and the donor asset is currently recorded down/offline. Human approval is required before any cannibalization action.')) from restoration_event_work ew join work_order_materials wm on wm.work_order_id=ew.work_order_id join materials m on m.id=wm.material_id and m.repairable join component_instances ci on ci.organization_id=v_org and ci.material_id=m.id and ci.state='installed' and ci.asset_id<>e.asset_id join assets da on da.id=ci.asset_id left join lateral (select state from operating_states x where x.organization_id=v_org and x.asset_id=da.id order by x.started_at desc limit 1) os on true where ew.event_id=e.id and ew.organization_id=v_org and wm.status in ('requested','short') and os.state in ('down_planned','down_unplanned','offline')),'[]'::jsonb),
    'policy','No component is moved automatically. Options are evidence for a governed decision.');
end $$;

create or replace function public.propose_recovery_cannibalization(p_event_id uuid,p_work_order_material_id uuid,p_donor_component_instance_id uuid,p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); e restoration_events%rowtype; wm work_order_materials%rowtype; ci component_instances%rowtype; d uuid;
begin
  if not public.recovery_role_allowed(array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']) then return jsonb_build_object('error','cannibalization proposal authority denied'); end if;
  if coalesce(length(trim(p_basis)),0)<20 then return jsonb_build_object('error','trade-study basis required'); end if;
  select * into e from restoration_events where id=p_event_id and organization_id=v_org; if not found then return jsonb_build_object('error','event not found'); end if;
  select * into wm from work_order_materials where id=p_work_order_material_id and organization_id=v_org and status in ('requested','short'); if not found then return jsonb_build_object('error','short material line not found'); end if;
  select * into ci from component_instances where id=p_donor_component_instance_id and organization_id=v_org and state='installed' and material_id=wm.material_id and asset_id<>e.asset_id; if not found then return jsonb_build_object('error','matching installed donor component not found'); end if;
  if not exists(select 1 from lateral (select state from operating_states x where x.organization_id=v_org and x.asset_id=ci.asset_id order by started_at desc limit 1) q where q.state in ('down_planned','down_unplanned','offline')) then return jsonb_build_object('error','donor asset is not recorded down/offline'); end if;
  insert into autonomous_decisions(organization_id,decision_type,decision_data,confidence_score,status,requires_approval,asset_id,autonomy_level,created_at)
  values(v_org,'recovery_cannibalization',jsonb_build_object('event_id',e.id,'event_code',e.event_code,'work_order_material_id',wm.id,'material_id',wm.material_id,'donor_component_instance_id',ci.id,'donor_asset_id',ci.asset_id,'basis',trim(p_basis),'execution','No component transfer is performed by this proposal.'),100,'pending',true,e.asset_id,'advisory',now()) returning id into d;
  insert into approval_workflows(decision_id,approval_level,status,comments) values(d,1,'pending','Recovery donor-component trade study — human approval required; field transfer remains separately controlled.');
  return jsonb_build_object('ok',true,'decision_id',d,'approval_required',true,'executed',false);
end $$;

-- ---------------------------------------------------------------------------
-- Uncertainty configuration + deterministic empirical bootstrap.
-- uncertainty_correlation is a shared-rank shock weight, not a claimed Pearson
-- coefficient. History below five comparable jobs remains deterministic.
-- ---------------------------------------------------------------------------
create or replace function public.set_recovery_uncertainty_group(p_event_work_id uuid,p_group text,p_shared_shock_weight numeric,p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org();
begin
  if not public.recovery_role_allowed(array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']) then return jsonb_build_object('error','uncertainty authority denied'); end if;
  if p_shared_shock_weight not between 0 and 1 or coalesce(length(trim(p_group)),0)<2 or coalesce(length(trim(p_basis)),0)<15 then return jsonb_build_object('error','group, 0-1 shared-shock weight and basis required'); end if;
  update restoration_event_work set uncertainty_group=trim(p_group),uncertainty_correlation=p_shared_shock_weight,uncertainty_basis=trim(p_basis),updated_at=now() where id=p_event_work_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','event work not found'); end if;
  return jsonb_build_object('ok',true,'group',trim(p_group),'shared_shock_weight',p_shared_shock_weight);
end $$;

create or replace function public.recovery_hash_uniform(p_text text)
returns numeric language sql immutable as $$
  with b as (select decode(md5(p_text),'hex') x)
  select ((get_byte(x,0)::numeric*16777216)+(get_byte(x,1)::numeric*65536)+(get_byte(x,2)::numeric*256)+get_byte(x,3)::numeric)/4294967296.0 from b;
$$;

create or replace function public.run_restoration_risk_simulation(p_plan_id uuid,p_iterations int default 2000)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); p restoration_plan_versions%rowtype; v_result jsonb; v_id uuid; v_stochastic int; v_total int;
begin
  if not public.recovery_role_allowed(array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']) then return jsonb_build_object('error','simulation authority denied'); end if;
  if p_iterations<100 or p_iterations>10000 then return jsonb_build_object('error','iterations must be 100..10000'); end if;
  select * into p from restoration_plan_versions where id=p_plan_id and organization_id=v_org; if not found then return jsonb_build_object('error','plan not found'); end if;
  if jsonb_array_length(p.missing_inputs)>0 then return jsonb_build_object('error','plan has missing inputs; uncertainty cannot repair missing facts'); end if;

  with plan_tasks as (
    select (s->>'sequence')::int seq,s->>'mode' mode,t->>'event_work_id' event_work_id,(t->>'hours')::numeric fallback_hours
    from jsonb_array_elements(p.schedule) s cross join lateral jsonb_array_elements(s->'tasks') t
  ), hist as (
    select pt.*,ew.uncertainty_group,coalesce(ew.uncertainty_correlation,0) shock_weight,w.job_plan_id,
      coalesce(array_agg(x.actual_hours order by x.completed_at) filter(where x.actual_hours>0),'{}'::numeric[]) samples,
      count(x.*) filter(where x.actual_hours>0)::int hist_n
    from plan_tasks pt join restoration_event_work ew on ew.id=pt.event_work_id::uuid join work_orders w on w.id=ew.work_order_id
    left join work_orders x on w.job_plan_id is not null and x.organization_id=v_org and x.job_plan_id=w.job_plan_id and x.completed_at is not null and x.actual_hours>0
    group by pt.seq,pt.mode,pt.event_work_id,pt.fallback_hours,ew.uncertainty_group,ew.uncertainty_correlation,w.job_plan_id
  ), draws as (
    select i,h.seq,h.mode,h.event_work_id,h.hist_n,
      case when h.hist_n>=5 then h.samples[least(h.hist_n,greatest(1,1+floor(least(0.999999,
        h.shock_weight*public.recovery_hash_uniform(coalesce(h.uncertainty_group,h.event_work_id)||':group:'||i::text)+(1-h.shock_weight)*public.recovery_hash_uniform(h.event_work_id||':task:'||i::text))*h.hist_n)::int))]
        else h.fallback_hours end draw_hours
    from generate_series(1,p_iterations) i cross join hist h
  ), stages as (
    select i,seq,case when bool_and(mode='parallel') then max(draw_hours) else sum(draw_hours) end stage_hours from draws group by i,seq
  ), totals as (
    select i,sum(stage_hours) total_hours from stages group by i
  ), counts as (
    select count(*) total,count(*) filter(where hist_n>=5) stochastic from hist
  )
  select jsonb_build_object('plan_id',p.id,'iterations',p_iterations,'method','Deterministic empirical bootstrap of same-job-plan actual hours; configured shared-rank shock mixtures induce common uncertainty without claiming a fitted correlation coefficient. Tasks with <5 comparable completions remain deterministic at the released plan duration.','p10_hours',round((percentile_cont(0.10) within group(order by total_hours))::numeric,2),'p50_hours',round((percentile_cont(0.50) within group(order by total_hours))::numeric,2),'p80_hours',round((percentile_cont(0.80) within group(order by total_hours))::numeric,2),'p90_hours',round((percentile_cont(0.90) within group(order by total_hours))::numeric,2),'p95_hours',round((percentile_cont(0.95) within group(order by total_hours))::numeric,2),'mean_hours',round(avg(total_hours),2),'probability_before_frozen_baseline',case when (select baseline_return_at from restoration_events where id=p.event_id) is not null then round(avg(case when now()+total_hours*interval '1 hour'<=(select baseline_return_at from restoration_events where id=p.event_id) then 1 else 0 end)::numeric,4) end,'stochastic_tasks',(select stochastic from counts),'total_tasks',(select total from counts),'generated_at',now()) into v_result from totals;

  select count(*),count(*) filter(where h>=5) into v_total,v_stochastic from (select count(x.*)::int h from jsonb_array_elements(p.schedule) s cross join lateral jsonb_array_elements(s->'tasks') t join restoration_event_work ew on ew.id=(t->>'event_work_id')::uuid join work_orders w on w.id=ew.work_order_id left join work_orders x on w.job_plan_id is not null and x.organization_id=v_org and x.job_plan_id=w.job_plan_id and x.completed_at is not null and x.actual_hours>0 group by ew.id) q;
  insert into recovery_plan_risk_runs(organization_id,plan_id,iterations,method,result,generated_by) values(v_org,p.id,p_iterations,'deterministic_empirical_bootstrap_v1',v_result,auth.uid()) returning id into v_id;
  return v_result||jsonb_build_object('risk_run_id',v_id);
end $$;

-- ---------------------------------------------------------------------------
-- What-if simulation: explicit hypothetical assumptions, never a released plan.
-- Supported changes: duration_multipliers {event_work_id: factor},
-- exclude_event_work_ids [uuid...], parallel_sequences [int...],
-- additional_delay_hours numeric.
-- ---------------------------------------------------------------------------
create or replace function public.simulate_recovery_what_if(p_plan_id uuid,p_changes jsonb,p_basis text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); p restoration_plan_versions%rowtype; v_hours numeric; v_hyp_parallel int;
begin
  if coalesce(length(trim(p_basis)),0)<15 then return jsonb_build_object('error','scenario assumption basis required'); end if;
  select * into p from restoration_plan_versions where id=p_plan_id and organization_id=v_org; if not found then return jsonb_build_object('error','plan not found'); end if;
  with tasks as (
    select (s->>'sequence')::int seq,s->>'mode' mode,t->>'event_work_id' event_work_id,(t->>'hours')::numeric hours
    from jsonb_array_elements(p.schedule) s cross join lateral jsonb_array_elements(s->'tasks') t
  ), adjusted as (
    select *,hours*coalesce(nullif(p_changes->'duration_multipliers'->>event_work_id,'')::numeric,1) adj_hours
    from tasks where not coalesce((p_changes->'exclude_event_work_ids') ? event_work_id,false)
  ), stages as (
    select seq,case when mode='parallel' or coalesce((p_changes->'parallel_sequences') ? seq::text,false) then max(adj_hours) else sum(adj_hours) end stage_hours
    from adjusted group by seq,mode
  ) select coalesce(sum(stage_hours),0)+coalesce((p_changes->>'additional_delay_hours')::numeric,0) into v_hours from stages;
  select count(*) into v_hyp_parallel from jsonb_array_elements_text(coalesce(p_changes->'parallel_sequences','[]'::jsonb)) x where not exists(select 1 from jsonb_array_elements(p.schedule) s where s->>'sequence'=x and s->>'mode'='parallel');
  return jsonb_build_object('plan_id',p.id,'scenario_critical_path_hours',round(v_hours,2),'base_critical_path_hours',p.critical_path_hours,'delta_hours',round(v_hours-coalesce(p.critical_path_hours,0),2),'basis',trim(p_basis),'changes',p_changes,'releasable',false,'hypothetical_parallel_sequences',v_hyp_parallel,'warning','Scenario output never mutates or releases a plan. Hypothetical parallelism still requires the normal physical/safety/resource verification and independent approval gates.');
end $$;

-- ---------------------------------------------------------------------------
-- Historical sequence-pattern learning.
-- ---------------------------------------------------------------------------
create or replace function public.get_recovery_sequence_patterns(p_asset_class text default null,p_min_events int default 3)
returns jsonb language sql stable security definer set search_path=public as $$
  with event_patterns as (
    select e.id,e.actual_return_at,e.opened_at,a.asset_class,
      string_agg(coalesce(w.job_plan_id::text,w.id::text),'>' order by ew.sequence_no,w.wo_number,w.id) signature,
      jsonb_agg(jsonb_build_object('sequence',ew.sequence_no,'job_plan_id',w.job_plan_id,'wo_number',w.wo_number,'title',w.title) order by ew.sequence_no,w.wo_number) sequence
    from restoration_events e join assets a on a.id=e.asset_id join restoration_event_work ew on ew.event_id=e.id and ew.plan_state='included' join work_orders w on w.id=ew.work_order_id
    where e.organization_id=public.app_current_org() and e.status='closed' and e.actual_return_at is not null and (p_asset_class is null or a.asset_class=p_asset_class)
    group by e.id,e.actual_return_at,e.opened_at,a.asset_class
  ), grouped as (
    select asset_class,signature,min(sequence::text)::jsonb sequence,count(*) events,percentile_disc(0.5) within group(order by extract(epoch from(actual_return_at-opened_at))/3600.0) median_elapsed_hours
    from event_patterns group by asset_class,signature having count(*)>=greatest(p_min_events,2)
  )
  select jsonb_build_object('asset_class',p_asset_class,'minimum_events',greatest(p_min_events,2),'patterns',coalesce(jsonb_agg(jsonb_build_object('asset_class',asset_class,'signature',signature,'sequence',sequence,'events',events,'median_elapsed_hours',round(median_elapsed_hours::numeric,2)) order by median_elapsed_hours,events desc),'[]'::jsonb),'policy','Only repeated closed-event sequence patterns meeting the minimum sample are surfaced; insufficient history produces no best-sequence claim.') from grouped;
$$;

-- ---------------------------------------------------------------------------
-- Site/craft productivity normalization from task planned-vs-actual evidence.
-- ---------------------------------------------------------------------------
create or replace function public.get_recovery_productivity_norms(p_site_id uuid default null,p_min_tasks int default 5)
returns jsonb language sql stable security definer set search_path=public as $$
  with rows as (
    select coalesce(w.site_id,a.site_id) site_id,coalesce(nullif(trim(t.craft),''),'Unassigned') craft,t.actual_hours/nullif(t.estimated_hours,0) factor
    from work_order_tasks t join work_orders w on w.id=t.work_order_id left join assets a on a.id=w.asset_id
    where w.organization_id=public.app_current_org() and w.completed_at is not null and t.actual_hours>0 and t.estimated_hours>0 and (p_site_id is null or coalesce(w.site_id,a.site_id)=p_site_id)
  ), g as (
    select site_id,craft,count(*) n,percentile_disc(0.5) within group(order by factor) median_factor,percentile_disc(0.8) within group(order by factor) p80_factor from rows group by site_id,craft having count(*)>=greatest(p_min_tasks,5)
  )
  select jsonb_build_object('site_id',p_site_id,'minimum_tasks',greatest(p_min_tasks,5),'norms',coalesce(jsonb_agg(jsonb_build_object('site_id',site_id,'craft',craft,'sample',n,'median_actual_to_estimate_factor',round(median_factor::numeric,3),'p80_actual_to_estimate_factor',round(p80_factor::numeric,3)) order by site_id,craft),'[]'::jsonb),'basis','Completed work_order_tasks actual_hours / estimated_hours. Groups below the minimum sample are omitted.') from g;
$$;

-- ---------------------------------------------------------------------------
-- Multi-event scarce-craft optimizer. Greedy priority-first allocation is
-- deterministic, auditable and deliberately named (not misrepresented as a
-- global mathematical optimum). Hard readiness gates constrain allocation.
-- ---------------------------------------------------------------------------
create or replace function public.run_recovery_fleet_optimization(p_site_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); e record; d record; v_remaining jsonb:='{}'::jsonb; v_allocation jsonb:='[]'::jsonb; v_feasible boolean; v_reason jsonb; v_cap numeric; v_key text; v_left numeric; v_run uuid; v_result jsonb;
begin
  if not public.recovery_role_allowed(array['planner','maintenance_manager','reliability_engineer','operator','admin','ai_admin']) then return jsonb_build_object('error','fleet-optimization authority denied'); end if;
  -- Build the capacity ledger from current effective craft-capacity records.
  for d in select c.craft,sum(c.weekly_hours) cap from craft_capacity c where c.organization_id=v_org and c.effective_from<=current_date and (p_site_id is null or c.site_id=p_site_id or c.site_id is null) group by c.craft loop
    v_remaining:=v_remaining||jsonb_build_object(d.craft,d.cap);
  end loop;

  for e in
    select re.id,re.event_code,re.site_id,re.asset_id,a.name asset_name,
      coalesce(ca.safety_score,0)*100+coalesce(ca.environmental_score,0)*40+coalesce(ca.business_score,0)*20+coalesce(ca.production_score,0)*10+
      case lower(coalesce(a.criticality,'')) when 'critical' then 80 when 'high' then 40 when 'medium' then 20 else 0 end+
      coalesce((select nullif(s.payload->>'priority_weight','')::numeric from operational_constraint_signals s where s.organization_id=v_org and s.signal_kind='production' and s.state='available' and s.valid_until>=now() and (s.asset_id=re.asset_id or s.asset_id is null) and (s.site_id=re.site_id or s.site_id is null) order by s.observed_at desc limit 1),0) priority_score,
      coalesce((select p.critical_path_hours from restoration_plan_versions p where p.event_id=re.id and p.organization_id=v_org order by (p.status='released') desc,p.version desc limit 1),0) critical_path_hours
    from restoration_events re join assets a on a.id=re.asset_id left join recovery_consequence_assessments ca on ca.event_id=re.id
    where re.organization_id=v_org and re.status in ('open','planning','approval','released','executing','return_pending') and (p_site_id is null or re.site_id=p_site_id)
    order by priority_score desc,re.opened_at
  loop
    v_feasible:=true; v_reason:='[]'::jsonb;
    if exists(select 1 from restoration_constraints c where c.event_id=e.id and c.organization_id=v_org and c.is_hard and c.state in ('unknown','blocked')) then v_feasible:=false; v_reason:=v_reason||jsonb_build_array('Hard readiness constraint is unknown/blocked.'); end if;
    for d in select coalesce(nullif(trim(t.craft),''),'Unassigned') craft,sum(coalesce(t.estimated_hours,0)) demand from restoration_event_work ew join work_order_tasks t on t.work_order_id=ew.work_order_id where ew.event_id=e.id and ew.organization_id=v_org and ew.plan_state='included' and ew.execution_status<>'complete' group by coalesce(nullif(trim(t.craft),''),'Unassigned') loop
      v_key:=d.craft; v_cap:=nullif(v_remaining->>v_key,'')::numeric;
      if v_cap is null then v_feasible:=false; v_reason:=v_reason||jsonb_build_array('No capacity recorded for craft '||v_key||'.');
      elsif d.demand>v_cap then v_feasible:=false; v_reason:=v_reason||jsonb_build_array(format('%s requires %s h; %s h remains.',v_key,round(d.demand,1),round(v_cap,1))); end if;
    end loop;
    if v_feasible then
      for d in select coalesce(nullif(trim(t.craft),''),'Unassigned') craft,sum(coalesce(t.estimated_hours,0)) demand from restoration_event_work ew join work_order_tasks t on t.work_order_id=ew.work_order_id where ew.event_id=e.id and ew.organization_id=v_org and ew.plan_state='included' and ew.execution_status<>'complete' group by coalesce(nullif(trim(t.craft),''),'Unassigned') loop
        v_left:=(v_remaining->>d.craft)::numeric-d.demand; v_remaining:=jsonb_set(v_remaining,array[d.craft],to_jsonb(v_left),true);
      end loop;
    end if;
    v_allocation:=v_allocation||jsonb_build_array(jsonb_build_object('event_id',e.id,'event_code',e.event_code,'asset',e.asset_name,'priority_score',e.priority_score,'critical_path_hours',e.critical_path_hours,'allocation',case when v_feasible then 'allocate' else 'constrained' end,'reasons',v_reason));
  end loop;
  v_result:=jsonb_build_object('site_id',p_site_id,'algorithm','deterministic_priority_first_scarce_craft_allocation_v1','allocation',v_allocation,'remaining_craft_hours',v_remaining,'generated_at',now(),'policy','Safety/environment/business/production consequence and asset criticality establish priority. Hard readiness gates fail closed. Capacity is never inferred.');
  insert into recovery_fleet_optimization_runs(organization_id,site_id,algorithm,result,generated_by) values(v_org,p_site_id,'deterministic_priority_first_scarce_craft_allocation_v1',v_result,auth.uid()) returning id into v_run;
  return v_result||jsonb_build_object('optimization_run_id',v_run);
end $$;

-- ---------------------------------------------------------------------------
-- Security grants.
-- ---------------------------------------------------------------------------
do $$
declare sig text;
begin
  foreach sig in array array[
    'record_asset_meter_reading(uuid,numeric,timestamptz,text,text,text,text)',
    'record_component_installation(uuid,text,text,timestamptz,numeric,text,text,uuid,text,text)',
    'record_component_removal(uuid,timestamptz,numeric,text)',
    'upsert_material_stock_lot(uuid,uuid,text,numeric,text,text,text,text,text,uuid,text,timestamptz)',
    'set_material_substitution(uuid,uuid,text,text,text,timestamptz)',
    'get_recovery_component_life_context(uuid)','get_recovery_parts_risk(uuid)','get_recovery_cannibalization_options(uuid)',
    'propose_recovery_cannibalization(uuid,uuid,uuid,text)','set_recovery_uncertainty_group(uuid,text,numeric,text)',
    'run_restoration_risk_simulation(uuid,int)','simulate_recovery_what_if(uuid,jsonb,text)',
    'get_recovery_sequence_patterns(text,int)','get_recovery_productivity_norms(uuid,int)','run_recovery_fleet_optimization(uuid)'
  ] loop
    execute 'revoke all on function public.'||sig||' from public, anon';
    execute 'grant execute on function public.'||sig||' to authenticated';
  end loop;
end $$;

notify pgrst,'reload schema';
