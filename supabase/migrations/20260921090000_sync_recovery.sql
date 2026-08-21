-- ============================================================================
-- Sync Recovery / Event Orchestrator — governed restoration-event control plane
--
-- The downtime EVENT is the coordination object. Existing work orders, job
-- plans, materials, equipment release/return, approvals, decisions, value
-- verification, and learning remain canonical and are REFERENCED here rather
-- than copied.
--
-- Safety / trust rules encoded in this migration:
--   * unknown concurrency is sequential (fail closed), never assumed parallel;
--   * no generated duration is invented — explicit WO hours are used, while
--     P50/P80 are only emitted from >=5 completed comparable jobs;
--   * planning constraints must be satisfied before approval submission;
--   * job-plan permit/isolation requirements are enforced again at work start
--     through the canonical equipment_releases record;
--   * job-plan quality checks must all have PASS evidence before work closure;
--   * a released plan is immutable except for supersession by a newer plan;
--   * plan release requires the canonical autonomous approval chain and a
--     different human approver from the plan generator;
--   * value is counterfactual/projected until a human verifies it through the
--     existing value-verification workflow.
--
-- Deterministic engine ownership: sequencing, concurrency, critical path,
-- historical duration percentiles, constraints, and economics are SQL/math.
-- AI may explain or retrieve context, but it does not own these decisions.
-- ============================================================================

create table if not exists restoration_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  asset_id uuid not null references assets(id) on delete cascade,
  operating_state_id bigint references operating_states(id) on delete set null,
  event_code text not null,
  event_type text not null default 'unplanned'
    check (event_type in ('unplanned','planned','opportunity','major_intervention')),
  reason text not null,
  status text not null default 'open'
    check (status in ('open','planning','approval','released','executing','return_pending','closed','cancelled')),
  opened_at timestamptz not null default now(),
  baseline_return_at timestamptz,
  baseline_method text
    check (baseline_method is null or baseline_method in
      ('original_approved_schedule','historical_median','control_estimate','manual_authorized')),
  baseline_basis text,
  baseline_frozen_at timestamptz,
  forecast_return_at timestamptz,
  actual_return_at timestamptz,
  opened_by uuid references auth.users(id),
  closed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (baseline_return_at is null or baseline_return_at > opened_at),
  check (actual_return_at is null or actual_return_at >= opened_at)
);

create unique index if not exists idx_restoration_event_code
  on restoration_events(organization_id, event_code);
create unique index if not exists idx_restoration_one_active_asset
  on restoration_events(organization_id, asset_id)
  where status in ('open','planning','approval','released','executing','return_pending');
create index if not exists idx_restoration_events_open
  on restoration_events(organization_id, status, opened_at desc);

create table if not exists restoration_event_work (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_id uuid not null references restoration_events(id) on delete cascade,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  disposition text not null default 'mandatory'
    check (disposition in ('mandatory','opportunity','defer')),
  plan_state text not null default 'candidate'
    check (plan_state in ('candidate','included','excluded')),
  sequence_no int not null default 100 check (sequence_no > 0),
  concurrency_rule text not null default 'unknown'
    check (concurrency_rule in ('unknown','sequential_only','verified_parallel')),
  parallel_group text,
  concurrency_basis text,
  concurrency_verified_by uuid references auth.users(id),
  concurrency_verified_at timestamptz,
  execution_status text not null default 'not_started'
    check (execution_status in ('not_started','in_progress','blocked','complete')),
  completion_note text,
  completion_quality_evidence jsonb not null default '[]'::jsonb,
  added_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, work_order_id),
  check (
    concurrency_rule <> 'verified_parallel'
    or (parallel_group is not null and length(trim(parallel_group)) > 0
        and concurrency_basis is not null and length(trim(concurrency_basis)) >= 20
        and concurrency_verified_by is not null and concurrency_verified_at is not null)
  )
);

create index if not exists idx_restoration_work_event
  on restoration_event_work(organization_id, event_id, sequence_no);

create table if not exists restoration_constraints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_id uuid not null references restoration_events(id) on delete cascade,
  event_work_id uuid references restoration_event_work(id) on delete cascade,
  predecessor_work_id uuid references restoration_event_work(id) on delete cascade,
  constraint_kind text not null check (constraint_kind in (
    'precedence','resource','work_zone','material','labour','tooling','bay','crane',
    'vendor','weather','production','approval','permit','isolation','asset_state',
    'quality_hold','other')),
  phase text not null default 'planning'
    check (phase in ('planning','execution','return_to_service')),
  is_hard boolean not null default true,
  state text not null default 'unknown'
    check (state in ('unknown','satisfied','blocked','not_applicable')),
  description text not null,
  basis text not null,
  source_kind text not null default 'manual'
    check (source_kind in ('manual','job_plan','operating_state','material','workforce','vendor','weather','derived')),
  source_ref text,
  owner_role text,
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (state <> 'satisfied' or (verified_by is not null and verified_at is not null))
);

create index if not exists idx_restoration_constraints_event
  on restoration_constraints(organization_id, event_id, phase, state);

create table if not exists restoration_blockers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_id uuid not null references restoration_events(id) on delete cascade,
  event_work_id uuid references restoration_event_work(id) on delete set null,
  category text not null check (category in (
    'parts','labour','tooling','permit','vendor','weather','scope_growth','rework',
    'quality','operations','engineering','access','isolation','other')),
  description text not null,
  owner_role text not null,
  severity text not null default 'medium'
    check (severity in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','resolved')),
  started_at timestamptz not null default now(),
  escalation_due_at timestamptz,
  forecast_rts_impact_hours numeric check (forecast_rts_impact_hours is null or forecast_rts_impact_hours >= 0),
  impact_basis text,
  resolved_at timestamptz,
  resolution_note text,
  created_by uuid references auth.users(id),
  resolved_by uuid references auth.users(id),
  check (forecast_rts_impact_hours is null or length(trim(coalesce(impact_basis,''))) >= 10),
  check (status <> 'resolved' or resolved_at is not null)
);

create index if not exists idx_restoration_blockers_open
  on restoration_blockers(organization_id, event_id, status, started_at desc);

create table if not exists restoration_plan_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_id uuid not null references restoration_events(id) on delete cascade,
  version int not null,
  status text not null default 'draft'
    check (status in ('draft','approval','released','rejected','superseded')),
  engine_version text not null default 'sync-recovery-deterministic/1',
  schedule jsonb not null default '[]'::jsonb,
  serial_hours numeric,
  critical_path_hours numeric,
  forecast_return_at timestamptz,
  historical_p50_hours numeric,
  historical_p80_hours numeric,
  historical_sample int not null default 0,
  planned_concurrent_work_ratio numeric,
  missing_inputs jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  unresolved_planning_hard_constraints int not null default 0,
  baseline_snapshot jsonb not null default '{}'::jsonb,
  projected_hours_recovered numeric,
  projected_downtime_value_usd numeric,
  economics_basis text,
  release_decision_id uuid references autonomous_decisions(id) on delete set null,
  generated_by uuid not null references auth.users(id),
  generated_at timestamptz not null default now(),
  released_by uuid references auth.users(id),
  released_at timestamptz,
  unique(event_id, version)
);

