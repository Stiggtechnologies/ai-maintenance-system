-- ============================================================================
-- Closed-loop tail: corrective-action effectiveness verification and
-- similar-asset screening (capability register C4.13–C4.17; supports C6.22).
--
-- Spec §4: "A corrective action is not complete merely because the work order
-- is closed. It is complete when: the physical correction is verified; the
-- causal mechanism has been addressed; documentation and asset strategy are
-- updated; effectiveness is measured over an appropriate operating period;
-- similar assets are screened for exposure."
--
-- Design: humans ATTEST the judgment stages (physical / causal / strategy) —
-- the platform never self-certifies them. The platform MEASURES effectiveness
-- deterministically (recurrence of the same failure mode on the same asset
-- within the observation window) and COMPUTES similar-asset exposure.
-- Ineffective outcomes raise a governed recommendation; nothing autonomous.
--
-- Canonical reuse: work_orders (actual_failure_mode, work_type, completed_at),
-- assets (asset_class), recommendations, app_current_org(). Additive only.
-- ============================================================================

create table if not exists ca_verifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  failure_mode text,
  -- human-attested stages (C4.13, C4.14, C4.15)
  physical_verified_at timestamptz,
  physical_verified_by uuid,
  physical_note text,
  causal_addressed_at timestamptz,
  causal_addressed_by uuid,
  causal_note text,
  strategy_updated_at timestamptz,
  strategy_updated_by uuid,
  strategy_note text,
  -- measured effectiveness (C4.16)
  observation_start timestamptz not null default now(),
  observation_days int not null default 90
    check (observation_days between 7 and 730),
  effectiveness text not null default 'observing'
    check (effectiveness in ('observing', 'effective', 'ineffective')),
  effectiveness_evaluated_at timestamptz,
  recurrence_wo_id uuid references work_orders(id),
  -- computed similar-asset exposure (C4.17)
  similar_assets_screened_at timestamptz,
  similar_exposure jsonb,
  status text not null default 'open'
    check (status in ('open', 'observing', 'closed_effective', 'reopened_ineffective')),
  created_at timestamptz not null default now(),
  unique (work_order_id)
);

create index if not exists idx_ca_verifications_org on ca_verifications(organization_id, status);

alter table ca_verifications enable row level security;

drop policy if exists ca_verifications_org on ca_verifications;
create policy ca_verifications_org on ca_verifications
  for all to authenticated
  using (organization_id = app_current_org())
  with check (organization_id = app_current_org());

