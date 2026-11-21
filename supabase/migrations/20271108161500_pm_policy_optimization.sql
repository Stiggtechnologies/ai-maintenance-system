-- C7.08 Preventive-maintenance optimization.
--
-- Age replacement already exists. This adds block replacement, opportunistic
-- grouping and a multi-component common block over the canonical maintenance
-- programme and component life events. The arithmetic stays in the shared
-- TypeScript kernel (pm-policy/1). The database freezes the exact evidence,
-- refuses a mismatched population, and keeps interval changes behind a
-- different assigned human and the enforced change_pm_interval right.
--
-- A shared access cost is a human-authored fact. It is not inferred from
-- asset economics, and no grouping saving is claimed unless the human also
-- states that each task cost excludes it. Safety-critical, regulatory and
-- unknown applicability are not interval-rewritten here.

create or replace function public.sync_pm_policy_kernel_version()
returns text language sql immutable as $$ select 'pm-policy/1'::text $$;
revoke all on function public.sync_pm_policy_kernel_version() from public, anon;

create table if not exists public.pm_grouping_bases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  version integer not null check (version > 0),
  shared_access_cost_usd numeric not null check (shared_access_cost_usd > 0),
  access_excluded_from_task_costs boolean not null,
  basis text not null check (length(btrim(basis)) between 20 and 2000),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  unique (organization_id, asset_id, version)
);

create table if not exists public.pm_policy_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  grouping_basis_id uuid references public.pm_grouping_bases(id) on delete restrict,
  grouping_basis_version integer,
  kernel_version text not null,
  member_plan_ids uuid[] not null,
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot) = 'object'),
  analysis jsonb not null check (jsonb_typeof(analysis) = 'object'),
  recommendation jsonb not null check (jsonb_typeof(recommendation) = 'object'),
  limitations jsonb not null check (jsonb_typeof(limitations) = 'array'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (
    (grouping_basis_id is null and grouping_basis_version is null)
    or (grouping_basis_id is not null and grouping_basis_version > 0)
  )
);
create index if not exists idx_pm_policy_assessments_asset
  on public.pm_policy_assessments(organization_id, asset_id, created_at desc);

create table if not exists public.pm_policy_review_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_id uuid not null references public.pm_policy_assessments(id) on delete restrict,
  assigned_to uuid not null references auth.users(id),
  due_date date not null,
  assignment_note text not null check (length(btrim(assignment_note)) between 10 and 2000),
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  unique (assessment_id, assigned_to)
);

create table if not exists public.pm_policy_adoptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_id uuid not null unique references public.pm_policy_assessments(id) on delete restrict,
  action text not null check (action in ('record_policy', 'apply_standing_intervals')),
  programme_changed boolean not null,
  applied_plan_ids uuid[] not null default '{}',
  adoption_note text not null check (length(btrim(adoption_note)) between 20 and 4000),
  adopted_by uuid not null references auth.users(id),
  adopted_at timestamptz not null default now()
);

alter table public.pm_grouping_bases enable row level security;
alter table public.pm_policy_assessments enable row level security;
alter table public.pm_policy_review_assignments enable row level security;
alter table public.pm_policy_adoptions enable row level security;

drop policy if exists pm_grouping_bases_read on public.pm_grouping_bases;
create policy pm_grouping_bases_read on public.pm_grouping_bases
  for select to authenticated using (organization_id = public.app_current_org());
drop policy if exists pm_policy_assessments_read on public.pm_policy_assessments;
create policy pm_policy_assessments_read on public.pm_policy_assessments
  for select to authenticated using (organization_id = public.app_current_org());
drop policy if exists pm_policy_review_assignments_read on public.pm_policy_review_assignments;
create policy pm_policy_review_assignments_read on public.pm_policy_review_assignments
  for select to authenticated using (organization_id = public.app_current_org());
drop policy if exists pm_policy_adoptions_read on public.pm_policy_adoptions;
create policy pm_policy_adoptions_read on public.pm_policy_adoptions
  for select to authenticated using (organization_id = public.app_current_org());

revoke insert, update, delete, truncate on public.pm_grouping_bases,
  public.pm_policy_assessments, public.pm_policy_review_assignments, public.pm_policy_adoptions
  from public, anon, authenticated;
grant select on public.pm_grouping_bases, public.pm_policy_assessments,
  public.pm_policy_review_assignments, public.pm_policy_adoptions to authenticated;

create or replace function public.protect_pm_policy_records()
returns trigger language plpgsql security definer set search_path = public as $pm$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'PM policy bases, assessments, reviews and adoptions are append-only';
  end if;
  if coalesce(current_setting('app.pm_policy_record_write', true), '') <> 'granted' then
    raise exception 'PM policy records are written only by governed workflows';
  end if;
  return new;
end
$pm$;
revoke all on function public.protect_pm_policy_records() from public, anon, authenticated;

