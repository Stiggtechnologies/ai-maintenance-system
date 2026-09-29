-- Project FRACAS prerequisite: preserve the asset-only evaluator and KPI population.
-- No project records or new completion claims are introduced by this migration.
-- Existing function signatures, grants, arithmetic and human governance remain intact.

create or replace function public.evaluate_ca_effectiveness()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  rec_id uuid;
  n_eval int := 0;
  n_ineffective int := 0;
begin
  for v in
    select cv.* from ca_verifications cv
    where cv.status = 'observing' and cv.effectiveness = 'observing'
      and cv.work_order_id is not null and cv.asset_id is not null
  loop
    -- recurrence: same asset, same failure mode, completed after the CA
    select w.id into rec_id
    from work_orders w
    where w.asset_id = v.asset_id
      and w.work_type = 'corrective'
      and w.id <> v.work_order_id
      and w.actual_failure_mode is not distinct from v.failure_mode
      and w.completed_at > v.observation_start
      and w.completed_at <= v.observation_start + make_interval(days => v.observation_days)
    order by w.completed_at
    limit 1;

    if rec_id is not null then
      update ca_verifications set effectiveness = 'ineffective',
        effectiveness_evaluated_at = now(), recurrence_wo_id = rec_id,
        status = 'reopened_ineffective'
      where id = v.id;
      n_ineffective := n_ineffective + 1;

      insert into recommendations (organization_id, asset_id, title, issue,
        action, urgency, confidence, status, approval_required, rationale,
        verification_method,
        consequence_summary, alternatives_considered, required_completion_date,
        required_approver_role)
      select v.organization_id, v.asset_id,
        'Corrective action ineffective — ' || coalesce(v.failure_mode, 'failure') || ' recurred',
        'The corrective action verified under CA verification ' || v.id ||
        ' did not hold: the same failure mode recurred within the ' ||
        v.observation_days || '-day observation window.',
        'Re-open causal analysis (FRACAS) and revise the corrective action.',
        'action', 88, 'pending', true,
        'Deterministic recurrence measurement by evaluate_ca_effectiveness()',
        'No recurrence of ' || coalesce(v.failure_mode, 'the failure mode') ||
        ' on this asset for ' || v.observation_days || ' further days',
        'If not acted on: ' || coalesce(v.failure_mode, 'the failure mode') ||
        ' has already recurred on this asset inside the ' || v.observation_days ||
        '-day observation window, so the corrective action in place demonstrably does not' ||
        ' prevent it and the recurrence continues at whatever rate it had before. The cost' ||
        ' of that recurrence is not quantified: this loop measures whether the action held,' ||
        ' not what each failure costs.',
        'Considered and rejected: extend the observation window — rejected because recurrence' ||
        ' has been measured, not merely awaited. Considered and rejected: repeat the same' ||
        ' corrective action — rejected because it is the action that did not hold. This is the' ||
        ' detection rule''s own option set, not an engineering options study; a reviewer may' ||
        ' identify options the rule cannot see.',
        -- Re-opening a causal analysis has no committed date until a planner
        -- schedules it. Not derivable here.
        null,
        'Reliability Engineer'
      where not exists (
        select 1 from recommendations r
        where r.asset_id = v.asset_id
          and r.title like 'Corrective action ineffective%' || coalesce(v.failure_mode, 'failure') || '%'
          and r.status in ('pending', 'approved')
      );
      n_eval := n_eval + 1;
    elsif now() >= v.observation_start + make_interval(days => v.observation_days) then
      update ca_verifications set effectiveness = 'effective',
        effectiveness_evaluated_at = now(), status = 'closed_effective'
      where id = v.id;
      n_eval := n_eval + 1;
    end if;
  end loop;

  return jsonb_build_object('evaluated', n_eval, 'ineffective', n_ineffective);
end
$$;

create or replace function public.get_ca_effectiveness_rate()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with caller as (
    select public.app_current_org() as organization_id
  ), counts as (
    select
      count(*) filter (
        where cv.effectiveness in ('effective', 'ineffective')
          and cv.effectiveness_evaluated_at is not null
      )::int as concluded,
      count(*) filter (
        where cv.effectiveness = 'effective'
          and cv.effectiveness_evaluated_at is not null
      )::int as effective,
      count(*) filter (
        where cv.effectiveness = 'ineffective'
          and cv.effectiveness_evaluated_at is not null
      )::int as ineffective,
      count(*) filter (where cv.effectiveness = 'observing')::int as observing
    from public.ca_verifications cv
    join caller c on c.organization_id = cv.organization_id
    where cv.work_order_id is not null and cv.asset_id is not null
  )
  select case
    when (select organization_id from caller) is null then
      jsonb_build_object('error', 'forbidden')
    else jsonb_build_object(
      'available', counts.concluded > 0,
      'concluded', counts.concluded,
      'effective', counts.effective,
      'ineffective', counts.ineffective,
      'observingExcluded', counts.observing,
      'effectivenessRatePct', case when counts.concluded > 0
        then round(100.0 * counts.effective / counts.concluded, 1)
        else null end,
      'basis', 'Effective concluded corrective-action verifications divided by all concluded verifications. Open observation windows are disclosed and excluded from both numerator and denominator.'
    )
  end
  from counts;
$$;

create or replace function public.snapshot_ca_effectiveness_kpi()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_written int := 0;
begin
  for v in
    select
      o.id as organization_id,
      count(cv.id) filter (
        where cv.effectiveness in ('effective', 'ineffective')
          and cv.effectiveness_evaluated_at is not null
      )::int as concluded,
      count(cv.id) filter (
        where cv.effectiveness = 'effective'
          and cv.effectiveness_evaluated_at is not null
      )::int as effective,
      count(cv.id) filter (where cv.effectiveness = 'observing')::int as observing
    from public.organizations o
    left join public.ca_verifications cv on cv.organization_id = o.id
      and cv.work_order_id is not null and cv.asset_id is not null
    group by o.id
  loop
    if v.concluded > 0 then
      insert into public.kpi_values (
        organization_id, kpi_key, value, status, confidence, computed_from
      ) values (
        v.organization_id,
        'corrective_action_effectiveness',
        round(100.0 * v.effective / v.concluded, 1),
        'not_assessed',
        'high',
        jsonb_build_object(
          'source', 'ca_verifications: effective / concluded observation windows',
          'effective', v.effective,
          'concluded', v.concluded,
          'observing_excluded', v.observing,
          'target_status', 'not_assessed — no governed customer threshold configured'
        )
      );
      v_written := v_written + 1;
    end if;
  end loop;

  return jsonb_build_object('snapshotsWritten', v_written);
end
$$;

notify pgrst, 'reload schema';

