-- C8.08 — close the production-window arm of the canonical weekly schedule
-- feasibility door.
--
-- Canonical reuse only:
--   * schedule_options remains the weekly option and release workflow;
--   * work_orders supplies the exact scheduled asset/site scope;
--   * operational_constraint_signals remains the governed operating-context
--     evidence feed.
--
-- No capacity, availability or production plan is inferred. An unavailable
-- signal that overlaps the week is a soft conflict. Missing, unknown, stale or
-- partial-week evidence is NOT ASSESSABLE, never a pass. A planner still owns
-- the release judgement through the existing explicit warning acknowledgement.

alter function public.evaluate_schedule_feasibility(uuid)
  rename to evaluate_schedule_feasibility_core_20261212;

-- The previous implementation is retained only as an internal composed core.
-- Customer roles must not be able to call it and bypass the production arm.
revoke all on function public.evaluate_schedule_feasibility_core_20261212(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.schedule_production_window_check(
  p_work_order_ids uuid[],
  p_week_start date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_window_start timestamptz := p_week_start::timestamptz;
  v_window_end timestamptz := (p_week_start + 7)::timestamptz;
  v_total int := 0;
  v_available int := 0;
  v_unavailable int := 0;
  v_not_assessable int := 0;
  v_evidence jsonb := '[]'::jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  with scheduled as (
    select
      w.id as work_order_id,
      w.wo_number,
      w.title,
      w.site_id,
      w.asset_id,
      coalesce(nullif(a.asset_tag, ''), a.tag) as asset_tag
    from public.work_orders w
    left join public.assets a
      on a.id = w.asset_id
     and a.organization_id = w.organization_id
    where w.organization_id = v_org
      and w.id = any(coalesce(p_work_order_ids, '{}'::uuid[]))
  ), candidates as (
    select
      sw.*,
      s.id as signal_id,
      s.signal_key,
      s.state as signal_state,
      s.observed_at,
      s.valid_until,
      s.source_system,
      s.source_ref,
      s.basis,
      case
        when sw.asset_id is not null and s.asset_id = sw.asset_id then 2
        when s.asset_id is null and sw.site_id is not null
          and s.site_id = sw.site_id then 1
        else 0
      end as scope_rank,
      case
        when sw.asset_id is not null and s.asset_id = sw.asset_id then 'asset'
        when s.asset_id is null and sw.site_id is not null
          and s.site_id = sw.site_id then 'site'
        else 'organization'
      end as evidence_scope
    from scheduled sw
    join public.operational_constraint_signals s
      on s.organization_id = v_org
     and s.signal_kind = 'production'
     and s.observed_at <= now()
     and (
       (sw.asset_id is not null and s.asset_id = sw.asset_id)
       or (s.asset_id is null and sw.site_id is not null and s.site_id = sw.site_id)
       or (s.asset_id is null and s.site_id is null)
     )
  ), selected as (
    select x.*,
      x.observed_at <= v_window_start and x.valid_until >= v_window_end
        as covers_week,
      x.observed_at < v_window_end and x.valid_until > v_window_start
        as overlaps_week
    from (
      select c.*,
        row_number() over (
          partition by c.work_order_id, c.signal_key
          order by c.scope_rank desc, c.observed_at desc, c.signal_id desc
        ) as choice_rank
      from candidates c
    ) x
    where x.choice_rank = 1
  ), by_work as (
    select
      sw.work_order_id,
      sw.wo_number,
      sw.title,
      sw.site_id,
      sw.asset_id,
      sw.asset_tag,
      count(s.signal_id)::int as signal_count,
      case
        when coalesce(bool_or(
          s.signal_state = 'unavailable' and s.overlaps_week
        ), false) then 'unavailable'
        when count(s.signal_id) = 0 then 'not_assessable'
        when bool_and(s.signal_state = 'available' and s.covers_week)
          then 'available'
        else 'not_assessable'
      end as assessment_state,
      coalesce(jsonb_agg(jsonb_build_object(
        'signalId', s.signal_id,
        'signalKey', s.signal_key,
        'state', s.signal_state,
        'scope', s.evidence_scope,
        'observedAt', s.observed_at,
        'validUntil', s.valid_until,
        'coversWeek', s.covers_week,
        'overlapsWeek', s.overlaps_week,
        'sourceSystem', s.source_system,
        'sourceRef', s.source_ref,
        'basis', s.basis
      ) order by s.signal_key, s.scope_rank desc, s.observed_at desc)
        filter (where s.signal_id is not null), '[]'::jsonb) as signals
    from scheduled sw
    left join selected s on s.work_order_id = sw.work_order_id
    group by sw.work_order_id, sw.wo_number, sw.title, sw.site_id,
      sw.asset_id, sw.asset_tag
  )
  select
    count(*)::int,
    count(*) filter (where assessment_state = 'available')::int,
    count(*) filter (where assessment_state = 'unavailable')::int,
    count(*) filter (where assessment_state = 'not_assessable')::int,
    coalesce(jsonb_agg(jsonb_build_object(
      'workOrderId', work_order_id,
      'workOrderNumber', wo_number,
      'title', title,
      'siteId', site_id,
      'assetId', asset_id,
      'assetTag', asset_tag,
      'assessmentState', assessment_state,
      'signalCount', signal_count,
      'signals', signals
    ) order by wo_number, work_order_id), '[]'::jsonb)
  into v_total, v_available, v_unavailable, v_not_assessable, v_evidence
  from by_work;

  return jsonb_build_object(
    'constraint', 'Production window',
    'severity', 'warning',
    'register_ref', 'C8.08',
    'passed', case
      when v_unavailable > 0 then false
      when v_not_assessable > 0 then null
      else true
    end,
    'count', v_unavailable,
    'scheduled_work_orders', v_total,
    'available_work_orders', v_available,
    'not_assessable_work_orders', v_not_assessable,
    'window_start', v_window_start,
    'window_end', v_window_end,
    'scope', 'this weekly option only',
    'source', 'operational_constraint_signals',
    'evidence', v_evidence,
    'detail', case
      when v_total = 0 then
        'No work orders are present in this option, so the production-window check has no scheduled subject.'
      when v_unavailable > 0 then
        format('%s scheduled work order(s) overlap a production signal recorded as unavailable. This is a visible planning conflict and requires explicit warning acknowledgement; it does not let software approve a production interruption.', v_unavailable)
      when v_not_assessable > 0 then
        format('NOT ASSESSABLE: %s of %s scheduled work order(s) lack current, full-week available production evidence. Missing, unknown, stale and partial-window evidence are neither a conflict nor a clearance.', v_not_assessable, v_total)
      else
        format('All %s scheduled work order(s) have current production evidence recorded as available for the full week.', v_total)
    end,
    'authority', jsonb_build_object(
      'advisoryOnly', true,
      'mayReleaseSchedule', false,
      'mayApproveProductionInterruption', false,
      'requiresHumanWarningAcknowledgement', true
    )
  );
end
$$;

revoke all on function public.schedule_production_window_check(uuid[], date)
  from public, anon, authenticated, service_role;

-- Keep one public feasibility door. It composes the existing hard/soft checks,
-- removes the former placeholder, and appends the canonical production result.
create or replace function public.evaluate_schedule_feasibility(p_option_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_week_start date;
  v_work_order_ids uuid[];
  v_result jsonb;
  v_checks jsonb;
  v_production jsonb;
  v_warnings int;
begin
  select
    o.week_start,
    coalesce(array_agg((it->>'wo_id')::uuid)
      filter (where it->>'wo_id' is not null), '{}'::uuid[])
  into v_week_start, v_work_order_ids
  from public.schedule_options o
  left join lateral jsonb_array_elements(o.items) it on true
  where o.id = p_option_id
    and o.organization_id = v_org
  group by o.week_start;

  if not found then
    return jsonb_build_object('error', 'schedule option not found');
  end if;

  v_result := public.evaluate_schedule_feasibility_core_20261212(p_option_id);
  if v_result ? 'error' then
    return v_result;
  end if;

  v_production := public.schedule_production_window_check(
    v_work_order_ids,
    v_week_start
  );

  select coalesce(jsonb_agg(c.value order by c.ordinality), '[]'::jsonb)
  into v_checks
  from jsonb_array_elements(coalesce(v_result->'checks', '[]'::jsonb))
    with ordinality c(value, ordinality)
  where c.value->>'constraint' <> 'Production window';

  v_checks := v_checks || jsonb_build_array(v_production);
  v_warnings := coalesce((v_result->>'warnings')::int, 0)
    + case when v_production->>'passed' = 'true' then 0 else 1 end;

  v_result := jsonb_set(v_result, '{checks}', v_checks, true);
  v_result := jsonb_set(v_result, '{warnings}', to_jsonb(v_warnings), true);
  v_result := jsonb_set(v_result, '{policy}', to_jsonb(
    'Hard constraints block a release; soft constraints warn and leave the judgement with the planner. Production-window conflicts and evidence gaps require explicit acknowledgement but cannot authorize a production interruption. Recovery event sequence remains governed by Recovery and cannot be overridden by a weekly option. The portfolio check is collective across development cases and cannot be resolved by editing this week.'::text
  ), true);

  return v_result;
end
$$;

revoke all on function public.evaluate_schedule_feasibility(uuid)
  from public, anon, service_role;
grant execute on function public.evaluate_schedule_feasibility(uuid)
  to authenticated;

-- Recompile the consequential release door against the public composed
-- function. It retains the existing role, hard-block and explicit-warning
-- acknowledgement boundaries unchanged.
create or replace function public.release_schedule_option(
  p_id uuid,
  p_acknowledge_warnings boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.schedule_options%rowtype;
  v_role text;
  f jsonb;
begin
  select role into v_role from public.user_profiles where id = auth.uid();
  if v_role not in ('planner', 'maintenance_manager', 'admin', 'ai_admin') then
    return jsonb_build_object('error',
      'releasing a schedule requires planner or manager authority');
  end if;

  select * into o from public.schedule_options
  where id = p_id and organization_id = public.app_current_org();
  if not found then
    return jsonb_build_object('error', 'option not found');
  end if;
  if o.status <> 'draft' then
    return jsonb_build_object('error', 'only draft options can be released');
  end if;

  f := public.evaluate_schedule_feasibility(p_id);

  if (f->>'blocking_failures')::int > 0 then
    return jsonb_build_object('error',
      'this schedule cannot be released: a hard constraint fails',
      'feasibility', f);
  end if;

  if (f->>'warnings')::int > 0 and not p_acknowledge_warnings then
    return jsonb_build_object('error',
      format('%s constraint warning(s) — review and release with acknowledgement', f->>'warnings'),
      'feasibility', f);
  end if;

  update public.schedule_options
  set status = 'released', released_by = auth.uid(), released_at = now()
  where id = o.id;

  update public.schedule_options
  set status = 'discarded'
  where organization_id = o.organization_id and week_start = o.week_start
    and id <> o.id and status = 'draft';

  return jsonb_build_object(
    'released', o.id,
    'week_start', o.week_start,
    'warnings_acknowledged', (f->>'warnings')::int,
    'feasibility', f
  );
end
$$;

revoke all on function public.release_schedule_option(uuid, boolean)
  from public, anon, service_role;
grant execute on function public.release_schedule_option(uuid, boolean)
  to authenticated;

-- The original one-argument overload predates feasibility and releases
-- immediately. Keep its history but remove every callable privilege so it
-- cannot bypass the governed two-argument release door.
revoke all on function public.release_schedule_option(uuid)
  from public, anon, authenticated, service_role;
comment on function public.release_schedule_option(uuid) is
  'Retired pre-feasibility overload. No role may execute it; callers must use release_schedule_option(uuid, boolean), which evaluates hard constraints and requires explicit warning acknowledgement.';

comment on function public.evaluate_schedule_feasibility(uuid) is
  'C8.08 + D7.02: the ONE weekly feasibility door. It preserves the existing safety, authority, material, Recovery, labour and portfolio checks and composes tenant-scoped production-window evidence from operational_constraint_signals. Unavailable evidence warns; missing, unknown, stale or partial-week evidence is not assessable; only full-week availability passes. Human acknowledgement is required and software cannot approve a production interruption.';

comment on function public.schedule_production_window_check(uuid[], date) is
  'Internal C8.08 production-window predicate over canonical operational_constraint_signals. Not directly executable by customer or service roles.';

notify pgrst, 'reload schema';