drop trigger if exists trg_protect_pm_grouping_bases on public.pm_grouping_bases;
create trigger trg_protect_pm_grouping_bases before insert or update or delete
  on public.pm_grouping_bases for each row execute function public.protect_pm_policy_records();
drop trigger if exists trg_protect_pm_policy_assessments on public.pm_policy_assessments;
create trigger trg_protect_pm_policy_assessments before insert or update or delete
  on public.pm_policy_assessments for each row execute function public.protect_pm_policy_records();
drop trigger if exists trg_protect_pm_policy_reviews on public.pm_policy_review_assignments;
create trigger trg_protect_pm_policy_reviews before insert or update or delete
  on public.pm_policy_review_assignments for each row execute function public.protect_pm_policy_records();
drop trigger if exists trg_protect_pm_policy_adoptions on public.pm_policy_adoptions;
create trigger trg_protect_pm_policy_adoptions before insert or update or delete
  on public.pm_policy_adoptions for each row execute function public.protect_pm_policy_records();

create or replace function public.record_pm_grouping_basis(
  p_asset_id uuid,
  p_shared_access_cost_usd numeric,
  p_access_excluded_from_task_costs boolean,
  p_basis text
)
returns jsonb language plpgsql security definer set search_path = public as $pm$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_version integer;
  v_id uuid;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error', 'authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in ('reliability_engineer', 'maintenance_manager', 'admin') then
    return jsonb_build_object('error', 'recording a shared access cost requires a named reliability engineer, maintenance manager or administrator');
  end if;
  if p_shared_access_cost_usd is null or p_shared_access_cost_usd <= 0
     or p_access_excluded_from_task_costs is null
     or coalesce(length(btrim(p_basis)), 0) < 20 then
    return jsonb_build_object('error', 'record a positive shared access cost, an explicit statement of whether task costs exclude it, and at least 20 characters of provenance');
  end if;
  perform 1 from public.assets
  where id = p_asset_id and organization_id = v_org for update;
  if not found then
    return jsonb_build_object('error', 'asset not found');
  end if;
  select coalesce(max(version), 0) + 1 into v_version
  from public.pm_grouping_bases
  where organization_id = v_org and asset_id = p_asset_id;
  perform set_config('app.pm_policy_record_write', 'granted', true);
  insert into public.pm_grouping_bases(
    organization_id, asset_id, version, shared_access_cost_usd,
    access_excluded_from_task_costs, basis, recorded_by
  ) values (
    v_org, p_asset_id, v_version, p_shared_access_cost_usd,
    p_access_excluded_from_task_costs, btrim(p_basis), auth.uid()
  ) returning id into v_id;
  perform set_config('app.pm_policy_record_write', '', true);
  insert into public.audit_events(organization_id, entity_type, actor, event_data)
  values (v_org, 'pm_grouping_basis', v_role, jsonb_build_object(
    'action', 'recorded', 'basis_id', v_id, 'asset_id', p_asset_id,
    'version', v_version, 'shared_access_cost_usd', p_shared_access_cost_usd,
    'access_excluded_from_task_costs', p_access_excluded_from_task_costs,
    'recorded_by', auth.uid()
  ));
  return jsonb_build_object('id', v_id, 'assetId', p_asset_id, 'version', v_version);
end
$pm$;
revoke all on function public.record_pm_grouping_basis(uuid, numeric, boolean, text)
  from public, anon;
grant execute on function public.record_pm_grouping_basis(uuid, numeric, boolean, text)
  to authenticated;

