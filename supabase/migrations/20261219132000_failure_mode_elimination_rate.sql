-- Failure-mode elimination rate (C6.23).
--
-- This is deliberately an asset–mechanism metric, not a claim that a mechanism
-- has vanished from an enterprise.  It reuses the canonical human-coded
-- mechanism on work_orders and the existing corrective-action verification
-- lifecycle.  The latest verification for each asset–mechanism target earns
-- elimination credit only after its observation window closes effective and
-- only while no later recurrence of that coded mechanism exists.

-- The original table policy allowed direct tenant writes. That was acceptable
-- for early CRUD, but it is not acceptable once this table drives an executive
-- outcome: a client could otherwise stamp `effective` without the governed
-- attest/evaluate path. Keep reads tenant-scoped and make the existing
-- SECURITY DEFINER RPCs the only write surface.
drop policy if exists ca_verifications_org on public.ca_verifications;
drop policy if exists ca_verifications_read on public.ca_verifications;
create policy ca_verifications_read on public.ca_verifications
  for select to authenticated
  using (organization_id = public.app_current_org());

revoke insert, update, delete, truncate on public.ca_verifications from anon, authenticated;
grant select on public.ca_verifications to authenticated;

create or replace function public.get_failure_mode_elimination_rate()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with caller as (
    select public.app_current_org() as organization_id
  ),
  coded_verifications as (
    select
      cv.id,
      cv.asset_id,
      wo.failure_mechanism_id as mechanism_id,
      dm.mechanism_key,
      dm.name as mechanism_name,
      cv.observation_start,
      cv.observation_days,
      cv.effectiveness,
      cv.effectiveness_evaluated_at,
      row_number() over (
        partition by cv.asset_id, wo.failure_mechanism_id
        order by cv.observation_start desc, cv.created_at desc, cv.id desc
      ) as recency
    from public.ca_verifications cv
    join public.work_orders wo
      on wo.id = cv.work_order_id
     and wo.organization_id = cv.organization_id
    join public.damage_mechanisms dm
      on dm.id = wo.failure_mechanism_id
     and dm.organization_id = cv.organization_id
    join caller c on c.organization_id = cv.organization_id
  ),
  latest as (
    select * from coded_verifications where recency = 1
  ),
  classified as (
    select
      l.*,
      exists (
        select 1
        from public.work_orders recurrence
        where recurrence.organization_id = (select organization_id from caller)
          and recurrence.asset_id = l.asset_id
          and recurrence.failure_mechanism_id = l.mechanism_id
          and recurrence.work_type = 'corrective'
          and recurrence.completed_at > l.observation_start
      ) as later_recurrence
    from latest l
  ),
  targets as (
    select
      c.*,
      case
        when c.effectiveness = 'effective'
         and c.effectiveness_evaluated_at is not null
         and not c.later_recurrence then 'eliminated'
        when c.effectiveness = 'ineffective' or c.later_recurrence then 'recurrent'
        else 'observing'
      end as outcome
    from classified c
  ),
  totals as (
    select
      count(*)::int as targeted,
      count(*) filter (where outcome = 'eliminated')::int as eliminated,
      count(*) filter (where outcome = 'recurrent')::int as recurrent,
      count(*) filter (where outcome = 'observing')::int as observing
    from targets
  ),
  uncoded as (
    select count(*)::int as count
    from public.ca_verifications cv
    join public.work_orders wo
      on wo.id = cv.work_order_id
     and wo.organization_id = cv.organization_id
    join caller c on c.organization_id = cv.organization_id
    where wo.failure_mechanism_id is null
  )
  select case
    when (select organization_id from caller) is null then
      jsonb_build_object('error', 'forbidden')
    else jsonb_build_object(
      'available', totals.targeted > 0,
      'targetedAssetMechanisms', totals.targeted,
      'eliminatedAssetMechanisms', totals.eliminated,
      'recurrentAssetMechanisms', totals.recurrent,
      'observingAssetMechanisms', totals.observing,
      'uncodedVerificationsExcluded', uncoded.count,
      'targetsReturned', least(totals.targeted, 100),
      'eliminationRatePct', case when totals.targeted > 0
        then round(100.0 * totals.eliminated / totals.targeted, 1)
        else null end,
      'unit', 'latest governed corrective-action verification per asset and human-coded failure mechanism',
      'basis', 'Eliminated requires a completed effective observation window and no later corrective recurrence of the same human-coded mechanism on that asset. Observing, ineffective, recurrent, and uncoded records never enter the numerator.',
      'targets', coalesce((
        select jsonb_agg(jsonb_build_object(
          'assetId', t.asset_id,
          'mechanismKey', t.mechanism_key,
          'mechanismName', t.mechanism_name,
          'outcome', t.outcome,
          'observationStart', t.observation_start,
          'observationDays', t.observation_days,
          'evaluatedAt', t.effectiveness_evaluated_at,
          'laterRecurrence', t.later_recurrence
        ) order by t.mechanism_name, t.asset_id)
        from (
          select *
          from targets
          order by mechanism_name, asset_id
          limit 100
        ) t
      ), '[]'::jsonb)
    )
  end
  from totals cross join uncoded;
$$;

revoke all on function public.get_failure_mode_elimination_rate() from public, anon;
grant execute on function public.get_failure_mode_elimination_rate() to authenticated;