-- ----------------------------------------------------------------------------
-- Start a verification for a completed corrective work order.
-- ----------------------------------------------------------------------------
create or replace function public.start_ca_verification(
  p_work_order_id uuid,
  p_observation_days int default 90
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w work_orders%rowtype;
  v_id uuid;
begin
  select * into w from work_orders
  where id = p_work_order_id and organization_id = app_current_org();
  if not found then
    return jsonb_build_object('error', 'work order not found in your organization');
  end if;
  if w.work_type is distinct from 'corrective' or w.completed_at is null then
    return jsonb_build_object('error', 'verification applies to completed corrective work only');
  end if;

  insert into ca_verifications (organization_id, work_order_id, asset_id,
    failure_mode, observation_start, observation_days, status)
  values (w.organization_id, w.id, w.asset_id, w.actual_failure_mode,
    w.completed_at, least(greatest(coalesce(p_observation_days, 90), 7), 730), 'open')
  on conflict (work_order_id) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('error', 'verification already exists for this work order');
  end if;
  return jsonb_build_object('id', v_id);
end
$$;

grant execute on function public.start_ca_verification(uuid, int) to authenticated;

-- ----------------------------------------------------------------------------
-- Human attestation of the judgment stages. The attesting user is recorded;
-- the platform never fills these itself.
-- ----------------------------------------------------------------------------
create or replace function public.attest_ca_stage(
  p_verification_id uuid,
  p_stage text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v ca_verifications%rowtype;
begin
  select * into v from ca_verifications
  where id = p_verification_id and organization_id = app_current_org();
  if not found then
    return jsonb_build_object('error', 'verification not found');
  end if;

  if p_stage = 'physical' then
    update ca_verifications set physical_verified_at = now(),
      physical_verified_by = auth.uid(), physical_note = left(p_note, 1000)
    where id = v.id;
  elsif p_stage = 'causal' then
    update ca_verifications set causal_addressed_at = now(),
      causal_addressed_by = auth.uid(), causal_note = left(p_note, 1000)
    where id = v.id;
  elsif p_stage = 'strategy' then
    update ca_verifications set strategy_updated_at = now(),
      strategy_updated_by = auth.uid(), strategy_note = left(p_note, 1000)
    where id = v.id;
  else
    return jsonb_build_object('error', 'unknown stage; expected physical|causal|strategy');
  end if;

  -- all three attested -> observation phase
  update ca_verifications set status = 'observing'
  where id = v.id and status = 'open'
    and physical_verified_at is not null
    and causal_addressed_at is not null
    and strategy_updated_at is not null;

  return jsonb_build_object('ok', true);
end
$$;

grant execute on function public.attest_ca_stage(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Similar-asset screening (C4.17): same class, same failure-mode history.
-- Deterministic exposure computation stored on the verification.
-- ----------------------------------------------------------------------------
create or replace function public.screen_similar_assets(p_verification_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v ca_verifications%rowtype;
  v_class text;
  v_exposure jsonb;
begin
  select * into v from ca_verifications
  where id = p_verification_id and organization_id = app_current_org();
  if not found then
    return jsonb_build_object('error', 'verification not found');
  end if;

  select asset_class into v_class from assets where id = v.asset_id;

  select coalesce(jsonb_agg(row_to_json(e)), '[]'::jsonb) into v_exposure
  from (
    select a.tag,
           count(w.id) as same_mode_events,
           round(sum(w.downtime_hours)::numeric, 1) as downtime_hours
    from assets a
    join work_orders w on w.asset_id = a.id
      and w.work_type = 'corrective'
      and w.actual_failure_mode is not distinct from v.failure_mode
    where a.organization_id = v.organization_id
      and a.asset_class is not distinct from v_class
      and a.id <> v.asset_id
    group by a.tag
    order by count(w.id) desc
    limit 10
  ) e;

  update ca_verifications
  set similar_assets_screened_at = now(), similar_exposure = v_exposure
  where id = v.id;

  return jsonb_build_object('exposed_assets', v_exposure);
end
$$;

grant execute on function public.screen_similar_assets(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Effectiveness evaluation (C4.16): deterministic recurrence measurement.
-- Runs on a schedule; evaluates verifications whose window has elapsed, and
-- flags in-window recurrences early. Ineffective outcomes raise a governed
-- recommendation (advisory -> human loop), never an autonomous action.
-- ----------------------------------------------------------------------------
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
        verification_method)
      select v.organization_id, v.asset_id,
        'Corrective action ineffective — ' || coalesce(v.failure_mode, 'failure') || ' recurred',
        'The corrective action verified under CA verification ' || v.id ||
        ' did not hold: the same failure mode recurred within the ' ||
        v.observation_days || '-day observation window.',
        'Re-open causal analysis (FRACAS) and revise the corrective action.',
        'action', 88, 'pending', true,
        'Deterministic recurrence measurement by evaluate_ca_effectiveness()',
        'No recurrence of ' || coalesce(v.failure_mode, 'the failure mode') ||
        ' on this asset for ' || v.observation_days || ' further days'
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

revoke execute on function public.evaluate_ca_effectiveness() from public, anon, authenticated;

do $$
begin
  begin
    perform cron.schedule('syncai-ca-effectiveness', '15 * * * *',
      'select public.evaluate_ca_effectiveness()');
  exception when others then
    null; -- cron unavailable locally; CI runs without schedules
  end;
end
$$;
