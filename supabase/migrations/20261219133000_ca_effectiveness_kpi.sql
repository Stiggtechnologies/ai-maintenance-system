-- Corrective-action effectiveness rate (C6.22).
--
-- The per-action lifecycle already exists in ca_verifications. This migration
-- adds the missing portfolio metric to the ONE KPI catalogue and publishes a
-- snapshot from concluded observations only. Open observations are disclosed
-- but never put in the denominator. No universal target is fabricated: the
-- catalogue marks this as a trend and snapshots are neutral `not_assessed`.

insert into public.kpi_catalog (
  kpi_key, name, page, formula, target_label, direction,
  target_low, target_high, unit, accountable, responsible, consulted,
  informed, agent_owner, audience, computable, source_note
) values (
  'corrective_action_effectiveness',
  'Corrective-Action Effectiveness',
  'reliability',
  'Effective concluded corrective-action verifications / all concluded corrective-action verifications',
  'Increase — customer sets the governed target',
  'up', null, null, '%',
  'Maintenance Manager', 'Reliability', 'Maintenance, Operations',
  'Asset Management', 'reliability_engineering', null, true,
  'Computed from ca_verifications after the observation window concludes. No universal threshold is asserted.'
)
on conflict (kpi_key) do update set
  name = excluded.name,
  page = excluded.page,
  formula = excluded.formula,
  target_label = excluded.target_label,
  direction = excluded.direction,
  target_low = excluded.target_low,
  target_high = excluded.target_high,
  unit = excluded.unit,
  accountable = excluded.accountable,
  responsible = excluded.responsible,
  consulted = excluded.consulted,
  informed = excluded.informed,
  agent_owner = excluded.agent_owner,
  audience = excluded.audience,
  computable = excluded.computable,
  source_note = excluded.source_note;

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

revoke all on function public.get_ca_effectiveness_rate() from public, anon;
grant execute on function public.get_ca_effectiveness_rate() to authenticated;

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

revoke all on function public.snapshot_ca_effectiveness_kpi() from public, anon, authenticated;
grant execute on function public.snapshot_ca_effectiveness_kpi() to service_role;

do $$
begin
  begin
    perform cron.schedule(
      'syncai-ca-effectiveness-kpi',
      '10 * * * *',
      'select public.snapshot_ca_effectiveness_kpi()'
    );
  exception when others then
    null; -- pg_cron is unavailable in migration-chain CI.
  end;
end $$;

select public.snapshot_ca_effectiveness_kpi();

notify pgrst, 'reload schema';

