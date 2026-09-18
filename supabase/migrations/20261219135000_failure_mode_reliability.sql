-- C6.17 — MTBF and event rate by human-coded failure mechanism.
-- Exposure is recorded RUNNING time, never assumed calendar time. Overlapping
-- state intervals are unioned so duplicate source rows cannot inflate it.

create table if not exists public.asset_failure_mechanism_scopes(
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  failure_mechanism_id uuid not null references public.damage_mechanisms(id) on delete cascade,
  applicable boolean not null,
  basis text not null check(length(btrim(basis))>=20),
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  unique(organization_id,asset_id,failure_mechanism_id)
);
create index if not exists idx_asset_failure_mechanism_scopes_metric
  on public.asset_failure_mechanism_scopes(organization_id,failure_mechanism_id,asset_id)
  where applicable;
alter table public.asset_failure_mechanism_scopes enable row level security;
drop policy if exists asset_failure_mechanism_scopes_read on public.asset_failure_mechanism_scopes;
create policy asset_failure_mechanism_scopes_read on public.asset_failure_mechanism_scopes
  for select to authenticated using(organization_id=public.app_current_org());
revoke insert,update,delete,truncate on public.asset_failure_mechanism_scopes from anon,authenticated;
grant select on public.asset_failure_mechanism_scopes to authenticated;

create or replace function public.record_asset_failure_mechanism_scope(
  p_asset_id uuid,p_mechanism_key text,p_applicable boolean,
  p_basis text,p_evidence_item_id uuid
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; v_mechanism_id uuid; v_id bigint;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if v_role is null or v_role not in ('reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error','asset–mechanism scope requires reliability or maintenance authority');
  end if;
  if coalesce(length(btrim(p_basis)),0)<20 then
    return jsonb_build_object('error','record at least 20 characters of applicability basis');
  end if;
  if not exists(select 1 from public.assets where id=p_asset_id and organization_id=v_org) then
    return jsonb_build_object('error','asset not found in this organization');
  end if;
  select id into v_mechanism_id from public.damage_mechanisms
  where mechanism_key=p_mechanism_key and organization_id=v_org;
  if v_mechanism_id is null then return jsonb_build_object('error','failure mechanism not found in this organization'); end if;
  if not exists(select 1 from public.evidence_items where id=p_evidence_item_id and organization_id=v_org) then
    return jsonb_build_object('error','canonical evidence not found in this organization');
  end if;
  insert into public.asset_failure_mechanism_scopes(
    organization_id,asset_id,failure_mechanism_id,applicable,basis,
    evidence_item_id,approved_by,approved_at)
  values(v_org,p_asset_id,v_mechanism_id,p_applicable,btrim(p_basis),
    p_evidence_item_id,auth.uid(),now())
  on conflict(organization_id,asset_id,failure_mechanism_id) do update set
    applicable=excluded.applicable,basis=excluded.basis,
    evidence_item_id=excluded.evidence_item_id,approved_by=excluded.approved_by,
    approved_at=excluded.approved_at
  returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'asset_failure_mechanism_scope',v_role,jsonb_build_object(
    'scopeId',v_id,'assetId',p_asset_id,'mechanismKey',p_mechanism_key,
    'applicable',p_applicable,'evidenceItemId',p_evidence_item_id,
    'approvedBy',auth.uid(),'basis',btrim(p_basis)));
  return jsonb_build_object('scopeId',v_id,'applicable',p_applicable,
    'approvedBy',auth.uid(),'approvedAt',now());
end $$;
revoke all on function public.record_asset_failure_mechanism_scope(uuid,text,boolean,text,uuid) from public,anon;
grant execute on function public.record_asset_failure_mechanism_scope(uuid,text,boolean,text,uuid) to authenticated;

create or replace function public.get_failure_mode_scope_options()
returns jsonb language sql stable security definer set search_path=public as $$
  select case when public.app_current_org() is null then jsonb_build_object('error','forbidden')
  else jsonb_build_object(
    'assets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'tag',a.tag,'name',a.name) order by a.tag)
      from (select * from public.assets where organization_id=public.app_current_org() order by tag limit 100) a),'[]'::jsonb),
    'mechanisms',coalesce((select jsonb_agg(jsonb_build_object('key',m.mechanism_key,'name',m.name) order by m.name)
      from (select * from public.damage_mechanisms where organization_id=public.app_current_org() order by name limit 100) m),'[]'::jsonb),
    'evidence',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'description',e.description,'sourceSystem',e.source_system) order by e.created_at desc)
      from (select * from public.evidence_items where organization_id=public.app_current_org() order by created_at desc limit 100) e),'[]'::jsonb),
    'boundedAt',100)
  end
