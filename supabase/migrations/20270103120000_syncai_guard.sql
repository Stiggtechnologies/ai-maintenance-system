-- ============================================================================
-- SyncAI Guard (MVP).
--
-- Canonical reuse, and only that:
--   feature_flags          tenant rollout, default OFF (missing row = off)
--   audit_events           each rail allow/block (entity_type syncai_guard_rail)
--   recommendations        anomaly findings
--   evidence_items         the reading or synthetic event the finding cites
--   approvals              status 'required' until a named human decides
--   condition_readings     seeded/simulated telemetry already in the tenant
--   sensors.alarm_limit    the stored limit, never a new engineering number
--
-- agent_id stays null. enforce_agent_recommendation_control fails closed for
-- an agent with no adopted control profile, and this migration does not
-- invent that adoption. The finding is still a pending recommendation.
--
-- No new queue, audit log, or approval engine. The function does not insert
-- work_orders, autonomous_actions, or autonomous_decisions. Direct plant
-- execution stays disabled. NVIDIA Morpheus is not used.
--
-- Rule id guard-anomaly-v1 matches supabase/functions/_shared/
-- syncai-guard-anomaly.ts: at least 8 prior good readings, sample standard
-- deviation, default z of 3 (allowed range 2..6), at most 20 findings, and
-- an explicitly synthetic authentication-failure event.
-- ============================================================================

insert into feature_flags (organization_id, flag_key, enabled, description)
select o.id,
       'syncai_guard',
       false,
       'SyncAI Guard: input/output rails on the Sync assistant and anomaly findings that stay pending until a named human approves them. Default off. Without NVIDIA_API_KEY the rails use the local mock. Does not command plant equipment.'
from organizations o
on conflict (organization_id, flag_key) do nothing;

create or replace function public.set_syncai_guard_enabled(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_previous boolean;
begin
  if v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;

  select role into v_role
  from public.user_profiles
  where id = auth.uid() and organization_id = v_org;

  if coalesce(v_role, '') not in ('admin', 'ai_admin') then
    return jsonb_build_object(
      'error',
      'changing SyncAI Guard requires an administrator role'
    );
  end if;

  select enabled into v_previous
  from public.feature_flags
  where organization_id = v_org and flag_key = 'syncai_guard';

  insert into public.feature_flags (
    organization_id, flag_key, enabled, updated_by, updated_at, description
  )
  values (
    v_org,
    'syncai_guard',
    coalesce(p_enabled, false),
    auth.uid(),
    now(),
    'SyncAI Guard rails and anomaly findings. Off leaves the assistant path unchanged.'
  )
  on conflict (organization_id, flag_key)
  do update set
    enabled = excluded.enabled,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data
  )
  values (
    v_org,
    'sync_feature_flag',
    auth.uid()::text,
    jsonb_build_object(
      'flag_key', 'syncai_guard',
      'previous_enabled', v_previous,
      'enabled', coalesce(p_enabled, false),
      'changed_by', auth.uid(),
      'changed_at', now()
    )
  );

  return jsonb_build_object(
    'flag_key', 'syncai_guard',
    'enabled', coalesce(p_enabled, false),
    'previous_enabled', v_previous,
    'plant_execution', 'disabled'
  );
end
$$;

revoke all on function public.set_syncai_guard_enabled(boolean) from public, anon;
grant execute on function public.set_syncai_guard_enabled(boolean) to authenticated;