create or replace function public.get_pm_policy_source(
  p_organization_id uuid, p_actor_id uuid, p_asset_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = public as $pm$
declare
  v_role text;
  a public.assets%rowtype;
  v_basis jsonb;
  v_components jsonb;
begin
  select role into v_role from public.user_profiles
  where id = p_actor_id and organization_id = p_organization_id;
  if coalesce(v_role, '') not in ('reliability_engineer', 'maintenance_manager', 'admin') then
    return jsonb_build_object('error', 'the controlled PM-policy calculation requires a named same-tenant reliability engineer, maintenance manager or administrator');
  end if;
  select * into a from public.assets
  where id = p_asset_id and organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('error', 'asset not found');
  end if;
  if not exists (
    select 1 from public.maintenance_plans p
    where p.organization_id = p_organization_id and p.asset_id = a.id
  ) then
    return jsonb_build_object('error', 'this asset has no maintenance plans');
  end if;
  if exists (
    select 1 from public.maintenance_plans p
    where p.organization_id = p_organization_id and p.asset_id = a.id
      and nullif(btrim(p.component_scope), '') is not null
    group by lower(btrim(p.component_scope))
    having count(*) > 1
  ) then
    return jsonb_build_object('error', 'two maintenance plans on this asset share a component scope, so one life population would be counted twice');
  end if;

  select jsonb_build_object(
    'id', b.id, 'version', b.version,
    'sharedAccessCostUsd', b.shared_access_cost_usd,
    'accessExcludedFromTaskCosts', b.access_excluded_from_task_costs,
    'basis', b.basis
  ) into v_basis
  from public.pm_grouping_bases b
  where b.organization_id = p_organization_id and b.asset_id = a.id
  order by b.version desc
  limit 1;

  select coalesce(jsonb_agg(row_component order by row_component->>'label'), '[]'::jsonb)
  into v_components
  from (
    select jsonb_build_object(
      'planId', p.id,
      'planVersion', p.version,
      'label', p.task_label,
      'componentScope', p.component_scope,
      'plannedItemCost', p.planned_task_cost_usd,
      'failureCost', p.failure_consequence_cost_usd,
      'costBasis', p.cost_basis,
      'safetyCritical', p.safety_critical,
      'regulatoryRequired', p.regulatory_required,
      'intervalBasis', p.interval_basis,
      'intervalValue', p.interval_value,
      'ageHours', case
        when inst.installed_count = 1
         and inst.installed_hours is not null
         and meter.meter is not null
         and meter.meter >= inst.installed_hours
        then meter.meter - inst.installed_hours
        else null
      end,
      'failureHours', coalesce((
        select jsonb_agg(e.hours_at_change_out order by e.hours_at_change_out)
        from public.component_life_events e
        where e.organization_id = p_organization_id
          and nullif(btrim(p.component_scope), '') is not null
          and lower(e.component) = lower(btrim(p.component_scope))
          and e.event_kind = 'failure' and e.hours_at_change_out > 0
      ), '[]'::jsonb),
      'censoredHours', coalesce((
        select jsonb_agg(e.hours_at_change_out order by e.hours_at_change_out)
        from public.component_life_events e
        where e.organization_id = p_organization_id
          and nullif(btrim(p.component_scope), '') is not null
          and lower(e.component) = lower(btrim(p.component_scope))
          and e.event_kind = 'scheduled' and e.hours_at_change_out > 0
      ), '[]'::jsonb),
      'eventIds', coalesce((
        select jsonb_agg(e.id order by e.id)
        from public.component_life_events e
        where e.organization_id = p_organization_id
          and nullif(btrim(p.component_scope), '') is not null
          and lower(e.component) = lower(btrim(p.component_scope))
      ), '[]'::jsonb)
    ) as row_component
    from public.maintenance_plans p
    left join lateral (
      select m.value as meter
      from public.asset_meter_readings m
      where m.organization_id = p_organization_id and m.asset_id = a.id
        and m.meter_kind = 'operating_hours'
      order by m.recorded_at desc
      limit 1
    ) meter on true
    left join lateral (
      select count(*)::integer as installed_count,
             min(i.installed_meter_hours) as installed_hours
      from public.component_instances i
      where i.organization_id = p_organization_id and i.asset_id = a.id
        and i.state = 'installed'
        and nullif(btrim(p.component_scope), '') is not null
        and lower(i.component) = lower(btrim(p.component_scope))
    ) inst on true
    where p.organization_id = p_organization_id and p.asset_id = a.id
  ) components;

  return jsonb_build_object(
    'kernelVersion', public.sync_pm_policy_kernel_version(),
    'asset', jsonb_build_object(
      'id', a.id, 'name', a.name, 'tag', coalesce(a.tag, a.asset_tag)
    ),
    'groupingBasis', coalesce(v_basis, 'null'::jsonb),
    'components', v_components
  );
end
$pm$;
revoke all on function public.get_pm_policy_source(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_pm_policy_source(uuid, uuid, uuid) to service_role;

create or replace function public.record_pm_policy_assessment(
  p_organization_id uuid,
  p_actor_id uuid,
  p_asset_id uuid,
  p_grouping_basis_id uuid,
  p_grouping_basis_version integer,
  p_kernel_version text,
  p_result jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $pm$
declare
  v_role text;
  v_source jsonb;
  v_basis jsonb;
  v_src jsonb;
  v_res jsonb;
  v_failures integer;
  v_suspensions integer;
  v_distinct integer;
  v_expected text;
  v_expected_ids bigint[];
  v_claimed bigint[];
  v_claimed_raw bigint;
  v_assessment uuid;
  v_plan_ids uuid[];
  v_beta numeric;
  v_member_count integer;
begin
  select role into v_role from public.user_profiles
  where id = p_actor_id and organization_id = p_organization_id;
  if coalesce(v_role, '') not in ('reliability_engineer', 'maintenance_manager', 'admin') then
    return jsonb_build_object('error', 'recording a PM policy assessment requires a named same-tenant reliability engineer, maintenance manager or administrator');
  end if;
  if p_kernel_version is distinct from public.sync_pm_policy_kernel_version()
     or coalesce(p_result->>'kernelVersion', '') is distinct from public.sync_pm_policy_kernel_version() then
    return jsonb_build_object('error', 'the PM policy kernel version is not the server-pinned version');
  end if;
  if jsonb_typeof(coalesce(p_result, 'null'::jsonb)) <> 'object'
     or jsonb_typeof(p_result->'components') <> 'array'
     or jsonb_typeof(p_result->'refusals') <> 'array'
     or jsonb_typeof(p_result->'limitations') <> 'array'
     or jsonb_typeof(p_result->'recommendation') <> 'object'
     or jsonb_typeof(p_result->'commonBlock') <> 'object'
     or jsonb_typeof(p_result->'opportunistic') <> 'object' then
    return jsonb_build_object('error', 'PM policy result is incomplete');
  end if;
  if (p_result->>'advisory')::boolean is distinct from true
     or (p_result->>'mayChangePmInterval')::boolean is distinct from false
     or (p_result->>'mayCreateWork')::boolean is distinct from false
     or (p_result->>'mayAcceptRisk')::boolean is distinct from false
     or (p_result->>'mayCommitSpend')::boolean is distinct from false
     or (p_result->>'mayReturnToService')::boolean is distinct from false
     or (p_result->'recommendation'->>'humanApprovalRequired')::boolean is distinct from true then
    return jsonb_build_object('error', 'PM policy result claimed an authority it does not have');
  end if;
  if coalesce(p_result->>'selected', '') not in ('common_block', 'separate_age', 'evidence_gap')
     or p_result->'recommendation'->>'kind' is distinct from p_result->>'selected' then
    return jsonb_build_object('error', 'PM policy selection is not recognized');
  end if;
  if p_result->>'selected' = 'common_block'
     and (p_result->'commonBlock'->>'recommended')::boolean is distinct from true then
    return jsonb_build_object('error', 'a selected common block must be the recommended common block');
  end if;
  if p_result->>'selected' <> 'common_block'
     and coalesce((p_result->'commonBlock'->>'recommended')::boolean, false) then
    return jsonb_build_object('error', 'an unselected common block cannot be marked recommended');
  end if;

  v_source := public.get_pm_policy_source(p_organization_id, p_actor_id, p_asset_id);
  if v_source ? 'error' then return v_source; end if;
  if (select count(*) from jsonb_array_elements(v_source->'components'))
     is distinct from (select count(*) from jsonb_array_elements(p_result->'components')) then
    return jsonb_build_object('error', 'PM policy result does not cover the exact maintenance-plan population');
  end if;

  v_basis := v_source->'groupingBasis';
  if jsonb_typeof(v_basis) = 'null' then
    if p_grouping_basis_id is not null or p_grouping_basis_version is not null then
      return jsonb_build_object('error', 'grouping basis does not match the current tenant record');
    end if;
    if coalesce((p_result->'opportunistic'->>'applicable')::boolean, false) then
      return jsonb_build_object('error', 'opportunistic grouping cannot apply without a recorded shared access cost');
    end if;
  else
    if (v_basis->>'id')::uuid is distinct from p_grouping_basis_id
       or (v_basis->>'version')::integer is distinct from p_grouping_basis_version then
      return jsonb_build_object('error', 'grouping basis changed; run the calculation again');
    end if;
    if (v_basis->>'accessExcludedFromTaskCosts')::boolean is distinct from true
       and coalesce((p_result->'opportunistic'->>'applicable')::boolean, false) then
      return jsonb_build_object('error', 'opportunistic grouping requires the human statement that task costs exclude the shared access cost');
    end if;
  end if;

  for v_src in select value from jsonb_array_elements(v_source->'components') loop
    select count(*) into v_claimed_raw
    from jsonb_array_elements(p_result->'components') item
    where item.value->>'key' = v_src->>'planId';
    if v_claimed_raw <> 1 then
      return jsonb_build_object('error', 'each maintenance plan must appear once in the PM policy result');
    end if;
    select item.value into v_res
    from jsonb_array_elements(p_result->'components') item
    where item.value->>'key' = v_src->>'planId';

    v_failures := coalesce(jsonb_array_length(v_src->'failureHours'), 0);
    v_suspensions := coalesce(jsonb_array_length(v_src->'censoredHours'), 0);
    select count(distinct (value #>> '{}')::numeric) into v_distinct
    from jsonb_array_elements(coalesce(v_src->'failureHours', '[]'::jsonb));
    v_expected := case
      when v_failures < 2 or v_distinct < 2 then 'none'
      when v_suspensions > 0 then 'mle_censored'
      when v_failures < 15 then 'rank_regression'
      else 'mle'
    end;
    if v_res->>'method' is distinct from v_expected
       or coalesce((v_res->>'failures')::integer, -1) is distinct from v_failures
       or coalesce((v_res->>'suspensions')::integer, -1) is distinct from v_suspensions
       or coalesce((v_res->>'planVersion')::integer, -1) is distinct from (v_src->>'planVersion')::integer then
      return jsonb_build_object('error', 'method selection or plan version does not match the server-owned life-event classification');
    end if;

    select coalesce(array_agg((value #>> '{}')::bigint order by (value #>> '{}')::bigint), '{}')
      into v_expected_ids
    from jsonb_array_elements(coalesce(v_src->'eventIds', '[]'::jsonb));
    select coalesce(array_agg(distinct (value #>> '{}')::bigint order by (value #>> '{}')::bigint), '{}'),
           count(*)
      into v_claimed, v_claimed_raw
    from jsonb_array_elements(coalesce(v_res->'eventIds', '[]'::jsonb));
    if v_expected_ids is distinct from v_claimed or cardinality(v_expected_ids) is distinct from v_claimed_raw then
      return jsonb_build_object('error', 'source event set changed or does not match the complete same-tenant component population');
    end if;

    if (v_src->>'plannedItemCost') is null then
      if (v_res->>'plannedItemCost') is not null then
        return jsonb_build_object('error', 'planned task cost does not match the maintenance plan');
      end if;
    elsif (v_res->>'plannedItemCost') is null
       or abs((v_res->>'plannedItemCost')::numeric - (v_src->>'plannedItemCost')::numeric) > 0.000001 then
      return jsonb_build_object('error', 'planned task cost does not match the maintenance plan');
    end if;
    if (v_src->>'failureCost') is null then
      if (v_res->>'failureCost') is not null then
        return jsonb_build_object('error', 'failure consequence cost does not match the maintenance plan');
      end if;
    elsif (v_res->>'failureCost') is null
       or abs((v_res->>'failureCost')::numeric - (v_src->>'failureCost')::numeric) > 0.000001 then
      return jsonb_build_object('error', 'failure consequence cost does not match the maintenance plan');
    end if;

    v_beta := nullif(v_res->>'beta', '')::numeric;
    if v_res->>'method' = 'none'
       or (v_beta is not null and v_beta <= 1) then
      if nullif(v_res->>'standingIntervalHours', '') is not null
         or coalesce((v_res->>'applyInterval')::boolean, false)
         or coalesce((v_res->'blockReplacement'->>'recommended')::boolean, false) then
        return jsonb_build_object('error', 'a non-identifiable or non-increasing failure rate cannot carry a preventive interval');
      end if;
    end if;
    if coalesce((v_res->>'applyInterval')::boolean, false) then
      if (v_src->>'safetyCritical') is distinct from 'false'
         or (v_src->>'regulatoryRequired') is distinct from 'false'
         or coalesce((v_src->>'plannedItemCost')::numeric, 0) <= 0
         or coalesce((v_src->>'failureCost')::numeric, 0) <= 0
         or coalesce(length(btrim(v_src->>'costBasis')), 0) < 20
         or coalesce((v_res->>'standingIntervalHours')::numeric, 0) <= 0 then
        return jsonb_build_object('error', 'an interval write requires explicit non-safety, non-regulatory context, recorded costs and a positive standing interval');
      end if;
      if p_result->>'selected' = 'common_block'
         and (
           coalesce((v_res->>'standingIntervalHours')::numeric, -1)
             is distinct from (p_result->'commonBlock'->>'intervalHours')::numeric
           or not exists (
             select 1 from jsonb_array_elements_text(p_result->'commonBlock'->'memberKeys') member
             where member = v_res->>'key'
           )
         ) then
        return jsonb_build_object('error', 'a common-block interval does not match the standing interval of every included plan');
      end if;
    end if;
  end loop;

  if p_result->>'selected' = 'common_block' then
    select count(*) into v_member_count
    from jsonb_array_elements_text(p_result->'commonBlock'->'memberKeys');
    if v_member_count < 2 or coalesce((p_result->'commonBlock'->>'intervalHours')::numeric, 0) <= 0 then
      return jsonb_build_object('error', 'a common block requires two members and a positive interval');
    end if;
  end if;
  if p_result->>'selected' = 'evidence_gap'
     and exists (
       select 1 from jsonb_array_elements(p_result->'components') item
       where coalesce((item.value->>'applyInterval')::boolean, false)
     ) then
    return jsonb_build_object('error', 'an evidence gap cannot carry an interval to apply');
  end if;

  select coalesce(array_agg((value->>'planId')::uuid order by value->>'planId'), '{}')
    into v_plan_ids
  from jsonb_array_elements(v_source->'components');

  perform set_config('app.pm_policy_record_write', 'granted', true);
  insert into public.pm_policy_assessments(
    organization_id, asset_id, grouping_basis_id, grouping_basis_version,
    kernel_version, member_plan_ids, source_snapshot, analysis, recommendation,
    limitations, created_by
  ) values (
    p_organization_id, p_asset_id, p_grouping_basis_id, p_grouping_basis_version,
    p_kernel_version, v_plan_ids, v_source,
    p_result || jsonb_build_object(
      'advisory', true, 'mayChangePmInterval', false, 'mayCreateWork', false,
      'mayAcceptRisk', false, 'mayCommitSpend', false, 'mayReturnToService', false
    ),
    p_result->'recommendation', p_result->'limitations', p_actor_id
  ) returning id into v_assessment;
  perform set_config('app.pm_policy_record_write', '', true);
  insert into public.audit_events(organization_id, entity_type, actor, event_data)
  values (p_organization_id, 'pm_policy_assessment', v_role, jsonb_build_object(
    'action', 'generated', 'assessment_id', v_assessment, 'asset_id', p_asset_id,
    'kernel_version', p_kernel_version, 'selected', p_result->>'selected',
    'grouping_basis_id', p_grouping_basis_id, 'requested_by', p_actor_id,
    'advisory', true, 'may_change_pm_interval', false
  ));
  return jsonb_build_object(
    'assessment_id', v_assessment, 'asset_id', p_asset_id,
    'kernel_version', p_kernel_version, 'analysis', p_result,
    'advisory', true, 'may_change_pm_interval', false, 'may_create_work', false,
    'may_accept_risk', false, 'may_commit_spend', false, 'may_return_to_service', false
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('error', 'PM policy result contains an invalid numeric value');
end
$pm$;
revoke all on function public.record_pm_policy_assessment(uuid, uuid, uuid, uuid, integer, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_pm_policy_assessment(uuid, uuid, uuid, uuid, integer, text, jsonb)
  to service_role;

create or replace function public.get_pm_policy_workspace()
returns jsonb language sql stable security definer set search_path = public as $pm$
  select jsonb_build_object(
    'assets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'tag', coalesce(a.tag, a.asset_tag),
        'groupingBasis', (
          select jsonb_build_object(
            'id', b.id, 'version', b.version,
            'sharedAccessCostUsd', b.shared_access_cost_usd,
            'accessExcludedFromTaskCosts', b.access_excluded_from_task_costs,
            'basis', b.basis, 'recordedAt', b.recorded_at
          )
          from public.pm_grouping_bases b
          where b.organization_id = public.app_current_org() and b.asset_id = a.id
          order by b.version desc limit 1
        ),
        'plans', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'taskLabel', p.task_label, 'componentScope', p.component_scope,
            'version', p.version, 'plannedItemCost', p.planned_task_cost_usd,
            'failureCost', p.failure_consequence_cost_usd, 'costBasis', p.cost_basis,
            'safetyCritical', p.safety_critical, 'regulatoryRequired', p.regulatory_required,
            'intervalBasis', p.interval_basis, 'intervalValue', p.interval_value,
            'failureEvents', (
              select count(*) from public.component_life_events e
              where e.organization_id = public.app_current_org()
                and nullif(btrim(p.component_scope), '') is not null
                and lower(e.component) = lower(btrim(p.component_scope))
                and e.event_kind = 'failure'
            ),
            'suspensionEvents', (
              select count(*) from public.component_life_events e
              where e.organization_id = public.app_current_org()
                and nullif(btrim(p.component_scope), '') is not null
                and lower(e.component) = lower(btrim(p.component_scope))
                and e.event_kind = 'scheduled'
            )
          ) order by p.task_label)
          from public.maintenance_plans p
          where p.organization_id = public.app_current_org() and p.asset_id = a.id
        ), '[]'::jsonb)
      ) order by a.name)
      from public.assets a
      where a.organization_id = public.app_current_org()
        and exists (
          select 1 from public.maintenance_plans p
          where p.organization_id = a.organization_id and p.asset_id = a.id
        )
    ), '[]'::jsonb),
    'assessments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'assetId', s.asset_id, 'assetName', a.name,
        'kernelVersion', s.kernel_version, 'selected', s.analysis->>'selected',
        'analysis', s.analysis, 'recommendation', s.recommendation,
        'limitations', s.limitations, 'createdBy', s.created_by, 'createdAt', s.created_at,
        'groupingBasisId', s.grouping_basis_id, 'groupingBasisVersion', s.grouping_basis_version,
        'assignments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', r.id, 'assignedTo', r.assigned_to, 'reviewerName', u.full_name,
            'reviewerEmail', u.email, 'dueDate', r.due_date, 'note', r.assignment_note,
            'assignedAt', r.assigned_at
          ) order by r.assigned_at)
          from public.pm_policy_review_assignments r
          left join public.user_profiles u on u.id = r.assigned_to
          where r.assessment_id = s.id
        ), '[]'::jsonb),
        'adoption', (
          select jsonb_build_object(
            'action', d.action, 'programmeChanged', d.programme_changed,
            'appliedPlanIds', d.applied_plan_ids, 'note', d.adoption_note,
            'adoptedBy', d.adopted_by, 'adoptedAt', d.adopted_at
          )
          from public.pm_policy_adoptions d where d.assessment_id = s.id
        )
      ) order by s.created_at desc)
      from (
        select * from public.pm_policy_assessments
        where organization_id = public.app_current_org()
        order by created_at desc limit 12
      ) s
      join public.assets a on a.id = s.asset_id
    ), '[]'::jsonb),
    'reviewers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id, 'name', u.full_name, 'email', u.email, 'role', u.role
      ) order by coalesce(u.full_name, u.email))
      from public.user_profiles u
      where u.organization_id = public.app_current_org()
        and u.role in ('reliability_engineer', 'admin')
    ), '[]'::jsonb),
    'basis', 'Block replacement, opportunistic thresholds and multi-component common blocks are calculated from canonical component life events and human-authored maintenance-plan costs. A shared access saving is used only when a named human recorded it and stated that task costs exclude it. Adoption by a different assigned reliability engineer or administrator is required before any interval can change, and safety-critical or unknown applicability is not rewritten.'
  );