create unique index if not exists idx_restoration_one_released_plan
  on restoration_plan_versions(event_id) where status = 'released';
create index if not exists idx_restoration_plans_event
  on restoration_plan_versions(organization_id, event_id, version desc);

-- Tenant members may read the restoration picture. All writes go through the
-- governed RPCs below; no client INSERT/UPDATE/DELETE policy exists.
foreach_table_placeholder := null;

do $$
declare
  t text;
begin
  foreach t in array array[
    'restoration_events','restoration_event_work','restoration_constraints',
    'restoration_blockers','restoration_plan_versions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_org_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (organization_id = public.app_current_org())',
      t || '_org_read', t
    );
  end loop;
end $$;

-- The only legal mutation to an already released plan is changing its status to
-- superseded; its evidence, arithmetic, schedule and approver remain frozen.
create or replace function public.protect_released_restoration_plan()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'released' then
    if new.status = 'superseded'
       and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then
      return new;
    end if;
    raise exception 'Released restoration plans are immutable; create and approve a new version.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists trg_protect_released_restoration_plan on restoration_plan_versions;
create trigger trg_protect_released_restoration_plan
  before update on restoration_plan_versions
  for each row execute function public.protect_released_restoration_plan();

create or replace function public.recovery_role_allowed(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_current_org() is not null
    and lower(coalesce(public.app_current_role(),'')) = any(p_roles)
$$;

revoke all on function public.recovery_role_allowed(text[]) from public, anon;
grant execute on function public.recovery_role_allowed(text[]) to authenticated;

-- ----------------------------------------------------------------------------
-- Event intake and scope
-- ----------------------------------------------------------------------------
create or replace function public.open_restoration_event(
  p_asset_id uuid,
  p_reason text,
  p_event_type text default 'unplanned'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_site uuid;
  v_state operating_states%rowtype;
  v_event restoration_events%rowtype;
  v_code text;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.recovery_role_allowed(array['planner','supervisor','maintenance_manager','reliability_engineer','operator','admin','ai_admin']) then
    return jsonb_build_object('error','opening a restoration event requires an operations, planning, supervision, engineering, or maintenance-management role');
  end if;
  if coalesce(length(trim(p_reason)),0) < 10 then
    return jsonb_build_object('error','state the reason for the restoration event');
  end if;
  if p_event_type not in ('unplanned','planned','opportunity','major_intervention') then
    return jsonb_build_object('error','invalid event type');
  end if;

  select site_id into v_site from assets where id=p_asset_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','asset not found'); end if;
  if exists (select 1 from restoration_events where organization_id=v_org and asset_id=p_asset_id
             and status in ('open','planning','approval','released','executing','return_pending')) then
    return jsonb_build_object('error','an active restoration event already exists for this asset');
  end if;

  select * into v_state from operating_states
  where organization_id=v_org and asset_id=p_asset_id
    and state in ('down_planned','down_unplanned','offline')
    and coalesce(ended_at, now()) > now()
  order by started_at desc limit 1;

  if p_event_type='unplanned' and not found then
    return jsonb_build_object('error','the latest operating-state record does not show the asset currently down; record the operating state or use a planned/major intervention event instead of inventing downtime');
  end if;

  v_code := 'REC-' || to_char(now(),'YYYYMMDD-HH24MISS') || '-' || upper(substr(replace(p_asset_id::text,'-',''),1,6));
  insert into restoration_events(
    organization_id,site_id,asset_id,operating_state_id,event_code,event_type,
    reason,opened_at,opened_by)
  values(v_org,v_site,p_asset_id,case when v_state.id is null then null else v_state.id end,
    v_code,p_event_type,trim(p_reason),coalesce(v_state.started_at,now()),auth.uid())
  returning * into v_event;

  insert into decisions(organization_id,asset_id,decision_type,action_taken,
    approval_status,autonomy_mode,confidence_score,human_actor,rationale,outcome_status)
  values(v_org,p_asset_id,'restoration_event_opened','Opened '||v_code,'approved',
    'advisory',100,auth.uid()::text,trim(p_reason),'executed');

  return jsonb_build_object('ok',true,'event_id',v_event.id,'event_code',v_event.event_code,
    'opened_at',v_event.opened_at,'operating_state_id',v_event.operating_state_id);
end
$$;

grant execute on function public.open_restoration_event(uuid,text,text) to authenticated;

create or replace function public.set_restoration_baseline(
  p_event_id uuid,
  p_baseline_return_at timestamptz,
  p_method text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  e restoration_events%rowtype;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.recovery_role_allowed(array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']) then
    return jsonb_build_object('error','setting the counterfactual baseline requires planning, engineering, or maintenance-management authority');
  end if;
  select * into e from restoration_events where id=p_event_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','event not found'); end if;
  if e.baseline_frozen_at is not null then
    return jsonb_build_object('error','the baseline is frozen; changing it after planning begins would rewrite the counterfactual');
  end if;
  if p_baseline_return_at <= e.opened_at then
    return jsonb_build_object('error','baseline return must be later than event start');
  end if;
  if p_method not in ('original_approved_schedule','historical_median','control_estimate','manual_authorized') then
    return jsonb_build_object('error','invalid baseline method');
  end if;
  if coalesce(length(trim(p_basis)),0) < 20 then
    return jsonb_build_object('error','record the source/basis for the baseline; value cannot be defended without it');
  end if;
  update restoration_events set baseline_return_at=p_baseline_return_at,
    baseline_method=p_method,baseline_basis=trim(p_basis),updated_at=now()
  where id=p_event_id;
  return jsonb_build_object('ok',true,'baseline_return_at',p_baseline_return_at,'method',p_method);
end
$$;

grant execute on function public.set_restoration_baseline(uuid,timestamptz,text,text) to authenticated;

create or replace function public.add_restoration_work(
  p_event_id uuid,
  p_work_order_id uuid,
  p_disposition text default 'mandatory'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  e restoration_events%rowtype;
  w work_orders%rowtype;
  v_seq int;
  v_id uuid;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.recovery_role_allowed(array['planner','supervisor','maintenance_manager','reliability_engineer','admin','ai_admin']) then
    return jsonb_build_object('error','changing event scope requires planning, supervision, engineering, or maintenance-management authority');
  end if;
  if p_disposition not in ('mandatory','opportunity','defer') then return jsonb_build_object('error','invalid disposition'); end if;
  select * into e from restoration_events where id=p_event_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','event not found'); end if;
  if e.status in ('released','executing','return_pending','closed','cancelled') then
    return jsonb_build_object('error','released/executing event scope is frozen; generate a governed replanning version instead of silently changing scope');
  end if;
  select * into w from work_orders where id=p_work_order_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','work order not found'); end if;
  if w.asset_id is distinct from e.asset_id then return jsonb_build_object('error','work order belongs to a different asset'); end if;
  if w.completed_at is not null then return jsonb_build_object('error','completed work cannot be added as open restoration scope'); end if;
  select coalesce(max(sequence_no),0)+10 into v_seq from restoration_event_work where event_id=p_event_id;
  insert into restoration_event_work(organization_id,event_id,work_order_id,disposition,
    plan_state,sequence_no,added_by)
  values(v_org,p_event_id,p_work_order_id,p_disposition,
    case when p_disposition='defer' then 'excluded' else 'included' end,v_seq,auth.uid())
  on conflict(event_id,work_order_id) do update set
    disposition=excluded.disposition,
    plan_state=excluded.plan_state,
    updated_at=now()
  returning id into v_id;
  update restoration_events set status='planning',updated_at=now() where id=p_event_id and status='open';
  return jsonb_build_object('ok',true,'event_work_id',v_id,'sequence_no',v_seq);
end
$$;

grant execute on function public.add_restoration_work(uuid,uuid,text) to authenticated;

create or replace function public.sequence_restoration_work(
  p_event_work_id uuid,
  p_sequence_no int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.app_current_org(); v_event uuid;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.recovery_role_allowed(array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']) then
    return jsonb_build_object('error','sequencing restoration work requires planning, engineering, or maintenance-management authority');
  end if;
  if p_sequence_no <= 0 then return jsonb_build_object('error','sequence must be positive'); end if;
  select event_id into v_event from restoration_event_work where id=p_event_work_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','event work not found'); end if;
  if exists(select 1 from restoration_events where id=v_event and status in ('released','executing','return_pending','closed','cancelled')) then
    return jsonb_build_object('error','event scope/sequence is frozen after release');
  end if;
  update restoration_event_work set sequence_no=p_sequence_no,updated_at=now() where id=p_event_work_id;
  return jsonb_build_object('ok',true,'sequence_no',p_sequence_no);
end
$$;

grant execute on function public.sequence_restoration_work(uuid,int) to authenticated;

-- Concurrency is NEVER inferred. A named human must verify the group and record
-- a substantive basis. Until then every item is treated as sequential.
create or replace function public.verify_restoration_parallel_group(
  p_event_id uuid,
  p_event_work_ids uuid[],
  p_group text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.app_current_org(); v_count int; v_seq int;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.recovery_role_allowed(array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']) then
    return jsonb_build_object('error','verifying concurrent work requires planning, engineering, or maintenance-management authority');
  end if;
  if coalesce(array_length(p_event_work_ids,1),0) < 2 then return jsonb_build_object('error','a parallel group requires at least two work items'); end if;
  if coalesce(length(trim(p_group)),0) < 2 or coalesce(length(trim(p_basis)),0) < 20 then
    return jsonb_build_object('error','parallel work needs a named group and a substantive safety/resource basis');
  end if;
  select count(*),min(sequence_no) into v_count,v_seq from restoration_event_work
  where organization_id=v_org and event_id=p_event_id and id=any(p_event_work_ids) and plan_state='included';
  if v_count <> array_length(p_event_work_ids,1) then return jsonb_build_object('error','one or more work items are missing, excluded, or from another event'); end if;
  if exists(select 1 from restoration_constraints where organization_id=v_org and event_id=p_event_id
            and phase='planning' and is_hard and state<>'satisfied'
            and (event_work_id is null or event_work_id=any(p_event_work_ids))) then
    return jsonb_build_object('error','resolve the event/group planning constraints before declaring concurrency safe');
  end if;
  update restoration_event_work set concurrency_rule='verified_parallel',parallel_group=trim(p_group),
    concurrency_basis=trim(p_basis),concurrency_verified_by=auth.uid(),concurrency_verified_at=now(),
    sequence_no=v_seq,updated_at=now()
  where organization_id=v_org and event_id=p_event_id and id=any(p_event_work_ids);
  return jsonb_build_object('ok',true,'group',trim(p_group),'items',v_count,'sequence_no',v_seq);
end
$$;

grant execute on function public.verify_restoration_parallel_group(uuid,uuid[],text,text) to authenticated;

-- ----------------------------------------------------------------------------
-- Explicit constraints and live blockers
-- ----------------------------------------------------------------------------
create or replace function public.add_restoration_constraint(
  p_event_id uuid,
  p_event_work_id uuid,
  p_kind text,
  p_phase text,
  p_is_hard boolean,
  p_description text,
  p_basis text,
  p_owner_role text default null,
  p_predecessor_work_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.app_current_org(); v_id uuid;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.recovery_role_allowed(array['planner','supervisor','maintenance_manager','reliability_engineer','operator','admin','ai_admin']) then
    return jsonb_build_object('error','adding a restoration constraint requires an accountable operating/planning role');
  end if;
  if p_kind not in ('precedence','resource','work_zone','material','labour','tooling','bay','crane','vendor','weather','production','approval','permit','isolation','asset_state','quality_hold','other')
     or p_phase not in ('planning','execution','return_to_service') then
    return jsonb_build_object('error','invalid constraint kind or phase');
  end if;
  if coalesce(length(trim(p_description)),0)<10 or coalesce(length(trim(p_basis)),0)<10 then
    return jsonb_build_object('error','constraint description and basis are required');
  end if;
  if not exists(select 1 from restoration_events where id=p_event_id and organization_id=v_org) then return jsonb_build_object('error','event not found'); end if;
  if p_event_work_id is not null and not exists(select 1 from restoration_event_work where id=p_event_work_id and event_id=p_event_id and organization_id=v_org) then return jsonb_build_object('error','event work not found'); end if;
  if p_predecessor_work_id is not null and not exists(select 1 from restoration_event_work where id=p_predecessor_work_id and event_id=p_event_id and organization_id=v_org) then return jsonb_build_object('error','predecessor work not found'); end if;
  insert into restoration_constraints(organization_id,event_id,event_work_id,predecessor_work_id,
    constraint_kind,phase,is_hard,state,description,basis,owner_role,created_by)
  values(v_org,p_event_id,p_event_work_id,p_predecessor_work_id,p_kind,p_phase,p_is_hard,
    'unknown',trim(p_description),trim(p_basis),p_owner_role,auth.uid()) returning id into v_id;
  return jsonb_build_object('ok',true,'constraint_id',v_id,'state','unknown');
end
$$;

grant execute on function public.add_restoration_constraint(uuid,uuid,text,text,boolean,text,text,text,uuid) to authenticated;

create or replace function public.set_restoration_constraint_state(
  p_constraint_id uuid,
  p_state text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.app_current_org(); c restoration_constraints%rowtype; v_role text := public.app_current_role();
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if p_state not in ('unknown','satisfied','blocked','not_applicable') then return jsonb_build_object('error','invalid constraint state'); end if;
  select * into c from restoration_constraints where id=p_constraint_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','constraint not found'); end if;
  -- Physical isolation/permit truth lives in equipment_releases/job plans. This
  -- generic control may record them blocked/unknown, but cannot self-attest safe.
  if p_state='satisfied' and c.constraint_kind in ('permit','isolation','asset_state') then
    return jsonb_build_object('error','permit/isolation/asset-state satisfaction must come from the governed equipment release/return process, not a manual Recovery toggle');
  end if;
  if c.constraint_kind='production' and v_role not in ('operator','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error','production constraints require operations or maintenance-management authority');
  end if;
  if v_role not in ('planner','supervisor','maintenance_manager','reliability_engineer','operator','admin','ai_admin') then
    return jsonb_build_object('error','role not permitted to update restoration constraints');
  end if;
  if p_state in ('satisfied','not_applicable') and coalesce(length(trim(p_basis)),0)<10 then
    return jsonb_build_object('error','record the evidence/basis for clearing the constraint');
  end if;
  update restoration_constraints set state=p_state,basis=case when p_basis is null then basis else trim(p_basis) end,
    verified_by=case when p_state in ('satisfied','not_applicable') then auth.uid() else null end,
    verified_at=case when p_state in ('satisfied','not_applicable') then now() else null end
  where id=p_constraint_id;
  return jsonb_build_object('ok',true,'state',p_state);
end
$$;

grant execute on function public.set_restoration_constraint_state(uuid,text,text) to authenticated;

create or replace function public.record_restoration_blocker(
  p_event_id uuid,
  p_event_work_id uuid,
  p_category text,
  p_description text,
  p_owner_role text,
  p_severity text default 'medium',
  p_escalation_due_at timestamptz default null,
  p_forecast_rts_impact_hours numeric default null,
  p_impact_basis text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.app_current_org(); v_id uuid;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.recovery_role_allowed(array['technician','planner','supervisor','maintenance_manager','reliability_engineer','operator','admin','ai_admin']) then
    return jsonb_build_object('error','role not permitted to record event blockers');
  end if;
  if p_category not in ('parts','labour','tooling','permit','vendor','weather','scope_growth','rework','quality','operations','engineering','access','isolation','other')
     or p_severity not in ('low','medium','high','critical') then return jsonb_build_object('error','invalid blocker category or severity'); end if;
  if coalesce(length(trim(p_description)),0)<10 or coalesce(length(trim(p_owner_role)),0)<2 then return jsonb_build_object('error','blocker description and owner are required'); end if;
  if p_forecast_rts_impact_hours is not null and (p_forecast_rts_impact_hours<0 or coalesce(length(trim(p_impact_basis)),0)<10) then
    return jsonb_build_object('error','an RTS-impact estimate requires a non-negative value and its basis');
  end if;
  if not exists(select 1 from restoration_events where id=p_event_id and organization_id=v_org) then return jsonb_build_object('error','event not found'); end if;
  insert into restoration_blockers(organization_id,event_id,event_work_id,category,description,
    owner_role,severity,escalation_due_at,forecast_rts_impact_hours,impact_basis,created_by)
  values(v_org,p_event_id,p_event_work_id,p_category,trim(p_description),trim(p_owner_role),p_severity,
    p_escalation_due_at,p_forecast_rts_impact_hours,p_impact_basis,auth.uid()) returning id into v_id;
  return jsonb_build_object('ok',true,'blocker_id',v_id);
end
$$;

grant execute on function public.record_restoration_blocker(uuid,uuid,text,text,text,text,timestamptz,numeric,text) to authenticated;

create or replace function public.resolve_restoration_blocker(p_blocker_id uuid,p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.app_current_org();
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.recovery_role_allowed(array['technician','planner','supervisor','maintenance_manager','reliability_engineer','operator','admin','ai_admin']) then return jsonb_build_object('error','role not permitted to resolve blockers'); end if;
  if coalesce(length(trim(p_note)),0)<10 then return jsonb_build_object('error','record how the blocker was resolved'); end if;
  update restoration_blockers set status='resolved',resolved_at=now(),resolution_note=trim(p_note),resolved_by=auth.uid()
  where id=p_blocker_id and organization_id=v_org and status='open';
  if not found then return jsonb_build_object('error','open blocker not found'); end if;
  return jsonb_build_object('ok',true);
end
$$;

grant execute on function public.resolve_restoration_blocker(uuid,text) to authenticated;

-- ----------------------------------------------------------------------------
-- Deterministic plan generator.
--
-- Each sequence is a stage. Multiple tasks at one sequence run in parallel
-- ONLY when every member carries a named, human-verified parallel group;
-- otherwise stage duration is the sum (safe sequential default).
-- ----------------------------------------------------------------------------
create or replace function public.generate_restoration_plan(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  e restoration_events%rowtype;
  v_version int;
  v_schedule jsonb := '[]'::jsonb;
  v_serial numeric;
  v_critical numeric;
  v_missing jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_unresolved int;
  v_forecast timestamptz;
  v_p50 numeric;
  v_p80 numeric;
  v_hist_n int;
  v_cwr numeric;
  v_cost numeric;
  v_cost_basis text;
  v_recovered numeric;
  v_value numeric;
  v_plan uuid;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.recovery_role_allowed(array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']) then
    return jsonb_build_object('error','generating a restoration plan requires planning, engineering, or maintenance-management authority');
  end if;
  select * into e from restoration_events where id=p_event_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','event not found'); end if;
  if e.status in ('closed','cancelled') then return jsonb_build_object('error','closed/cancelled events cannot be planned'); end if;
  if not exists(select 1 from restoration_event_work where event_id=p_event_id and organization_id=v_org and plan_state='included') then
    return jsonb_build_object('error','no included work scope exists');
  end if;

  -- Freeze the counterfactual as soon as the first plan is generated. It may be
  -- absent; absence stays visible and value remains unavailable.
  if e.baseline_frozen_at is null then
    update restoration_events set baseline_frozen_at=now() where id=e.id;
    e.baseline_frozen_at := now();
  end if;

  with scope as (
    select ew.id event_work_id, ew.sequence_no, ew.concurrency_rule, ew.parallel_group,
           w.id work_order_id,w.wo_number,w.title,w.priority,w.job_plan_id,
           case when w.planned_hours>0 then w.planned_hours
                when w.estimated_hours>0 then w.estimated_hours else null end explicit_hours,
           case when w.planned_hours>0 then 'work_orders.planned_hours'
                when w.estimated_hours>0 then 'work_orders.estimated_hours' else null end explicit_basis,
           h.n hist_n,h.p50,h.p80,
           case when h.n>=5 then h.p80
                when w.planned_hours>0 then w.planned_hours
                when w.estimated_hours>0 then w.estimated_hours else null end plan_hours,
           case when h.n>=5 then 'historical P80 from completed work with the same adopted job plan'
                when w.planned_hours>0 then 'work_orders.planned_hours'
                when w.estimated_hours>0 then 'work_orders.estimated_hours'
                else 'missing' end duration_basis
    from restoration_event_work ew
    join work_orders w on w.id=ew.work_order_id and w.organization_id=v_org
    left join lateral (
      select count(*)::int n,
             percentile_disc(0.5) within group(order by x.actual_hours)::numeric p50,
             percentile_disc(0.8) within group(order by x.actual_hours)::numeric p80
      from work_orders x
      where w.job_plan_id is not null and x.organization_id=v_org
        and x.job_plan_id=w.job_plan_id and x.completed_at is not null and x.actual_hours>0
    ) h on true
    where ew.organization_id=v_org and ew.event_id=p_event_id and ew.plan_state='included'
  ), stages as (
    select sequence_no,
      count(*)::int task_count,
      bool_and(concurrency_rule='verified_parallel')
        and count(distinct parallel_group)=1 and min(parallel_group) is not null as verified_parallel,
      case when bool_and(concurrency_rule='verified_parallel')
                  and count(distinct parallel_group)=1 and min(parallel_group) is not null
           then max(plan_hours) else sum(plan_hours) end stage_hours,
      jsonb_agg(jsonb_build_object(
        'event_work_id',event_work_id,'work_order_id',work_order_id,'wo_number',wo_number,
        'title',title,'priority',priority,'hours',plan_hours,'duration_basis',duration_basis,
        'historical_sample',hist_n,'p50_hours',case when hist_n>=5 then p50 end,
        'p80_hours',case when hist_n>=5 then p80 end,
        'concurrency_rule',concurrency_rule,'parallel_group',parallel_group)
        order by priority,wo_number) tasks
    from scope group by sequence_no
  )
  select
    coalesce((select sum(plan_hours) from scope),0),
    coalesce((select sum(stage_hours) from stages),0),
    coalesce((select jsonb_agg(jsonb_build_object(
      'sequence',sequence_no,'mode',case when verified_parallel then 'parallel' else 'sequential' end,
      'duration_hours',stage_hours,'tasks',tasks) order by sequence_no) from stages),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('work_order_id',work_order_id,'wo_number',wo_number,'missing','duration'))
             from scope where plan_hours is null),'[]'::jsonb),
    coalesce((select round(percentile_disc(0.5) within group(order by p50)::numeric,2) from scope where hist_n>=5),null),
    coalesce((select round(percentile_disc(0.8) within group(order by p80)::numeric,2) from scope where hist_n>=5),null),
    coalesce((select sum(hist_n) from scope),0),
    coalesce((select round(100.0*count(*) filter(where concurrency_rule='verified_parallel')/nullif(count(*),0),1) from scope),0)
  into v_serial,v_critical,v_schedule,v_missing,v_p50,v_p80,v_hist_n,v_cwr;

  select count(*) into v_unresolved from restoration_constraints
  where organization_id=v_org and event_id=p_event_id and phase='planning' and is_hard and state<>'satisfied';
  if v_unresolved>0 then
    v_missing := v_missing || jsonb_build_object('missing','planning hard constraints','count',v_unresolved);
  end if;
  if exists(select 1 from restoration_event_work where organization_id=v_org and event_id=p_event_id
            and plan_state='included' and concurrency_rule='unknown') then
    v_warnings := v_warnings || jsonb_build_object('warning','Unknown concurrency is scheduled sequentially until a human verifies parallel execution with a basis.');
  end if;
  if exists(select 1 from restoration_blockers where organization_id=v_org and event_id=p_event_id and status='open') then
    v_warnings := v_warnings || jsonb_build_object('warning','Open live blockers exist; their forecast impacts are shown separately and are not silently folded into deterministic task duration.');
  end if;

  if jsonb_array_length(v_missing)=0 and v_critical is not null then v_forecast := now() + make_interval(hours=>v_critical); end if;

  select coalesce(ae.downtime_cost_per_hour_usd,null),ae.basis into v_cost,v_cost_basis
  from asset_economics ae join assets a on a.id=e.asset_id
  where ae.organization_id=v_org and (ae.asset_id=e.asset_id or (ae.asset_id is null and ae.asset_class=a.asset_class))
  order by (ae.asset_id is not null) desc limit 1;
  if e.baseline_return_at is not null and v_forecast is not null then
    v_recovered := greatest(0,extract(epoch from(e.baseline_return_at-v_forecast))/3600.0);
    if v_cost is not null then v_value := v_recovered*v_cost; end if;
  end if;

  select coalesce(max(version),0)+1 into v_version from restoration_plan_versions where event_id=p_event_id;
  update restoration_plan_versions set status='superseded'
  where event_id=p_event_id and organization_id=v_org and status='released';
  insert into restoration_plan_versions(organization_id,event_id,version,status,schedule,
    serial_hours,critical_path_hours,forecast_return_at,historical_p50_hours,historical_p80_hours,
    historical_sample,planned_concurrent_work_ratio,missing_inputs,warnings,
    unresolved_planning_hard_constraints,baseline_snapshot,projected_hours_recovered,
    projected_downtime_value_usd,economics_basis,generated_by)
  values(v_org,p_event_id,v_version,'draft',v_schedule,v_serial,v_critical,v_forecast,
    v_p50,v_p80,v_hist_n,v_cwr,v_missing,v_warnings,v_unresolved,
    jsonb_build_object('return_at',e.baseline_return_at,'method',e.baseline_method,'basis',e.baseline_basis,'frozen_at',e.baseline_frozen_at),
    v_recovered,v_value,v_cost_basis,auth.uid()) returning id into v_plan;

  update restoration_events set status='planning',forecast_return_at=v_forecast,updated_at=now() where id=p_event_id;
  return jsonb_build_object('ok',true,'plan_id',v_plan,'version',v_version,
    'serial_hours',v_serial,'critical_path_hours',v_critical,'forecast_return_at',v_forecast,
    'missing_inputs',v_missing,'warnings',v_warnings,'planned_concurrent_work_ratio',v_cwr,
    'projected_hours_recovered',v_recovered,'projected_downtime_value_usd',v_value);
end
$$;

grant execute on function public.generate_restoration_plan(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Canonical approval handoff and release
-- ----------------------------------------------------------------------------
create or replace function public.submit_restoration_plan_for_approval(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.app_current_org(); p restoration_plan_versions%rowtype; e restoration_events%rowtype; v_decision uuid;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.recovery_role_allowed(array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']) then return jsonb_build_object('error','submitting a restoration plan requires planning, engineering, or maintenance-management authority'); end if;
  select * into p from restoration_plan_versions where id=p_plan_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','plan not found'); end if;
  select * into e from restoration_events where id=p.event_id and organization_id=v_org;
  if p.status<>'draft' then return jsonb_build_object('error','only a draft plan can be submitted'); end if;
  if jsonb_array_length(p.missing_inputs)>0 or p.unresolved_planning_hard_constraints>0 then
    return jsonb_build_object('error','plan has missing inputs or unresolved hard planning constraints','missing_inputs',p.missing_inputs);
  end if;
  insert into autonomous_decisions(organization_id,decision_type,decision_data,confidence_score,status,
    requires_approval,asset_id,autonomy_level,created_at)
  values(v_org,'release_restoration_plan',jsonb_build_object(
    'restoration_plan_id',p.id,'event_id',p.event_id,'event_code',e.event_code,
    'version',p.version,'critical_path_hours',p.critical_path_hours,
    'forecast_return_at',p.forecast_return_at,'projected_hours_recovered',p.projected_hours_recovered,
    'projected_downtime_value_usd',p.projected_downtime_value_usd,
    'baseline',p.baseline_snapshot,'warnings',p.warnings),
    100,'pending',true,e.asset_id,'advisory',now()) returning id into v_decision;
  insert into approval_workflows(decision_id,approval_level,status,comments)
  values(v_decision,1,'pending','Sync Recovery plan release — independent human approval required');
  update restoration_plan_versions set status='approval',release_decision_id=v_decision where id=p.id;
  update restoration_events set status='approval',updated_at=now() where id=e.id;
  return jsonb_build_object('ok',true,'decision_id',v_decision,'approval_required',true);
end
$$;

grant execute on function public.submit_restoration_plan_for_approval(uuid) to authenticated;

create or replace function public.release_restoration_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.app_current_org(); p restoration_plan_versions%rowtype; d autonomous_decisions%rowtype;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.recovery_role_allowed(array['planner','maintenance_manager','admin','ai_admin']) then return jsonb_build_object('error','releasing the approved event plan requires planner or maintenance-management authority'); end if;
  select * into p from restoration_plan_versions where id=p_plan_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','plan not found'); end if;
  if p.status<>'approval' or p.release_decision_id is null then return jsonb_build_object('error','plan is not awaiting canonical approval'); end if;
  select * into d from autonomous_decisions where id=p.release_decision_id and organization_id=v_org;
  if not found or d.status<>'approved' or d.approved_by is null then return jsonb_build_object('error','the canonical approval decision is not approved'); end if;
  if d.approved_by=p.generated_by then return jsonb_build_object('error','segregation of duties: the plan generator cannot approve the plan they generated'); end if;
  if jsonb_array_length(p.missing_inputs)>0 or p.unresolved_planning_hard_constraints>0 then return jsonb_build_object('error','plan cannot be released with missing inputs or hard planning constraints'); end if;
  update restoration_plan_versions set status='released',released_by=auth.uid(),released_at=now() where id=p.id;
  update restoration_events set status='released',forecast_return_at=p.forecast_return_at,updated_at=now() where id=p.event_id;
  insert into autonomous_actions(decision_id,action_type,target_id,action_data,triggered_by,success)
  values(d.id,'release_restoration_plan',p.event_id,jsonb_build_object('plan_id',p.id,'version',p.version),auth.uid()::text,true);
  insert into decisions(organization_id,asset_id,decision_type,action_taken,approval_status,autonomy_mode,
    confidence_score,human_actor,rationale,outcome_status)
  select v_org,e.asset_id,'restoration_plan_release','Released Recovery plan v'||p.version,
    'approved','advisory',100,auth.uid()::text,'Canonical autonomous decision '||d.id::text,'executed'
  from restoration_events e where e.id=p.event_id;
  return jsonb_build_object('ok',true,'released',p.id,'approved_by',d.approved_by,'released_by',auth.uid());
end
$$;

grant execute on function public.release_restoration_plan(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Controlled execution. Planning approval does not waive execution controls.
-- ----------------------------------------------------------------------------
create or replace function public.start_restoration_work(p_event_work_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.app_current_org(); ew restoration_event_work%rowtype; w work_orders%rowtype; e restoration_events%rowtype; v_permits int;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.recovery_role_allowed(array['technician','supervisor','maintenance_manager','admin','ai_admin']) then return jsonb_build_object('error','starting field work requires technician/supervision/maintenance-management authority'); end if;
  select * into ew from restoration_event_work where id=p_event_work_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','event work not found'); end if;
  select * into e from restoration_events where id=ew.event_id and organization_id=v_org;
  select * into w from work_orders where id=ew.work_order_id and organization_id=v_org;
  if e.status not in ('released','executing') then return jsonb_build_object('error','event plan is not released'); end if;
  if ew.plan_state<>'included' or ew.execution_status not in ('not_started','blocked') then return jsonb_build_object('error','work is not an included startable item'); end if;
  if exists(select 1 from restoration_constraints where organization_id=v_org and event_id=e.id and phase='execution' and is_hard and state<>'satisfied' and (event_work_id is null or event_work_id=ew.id)) then
    return jsonb_build_object('error','unresolved hard execution constraint blocks this work');
  end if;
  select count(*) into v_permits from job_plan_permits where job_plan_id=w.job_plan_id;
  if v_permits>0 and not exists(select 1 from equipment_releases r where r.organization_id=v_org and r.asset_id=e.asset_id
      and (r.work_order_id=w.id or r.work_order_id is null) and r.status='released' and r.isolation_confirmed) then
    return jsonb_build_object('error','job plan requires permit/isolation; the canonical equipment-release record does not confirm an active isolation');
  end if;
  update restoration_event_work set execution_status='in_progress',updated_at=now() where id=ew.id;
  update restoration_events set status='executing',updated_at=now() where id=e.id;
  update work_orders set status='in_progress' where id=w.id;
  return jsonb_build_object('ok',true,'work_order_id',w.id,'permits_required',v_permits);
end
$$;

grant execute on function public.start_restoration_work(uuid) to authenticated;

create or replace function public.complete_restoration_work(
  p_event_work_id uuid,
  p_actual_hours numeric,
  p_completion_note text,
  p_quality_results jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.app_current_org(); ew restoration_event_work%rowtype; w work_orders%rowtype; v_checks int; v_passed int;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.recovery_role_allowed(array['technician','supervisor','maintenance_manager','admin','ai_admin']) then return jsonb_build_object('error','completing field work requires technician/supervision/maintenance-management authority'); end if;
  if p_actual_hours is null or p_actual_hours<=0 then return jsonb_build_object('error','record positive actual labour hours'); end if;
  if coalesce(length(trim(p_completion_note)),0)<10 then return jsonb_build_object('error','record completion condition/evidence'); end if;
  select * into ew from restoration_event_work where id=p_event_work_id and organization_id=v_org;
  if not found or ew.execution_status<>'in_progress' then return jsonb_build_object('error','work is not in progress'); end if;
  select * into w from work_orders where id=ew.work_order_id and organization_id=v_org;
  select count(*) into v_checks from job_plan_checks where job_plan_id=w.job_plan_id;
  if v_checks>0 then
    select count(distinct (r->>'check_id')) into v_passed
    from jsonb_array_elements(coalesce(p_quality_results,'[]'::jsonb)) r
    join job_plan_checks c on c.id::text=r->>'check_id' and c.job_plan_id=w.job_plan_id
    where lower(coalesce(r->>'result',''))='pass';
    if v_passed<>v_checks then
      return jsonb_build_object('error','every job-plan quality/acceptance check must have explicit PASS evidence before closure','checks_required',v_checks,'checks_passed',v_passed);
    end if;
  end if;
  update restoration_event_work set execution_status='complete',completion_note=trim(p_completion_note),
    completion_quality_evidence=coalesce(p_quality_results,'[]'::jsonb),updated_at=now() where id=ew.id;
  update work_orders set status='completed',actual_hours=p_actual_hours,completed_at=now() where id=w.id;
  insert into learning_events(organization_id,asset_id,event_type,title,detail,model_confidence)
  values(v_org,w.asset_id,'work_completed','Recovery work completed — '||coalesce(w.wo_number,w.id::text),
    trim(p_completion_note)||format(' | actual labour %.2f h; quality checks %s/%s passed.',p_actual_hours,v_passed,v_checks),100);
  return jsonb_build_object('ok',true,'work_order_id',w.id,'quality_checks',v_checks,'quality_passed',v_passed);
end
$$;

grant execute on function public.complete_restoration_work(uuid,numeric,text,jsonb) to authenticated;

create or replace function public.close_restoration_event(p_event_id uuid,p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.app_current_org(); e restoration_events%rowtype; v_saved numeric; v_cost numeric; v_cost_basis text; v_value numeric;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.recovery_role_allowed(array['maintenance_manager','operator','admin','ai_admin']) then return jsonb_build_object('error','closing/returning a restoration event requires operations or maintenance-management authority'); end if;
  if coalesce(length(trim(p_note)),0)<10 then return jsonb_build_object('error','record the return-to-service condition'); end if;
  select * into e from restoration_events where id=p_event_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','event not found'); end if;
  if exists(select 1 from restoration_event_work where organization_id=v_org and event_id=e.id and plan_state='included' and execution_status<>'complete') then
    return jsonb_build_object('error','included event work remains incomplete');
  end if;
  if exists(select 1 from restoration_constraints where organization_id=v_org and event_id=e.id and phase='return_to_service' and is_hard and state<>'satisfied') then
    return jsonb_build_object('error','return-to-service hard constraint remains unresolved');
  end if;
  if exists(select 1 from equipment_releases where organization_id=v_org and asset_id=e.asset_id and status in ('released','returned')) then
    return jsonb_build_object('error','the canonical equipment handover is not accepted back by operations');
  end if;
  update restoration_events set status='closed',actual_return_at=now(),closed_by=auth.uid(),updated_at=now() where id=e.id;
  if e.baseline_return_at is not null then v_saved:=greatest(0,extract(epoch from(e.baseline_return_at-now()))/3600.0); end if;
  select ae.downtime_cost_per_hour_usd,ae.basis into v_cost,v_cost_basis
  from asset_economics ae join assets a on a.id=e.asset_id
  where ae.organization_id=v_org and (ae.asset_id=e.asset_id or (ae.asset_id is null and ae.asset_class=a.asset_class))
  order by(ae.asset_id is not null) desc limit 1;
  if v_saved is not null then
    insert into value_metrics(organization_id,asset_id,metric_type,label,value,unit,status,period)
    values(v_org,e.asset_id,'downtime_avoided','Recovery counterfactual hours recovered — '||e.event_code,
      v_saved,'hours','projected','baseline '||coalesce(e.baseline_method,'unspecified'));
    if v_cost is not null then
      v_value:=v_saved*v_cost;
      insert into value_metrics(organization_id,asset_id,metric_type,label,value,unit,status,period)
      values(v_org,e.asset_id,'avoided_production_loss','Recovery counterfactual downtime value — '||e.event_code,
        v_value,'usd','projected','cost basis: '||coalesce(v_cost_basis,'not recorded'));
    end if;
  end if;
  insert into learning_events(organization_id,asset_id,event_type,title,detail,expected_value,model_confidence)
  values(v_org,e.asset_id,'lesson_learned','Recovery event closed — '||e.event_code,
    trim(p_note)||' Counterfactual value remains projected until human verification.',v_value,100);
  return jsonb_build_object('ok',true,'actual_return_at',now(),'counterfactual_hours_recovered',v_saved,
    'counterfactual_value_usd',v_value,'value_status',case when v_saved is null then 'not_computable' else 'projected_pending_human_verification' end);
end
$$;

grant execute on function public.close_restoration_event(uuid,text) to authenticated;

-- ----------------------------------------------------------------------------
-- Read models: no fake defaults. Missing data stays null/explicit.
-- ----------------------------------------------------------------------------
create or replace function public.get_recovery_board()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare v_org uuid := public.app_current_org();
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  return jsonb_build_object(
    'events',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'event_code',e.event_code,'status',e.status,'event_type',e.event_type,
      'reason',e.reason,'opened_at',e.opened_at,'asset_id',a.id,'asset',a.name,'tag',a.tag,
      'criticality',a.criticality,'forecast_return_at',e.forecast_return_at,
      'baseline_return_at',e.baseline_return_at,'scope_total',(select count(*) from restoration_event_work ew where ew.event_id=e.id),
      'scope_complete',(select count(*) from restoration_event_work ew where ew.event_id=e.id and ew.execution_status='complete'),
      'open_blockers',(select count(*) from restoration_blockers b where b.event_id=e.id and b.status='open'))
      order by e.opened_at) from restoration_events e join assets a on a.id=e.asset_id
      where e.organization_id=v_org and e.status not in ('closed','cancelled')),'[]'::jsonb),
    'unmanaged_down_assets',coalesce((with latest as (
      select distinct on(asset_id) asset_id,state,started_at from operating_states
      where organization_id=v_org order by asset_id,started_at desc)
      select jsonb_agg(jsonb_build_object('asset_id',a.id,'asset',a.name,'tag',a.tag,'state',l.state,'down_since',l.started_at)
        order by l.started_at)
      from latest l join assets a on a.id=l.asset_id
      where l.state in ('down_planned','down_unplanned','offline')
        and not exists(select 1 from restoration_events e where e.organization_id=v_org and e.asset_id=a.id
          and e.status in ('open','planning','approval','released','executing','return_pending'))),'[]'::jsonb));
end
$$;

grant execute on function public.get_recovery_board() to authenticated;

create or replace function public.get_recovery_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare v_org uuid := public.app_current_org(); e restoration_events%rowtype; v_latest restoration_plan_versions%rowtype; v_elapsed numeric; v_dce numeric; v_rhr numeric;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select * into e from restoration_events where id=p_event_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','event not found'); end if;
  select * into v_latest from restoration_plan_versions where organization_id=v_org and event_id=e.id order by version desc limit 1;
  v_elapsed:=extract(epoch from(coalesce(e.actual_return_at,now())-e.opened_at))/3600.0;
  if e.baseline_return_at is not null and e.actual_return_at is not null and v_elapsed>0 then
    v_dce:=(extract(epoch from(e.baseline_return_at-e.opened_at))/3600.0)/v_elapsed;
    v_rhr:=greatest(0,extract(epoch from(e.baseline_return_at-e.actual_return_at))/3600.0);
  end if;
  return jsonb_build_object(
    'event',jsonb_build_object('id',e.id,'event_code',e.event_code,'asset_id',e.asset_id,'site_id',e.site_id,
      'event_type',e.event_type,'reason',e.reason,'status',e.status,'opened_at',e.opened_at,
      'baseline_return_at',e.baseline_return_at,'baseline_method',e.baseline_method,'baseline_basis',e.baseline_basis,
      'baseline_frozen_at',e.baseline_frozen_at,'forecast_return_at',e.forecast_return_at,'actual_return_at',e.actual_return_at),
    'scope',coalesce((select jsonb_agg(jsonb_build_object(
      'event_work_id',ew.id,'work_order_id',w.id,'wo_number',w.wo_number,'title',w.title,'priority',w.priority,
      'disposition',ew.disposition,'plan_state',ew.plan_state,'sequence_no',ew.sequence_no,
      'concurrency_rule',ew.concurrency_rule,'parallel_group',ew.parallel_group,'concurrency_basis',ew.concurrency_basis,
      'execution_status',ew.execution_status,'planned_hours',w.planned_hours,'estimated_hours',w.estimated_hours,
      'job_plan_id',w.job_plan_id,'materials_ready',not exists(select 1 from work_order_materials m where m.work_order_id=w.id and m.status not in ('reserved','kitted','issued','cancelled')),
      'quality_checks',(select count(*) from job_plan_checks c where c.job_plan_id=w.job_plan_id)) order by ew.sequence_no,w.wo_number)
      from restoration_event_work ew join work_orders w on w.id=ew.work_order_id where ew.organization_id=v_org and ew.event_id=e.id),'[]'::jsonb),
    'candidate_work',coalesce((select jsonb_agg(jsonb_build_object('work_order_id',w.id,'wo_number',w.wo_number,'title',w.title,'priority',w.priority,'planned_hours',w.planned_hours,'estimated_hours',w.estimated_hours)
      order by case w.priority when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,w.created_at)
      from work_orders w where w.organization_id=v_org and w.asset_id=e.asset_id and w.completed_at is null
        and not exists(select 1 from restoration_event_work ew where ew.event_id=e.id and ew.work_order_id=w.id)),'[]'::jsonb),
    'constraints',coalesce((select jsonb_agg(row_to_json(c) order by c.phase,c.is_hard desc,c.created_at) from restoration_constraints c where c.organization_id=v_org and c.event_id=e.id),'[]'::jsonb),
    'blockers',coalesce((select jsonb_agg(row_to_json(b) order by (b.status='open') desc,b.started_at desc) from restoration_blockers b where b.organization_id=v_org and b.event_id=e.id),'[]'::jsonb),
    'latest_plan',case when v_latest.id is null then null else row_to_json(v_latest) end,
    'kpis',jsonb_build_object(
      'planned_concurrent_work_ratio_pct',v_latest.planned_concurrent_work_ratio,
      'downtime_conversion_efficiency',v_dce,
      'revenue_hours_recovered',v_rhr,
      'elapsed_hours',round(v_elapsed,2),
      'note','CWR is planned verified-parallel scope ratio. DCE and recovered hours are withheld until actual RTS and a frozen baseline exist.'),
    'controls',jsonb_build_object(
      'unresolved_planning_hard',(select count(*) from restoration_constraints where organization_id=v_org and event_id=e.id and phase='planning' and is_hard and state<>'satisfied'),
      'unresolved_execution_hard',(select count(*) from restoration_constraints where organization_id=v_org and event_id=e.id and phase='execution' and is_hard and state<>'satisfied'),
      'unresolved_rts_hard',(select count(*) from restoration_constraints where organization_id=v_org and event_id=e.id and phase='return_to_service' and is_hard and state<>'satisfied'),
      'unknown_concurrency_items',(select count(*) from restoration_event_work where organization_id=v_org and event_id=e.id and plan_state='included' and concurrency_rule='unknown')));
end
$$;

grant execute on function public.get_recovery_event(uuid) to authenticated;

-- Reach the existing opportunity-maintenance engine through the Recovery
-- product surface without duplicating its ranking/sizing logic.
create or replace function public.get_recovery_opportunities(p_event_id uuid,p_window_hours numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare v_org uuid := public.app_current_org(); v_asset uuid;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select asset_id into v_asset from restoration_events where id=p_event_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','event not found'); end if;
  return public.find_opportunity_work(v_asset,p_window_hours);
end
$$;

grant execute on function public.get_recovery_opportunities(uuid,numeric) to authenticated;

notify pgrst, 'reload schema';