create or replace function public.raise_syncai_guard_findings(
  p_z_threshold numeric default 3,
  p_include_synthetic boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_enabled boolean;
  v_created int := 0;
  v_skipped int := 0;
  v_z numeric;
  v_today text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD');
  r record;
  v_limit boolean;
  v_zscore boolean;
  v_finding_id text;
  v_rec uuid;
  v_issue text;
  v_evidence text;
begin
  if v_org is null then
    return jsonb_build_object(
      'error', 'no organization in session',
      'created', 0,
      'plant_execution', 'disabled',
      'rule', 'guard-anomaly-v1'
    );
  end if;

  select enabled into v_enabled
  from public.feature_flags
  where organization_id = v_org and flag_key = 'syncai_guard';

  if v_enabled is not true then
    return jsonb_build_object(
      'error', 'syncai_guard_disabled',
      'created', 0,
      'plant_execution', 'disabled',
      'rule', 'guard-anomaly-v1'
    );
  end if;

  v_z := coalesce(p_z_threshold, 3);
  if v_z < 2 or v_z > 6 then
    return jsonb_build_object(
      'error', 'z_threshold_out_of_range',
      'created', 0,
      'plant_execution', 'disabled',
      'rule', 'guard-anomaly-v1'
    );
  end if;

  for r in
    with latest as (
      select distinct on (cr.sensor_id)
        cr.sensor_id, cr.asset_id, cr.value as latest_value, cr.taken_at
      from public.condition_readings cr
      where cr.organization_id = v_org
        and cr.quality = 'good'
      order by cr.sensor_id, cr.taken_at desc
    ),
    baseline as (
      select cr.sensor_id,
             avg(cr.value) as mu,
             stddev_samp(cr.value) as sigma,
             count(*)::int as n
      from public.condition_readings cr
      join latest l on l.sensor_id = cr.sensor_id
      where cr.organization_id = v_org
        and cr.quality = 'good'
        and cr.taken_at < l.taken_at
      group by cr.sensor_id
    )
    select l.sensor_id, l.asset_id, l.latest_value, l.taken_at,
           b.mu, b.sigma, coalesce(b.n, 0) as n,
           s.name as sensor_name, s.alarm_limit, s.limit_direction, s.unit,
           a.name as asset_name
    from latest l
    join public.sensors s
      on s.id = l.sensor_id and s.organization_id = v_org
    left join baseline b on b.sensor_id = l.sensor_id
    left join public.assets a
      on a.id = l.asset_id and a.organization_id = v_org
  loop
    exit when v_created >= 20;
    v_limit := r.alarm_limit is not null and (
      (coalesce(r.limit_direction, 'above') = 'below' and r.latest_value <= r.alarm_limit)
      or (coalesce(r.limit_direction, 'above') <> 'below' and r.latest_value >= r.alarm_limit)
    );
    v_zscore := r.n >= 8
      and r.sigma is not null
      and r.sigma > 0
      and abs(r.latest_value - r.mu) / r.sigma >= v_z;
    if not v_limit and not v_zscore then
      continue;
    end if;

    v_finding_id := 'syncai-guard:sensor:' || r.sensor_id::text || ':' || v_today;
    if exists (
      select 1 from public.recommendations
      where organization_id = v_org and source_finding_id = v_finding_id
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_evidence := concat_ws(
      '; ',
      case when v_limit then
        'latest ' || r.latest_value::text || ' crossed the stored alarm_limit ' || r.alarm_limit::text
        || ' (' || coalesce(r.limit_direction, 'above') || ')'
      end,
      case when v_zscore then
        'latest ' || r.latest_value::text || ' is ' ||
        round(abs(r.latest_value - r.mu) / r.sigma, 2)::text ||
        ' sample standard deviations from the prior mean ' || round(r.mu, 2)::text ||
        ' (n=' || r.n::text || ')'
      end
    );
    v_issue := r.sensor_name
      || case when r.asset_name is not null then ' on ' || r.asset_name else '' end
      || ': ' || v_evidence
      || '. Rule guard-anomaly-v1. Screening finding from recorded readings, not a diagnosed failure and not a plant command.';

    insert into public.recommendations (
      organization_id, asset_id, title, issue, action, impact,
      confidence, urgency, status, approval_required, accountable,
      responsible, consulted, informed, risk_impact, rationale, source_finding_id
    )
    values (
      v_org,
      r.asset_id,
      'Review anomalous ' || r.sensor_name
        || case when r.asset_name is not null then ' on ' || r.asset_name else '' end,
      v_issue,
      'Have a named approver review the evidence and decide whether maintenance follow-up is warranted. Do not command plant equipment from this finding.',
      'No automatic work and no plant command. Approval creates the governed work path.',
      70,
      case when v_limit then 'action' else 'advisory' end,
      'pending',
      'Maintenance Manager',
      'Maintenance Manager',
      'Reliability Engineer',
      'Operations',
      'Security',
      'Medium',
      'Raised by SyncAI Guard from tenant telemetry. Human approval required before any work. Plant execution disabled.',
      v_finding_id
    )
    returning id into v_rec;

    insert into public.evidence_items (
      organization_id, recommendation_id, asset_id, source_system,
      evidence_type, description, confidence_contribution, data_quality
    )
    values (
      v_org, v_rec, r.asset_id, 'syncai_guard', 'telemetry_anomaly',
      v_evidence, 10, 'good'
    );

    insert into public.approvals (
      organization_id, recommendation_id, status, owner_role, reason,
      consequence_of_wrong, required_validation
    )
    values (
      v_org, v_rec, 'required', 'Maintenance Manager',
      'SyncAI Guard finding requires a named human decision.',
      'Approving creates governed work only. It does not command plant equipment.',
      'Confirm the cited reading and the stored alarm limit before approving.'
    );

    v_created := v_created + 1;
  end loop;

  if coalesce(p_include_synthetic, true) and v_created < 20 then
    v_finding_id := 'syncai-guard:synthetic:auth-burst:' || v_today;
    if exists (
      select 1 from public.recommendations
      where organization_id = v_org and source_finding_id = v_finding_id
    ) then
      v_skipped := v_skipped + 1;
    else
      insert into public.recommendations (
        organization_id, asset_id, title, issue, action, impact,
        confidence, urgency, status, approval_required, accountable,
        responsible, consulted, informed, risk_impact, rationale, source_finding_id
      )
      values (
        v_org,
        null,
        'Review synthetic authentication-failure burst',
        'Synthetic security event for this organization: repeated failed authentications against the seeded historian read path. Not a live plant incident and not customer telemetry. Rule guard-anomaly-v1.',
        'Have a named approver confirm whether the seeded access trail needs follow-up. Do not command plant equipment.',
        'No automatic work and no plant command.',
        60,
        'advisory',
        'pending',
        'Maintenance Manager',
        'Maintenance Manager',
        'Security',
        'Operations',
        'Reliability Engineer',
        'Medium',
        'Synthetic SyncAI Guard event so the approval loop can be exercised. Plant execution disabled.',
        v_finding_id
      )
      returning id into v_rec;

      insert into public.evidence_items (
        organization_id, recommendation_id, source_system, evidence_type,
        description, confidence_contribution, data_quality
      )
      values (
        v_org, v_rec, 'syncai_guard', 'synthetic_security_event',
        'Synthetic series of failed sign-in attempts. Generated by SyncAI Guard so the approval loop can be exercised without a live security feed.',
        5, 'good'
      );

      insert into public.approvals (
        organization_id, recommendation_id, status, owner_role, reason,
        consequence_of_wrong
      )
      values (
        v_org, v_rec, 'required', 'Maintenance Manager',
        'Synthetic Guard finding requires a named human decision.',
        'Approving does not command plant equipment.'
      );
      v_created := v_created + 1;
    end if;
  end if;

  return jsonb_build_object(
    'created', v_created,
    'skipped_existing', v_skipped,
    'plant_execution', 'disabled',
    'rule', 'guard-anomaly-v1',
    'error', null
  );
end
$$;

revoke all on function public.raise_syncai_guard_findings(numeric, boolean) from public, anon;
grant execute on function public.raise_syncai_guard_findings(numeric, boolean) to authenticated;

comment on function public.raise_syncai_guard_findings(numeric, boolean) is
  'guard-anomaly-v1. Pending recommendations plus evidence and a required approval. Does not create work or command a plant.';

notify pgrst, 'reload schema';
