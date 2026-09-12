-- D12.18 / spec §68 — Governance Agent, detection only.
--
-- This is a bounded read model over the canonical governance stores. It does
-- not persist a second violation register and it exposes no adjudication act.
-- `case_binding_gate_demands` remains the one deterministic predicate for a
-- lapsed waiver, independence failure, evidence demand or composite rule.

create or replace function public.screen_governance_agent(
  p_lookback_days integer default 30,
  p_case_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_days integer := least(greatest(coalesce(p_lookback_days, 30), 1), 365);
  v_limit integer := least(greatest(coalesce(p_case_limit, 100), 1), 250);
  v_case_count integer;
  v_event_count integer;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'authentication required');
  end if;

  select role into v_role from user_profiles where id = auth.uid();
  if v_role not in ('admin', 'ai_admin') then
    return jsonb_build_object(
      'error', 'forbidden',
      'reason', 'Governance findings include the organization security log and are restricted to administrators.'
    );
  end if;

  select count(*) into v_case_count
  from development_cases
  where organization_id = v_org
    and status in ('active', 'on_hold', 'sanctioned');

  select count(*) into v_event_count
  from security_events
  where organization_id = v_org
    and event_type = 'access_denied'
    and created_at >= now() - make_interval(days => v_days);

  return jsonb_build_object(
    'organizationId', v_org,
    'asOf', now(),
    'lookbackDays', v_days,
    'caseCount', v_case_count,
    'caseLimit', v_limit,
    'casesTruncated', v_case_count > v_limit,
    'cases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'caseId', x.id,
        'caseTitle', x.title,
        'currentStageKey', x.current_stage_key,
        'demands', x.demands
      ) order by x.title, x.id)
      from (
        select c.id, c.title, c.current_stage_key,
               case_binding_gate_demands(c.id, null) as demands
        from development_cases c
        where c.organization_id = v_org
          and c.status in ('active', 'on_hold', 'sanctioned')
        order by c.created_at desc, c.id
        limit v_limit
      ) x
      where x.demands is not null
    ), '[]'::jsonb),
    'instruments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id,
        'subjectType', w.subject_type,
        'caseId', w.development_case_id,
        'requirementId', w.requirement_id,
        'standardId', w.standard_id,
        'status', case
          when w.status = 'approved' and w.expires_at <= now() then 'expired'
          else w.status
        end,
        'requestedAt', w.requested_at,
        'expiresAt', w.expires_at,
        'justification', w.justification,
        'compensatingControls', w.compensating_controls,
        'subjectLabel', coalesce(sc.criterion, gs.title, w.id::text)
      ) order by w.requested_at desc, w.id)
      from standard_site_variances w
      left join stage_gate_criteria sc on sc.id = w.requirement_id
      left join governance_standards gs on gs.id = w.standard_id
      left join development_cases dc on dc.id = w.development_case_id
      where w.organization_id = v_org
        and (w.status = 'pending'
          or w.status = 'expired'
          or (w.status = 'approved' and w.expires_at <= now()))
        and (w.subject_type = 'standard'
          or dc.status in ('active', 'on_hold', 'sanctioned'))
    ), '[]'::jsonb),
    'blockedAttemptCount', v_event_count,
    'blockedAttemptsTruncated', v_event_count > 200,
    'blockedAttempts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'eventType', e.event_type,
        'severity', e.severity,
        'detail', e.detail,
        'actorLabel', e.actor_label,
        'createdAt', e.created_at
      ) order by e.created_at desc, e.id)
      from (
        select id, event_type, severity, detail, actor_label, created_at
        from security_events
        where organization_id = v_org
          and event_type = 'access_denied'
          and created_at >= now() - make_interval(days => v_days)
        order by created_at desc, id
        limit 200
      ) e
    ), '[]'::jsonb),
    'basis', 'Canonical case_binding_gate_demands, standard_site_variances and committed security_events.access_denied records.',
    'advisory', true
  );
end
$$;

revoke all on function public.screen_governance_agent(integer, integer)
  from public, anon, service_role;
grant execute on function public.screen_governance_agent(integer, integer)
  to authenticated;

comment on function public.screen_governance_agent(integer, integer) is
  'D12.18: admin-only, tenant-scoped, deterministic governance detection input. Read-only; never adjudicates.';
