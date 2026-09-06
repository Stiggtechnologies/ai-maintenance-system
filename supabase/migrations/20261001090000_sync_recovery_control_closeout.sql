-- ============================================================================
-- Sync Recovery full close-out — CONTROL + LEARN
--
-- Recovery remains a coordination plane: canonical work orders, materials,
-- job plans, equipment release, approvals, alerts, attachments and value
-- verification are referenced rather than duplicated.
-- ============================================================================

create table if not exists operational_constraint_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id) on delete cascade,
  asset_id uuid references assets(id) on delete cascade,
  signal_kind text not null check (signal_kind in ('bay','crane','tooling','vendor','documentation','weather','production')),
  signal_key text not null,
  state text not null check (state in ('available','unavailable','unknown')),
  observed_at timestamptz not null,
  valid_until timestamptz not null,
  source_system text not null,
  source_ref text,
  basis text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (valid_until >= observed_at)
);
create index if not exists idx_ops_constraint_latest on operational_constraint_signals(organization_id, signal_kind, signal_key, observed_at desc);

create table if not exists restoration_resource_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_id uuid not null references restoration_events(id) on delete cascade,
  event_work_id uuid references restoration_event_work(id) on delete cascade,
  resource_kind text not null check (resource_kind in ('bay','crane','tooling','vendor','documentation','weather','production')),
  resource_key text not null,
  phase text not null default 'planning' check (phase in ('planning','execution','return_to_service')),
  is_hard boolean not null default true,
  basis text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(event_id, event_work_id, resource_kind, resource_key, phase)
);

create table if not exists job_plan_energy_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_plan_id uuid not null references job_plans(id) on delete cascade,
  energy_type text not null check (energy_type in ('electrical','hydraulic','pneumatic','mechanical','thermal','gravity','chemical','process','other')),
  required_state text not null check (required_state in ('isolated','dissipated','verified_zero')),
  basis text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(job_plan_id, energy_type)
);

create table if not exists asset_energy_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  energy_type text not null check (energy_type in ('electrical','hydraulic','pneumatic','mechanical','thermal','gravity','chemical','process','other')),
  state text not null check (state in ('energized','isolated','dissipated','verified_zero','unknown')),
  isolation_ref text,
  basis text not null,
  verified_by uuid references auth.users(id),
  observed_at timestamptz not null default now(),
  valid_until timestamptz,
  source_system text not null default 'manual',
  created_at timestamptz not null default now()
);
create index if not exists idx_asset_energy_latest on asset_energy_states(organization_id, asset_id, energy_type, observed_at desc);

alter table restoration_event_work
  add column if not exists work_zone text,
  add column if not exists component_scope text,
  add column if not exists uncertainty_group text,
  add column if not exists uncertainty_correlation numeric check (uncertainty_correlation is null or uncertainty_correlation between 0 and 1),
  add column if not exists uncertainty_basis text;

create table if not exists work_zone_relationships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id) on delete cascade,
  zone_a text not null,
  zone_b text not null,
  parallel_allowed boolean not null,
  basis text not null,
  source_ref text,
  verified_by uuid references auth.users(id),
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(organization_id, site_id, zone_a, zone_b)
);

create table if not exists recovery_consequence_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_id uuid not null references restoration_events(id) on delete cascade unique,
  safety_score int not null check (safety_score between 0 and 5),
  environmental_score int not null check (environmental_score between 0 and 5),
  business_score int not null check (business_score between 0 and 5),
  production_score int not null check (production_score between 0 and 5),
  basis text not null,
  assessed_by uuid not null references auth.users(id),
  assessed_at timestamptz not null default now()
);

create table if not exists recovery_recommendation_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_id uuid not null references restoration_events(id) on delete cascade,
  recommendation_kind text not null,
  recommendation_key text not null,
  disposition text not null check (disposition in ('accepted','rejected','modified','deferred')),
  reason_code text not null,
  reason_text text not null,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now()
);

create table if not exists recovery_recurrence_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_id uuid not null references restoration_events(id) on delete cascade,
  notification_id uuid not null references maintenance_notifications(id) on delete cascade,
  verdict text not null default 'candidate' check (verdict in ('candidate','confirmed','rejected')),
  basis text,
  classified_by uuid references auth.users(id),
  classified_at timestamptz,
  created_at timestamptz not null default now(),
  unique(event_id, notification_id)
);

create table if not exists recovery_field_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_id uuid not null references restoration_events(id) on delete cascade,
  event_work_id uuid references restoration_event_work(id) on delete cascade,
  attachment_id uuid references cowork_attachments(id) on delete set null,
  evidence_kind text not null check (evidence_kind in ('photo','voice','document','measurement','note')),
  note text not null,
  metadata jsonb not null default '{}'::jsonb,
  client_command_id text,
  captured_by uuid not null references auth.users(id),
  captured_at timestamptz not null default now(),
  unique(organization_id, client_command_id)
);

create table if not exists recovery_cadence_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_id uuid references restoration_events(id) on delete cascade,
  cadence text not null check (cadence in ('shift','daily','weekly')),
  snapshot jsonb not null,
  generated_by uuid references auth.users(id),
  generated_at timestamptz not null default now()
);

create table if not exists recovery_economic_assumptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_id uuid not null references restoration_events(id) on delete cascade unique,
  regular_labour_rate_usd numeric not null default 0 check (regular_labour_rate_usd >= 0),
  overtime_labour_rate_usd numeric not null default 0 check (overtime_labour_rate_usd >= 0),
  overtime_share numeric not null default 0 check (overtime_share between 0 and 1),
  contractor_cost_usd numeric not null default 0 check (contractor_cost_usd >= 0),
  logistics_cost_usd numeric not null default 0 check (logistics_cost_usd >= 0),
  risk_cost_usd numeric not null default 0 check (risk_cost_usd >= 0),
  life_cycle_cost_usd numeric not null default 0 check (life_cycle_cost_usd >= 0),
  basis text not null,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now()
);

