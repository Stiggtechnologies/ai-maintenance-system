-- Browser-draft import binds one canonical decision.
--
-- create_case_decision(uuid, text, date, uuid, uuid, text) still frames a new
-- decision for the Case Workspace. The seven-argument overload is the import
-- path: the caller supplies a stable idempotency key written before the RPC.
-- A retry after a lost acknowledgement returns the original decision and does
-- not insert another decisions row or another case_decision audit. Evidence
-- and discussion stay in the browser draft; this function copies only the
-- question identity.

create unique index if not exists idx_audit_case_decision_import_intent
  on public.audit_events (organization_id, (event_data->>'idempotency_key'))
  where entity_type = 'case_decision'
    and event_data->>'action' = 'framed'
    and event_data ? 'idempotency_key';

create or replace function public.create_case_decision(
  p_case_id uuid,
  p_question text,
  p_required_date date,
  p_objective_id uuid,
  p_owner_id uuid,
  p_approval_level text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_id uuid;
  v_event jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'framing a case decision requires a planning, engineering or governance role');
  end if;
  if p_idempotency_key is null then
    return jsonb_build_object('error', 'a browser-draft import requires a stable idempotency key');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_org::text || ':case_decision_import:' || p_idempotency_key::text, 0));
  if public.app_current_org() is distinct from v_org then
    return jsonb_build_object('error', 'authorization changed while the import waited');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'framing a case decision requires a planning, engineering or governance role');
  end if;

  select a.event_data into v_event
  from audit_events a
  where a.organization_id = v_org
    and a.entity_type = 'case_decision'
    and a.event_data->>'action' = 'framed'
    and a.event_data->>'idempotency_key' = p_idempotency_key::text
  limit 1;
  if found then
    if v_event->>'case_id' is distinct from p_case_id::text then
      return jsonb_build_object('error', 'this import identity already belongs to a different development case');
    end if;
    select d.id into v_id
    from decisions d
    where d.id = (v_event->>'decision_id')::uuid
      and d.organization_id = v_org
      and d.development_case_id = p_case_id;
    if not found then
      return jsonb_build_object('error', 'the imported decision is no longer available in this organization');
    end if;
    return jsonb_build_object(
      'decision_id', v_id,
      'case_id', p_case_id,
      'replay', true
    );
  end if;

  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error', 'decisions are not framable on a ' || c.status || ' case');
  end if;
  if coalesce(length(btrim(p_question)), 0) < 10 then
    return jsonb_build_object('error',
      'a decision begins with its question — what is being decided? (10 characters minimum)');
  end if;
  if p_objective_id is not null and not exists
     (select 1 from risk_objectives where id = p_objective_id and organization_id = v_org) then
    return jsonb_build_object('error', 'objective not found in this organization');
  end if;
  if p_owner_id is not null and not exists
     (select 1 from user_profiles where id = p_owner_id and organization_id = v_org) then
    return jsonb_build_object('error', 'the decision owner must be a member of this organization');
  end if;

  insert into decisions
    (organization_id, development_case_id, decision_type, decision_question,
     objective_id, owner_id, decision_required_date, approval_level,
     approval_status, autonomy_mode, outcome_status, human_actor)
  values
    (v_org, c.id, 'development_case', btrim(p_question),
     p_objective_id, coalesce(p_owner_id, auth.uid()), p_required_date,
     nullif(btrim(coalesce(p_approval_level, '')), ''),
     'pending', 'advisory', 'open',
     (select coalesce(p.full_name, p.email) from user_profiles p where p.id = auth.uid()))
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_decision', coalesce(v_role, 'unknown'),
    jsonb_build_object(
      'decision_id', v_id,
      'case_id', c.id,
      'action', 'framed',
      'question', btrim(p_question),
      'required_date', p_required_date,
      'idempotency_key', p_idempotency_key));

  return jsonb_build_object(
    'decision_id', v_id,
    'case_id', c.id,
    'replay', false
  );
exception
  when unique_violation then
    if sqlerrm not like '%idx_audit_case_decision_import_intent%' then
      raise;
    end if;
    select (a.event_data->>'decision_id')::uuid into v_id
    from audit_events a
    where a.organization_id = v_org
      and a.entity_type = 'case_decision'
      and a.event_data->>'action' = 'framed'
      and a.event_data->>'idempotency_key' = p_idempotency_key::text
      and a.event_data->>'case_id' = p_case_id::text
    limit 1;
    if v_id is null then
      return jsonb_build_object('error', 'this import identity already belongs to a different development case');
    end if;
    return jsonb_build_object(
      'decision_id', v_id,
      'case_id', p_case_id,
      'replay', true
    );
end
$$;

revoke all on function public.create_case_decision(uuid, text, date, uuid, uuid, text, uuid)
  from public, anon;
grant execute on function public.create_case_decision(uuid, text, date, uuid, uuid, text, uuid)
  to authenticated, service_role;

comment on function public.create_case_decision(uuid, text, date, uuid, uuid, text, uuid) is
  'Idempotent browser-draft import. Replays the original canonical decision and '
  'does not write a second decision or case_decision audit. The six-argument '
  'framing function is unchanged.';