$pm$;
revoke all on function public.get_pm_policy_workspace() from public, anon;
grant execute on function public.get_pm_policy_workspace() to authenticated;

create or replace function public.assign_pm_policy_review(
  p_assessment_id uuid, p_assigned_to uuid, p_due_date date, p_note text
)
returns jsonb language plpgsql security definer set search_path = public as $pm$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_reviewer_role text;
  s public.pm_policy_assessments%rowtype;
  v_id uuid;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error', 'authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in ('reliability_engineer', 'maintenance_manager', 'admin') then
    return jsonb_build_object('error', 'assigning PM policy review requires a named reliability engineer, maintenance manager or administrator');
  end if;
  select * into s from public.pm_policy_assessments
  where id = p_assessment_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'PM policy assessment not found');
  end if;
  select role into v_reviewer_role from public.user_profiles
  where id = p_assigned_to and organization_id = v_org;
  if coalesce(v_reviewer_role, '') not in ('reliability_engineer', 'admin') then
    return jsonb_build_object('error', 'review must be assigned to a named reliability engineer or administrator in this organization');
  end if;
  if p_assigned_to = s.created_by then
    return jsonb_build_object('error', 'segregation of duties requires a reviewer other than the person who requested the assessment');
  end if;
  if p_due_date is null or p_due_date < current_date
     or coalesce(length(btrim(p_note)), 0) < 10 then
    return jsonb_build_object('error', 'record a current or future due date and a review note of at least 10 characters');
  end if;
  perform set_config('app.pm_policy_record_write', 'granted', true);
  insert into public.pm_policy_review_assignments(
    organization_id, assessment_id, assigned_to, due_date, assignment_note, assigned_by
  ) values (v_org, s.id, p_assigned_to, p_due_date, btrim(p_note), auth.uid())
  returning id into v_id;
  perform set_config('app.pm_policy_record_write', '', true);
  insert into public.audit_events(organization_id, entity_type, actor, event_data)
  values (v_org, 'pm_policy_review', v_role, jsonb_build_object(
    'action', 'assigned', 'assignment_id', v_id, 'assessment_id', s.id,
    'assigned_to', p_assigned_to, 'assigned_by', auth.uid(), 'due_date', p_due_date
  ));
  return jsonb_build_object(
    'assignmentId', v_id, 'assessmentId', s.id, 'assignedTo', p_assigned_to, 'dueDate', p_due_date
  );