$$;
revoke all on function public.get_failure_mode_scope_options() from public,anon;
grant execute on function public.get_failure_mode_scope_options() to authenticated;

create or replace function public.get_failure_mode_reliability(
  p_reporting_days int default 365,
  p_min_failures int default 2
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_days int := least(greatest(coalesce(p_reporting_days, 365), 30), 3650);
  v_min int := least(greatest(coalesce(p_min_failures, 2), 1), 100);
  v_to timestamptz;
  v_from timestamptz;
  v_rows jsonb;
  v_uncoded int;
  v_incomplete int;
  v_outside_scope int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  -- Imported/stale datasets are anchored to their latest evidence rather than
  -- silently queried against a window ending today.
  select max(evidence_at) into v_to
  from (
    select max(w.completed_at) as evidence_at
    from public.work_orders w
    where w.organization_id = v_org
      and w.work_type = 'corrective'
      and w.failure_mechanism_id is not null
    union all
    select max(coalesce(os.ended_at, now()))
    from public.operating_states os
    where os.organization_id = v_org
    union all
    select max(s.approved_at)
    from public.asset_failure_mechanism_scopes s
    where s.organization_id = v_org and s.applicable
  ) evidence;

  if v_to is null then
    return jsonb_build_object(
      'available', false, 'reportingDays', v_days, 'minFailures', v_min,
      'mechanisms', '[]'::jsonb,
      'basis', 'No approved asset–mechanism scope, coded corrective event, or operating-state evidence is recorded. No operating exposure is assumed.');
  end if;
  v_from := v_to - make_interval(days => v_days);

  select count(*)::int into v_uncoded
  from public.work_orders w
  where w.organization_id = v_org
    and w.work_type = 'corrective'
    and w.completed_at between v_from and v_to
    and w.failure_mechanism_id is null;

  select count(*)::int into v_incomplete
  from public.work_orders w
  where w.organization_id = v_org and w.work_type = 'corrective'
    and w.completed_at between v_from and v_to
    and w.failure_mechanism_id is not null
    and (w.mechanism_coded_by is null or w.mechanism_coded_at is null
      or coalesce(length(btrim(w.mechanism_coding_note)), 0) < 10);

  select count(*)::int into v_outside_scope
  from public.work_orders w
  where w.organization_id = v_org and w.work_type = 'corrective'
    and w.completed_at between v_from and v_to
    and w.failure_mechanism_id is not null
    and w.mechanism_coded_by is not null and w.mechanism_coded_at is not null
    and coalesce(length(btrim(w.mechanism_coding_note)), 0) >= 10
    and not exists (
      select 1 from public.asset_failure_mechanism_scopes s
      where s.organization_id = v_org and s.asset_id = w.asset_id
        and s.failure_mechanism_id = w.failure_mechanism_id and s.applicable);

  with scope as (
    select s.failure_mechanism_id as mechanism_id, s.asset_id
    from public.asset_failure_mechanism_scopes s
    where s.organization_id = v_org and s.applicable
  ), events as (
    select s.mechanism_id, s.asset_id, count(w.id)::int as failures
    from scope s
    left join public.work_orders w
      on w.organization_id = v_org and w.asset_id = s.asset_id
     and w.failure_mechanism_id = s.mechanism_id
     and w.work_type = 'corrective'
     and w.completed_at between v_from and v_to
     and w.mechanism_coded_by is not null and w.mechanism_coded_at is not null
     and coalesce(length(btrim(w.mechanism_coding_note)), 0) >= 10
    group by s.mechanism_id, s.asset_id
  ), cohort as (
    select mechanism_id, count(*)::int as scoped_assets,
      count(*) filter(where failures > 0)::int as affected_assets,
      sum(failures)::int as failures
    from events group by mechanism_id
  ), running_ranges as (
    select s.mechanism_id, s.asset_id,
      range_agg(tstzrange(greatest(os.started_at, v_from),
        least(coalesce(os.ended_at, v_to), v_to), '[)')) as covered
    from scope s
    join public.operating_states os
      on os.organization_id = v_org and os.asset_id = s.asset_id
     and os.state = 'running' and os.started_at < v_to
     and coalesce(os.ended_at, v_to) > v_from
    group by s.mechanism_id, s.asset_id
  ), running_hours as (
    select rr.mechanism_id, rr.asset_id,
      sum(extract(epoch from (upper(piece) - lower(piece))) / 3600.0)::numeric as hours
    from running_ranges rr
    cross join lateral unnest(rr.covered) as ranges(piece)
    group by rr.mechanism_id, rr.asset_id
  ), exposure as (
    select s.mechanism_id, count(rh.asset_id)::int as assets_with_exposure,
      coalesce(sum(rh.hours), 0)::numeric as running_hours
    from scope s
    left join running_hours rh
      on rh.mechanism_id = s.mechanism_id and rh.asset_id = s.asset_id
    group by s.mechanism_id
  ), measured as (
    select dm.mechanism_key, dm.name as mechanism_name, c.failures,
      c.affected_assets, c.scoped_assets, x.assets_with_exposure, x.running_hours,
      x.running_hours > 0 and x.assets_with_exposure = c.scoped_assets as event_rate_available,
      c.failures >= v_min and x.running_hours > 0
        and x.assets_with_exposure = c.scoped_assets as mtbf_available
    from cohort c
    join public.damage_mechanisms dm
      on dm.id = c.mechanism_id and dm.organization_id = v_org
    join exposure x on x.mechanism_id = c.mechanism_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'mechanismKey', m.mechanism_key, 'mechanismName', m.mechanism_name,
    'available', m.event_rate_available, 'eventRateAvailable', m.event_rate_available,
    'mtbfAvailable', m.mtbf_available, 'failures', m.failures,
    'failuresWithRunningExposure', case when m.event_rate_available then m.failures else 0 end,
    'affectedAssets', m.affected_assets, 'scopedAssets', m.scoped_assets,
    'assetsWithRunningExposure', m.assets_with_exposure,
    'runningHours', round(m.running_hours, 1),
    'mtbfHours', case when m.mtbf_available then round(m.running_hours / m.failures, 1) end,
    'eventRatePer1000RunningHours', case when m.event_rate_available
      then round(1000.0 * m.failures / m.running_hours, 2) end,
    'limitation', case
      when m.assets_with_exposure < m.scoped_assets then format(
        'Running exposure exists for %s of %s approved in-scope assets; no rate is reported until cohort exposure is complete.',
        m.assets_with_exposure, m.scoped_assets)
      when m.running_hours <= 0 then 'No recorded running-state exposure exists for the approved cohort; calendar time is not substituted.'
      when m.failures < v_min then format(
        'Event rate includes the full approved cohort; MTBF is withheld because only %s event(s) exist and at least %s are required.',
        m.failures, v_min)
      else 'The full approved asset cohort has recorded running-state exposure in the window.' end
  ) order by m.failures desc, m.mechanism_name), '[]'::jsonb)
  into v_rows from measured m;

  return jsonb_build_object(
    'available', exists (select 1 from jsonb_array_elements(v_rows) row
      where (row->>'eventRateAvailable')::boolean),
    'windowFrom', v_from, 'windowTo', v_to,
    'windowSource', 'caller-sized trailing window anchored to the latest recorded operating or coded-failure evidence',
    'reportingDays', v_days, 'minFailures', v_min,
    'uncodedCorrectiveEventsExcluded', v_uncoded,
    'incompleteCodingProvenanceExcluded', v_incomplete,
    'codedEventsOutsideApprovedScopeExcluded', v_outside_scope,
    'basis', 'Human-approved, evidence-backed asset–mechanism cohorts define susceptibility. Provenance-complete coded failures are divided by unioned recorded running-state hours for every applicable asset, including assets with zero failures. Incomplete cohort exposure withholds rates; calendar time is never substituted.',
    'mechanisms', v_rows);
end
$$;

revoke all on function public.get_failure_mode_reliability(int, int) from public, anon;
grant execute on function public.get_failure_mode_reliability(int, int) to authenticated;
notify pgrst, 'reload schema';