create table if not exists recovery_delay_attribution (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_id uuid not null references restoration_events(id) on delete cascade,
  category text not null,
  hours numeric not null check (hours >= 0),
  attribution text not null check (attribution in ('causal','contributing','unattributed')),
  basis text not null,
  verified_by uuid not null references auth.users(id),
  verified_at timestamptz not null default now()
);

alter table restoration_blockers add column if not exists escalated_at timestamptz;
alter table restoration_blockers add column if not exists escalation_level int not null default 0;

do $$
declare t text;
begin
  foreach t in array array['operational_constraint_signals','restoration_resource_requirements','job_plan_energy_requirements','asset_energy_states','work_zone_relationships','recovery_consequence_assessments','recovery_recommendation_feedback','recovery_recurrence_links','recovery_field_evidence','recovery_cadence_snapshots','recovery_economic_assumptions','recovery_delay_attribution'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_org_read', t);
    execute format('create policy %I on %I for select to authenticated using (organization_id = public.app_current_org())', t || '_org_read', t);
  end loop;
end $$;

create or replace function public.register_operational_constraint_signal(p_kind text,p_key text,p_state text,p_observed_at timestamptz,p_valid_until timestamptz,p_source_system text,p_basis text,p_site_id uuid default null,p_asset_id uuid default null,p_source_ref text default null,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_id uuid;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.recovery_role_allowed(array['planner','supervisor','maintenance_manager','reliability_engineer','operator','admin','ai_admin']) then return jsonb_build_object('error','signal authority denied'); end if;
  if p_kind not in ('bay','crane','tooling','vendor','documentation','weather','production') or p_state not in ('available','unavailable','unknown') then return jsonb_build_object('error','invalid signal'); end if;
  if p_valid_until<p_observed_at or coalesce(length(trim(p_source_system)),0)<2 or coalesce(length(trim(p_basis)),0)<10 then return jsonb_build_object('error','source, basis and valid evidence window are required'); end if;
  insert into operational_constraint_signals(organization_id,site_id,asset_id,signal_kind,signal_key,state,observed_at,valid_until,source_system,source_ref,basis,payload)
  values(v_org,p_site_id,p_asset_id,p_kind,trim(p_key),p_state,p_observed_at,p_valid_until,trim(p_source_system),p_source_ref,trim(p_basis),coalesce(p_payload,'{}'::jsonb)) returning id into v_id;
  return jsonb_build_object('ok',true,'signal_id',v_id,'state',p_state,'valid_until',p_valid_until);
end $$;

create or replace function public.set_restoration_resource_requirement(p_event_id uuid,p_event_work_id uuid,p_kind text,p_key text,p_phase text,p_is_hard boolean,p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_id uuid;
begin
  if not public.recovery_role_allowed(array['planner','supervisor','maintenance_manager','reliability_engineer','admin','ai_admin']) then return jsonb_build_object('error','requirement authority denied'); end if;
  if not exists(select 1 from restoration_events where id=p_event_id and organization_id=v_org) then return jsonb_build_object('error','event not found'); end if;
  if p_kind not in ('bay','crane','tooling','vendor','documentation','weather','production') or p_phase not in ('planning','execution','return_to_service') then return jsonb_build_object('error','invalid requirement'); end if;
  if coalesce(length(trim(p_basis)),0)<10 then return jsonb_build_object('error','requirement basis required'); end if;
  insert into restoration_resource_requirements(organization_id,event_id,event_work_id,resource_kind,resource_key,phase,is_hard,basis,created_by)
  values(v_org,p_event_id,p_event_work_id,p_kind,trim(p_key),p_phase,p_is_hard,trim(p_basis),auth.uid())
  on conflict(event_id,event_work_id,resource_kind,resource_key,phase) do update set is_hard=excluded.is_hard,basis=excluded.basis
  returning id into v_id;
  return jsonb_build_object('ok',true,'requirement_id',v_id);
end $$;

create or replace function public.set_job_plan_energy_requirement(p_job_plan_id uuid,p_energy_type text,p_required_state text,p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_id uuid;
begin
  if not public.recovery_role_allowed(array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']) then return jsonb_build_object('error','energy requirement authority denied'); end if;
  if not exists(select 1 from job_plans where id=p_job_plan_id and organization_id=v_org) then return jsonb_build_object('error','job plan not found'); end if;
  if p_energy_type not in ('electrical','hydraulic','pneumatic','mechanical','thermal','gravity','chemical','process','other') or p_required_state not in ('isolated','dissipated','verified_zero') then return jsonb_build_object('error','invalid energy requirement'); end if;
  if coalesce(length(trim(p_basis)),0)<10 then return jsonb_build_object('error','energy basis required'); end if;
  insert into job_plan_energy_requirements(organization_id,job_plan_id,energy_type,required_state,basis,created_by)
  values(v_org,p_job_plan_id,p_energy_type,p_required_state,trim(p_basis),auth.uid())
  on conflict(job_plan_id,energy_type) do update set required_state=excluded.required_state,basis=excluded.basis,created_by=auth.uid()
  returning id into v_id;
  return jsonb_build_object('ok',true,'requirement_id',v_id);
end $$;

create or replace function public.record_asset_energy_state(p_asset_id uuid,p_energy_type text,p_state text,p_basis text,p_isolation_ref text default null,p_valid_until timestamptz default null,p_source_system text default 'manual')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_id uuid;
begin
  if not public.recovery_role_allowed(array['technician','supervisor','maintenance_manager','operator','admin','ai_admin']) then return jsonb_build_object('error','energy-state authority denied'); end if;
  if not exists(select 1 from assets where id=p_asset_id and organization_id=v_org) then return jsonb_build_object('error','asset not found'); end if;
  if p_energy_type not in ('electrical','hydraulic','pneumatic','mechanical','thermal','gravity','chemical','process','other') or p_state not in ('energized','isolated','dissipated','verified_zero','unknown') then return jsonb_build_object('error','invalid energy state'); end if;
  if coalesce(length(trim(p_basis)),0)<10 then return jsonb_build_object('error','verification basis required'); end if;
  insert into asset_energy_states(organization_id,asset_id,energy_type,state,isolation_ref,basis,verified_by,valid_until,source_system)
  values(v_org,p_asset_id,p_energy_type,p_state,p_isolation_ref,trim(p_basis),auth.uid(),p_valid_until,coalesce(nullif(trim(p_source_system),''),'manual')) returning id into v_id;
  return jsonb_build_object('ok',true,'energy_state_id',v_id,'state',p_state);
end $$;

create or replace function public.set_restoration_work_zone(p_event_work_id uuid,p_zone text,p_component_scope text default null,p_basis text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); ew restoration_event_work%rowtype;
begin
  if not public.recovery_role_allowed(array['planner','supervisor','maintenance_manager','reliability_engineer','admin','ai_admin']) then return jsonb_build_object('error','work-zone authority denied'); end if;
  select * into ew from restoration_event_work where id=p_event_work_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','event work not found'); end if;
  if coalesce(length(trim(p_zone)),0)<2 then return jsonb_build_object('error','work zone required'); end if;
  update restoration_event_work set work_zone=trim(p_zone),component_scope=nullif(trim(coalesce(p_component_scope,'')),''),updated_at=now() where id=ew.id;
  if coalesce(length(trim(coalesce(p_basis,''))),0)>=10 then
    insert into decisions(organization_id,decision_type,action_taken,approval_status,autonomy_mode,confidence_score,human_actor,rationale,outcome_status)
    values(v_org,'restoration_work_zone','Set physical work zone for '||ew.id::text,'approved','advisory',100,auth.uid()::text,trim(p_basis),'executed');
  end if;
  return jsonb_build_object('ok',true,'work_zone',trim(p_zone));
end $$;

create or replace function public.set_work_zone_relationship(p_site_id uuid,p_zone_a text,p_zone_b text,p_parallel_allowed boolean,p_basis text,p_source_ref text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_a text:=trim(p_zone_a); v_b text:=trim(p_zone_b); v_tmp text; v_id uuid;
begin
  if not public.recovery_role_allowed(array['planner','supervisor','maintenance_manager','reliability_engineer','admin','ai_admin']) then return jsonb_build_object('error','work-zone relationship authority denied'); end if;
  if coalesce(length(v_a),0)<2 or coalesce(length(v_b),0)<2 or coalesce(length(trim(p_basis)),0)<15 then return jsonb_build_object('error','two zones and a substantive basis are required'); end if;
  if v_b<v_a then v_tmp:=v_a; v_a:=v_b; v_b:=v_tmp; end if;
  insert into work_zone_relationships(organization_id,site_id,zone_a,zone_b,parallel_allowed,basis,source_ref,verified_by)
  values(v_org,p_site_id,v_a,v_b,p_parallel_allowed,trim(p_basis),p_source_ref,auth.uid())
  on conflict(organization_id,site_id,zone_a,zone_b) do update set parallel_allowed=excluded.parallel_allowed,basis=excluded.basis,source_ref=excluded.source_ref,verified_by=auth.uid(),verified_at=now()
  returning id into v_id;
  return jsonb_build_object('ok',true,'relationship_id',v_id,'parallel_allowed',p_parallel_allowed);
end $$;

create or replace function public.refresh_restoration_readiness(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); e restoration_events%rowtype; r record; s record; v_state text; v_basis text; v_cap numeric; v_count int:=0; v_block int:=0; v_unknown int:=0;
begin
  if not public.recovery_role_allowed(array['planner','supervisor','maintenance_manager','reliability_engineer','admin','ai_admin']) then return jsonb_build_object('error','readiness authority denied'); end if;
  select * into e from restoration_events where id=p_event_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','event not found'); end if;
  delete from restoration_constraints where organization_id=v_org and event_id=e.id and source_kind='derived' and source_ref like 'recovery-v2:%';

  for r in select coalesce(nullif(trim(t.craft),''),'Unassigned') craft,sum(coalesce(t.estimated_hours,0)) required_hours from restoration_event_work ew join work_order_tasks t on t.work_order_id=ew.work_order_id where ew.organization_id=v_org and ew.event_id=e.id and ew.plan_state='included' and ew.execution_status<>'complete' group by coalesce(nullif(trim(t.craft),''),'Unassigned') loop
    select sum(c.weekly_hours) into v_cap from craft_capacity c where c.organization_id=v_org and c.craft=r.craft and c.effective_from<=current_date and (c.site_id=e.site_id or c.site_id is null);
    if v_cap is null then v_state:='unknown'; v_basis:='No current craft capacity is recorded; capacity is not inferred from headcount.';
    elsif r.required_hours<=v_cap then v_state:='satisfied'; v_basis:=format('%s h required against %s h recorded weekly capacity for %s.',round(r.required_hours,1),round(v_cap,1),r.craft);
    else v_state:='blocked'; v_basis:=format('%s h required exceeds %s h recorded weekly capacity for %s.',round(r.required_hours,1),round(v_cap,1),r.craft); end if;
    insert into restoration_constraints(organization_id,event_id,constraint_kind,phase,is_hard,state,description,basis,source_kind,source_ref,owner_role,verified_by,verified_at)
    values(v_org,e.id,'labour','planning',true,v_state,'Labour readiness — '||r.craft,v_basis,'derived','recovery-v2:labour:'||r.craft,'planner',case when v_state='satisfied' then auth.uid() end,case when v_state='satisfied' then now() end);
    v_count:=v_count+1; if v_state='blocked' then v_block:=v_block+1; elsif v_state='unknown' then v_unknown:=v_unknown+1; end if;
  end loop;

  for r in select ew.id event_work_id,w.id work_order_id,coalesce(w.wo_number,w.id::text) label,count(m.*) filter(where m.status in ('requested','short')) not_ready,count(m.*) demand_lines from restoration_event_work ew join work_orders w on w.id=ew.work_order_id left join work_order_materials m on m.work_order_id=w.id where ew.organization_id=v_org and ew.event_id=e.id and ew.plan_state='included' and ew.execution_status<>'complete' group by ew.id,w.id,w.wo_number loop
    if r.demand_lines=0 then v_state:='not_applicable'; v_basis:='No material demand is recorded for this work order.';
    elsif r.not_ready=0 then v_state:='satisfied'; v_basis:='Every recorded material line is reserved, kitted, issued or cancelled.';
    else v_state:='blocked'; v_basis:=format('%s material line(s) remain requested or short.',r.not_ready); end if;
    insert into restoration_constraints(organization_id,event_id,event_work_id,constraint_kind,phase,is_hard,state,description,basis,source_kind,source_ref,owner_role,verified_by,verified_at)
    values(v_org,e.id,r.event_work_id,'material','execution',true,v_state,'Material readiness — '||r.label,v_basis,'derived','recovery-v2:material:'||r.work_order_id::text,'planner',case when v_state='satisfied' then auth.uid() end,case when v_state='satisfied' then now() end);
    v_count:=v_count+1; if v_state='blocked' then v_block:=v_block+1; end if;
  end loop;

  for r in select * from restoration_resource_requirements where organization_id=v_org and event_id=e.id loop
    select * into s from operational_constraint_signals x where x.organization_id=v_org and x.signal_kind=r.resource_kind and x.signal_key=r.resource_key and (x.site_id is null or x.site_id=e.site_id) and (x.asset_id is null or x.asset_id=e.asset_id) and x.observed_at<=now() order by x.observed_at desc limit 1;
    if not found or s.valid_until<now() then v_state:='unknown'; v_basis:='No fresh evidence is available for this required resource.';
    elsif s.state='available' then v_state:='satisfied'; v_basis:=s.basis;
    elsif s.state='unavailable' then v_state:='blocked'; v_basis:=s.basis;
    else v_state:='unknown'; v_basis:=s.basis; end if;
    insert into restoration_constraints(organization_id,event_id,event_work_id,constraint_kind,phase,is_hard,state,description,basis,source_kind,source_ref,owner_role,verified_by,verified_at)
    values(v_org,e.id,r.event_work_id,case r.resource_kind when 'bay' then 'bay' when 'crane' then 'crane' when 'tooling' then 'tooling' when 'vendor' then 'vendor' when 'weather' then 'weather' when 'production' then 'production' else 'other' end,r.phase,r.is_hard,v_state,initcap(r.resource_kind)||' readiness — '||r.resource_key,v_basis,'derived','recovery-v2:resource:'||r.id::text,case r.resource_kind when 'production' then 'operator' else 'planner' end,case when v_state='satisfied' then auth.uid() end,case when v_state='satisfied' then s.observed_at end);
    v_count:=v_count+1; if v_state='blocked' and r.is_hard then v_block:=v_block+1; elsif v_state='unknown' and r.is_hard then v_unknown:=v_unknown+1; end if;
  end loop;

  for r in select a.id a_id,b.id b_id,a.work_zone zone_a,b.work_zone zone_b,a.sequence_no from restoration_event_work a join restoration_event_work b on b.event_id=a.event_id and b.id>a.id and b.sequence_no=a.sequence_no where a.organization_id=v_org and a.event_id=e.id and a.plan_state='included' and b.plan_state='included' and a.execution_status<>'complete' and b.execution_status<>'complete' and a.concurrency_rule='verified_parallel' and b.concurrency_rule='verified_parallel' loop
    if r.zone_a is null or r.zone_b is null then v_state:='unknown'; v_basis:='Parallel work has no complete physical work-zone assignment; interference cannot be assessed.';
    elsif exists(select 1 from work_zone_relationships z where z.organization_id=v_org and (z.site_id=e.site_id or z.site_id is null) and z.zone_a=least(r.zone_a,r.zone_b) and z.zone_b=greatest(r.zone_a,r.zone_b) and z.parallel_allowed) then v_state:='satisfied'; select z.basis into v_basis from work_zone_relationships z where z.organization_id=v_org and (z.site_id=e.site_id or z.site_id is null) and z.zone_a=least(r.zone_a,r.zone_b) and z.zone_b=greatest(r.zone_a,r.zone_b) and z.parallel_allowed order by (z.site_id is not null) desc limit 1;
    else v_state:='blocked'; v_basis:='No verified physical relationship permits these work zones to execute in parallel.'; end if;
    insert into restoration_constraints(organization_id,event_id,constraint_kind,phase,is_hard,state,description,basis,source_kind,source_ref,owner_role,verified_by,verified_at)
    values(v_org,e.id,'work_zone','planning',true,v_state,'Physical interference — sequence '||r.sequence_no||' ('||coalesce(r.zone_a,'?')||' / '||coalesce(r.zone_b,'?')||')',v_basis,'derived','recovery-v2:zone:'||r.a_id::text||':'||r.b_id::text,'planner',case when v_state='satisfied' then auth.uid() end,case when v_state='satisfied' then now() end);
    v_count:=v_count+1; if v_state='blocked' then v_block:=v_block+1; elsif v_state='unknown' then v_unknown:=v_unknown+1; end if;
  end loop;

  return jsonb_build_object('ok',true,'constraints_refreshed',v_count,'hard_blocked',v_block,'hard_unknown',v_unknown,'ready_for_optimization',v_block=0 and v_unknown=0,'policy','Fresh evidence resolves gates; missing or stale evidence remains unknown.');
end $$;

create or replace function public.recovery_energy_rank(p_state text) returns int language sql immutable as $$ select case p_state when 'energized' then 0 when 'unknown' then 0 when 'isolated' then 1 when 'dissipated' then 2 when 'verified_zero' then 3 else 0 end $$;

create or replace function public.enforce_recovery_energy_state()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_job_plan uuid; v_asset uuid; r record; v_state text;
begin
  if new.execution_status='in_progress' and old.execution_status is distinct from 'in_progress' then
    select w.job_plan_id,w.asset_id into v_job_plan,v_asset from work_orders w where w.id=new.work_order_id;
    for r in select * from job_plan_energy_requirements where job_plan_id=v_job_plan loop
      select e.state into v_state from asset_energy_states e where e.organization_id=new.organization_id and e.asset_id=v_asset and e.energy_type=r.energy_type and e.observed_at<=now() and (e.valid_until is null or e.valid_until>=now()) order by e.observed_at desc limit 1;
      if v_state is null or public.recovery_energy_rank(v_state)<public.recovery_energy_rank(r.required_state) then raise exception 'Recovery energy gate: % must be % or safer before work starts (current: %)',r.energy_type,r.required_state,coalesce(v_state,'unknown') using errcode='check_violation'; end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_recovery_energy_state on restoration_event_work;
create trigger trg_recovery_energy_state before update of execution_status on restoration_event_work for each row execute function public.enforce_recovery_energy_state();

create or replace function public.set_recovery_consequence(p_event_id uuid,p_safety int,p_environment int,p_business int,p_production int,p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org();
begin
  if not public.recovery_role_allowed(array['maintenance_manager','reliability_engineer','operator','admin','ai_admin']) then return jsonb_build_object('error','consequence authority denied'); end if;
  if least(p_safety,p_environment,p_business,p_production)<0 or greatest(p_safety,p_environment,p_business,p_production)>5 or coalesce(length(trim(p_basis)),0)<20 then return jsonb_build_object('error','0-5 consequence scores and a substantive basis are required'); end if;
  if not exists(select 1 from restoration_events where id=p_event_id and organization_id=v_org) then return jsonb_build_object('error','event not found'); end if;
  insert into recovery_consequence_assessments(organization_id,event_id,safety_score,environmental_score,business_score,production_score,basis,assessed_by) values(v_org,p_event_id,p_safety,p_environment,p_business,p_production,trim(p_basis),auth.uid()) on conflict(event_id) do update set safety_score=excluded.safety_score,environmental_score=excluded.environmental_score,business_score=excluded.business_score,production_score=excluded.production_score,basis=excluded.basis,assessed_by=auth.uid(),assessed_at=now();
  return jsonb_build_object('ok',true,'priority_score',p_safety*100+p_environment*40+p_business*20+p_production*10);
end $$;

create or replace function public.record_recovery_recommendation_feedback(p_event_id uuid,p_kind text,p_key text,p_disposition text,p_reason_code text,p_reason_text text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_id uuid;
begin
  if not public.recovery_role_allowed(array['planner','supervisor','maintenance_manager','reliability_engineer','operator','admin','ai_admin']) then return jsonb_build_object('error','feedback authority denied'); end if;
  if p_disposition not in ('accepted','rejected','modified','deferred') or coalesce(length(trim(p_reason_code)),0)<2 or coalesce(length(trim(p_reason_text)),0)<10 then return jsonb_build_object('error','disposition and reason are required'); end if;
  if not exists(select 1 from restoration_events where id=p_event_id and organization_id=v_org) then return jsonb_build_object('error','event not found'); end if;
  insert into recovery_recommendation_feedback(organization_id,event_id,recommendation_kind,recommendation_key,disposition,reason_code,reason_text,recorded_by) values(v_org,p_event_id,trim(p_kind),trim(p_key),p_disposition,trim(p_reason_code),trim(p_reason_text),auth.uid()) returning id into v_id;
  insert into learning_events(organization_id,asset_id,event_type,title,detail,model_confidence) select v_org,e.asset_id,case when p_disposition='rejected' then 'false_positive' else 'lesson_learned' end,'Recovery recommendation feedback — '||trim(p_kind),p_disposition||' ['||trim(p_reason_code)||']: '||trim(p_reason_text),100 from restoration_events e where e.id=p_event_id;
  return jsonb_build_object('ok',true,'feedback_id',v_id);
end $$;

create or replace function public.refresh_recovery_recurrence_candidates(p_event_id uuid,p_window_days int default 30)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); e restoration_events%rowtype; v_n int:=0;
begin
  select * into e from restoration_events where id=p_event_id and organization_id=v_org;
  if not found or e.actual_return_at is null then return jsonb_build_object('error','closed event with actual return required'); end if;
  insert into recovery_recurrence_links(organization_id,event_id,notification_id) select v_org,e.id,n.id from maintenance_notifications n where n.organization_id=v_org and n.asset_id=e.asset_id and n.notification_type in ('fault','safety') and n.reported_at>e.actual_return_at and n.reported_at<=e.actual_return_at+make_interval(days=>greatest(p_window_days,1)) on conflict(event_id,notification_id) do nothing;
  get diagnostics v_n=row_count;
  return jsonb_build_object('ok',true,'candidates_added',v_n,'window_days',greatest(p_window_days,1));
end $$;

create or replace function public.classify_recovery_recurrence(p_link_id uuid,p_verdict text,p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); l recovery_recurrence_links%rowtype;
begin
  if not public.recovery_role_allowed(array['supervisor','maintenance_manager','reliability_engineer','admin','ai_admin']) then return jsonb_build_object('error','recurrence authority denied'); end if;
  if p_verdict not in ('confirmed','rejected') or coalesce(length(trim(p_basis)),0)<15 then return jsonb_build_object('error','confirmed/rejected verdict and basis required'); end if;
  select * into l from recovery_recurrence_links where id=p_link_id and organization_id=v_org; if not found then return jsonb_build_object('error','recurrence candidate not found'); end if;
  update recovery_recurrence_links set verdict=p_verdict,basis=trim(p_basis),classified_by=auth.uid(),classified_at=now() where id=l.id;
  return jsonb_build_object('ok',true,'verdict',p_verdict);
end $$;

create or replace function public.get_recovery_ftr_metrics(p_window_days int default 90)
returns jsonb language sql stable security definer set search_path=public as $$ with e as (select id from restoration_events where organization_id=public.app_current_org() and status='closed' and actual_return_at>=now()-make_interval(days=>greatest(p_window_days,1))), x as (select count(*) total,count(*) filter(where not exists(select 1 from recovery_recurrence_links r where r.event_id=e.id and r.verdict='confirmed')) ftr from e) select jsonb_build_object('window_days',greatest(p_window_days,1),'closed_events',total,'first_time_right_events',ftr,'first_time_right_pct',case when total>0 then round(100.0*ftr/total,1) end,'basis','A closed restoration event is first-time-right unless a post-return recurrence has been human-confirmed.') from x $$;

create or replace function public.add_recovery_field_evidence(p_event_id uuid,p_event_work_id uuid,p_kind text,p_note text,p_attachment_id uuid default null,p_metadata jsonb default '{}'::jsonb,p_client_command_id text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_id uuid;
begin
  if not public.recovery_role_allowed(array['technician','supervisor','maintenance_manager','operator','reliability_engineer','admin','ai_admin']) then return jsonb_build_object('error','field evidence authority denied'); end if;
  if p_kind not in ('photo','voice','document','measurement','note') or coalesce(length(trim(p_note)),0)<3 then return jsonb_build_object('error','evidence kind and note required'); end if;
  if not exists(select 1 from restoration_events where id=p_event_id and organization_id=v_org) then return jsonb_build_object('error','event not found'); end if;
  if p_attachment_id is not null and not exists(select 1 from cowork_attachments a where a.id=p_attachment_id and a.organization_id=v_org and a.uploaded_by=auth.uid() and a.deleted_at is null) then return jsonb_build_object('error','attachment is not an active attachment owned by this user'); end if;
  insert into recovery_field_evidence(organization_id,event_id,event_work_id,attachment_id,evidence_kind,note,metadata,client_command_id,captured_by) values(v_org,p_event_id,p_event_work_id,p_attachment_id,p_kind,trim(p_note),coalesce(p_metadata,'{}'::jsonb),nullif(trim(coalesce(p_client_command_id,'')),''),auth.uid()) on conflict(organization_id,client_command_id) do update set client_command_id=excluded.client_command_id returning id into v_id;
  return jsonb_build_object('ok',true,'evidence_id',v_id,'idempotent',p_client_command_id is not null);
end $$;

create or replace function public.set_recovery_economic_assumptions(p_event_id uuid,p_regular numeric,p_overtime numeric,p_overtime_share numeric,p_contractor numeric,p_logistics numeric,p_risk numeric,p_life_cycle numeric,p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org();
begin
  if not public.recovery_role_allowed(array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']) then return jsonb_build_object('error','economics authority denied'); end if;
  if least(coalesce(p_regular,-1),coalesce(p_overtime,-1),coalesce(p_contractor,-1),coalesce(p_logistics,-1),coalesce(p_risk,-1),coalesce(p_life_cycle,-1))<0 or p_overtime_share not between 0 and 1 or coalesce(length(trim(p_basis)),0)<20 then return jsonb_build_object('error','non-negative costs, 0-1 overtime share and substantive basis required'); end if;
  insert into recovery_economic_assumptions(organization_id,event_id,regular_labour_rate_usd,overtime_labour_rate_usd,overtime_share,contractor_cost_usd,logistics_cost_usd,risk_cost_usd,life_cycle_cost_usd,basis,recorded_by) values(v_org,p_event_id,p_regular,p_overtime,p_overtime_share,p_contractor,p_logistics,p_risk,p_life_cycle,trim(p_basis),auth.uid()) on conflict(event_id) do update set regular_labour_rate_usd=excluded.regular_labour_rate_usd,overtime_labour_rate_usd=excluded.overtime_labour_rate_usd,overtime_share=excluded.overtime_share,contractor_cost_usd=excluded.contractor_cost_usd,logistics_cost_usd=excluded.logistics_cost_usd,risk_cost_usd=excluded.risk_cost_usd,life_cycle_cost_usd=excluded.life_cycle_cost_usd,basis=excluded.basis,recorded_by=auth.uid(),recorded_at=now();
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.get_recovery_economics(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); a recovery_economic_assumptions%rowtype; p restoration_plan_versions%rowtype; v_labour numeric:=0; v_material numeric:=0; v_exec numeric; v_net numeric;
begin
  select * into a from recovery_economic_assumptions where organization_id=v_org and event_id=p_event_id;
  select * into p from restoration_plan_versions where organization_id=v_org and event_id=p_event_id order by version desc limit 1;
  select coalesce(sum(coalesce(w.planned_hours,w.estimated_hours,0)),0) into v_labour from restoration_event_work ew join work_orders w on w.id=ew.work_order_id where ew.organization_id=v_org and ew.event_id=p_event_id and ew.plan_state='included';
  select coalesce(sum(m.qty_required*coalesce(mat.unit_cost_usd,0)),0) into v_material from restoration_event_work ew join work_order_materials m on m.work_order_id=ew.work_order_id join materials mat on mat.id=m.material_id where ew.organization_id=v_org and ew.event_id=p_event_id and ew.plan_state='included';
  if a.id is null then return jsonb_build_object('event_id',p_event_id,'available',false,'reason','Recovery economic assumptions are not recorded; no labour/contractor/logistics/risk/life-cycle cost is invented.','projected_downtime_value_usd',p.projected_downtime_value_usd,'material_cost_usd',v_material); end if;
  v_exec:=v_labour*((1-a.overtime_share)*a.regular_labour_rate_usd+a.overtime_share*a.overtime_labour_rate_usd)+v_material+a.contractor_cost_usd+a.logistics_cost_usd+a.risk_cost_usd+a.life_cycle_cost_usd; v_net:=coalesce(p.projected_downtime_value_usd,0)-v_exec;
  return jsonb_build_object('event_id',p_event_id,'available',true,'planned_labour_hours',round(v_labour,2),'material_cost_usd',round(v_material,2),'total_execution_cost_usd',round(v_exec,2),'projected_downtime_value_usd',p.projected_downtime_value_usd,'projected_net_value_usd',round(v_net,2),'basis',a.basis,'value_status','projected_pending_canonical_human_verification');
end $$;

create or replace function public.record_recovery_delay_attribution(p_event_id uuid,p_category text,p_hours numeric,p_attribution text,p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_id uuid;
begin
  if not public.recovery_role_allowed(array['maintenance_manager','reliability_engineer','operator','admin','ai_admin']) then return jsonb_build_object('error','attribution authority denied'); end if;
  if p_hours<0 or p_attribution not in ('causal','contributing','unattributed') or coalesce(length(trim(p_basis)),0)<15 then return jsonb_build_object('error','hours, attribution and basis required'); end if;
  if not exists(select 1 from restoration_events where id=p_event_id and organization_id=v_org and status='closed') then return jsonb_build_object('error','closed event required'); end if;
  insert into recovery_delay_attribution(organization_id,event_id,category,hours,attribution,basis,verified_by) values(v_org,p_event_id,trim(p_category),p_hours,p_attribution,trim(p_basis),auth.uid()) returning id into v_id;
  return jsonb_build_object('ok',true,'attribution_id',v_id);
end $$;

create or replace function public.get_recovery_counterfactual_attribution(p_event_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$ select jsonb_build_object('event_id',e.id,'baseline_return_at',e.baseline_return_at,'actual_return_at',e.actual_return_at,'counterfactual_hours_recovered',case when e.baseline_return_at is not null and e.actual_return_at is not null then greatest(0,extract(epoch from(e.baseline_return_at-e.actual_return_at))/3600.0) end,'attribution',coalesce((select jsonb_agg(jsonb_build_object('category',a.category,'hours',a.hours,'attribution',a.attribution,'basis',a.basis,'verified_by',a.verified_by,'verified_at',a.verified_at) order by a.hours desc) from recovery_delay_attribution a where a.event_id=e.id),'[]'::jsonb),'causally_attributed_hours',coalesce((select sum(a.hours) from recovery_delay_attribution a where a.event_id=e.id and a.attribution='causal'),0),'value_verification','Projected Recovery value is verified/rejected only through canonical verify_value_metric().') from restoration_events e where e.id=p_event_id and e.organization_id=public.app_current_org() $$;

create or replace function public.get_recovery_decision_queue()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org();
begin
  return jsonb_build_object('blockers',coalesce((select jsonb_agg(jsonb_build_object('kind','blocker','blocker_id',b.id,'event_id',e.id,'event_code',e.event_code,'description',b.description,'owner_role',b.owner_role,'severity',b.severity,'due_at',b.escalation_due_at,'overdue',b.escalation_due_at<now(),'rts_impact_hours',b.forecast_rts_impact_hours,'escalation_level',b.escalation_level) order by (b.escalation_due_at<now()) desc,b.forecast_rts_impact_hours desc nulls last,b.started_at) from restoration_blockers b join restoration_events e on e.id=b.event_id where b.organization_id=v_org and b.status='open'),'[]'::jsonb),'approvals',coalesce((select jsonb_agg(jsonb_build_object('kind','approval','decision_id',d.id,'event_id',d.decision_data->>'event_id','event_code',d.decision_data->>'event_code','created_at',d.created_at,'status',d.status) order by d.created_at) from autonomous_decisions d where d.organization_id=v_org and d.decision_type='release_restoration_plan' and d.status='pending'),'[]'::jsonb),'hard_constraints',coalesce((select jsonb_agg(jsonb_build_object('kind','constraint','constraint_id',c.id,'event_id',e.id,'event_code',e.event_code,'phase',c.phase,'state',c.state,'description',c.description,'owner_role',c.owner_role) order by e.opened_at,c.phase) from restoration_constraints c join restoration_events e on e.id=c.event_id where c.organization_id=v_org and c.is_hard and c.state in ('unknown','blocked') and e.status not in ('closed','cancelled')),'[]'::jsonb),'generated_at',now());
end $$;

create or replace function public.get_recovery_handoff(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); e restoration_events%rowtype; p restoration_plan_versions%rowtype;
begin
  select * into e from restoration_events where id=p_event_id and organization_id=v_org; if not found then return jsonb_build_object('error','event not found'); end if;
  select * into p from restoration_plan_versions where organization_id=v_org and event_id=e.id order by version desc limit 1;
  return jsonb_build_object('event',jsonb_build_object('event_id',e.id,'event_code',e.event_code,'status',e.status,'opened_at',e.opened_at,'forecast_return_at',e.forecast_return_at,'forecast_p80_return_at',e.forecast_p80_return_at,'baseline_return_at',e.baseline_return_at),'plan',case when p.id is null then null else jsonb_build_object('version',p.version,'status',p.status,'critical_path_hours',p.critical_path_hours,'p80_critical_path_hours',p.p80_critical_path_hours,'warnings',p.warnings) end,'work',coalesce((select jsonb_agg(jsonb_build_object('event_work_id',ew.id,'wo_number',w.wo_number,'title',w.title,'execution_status',ew.execution_status,'sequence_no',ew.sequence_no,'work_zone',ew.work_zone,'component_scope',ew.component_scope) order by ew.sequence_no,w.wo_number) from restoration_event_work ew join work_orders w on w.id=ew.work_order_id where ew.event_id=e.id and ew.plan_state='included'),'[]'::jsonb),'open_blockers',coalesce((select jsonb_agg(jsonb_build_object('description',b.description,'owner_role',b.owner_role,'severity',b.severity,'due_at',b.escalation_due_at,'rts_impact_hours',b.forecast_rts_impact_hours) order by b.severity desc,b.started_at) from restoration_blockers b where b.event_id=e.id and b.status='open'),'[]'::jsonb),'hard_constraints',coalesce((select jsonb_agg(jsonb_build_object('phase',c.phase,'state',c.state,'description',c.description,'owner_role',c.owner_role) order by c.phase) from restoration_constraints c where c.event_id=e.id and c.is_hard and c.state in ('unknown','blocked')),'[]'::jsonb),'field_evidence',coalesce((select jsonb_agg(jsonb_build_object('kind',f.evidence_kind,'note',f.note,'captured_at',f.captured_at,'attachment_id',f.attachment_id) order by f.captured_at desc) from recovery_field_evidence f where f.event_id=e.id and f.captured_at>=now()-interval '12 hours'),'[]'::jsonb),'generated_at',now(),'basis','Server-generated Recovery shift handoff from current canonical event, work, constraints, blockers, plan and field evidence.');
end $$;

create or replace function public.publish_recovery_cadence_snapshot(p_cadence text,p_event_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_snapshot jsonb; v_id uuid;
begin
  if p_cadence not in ('shift','daily','weekly') then return jsonb_build_object('error','invalid cadence'); end if;
  if p_event_id is not null then v_snapshot:=public.get_recovery_handoff(p_event_id); else v_snapshot:=jsonb_build_object('board',public.get_recovery_board(),'decision_queue',public.get_recovery_decision_queue(),'ftr',public.get_recovery_ftr_metrics(case when p_cadence='weekly' then 90 else 30 end),'generated_at',now()); end if;
  insert into recovery_cadence_snapshots(organization_id,event_id,cadence,snapshot,generated_by) values(v_org,p_event_id,p_cadence,v_snapshot,auth.uid()) returning id into v_id;
  return jsonb_build_object('ok',true,'snapshot_id',v_id,'snapshot',v_snapshot);
end $$;

create or replace function public.run_recovery_escalation_clock()
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; v_n int:=0;
begin
  for b in select rb.*,e.event_code,e.site_id from restoration_blockers rb join restoration_events e on e.id=rb.event_id where rb.status='open' and rb.escalation_due_at is not null and rb.escalation_due_at<=now() and (rb.escalated_at is null or rb.escalated_at<=now()-interval '60 minutes') loop
    update restoration_blockers set escalated_at=now(),escalation_level=escalation_level+1 where id=b.id;
    insert into system_alerts(organization_id,severity,title,description,alert_type,target_users) values(b.organization_id,case when b.severity in ('critical','high') then b.severity else 'warning' end,'Recovery escalation — '||b.event_code,'blocker_id='||b.id::text||' | owner='||b.owner_role||' | '||b.description||case when b.forecast_rts_impact_hours is not null then ' | forecast RTS impact '||b.forecast_rts_impact_hours||' h' else '' end,'recovery_escalation',array[b.owner_role]);
    v_n:=v_n+1;
  end loop;
  return jsonb_build_object('escalated',v_n,'ran_at',now());
end $$;

-- Authenticated RPC grants; escalation clock is platform-only.
do $$
declare sig text;
begin
  foreach sig in array array[
    'register_operational_constraint_signal(text,text,text,timestamptz,timestamptz,text,text,uuid,uuid,text,jsonb)',
    'set_restoration_resource_requirement(uuid,uuid,text,text,text,boolean,text)',
    'set_job_plan_energy_requirement(uuid,text,text,text)','record_asset_energy_state(uuid,text,text,text,text,timestamptz,text)',
    'set_restoration_work_zone(uuid,text,text,text)','set_work_zone_relationship(uuid,text,text,boolean,text,text)',
    'refresh_restoration_readiness(uuid)','set_recovery_consequence(uuid,int,int,int,int,text)',
    'record_recovery_recommendation_feedback(uuid,text,text,text,text,text)','refresh_recovery_recurrence_candidates(uuid,int)',
    'classify_recovery_recurrence(uuid,text,text)','get_recovery_ftr_metrics(int)',
    'add_recovery_field_evidence(uuid,uuid,text,text,uuid,jsonb,text)','set_recovery_economic_assumptions(uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text)',
    'get_recovery_economics(uuid)','record_recovery_delay_attribution(uuid,text,numeric,text,text)',
    'get_recovery_counterfactual_attribution(uuid)','get_recovery_decision_queue()','get_recovery_handoff(uuid)','publish_recovery_cadence_snapshot(text,uuid)'
  ] loop
    execute 'revoke all on function public.'||sig||' from public, anon';
    execute 'grant execute on function public.'||sig||' to authenticated';
  end loop;
end $$;
revoke all on function public.run_recovery_escalation_clock() from public,anon,authenticated;
grant execute on function public.run_recovery_escalation_clock() to service_role;

do $$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname='syncai-recovery-escalation-clock';
    perform cron.schedule('syncai-recovery-escalation-clock','*/5 * * * *','select public.run_recovery_escalation_clock()');
  end if;
end $$;

notify pgrst,'reload schema';