exception when unique_violation then
  return jsonb_build_object('error', 'this reviewer is already assigned to the assessment');
end
$pm$;
revoke all on function public.assign_pm_policy_review(uuid, uuid, date, text) from public, anon;
grant execute on function public.assign_pm_policy_review(uuid, uuid, date, text) to authenticated;

create or replace function public.adopt_pm_policy_assessment(
  p_assessment_id uuid, p_action text, p_note text
)
returns jsonb language plpgsql security definer set search_path = public as $pm$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  s public.pm_policy_assessments%rowtype;
  p public.maintenance_plans%rowtype;
  v_component jsonb;
  v_applied uuid[] := '{}';
  v_adoption uuid;
  v_hours numeric;
  v_pending uuid[] := '{}';
  v_pending_hours numeric[] := '{}';
  i integer;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error', 'authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in ('reliability_engineer', 'admin') then
    return jsonb_build_object('error', 'adopting a PM policy requires a named reliability engineer or administrator');
  end if;
  if p_action not in ('record_policy', 'apply_standing_intervals') then
    return jsonb_build_object('error', 'action must be record_policy or apply_standing_intervals');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 20 then
    return jsonb_build_object('error', 'record an adoption note of at least 20 characters');
  end if;
  if not exists (
    select 1 from public.decision_rights d
    where d.right_key = 'change_pm_interval' and d.tier = 'approval'
      and d.enforcement = 'enforced' and d.required_authority = 'reliability_engineer'
  ) then
    return jsonb_build_object('error', 'the change_pm_interval decision right is not enforced as configured');
  end if;
  select * into s from public.pm_policy_assessments
  where id = p_assessment_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'PM policy assessment not found');
  end if;
  if s.created_by = auth.uid() then
    return jsonb_build_object('error', 'segregation of duties requires adoption by a named human other than the assessment requester');
  end if;
  if not exists (
    select 1 from public.pm_policy_review_assignments r
    where r.assessment_id = s.id and r.organization_id = v_org and r.assigned_to = auth.uid()
  ) then
    return jsonb_build_object('error', 'this named human is not assigned to review the assessment');
  end if;
  if exists (select 1 from public.pm_policy_adoptions d where d.assessment_id = s.id) then
    return jsonb_build_object('error', 'this assessment already has an adoption');
  end if;
  perform 1 from public.assets a
  where a.id = s.asset_id and a.organization_id = v_org for update;
  if not found then
    return jsonb_build_object('error', 'asset not found');
  end if;

  if p_action = 'apply_standing_intervals' then
    if coalesce(s.analysis->>'selected', '') = 'evidence_gap' then
      return jsonb_build_object('error', 'an evidence gap has no standing interval to apply');
    end if;
    for v_component in
      select value from jsonb_array_elements(s.analysis->'components')
      where coalesce((value->>'applyInterval')::boolean, false)
    loop
      select * into p from public.maintenance_plans
      where id = (v_component->>'key')::uuid and organization_id = v_org
      for update;
      if not found then
        return jsonb_build_object('error', 'maintenance plan not found');
      end if;
      if p.asset_id is distinct from s.asset_id or p.version is distinct from (v_component->>'planVersion')::integer then
        return jsonb_build_object('error', 'maintenance plan changed after assessment; run a new assessment against the current version');
      end if;
      if p.safety_critical is distinct from false or p.regulatory_required is distinct from false then
        return jsonb_build_object('error', 'standing intervals are not applied when safety or regulatory applicability is true or unknown');
      end if;
      v_hours := (v_component->>'standingIntervalHours')::numeric;
      if coalesce(v_hours, 0) <= 0 then
        return jsonb_build_object('error', 'assessment carries no positive standing interval to apply');
      end if;
      if s.analysis->>'selected' = 'common_block'
         and v_hours is distinct from (s.analysis->'commonBlock'->>'intervalHours')::numeric then
        return jsonb_build_object('error', 'the standing interval no longer matches the adopted common block');
      end if;
      v_pending := v_pending || p.id;
      v_pending_hours := v_pending_hours || v_hours;
    end loop;
    if cardinality(v_pending) = 0 then
      return jsonb_build_object('error', 'no standing interval is eligible to apply; record the policy without changing the programme');
    end if;
    for i in 1..cardinality(v_pending) loop
      update public.maintenance_plans set
        interval_basis = 'run_hours',
        interval_value = v_pending_hours[i],
        version = version + 1,
        updated_at = now(),
        source = format('Human-approved PM policy %s: %s', s.id, btrim(p_note)),
        engineering_context_updated_by = auth.uid()
      where id = v_pending[i] and organization_id = v_org;
      v_applied := v_applied || v_pending[i];
    end loop;
  end if;

  perform set_config('app.pm_policy_record_write', 'granted', true);
  insert into public.pm_policy_adoptions(
    organization_id, assessment_id, action, programme_changed, applied_plan_ids,
    adoption_note, adopted_by
  ) values (
    v_org, s.id, p_action, cardinality(v_applied) > 0, v_applied, btrim(p_note), auth.uid()
  ) returning id into v_adoption;
  perform set_config('app.pm_policy_record_write', '', true);
  insert into public.audit_events(organization_id, entity_type, actor, event_data)
  values (v_org, 'pm_policy_adoption', v_role, jsonb_build_object(
    'action', p_action, 'assessment_id', s.id, 'asset_id', s.asset_id,
    'programme_changed', cardinality(v_applied) > 0, 'applied_plan_ids', v_applied,
    'adoption_id', v_adoption, 'adopted_by', auth.uid(),
    'decision_right', 'change_pm_interval', 'note', btrim(p_note)
  ));
  return jsonb_build_object(
    'assessmentId', s.id, 'action', p_action,
    'programmeChanged', cardinality(v_applied) > 0,
    'appliedPlanIds', v_applied, 'adoptionId', v_adoption,
    'authority', 'Named-human adoption recorded. Work creation, risk acceptance, expenditure, operating limits and return-to-service remain separate authorities.'
  );
exception when unique_violation then
  return jsonb_build_object('error', 'this assessment already has an adoption');
when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('error', 'assessment contains an invalid interval value');
end
$pm$;
revoke all on function public.adopt_pm_policy_assessment(uuid, text, text) from public, anon;
grant execute on function public.adopt_pm_policy_assessment(uuid, text, text) to authenticated;

comment on table public.pm_policy_assessments is
  'C7.08 immutable block, opportunistic and multi-component PM policy assessments. Advisory until a different assigned human adopts them.';
comment on table public.pm_grouping_bases is
  'C7.08 human-authored shared access cost for one asset. Append-only versions; not inferred.';
comment on function public.adopt_pm_policy_assessment(uuid, text, text) is
  'C7.08 named-human adoption. Interval rewrite requires change_pm_interval, segregation of duties, and explicitly non-safety context.';

notify pgrst, 'reload schema';
